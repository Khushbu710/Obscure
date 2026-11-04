import type { FastifyInstance, FastifyReply } from "fastify";
import { apiError } from "@obscura/contracts";
import type { MandateService } from "../../mandate/mandateService.js";
import type { MandateRepository } from "../../repositories/mandateRepository.js";
import type { SignerGateway, WalletOpResult } from "../../signer/signerClient.js";
import { sendError } from "../errors.js";

const NOT_FOUND_CODES = new Set(["MANDATE_NOT_FOUND", "NO_ENVELOPE"]);

function sendSignerRefusal(reply: FastifyReply, r: { code: string; reason: string }): void {
  reply.code(NOT_FOUND_CODES.has(r.code) ? 404 : 409).send(apiError(r.code, r.reason));
}

/**
 * api-contracts.md "Envelope funding". The backend never touches a wallet:
 * it relays to the signer (which alone holds envelope key material) and
 * records only the public result (wallet ref + receiving address).
 */
export function registerWalletRoutes(
  app: FastifyInstance,
  mandateService: MandateService,
  mandateRepo: MandateRepository,
  /** null when SIGNER_BASE_URL/SIGNER_AUTH_SECRET are unset - routes report 503 rather than the server failing to boot. */
  signer: SignerGateway | null,
): void {
  const guard = (reply: FastifyReply): boolean => {
    if (signer) return true;
    reply.code(503).send(apiError("SIGNER_NOT_CONFIGURED", "The signer service is not configured on this server."));
    return false;
  };
  const unwrap = <T>(reply: FastifyReply, r: WalletOpResult<T>): (T & { ok: true }) | null => {
    if (r.ok) return r;
    sendSignerRefusal(reply, r);
    return null;
  };

  app.post<{ Params: { id: string } }>("/api/mandates/:id/fund", async (request, reply) => {
    if (!guard(reply) || !signer) return;
    try {
      const mandate = mandateService.get(request.params.id);
      if (mandate.status !== "active") {
        reply.code(409).send(apiError("MANDATE_NOT_ACTIVE", `Mandate is ${mandate.status}, not active.`));
        return;
      }
      const res = unwrap(reply, await signer.createEnvelope(mandate.id));
      if (!res) return;
      mandateRepo.setFunding(mandate.id, res.walletRef, res.receivingAddress);
      reply.code(200).send({ mandateId: mandate.id, envelopeWalletRef: res.walletRef, receivingAddress: res.receivingAddress });
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/api/mandates/:id/envelope", async (request, reply) => {
    if (!guard(reply) || !signer) return;
    try {
      const mandate = mandateService.get(request.params.id);
      const res = unwrap(reply, await signer.envelopeStatus(mandate.id));
      if (!res) return;
      reply.send({
        mandateId: mandate.id,
        receivingAddress: res.receivingAddress,
        spendableZatoshi: res.spendableZatoshi,
        totalZatoshi: res.totalZatoshi,
        funded: res.funded,
        fundingTxId: mandate.fundingTxId,
      });
    } catch (err) {
      sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/mandates/:id/sweep", async (request, reply) => {
    if (!guard(reply) || !signer) return;
    try {
      const mandate = mandateService.get(request.params.id);
      const res = unwrap(reply, await signer.sweep(mandate.id));
      if (!res) return;
      reply.send({ mandateId: mandate.id, sweepTxId: res.tx.txId, status: res.tx.status });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
