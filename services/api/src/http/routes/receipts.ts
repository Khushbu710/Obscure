import type { FastifyInstance } from "fastify";
import { apiError } from "@obscura/contracts";
import { ReceiptNotFoundError, type ReceiptService } from "../../receipts/receiptService.js";
import { sendError } from "../errors.js";

/**
 * api-contracts.md "Receipts". Single-user demo, so "owner-only" means the
 * one demo owner. Disclosure never describes itself as zero-knowledge.
 */
export function registerReceiptRoutes(app: FastifyInstance, receipts: ReceiptService): void {
  // Registered before /:id so "public-key" is never parsed as an id.
  app.get("/api/receipts/public-key", async (_req, reply) => {
    reply.send({ algorithm: "Ed25519", format: "SPKI-DER-base64", publicKey: receipts.publicKeyBase64(), persistentKeys: receipts.isPersistent() });
  });

  app.get("/api/receipts", async (_req, reply) => {
    reply.send(receipts.list());
  });

  app.get<{ Params: { id: string } }>("/api/receipts/:id", async (request, reply) => {
    try {
      reply.send(receipts.get(request.params.id));
    } catch (err) {
      if (err instanceof ReceiptNotFoundError) reply.code(404).send(apiError("RECEIPT_NOT_FOUND", err.message));
      else sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/receipts/:id/disclose", async (request, reply) => {
    try {
      reply.send(receipts.disclose(request.params.id));
    } catch (err) {
      if (err instanceof ReceiptNotFoundError) reply.code(404).send(apiError("RECEIPT_NOT_FOUND", err.message));
      else sendError(reply, err);
    }
  });
}
