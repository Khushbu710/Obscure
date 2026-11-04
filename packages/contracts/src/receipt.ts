import { z } from "zod";
import { CurrencySchema, ISODateStringSchema, MinorUnitsSchema } from "./common.js";
import { SettlementModeSchema } from "./paymentIntent.js";

/**
 * A digital signature + hash commitment, NOT a zero-knowledge proof.
 * Selective disclosure = revealing `salt` + the underlying fields for one
 * commitment; a verifier recomputes the hash and checks the signature.
 * Never describe this as ZK anywhere - see demo-scope.md §4.
 */
export const ReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  orderId: z.string().uuid(),
  commitment: z.string(), // hex SHA-256(orderId || priceMinor || merchantId || timestamp || salt || settlementMode)
  signature: z.string(), // hex Ed25519 signature over `commitment`
  encryptedPayload: z.string(),
  createdAt: ISODateStringSchema,
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Decrypted shape committed to by `commitment` - never stored in plaintext outside the service. */
export const ReceiptPayloadSchema = z.object({
  orderId: z.string().uuid(),
  priceMinor: MinorUnitsSchema,
  currency: CurrencySchema,
  merchantId: z.string(),
  timestamp: ISODateStringSchema,
  settlementMode: SettlementModeSchema,
  salt: z.string(),
});
export type ReceiptPayload = z.infer<typeof ReceiptPayloadSchema>;

/** Response of POST /api/receipts/:id/disclose */
export const SelectiveDisclosureSchema = z.object({
  commitment: z.string(),
  signature: z.string(),
  disclosedFields: ReceiptPayloadSchema,
});
export type SelectiveDisclosure = z.infer<typeof SelectiveDisclosureSchema>;
