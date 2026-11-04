import { describe, expect, it } from "vitest";
import { BitrefillClient } from "@obscura/bitrefill-client";
import type { ReceiptPayload } from "@obscura/contracts";
import { buildServer } from "../src/http/server.js";
import {
  ReceiptKeyring,
  computeCommitment,
  decryptPayload,
  encryptPayload,
  publicKeyFromBase64,
  verifyDisclosure,
} from "../src/receipts/receiptCrypto.js";
import type { SignOutcome, SignerGateway, TxView, WalletOpResult } from "../src/signer/signerClient.js";
import { createTestDb } from "./testDb.js";
import { FakeLlmDriver, toolUseStep } from "./agent/fakeDriver.js";

const payload: ReceiptPayload = {
  orderId: "22222222-2222-4222-8222-222222222222",
  priceMinor: 1250,
  currency: "USD",
  merchantId: "bitrefill-esim-japan",
  timestamp: "2026-11-04T12:00:00.000Z",
  settlementMode: "simulated",
  salt: "ab".repeat(16),
};

describe("receipt crypto", () => {
  it("commitment is deterministic and changes if ANY committed field changes", () => {
    const base = computeCommitment(payload);
    expect(computeCommitment({ ...payload })).toBe(base);
    for (const change of [
      { orderId: "33333333-3333-4333-8333-333333333333" },
      { priceMinor: 1251 },
      { merchantId: "other" },
      { timestamp: "2026-11-04T12:00:01.000Z" },
      { salt: "cd".repeat(16) },
      { settlementMode: "real" as const },
    ]) {
      expect(computeCommitment({ ...payload, ...change })).not.toBe(base);
    }
  });

  it("length-prefixing stops field boundaries from being shifted to collide", () => {
    const a = computeCommitment({ ...payload, merchantId: "ab", salt: "c" });
    const b = computeCommitment({ ...payload, merchantId: "a", salt: "bc" });
    expect(a).not.toBe(b);
  });

  it("encrypts and decrypts, and tampering with the ciphertext is detected", () => {
    const key = ReceiptKeyring.ephemeral().encryptionKey;
    const enc = encryptPayload(payload, key);
    expect(decryptPayload(enc, key)).toEqual(payload);
    expect(enc).not.toContain("bitrefill-esim-japan");
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptPayload(raw.toString("base64"), key)).toThrow();
    expect(() => decryptPayload(enc, ReceiptKeyring.ephemeral().encryptionKey)).toThrow(); // wrong key
  });
});

class FakeSigner implements SignerGateway {
  async sign(): Promise<SignOutcome> {
    return { signed: true, walletRef: "w", amountZatoshi: 1, signedAt: new Date().toISOString(), tx: { txId: "tx", status: "broadcast" } };
  }
  async txStatus(): Promise<WalletOpResult<{ tx: TxView }>> {
    return { ok: true, tx: { txId: "tx", status: "confirmed" } };
  }
  async createEnvelope(): Promise<never> { throw new Error("unused"); }
  async envelopeStatus(): Promise<never> { throw new Error("unused"); }
  async sweep(): Promise<never> { throw new Error("unused"); }
}

const FIXTURE = { data: { id: "bitrefill-esim-japan", name: "Japan eSIM", currency: "USD", packages: [{ package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 }] } };

async function deliveredOrder() {
  const keyring = ReceiptKeyring.ephemeral();
  const app = await buildServer(createTestDb(), {
    guardianHmacSecret: "s",
    receiptKeyring: keyring,
    agentDriver: new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::5GB, 30 Days" })]),
    bitrefillClient: new BitrefillClient({ apiKey: "k", fetchImpl: (async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as unknown as typeof fetch }),
    invoiceCreator: { createInvoiceForOrder: async () => ({ id: "inv" }) },
    signerGateway: new FakeSigner(),
  });
  const m = JSON.parse((await app.inject({ method: "POST", url: "/api/mandates", payload: { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 } })).payload);
  const r = JSON.parse((await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: m.id, prompt: "x" } })).payload);
  await app.payments!.idle();
  return { app, orderId: r.order.orderId as string, publicKeyB64: keyring.publicKeyBase64() };
}

describe("receipts over HTTP", () => {
  it("creates exactly one receipt when an order is delivered, and none before", async () => {
    const { app, orderId } = await deliveredOrder();
    expect(JSON.parse((await app.inject({ method: "GET", url: "/api/receipts" })).payload)).toHaveLength(0); // broadcast, not delivered
    await app.inject({ method: "GET", url: `/api/orders/${orderId}` }); // confirmed -> delivered
    await app.inject({ method: "GET", url: `/api/orders/${orderId}` }); // repeated poll
    const list = JSON.parse((await app.inject({ method: "GET", url: "/api/receipts" })).payload);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["commitment", "createdAt", "orderId", "receiptId"]); // metadata only
  });

  it("detail is decrypted and records the settlement mode as simulated", async () => {
    const { app, orderId } = await deliveredOrder();
    await app.inject({ method: "GET", url: `/api/orders/${orderId}` });
    const [meta] = JSON.parse((await app.inject({ method: "GET", url: "/api/receipts" })).payload);
    const detail = JSON.parse((await app.inject({ method: "GET", url: `/api/receipts/${meta.receiptId}` })).payload);
    expect(detail.payload).toMatchObject({ orderId, priceMinor: 1250, currency: "USD", settlementMode: "simulated" });
    expect(detail.signatureValid).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("encryptedPayload");
  });

  it("a disclosure verifies independently with only the public key, and any tampering fails", async () => {
    const { app, orderId, publicKeyB64 } = await deliveredOrder();
    await app.inject({ method: "GET", url: `/api/orders/${orderId}` });
    const [meta] = JSON.parse((await app.inject({ method: "GET", url: "/api/receipts" })).payload);
    const disclosure = JSON.parse((await app.inject({ method: "POST", url: `/api/receipts/${meta.receiptId}/disclose` })).payload);

    const pub = publicKeyFromBase64(JSON.parse((await app.inject({ method: "GET", url: "/api/receipts/public-key" })).payload).publicKey);
    expect(pub.export({ format: "der", type: "spki" }).toString("base64")).toBe(publicKeyB64);
    expect(verifyDisclosure(disclosure, pub)).toEqual({ valid: true });

    // Claim a cheaper price: commitment no longer matches.
    const cheaper = { ...disclosure, disclosedFields: { ...disclosure.disclosedFields, priceMinor: 1 } };
    expect(verifyDisclosure(cheaper, pub)).toEqual({ valid: false, reason: "COMMITMENT_MISMATCH" });

    // Claim "real" settlement: also fails - the settlement mode is inside the commitment.
    const realClaim = { ...disclosure, disclosedFields: { ...disclosure.disclosedFields, settlementMode: "real" } };
    expect(verifyDisclosure(realClaim, pub).valid).toBe(false);

    // A re-signed forgery by a different key fails the signature check.
    const other = ReceiptKeyring.ephemeral();
    expect(verifyDisclosure(disclosure, other.publicKey)).toEqual({ valid: false, reason: "BAD_SIGNATURE" });
  });

  it("404s an unknown receipt", async () => {
    const { app } = await deliveredOrder();
    expect((await app.inject({ method: "GET", url: "/api/receipts/99999999-9999-4999-8999-999999999999" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/receipts/99999999-9999-4999-8999-999999999999/disclose" })).statusCode).toBe(404);
  });
});
