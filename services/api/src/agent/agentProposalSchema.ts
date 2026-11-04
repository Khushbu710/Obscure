import { z } from "zod";

/**
 * The ONLY shape the agent's final `propose_purchase` tool call is allowed
 * to carry. Deliberately does NOT include price, category, merchant,
 * mandateId, orderId, or nonce - those are either backend-trusted context
 * (mandateId) or always reconstructed from a fresh Bitrefill lookup
 * (price/category/merchant/name), never taken from the agent. See
 * orchestrator.ts for how this is turned into a full ProposedOrder.
 *
 * `.strict()` is deliberate: if a (compromised or buggy) driver smuggles
 * extra fields - e.g. attempting to also supply `priceMinor` or
 * `mandateId` - parsing fails outright rather than silently stripping them.
 * A loud, auditable rejection is preferable to a quiet one here.
 */
export const AgentProposalSchema = z
  .object({
    merchantProductId: z.string().min(1),
    agentReasoning: z.string().max(2000).optional(),
  })
  .strict();
export type AgentProposal = z.infer<typeof AgentProposalSchema>;
