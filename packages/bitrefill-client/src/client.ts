import { z } from "zod";
import {
  BitrefillErrorResponseSchema,
  BitrefillInvoiceResponseSchema,
  BitrefillProductDetailResponseSchema,
  BitrefillProductListResponseSchema,
  type BitrefillInvoiceRaw,
  type BitrefillProductRaw,
} from "./types.js";

export const BITREFILL_API_BASE_URL = "https://api.bitrefill.com/v2";
const DEFAULT_TIMEOUT_MS = 10_000;

export class BitrefillApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly errorCode: string | null,
  ) {
    super(message);
    this.name = "BitrefillApiError";
  }
}

export class BitrefillResponseShapeError extends Error {
  constructor(endpoint: string, details: string) {
    super(`Bitrefill response from ${endpoint} did not match the expected shape: ${details}`);
    this.name = "BitrefillResponseShapeError";
  }
}

export interface BitrefillClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests - never used to change production behavior. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin, validated wrapper over the real Bitrefill Personal API
 * (https://docs.bitrefill.com). Every response is parsed with a Zod schema
 * before use - an unexpected shape becomes a BitrefillResponseShapeError,
 * never a silent pass-through of untyped data.
 *
 * SECURITY BOUNDARY: this class exposes invoice creation
 * (`createEsimInvoice`). Do NOT hand an instance of this class to the AI
 * agent - give it a `ProductDiscoveryService` instead (see
 * services/api/src/bitrefill/productDiscoveryService.ts), which only wraps
 * the read-only search/detail methods.
 */
export class BitrefillClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BitrefillClientOptions) {
    if (!options.apiKey) {
      throw new Error("BitrefillClient requires a non-empty apiKey");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? BITREFILL_API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ping(): Promise<{ message: string }> {
    const data = await this.request("GET", "/ping");
    const parsed = z.object({ data: z.object({ message: z.string() }) }).safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError("/ping", parsed.error.message);
    }
    return parsed.data.data;
  }

  /** GET /products/search?q=... - https://docs.bitrefill.com/docs/searching-products */
  async searchEsimProducts(query: string, opts: { country?: string; limit?: number } = {}): Promise<BitrefillProductRaw[]> {
    const params = new URLSearchParams({ q: query, type: "esim" });
    if (opts.country) params.set("country", opts.country);
    if (opts.limit) params.set("limit", String(opts.limit));

    const data = await this.request("GET", `/products/search?${params.toString()}`);
    const parsed = BitrefillProductListResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError("/products/search", parsed.error.message);
    }
    return parsed.data.data;
  }

  /** GET /products/esims - https://docs.bitrefill.com/docs/esims */
  async listEsimProducts(opts: { country?: string; limit?: number } = {}): Promise<BitrefillProductRaw[]> {
    const params = new URLSearchParams();
    if (opts.country) params.set("country", opts.country);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();

    const data = await this.request("GET", `/products/esims${qs ? `?${qs}` : ""}`);
    const parsed = BitrefillProductListResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError("/products/esims", parsed.error.message);
    }
    return parsed.data.data;
  }

  /** GET /products/esims/{id} - https://docs.bitrefill.com/reference/get_products-esims-id.md */
  async getEsimProductDetails(productId: string): Promise<BitrefillProductRaw> {
    const data = await this.request("GET", `/products/esims/${encodeURIComponent(productId)}`);
    const parsed = BitrefillProductDetailResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError(`/products/esims/${productId}`, parsed.error.message);
    }
    return parsed.data.data;
  }

  /**
   * GET /invoices/{id} - https://docs.bitrefill.com/reference/get_invoices-id.md
   * Used for reconciliation (see security-architecture.md / bitrefill-integration.md §4):
   * poll this instead of creating a new invoice when payment status is uncertain.
   */
  async getInvoiceById(invoiceId: string): Promise<BitrefillInvoiceRaw> {
    const data = await this.request("GET", `/invoices/${encodeURIComponent(invoiceId)}`);
    const parsed = BitrefillInvoiceResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError(`/invoices/${invoiceId}`, parsed.error.message);
    }
    return parsed.data.data;
  }

  /**
   * POST /esims - https://docs.bitrefill.com/reference/post_esims.md
   *
   * BACKEND-ONLY. Never expose this as a tool the AI agent can call -
   * see security-architecture.md principle 2 ("agent never authorizes
   * payments") and bitrefill-integration.md §2. Callers of this client
   * method are expected to have already passed guardian/signer
   * authorization for the corresponding order.
   */
  async createEsimInvoice(input: {
    productId: string;
    value: string;
    quantity?: number;
    paymentMethod: string;
    autoPay?: boolean;
  }): Promise<BitrefillInvoiceRaw> {
    const body = {
      products: [
        {
          product_id: input.productId,
          value: input.value,
          quantity: input.quantity ?? 1,
        },
      ],
      payment_method: input.paymentMethod,
      auto_pay: input.autoPay ?? false,
    };

    const data = await this.request("POST", "/esims", body);
    const parsed = BitrefillInvoiceResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BitrefillResponseShapeError("/esims", parsed.error.message);
    }
    return parsed.data.data;
  }

  /**
   * Returns the full parsed JSON body (the `{meta, data}` envelope, or an
   * error body on failure) - it does NOT unwrap `.data` itself. Each public
   * method validates the full envelope against its own Zod schema and
   * extracts `.data` after validation, so a malformed envelope is caught
   * before any field access rather than failing with a confusing
   * "cannot read property of undefined" deeper in the call.
   */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          // Never log this object - the Authorization header carries the API key.
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new BitrefillApiError(`Non-JSON response from Bitrefill (HTTP ${response.status})`, response.status, null);
      }

      if (!response.ok) {
        const errorParsed = BitrefillErrorResponseSchema.safeParse(json);
        if (errorParsed.success) {
          throw new BitrefillApiError(errorParsed.data.message, response.status, errorParsed.data.error_code);
        }
        throw new BitrefillApiError(`Bitrefill request failed (HTTP ${response.status})`, response.status, null);
      }

      return json;
    } catch (err) {
      if (err instanceof BitrefillApiError || err instanceof BitrefillResponseShapeError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new BitrefillApiError(`Bitrefill request to ${path} timed out after ${this.timeoutMs}ms`, 0, "TIMEOUT");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
