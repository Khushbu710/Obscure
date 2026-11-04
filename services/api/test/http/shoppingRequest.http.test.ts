import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { BitrefillClient } from "@obscura/bitrefill-client";
import { buildServer } from "../../src/http/server.js";
import { createTestDb } from "../testDb.js";
import { FakeLlmDriver, finalTextStep, toolUseStep } from "../agent/fakeDriver.js";

const SECRET = "test-secret";

const JAPAN_FIXTURE = {
  data: {
    id: "bitrefill-esim-japan",
    name: "Japan eSIM",
    currency: "USD",
    packages: [{ package_id: "bitrefill-esim-japan<&>5gb", value: "5GB, 30 Days", price: 12.5 }],
  },
};

function fixtureFetch(onRequest?: (url: string) => void): typeof fetch {
  return vi.fn(async (url: string | URL) => {
    onRequest?.(String(url));
    const match = String(url).match(/\/products\/esims\/([^/?]+)/);
    if (match?.[1] === "bitrefill-esim-japan") {
      return new Response(JSON.stringify(JAPAN_FIXTURE), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error_code: "not_found", message: "no such product" }), { status: 404 });
  }) as unknown as typeof fetch;
}

async function buildTestServer(driver: FakeLlmDriver, onBitrefillRequest?: (url: string) => void) {
  const db = createTestDb();
  const bitrefillClient = new BitrefillClient({ apiKey: "test-key", fetchImpl: fixtureFetch(onBitrefillRequest) });
  const app = await buildServer(db, { guardianHmacSecret: SECRET, agentDriver: driver, bitrefillClient });
  return app;
}

async function createMandate(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/mandates",
    payload: { allowedCategories: ["esim"], totalCapMinor: 1500, currency: "USD", durationHours: 24, ...overrides },
  });
  return JSON.parse(res.payload);
}

