import { z } from "zod";
import {
  MandateSchema,
  SelectiveDisclosureSchema,
  ShoppingRequestResponseSchema,
  type CreateMandateRequest,
  type CreateShoppingRequest,
  type Mandate,
  type SelectiveDisclosure,
  type ShoppingRequestResponse,
} from "@obscura/contracts";
import {
  OrderWithPaymentSchema,
  OrdersListResponseSchema,
  ReceiptDetailResponseSchema,
  ReceiptListResponseSchema,
  ReceiptPublicKeyResponseSchema,
  ScoreboardResponseSchema,
  WalletEnvelopeResponseSchema,
  WalletFundResponseSchema,
  WalletSweepResponseSchema,
  type OrderWithPayment,
  type ReceiptDetailResponse,
  type ReceiptMetadata,
  type ReceiptPublicKeyResponse,
  type ScoreboardResponse,
  type WalletEnvelopeResponse,
  type WalletFundResponse,
  type WalletSweepResponse,
} from "./schemas";

const DEFAULT_TIMEOUT_MS = 20_000;

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/**
 * Thrown for any non-2xx backend response. Carries the exact structured
 * error the backend returned (see services/api/src/http/errors.ts) - the
 * UI must render `code`/`message`, never invent its own interpretation or
 * silently treat this as a success.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown for network failures, timeouts, or a response that isn't valid JSON - distinct from a structured ApiError so the UI can show "couldn't reach the server" rather than a fabricated error code. */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Thrown when a 2xx backend response does NOT match the real Zod schema
 * from @obscura/contracts - e.g. a field renamed on the backend without
 * the frontend being updated. Without this check the client would
 * previously do a blind `json as T` cast and silently render `undefined`
 * fields rather than failing loudly. This is the frontend's half of
 * "handle the exact backend response schemas correctly."
 */
export class ResponseShapeError extends Error {
  constructor(endpoint: string, details: string) {
    super(`Response from ${endpoint} did not match the expected schema: ${details}`);
    this.name = "ResponseShapeError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, endpoint: string, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ResponseShapeError(endpoint, parsed.error.message);
  }
  return parsed.data;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new NetworkError(
      isAbort ? "The request timed out." : "Could not reach the OBSCURA backend.",
      err,
    );
  }
  clearTimeout(timeout);

  let json: unknown;
  try {
    json = response.status === 204 ? null : await response.json();
  } catch (err) {
    throw new NetworkError("The server returned an invalid response.", err);
  }

  if (!response.ok) {
    const body = json as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? `Request failed with status ${response.status}`,
      body?.error?.details,
    );
  }

  return json;
}

const MandateListSchema = z.array(MandateSchema);

/**
 * Centralized, typed backend client. Every method here maps 1:1 to a real,
 * verified route in services/api/src/http/routes/ - nothing here is
 * invented. See lib/api/unavailable.ts for endpoints that do NOT exist yet
 * (activity, receipts, wallet, security scoreboard).
 *
 * Every successful response is validated against the real Zod schema from
 * @obscura/contracts before being returned - see ResponseShapeError above.
 */
