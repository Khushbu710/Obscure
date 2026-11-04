import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueAuthorizationToken } from "@obscura/guardian";
import { openSignerDatabase } from "../src/db/client.js";
import { SignerMandateRepository, SignerOrderRepository } from "../src/repositories.js";
import { SignerService } from "../src/signerService.js";
import { MockBlockchainAdapter, FailingMockBlockchainAdapter, HangingBlockchainAdapter } from "../src/blockchainAdapter.js";

const SECRET = "test-hmac-secret";
const NOW = 1_800_000_000_000; // fixed epoch ms, arbitrary
const DESTINATION = "legitimate-destination";
const AMOUNT_ZATOSHI = 1000;

function freshDb() {
  return openSignerDatabase(":memory:");
}

function seedMandate(db: ReturnType<typeof freshDb>, overrides: Partial<Record<string, unknown>> = {}) {
  const id = overrides.id ?? randomUUID();
  const row = {
    id,
    user_id: "user-1",
    status: "active",
    allowed_categories: "[]",
    allowed_merchants: null,
    allowed_product_ids: null,
    total_cap_minor: 100_00,
    per_order_cap_minor: null,
    spent_minor: 50_00,
    currency: "USD",
    envelope_wallet_ref: null,
    receiving_address: null,
    funded_at: null,
    funding_tx_id: null,
    created_at: new Date(NOW - 1000).toISOString(),
    expires_at: new Date(NOW + 1_000_000).toISOString(),
    revoked_at: null,
    schema_version: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO mandates (id, user_id, status, allowed_categories, allowed_merchants, allowed_product_ids,
      total_cap_minor, per_order_cap_minor, spent_minor, currency, envelope_wallet_ref, receiving_address,
      funded_at, funding_tx_id, created_at, expires_at, revoked_at, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id as string,
    row.user_id as string,
    row.status as string,
    row.allowed_categories as string,
    row.allowed_merchants as string | null,
    row.allowed_product_ids as string | null,
    row.total_cap_minor as number,
    row.per_order_cap_minor as number | null,
    row.spent_minor as number,
    row.currency as string,
    row.envelope_wallet_ref as string | null,
    row.receiving_address as string | null,
    row.funded_at as string | null,
    row.funding_tx_id as string | null,
    row.created_at as string,
    row.expires_at as string,
    row.revoked_at as string | null,
    row.schema_version as number,
  );
  return id as string;
}

function seedOrder(db: ReturnType<typeof freshDb>, mandateId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const orderId = (overrides.order_id as string) ?? randomUUID();
  const nonce = (overrides.nonce as string) ?? randomUUID().repeat(1);
  const row = {
    order_id: orderId,
    mandate_id: mandateId,
    product_json: JSON.stringify({
      merchantProductId: "p1",
      name: "Test eSIM",
      priceMinor: 10_00,
      currency: "USD",
      category: "esim",
      merchantId: "bitrefill",
    }),
    price_minor: 10_00,
    nonce,
    status: "reserved",
    proposed_at: new Date(NOW - 500).toISOString(),
    agent_reasoning: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO orders (order_id, mandate_id, product_json, price_minor, nonce, status, proposed_at, agent_reasoning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.order_id as string,
    row.mandate_id as string,
    row.product_json as string,
    row.price_minor as number,
    row.nonce as string,
    row.status as string,
    row.proposed_at as string,
    row.agent_reasoning as string | null,
  );
  return { orderId, mandateId, nonce, priceMinor: row.price_minor as number };
}

function buildOrder(seeded: ReturnType<typeof seedOrder>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    orderId: seeded.orderId,
    mandateId: seeded.mandateId,
    product: {
      merchantProductId: "p1",
      name: "Test eSIM",
      priceMinor: 10_00,
      currency: "USD",
      category: "esim",
      merchantId: "bitrefill",
    },
    priceMinor: seeded.priceMinor,
    nonce: seeded.nonce,
    status: "reserved",
    proposedAt: new Date(NOW - 500).toISOString(),
    ...overrides,
  } as const;
}

/** A token bound to the standard DESTINATION/AMOUNT_ZATOSHI test fixture, unless overridden. */
function issueBoundToken(
  seeded: ReturnType<typeof seedOrder>,
  opts: { secret?: string; issuedAt?: number; intent?: { destinationAddress: string; amountZatoshi: number } | null } = {},
) {
  return issueAuthorizationToken(
    {
      orderId: seeded.orderId,
      nonce: seeded.nonce,
      mandateId: seeded.mandateId,
      transactionIntent: opts.intent === undefined ? { destinationAddress: DESTINATION, amountZatoshi: AMOUNT_ZATOSHI } : opts.intent,
    },
    opts.secret ?? SECRET,
    opts.issuedAt ?? NOW,
  );
}

function makeService(
  db: ReturnType<typeof freshDb>,
  opts: { secret?: string; adapter?: InstanceType<typeof MockBlockchainAdapter> | InstanceType<typeof FailingMockBlockchainAdapter> | InstanceType<typeof HangingBlockchainAdapter>; adapterTimeoutMs?: number } = {},
) {
  return new SignerService(
    db,
    new SignerMandateRepository(db),
    new SignerOrderRepository(db),
    opts.secret ?? SECRET,
    opts.adapter ?? new MockBlockchainAdapter(),
    () => NOW,
    opts.adapterTimeoutMs ?? 10_000,
  );
}

function standardRequest(token: string, order: ReturnType<typeof buildOrder>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    authorizationToken: token,
    order,
    destinationAddress: DESTINATION,
    amountZatoshi: AMOUNT_ZATOSHI,
    ...overrides,
  } as const;
}

