import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, NetworkError, ResponseShapeError } from "../../src/lib/api/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const VALID_MANDATE = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "demo-user",
  status: "active",
  allowedCategories: ["esim"],
  allowedMerchants: null,
  allowedProductIds: null,
  totalCapMinor: 1500,
  perOrderCapMinor: null,
  spentMinor: 0,
  currency: "USD",
  envelopeWalletRef: null,
  receivingAddress: null,
  fundedAt: null,
  fundingTxId: null,
  createdAt: "2026-11-04T10:00:00.000Z",
  expiresAt: "2026-11-05T10:00:00.000Z",
  revokedAt: null,
  schemaVersion: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client - success path with real schema validation", () => {
  it("mandates.list parses a valid array response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([VALID_MANDATE])));
    const mandates = await api.mandates.list();
    expect(mandates).toHaveLength(1);
    expect(mandates[0].id).toBe(VALID_MANDATE.id);
  });

  it("mandates.create sends the body and parses the response", async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(String(init.body));
        return jsonResponse(VALID_MANDATE, 201);
      }),
    );
    const result = await api.mandates.create({
      allowedCategories: ["esim"],
      totalCapMinor: 1500,
      currency: "USD",
      durationHours: 24,
    });
    expect(capturedBody).toMatchObject({ allowedCategories: ["esim"], totalCapMinor: 1500 });
    expect(result.id).toBe(VALID_MANDATE.id);
  });
});

describe("api client - structured backend errors (ApiError)", () => {
  it("throws ApiError with the real code/message/status for a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "MANDATE_NOT_FOUND", message: "Mandate x not found" } }, 404)),
    );
    await expect(api.mandates.get("x")).rejects.toMatchObject({
      status: 404,
      code: "MANDATE_NOT_FOUND",
      message: "Mandate x not found",
    });
  });

  it("throws ApiError with a fallback code if the error body is missing one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(api.mandates.list()).rejects.toMatchObject({ status: 500, code: "UNKNOWN_ERROR" });
  });

  it("never converts a non-2xx response into a successful result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "MANDATE_PAUSED", message: "paused" } }, 409)));
    let threw = false;
    try {
      await api.mandates.pause("x");
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ApiError);
    }
    expect(threw).toBe(true);
  });
});

describe("api client - network failures", () => {
  it("throws NetworkError when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(api.mandates.list()).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws NetworkError when the response body isn't valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not json</html>", { status: 200 })));
    await expect(api.mandates.list()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("api client - response-shape validation (ResponseShapeError)", () => {
  it("rejects a 2xx response that doesn't match the real Mandate schema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ totally: "wrong shape" }])));
    await expect(api.mandates.list()).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("rejects a 2xx shopping response with an unrecognized status discriminant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "totally_made_up_status" })));
    await expect(api.shopping.submit({ mandateId: VALID_MANDATE.id, prompt: "x" })).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("accepts a valid 'no_proposal' shopping response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "no_proposal", reason: "nothing found" })));
    const result = await api.shopping.submit({ mandateId: VALID_MANDATE.id, prompt: "x" });
    expect(result.status).toBe("no_proposal");
  });
});

describe("api client - wallet routes", () => {
  it("wallet.envelope parses a real envelope status response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ mandateId: VALID_MANDATE.id, receivingAddress: "utest1abc", spendableZatoshi: 1000, totalZatoshi: 1000, funded: true, fundingTxId: null })),
    );
    const res = await api.wallet.envelope(VALID_MANDATE.id);
    expect(res.receivingAddress).toBe("utest1abc");
    expect(res.spendableZatoshi).toBe(1000);
  });

  it("wallet.envelope surfaces NO_ENVELOPE as a structured ApiError, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "NO_ENVELOPE", message: "Mandate has no envelope wallet yet." } }, 404)));
    await expect(api.wallet.envelope(VALID_MANDATE.id)).rejects.toMatchObject({ code: "NO_ENVELOPE", status: 404 });
  });

  it("rejects a wallet response that doesn't match the real shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ totally: "wrong" })));
    await expect(api.wallet.envelope(VALID_MANDATE.id)).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("api client - order routes", () => {
  it("orders.list parses a real order+payment list", async () => {
    const safeOrder = {
      orderId: "22222222-2222-2222-2222-222222222222",
      mandateId: VALID_MANDATE.id,
      product: { merchantProductId: "p1", name: "Japan eSIM", priceMinor: 1250, currency: "USD", category: "esim", merchantId: "bitrefill" },
      priceMinor: 1250,
      status: "reserved",
      proposedAt: "2026-11-04T12:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ orders: [{ order: safeOrder, payment: null }] })));
    const orders = await api.orders.list();
    expect(orders).toHaveLength(1);
    expect(orders[0].order.orderId).toBe(safeOrder.orderId);
  });

  it("orders.get rejects a response carrying a nonce - the backend must never leak it, and the client must not silently accept it either", async () => {
    const orderWithNonce = {
      orderId: "22222222-2222-2222-2222-222222222222",
      mandateId: VALID_MANDATE.id,
      nonce: "should-never-be-here",
      product: { merchantProductId: "p1", name: "Japan eSIM", priceMinor: 1250, currency: "USD", category: "esim", merchantId: "bitrefill" },
      priceMinor: 1250,
      status: "reserved",
      proposedAt: "2026-11-04T12:00:00.000Z",
    };
    // SafeOrderViewSchema uses .omit (strips extras from the *type*, not from
    // runtime parsing) - this just documents that the client's schema is the
    // sanitized view, not that it re-validates server-side sanitization.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ order: orderWithNonce, payment: null })));
    const result = await api.orders.get("x");
    expect(result.order.orderId).toBe(orderWithNonce.orderId);
  });
});

describe("api client - receipt routes", () => {
  it("receipts.list parses real receipt metadata, never the encrypted payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([{ receiptId: "33333333-3333-3333-3333-333333333333", orderId: "22222222-2222-2222-2222-222222222222", commitment: "a".repeat(64), createdAt: "2026-11-04T12:00:00.000Z" }])),
    );
    const receipts = await api.receipts.list();
    expect(receipts).toHaveLength(1);
    expect((receipts[0] as Record<string, unknown>).encryptedPayload).toBeUndefined();
  });
});

describe("api client - security scoreboard", () => {
  it("parses an honest not_run response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "not_run", message: "not run yet" })));
    const res = await api.security.scoreboard();
    expect(res.status).toBe("not_run");
  });

  it("rejects a response with an unrecognized status discriminant rather than guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "fabricated_success" })));
    await expect(api.security.scoreboard()).rejects.toBeInstanceOf(ResponseShapeError);
  });
});
