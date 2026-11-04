import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { issueAuthorizationToken } from "@obscura/guardian";
import type { Order } from "@obscura/contracts";
import { MockZcashAdapter } from "@obscura/zcash-adapter";
import { SignerService, SqliteSignerStore, buildSignerServer, signBody, SIGNATURE_HEADER } from "../src/index.js";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, "../../../services/api/src/db/schema.sql"), "utf8");

const TOKEN_SECRET = "token-secret";
const AUTH_SECRET = "auth-secret";
const SETTLEMENT = "utest1settlementdemoaddress";
const NOW = new Date("2026-11-04T12:00:00.000Z");
const MANDATE_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const NONCE = "n".repeat(48);

function setup(opts: { mandateStatus?: string; expiresAt?: string; envelope?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const adapter = new MockZcashAdapter();
  return { db, adapter, opts };
}

async function seed(ctx: ReturnType<typeof setup>) {
  const { db, adapter, opts } = ctx;
  const wallet = await adapter.createWallet("env1");
  adapter.credit(wallet.walletRef, 50_000_000);
  db.prepare(
    `INSERT INTO mandates (id,user_id,status,allowed_categories,allowed_merchants,allowed_product_ids,total_cap_minor,per_order_cap_minor,spent_minor,currency,envelope_wallet_ref,receiving_address,funded_at,funding_tx_id,created_at,expires_at,revoked_at,schema_version)
     VALUES (?,?,?,?,NULL,NULL,3000,NULL,1000,'USD',?,?,NULL,NULL,?,?,NULL,1)`,
  ).run(
    MANDATE_ID,
    "u1",
    opts.mandateStatus ?? "active",
    JSON.stringify(["esim"]),
    opts.envelope === false ? null : wallet.walletRef,
    wallet.address,
    NOW.toISOString(),
    opts.expiresAt ?? "2026-11-05T12:00:00.000Z",
  );
  const product = { merchantProductId: "esim-jp-5gb", name: "Japan 5GB", priceMinor: 1000, currency: "USD", category: "esim", merchantId: "bitrefill-esim-jp" };
  db.prepare(`INSERT INTO orders (order_id,mandate_id,product_json,price_minor,nonce,status,proposed_at) VALUES (?,?,?,?,?,'reserved',?)`).run(
    ORDER_ID,
    MANDATE_ID,
    JSON.stringify(product),
    1000,
    NONCE,
    NOW.toISOString(),
  );
  db.prepare(`INSERT INTO consumed_nonces (nonce,order_id,consumed_at) VALUES (?,?,?)`).run(NONCE, ORDER_ID, NOW.toISOString());
  const order: Order = { orderId: ORDER_ID, mandateId: MANDATE_ID, product, priceMinor: 1000, nonce: NONCE, status: "reserved", proposedAt: NOW.toISOString() };
  const token = issueAuthorizationToken({ orderId: ORDER_ID, nonce: NONCE, mandateId: MANDATE_ID }, TOKEN_SECRET, NOW.getTime());
  return { order, token, walletRef: wallet.walletRef };
}

function service(ctx: ReturnType<typeof setup>, now = NOW) {
  return new SignerService(
    new SqliteSignerStore(ctx.db),
    ctx.adapter,
    { tokenSecret: TOKEN_SECRET, settlementAddress: SETTLEMENT, sweepAddress: "utest1usermainwallet", zatoshiPerMinor: 10_000 },
    () => now,
  );
}

const statusOf = (ctx: ReturnType<typeof setup>) =>
  (ctx.db.prepare("SELECT status FROM orders WHERE order_id = ?").get(ORDER_ID) as { status: string }).status;
const spentOf = (ctx: ReturnType<typeof setup>) =>
  (ctx.db.prepare("SELECT spent_minor FROM mandates WHERE id = ?").get(MANDATE_ID) as { spent_minor: number }).spent_minor;

describe("SignerService", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("signs a valid order, pays the configured settlement address, and marks it broadcast", async () => {
    const { order, token, walletRef } = await seed(ctx);
    const out = await service(ctx).signOrder({ authorizationToken: token, order });
    expect(out).toMatchObject({ signed: true, amountZatoshi: 10_000_000 });
    expect(statusOf(ctx)).toBe("broadcast");
    expect((await ctx.adapter.getBalance(walletRef)).spendableZatoshi).toBe(40_000_000);
  });

  it("rejects a forged token", async () => {
    const { order } = await seed(ctx);
    const forged = issueAuthorizationToken({ orderId: ORDER_ID, nonce: NONCE, mandateId: MANDATE_ID }, "wrong-secret", NOW.getTime());
    expect(await service(ctx).signOrder({ authorizationToken: forged, order })).toMatchObject({ signed: false, code: "INVALID_TOKEN" });
    expect(statusOf(ctx)).toBe("reserved");
  });

  it("rejects an expired token", async () => {
    const { order, token } = await seed(ctx);
    const later = new Date(NOW.getTime() + 5 * 60_000);
    expect(await service(ctx, later).signOrder({ authorizationToken: token, order })).toMatchObject({ signed: false, code: "TOKEN_EXPIRED" });
  });

  it("rejects a tampered amount (request says cheaper/higher than the persisted order)", async () => {
    const { order, token } = await seed(ctx);
    const out = await service(ctx).signOrder({ authorizationToken: token, order: { ...order, priceMinor: 1 } });
    expect(out).toMatchObject({ signed: false, code: "AMOUNT_MISMATCH" });
  });

  it("rejects a request whose order id differs from the token's", async () => {
    const { order, token } = await seed(ctx);
    const out = await service(ctx).signOrder({ authorizationToken: token, order: { ...order, orderId: "33333333-3333-4333-8333-333333333333" } });
    expect(out).toMatchObject({ signed: false, code: "ORDER_MISMATCH" });
  });

  it("rejects when the mandate was revoked AFTER the guardian approved", async () => {
    const { order, token } = await seed(ctx);
    ctx.db.prepare("UPDATE mandates SET status = 'revoked' WHERE id = ?").run(MANDATE_ID);
    expect(await service(ctx).signOrder({ authorizationToken: token, order })).toMatchObject({ signed: false, code: "MANDATE_NOT_ACTIVE" });
    expect(statusOf(ctx)).toBe("reserved");
  });

  it("rejects a paused mandate and an expired mandate", async () => {
    const { order, token } = await seed(ctx);
    ctx.db.prepare("UPDATE mandates SET status = 'paused' WHERE id = ?").run(MANDATE_ID);
    expect(await service(ctx).signOrder({ authorizationToken: token, order })).toMatchObject({ code: "MANDATE_NOT_ACTIVE" });
    ctx.db.prepare("UPDATE mandates SET status = 'active', expires_at = ? WHERE id = ?").run("2026-11-04T11:00:00.000Z", MANDATE_ID);
    expect(await service(ctx).signOrder({ authorizationToken: token, order })).toMatchObject({ code: "MANDATE_NOT_ACTIVE" });
  });

  it("rejects a mandate with no funded envelope wallet", async () => {
    const c = setup({ envelope: false });
    const { order, token } = await seed(c);
    expect(await service(c).signOrder({ authorizationToken: token, order })).toMatchObject({ code: "MANDATE_NOT_ACTIVE" });
  });

  it("refuses to sign the same authorized order twice (replay)", async () => {
    const { order, token, walletRef } = await seed(ctx);
    const s = service(ctx);
    expect((await s.signOrder({ authorizationToken: token, order })).signed).toBe(true);
    expect(await s.signOrder({ authorizationToken: token, order })).toMatchObject({ signed: false, code: "NONCE_ALREADY_CONSUMED" });
    expect((await ctx.adapter.getBalance(walletRef)).spendableZatoshi).toBe(40_000_000); // paid once only
  });

  it("only one of two concurrent sign attempts reaches the wallet", async () => {
    const { order, token, walletRef } = await seed(ctx);
    const s = service(ctx);
    const results = await Promise.all([s.signOrder({ authorizationToken: token, order }), s.signOrder({ authorizationToken: token, order })]);
    expect(results.filter((r) => r.signed)).toHaveLength(1);
    expect((await ctx.adapter.getBalance(walletRef)).spendableZatoshi).toBe(40_000_000);
  });

  it("rejects when the nonce was never consumed by this order's authorization", async () => {
    const { order, token } = await seed(ctx);
    ctx.db.prepare("DELETE FROM consumed_nonces WHERE nonce = ?").run(NONCE);
    expect(await service(ctx).signOrder({ authorizationToken: token, order })).toMatchObject({ signed: false, code: "ORDER_MISMATCH" });
  });

  it("on wallet failure marks the order failed and releases the reservation", async () => {
    const { order, token, walletRef } = await seed(ctx);
    // Drain the envelope so the send definitively fails.
    await ctx.adapter.send({ walletRef, outputs: [{ address: "x", amountZatoshi: 50_000_000 }], memo: null });
    await expect(service(ctx).signOrder({ authorizationToken: token, order })).rejects.toThrow("INSUFFICIENT_FUNDS");
    expect(statusOf(ctx)).toBe("failed");
    expect(spentOf(ctx)).toBe(0);
  });
});

