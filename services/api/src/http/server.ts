import Fastify from "fastify";
import cors from "@fastify/cors";
import type { DatabaseSync } from "node:sqlite";
import { BitrefillClient } from "@obscura/bitrefill-client";
import { MandateRepository } from "../repositories/mandateRepository.js";
import { OrderRepository } from "../repositories/orderRepository.js";
import { NonceRepository } from "../repositories/nonceRepository.js";
import { MandateService } from "../mandate/mandateService.js";
import { OrderAuthorizationService } from "../mandate/orderAuthorizationService.js";
import { ProductDiscoveryService } from "../bitrefill/productDiscoveryService.js";
import { AnthropicLlmDriver } from "../agent/anthropicDriver.js";
import type { AgentLlmDriver } from "../agent/types.js";
import { registerMandateRoutes } from "./routes/mandates.js";
import { registerShoppingRoutes, type ShoppingAgentDependencies } from "./routes/shopping.js";

export interface ServerOptions {
  /** Comma-separated allowed origins, e.g. "http://localhost:5173". Defaults to allow-all for hackathon-local dev. */
  corsOrigin?: string | boolean;
  /** Test-only injection point for the guardian's token-signing secret - never used in production wiring. */
  guardianHmacSecret?: string;
  /** Test-only injection point for the agent's LLM driver - never used in production wiring. */
  agentDriver?: AgentLlmDriver;
  /** Test-only injection point for the Bitrefill client - never used in production wiring. */
  bitrefillClient?: BitrefillClient;
  /** Forwarded to AgentOrchestrator via the shopping route - overridable mainly for tests (e.g. a short timeout). */
  agentMaxTurns?: number;
  agentStepTimeoutMs?: number;
}

/**
 * Resolves what the shopping-agent route needs. Returns null (not a
 * startup failure) when credentials aren't configured - see
 * docs/architecture/verification-matrix.md: no live Anthropic or Bitrefill
 * key exists in this environment, so the route must degrade honestly
 * (503 AGENT_NOT_CONFIGURED) rather than either crashing server boot or
 * pretending to work.
 */
function resolveAgentDependencies(options: ServerOptions): ShoppingAgentDependencies | null {
  const driver = options.agentDriver ?? (process.env.ANTHROPIC_API_KEY ? new AnthropicLlmDriver(process.env.ANTHROPIC_API_KEY) : null);
  const bitrefillClient =
    options.bitrefillClient ?? (process.env.BITREFILL_API_KEY ? new BitrefillClient({ apiKey: process.env.BITREFILL_API_KEY }) : null);
  if (!driver || !bitrefillClient) return null;
  return { driver, discovery: new ProductDiscoveryService(bitrefillClient) };
}

export async function buildServer(db: DatabaseSync, options: ServerOptions = {}) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: options.corsOrigin ?? true, // true = reflect request origin; hackathon-scoped, single trusted frontend dev server
  });

  const mandateRepo = new MandateRepository(db);
  const orderRepo = new OrderRepository(db);
  const nonceRepo = new NonceRepository(db);
  const mandateService = new MandateService(mandateRepo);

  const guardianHmacSecret = options.guardianHmacSecret ?? process.env.GUARDIAN_HMAC_SECRET ?? null;
  const agentDepsIfConfigured = resolveAgentDependencies(options);
  // Both the signing secret AND the agent's external dependencies must be
  // present - a secret with no agent, or an agent with no secret, are both
  // "not configured" from the route's point of view.
  const agentDeps = guardianHmacSecret && agentDepsIfConfigured ? agentDepsIfConfigured : null;
  const authService = new OrderAuthorizationService(db, mandateRepo, orderRepo, nonceRepo, guardianHmacSecret ?? "unconfigured");

  registerMandateRoutes(app, mandateService);
  registerShoppingRoutes(app, mandateService, authService, agentDeps, {
    maxTurns: options.agentMaxTurns,
    stepTimeoutMs: options.agentStepTimeoutMs,
  });

  app.get("/health", async () => ({ ok: true }));

  return app;
}
