/**
 * Live end-to-end run over HTTP on the real Zcash testnet.
 *
 * REAL:   the API request path (guardian, reservation, payment orchestration, receipts), the
 *         signer as a SEPARATE PROCESS reached over HMAC-authenticated HTTP, the shared SQLite
 *         file, the real zcash-devtool adapter, wallet creation, funding, signing, broadcast,
 *         confirmation tracking, and sweep-back - all on the live Ironwood testnet.
 * FAKED:  only the two external services we have no API keys for - the Anthropic agent
 *         (scripted to propose one product) and Bitrefill (fixture product + simulated invoice
 *         id). Nothing here claims a real Bitrefill purchase: settlement is SIMULATED.
 *
 * The signer must already be running (see the commands in the run notes) with the same
 * OBSCURA_DB_PATH, GUARDIAN_HMAC_SECRET, SIGNER_AUTH_SECRET.
 *
 * Env: SIGNER_BASE_URL, SIGNER_AUTH_SECRET, GUARDIAN_HMAC_SECRET, OBSCURA_DB_PATH,
 *      DEMO_SETTLEMENT_ADDRESS, ZCASH_DEVTOOL_PATH, MAIN_WALLETS_DIR (holds the funded "main" wallet)
 */
import { BitrefillClient } from "@obscura/bitrefill-client";
import { CliZcashAdapter } from "@obscura/zcash-adapter";
import { openDatabase } from "../services/api/src/db/client.js";
import { buildServer } from "../services/api/src/http/server.js";
import { ReceiptKeyring, publicKeyFromBase64, verifyDisclosure } from "../services/api/src/receipts/receiptCrypto.js";
import { FakeLlmDriver, toolUseStep } from "../services/api/test/agent/fakeDriver.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[live] ${new Date().toISOString().slice(11, 19)} ${m}`);
const json = (r: { payload: string }) => JSON.parse(r.payload);

const SIGNER_URL = need("SIGNER_BASE_URL");
const MAIN_WALLET = "main";
const FUNDING_ZATOSHI = 10_000_000; // 0.1 TAZ
const FIXTURE = {
  data: { id: "bitrefill-esim-japan", name: "Japan eSIM (fixture)", currency: "USD", packages: [{ package_id: "jp-1gb", value: "1GB, 7 Days", price: 5 }] },
};

// 0. The signer process must be up.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${SIGNER_URL}/health`)).ok) break;
  } catch {}
  if (i > 30) throw new Error("signer not reachable");
  await sleep(1000);
}
log("signer process reachable over HTTP");

const mainWallet = new CliZcashAdapter({ binaryPath: need("ZCASH_DEVTOOL_PATH"), walletsRoot: need("MAIN_WALLETS_DIR"), confirmationsRequired: 3 });
const db = openDatabase(need("OBSCURA_DB_PATH"));
const keyring = ReceiptKeyring.ephemeral();
const app = await buildServer(db, {
  // No agentDriver/bitrefill keys exist, so these two are injected. Everything else comes from env:
  // the signer gateway (SIGNER_BASE_URL + SIGNER_AUTH_SECRET), the intent builder
  // (DEMO_SETTLEMENT_ADDRESS + DEMO_ZATOSHI_PER_MINOR) and the guardian secret.
  agentDriver: new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::1GB, 7 Days" })]),
  bitrefillClient: new BitrefillClient({ apiKey: "none", fetchImpl: (async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as unknown as typeof fetch }),
  invoiceCreator: { createInvoiceForOrder: async () => ({ id: "SIMULATED-INVOICE" }) },
  receiptKeyring: keyring,
  confirmationTimeoutMs: 20 * 60_000,
});
log("API built (agent + Bitrefill are stand-ins; signer, wallets and chain are real)");

// 1. Mandate
const mandate = json(await app.inject({ method: "POST", url: "/api/mandates", payload: { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 } }));
log(`mandate ${mandate.id} created ($30 cap, eSIM only)`);

// 2. Fund: the API asks the SIGNER (over HTTP) to create the envelope wallet
const fund = await app.inject({ method: "POST", url: `/api/mandates/${mandate.id}/fund` });
if (fund.statusCode !== 200) throw new Error(`/fund failed: ${fund.statusCode} ${fund.payload}`);
const { receivingAddress, envelopeWalletRef } = json(fund);
log(`POST /fund -> envelope wallet ${envelopeWalletRef} created BY THE SIGNER; address ${receivingAddress.slice(0, 24)}...`);

// 3. The user's main wallet funds it (outside the API, as designed)
await mainWallet.sync(MAIN_WALLET);
const funding = await mainWallet.send({ walletRef: MAIN_WALLET, outputs: [{ address: receivingAddress, amountZatoshi: FUNDING_ZATOSHI }], memo: null });
log(`main wallet sent ${FUNDING_ZATOSHI} zatoshi to the envelope: tx ${funding.txId}`);

// 4. Wait until the envelope funds are SPENDABLE (about 10 confirmations)
let spendable = 0;
for (let i = 0; i < 60; i++) {
  const env = json(await app.inject({ method: "GET", url: `/api/mandates/${mandate.id}/envelope` }));
  spendable = env.spendableZatoshi ?? 0;
  log(`GET /envelope -> total=${env.totalZatoshi} spendable=${spendable} funded=${env.funded}`);
  if (spendable >= FUNDING_ZATOSHI) break;
  await sleep(20_000);
}
if (spendable < FUNDING_ZATOSHI) throw new Error("envelope never became spendable");

// 5. Shopping request -> guardian -> background payment (invoice, signer over HTTP, real tx)
const shop = json(await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: mandate.id, prompt: "find me a 1GB Japan eSIM" } }));
log(`POST /api/shopping/requests -> ${shop.status}; order ${shop.order?.orderId} status=${shop.order?.status} price=${shop.order?.priceMinor} cents`);
if (shop.status !== "authorized") throw new Error(`expected authorized, got ${shop.status}`);
const orderId: string = shop.order.orderId;

