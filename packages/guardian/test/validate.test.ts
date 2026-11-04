import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GuardianRequest, MandateSnapshotForGuardian, Order } from "@obscura/contracts";
import { validateOrder } from "../src/validate.js";
import { verifyAuthorizationToken } from "../src/authorizationToken.js";

const SECRET = "test-hmac-secret";
const NOW = "2026-11-04T12:00:00.000Z";

function baseMandate(overrides: Partial<MandateSnapshotForGuardian> = {}): MandateSnapshotForGuardian {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "active",
    allowedCategories: ["esim"],
    allowedMerchants: null,
    allowedProductIds: null,
    totalCapMinor: 3000,
    perOrderCapMinor: 1500,
    spentMinor: 0,
    currency: "USD",
    expiresAt: "2026-11-05T12:00:00.000Z",
    ...overrides,
  };
}

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "22222222-2222-2222-2222-222222222222",
    mandateId: "11111111-1111-1111-1111-111111111111",
    product: {
      merchantProductId: "esim-japan-5gb",
      name: "Japan 5GB eSIM",
      priceMinor: 1200,
      currency: "USD",
      category: "esim",
      merchantId: "bitrefill-esim-jp",
    },
    priceMinor: 1200,
    nonce: "a".repeat(32),
    status: "proposed",
    proposedAt: NOW,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<GuardianRequest> = {}): GuardianRequest {
  return {
    mandate: baseMandate(),
    order: baseOrder(),
    verifiedPriceMinor: 1200,
    nonceAlreadyConsumed: false,
    now: NOW,
    ...overrides,
  };
}