describe("SignerService", () => {
  it("signs a valid, correctly-bound authorization exactly once", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result.signed).toBe(true);
    if (result.signed) {
      expect(result.txProposal.outputs).toEqual([{ address: DESTINATION, amountZatoshi: AMOUNT_ZATOSHI }]);
    }
  });

  it("rejects an expired authorization token", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded, { issuedAt: NOW - 200_000 });
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "TOKEN_EXPIRED" });
  });

  it("rejects a tampered amount (order priceMinor does not match canonical)", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId, { price_minor: 10_00 });
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded, { priceMinor: 1_00 })));

    expect(result).toMatchObject({ signed: false, code: "AMOUNT_MISMATCH" });
  });

  it("rejects a tampered destination on the first and only signing attempt (cryptographically bound, not just sign-once)", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    // Token commits to DESTINATION, but the request claims a different one.
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded), { destinationAddress: "attacker-destination" }));

    expect(result).toMatchObject({ signed: false, code: "DESTINATION_MISMATCH" });

    // The order must remain signable afterward - a rejected tamper attempt
    // must not consume the reservation.
    const row = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(seeded.orderId) as { status: string };
    expect(row.status).toBe("reserved");
  });

  it("rejects a tampered zatoshi amount against the bound transaction intent", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded), { amountZatoshi: 999_999 }));

    expect(result).toMatchObject({ signed: false, code: "AMOUNT_MISMATCH" });
  });

  it("rejects signing when the token carries no bound transaction intent", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded, { intent: null });
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "TRANSACTION_INTENT_NOT_BOUND" });
  });

  it("rejects a request whose order ID does not match the token", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const otherSeeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(otherSeeded)));

    expect(result).toMatchObject({ signed: false, code: "ORDER_MISMATCH" });
  });

  it("rejects a request whose mandate ID does not match the token", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const otherMandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded, { mandateId: otherMandateId })));

    expect(result).toMatchObject({ signed: false, code: "ORDER_MISMATCH" });
  });

  it("rejects a replayed nonce/token after the order has already been signed", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const first = await service.sign(standardRequest(token, buildOrder(seeded)));
    expect(first.signed).toBe(true);

    const replay = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(replay).toMatchObject({ signed: false, code: "NONCE_ALREADY_CONSUMED" });
  });

  it("rejects signing against a revoked mandate", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db, { status: "revoked", revoked_at: new Date(NOW - 10).toISOString() });
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "MANDATE_NOT_ACTIVE" });
  });

  it("rejects signing against a paused mandate", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db, { status: "paused" });
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "MANDATE_NOT_ACTIVE" });
  });

  it("signs exactly one of several concurrent duplicate signing attempts", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db);
    const request = standardRequest(token, buildOrder(seeded));

    const results = await Promise.all([service.sign(request), service.sign(request), service.sign(request), service.sign(request), service.sign(request)]);

    const succeeded = results.filter((r) => r.signed === true);
    const rejectedAsReplay = results.filter((r) => r.signed === false && r.code === "NONCE_ALREADY_CONSUMED");
    expect(succeeded).toHaveLength(1);
    expect(rejectedAsReplay).toHaveLength(4);
  });

  it("fails closed at construction time on a missing HMAC secret", () => {
    const db = freshDb();
    expect(() => makeService(db, { secret: "" })).toThrow();
  });

  it("rejects a token signed with the wrong HMAC secret as invalid", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded, { secret: "a-different-secret" });
    const service = makeService(db);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "INVALID_TOKEN" });
  });

  it("fails closed and releases the reservation when the blockchain adapter definitively fails", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db, { spent_minor: 50_00 });
    const seeded = seedOrder(db, mandateId, { price_minor: 10_00 });
    const token = issueBoundToken(seeded);
    const service = makeService(db, { adapter: new FailingMockBlockchainAdapter("network unreachable") });

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "ADAPTER_ERROR" });
    const mandateRow = db.prepare("SELECT spent_minor FROM mandates WHERE id = ?").get(mandateId) as { spent_minor: number };
    expect(mandateRow.spent_minor).toBe(50_00 - 10_00);
    const orderRow = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(seeded.orderId) as { status: string };
    expect(orderRow.status).toBe("failed");
  });

  it("does NOT release the reservation or mark the order failed on an adapter timeout - outcome is uncertain, not a definite failure", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db, { spent_minor: 50_00 });
    const seeded = seedOrder(db, mandateId, { price_minor: 10_00 });
    const token = issueBoundToken(seeded);
    const service = makeService(db, { adapter: new HangingBlockchainAdapter(), adapterTimeoutMs: 20 });

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "BROADCAST_UNCERTAIN" });
    const mandateRow = db.prepare("SELECT spent_minor FROM mandates WHERE id = ?").get(mandateId) as { spent_minor: number };
    expect(mandateRow.spent_minor).toBe(50_00); // untouched - NOT released
    const orderRow = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(seeded.orderId) as { status: string };
    expect(orderRow.status).toBe("payment_uncertain"); // frozen, not 'failed', not 'reserved'
  });

  it("does not blindly retry / re-sign an order left payment_uncertain after a timeout", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const service = makeService(db, { adapter: new HangingBlockchainAdapter(), adapterTimeoutMs: 20 });

    const first = await service.sign(standardRequest(token, buildOrder(seeded)));
    expect(first).toMatchObject({ signed: false, code: "BROADCAST_UNCERTAIN" });

    // A second attempt (simulating a naive caller retrying) must not be
    // silently re-processed as if it were still `reserved`.
    const second = await service.sign(standardRequest(token, buildOrder(seeded)));
    expect(second).toMatchObject({ signed: false, code: "NONCE_ALREADY_CONSUMED" });
  });

  it("still reports success (funds already moved) if the post-broadcast status write fails, without corrupting order state into a false status", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);
    const orders = new SignerOrderRepository(db);
    const originalSetStatus = orders.setStatus.bind(orders);
    orders.setStatus = (orderId: string, status: string) => {
      if (status === "broadcast") throw new Error("simulated database failure writing final status");
      return originalSetStatus(orderId, status as Parameters<typeof originalSetStatus>[1]);
    };
    const service = new SignerService(db, new SignerMandateRepository(db), orders, SECRET, new MockBlockchainAdapter(), () => NOW, 10_000);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    // Must not report failure - the adapter genuinely succeeded.
    expect(result.signed).toBe(true);
    // The order is left at `authorized` (not falsely advanced to `broadcast`,
    // and not reverted to `reserved` - that would make it signable again).
    const orderRow = db.prepare("SELECT status FROM orders WHERE order_id = ?").get(seeded.orderId) as { status: string };
    expect(orderRow.status).toBe("authorized");
  });

  it("fails closed with INTERNAL_ERROR when a database read throws", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const token = issueBoundToken(seeded);

    const throwingOrders = new SignerOrderRepository(db);
    throwingOrders.getById = () => {
      throw new Error("simulated database failure");
    };
    const service = new SignerService(db, new SignerMandateRepository(db), throwingOrders, SECRET, new MockBlockchainAdapter(), () => NOW, 10_000);

    const result = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(result).toMatchObject({ signed: false, code: "INTERNAL_ERROR" });
    expect(JSON.stringify(result)).not.toMatch(/simulated database failure/);
  });

  it("never includes the HMAC secret or any key-like material in a response, success or failure", async () => {
    const db = freshDb();
    const mandateId = seedMandate(db);
    const seeded = seedOrder(db, mandateId);
    const secret = "super-secret-signing-key-do-not-leak";
    const token = issueBoundToken(seeded, { secret });
    const service = makeService(db, { secret });

    const success = await service.sign(standardRequest(token, buildOrder(seeded)));
    const failure = await service.sign(standardRequest(token, buildOrder(seeded)));

    expect(JSON.stringify(success)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});
