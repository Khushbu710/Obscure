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
import { HttpSignerClient, type SignerGateway } from "../signer/signerClient.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerReceiptRoutes } from "./routes/receipts.js";
import { registerSecurityRoutes } from "./routes/security.js";
import { ReceiptRepository } from "../repositories/receiptRepository.js";
import { ReceiptService } from "../receipts/receiptService.js";
import { ReceiptKeyring } from "../receipts/receiptCrypto.js";
import { PaymentRepository } from "../repositories/paymentRepository.js";
import { PaymentService, type InvoiceCreator } from "../payment/paymentService.js";
import { TransactionIntentBuilder } from "../payment/transactionIntent.js";
import { InvoiceService } from "../bitrefill/invoiceService.js";
import { registerShoppingRoutes, type ShoppingAgentDependencies } from "./routes/shopping.js";

declare module "fastify" {
  interface FastifyInstance {
    /** null when the signer, Bitrefill client or guardian secret is not configured. */
    payments: PaymentService | null;
  }
}

export interface ServerOptions {
  /** Comma-separated allowed origins, e.g. "http://localhost:5173". Defaults to allow-all for hackathon-local dev. */
  corsOrigin?: string | boolean;
  /** Test-only injection point for the guardian's token-signing secret - never used in production wiring. */
  guardianHmacSecret?: string;
  /** Test-only injection point for the agent's LLM driver - never used in production wiring. */
  agentDriver?: AgentLlmDriver;
  /** Test-only injection point for the Bitrefill client - never used in production wiring. */
  bitrefillClient?: BitrefillClient;
  /** Test-only injection point for the signer gateway - production wiring builds an HttpSignerClient from SIGNER_BASE_URL + SIGNER_AUTH_SECRET. */
  signerGateway?: SignerGateway;
  /** Test-only injection point for the trusted transaction-intent builder - production reads DEMO_SETTLEMENT_ADDRESS + DEMO_ZATOSHI_PER_MINOR. */
  intentBuilder?: TransactionIntentBuilder;
  /** Test-only injection point for invoice creation - production wiring uses InvoiceService over the Bitrefill client. */
  invoiceCreator?: InvoiceCreator;
  /** Test-only injection point for receipt keys. Production: RECEIPT_KEY_FILE (persistent); otherwise ephemeral keys with a warning. */
  receiptKeyring?: ReceiptKeyring;
  /** Where the attack scoreboard's stored results live (tests override this). */
  scoreboardResultsPath?: string;
  /** Payment confirmation timeout before an order is held as payment_uncertain. */
  confirmationTimeoutMs?: number;
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
function resolveBitrefillClient(options: ServerOptions): BitrefillClient | null {
  return options.bitrefillClient ?? (process.env.BITREFILL_API_KEY ? new BitrefillClient({ apiKey: process.env.BITREFILL_API_KEY }) : null);
}

function resolveAgentDependencies(options: ServerOptions): ShoppingAgentDependencies | null {
  const driver = options.agentDriver ?? (process.env.ANTHROPIC_API_KEY ? new AnthropicLlmDriver(process.env.ANTHROPIC_API_KEY) : null);
  const bitrefillClient = resolveBitrefillClient(options);
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
  // The trusted source of the exact destination + amount (configured address x fixed DEMO rate).
  // Never agent- or frontend-supplied. Without it no intent is bound, so the signer refuses to
  // sign - authorized orders then stay `reserved`, never half-paid.
  const intentBuilder =
    options.intentBuilder ??
    (process.env.DEMO_SETTLEMENT_ADDRESS
      ? new TransactionIntentBuilder({
          destinationAddress: process.env.DEMO_SETTLEMENT_ADDRESS,
          zatoshiPerMinor: Number(process.env.DEMO_ZATOSHI_PER_MINOR ?? 10_000),
        })
      : null);
  const authService = new OrderAuthorizationService(
    db,
    mandateRepo,
    orderRepo,
    nonceRepo,
    guardianHmacSecret ?? "unconfigured",
    undefined,
    intentBuilder ? (proposed) => intentBuilder.forPriceMinor(proposed.priceMinor) : null,
  );

  const signerGateway =
    options.signerGateway ??
    (process.env.SIGNER_BASE_URL && process.env.SIGNER_AUTH_SECRET
      ? new HttpSignerClient(process.env.SIGNER_BASE_URL, process.env.SIGNER_AUTH_SECRET)
      : null);

  // Payment orchestration needs all three: the guardian secret (an authorization
  // exists at all), a way to create invoices, and the signer. Anything missing
  // means authorized orders simply stay `reserved` - never half-paid.
  const bitrefillClient = resolveBitrefillClient(options);
  const invoiceCreator: InvoiceCreator | null =
    options.invoiceCreator ?? (bitrefillClient ? new InvoiceService(bitrefillClient, orderRepo) : null);
  const paymentRepo = new PaymentRepository(db);
  const keyring =
    options.receiptKeyring ?? (process.env.RECEIPT_KEY_FILE ? ReceiptKeyring.fromFile(process.env.RECEIPT_KEY_FILE) : ReceiptKeyring.ephemeral());
  if (!keyring.persistent) {
    app.log.warn("Receipt keys are ephemeral (RECEIPT_KEY_FILE unset): receipts will not be readable or verifiable after a restart.");
  }
  const receiptService = new ReceiptService(new ReceiptRepository(db), orderRepo, paymentRepo, keyring);

  const paymentService =
    guardianHmacSecret && signerGateway && invoiceCreator && intentBuilder
      ? new PaymentService(orderRepo, paymentRepo, authService, invoiceCreator, signerGateway, intentBuilder, {
          confirmationTimeoutMs: options.confirmationTimeoutMs,
          onDelivered: (orderId) => void receiptService.createForOrder(orderId),
          onError: (e) => app.log.error(e, "payment execution failed"),
        })
      : null;
  app.decorate("payments", paymentService);

  registerMandateRoutes(app, mandateService);
  registerWalletRoutes(app, mandateService, mandateRepo, signerGateway);
  registerShoppingRoutes(
    app,
    mandateService,
    authService,
    agentDeps,
    { maxTurns: options.agentMaxTurns, stepTimeoutMs: options.agentStepTimeoutMs },
    paymentService,
  );
  registerOrderRoutes(app, orderRepo, paymentService);
  registerReceiptRoutes(app, receiptService);
  registerSecurityRoutes(app, options.scoreboardResultsPath);

  app.get("/health", async () => ({ ok: true }));

  return app;
}
