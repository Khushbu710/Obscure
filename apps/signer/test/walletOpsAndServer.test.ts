import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { issueAuthorizationToken } from "@obscura/guardian";
import type { BlockchainTxRequest, BlockchainTxResult } from "@obscura/contracts";
import { MockZcashAdapter } from "@obscura/zcash-adapter";
import {
  HangingBlockchainAdapter,
  SignerMandateRepository,
  SignerOrderRepository,
  SignerService,
  WalletOpsService,
  ZcashBlockchainAdapter,
  buildSignerServer,
  openSignerDatabase,
  signBody,
  SIGNATURE_HEADER,
} from "../src/index.js";

const TOKEN_SECRET = "token-secret";
const AUTH_SECRET = "auth-secret";
const SETTLEMENT = "utest1settlementdemo";
const SWEEP = "utest1usermain";
const NOW = 1_800_000_000_000;
const RATE = 10_000;

/** Records exactly what the signer asks the wallet to build. */
class SpyAdapter extends MockZcashAdapter {
  sent: BlockchainTxRequest[] = [];
  override async send(r: BlockchainTxRequest): Promise<BlockchainTxResult> {
    this.sent.push(r);
    return super.send(r);
  }
}

function build(opts: { mandateStatus?: string; expiresInMs?: number; envelope?: boolean; allowlist?: string[] } = {}) {
  const db = openSignerDatabase(":memory:");
  const zcash = new SpyAdapter();
  const mandates = new SignerMandateRepository(db);
  const orders = new SignerOrderRepository(db);
  const signer = new SignerService(
    db,
    mandates,
    orders,
    TOKEN_SECRET,
    new ZcashBlockchainAdapter(zcash, mandates),
    () => NOW,
    1000,
    new Set(opts.allowlist ?? [SETTLEMENT]),
  );
  const wallets = new WalletOpsService(mandates, orders, zcash, { sweepAddress: SWEEP }, () => NOW);
  return { db, zcash, mandates, orders, signer, wallets, opts };
}
type Ctx = ReturnType<typeof build>;

