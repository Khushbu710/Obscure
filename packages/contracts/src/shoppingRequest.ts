import { z } from "zod";
import { OrderSchema } from "./order.js";
import { RejectionCodeSchema } from "./guardian.js";

/** Body for POST /api/shopping/requests. Only an opaque mandateId is accepted - never mandate fields, budget, or price data. */
export const CreateShoppingRequestSchema = z.object({
  mandateId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
});
export type CreateShoppingRequest = z.infer<typeof CreateShoppingRequestSchema>;

/**
 * The order view returned to the frontend. Deliberately omits `nonce` -
 * an internal replay-protection value with no reason to ever leave the
 * backend. There is no `authorizationToken` field here at all (that lives
 * only in the guardian's internal response, never surfaced over HTTP).
 */
export const SafeOrderViewSchema = OrderSchema.omit({ nonce: true });
export type SafeOrderView = z.infer<typeof SafeOrderViewSchema>;

/**
 * The full set of outcomes a shopping request can produce - mirrors
 * AgentRunOutcome (services/api/src/agent/orchestrator.ts) but reshaped for
 * the wire: no internal tokens, no nonce, and an explicit discriminant the
 * frontend can switch on. None of these ever claim a purchase was paid or
 * delivered - "authorized" means guardian+signer-equivalent authorization
 * reserved budget, nothing more (see demo-scope.md).
 */
export const ShoppingRequestResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized"), order: SafeOrderViewSchema }),
  z.object({
    status: z.literal("rejected"),
    order: SafeOrderViewSchema,
    rejection: z.object({ code: RejectionCodeSchema, reason: z.string() }),
  }),
  z.object({ status: z.literal("malformed_proposal"), reason: z.string() }),
  z.object({ status: z.literal("product_not_verified"), merchantProductId: z.string() }),
  z.object({ status: z.literal("no_proposal"), reason: z.string() }),
]);
export type ShoppingRequestResponse = z.infer<typeof ShoppingRequestResponseSchema>;