describe("POST /api/shopping/requests", () => {
  let app: FastifyInstance;

  describe("1. Valid shopping request", () => {
    it("returns an authorized outcome with a sanitized order (no nonce, no authorizationToken)", async () => {
      app = await buildTestServer(
        new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::5GB, 30 Days" })]),
      );
      const mandate = await createMandate(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "find me a Japan eSIM" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe("authorized");
      expect(body.order.priceMinor).toBe(1250);
      expect(body.order.nonce).toBeUndefined();
      expect(body.order.authorizationToken).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(SECRET);
    });
  });

  describe("2. Missing mandate", () => {
    it("returns 404 for an unknown mandateId", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: "00000000-0000-0000-0000-000000000000", prompt: "buy something" },
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.payload).error.code).toBe("MANDATE_NOT_FOUND");
    });
  });

  describe("3. Revoked mandate", () => {
    it("returns 409 MANDATE_REVOKED without ever invoking the agent", async () => {
      const driver = new FakeLlmDriver([]);
      app = await buildTestServer(driver);
      const mandate = await createMandate(app);
      await app.inject({ method: "POST", url: `/api/mandates/${mandate.id}/revoke` });

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something" },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.payload).error.code).toBe("MANDATE_REVOKED");
    });
  });

  describe("4. Paused mandate", () => {
    it("returns 409 MANDATE_PAUSED without ever invoking the agent", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const mandate = await createMandate(app);
      await app.inject({ method: "POST", url: `/api/mandates/${mandate.id}/pause` });

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something" },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.payload).error.code).toBe("MANDATE_PAUSED");
    });
  });

  describe("5. Expired mandate", () => {
    it("returns 409 MANDATE_EXPIRED without ever invoking the agent", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const mandate = await createMandate(app, { durationHours: 1e-7 });
      await new Promise((r) => setTimeout(r, 50));

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something" },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.payload).error.code).toBe("MANDATE_EXPIRED");
    });
  });

  describe("6. Malformed request", () => {
    it("returns 400 for a missing prompt", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const mandate = await createMandate(app);
      const res = await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: mandate.id } });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for a non-uuid mandateId", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const res = await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: "not-a-uuid", prompt: "buy" } });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for an empty prompt", async () => {
      app = await buildTestServer(new FakeLlmDriver([]));
      const mandate = await createMandate(app);
      const res = await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: mandate.id, prompt: "" } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("7. Agent timeout", () => {
    it("returns 504 AGENT_TIMEOUT for a driver that never resolves, without leaking internals", async () => {
      const hangingDriver = { nextStep: () => new Promise(() => {}) };
      const db = createTestDb();
      const bitrefillClient = new BitrefillClient({ apiKey: "test-key", fetchImpl: fixtureFetch() });
      app = await buildServer(db, {
        guardianHmacSecret: SECRET,
        agentDriver: hangingDriver,
        bitrefillClient,
        agentStepTimeoutMs: 50, // short, for test speed - proves the override wiring, not the default value
      });
      const mandate = await createMandate(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something" },
      });

      expect(res.statusCode).toBe(504);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe("AGENT_TIMEOUT");
      expect(JSON.stringify(body)).not.toMatch(/at Object|at async|node_modules/); // no raw stack trace leaked
    });
  });

  describe("8. Agent malformed response", () => {
    it("returns 200 with status malformed_proposal when the agent omits merchantProductId", async () => {
      app = await buildTestServer(new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { agentReasoning: "no id given" })]));
      const mandate = await createMandate(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something" },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).status).toBe("malformed_proposal");
    });

    it("returns 200 with status no_proposal when the model ends its turn with plain text", async () => {
      app = await buildTestServer(new FakeLlmDriver([finalTextStep("I couldn't find anything suitable.")]));
      const mandate = await createMandate(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "buy something impossible" },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).status).toBe("no_proposal");
    });
  });

  describe("9. Product price exceeding mandate budget", () => {
    it("returns 200 with status rejected and code BUDGET_EXCEEDED, never reserving budget", async () => {
      app = await buildTestServer(
        new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::5GB, 30 Days" })]),
      );
      const mandate = await createMandate(app, { totalCapMinor: 100 }); // $1.00 budget, product is $12.50

      const res = await app.inject({
        method: "POST",
        url: "/api/shopping/requests",
        payload: { mandateId: mandate.id, prompt: "find me a Japan eSIM" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toMatchObject({ status: "rejected", rejection: { code: "BUDGET_EXCEEDED" } });

      const mandateAfter = JSON.parse((await app.inject({ method: "GET", url: `/api/mandates/${mandate.id}` })).payload);
      expect(mandateAfter.spentMinor).toBe(0);
    });
  });

  describe("10. Duplicate requests / budget reservation behavior", () => {
    it("a second identical request against an already-spent budget is rejected, never double-reserving", async () => {
      const makeDriver = () =>
        new FakeLlmDriver([toolUseStep("t1", "propose_purchase", { merchantProductId: "bitrefill-esim-japan::5GB, 30 Days" })]);
      const db = createTestDb();
      const bitrefillClient = new BitrefillClient({ apiKey: "test-key", fetchImpl: fixtureFetch() });
      // Exactly one $12.50 order fits in a $12.50 budget.
      app = await buildServer(db, { guardianHmacSecret: SECRET, agentDriver: makeDriver(), bitrefillClient });
      const mandate = await createMandate(app, { totalCapMinor: 1250 });

      const first = await app.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: mandate.id, prompt: "japan esim" } });

      // Rebuild the server with a fresh driver instance for the second call (FakeLlmDriver's script is single-use), same db/mandate.
      const app2 = await buildServer(db, { guardianHmacSecret: SECRET, agentDriver: makeDriver(), bitrefillClient });
      const second = await app2.inject({ method: "POST", url: "/api/shopping/requests", payload: { mandateId: mandate.id, prompt: "japan esim" } });

      expect(JSON.parse(first.payload).status).toBe("authorized");
      expect(JSON.parse(second.payload)).toMatchObject({ status: "rejected", rejection: { code: "BUDGET_EXCEEDED" } });

      const mandateAfter = JSON.parse((await app.inject({ method: "GET", url: `/api/mandates/${mandate.id}` })).payload);
      expect(mandateAfter.spentMinor).toBe(1250); // not 2500 - no double reservation
    });
  });

  describe("Security: agent-not-configured degrades honestly", () => {
    it("returns 503 AGENT_NOT_CONFIGURED when no driver/Bitrefill client is available, rather than crashing", async () => {
      const db = createTestDb();
      const savedGemini = process.env.GEMINI_API_KEY;
      const savedBitrefill = process.env.BITREFILL_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.BITREFILL_API_KEY;
      try {
        const unconfiguredApp = await buildServer(db, { guardianHmacSecret: SECRET });
        const mandate = await createMandate(unconfiguredApp);
        const res = await unconfiguredApp.inject({
          method: "POST",
          url: "/api/shopping/requests",
          payload: { mandateId: mandate.id, prompt: "buy something" },
        });
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.payload).error.code).toBe("AGENT_NOT_CONFIGURED");
      } finally {
        if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
        if (savedBitrefill !== undefined) process.env.BITREFILL_API_KEY = savedBitrefill;
      }
    });
  });
});