async function seed(ctx: Ctx, orderStatus = "reserved") {
  const mandateId = randomUUID();
  const orderId = randomUUID();
  const nonce = "n".repeat(48);
  const wallet = await ctx.zcash.createWallet(`m-${mandateId}`);
  ctx.zcash.credit(wallet.walletRef, 500_000_000);
  ctx.db
    .prepare(
      `INSERT INTO mandates (id,user_id,status,allowed_categories,total_cap_minor,spent_minor,currency,envelope_wallet_ref,receiving_address,created_at,expires_at,schema_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    )
    .run(
      mandateId,
      "u",
      ctx.opts.mandateStatus ?? "active",
      '["esim"]',
      3000,
      1000,
      "USD",
      ctx.opts.envelope === false ? null : wallet.walletRef,
      wallet.address,
      new Date(NOW - 1000).toISOString(),
      new Date(NOW + (ctx.opts.expiresInMs ?? 3_600_000)).toISOString(),
    );
  const product = { merchantProductId: "p1", name: "eSIM", priceMinor: 1000, currency: "USD", category: "esim", merchantId: "m" };
  ctx.db
    .prepare("INSERT INTO orders (order_id,mandate_id,product_json,price_minor,nonce,status,proposed_at) VALUES (?,?,?,?,?,?,?)")
    .run(orderId, mandateId, JSON.stringify(product), 1000, nonce, orderStatus, new Date(NOW - 500).toISOString());
  const order = { orderId, mandateId, product, priceMinor: 1000, nonce, status: orderStatus, proposedAt: new Date(NOW - 500).toISOString() } as const;
  const token = (dest = SETTLEMENT, amount = 1000 * RATE) =>
    issueAuthorizationToken({ orderId, nonce, mandateId, transactionIntent: { destinationAddress: dest, amountZatoshi: amount } }, TOKEN_SECRET, NOW);
  return { mandateId, orderId, order, token, walletRef: wallet.walletRef };
}

const statusOf = (c: Ctx, id: string) => (c.db.prepare("SELECT status FROM orders WHERE order_id = ?").get(id) as { status: string }).status;
const spentOf = (c: Ctx, id: string) => (c.db.prepare("SELECT spent_minor FROM mandates WHERE id = ?").get(id) as { spent_minor: number }).spent_minor;

describe("real-adapter bridge on the baseline SignerService", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = build();
  });

  it("pays the intent-bound destination from the mandate's own envelope wallet and returns the txId", async () => {
    const s = await seed(ctx);
    const r = await ctx.signer.sign({ authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 });
    expect(r).toMatchObject({ signed: true, txId: expect.any(String) });
    expect(ctx.zcash.sent).toHaveLength(1);
    expect(ctx.zcash.sent[0]).toMatchObject({ walletRef: s.walletRef, outputs: [{ address: SETTLEMENT, amountZatoshi: 10_000_000 }] });
    expect(statusOf(ctx, s.orderId)).toBe("broadcast");
  });

  it("an intent-bound destination outside the signer's allowlist is still refused", async () => {
    const s = await seed(ctx);
    const evil = "utest1attacker";
    const r = await ctx.signer.sign({ authorizationToken: s.token(evil), order: s.order, destinationAddress: evil, amountZatoshi: 10_000_000 });
    expect(r).toMatchObject({ signed: false, code: "DESTINATION_MISMATCH" });
    expect(ctx.zcash.sent).toHaveLength(0);
    expect(statusOf(ctx, s.orderId)).toBe("reserved");
  });

  it("a mandate with no envelope wallet is a definite failure: order failed and budget released", async () => {
    const c = build({ envelope: false });
    const s = await seed(c);
    const r = await c.signer.sign({ authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 });
    expect(r).toMatchObject({ signed: false, code: "ADAPTER_ERROR" });
    expect(statusOf(c, s.orderId)).toBe("failed");
    expect(spentOf(c, s.mandateId)).toBe(0);
  });

  it("a hung wallet is BROADCAST_UNCERTAIN: order frozen, budget kept, nothing retried", async () => {
    const db = openSignerDatabase(":memory:");
    const mandates = new SignerMandateRepository(db);
    const hang = new SignerService(db, mandates, new SignerOrderRepository(db), TOKEN_SECRET, new HangingBlockchainAdapter(), () => NOW, 50, new Set([SETTLEMENT]));
    const c = { ...ctx, db, signer: hang } as Ctx;
    const s = await seed(c);
    const r = await hang.sign({ authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 });
    expect(r).toMatchObject({ signed: false, code: "BROADCAST_UNCERTAIN" });
    expect(statusOf(c, s.orderId)).toBe("payment_uncertain");
    expect(spentOf(c, s.mandateId)).toBe(1000);
    expect(await hang.sign({ authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 })).toMatchObject({ code: "NONCE_ALREADY_CONSUMED" });
  });
});

describe("WalletOpsService", () => {
  it("creates an envelope for an active mandate and is idempotent / recovers an unrecorded wallet", async () => {
    const c = build({ envelope: false });
    const s = await seed(c);
    const first = await c.wallets.createEnvelope(s.mandateId);
    expect(first).toMatchObject({ ok: true, walletRef: `m-${s.mandateId}` });
    // The backend has not recorded it yet: a retry must return the SAME wallet, not make a second one.
    const again = await c.wallets.createEnvelope(s.mandateId);
    expect(again).toMatchObject({ ok: true, walletRef: `m-${s.mandateId}` });
    if (first.ok && again.ok) expect(again.receivingAddress).toBe(first.receivingAddress);
  });

  it("refuses unknown and non-active mandates", async () => {
    const c = build({ mandateStatus: "revoked", envelope: false });
    const s = await seed(c);
    expect(await c.wallets.createEnvelope(s.mandateId)).toMatchObject({ ok: false, code: "MANDATE_NOT_ACTIVE" });
    expect(await c.wallets.createEnvelope(randomUUID())).toMatchObject({ ok: false, code: "MANDATE_NOT_FOUND" });
  });

  it("reports live envelope balance", async () => {
    const c = build();
    const s = await seed(c);
    expect(await c.wallets.envelopeStatus(s.mandateId)).toMatchObject({ ok: true, spendableZatoshi: 500_000_000, funded: true });
  });

  it("txStatus answers only for paid orders", async () => {
    const c = build();
    const s = await seed(c);
    expect(await c.wallets.txStatus(s.orderId, "x")).toMatchObject({ ok: false, code: "ORDER_NOT_PAID" });
    const paid = await c.signer.sign({ authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 });
    if (!paid.signed || !paid.txId) throw new Error("expected a signed payment with a txId");
    expect(await c.wallets.txStatus(s.orderId, paid.txId)).toMatchObject({ ok: true, tx: { txId: paid.txId, status: "broadcast" } });
    expect(await c.wallets.txStatus(randomUUID(), "x")).toMatchObject({ ok: false, code: "ORDER_NOT_FOUND" });
  });

  it("sweep: refuses an active mandate, waits for in-flight orders (incl. payment_uncertain), then sweeps", async () => {
    const active = build();
    const a = await seed(active);
    expect(await active.wallets.sweep(a.mandateId)).toMatchObject({ ok: false, code: "MANDATE_STILL_ACTIVE" });

    const c = build({ mandateStatus: "revoked" });
    const s = await seed(c); // seeded order is 'reserved' = in flight
    expect(await c.wallets.sweep(s.mandateId)).toMatchObject({ ok: false, code: "ORDERS_IN_FLIGHT" });
    c.db.prepare("UPDATE orders SET status = 'payment_uncertain' WHERE order_id = ?").run(s.orderId);
    expect(await c.wallets.sweep(s.mandateId)).toMatchObject({ ok: false, code: "ORDERS_IN_FLIGHT" });
    c.db.prepare("UPDATE orders SET status = 'confirmed' WHERE order_id = ?").run(s.orderId);
    expect(await c.wallets.sweep(s.mandateId)).toMatchObject({ ok: true });
    expect((await c.zcash.getBalance(s.walletRef)).spendableZatoshi).toBe(0);
  });

  it("sweeps a mandate that expired by time even if its stored status is still active", async () => {
    const c = build({ expiresInMs: -1000 });
    const s = await seed(c);
    c.db.prepare("UPDATE orders SET status = 'failed' WHERE order_id = ?").run(s.orderId);
    expect(await c.wallets.sweep(s.mandateId)).toMatchObject({ ok: true });
  });

  it("will not start without a configured sweep address", () => {
    const c = build();
    expect(() => new WalletOpsService(c.mandates, c.orders, c.zcash, { sweepAddress: "" })).toThrow();
  });
});

describe("signer HTTP server", () => {
  const post = (app: Awaited<ReturnType<typeof buildSignerServer>>, url: string, body: unknown, secret?: string) => {
    const payload = JSON.stringify(body);
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json", ...(secret ? { [SIGNATURE_HEADER]: signBody(payload, secret) } : {}) },
      payload,
    });
  };

  it("requires a valid HMAC on every endpoint, and signs when it is present", async () => {
    const c = build();
    const s = await seed(c);
    const app = await buildSignerServer(c.signer, c.wallets, AUTH_SECRET, false);
    const signBodyJson = { authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 };

    for (const [url, body] of [
      ["/sign", signBodyJson],
      ["/wallets/create", { mandateId: s.mandateId }],
      ["/wallets/status", { mandateId: s.mandateId }],
      ["/wallets/sweep", { mandateId: s.mandateId }],
      ["/tx/status", { orderId: s.orderId, txId: "x" }],
    ] as const) {
      expect((await post(app, url, body)).statusCode, `${url} unsigned`).toBe(401);
      expect((await post(app, url, body, "wrong-secret")).statusCode, `${url} wrong secret`).toBe(401);
    }
    expect(c.zcash.sent).toHaveLength(0);

    const ok = await post(app, "/sign", signBodyJson, AUTH_SECRET);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload)).toMatchObject({ signed: true, txId: expect.any(String) });
  });

  it("maps outcomes to distinct statuses, with BROADCAST_UNCERTAIN as 504", async () => {
    const db = openSignerDatabase(":memory:");
    const mandates = new SignerMandateRepository(db);
    const orders = new SignerOrderRepository(db);
    const hang = new SignerService(db, mandates, orders, TOKEN_SECRET, new HangingBlockchainAdapter(), () => NOW, 50, new Set([SETTLEMENT]));
    const zcash = new SpyAdapter();
    const c = { db, zcash, opts: {} } as unknown as Ctx;
    const s = await seed(c);
    const app = await buildSignerServer(hang, new WalletOpsService(mandates, orders, zcash, { sweepAddress: SWEEP }), AUTH_SECRET, false);
    const res = await post(app, "/sign", { authorizationToken: s.token(), order: s.order, destinationAddress: SETTLEMENT, amountZatoshi: 10_000_000 }, AUTH_SECRET);
    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.payload)).toMatchObject({ signed: false, code: "BROADCAST_UNCERTAIN" });

    const bad = await post(app, "/sign", { authorizationToken: "x" }, AUTH_SECRET);
    expect(bad.statusCode).toBe(400);
  });
});
