import type { FastifyInstance } from "fastify";
import { apiError, CreateShoppingRequestSchema, type Order, type ShoppingRequestResponse } from "@obscura/contracts";
import type { MandateService } from "../../mandate/mandateService.js";
import { toGuardianSnapshot } from "../../repositories/mandateRepository.js";
import { AgentOrchestrator, type AgentRunOutcome } from "../../agent/orchestrator.js";
import type { AgentLlmDriver } from "../../agent/types.js";
import type { ProductDiscoveryService } from "../../bitrefill/productDiscoveryService.js";
import type { OrderAuthorizationService } from "../../mandate/orderAuthorizationService.js";
import type { PaymentService } from "../../payment/paymentService.js";
import { sendError } from "../errors.js";

export interface ShoppingAgentDependencies {
  driver: AgentLlmDriver;
  discovery: ProductDiscoveryService;
}

/**
 * Strips internal-only fields (`nonce`) before anything crosses the HTTP
 * boundary. There is no `authorizationToken` field on Order at all - that
 * lives only inside the guardian's internal response and is never
 * constructed here, so there is nothing to accidentally forward.
 */
function sanitizeOrder(order: Order): Omit<Order, "nonce"> {
  const { nonce: _nonce, ...safe } = order;
  return safe;
}

function toShoppingResponse(outcome: AgentRunOutcome): ShoppingRequestResponse {
  switch (outcome.kind) {
    case "authorized":
      return { status: "authorized", order: sanitizeOrder(outcome.order) };
    case "rejected":
      return {
        status: "rejected",
        order: sanitizeOrder(outcome.order),
        rejection: { code: outcome.guardian.code, reason: outcome.guardian.reason },
      };
    case "malformed_proposal":
      return { status: "malformed_proposal", reason: outcome.reason };
    case "product_not_verified":
      return { status: "product_not_verified", merchantProductId: outcome.merchantProductId };
    case "no_proposal":
      return { status: "no_proposal", reason: outcome.reason };
  }
}

/** Mirrors the guardian's own rejection codes for consistency - this is a pre-flight check, not a competing authorization decision; the guardian still independently re-checks mandate status for every order regardless. */
function inactiveMandateCode(status: "paused" | "revoked" | "expired"): string {
  return { paused: "MANDATE_PAUSED", revoked: "MANDATE_REVOKED", expired: "MANDATE_EXPIRED" }[status];
}

export interface ShoppingRouteOptions {
  /** Forwarded to AgentOrchestrator - see orchestrator.ts for defaults. Overridable mainly for tests. */
  maxTurns?: number;
  stepTimeoutMs?: number;
}

export function registerShoppingRoutes(
  app: FastifyInstance,
  mandateService: MandateService,
  authService: OrderAuthorizationService,
  /** null when ANTHROPIC_API_KEY/BITREFILL_API_KEY/GUARDIAN_HMAC_SECRET are not configured - the route still exists, it just reports its own unconfigured state rather than the server failing to boot. */
  agentDeps: ShoppingAgentDependencies | null,
  routeOptions: ShoppingRouteOptions = {},
  /** null when payments are not configured: authorized orders then stay `reserved`. */
  payments: PaymentService | null = null,
): void {
  app.post("/api/shopping/requests", async (request, reply) => {
    const parsed = CreateShoppingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(apiError("VALIDATION_ERROR", "Invalid shopping request", parsed.error.flatten()));
      return;
    }

    if (!agentDeps) {
      reply.code(503).send(apiError("AGENT_NOT_CONFIGURED", "The shopping agent is not configured on this server."));
      return;
    }

    let mandate;
    try {
      // mandateService.get() applies lazy expiry and is the ONLY source of
      // mandate truth here - the request body supplies nothing but an id.
      mandate = mandateService.get(parsed.data.mandateId);
    } catch (err) {
      sendError(reply, err);
      return;
    }

    if (mandate.status !== "active") {
      reply.code(409).send(apiError(inactiveMandateCode(mandate.status), `Mandate is ${mandate.status}, not active.`));
      return;
    }

    const orchestrator = new AgentOrchestrator(
      agentDeps.driver,
      agentDeps.discovery,
      authService,
      routeOptions.maxTurns,
      routeOptions.stepTimeoutMs,
    );

    let outcome: AgentRunOutcome;
    try {
      outcome = await orchestrator.runShoppingRequest({
        mandateId: mandate.id,
        mandateContext: toGuardianSnapshot(mandate),
        userPrompt: parsed.data.prompt,
      });
    } catch (err) {
      sendError(reply, err);
      return;
    }

    // Kick off payment in the background, using the guardian's token while it is still valid
    // (90s). The token never leaves the backend; the response below is sanitized as before.
    if (outcome.kind === "authorized") payments?.start(outcome.order, outcome.guardian.authorizationToken);

    reply.code(200).send(toShoppingResponse(outcome));
  });
}
