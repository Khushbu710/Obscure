import { describe, expect, it } from "vitest";
import type { Mandate } from "@obscura/contracts";
import { MandateRepository } from "../src/repositories/mandateRepository.js";
import { createTestDb } from "./testDb.js";

function paused(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "user-1",
    status: "paused",
    allowedCategories: ["esim"],
    allowedMerchants: null,
    allowedProductIds: null,
    totalCapMinor: 3000,
    perOrderCapMinor: null,
    spentMinor: 0,
    currency: "USD",
    envelopeWalletRef: null,
    receivingAddress: null,
    fundedAt: null,
    fundingTxId: null,
    createdAt: "2026-11-04T10:00:00.000Z",
    expiresAt: "2026-11-05T10:00:00.000Z",
    revokedAt: null,
    schemaVersion: 1,
    ...overrides,
  };
}

describe("MandateRepository.reserveSpend", () => {
  it("regression: throws rather than silently no-op'ing when the UPDATE affects zero rows", () => {
    const repo = new MandateRepository(createTestDb());
    repo.insert(paused()); // status != 'active', so the WHERE clause will match 0 rows
    expect(() => repo.reserveSpend(paused().id, 1000)).toThrow(/0 rows/);
  });

  it("succeeds and increments spent_minor for an active mandate", () => {
    const db = createTestDb();
    const repo = new MandateRepository(db);
    repo.insert(paused({ status: "active" }));
    repo.reserveSpend(paused().id, 1000);
    expect(repo.getById(paused().id)?.spentMinor).toBe(1000);
  });
});
