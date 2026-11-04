import { beforeEach, describe, expect, it } from "vitest";
import type { CreateMandateRequest, ProposedOrder } from "@obscura/contracts";
import { MandateRepository } from "../src/repositories/mandateRepository.js";
import { OrderRepository } from "../src/repositories/orderRepository.js";
import { NonceRepository } from "../src/repositories/nonceRepository.js";
import { MandateService } from "../src/mandate/mandateService.js";
import { OrderAuthorizationService } from "../src/mandate/orderAuthorizationService.js";
import { createTestDb } from "./testDb.js";

const SECRET = "test-secret";

function esimOrder(mandateId: string, priceMinor = 1000): ProposedOrder {
  return {
    mandateId,
    product: {
      merchantProductId: "esim-japan-5gb",
      name: "Japan 5GB eSIM",
      priceMinor,
      currency: "USD",
      category: "esim",
      merchantId: "bitrefill-esim-jp",
    },
    priceMinor,
  };
}

const MANDATE_REQUEST: CreateMandateRequest = {
  allowedCategories: ["esim"],
  totalCapMinor: 1500,
  currency: "USD",
  durationHours: 24,
};

describe("OrderAuthorizationService", () => {
  let mandateService: MandateService;
  let authService: OrderAuthorizationService;
  let mandateId: string;

  beforeEach(() => {
    const db = createTestDb();
    const mandateRepo = new MandateRepository(db);
    const orderRepo = new OrderRepository(db);
    const nonceRepo = new NonceRepository(db);
    mandateService = new MandateService(mandateRepo);
    authService = new OrderAuthorizationService(db, mandateRepo, orderRepo, nonceRepo, SECRET);
    mandateId = mandateService.create("user-1", MANDATE_REQUEST).id;
  });

  it("approves a valid order, reserves budget, and marks the order reserved", () => {
    const { order, guardian } = authService.authorize(esimOrder(mandateId, 1000), 1000);
    expect(guardian.approved).toBe(true);
    expect(order.status).toBe("reserved");
    expect(mandateService.get(mandateId).spentMinor).toBe(1000);
  });

  it("rejects on price mismatch and does not touch the budget", () => {
    const { order, guardian } = authService.authorize(esimOrder(mandateId, 1000), 1900);
    expect(guardian).toMatchObject({ approved: false, code: "PRICE_MISMATCH" });
    expect(order.status).toBe("rejected");
    expect(mandateService.get(mandateId).spentMinor).toBe(0);
  });

  it("rejects a second order that would exceed the remaining budget", () => {
    authService.authorize(esimOrder(mandateId, 1000), 1000);
    const { guardian } = authService.authorize(esimOrder(mandateId, 1000), 1000);
    expect(guardian).toMatchObject({ approved: false, code: "BUDGET_EXCEEDED" });
    expect(mandateService.get(mandateId).spentMinor).toBe(1000); // unchanged by the rejected attempt
  });

  it("release() returns a reserved amount to available budget", () => {
    const { order } = authService.authorize(esimOrder(mandateId, 1000), 1000);
    expect(mandateService.get(mandateId).spentMinor).toBe(1000);
    authService.release(order);
    expect(mandateService.get(mandateId).spentMinor).toBe(0);
  });

  it("CONCURRENCY: exactly one of two simultaneous near-budget-exhausting orders is approved", async () => {
    // Budget is 1500; two orders of 1000 each cannot both fit.
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => authService.authorize(esimOrder(mandateId, 1000), 1000)),
      Promise.resolve().then(() => authService.authorize(esimOrder(mandateId, 1000), 1000)),
    ]);

    const approvals = [a, b].filter((r) => r.guardian.approved);
    const rejections = [a, b].filter((r) => !r.guardian.approved);

    expect(approvals).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].guardian).toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(mandateService.get(mandateId).spentMinor).toBe(1000); // never double-spent
  });

  it("rejects an order against a revoked mandate", () => {
    mandateService.revoke(mandateId);
    const { guardian } = authService.authorize(esimOrder(mandateId, 1000), 1000);
    expect(guardian).toMatchObject({ approved: false, code: "MANDATE_REVOKED" });
  });

  it("generates a backend-controlled nonce the caller cannot influence", () => {
    const { order } = authService.authorize(esimOrder(mandateId, 1000), 1000);
    expect(order.nonce).toBeDefined();
    expect(order.nonce.length).toBeGreaterThanOrEqual(32);
  });
});
