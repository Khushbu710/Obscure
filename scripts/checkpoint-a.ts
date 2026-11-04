/**
 * Checkpoint A (development-roadmap.md): one real, guardian-approved order
 * produces a real signed, broadcast, confirmed testnet transaction from a
 * mandate's envelope wallet - using the REAL production signer, guardian and
 * authorization code and the REAL zcash-devtool adapter. No mocks.
 *
 * Prerequisites (see docs/architecture/zcash-integration.md "PoC results"):
 *   - zcash-devtool built, and a funded envelope wallet labelled "envelope" under WALLETS_DIR
 *     (its age identity file at WALLETS_DIR/envelope.identity.txt).
 *
 * Usage:  npx tsx scripts/checkpoint-a.ts
 * Env:    ZCASH_DEVTOOL_PATH, WALLETS_DIR (defaults point at the PoC folders)
 */
import { CliZcashAdapter } from "@obscura/zcash-adapter";
import { openDatabase } from "../services/api/src/db/client.js";
import { MandateRepository } from "../services/api/src/repositories/mandateRepository.js";
import { OrderRepository } from "../services/api/src/repositories/orderRepository.js";
import { NonceRepository } from "../services/api/src/repositories/nonceRepository.js";
import { MandateService } from "../services/api/src/mandate/mandateService.js";
import { OrderAuthorizationService } from "../services/api/src/mandate/orderAuthorizationService.js";
import { SignerService, SqliteSignerStore } from "../apps/signer/src/index.js";

const BINARY = process.env.ZCASH_DEVTOOL_PATH ?? "tools/zcash-devtool/bin/zcash-devtool.exe";
const WALLETS = process.env.WALLETS_DIR ?? "tools/poc";
const ENVELOPE = "envelope";
const SETTLEMENT = "settlement";
const TOKEN_SECRET = "checkpoint-a-token-secret";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[checkpoint-a] ${m}`);

const adapter = new CliZcashAdapter({ binaryPath: BINARY, walletsRoot: WALLETS, confirmationsRequired: 3 });

// Demo settlement wallet: stands in for "where real funds would go on mainnet" (payment-flow.md section 2).
let settlementAddress: string;
try {
  settlementAddress = await adapter.getAddress(SETTLEMENT);
} catch {
  settlementAddress = (await adapter.createWallet(SETTLEMENT)).address;
  log("created demo settlement wallet");
}

const db = openDatabase(":memory:");
const mandateRepo = new MandateRepository(db);
const orders = new OrderRepository(db);
const mandates = new MandateService(mandateRepo);
const auth = new OrderAuthorizationService(db, mandateRepo, orders, new NonceRepository(db), TOKEN_SECRET);
const signer = new SignerService(new SqliteSignerStore(db), adapter, {
  tokenSecret: TOKEN_SECRET,
  settlementAddress,
  sweepAddress: settlementAddress, // not used in this script
  zatoshiPerMinor: 10_000, // demo rate: $5.00 (500 cents) = 0.05 TAZ
});

await adapter.sync(ENVELOPE);
const before = await adapter.getBalance(ENVELOPE);
log(`envelope balance before: spendable=${before.spendableZatoshi} total=${before.totalZatoshi} zatoshi`);
if (before.spendableZatoshi < 6_000_000) throw new Error("Envelope has too little spendable balance yet (needs ~10 confirmations after funding). Try again shortly.");

// 1. Mandate (real DB row) bound to the real envelope wallet.
const mandate = mandates.create("demo-user", { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 });
mandateRepo.setFunding(mandate.id, ENVELOPE, await adapter.getAddress(ENVELOPE));
log(`mandate ${mandate.id} ($30 cap, eSIM only) bound to envelope wallet`);

// 2. Guardian approval (real guardian, real reservation).
const { order, guardian } = auth.authorize(
  {
    mandateId: mandate.id,
    priceMinor: 500,
    product: { merchantProductId: "esim-japan-1gb::demo", name: "Japan 1GB eSIM", priceMinor: 500, currency: "USD", category: "esim", merchantId: "bitrefill-esim-jp" },
  },
  500,
);
if (!guardian.approved) throw new Error(`guardian rejected: ${guardian.code}`);
log(`guardian APPROVED order ${order.orderId}; budget reserved`);

// 3. Independent signer re-validation + real payment.
const result = await signer.signOrder({ authorizationToken: guardian.authorizationToken, order });
if (!result.signed) throw new Error(`signer refused: ${result.code} - ${result.reason}`);
log(`signer SIGNED + BROADCAST real transaction ${result.tx.txId} (${result.amountZatoshi} zatoshi -> demo settlement wallet)`);

// 4. Track confirmation on the real chain.
for (let i = 0; i < 40; i++) {
  await adapter.sync(ENVELOPE);
  const st = await adapter.getTxStatus(ENVELOPE, result.tx.txId);
  log(`status: ${st.status} (confirmations=${st.confirmations})`);
  if (st.status === "confirmed") {
    const after = await adapter.getBalance(ENVELOPE);
    log(`CHECKPOINT A REACHED. envelope total after: ${after.totalZatoshi} zatoshi`);
    log(`txid: ${result.tx.txId}`);
    process.exit(0);
  }
  await sleep(15_000);
}
throw new Error("Timed out waiting for confirmation (transaction may still confirm; check list-tx)");