// 6. Poll the order until delivered (each GET advances the payment by one chain observation)
let final: { order: { status: string }; payment: Record<string, unknown> } | null = null;
let last = "";
for (let i = 0; i < 60; i++) {
  await app.payments!.idle();
  const got = json(await app.inject({ method: "GET", url: `/api/orders/${orderId}` }));
  const line = `status=${got.order.status} tx=${got.payment?.txId ?? "-"} amountZatoshi=${got.payment?.amountZatoshi ?? "-"}`;
  if (line !== last) log(`GET /api/orders/:id -> ${line}`);
  last = line;
  if (["delivered", "failed", "payment_uncertain", "rejected"].includes(got.order.status)) {
    final = got;
    break;
  }
  await sleep(10_000);
}
if (!final || final.order.status !== "delivered") throw new Error(`order did not reach delivered: ${final?.order.status}`);
log(`ORDER DELIVERED (simulated settlement). tx ${final.payment.txId}`);
log(`label shown to the user: ${(final.payment.simulatedDelivery as { label: string }).label.slice(0, 80)}...`);

// 7. Receipt + independent verification with only the public key
const receipts = json(await app.inject({ method: "GET", url: "/api/receipts" }));
if (receipts.length !== 1) throw new Error(`expected 1 receipt, got ${receipts.length}`);
const detail = json(await app.inject({ method: "GET", url: `/api/receipts/${receipts[0].receiptId}` }));
const disclosure = json(await app.inject({ method: "POST", url: `/api/receipts/${receipts[0].receiptId}/disclose` }));
const pub = publicKeyFromBase64(json(await app.inject({ method: "GET", url: "/api/receipts/public-key" })).publicKey);
const verified = verifyDisclosure(disclosure, pub);
log(`receipt ${receipts[0].receiptId}: settlementMode=${detail.payload.settlementMode} signatureValid=${detail.signatureValid} independentVerify=${JSON.stringify(verified)}`);
if (!verified.valid || detail.payload.settlementMode !== "simulated") throw new Error("receipt verification failed");

// 8. Order history + scoreboard endpoints
const list = json(await app.inject({ method: "GET", url: `/api/orders?mandateId=${mandate.id}` }));
const board = json(await app.inject({ method: "GET", url: "/api/security/scoreboard" }));
log(`GET /api/orders -> ${list.orders.length} order(s); scoreboard status=${board.status}${board.run ? ` ${board.run.passed}/${board.run.total}` : ""}`);

// 9. Sweep-back: revoke, then the signer sweeps the remainder to the user's main wallet
await app.inject({ method: "POST", url: `/api/mandates/${mandate.id}/revoke` });
log("mandate revoked");
let sweepTx: string | null = null;
for (let i = 0; i < 40 && !sweepTx; i++) {
  const sw = await app.inject({ method: "POST", url: `/api/mandates/${mandate.id}/sweep` });
  const body = json(sw);
  if (sw.statusCode === 200) {
    sweepTx = body.sweepTxId;
    log(`POST /sweep -> ${sw.statusCode} sweepTxId=${sweepTx}`);
  } else {
    log(`POST /sweep -> ${sw.statusCode} ${body.error?.code} (retrying while change confirms)`);
    await sleep(20_000);
  }
}
if (!sweepTx) throw new Error("sweep never succeeded");

log("LIVE RUN COMPLETE");
log(`funding tx : ${funding.txId}`);
log(`payment tx : ${final.payment.txId}`);
log(`sweep tx   : ${sweepTx}`);
process.exit(0);
