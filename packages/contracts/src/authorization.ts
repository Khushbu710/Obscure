import { z } from "zod";
import { ISODateStringSchema } from "./common.js";
import { OrderSchema } from "./order.js";

/**
 * Request to the signer service. Internal network only, HMAC-authenticated,
 * never reachable from the frontend or the agent directly - see
 * security-architecture.md §1/§6. The signer treats `authorizationToken`
 * only as a transport binding; it independently re-derives its own verdict
 * from live mandate state rather than trusting this payload's content.
 */
export const SignerRequestSchema = z.object({
  authorizationToken: z.string(),
  order: OrderSchema,
});
export type SignerRequest = z.infer<typeof SignerRequestSchema>;

export const SignerSuccessSchema = z.object({
  signed: z.literal(true),
  txProposal: z.object({
    walletRef: z.string(),
    outputs: z.array(z.object({ address: z.string(), amountZatoshi: z.number().int().positive() })),
    memo: z.string().nullable(),
  }),
  signedAt: ISODateStringSchema,
});

export const SignerRejectionCodeSchema = z.enum([
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "MANDATE_NOT_ACTIVE",
  "ORDER_MISMATCH",
  "NONCE_ALREADY_CONSUMED",
  "AMOUNT_MISMATCH",
]);
export type SignerRejectionCode = z.infer<typeof SignerRejectionCodeSchema>;

export const SignerFailureSchema = z.object({
  signed: z.literal(false),
  code: SignerRejectionCodeSchema,
  reason: z.string(),
});

export const SignerResponseSchema = z.union([SignerSuccessSchema, SignerFailureSchema]);
export type SignerResponse = z.infer<typeof SignerResponseSchema>;
