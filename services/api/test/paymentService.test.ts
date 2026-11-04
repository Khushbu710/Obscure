import { beforeEach, describe, expect, it } from "vitest";
import type { Order, ProposedOrder } from "@obscura/contracts";
import { MandateRepository } from "../src/repositories/mandateRepository.js";
import { OrderRepository } from "../src/repositories/orderRepository.js";
import { NonceRepository } from "../src/repositories/nonceRepository.js";
import { PaymentRepository } from "../src/repositories/paymentRepository.js";
import { MandateService } from "../src/mandate/mandateService.js";
import { OrderAuthorizationService } from "../src/mandate/orderAuthorizationService.js";
import { PaymentService, SIMULATED_SETTLEMENT_LABEL, type InvoiceCreator } from "../src/payment/paymentService.js";
import type { SignOutcome, SignerGateway, TxView, WalletOpResult } from "../src/signer/signerClient.js";
import { TransactionIntentBuilder } from "../src/payment/transactionIntent.js";
import { createTestDb } from "./testDb.js";

class FakeSigner implements SignerGateway {
  signCalls = 0;
  lastRequest: { destinationAddress: string; amountZatoshi: number; authorizationToken: string } | null = null;
  signBehavior: "ok" | "reject" | "uncertain" | "internal" | "no-txid" | "throw-unsigned" | "throw-after-sign" = "ok";
  txBehavior: TxView["status"] | "throw" = "broadcast";
  /** Lets "throw-after-sign" simulate the signer having flipped the shared order row before the connection dropped. */
  onSignedThenThrow: () => void = () => {};
  /** Lets "internal" simulate how far the signer got before its internal error. */
  onInternal: () => void = () => {};

  async sign(request: { authorizationToken: string; order: unknown; destinationAddress: string; amountZatoshi: number }): Promise<SignOutcome> {
    this.signCalls++;
    this.lastRequest = { destinationAddress: request.destinationAddress, amountZatoshi: request.amountZatoshi, authorizationToken: request.authorizationToken };
    if (this.signBehavior === "reject") return { signed: false, code: "MANDATE_NOT_ACTIVE", reason: "revoked" };
    if (this.signBehavior === "uncertain") return { signed: false, code: "BROADCAST_UNCERTAIN", reason: "adapter timed out" };
    if (this.signBehavior === "internal") {
      this.onInternal();
      return { signed: false, code: "INTERNAL_ERROR", reason: "internal" };
    }
    if (this.signBehavior === "throw-unsigned") throw new Error("ECONNREFUSED");
    if (this.signBehavior === "throw-after-sign") {
      this.onSignedThenThrow();
      throw new Error("socket hang up");
    }
    const txProposal = { walletRef: "w", outputs: [{ address: request.destinationAddress, amountZatoshi: request.amountZatoshi }], memo: null };
    if (this.signBehavior === "no-txid") return { signed: true, txProposal, signedAt: new Date().toISOString() };
    return { signed: true, txProposal, signedAt: new Date().toISOString(), txId: "tx1" };
  }
  async txStatus(): Promise<WalletOpResult<{ tx: TxView }>> {
    if (this.txBehavior === "throw") throw new Error("signer down");
    return { ok: true, tx: { txId: "tx1", status: this.txBehavior } };
  }
  async createEnvelope(): Promise<never> { throw new Error("unused"); }
  async envelopeStatus(): Promise<never> { throw new Error("unused"); }
  async sweep(): Promise<never> { throw new Error("unused"); }
}

class FakeInvoices implements InvoiceCreator {
  calls = 0;
  fail = false;
  async createInvoiceForOrder() {
    this.calls++;
    if (this.fail) throw new Error("bitrefill down");
    return { id: "inv-1" };
  }
}

const proposed = (mandateId: string): ProposedOrder => ({
  mandateId,
  product: { merchantProductId: "esim-jp", name: "Japan 5GB", priceMinor: 1000, currency: "USD", category: "esim", merchantId: "bitrefill-esim-jp" },
  priceMinor: 1000,
});

