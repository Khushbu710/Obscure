import { describe, expect, it, vi } from "vitest";
import { BitrefillApiError, BitrefillClient, BitrefillResponseShapeError } from "../src/client.js";
import {
  DOC_EXAMPLE_ERROR_RESPONSE,
  DOC_EXAMPLE_ESIM_INVOICE_RESPONSE,
  DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE,
  DOC_EXAMPLE_ESIM_PRODUCT_LIST_RESPONSE,
} from "./fixtures.js";

const API_KEY = "test-api-key-should-never-appear-in-errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL, init: RequestInit = {}) => handler(String(url), init)) as unknown as typeof fetch;
}

describe("BitrefillClient - construction", () => {
  it("throws if constructed without an API key", () => {
    expect(() => new BitrefillClient({ apiKey: "" })).toThrow();
  });
});

describe("BitrefillClient - request shape and auth header", () => {
  it("sends the Authorization: Bearer header and uses the documented base URL by default", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedHeaders = (init.headers as Record<string, string>) ?? {};
      return jsonResponse({ data: { message: "pong" } });
    });

    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    await client.ping();

    expect(capturedUrl).toBe("https://api.bitrefill.com/v2/ping");
    expect(capturedHeaders.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });
});

describe("BitrefillClient - product search / detail", () => {
  it("parses a successful search response into raw products", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(DOC_EXAMPLE_ESIM_PRODUCT_LIST_RESPONSE));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    const products = await client.searchEsimProducts("japan");
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("bitrefill-esim-japan");
  });

  it("includes q and type=esim query params on search", async () => {
    let capturedUrl = "";
    const fetchImpl = fakeFetch((url) => {
      capturedUrl = url;
      return jsonResponse(DOC_EXAMPLE_ESIM_PRODUCT_LIST_RESPONSE);
    });
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    await client.searchEsimProducts("japan", { country: "JP", limit: 10 });
    expect(capturedUrl).toContain("q=japan");
    expect(capturedUrl).toContain("type=esim");
    expect(capturedUrl).toContain("country=JP");
    expect(capturedUrl).toContain("limit=10");
  });

  it("parses a successful product-detail response", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(DOC_EXAMPLE_ESIM_PRODUCT_DETAIL_RESPONSE));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    const product = await client.getEsimProductDetails("test-gift-card-link");
    expect(product.id).toBe("test-gift-card-link");
    expect(product.currency).toBe("USD");
  });

  it("throws BitrefillResponseShapeError when the response doesn't match the expected schema", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ data: { totally: "wrong shape" } }));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    await expect(client.getEsimProductDetails("whatever")).rejects.toThrow(BitrefillResponseShapeError);
  });
});

describe("BitrefillClient - invoice creation (backend-only)", () => {
  it("sends the documented request body shape to POST /esims", async () => {
    let capturedBody: unknown;
    let capturedUrl = "";
    const fetchImpl = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return jsonResponse(DOC_EXAMPLE_ESIM_INVOICE_RESPONSE);
    });
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });

    const invoice = await client.createEsimInvoice({
      productId: "test-esim",
      value: "1GB, 7 Days",
      paymentMethod: "balance",
    });

    expect(capturedUrl).toBe("https://api.bitrefill.com/v2/esims");
    expect(capturedBody).toEqual({
      products: [{ product_id: "test-esim", value: "1GB, 7 Days", quantity: 1 }],
      payment_method: "balance",
      auto_pay: false,
    });
    expect(invoice.payment.status).toBe("unpaid");
    expect(invoice.payment.price).toBe(10);
  });
});

describe("BitrefillClient - error handling", () => {
  it("parses a documented error response into a BitrefillApiError with code and message", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(DOC_EXAMPLE_ERROR_RESPONSE, 400));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });

    await expect(client.getEsimProductDetails("x")).rejects.toMatchObject({
      errorCode: "missing_param",
      httpStatus: 400,
    });
  });

  it("never includes the API key in a thrown error's message", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(DOC_EXAMPLE_ERROR_RESPONSE, 401));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });

    try {
      await client.getEsimProductDetails("x");
      expect.fail("expected a rejection");
    } catch (err) {
      expect(String(err)).not.toContain(API_KEY);
      expect(JSON.stringify(err instanceof Error ? err.message : err)).not.toContain(API_KEY);
    }
  });

  it("wraps a non-JSON error response without throwing an unhandled parse error", async () => {
    const fetchImpl = fakeFetch(() => new Response("<html>not json</html>", { status: 500 }));
    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl });
    await expect(client.getEsimProductDetails("x")).rejects.toThrow(BitrefillApiError);
  });

  it("times out and raises BitrefillApiError rather than hanging forever", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;

    const client = new BitrefillClient({ apiKey: API_KEY, fetchImpl, timeoutMs: 20 });
    await expect(client.getEsimProductDetails("x")).rejects.toMatchObject({ errorCode: "TIMEOUT" });
  });
});
