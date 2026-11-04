import { z } from "zod";
import { CurrencySchema, MinorUnitsSchema } from "./common.js";

/**
 * Product data as returned by the agent, sourced from Bitrefill.
 * UNTRUSTED until mapped: `name` is free text and MUST NOT be read for
 * authorization semantics anywhere downstream (see security-architecture.md).
 */
export const ProductSchema = z.object({
  merchantProductId: z.string(),
  name: z.string(),
  priceMinor: MinorUnitsSchema,
  currency: CurrencySchema,
  category: z.string(),
  merchantId: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;
