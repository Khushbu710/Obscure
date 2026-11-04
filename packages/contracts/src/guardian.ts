import { z } from "zod";
import { ISODateStringSchema } from "./common.js";
import { MandateSnapshotForGuardianSchema } from "./mandate.js";
import { OrderSchema } from "./order.js";

/**
 * Exhaustive rejection codes. Extend only by consensus between both
 * developers - this list is also the attack-scoreboard's assertion surface
 * (see docs/architecture/testing-strategy.md and data-models.md §5).
 */
export const RejectionCodeSchema = z.enum([
  "MALFORMED_ORDER",
  "MANDATE_REVOKED",
  "MANDATE_PAUSED",
  "MANDATE_EXPIRED",
  "NONCE_REUSED",
  "CATEGORY_NOT_ALLOWED",
  "MERCHANT_NOT_ALLOWED",
  "PRODUCT_NOT_ALLOWED",
  "PRICE_MISMATCH",
  "PER_ORDER_CAP_EXCEEDED",
  "BUDGET_EXCEEDED",
]);
export type RejectionCode = z.infer<typeof RejectionCodeSchema>;

/**
 * Guardian is a PURE function's input/output shape: no database handle, no
 * network client, nothing but plain data in, plain data out. The caller
 * (mandate engine) is responsible for fetching the mandate snapshot, the
 * freshly-verified price, and the nonce-consumption flag before calling in.
 */
export const GuardianRequestSchema = z.object({
  mandate: MandateSnapshotForGuardianSchema,
  order: OrderSchema,
  verifiedPriceMinor: z.number().int().nonnegative(),
  nonceAlreadyConsumed: z.boolean(),
  now: ISODateStringSchema,
});
export type GuardianRequest = z.infer<typeof GuardianRequestSchema>;

export const GuardianApprovedSchema = z.object({
  approved: z.literal(true),
  authorizationToken: z.string(),
  checkedAt: ISODateStringSchema,
});

export const GuardianRejectedSchema = z.object({
  approved: z.literal(false),
  code: RejectionCodeSchema,
  reason: z.string(),
  checkedAt: ISODateStringSchema,
});

export const GuardianResponseSchema = z.union([GuardianApprovedSchema, GuardianRejectedSchema]);
export type GuardianResponse = z.infer<typeof GuardianResponseSchema>;