describe("signer HTTP server", () => {
  it("rejects unsigned and wrongly-signed requests, accepts a correctly signed one", async () => {
    const ctx = setup();
    const { order, token } = await seed(ctx);
    const app = await buildSignerServer(service(ctx), AUTH_SECRET, false);
    const body = JSON.stringify({ authorizationToken: token, order });
    const headers = { "content-type": "application/json" };

    expect((await app.inject({ method: "POST", url: "/sign", headers, payload: body })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/sign", headers: { ...headers, [SIGNATURE_HEADER]: signBody(body, "wrong") }, payload: body })).statusCode,
    ).toBe(401);
    expect(statusOf(ctx)).toBe("reserved");

    const ok = await app.inject({ method: "POST", url: "/sign", headers: { ...headers, [SIGNATURE_HEADER]: signBody(body, AUTH_SECRET) }, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(statusOf(ctx)).toBe("broadcast");
  });
});

describe("envelope wallet operations", () => {
  it("creates an envelope for an active mandate, and is idempotent once the mandate has one", async () => {
    const ctx = setup({ envelope: false });
    await seed(ctx);
    const s = service(ctx);
    const first = await s.createEnvelope(MANDATE_ID);
    expect(first).toMatchObject({ ok: true });
    // Backend would persist this; simulate that, then a second call must return the SAME wallet.
    if (!first.ok) throw new Error("unreachable");
    ctx.db.prepare("UPDATE mandates SET envelope_wallet_ref = ? WHERE id = ?").run(first.walletRef, MANDATE_ID);
    const second = await s.createEnvelope(MANDATE_ID);
    expect(second).toMatchObject({ ok: true, walletRef: first.walletRef, receivingAddress: first.receivingAddress });
  });

  it("refuses to create an envelope for a revoked mandate or unknown mandate", async () => {
    const ctx = setup({ envelope: false, mandateStatus: "revoked" });
    await seed(ctx);
    expect(await service(ctx).createEnvelope(MANDATE_ID)).toMatchObject({ ok: false, code: "MANDATE_NOT_ACTIVE" });
    expect(await service(ctx).createEnvelope("99999999-9999-4999-8999-999999999999")).toMatchObject({ ok: false, code: "MANDATE_NOT_FOUND" });
  });

  it("reports live envelope balance", async () => {
    const ctx = setup();
    await seed(ctx);
    expect(await service(ctx).envelopeStatus(MANDATE_ID)).toMatchObject({ ok: true, spendableZatoshi: 50_000_000, funded: true });
  });

  it("refuses to sweep an active mandate", async () => {
    const ctx = setup();
    await seed(ctx);
    expect(await service(ctx).sweep(MANDATE_ID)).toMatchObject({ ok: false, code: "MANDATE_STILL_ACTIVE" });
  });

  it("refuses to sweep while an order is still in flight, then sweeps once it is settled", async () => {
    const ctx = setup({ mandateStatus: "revoked" });
    const { walletRef } = await seed(ctx); // seeded order is 'reserved' = in flight
    expect(await service(ctx).sweep(MANDATE_ID)).toMatchObject({ ok: false, code: "ORDERS_IN_FLIGHT" });
    ctx.db.prepare("UPDATE orders SET status = 'confirmed' WHERE order_id = ?").run(ORDER_ID);
    expect(await service(ctx).sweep(MANDATE_ID)).toMatchObject({ ok: true });
    expect((await ctx.adapter.getBalance(walletRef)).spendableZatoshi).toBe(0);
  });

  it("sweeps an expired-by-time mandate even if its stored status is still active", async () => {
    const ctx = setup({ expiresAt: "2026-11-04T11:00:00.000Z" });
    await seed(ctx);
    ctx.db.prepare("UPDATE orders SET status = 'failed' WHERE order_id = ?").run(ORDER_ID);
    expect(await service(ctx).sweep(MANDATE_ID)).toMatchObject({ ok: true });
  });

  it("txStatus only answers for signed orders and resolves the wallet from persisted state", async () => {
    const ctx = setup();
    const { order, token } = await seed(ctx);
    const s = service(ctx);
    expect(await s.txStatus(ORDER_ID, "abc")).toMatchObject({ ok: false, code: "ORDER_NOT_PAID" }); // still reserved
    const signed = await s.signOrder({ authorizationToken: token, order });
    if (!signed.signed) throw new Error("expected signed");
    expect(await s.txStatus(ORDER_ID, signed.tx.txId)).toMatchObject({ ok: true, tx: { txId: signed.tx.txId, status: "broadcast" } });
    expect(await s.txStatus("99999999-9999-4999-8999-999999999999", "abc")).toMatchObject({ ok: false, code: "ORDER_NOT_FOUND" });
  });

  it("wallet HTTP endpoints require the HMAC signature", async () => {
    const ctx = setup();
    await seed(ctx);
    const app = await buildSignerServer(service(ctx), AUTH_SECRET, false);
    const body = JSON.stringify({ mandateId: MANDATE_ID });
    const headers = { "content-type": "application/json" };
    expect((await app.inject({ method: "POST", url: "/wallets/status", headers, payload: body })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/wallets/status", headers: { ...headers, [SIGNATURE_HEADER]: signBody(body, AUTH_SECRET) }, payload: body });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload)).toMatchObject({ ok: true, funded: true });
  });
});
