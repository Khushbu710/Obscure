import { describe, expect, it, vi } from "vitest";
import { BitrefillClient } from "@obscura/bitrefill-client";
import { buildServer } from "../../src/http/server.js";
import { SIMULATED_SETTLEMENT_LABEL } from "../../src/payment/paymentService.js";
import { TransactionIntentBuilder } from "../../src/payment/transactionIntent.js";
import type { SignOutcome, SignerGateway, TxView, WalletOpResult } from "../../src/signer/signerClient.js";
import { createTestDb } from "../testDb.js";
import { FakeLlmDriver, toolUseStep } from "../agent/fakeDriver.js";

const JAPAN_FIXTURE = {
  data: {
    id: "bitrefill-esim-japan",
    name: "Japan eSIM",
    currency: "USD",
    packages: [{ package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 }],
  },
};

const fixtureFetch = vi.fn(async () => new Response(JSON.stringify(JAPAN_FIXTURE), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

class FakeSigner implements SignerGateway {
  signed: unknown[] = [];
  tx: TxView["status"] = "broadcast";
  async sign(req: { authorizationToken: string; order: unknown; destinationAddress: string; amountZatoshi: number }): Promise<SignOutcome> {
    this.signed.push(req);
    return {
      signed: true,
      txProposal: { walletRef: "w", outputs: [{ address: req.destinationAddress, amountZatoshi: req.amountZatoshi }], memo: null },
      signedAt: new Date().toISOString(),
      txId: "tx-e2e",
    };
  }
  async txStatus(): Promise<WalletOpResult<{ tx: TxView }>> {
    return { ok: true, tx: { txId: "tx-e2e", status: this.tx } };
  }
  async createEnvelope(): Promise<never> { throw new Error("unused"); }
  async envelopeStatus(): Promise<never> { throw new Error("unused"); }
  async sweep(): Promise<never> { throw new Error("unused"); }
}

describe("prompt -> authorization -> payment -> simulated delivery (HTTP)", () => {
  it("runs the whole post-authorization pipeline and never exposes the nonce or token", async () => {
    const signer = new FakeSigner();
    const app = await buildServer(createTestDb(), {
      guardianHmacSecret: "s",
      agentDriver: new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::5GB, 30 Days" })]),
      bitrefillClient: new BitrefillClient({ apiKey: "k", fetchImpl: fixtureFetch }),
      invoiceCreator: { createInvoiceForOrder: async () => ({ id: "inv-e2e" }) },
      signerGateway: signer,
      intentBuilder: new TransactionIntentBuilder({ destinationAddress: "utest1settlement", zatoshiPerMinor: 10_000 }),
    });

    const m = JSON.parse(
      (await app.inject({ method: "POST", url: "/api/mandates", payload: { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 } })).payload,
    );
    const res = await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: m.id, prompt: "japan esim" } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("authorized");
    expect(res.payload).not.toContain("nonce");
    expect(res.payload).not.toContain("authorizationToken");

    await app.payments!.idle();
    expect(signer.signed).toHaveLength(1);
    // The signer is asked to pay the trusted, configured intent: price (1250 cents) x the fixed demo rate.
    expect(signer.signed[0]).toMatchObject({ destinationAddress: "utest1settlement", amountZatoshi: 12_500_000 });

    // Broadcast, not yet confirmed: no delivery claim.
    let got = JSON.parse((await app.inject({ method: "GET", url: `/api/orders/${body.order.orderId}` })).payload);
    expect(got.order.status).toBe("broadcast");
    expect(got.payment).toMatchObject({ txId: "tx-e2e", merchantInvoiceRef: "inv-e2e", settlementMode: "simulated", simulatedDelivery: null });
    expect(JSON.stringify(got)).not.toContain("nonce");

    // Confirmed: simulated delivery, explicitly labelled.
    signer.tx = "confirmed";
    got = JSON.parse((await app.inject({ method: "GET", url: `/api/orders/${body.order.orderId}` })).payload);
    expect(got.order.status).toBe("delivered");
    expect(got.payment.simulatedDelivery).toEqual({ simulated: true, label: SIMULATED_SETTLEMENT_LABEL });

    // Budget stays spent after a confirmed payment.
    const after = JSON.parse((await app.inject({ method: "GET", url: `/api/mandates/${m.id}` })).payload);
    expect(after.spentMinor).toBe(1250);
  });

  it("404s an unknown order", async () => {
    const app = await buildServer(createTestDb(), { guardianHmacSecret: "s" });
    expect((await app.inject({ method: "GET", url: "/api/orders/99999999-9999-4999-8999-999999999999" })).statusCode).toBe(404);
  });
});
