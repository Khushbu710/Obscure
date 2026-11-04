import { z } from "zod";
import { ISODateStringSchema, MinorUnitsSchema } from "./common.js";
import { ProductSchema } from "./product.js";

/**
 * Full lifecycle state machine - see docs/architecture/payment-flow.md §1.
 * reserved/authorized/signed are distinct from confirmed: a signed or even
 * broadcast transaction is NOT yet a completed spend. Budget is finalized
 * only at `confirmed`; `failed`/`rejected`/`expired`/`cancelled` release
 * any reservation back to available budget.
 */
export const OrderStatusSchema = z.enum([
  "proposed",
  "validated",
  "reserved",
  "authorized",
  "signed",
  "broadcast",
  "mined",
  "confirmed",
  "settlement_pending",
  "delivered",
  "failed",
  "payment_uncertain",
  "refund_pending",
  "refunded",
  "rejected",
  "expired",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** States from which a budget reservation still exists and must be released on exit (other than via `confirmed`). */
export const RESERVED_STATUSES: OrderStatus[] = [
  "reserved",
  "authorized",
  "signed",
  "broadcast",
  "mined",
];

/** Terminal states that release any held reservation without finalizing spend. */
export const RELEASING_STATUSES: OrderStatus[] = ["failed", "rejected", "expired", "cancelled"];

export const OrderSchema = z.object({
  orderId: z.string().uuid(),
  mandateId: z.string().uuid(),
  product: ProductSchema,
  priceMinor: MinorUnitsSchema,
  nonce: z.string().min(16),
  status: OrderStatusSchema,
  proposedAt: ISODateStringSchema,
  agentReasoning: z.string().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

/**
 * What the agent is actually allowed to produce. Deliberately excludes
 * orderId, nonce, and status - those are backend-assigned, never
 * agent-influenced (see security-architecture.md principle 7 & 12).
 */
export const ProposedOrderSchema = z.object({
  mandateId: z.string().uuid(),
  product: ProductSchema,
  priceMinor: MinorUnitsSchema,
  agentReasoning: z.string().optional(),
});
export type ProposedOrder = z.infer<typeof ProposedOrderSchema>;