describe("validateOrder - approval path", () => {
  it("approves a valid order and issues a verifiable authorization token", () => {
    const result = validateOrder(baseRequest(), SECRET);
    expect(result.approved).toBe(true);
    if (!result.approved) throw new Error("expected approval");

    const verified = verifyAuthorizationToken(result.authorizationToken, SECRET, Date.parse(NOW));
    expect(verified.valid).toBe(true);
    if (!verified.valid) throw new Error("expected valid token");
    expect(verified.payload.orderId).toBe("22222222-2222-2222-2222-222222222222");
    expect(verified.payload.mandateId).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("validateOrder - rejection codes", () => {
  it("rejects MALFORMED_ORDER when order.mandateId does not match", () => {
    const result = validateOrder(baseRequest({ order: baseOrder({ mandateId: "mismatched" }) }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "MALFORMED_ORDER" });
  });

  it("rejects MALFORMED_ORDER for a too-short nonce", () => {
    const result = validateOrder(baseRequest({ order: baseOrder({ nonce: "short" }) }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "MALFORMED_ORDER" });
  });

  it("rejects MALFORMED_ORDER for a non-positive price", () => {
    const result = validateOrder(baseRequest({ order: baseOrder({ priceMinor: 0 }) }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "MALFORMED_ORDER" });
  });

  it("rejects MANDATE_REVOKED", () => {
    const result = validateOrder(baseRequest({ mandate: baseMandate({ status: "revoked" }) }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "MANDATE_REVOKED" });
  });

  it("rejects MANDATE_PAUSED", () => {
    const result = validateOrder(baseRequest({ mandate: baseMandate({ status: "paused" }) }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "MANDATE_PAUSED" });
  });

  it("rejects MANDATE_EXPIRED when expiresAt is in the past", () => {
    const result = validateOrder(
      baseRequest({ mandate: baseMandate({ expiresAt: "2026-11-03T00:00:00.000Z" }) }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "MANDATE_EXPIRED" });
  });

  it("rejects NONCE_REUSED", () => {
    const result = validateOrder(baseRequest({ nonceAlreadyConsumed: true }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "NONCE_REUSED" });
  });

  it("rejects CATEGORY_NOT_ALLOWED", () => {
    const result = validateOrder(
      baseRequest({ order: baseOrder({ product: { ...baseOrder().product, category: "gift-card" } }) }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "CATEGORY_NOT_ALLOWED" });
  });

  it("rejects MERCHANT_NOT_ALLOWED when an allow-list is set and merchant isn't on it", () => {
    const result = validateOrder(
      baseRequest({ mandate: baseMandate({ allowedMerchants: ["some-other-merchant"] }) }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "MERCHANT_NOT_ALLOWED" });
  });

  it("allows any merchant when allowedMerchants is null", () => {
    const result = validateOrder(baseRequest({ mandate: baseMandate({ allowedMerchants: null }) }), SECRET);
    expect(result.approved).toBe(true);
  });

  it("rejects PRODUCT_NOT_ALLOWED when a product allow-list is set and product isn't on it", () => {
    const result = validateOrder(
      baseRequest({ mandate: baseMandate({ allowedProductIds: ["some-other-product"] }) }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "PRODUCT_NOT_ALLOWED" });
  });

  it("rejects PRICE_MISMATCH when the agent-reported price differs from the freshly verified price", () => {
    const result = validateOrder(baseRequest({ verifiedPriceMinor: 1900 }), SECRET);
    expect(result).toMatchObject({ approved: false, code: "PRICE_MISMATCH" });
  });

  it("rejects PER_ORDER_CAP_EXCEEDED", () => {
    const result = validateOrder(
      baseRequest({
        mandate: baseMandate({ perOrderCapMinor: 1000 }),
        order: baseOrder({ priceMinor: 1200 }),
        verifiedPriceMinor: 1200,
      }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "PER_ORDER_CAP_EXCEEDED" });
  });

  it("allows an unlimited per-order amount when perOrderCapMinor is null", () => {
    const result = validateOrder(
      baseRequest({
        mandate: baseMandate({ perOrderCapMinor: null, totalCapMinor: 5000 }),
        order: baseOrder({ priceMinor: 2000 }),
        verifiedPriceMinor: 2000,
      }),
      SECRET,
    );
    expect(result.approved).toBe(true);
  });

  it("rejects BUDGET_EXCEEDED when spentMinor + priceMinor exceeds totalCapMinor", () => {
    const result = validateOrder(
      baseRequest({
        mandate: baseMandate({ spentMinor: 2000, totalCapMinor: 3000, perOrderCapMinor: null }),
        order: baseOrder({ priceMinor: 1200 }),
        verifiedPriceMinor: 1200,
      }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "BUDGET_EXCEEDED" });
  });
});

describe("validateOrder - deterministic check ordering", () => {
  it("reports MANDATE_REVOKED before NONCE_REUSED when both conditions are true", () => {
    const result = validateOrder(
      baseRequest({ mandate: baseMandate({ status: "revoked" }), nonceAlreadyConsumed: true }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "MANDATE_REVOKED" });
  });

  it("reports CATEGORY_NOT_ALLOWED before PRICE_MISMATCH when both conditions are true", () => {
    const result = validateOrder(
      baseRequest({
        order: baseOrder({ product: { ...baseOrder().product, category: "gift-card" } }),
        verifiedPriceMinor: 99999,
      }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "CATEGORY_NOT_ALLOWED" });
  });

  it("reports PRICE_MISMATCH before PER_ORDER_CAP_EXCEEDED when both conditions are true", () => {
    const result = validateOrder(
      baseRequest({
        mandate: baseMandate({ perOrderCapMinor: 500 }),
        order: baseOrder({ priceMinor: 1200 }),
        verifiedPriceMinor: 1900,
      }),
      SECRET,
    );
    expect(result).toMatchObject({ approved: false, code: "PRICE_MISMATCH" });
  });
});

describe("validateOrder - no I/O, zero network/LLM dependency", () => {
  it("is a pure synchronous function (return value is not a Promise)", () => {
    const result = validateOrder(baseRequest(), SECRET);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe("verifyAuthorizationToken - regression: rejects validly-signed but malformed payloads", () => {
  function signRawPayload(payload: unknown): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payloadB64).digest("hex");
    return `${payloadB64}.${signature}`;
  }

  it("rejects a correctly-signed token whose payload is missing required fields", () => {
    const token = signRawPayload({ orderId: "o1" }); // missing nonce, mandateId, expiresAt
    const result = verifyAuthorizationToken(token, SECRET, Date.parse(NOW));
    expect(result).toMatchObject({ valid: false, reason: "MALFORMED" });
  });

  it("rejects a correctly-signed token whose payload is an array, not an object", () => {
    const token = signRawPayload(["not", "an", "object"]);
    const result = verifyAuthorizationToken(token, SECRET, Date.parse(NOW));
    expect(result).toMatchObject({ valid: false, reason: "MALFORMED" });
  });

  it("rejects a correctly-signed token whose expiresAt is not a finite number", () => {
    const token = signRawPayload({ orderId: "o1", nonce: "n1", mandateId: "m1", expiresAt: "not-a-number" });
    const result = verifyAuthorizationToken(token, SECRET, Date.parse(NOW));
    expect(result).toMatchObject({ valid: false, reason: "MALFORMED" });
  });

  it("still accepts a well-formed payload (no regression on the happy path)", () => {
    const token = signRawPayload({ orderId: "o1", nonce: "n1", mandateId: "m1", expiresAt: Date.parse(NOW) + 1000 });
    const result = verifyAuthorizationToken(token, SECRET, Date.parse(NOW));
    expect(result.valid).toBe(true);
  });
});
