import { z } from "zod";

/**
 * Raw Bitrefill API wire shapes (snake_case, as documented), verified against
 * https://docs.bitrefill.com (2026-11-04) - specifically:
 *   - https://docs.bitrefill.com/docs/api-overview (auth, base URL)
 *   - https://docs.bitrefill.com/docs/quickstart-2 (ping, products, invoice basics)
 *   - https://docs.bitrefill.com/docs/searching-products
 *   - https://docs.bitrefill.com/docs/esims
 *   - https://docs.bitrefill.com/docs/crypto-payments
 *   - https://docs.bitrefill.com/reference/get_products-esims-id.md (OpenAPI-generated reference)
 *   - https://docs.bitrefill.com/reference/post_esims.md (OpenAPI-generated reference)
 *   - https://docs.bitrefill.com/docs/error-codes
 *
 * KNOWN DOC INCONSISTENCY, handled defensively rather than guessed away:
 * the hand-written quickstart guide shows `product.packages` as an array
 * with a `package_id` field; the OpenAPI-generated reference page shows
 * `packages` typed as a single `object` with an `id` field (not an array).
 * `normalizePackages()` in normalize.ts accepts both shapes rather than
 * assuming one is correct - do not "fix" this by picking one without new
 * evidence from a live response.
 */

export const BitrefillPackageRawSchema = z.object({
  id: z.string().optional(),
  package_id: z.string().optional(), // seen in the hand-written guide's examples
  value: z.union([z.number(), z.string()]), // numeric for gift cards, descriptive string for eSIMs (e.g. "3GB, 30 Days")
  price: z.number(), // documented as major currency units (e.g. 12 for $12), NOT minor units - see normalize.ts
});
export type BitrefillPackageRaw = z.infer<typeof BitrefillPackageRawSchema>;

export const BitrefillRangeRawSchema = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number(),
  price_rate: z.number().optional(),
});

export const BitrefillProductRawSchema = z.object({
  id: z.string(),
  name: z.string(), // UNTRUSTED free text - never used for authorization decisions
  country_code: z.string().optional(),
  country_name: z.string().optional(),
  currency: z.string(),
  created_time: z.string().optional(),
  recipient_type: z.string().optional(),
  image: z.string().optional(),
  in_stock: z.boolean().optional(),
  // Deliberately `unknown` here, not a strict array/object union, because
  // Bitrefill's own docs disagree on the shape (see module comment above).
  // normalizePackages() does the defensive extraction.
  packages: z.unknown(),
  range: BitrefillRangeRawSchema.optional(),
});
export type BitrefillProductRaw = z.infer<typeof BitrefillProductRawSchema>;

export const BitrefillProductListResponseSchema = z.object({
  data: z.array(BitrefillProductRawSchema),
});

export const BitrefillProductDetailResponseSchema = z.object({
  data: BitrefillProductRawSchema,
});

export const BitrefillInvoicePaymentRawSchema = z.object({
  method: z.string(),
  address: z.string().optional(),
  currency: z.string(),
  price: z.number(), // major currency units, matches product pricing convention
  status: z.enum([
    "unpaid",
    "payment_detected",
    "payment_confirmed",
    "pending",
    "complete",
    "blocked",
    "denied",
    "payment_error",
  ]),
  commission: z.number().optional(),
});

export const BitrefillOrderRawSchema = z.object({
  id: z.string(),
  status: z.string(),
  product: z.object({
    id: z.string(),
    name: z.string(),
    value: z.union([z.number(), z.string()]),
    currency: z.string(),
    image: z.string().optional(),
    _href: z.string().optional(),
  }),
  created_time: z.string().optional(),
  delivered_time: z.string().nullable().optional(),
  redemption_info: z
    .object({
      barcode_format: z.string().optional(),
      barcode_value: z.string().optional(),
      instructions: z.string().optional(),
    })
    .optional(),
});

export const BitrefillInvoiceRawSchema = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  completed_time: z.string().nullable().optional(),
  status: z.string(), // order-fulfillment status (e.g. "not_delivered") - distinct from payment.status
  payment: BitrefillInvoicePaymentRawSchema,
  orders: z.array(BitrefillOrderRawSchema),
});
export type BitrefillInvoiceRaw = z.infer<typeof BitrefillInvoiceRawSchema>;

export const BitrefillInvoiceResponseSchema = z.object({
  data: BitrefillInvoiceRawSchema,
});

/** https://docs.bitrefill.com/docs/error-codes */
export const BitrefillErrorResponseSchema = z.object({
  error_code: z.string(),
  message: z.string(),
});
export type BitrefillErrorResponse = z.infer<typeof BitrefillErrorResponseSchema>;
