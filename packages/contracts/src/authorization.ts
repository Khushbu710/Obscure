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
/**
 * `destinationAddress` / `amountZatoshi` are additive fields (2026-11-04,
 * signer implementation). Neither `Order` nor the guardian's
 * `authorizationToken` carries a blockchain destination or a ZEC amount -
 * no real settlement/currency-conversion system exists yet (see
 * `demo-scope.md`), so there was nothing honest to bind to before now.
 * They describe the exact blockchain-level transaction terms the signer is
 * being asked to authorize. As of the 2026-11-04 signer security review,
 * the signer does NOT trust these fields on their own - it requires the
 * authorizationToken to carry a matching `TransactionIntent` (see
 * packages/guardian/src/authorizationToken.ts) and rejects any mismatch.
 * This is a pure addition - no existing field changed, no existing
 * consumer of this schema exists yet, so nothing can regress.
 */
export const SignerRequestSchema = z.object({
  authorizationToken: z.string(),
  order: OrderSchema,
  destinationAddress: z.string().min(1),
  amountZatoshi: z.number().int().positive(),
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
  /**
   * Additive (2026-11-04, signer/adapter integration): the id of the
   * transaction the adapter actually broadcast, so the backend can track its
   * confirmation. Optional so existing consumers and mock adapters are
   * unaffected; the real adapter always supplies it.
   */
  txId: z.string().optional(),
});

export const SignerRejectionCodeSchema = z.enum([
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "MANDATE_NOT_ACTIVE",
  "ORDER_MISMATCH",
  "NONCE_ALREADY_CONSUMED",
  "AMOUNT_MISMATCH",
  // Additive (2026-11-04, signer implementation): the original enum predates
  // any adapter/DB-failure handling. Both are fail-closed outcomes, never
  // success - see SignerService.
  "ADAPTER_ERROR",
  "INTERNAL_ERROR",
  // Additive (2026-11-04, signer security review). Replaces the earlier,
  // weaker "destination/amount are just non-empty strings, sign-once
  // protection covers tampering" design: the authorization token now
  // cryptographically binds the exact destination/amount, so a mismatch is
  // distinguishable from a merely-malformed request, and an order with no
  // bound terms at all is distinguishable from one with mismatched terms.
  "DESTINATION_MISMATCH",
  "TRANSACTION_INTENT_NOT_BOUND",
  // The adapter call timed out - whether it broadcast is genuinely unknown.
  // Never equivalent to ADAPTER_ERROR: the order is frozen (not released,
  // not retried) pending manual reconciliation - see SignerService.
  "BROADCAST_UNCERTAIN",
]);
export type SignerRejectionCode = z.infer<typeof SignerRejectionCodeSchema>;

export const SignerFailureSchema = z.object({
  signed: z.literal(false),
  code: SignerRejectionCodeSchema,
  reason: z.string(),
});

export const SignerResponseSchema = z.union([SignerSuccessSchema, SignerFailureSchema]);
export type SignerResponse = z.infer<typeof SignerResponseSchema>;
