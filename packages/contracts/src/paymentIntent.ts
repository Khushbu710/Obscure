import { z } from "zod";
import { OrderStatusSchema } from "./order.js";

export const SettlementModeSchema = z.enum(["real", "simulated"]);
export type SettlementMode = z.infer<typeof SettlementModeSchema>;

/**
 * MVP note: settlementMode is always "simulated" - no swap provider
 * supports testnet TAZ, so commerce settlement cannot be real.
 * See docs/architecture/demo-scope.md. The Zcash leg itself (funding,
 * signing, broadcast, confirmation) is independent of this field and is
 * always real when it happens at all.
 */
export const PaymentIntentSchema = z.object({
  orderId: z.string().uuid(),
  status: OrderStatusSchema,
  merchantInvoiceRef: z.string().nullable(),
  amountZatoshi: z.number().int().nonnegative().nullable(),
  settlementMode: SettlementModeSchema,
});
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;
