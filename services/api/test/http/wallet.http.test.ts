import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/http/server.js";
import { HttpSignerClient, SignerUnavailableError, type SignerGateway } from "../../src/signer/signerClient.js";
import { createTestDb } from "../testDb.js";

class FakeSigner implements SignerGateway {
  calls: string[] = [];
  refuse: { code: string; reason: string } | null = null;
  async createEnvelope(mandateId: string) {
    this.calls.push(`create:${mandateId}`);
    if (this.refuse) return { ok: false as const, ...this.refuse };
    return { ok: true as const, walletRef: `m-${mandateId}`, receivingAddress: "utest1fakeenvelope" };
  }
  async envelopeStatus(mandateId: string) {
    this.calls.push(`status:${mandateId}`);
    if (this.refuse) return { ok: false as const, ...this.refuse };
    return { ok: true as const, walletRef: `m-${mandateId}`, receivingAddress: "utest1fakeenvelope", spendableZatoshi: 5, totalZatoshi: 5, funded: true };
  }
  async sweep(mandateId: string) {
    this.calls.push(`sweep:${mandateId}`);
    if (this.refuse) return { ok: false as const, ...this.refuse };
    return { ok: true as const, tx: { txId: "abc123", status: "broadcast" } };
  }
  async sign() {
    return { signed: false as const, code: "UNUSED", reason: "not used in wallet tests" };
  }
  async txStatus() {
    return { ok: false as const, code: "UNUSED", reason: "not used in wallet tests" };
  }
}

async function mk(signer: SignerGateway | undefined) {
  const app = await buildServer(createTestDb(), { guardianHmacSecret: "s", signerGateway: signer });
  const res = await app.inject({
    method: "POST",
    url: "/api/mandates",
    payload: { allowedCategories: ["esim"], totalCapMinor: 3000, currency: "USD", durationHours: 24 },
  });
  return { app, mandateId: JSON.parse(res.payload).id as string };
}

describe("wallet routes", () => {
  let signer: FakeSigner;
  let app: FastifyInstance;
  let mandateId: string;

  beforeEach(async () => {
    signer = new FakeSigner();
    ({ app, mandateId } = await mk(signer));
  });

  it("POST /fund asks the signer for an envelope and persists only the public result", async () => {
    const res = await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/fund` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ mandateId, envelopeWalletRef: `m-${mandateId}`, receivingAddress: "utest1fakeenvelope" });
    const got = JSON.parse((await app.inject({ method: "GET", url: `/api/mandates/${mandateId}` })).payload);
    expect(got.envelopeWalletRef).toBe(`m-${mandateId}`);
    expect(got.receivingAddress).toBe("utest1fakeenvelope");
  });

  it("POST /fund does not call the signer for a revoked mandate", async () => {
    await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/revoke` });
    const res = await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/fund` });
    expect(res.statusCode).toBe(409);
    expect(signer.calls).toEqual([]);
  });

  it("GET /envelope returns live balance", async () => {
    const res = await app.inject({ method: "GET", url: `/api/mandates/${mandateId}/envelope` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ funded: true, spendableZatoshi: 5 });
  });

  it("POST /sweep relays success and maps signer refusals to 409/404", async () => {
    expect((await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/sweep` })).statusCode).toBe(200);
    signer.refuse = { code: "MANDATE_STILL_ACTIVE", reason: "Only a revoked or expired mandate can be swept." };
    const r = await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/sweep` });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.payload).error.code).toBe("MANDATE_STILL_ACTIVE");
    signer.refuse = { code: "NO_ENVELOPE", reason: "none" };
    expect((await app.inject({ method: "POST", url: `/api/mandates/${mandateId}/sweep` })).statusCode).toBe(404);
  });

  it("404s for an unknown mandate without calling the signer", async () => {
    const res = await app.inject({ method: "POST", url: "/api/mandates/99999999-9999-4999-8999-999999999999/fund" });
    expect(res.statusCode).toBe(404);
    expect(signer.calls).toEqual([]);
  });

  it("503s with SIGNER_NOT_CONFIGURED when no signer is wired", async () => {
    delete process.env.SIGNER_BASE_URL;
    const { app: bare, mandateId: id } = await mk(undefined);
    const res = await bare.inject({ method: "POST", url: `/api/mandates/${id}/fund` });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload).error.code).toBe("SIGNER_NOT_CONFIGURED");
  });
});

describe("HttpSignerClient", () => {
  it("signs the exact body with HMAC-SHA256 and returns the signer's business refusals as values", async () => {
    let seen: { url: string; sig: string; body: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, sig: (init.headers as Record<string, string>)["x-signer-signature"]!, body: String(init.body) };
      return new Response(JSON.stringify({ ok: false, code: "MANDATE_NOT_ACTIVE", reason: "x" }), { status: 409 });
    }) as unknown as typeof fetch;
    const c = new HttpSignerClient("http://signer", "secret", fetchImpl);
    expect(await c.createEnvelope("m1")).toEqual({ ok: false, code: "MANDATE_NOT_ACTIVE", reason: "x" });
    const { createHmac } = await import("node:crypto");
    expect(seen!.url).toBe("http://signer/wallets/create");
    expect(seen!.sig).toBe(createHmac("sha256", "secret").update(seen!.body).digest("hex"));
  });

  it("throws SignerUnavailableError on network failure, 401 and non-wallet JSON", async () => {
    const down = new HttpSignerClient("http://x", "s", (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    await expect(down.sweep("m")).rejects.toBeInstanceOf(SignerUnavailableError);
    const unauth = new HttpSignerClient("http://x", "s", (async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 })) as unknown as typeof fetch);
    await expect(unauth.sweep("m")).rejects.toBeInstanceOf(SignerUnavailableError);
  });
});