describe("PaymentService", () => {
  let db: ReturnType<typeof createTestDb>;
  let orders: OrderRepository;
  let payments: PaymentRepository;
  let mandates: MandateService;
  let auth: OrderAuthorizationService;
  let signer: FakeSigner;
  let invoices: FakeInvoices;
  let svc: PaymentService;
  let intents: TransactionIntentBuilder;
  let mandateId: string;
  let order: Order;
  let token: string;
  let clock: Date;

  const spent = () => mandates.get(mandateId).spentMinor;

  beforeEach(() => {
    db = createTestDb();
    const mandateRepo = new MandateRepository(db);
    orders = new OrderRepository(db);
    payments = new PaymentRepository(db);
    mandates = new MandateService(mandateRepo);
    intents = new TransactionIntentBuilder({ destinationAddress: "utest1settlement", zatoshiPerMinor: 10_000 });
    auth = new OrderAuthorizationService(db, mandateRepo, orders, new NonceRepository(db), "secret", undefined, (p) => intents.forPriceMinor(p.priceMinor));
    signer = new FakeSigner();
    invoices = new FakeInvoices();
    clock = new Date();
    svc = new PaymentService(orders, payments, auth, invoices, signer, intents, { now: () => clock, confirmationTimeoutMs: 60_000 });
    mandateId = mandates.create("u", { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 }).id;
    const r = auth.authorize(proposed(mandateId), 1000);
    if (!r.guardian.approved) throw new Error("setup: expected approval");
    order = r.order;
    token = r.guardian.authorizationToken;
  });

  it("happy path: invoice -> signer -> broadcast -> confirmed -> simulated delivery, budget stays spent", async () => {
    expect(await svc.execute(order, token)).toEqual({ kind: "submitted", txId: "tx1" });
    expect(invoices.calls).toBe(1);
    expect(payments.getByOrderId(order.orderId)).toMatchObject({ status: "broadcast", txId: "tx1", merchantInvoiceRef: "inv-1", settlementMode: "simulated" });

    signer.txBehavior = "confirmed";
    const view = await svc.refresh(order.orderId);
    expect(view).toMatchObject({ status: "delivered", settlementMode: "simulated" });
    expect(view?.simulatedDelivery).toEqual({ simulated: true, label: SIMULATED_SETTLEMENT_LABEL });
    expect(spent()).toBe(1000);
  });

  it("never labels anything as delivered before confirmation, and never omits the simulated label after", async () => {
    await svc.execute(order, token);
    expect((await svc.refresh(order.orderId))?.simulatedDelivery).toBeNull();
    signer.txBehavior = "mined";
    const mined = await svc.refresh(order.orderId);
    expect(mined).toMatchObject({ status: "mined", simulatedDelivery: null });
  });

  it("invoice failure releases the reservation and never reaches the signer", async () => {
    invoices.fail = true;
    expect(await svc.execute(order, token)).toEqual({ kind: "invoice_failed" });
    expect(signer.signCalls).toBe(0);
    expect(orders.getById(order.orderId)?.status).toBe("failed");
    expect(spent()).toBe(0);
  });

  it("signer rejection releases the reservation", async () => {
    signer.signBehavior = "reject";
    expect(await svc.execute(order, token)).toMatchObject({ kind: "signer_rejected", code: "MANDATE_NOT_ACTIVE" });
    expect(orders.getById(order.orderId)?.status).toBe("failed");
    expect(spent()).toBe(0);
  });

  it("signer unreachable BEFORE signing releases the reservation", async () => {
    signer.signBehavior = "throw-unsigned";
    expect(await svc.execute(order, token)).toEqual({ kind: "signer_unavailable" });
    expect(spent()).toBe(0);
  });

  it("signer connection lost AFTER signing is held as payment_uncertain: budget kept, no release, no retry", async () => {
    signer.signBehavior = "throw-after-sign";
    signer.onSignedThenThrow = () => orders.setStatus(order.orderId, "broadcast");
    expect(await svc.execute(order, token)).toEqual({ kind: "payment_uncertain" });
    expect(orders.getById(order.orderId)?.status).toBe("payment_uncertain");
    expect(spent()).toBe(1000);
    // A second attempt must not re-sign or re-invoice.
    expect(await svc.execute(order, token)).toMatchObject({ kind: "not_reserved" });
    expect(signer.signCalls).toBe(1);
    expect(invoices.calls).toBe(1);
  });

  it("is idempotent: a repeated or concurrent execute creates one invoice and one payment", async () => {
    const results = await Promise.all([svc.execute(order, token), svc.execute(order, token)]);
    expect(results.filter((r) => r.kind === "submitted")).toHaveLength(1);
    expect(invoices.calls).toBe(1);
    expect(signer.signCalls).toBe(1);
    expect(await svc.execute(order, token)).toMatchObject({ kind: expect.stringMatching(/already_started|not_reserved/) });
  });

  it("refuses to pay an order that is not reserved (e.g. guardian-rejected)", async () => {
    const rejected = auth.authorize(proposed(mandateId), 1); // price mismatch -> rejected
    expect(rejected.order.status).toBe("rejected");
    expect(await svc.execute(rejected.order, "whatever")).toMatchObject({ kind: "not_reserved", status: "rejected" });
    expect(invoices.calls).toBe(0);
    expect(signer.signCalls).toBe(0);
  });

  it("a definitively failed transaction releases the reservation", async () => {
    await svc.execute(order, token);
    signer.txBehavior = "failed";
    await svc.refresh(order.orderId);
    expect(orders.getById(order.orderId)?.status).toBe("failed");
    expect(spent()).toBe(0);
  });

  it("a transient signer error during refresh changes nothing", async () => {
    await svc.execute(order, token);
    signer.txBehavior = "throw";
    expect((await svc.refresh(order.orderId))?.status).toBe("broadcast");
    expect(spent()).toBe(1000);
  });

  it("a payment stuck past the timeout is held as payment_uncertain, not released", async () => {
    await svc.execute(order, token);
    clock = new Date(Date.now() + 5 * 60_000);
    expect((await svc.refresh(order.orderId))?.status).toBe("payment_uncertain");
    expect(spent()).toBe(1000);
  });
  it("sends the signer the trusted intent (configured address x fixed rate), identical to the one bound into the token", async () => {
    await svc.execute(order, token);
    expect(signer.lastRequest).toMatchObject({ destinationAddress: "utest1settlement", amountZatoshi: 1000 * 10_000 });
    const payload = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    expect(payload.transactionIntent).toEqual({ destinationAddress: "utest1settlement", amountZatoshi: 10_000_000 });
    expect(payments.getByOrderId(order.orderId)?.amountZatoshi).toBe(10_000_000);
  });

  it("BROADCAST_UNCERTAIN from the signer is held: budget kept, not released, never retried", async () => {
    signer.signBehavior = "uncertain";
    expect(await svc.execute(order, token)).toEqual({ kind: "payment_uncertain" });
    expect(orders.getById(order.orderId)?.status).toBe("payment_uncertain");
    expect(payments.getByOrderId(order.orderId)?.status).toBe("payment_uncertain");
    expect(spent()).toBe(1000);
    expect(await svc.execute(order, token)).toMatchObject({ kind: "not_reserved" });
    expect(signer.signCalls).toBe(1);
  });

  it("INTERNAL_ERROR before the signer touched the order releases; after it advanced, holds as uncertain", async () => {
    signer.signBehavior = "internal"; // order still 'reserved': nothing happened
    expect(await svc.execute(order, token)).toMatchObject({ kind: "signer_rejected", code: "INTERNAL_ERROR" });
    expect(spent()).toBe(0);

    // A second order where the signer had already moved it to 'authorized' before failing.
    const r2 = auth.authorize(proposed(mandateId), 1000);
    if (!r2.guardian.approved) throw new Error("setup");
    signer.onInternal = () => orders.setStatus(r2.order.orderId, "authorized");
    expect(await svc.execute(r2.order, r2.guardian.authorizationToken)).toEqual({ kind: "payment_uncertain" });
    expect(spent()).toBe(1000);
  });

  it("a signed result with no txid cannot be tracked, so it is held as payment_uncertain", async () => {
    signer.signBehavior = "no-txid";
    expect(await svc.execute(order, token)).toEqual({ kind: "payment_uncertain" });
    expect(spent()).toBe(1000);
  });

  it("an order whose price cannot form a valid intent is never sent to the signer", async () => {
    const zeroRate = { forPriceMinor: () => null } as unknown as TransactionIntentBuilder;
    const guarded = new PaymentService(orders, payments, auth, invoices, signer, zeroRate, { now: () => clock });
    expect(await guarded.execute(order, token)).toMatchObject({ kind: "signer_rejected", code: "NO_TRANSACTION_INTENT" });
    expect(signer.signCalls).toBe(0);
    expect(spent()).toBe(0);
  });
});
