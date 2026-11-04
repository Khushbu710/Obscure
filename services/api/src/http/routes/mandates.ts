import type { FastifyInstance } from "fastify";
import { CreateMandateRequestSchema } from "@obscura/contracts";
import type { MandateService } from "../../mandate/mandateService.js";
import { sendError } from "../errors.js";

// Hackathon-scoped: single hardcoded demo user, no multi-tenant auth.
// See docs/architecture/api-contracts.md "Auth model" for why this is
// intentional, not an oversight.
const DEMO_USER_ID = "demo-user";

export function registerMandateRoutes(app: FastifyInstance, mandateService: MandateService): void {
  app.post("/api/mandates", async (request, reply) => {
    const parsed = CreateMandateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid mandate request", details: parsed.error.flatten() } });
      return;
    }
    try {
      const mandate = mandateService.create(DEMO_USER_ID, parsed.data);
      reply.code(201).send(mandate);
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.get("/api/mandates", async (_request, reply) => {
    reply.send(mandateService.listForUser(DEMO_USER_ID));
  });

  app.get<{ Params: { id: string } }>("/api/mandates/:id", async (request, reply) => {
    try {
      reply.send(mandateService.get(request.params.id));
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/mandates/:id/pause", async (request, reply) => {
    try {
      reply.send(mandateService.pause(request.params.id));
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/mandates/:id/resume", async (request, reply) => {
    try {
      reply.send(mandateService.resume(request.params.id));
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/mandates/:id/revoke", async (request, reply) => {
    try {
      reply.send(mandateService.revoke(request.params.id));
    } catch (err) {
      sendError(reply, err);
    }
  });
}
