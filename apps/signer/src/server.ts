import Fastify from "fastify";
import { z } from "zod";
import { SignerRequestSchema } from "@obscura/contracts";
import { verifyBodySignature } from "./auth.js";
import type { SignerService } from "./signerService.js";
import type { WalletOpsService } from "./walletOps.js";

export const SIGNATURE_HEADER = "x-signer-signature";

const MandateIdBody = z.object({ mandateId: z.string().uuid() });
const TxStatusBody = z.object({ orderId: z.string().uuid(), txId: z.string().min(1).max(128) });

/** HTTP status for each signer rejection. The JSON body always carries `{signed:false, code, reason}`. */
function statusForRejection(code: string): number {
  if (code === "BROADCAST_UNCERTAIN") return 504; // outcome unknown - the caller must NOT retry or release
  if (code === "ADAPTER_ERROR") return 502;
  if (code === "INTERNAL_ERROR") return 500;
  return 403;
}

/**
 * Internal-only HTTP surface. Every request must carry an HMAC of its raw
 * body (SIGNER_AUTH_SECRET, distinct from the guardian token secret). Bind to
 * loopback; it must never be reachable from the frontend or the agent.
 */
export async function buildSignerServer(signer: SignerService, wallets: WalletOpsService, authSecret: string, logger = true) {
  if (!authSecret) throw new Error("SIGNER_CONFIG: authSecret is required");
  const app = Fastify({ logger: logger ? { redact: ["req.headers"] } : false });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  /** Verifies the HMAC over the exact raw body BEFORE parsing anything, then parses with a schema. */
  function authed<T>(
    path: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    handler: (body: T) => Promise<{ status: number; body: unknown }>,
  ) {
    app.post(path, async (request, reply) => {
      const raw = typeof request.body === "string" ? request.body : "";
      const sig = request.headers[SIGNATURE_HEADER];
      if (!verifyBodySignature(raw, typeof sig === "string" ? sig : undefined, authSecret)) {
        return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Bad or missing signature." } });
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON." } });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } });
      try {
        const out = await handler(parsed.data);
        return reply.code(out.status).send(out.body);
      } catch {
        // Never echo internals (could include wallet details).
        return reply.code(502).send({ error: { code: "WALLET_FAILURE", message: "Wallet operation failed." } });
      }
    });
  }

  const walletStatus = (r: { ok: boolean; code?: string }) =>
    r.ok ? 200 : r.code === "MANDATE_NOT_FOUND" || r.code === "NO_ENVELOPE" || r.code === "ORDER_NOT_FOUND" ? 404 : 409;

  authed("/sign", SignerRequestSchema, async (req) => {
    const outcome = await signer.sign(req);
    return { status: outcome.signed ? 200 : statusForRejection(outcome.code), body: outcome };
  });
  authed("/wallets/create", MandateIdBody, async ({ mandateId }) => {
    const r = await wallets.createEnvelope(mandateId);
    return { status: walletStatus(r), body: r };
  });
  authed("/wallets/status", MandateIdBody, async ({ mandateId }) => {
    const r = await wallets.envelopeStatus(mandateId);
    return { status: walletStatus(r), body: r };
  });
  authed("/tx/status", TxStatusBody, async ({ orderId, txId }) => {
    const r = await wallets.txStatus(orderId, txId);
    return { status: walletStatus(r), body: r };
  });
  authed("/wallets/sweep", MandateIdBody, async ({ mandateId }) => {
    const r = await wallets.sweep(mandateId);
    return { status: walletStatus(r), body: r };
  });

  app.get("/health", async () => ({ ok: true }));
  return app;
}
