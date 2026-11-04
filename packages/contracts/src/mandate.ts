import { z } from "zod";
import { CurrencySchema, ISODateStringSchema, MinorUnitsSchema, SchemaVersionSchema } from "./common.js";

export const MandateStatusSchema = z.enum(["active", "paused", "revoked", "expired"]);
export type MandateStatus = z.infer<typeof MandateStatusSchema>;

export const MandateSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  status: MandateStatusSchema,
  allowedCategories: z.array(z.string()).min(1),
  allowedMerchants: z.array(z.string()).nullable(),
  allowedProductIds: z.array(z.string()).nullable(),
  totalCapMinor: MinorUnitsSchema,
  perOrderCapMinor: MinorUnitsSchema.nullable(),
  spentMinor: MinorUnitsSchema,
  currency: CurrencySchema,
  envelopeWalletRef: z.string().nullable(),
  receivingAddress: z.string().nullable(),
  fundedAt: ISODateStringSchema.nullable(),
  fundingTxId: z.string().nullable(),
  createdAt: ISODateStringSchema,
  expiresAt: ISODateStringSchema,
  revokedAt: ISODateStringSchema.nullable(),
  schemaVersion: SchemaVersionSchema,
});
export type Mandate = z.infer<typeof MandateSchema>;

/** Body for POST /api/mandates */
export const CreateMandateRequestSchema = z.object({
  allowedCategories: z.array(z.string()).min(1),
  allowedMerchants: z.array(z.string()).nullable().optional(),
  allowedProductIds: z.array(z.string()).nullable().optional(),
  totalCapMinor: MinorUnitsSchema,
  perOrderCapMinor: MinorUnitsSchema.nullable().optional(),
  currency: CurrencySchema,
  durationHours: z.number().positive(),
});
export type CreateMandateRequest = z.infer<typeof CreateMandateRequestSchema>;

/**
 * The minimal view of a mandate the guardian needs to make a decision.
 * Deliberately excludes everything else (envelope refs, user id, etc.) -
 * the guardian is a pure function and should only ever see what it needs.
 */
export const MandateSnapshotForGuardianSchema = MandateSchema.pick({
  id: true,
  status: true,
  allowedCategories: true,
  allowedMerchants: true,
  allowedProductIds: true,
  totalCapMinor: true,
  perOrderCapMinor: true,
  spentMinor: true,
  currency: true,
  expiresAt: true,
});
export type MandateSnapshotForGuardian = z.infer<typeof MandateSnapshotForGuardianSchema>;
