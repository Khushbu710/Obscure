import type { FastifyReply } from "fastify";
import { apiError } from "@obscura/contracts";
import { MandateNotFoundError, InvalidMandateTransitionError } from "../mandate/mandateService.js";
import { MandateNotFoundForOrderError } from "../mandate/orderAuthorizationService.js";
import { AgentStepTimeoutError } from "../agent/orchestrator.js";
import { AgentDriverError } from "../agent/geminiDriver.js";
import { SignerUnavailableError } from "../signer/signerClient.js";

/**
 * Uniform error shape across the whole backend - docs/architecture/data-models.md §11.
 * Every route handler should funnel unexpected errors through this rather
 * than letting Fastify's default error formatter leak internals.
 */
export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof MandateNotFoundError) {
    reply.code(404).send(apiError("MANDATE_NOT_FOUND", err.message));
    return;
  }
  if (err instanceof MandateNotFoundForOrderError) {
    reply.code(404).send(apiError("MANDATE_NOT_FOUND", err.message));
    return;
  }
  if (err instanceof InvalidMandateTransitionError) {
    reply.code(409).send(apiError("INVALID_MANDATE_TRANSITION", err.message));
    return;
  }
  if (err instanceof AgentStepTimeoutError) {
    // eslint-disable-next-line no-console
    console.error(err);
    reply.code(504).send(apiError("AGENT_TIMEOUT", "The shopping agent did not respond in time."));
    return;
  }
  if (err instanceof AgentDriverError) {
    // AgentDriverError's own message is already sanitized (see
    // geminiDriver.ts - it never embeds the API key), but we still send
    // a fixed, generic message over the wire and keep the detail
    // server-side only, consistent with "keep error messages safe."
    // eslint-disable-next-line no-console
    console.error(err);
    reply.code(502).send(apiError("AGENT_DRIVER_ERROR", "The shopping agent encountered an error communicating with its provider."));
    return;
  }
  if (err instanceof SignerUnavailableError) {
    // eslint-disable-next-line no-console
    console.error(err);
    reply.code(502).send(apiError("SIGNER_UNAVAILABLE", "The signer service is unavailable."));
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  reply.code(500).send(apiError("INTERNAL_ERROR", "An unexpected error occurred."));
}