export const api = {
  mandates: {
    list: async (): Promise<Mandate[]> => parseOrThrow(MandateListSchema, "GET /api/mandates", await request("/api/mandates")),
    get: async (id: string): Promise<Mandate> =>
      parseOrThrow(MandateSchema, "GET /api/mandates/:id", await request(`/api/mandates/${encodeURIComponent(id)}`)),
    create: async (body: CreateMandateRequest): Promise<Mandate> =>
      parseOrThrow(MandateSchema, "POST /api/mandates", await request("/api/mandates", { method: "POST", body: JSON.stringify(body) })),
    pause: async (id: string): Promise<Mandate> =>
      parseOrThrow(MandateSchema, "POST /api/mandates/:id/pause", await request(`/api/mandates/${encodeURIComponent(id)}/pause`, { method: "POST" })),
    resume: async (id: string): Promise<Mandate> =>
      parseOrThrow(MandateSchema, "POST /api/mandates/:id/resume", await request(`/api/mandates/${encodeURIComponent(id)}/resume`, { method: "POST" })),
    revoke: async (id: string): Promise<Mandate> =>
      parseOrThrow(MandateSchema, "POST /api/mandates/:id/revoke", await request(`/api/mandates/${encodeURIComponent(id)}/revoke`, { method: "POST" })),
  },
  shopping: {
    submit: async (body: CreateShoppingRequest): Promise<ShoppingRequestResponse> =>
      parseOrThrow(
        ShoppingRequestResponseSchema,
        "POST /api/shopping/requests",
        await request("/api/shopping/requests", { method: "POST", body: JSON.stringify(body) }),
      ),
  },
  wallet: {
    /** 404 NO_ENVELOPE/MANDATE_NOT_FOUND, 409 MANDATE_NOT_ACTIVE, 503 SIGNER_NOT_CONFIGURED, 502 SIGNER_UNAVAILABLE surface as ApiError - the caller decides which of these mean "not funded yet" vs. a real failure. */
    fund: async (mandateId: string): Promise<WalletFundResponse> =>
      parseOrThrow(
        WalletFundResponseSchema,
        "POST /api/mandates/:id/fund",
        await request(`/api/mandates/${encodeURIComponent(mandateId)}/fund`, { method: "POST" }),
      ),
    envelope: async (mandateId: string): Promise<WalletEnvelopeResponse> =>
      parseOrThrow(
        WalletEnvelopeResponseSchema,
        "GET /api/mandates/:id/envelope",
        await request(`/api/mandates/${encodeURIComponent(mandateId)}/envelope`),
      ),
    /** 409 MANDATE_STILL_ACTIVE / ORDERS_IN_FLIGHT / NOTHING_TO_SWEEP, 404 NO_ENVELOPE. */
    sweep: async (mandateId: string): Promise<WalletSweepResponse> =>
      parseOrThrow(
        WalletSweepResponseSchema,
        "POST /api/mandates/:id/sweep",
        await request(`/api/mandates/${encodeURIComponent(mandateId)}/sweep`, { method: "POST" }),
      ),
  },
  orders: {
    /** A read of stored state only - does not poll the chain. */
    list: async (mandateId?: string): Promise<OrderWithPayment[]> => {
      const parsed = parseOrThrow(
        OrdersListResponseSchema,
        "GET /api/orders",
        await request(mandateId ? `/api/orders?mandateId=${encodeURIComponent(mandateId)}` : "/api/orders"),
      );
      return parsed.orders;
    },
    /** Also advances the payment by one chain observation server-side - safe and intended to be polled. */
    get: async (orderId: string): Promise<OrderWithPayment> =>
      parseOrThrow(OrderWithPaymentSchema, "GET /api/orders/:id", await request(`/api/orders/${encodeURIComponent(orderId)}`)),
  },
  receipts: {
    list: async (): Promise<ReceiptMetadata[]> =>
      parseOrThrow(ReceiptListResponseSchema, "GET /api/receipts", await request("/api/receipts")),
    get: async (receiptId: string): Promise<ReceiptDetailResponse> =>
      parseOrThrow(ReceiptDetailResponseSchema, "GET /api/receipts/:id", await request(`/api/receipts/${encodeURIComponent(receiptId)}`)),
    disclose: async (receiptId: string): Promise<SelectiveDisclosure> =>
      parseOrThrow(
        SelectiveDisclosureSchema,
        "POST /api/receipts/:id/disclose",
        await request(`/api/receipts/${encodeURIComponent(receiptId)}/disclose`, { method: "POST" }),
      ),
    publicKey: async (): Promise<ReceiptPublicKeyResponse> =>
      parseOrThrow(ReceiptPublicKeyResponseSchema, "GET /api/receipts/public-key", await request("/api/receipts/public-key")),
  },
  security: {
    /** Never fabricates a result - returns the real { status: "not_run" } or { status: "ok", run } the backend serves. */
    scoreboard: async (): Promise<ScoreboardResponse> =>
      parseOrThrow(ScoreboardResponseSchema, "GET /api/security/scoreboard", await request("/api/security/scoreboard")),
  },
};
