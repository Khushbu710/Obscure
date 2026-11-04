import { beforeEach, describe, expect, it } from "vitest";
import type { CreateMandateRequest } from "@obscura/contracts";
import { MandateRepository } from "../src/repositories/mandateRepository.js";
import { MandateService, InvalidMandateTransitionError, MandateNotFoundError } from "../src/mandate/mandateService.js";
import { createTestDb } from "./testDb.js";

const REQUEST: CreateMandateRequest = {
  allowedCategories: ["esim"],
  totalCapMinor: 3000,
  currency: "USD",
  durationHours: 24,
};

describe("MandateService", () => {
  let service: MandateService;
  let fixedNow: Date;

  beforeEach(() => {
    const db = createTestDb();
    const repo = new MandateRepository(db);
    fixedNow = new Date("2026-11-04T10:00:00.000Z");
    service = new MandateService(repo, () => fixedNow);
  });

  it("creates a mandate with integer-minor-unit budget and a 24h expiry", () => {
    const mandate = service.create("user-1", REQUEST);
    expect(mandate.status).toBe("active");
    expect(mandate.totalCapMinor).toBe(3000);
    expect(mandate.spentMinor).toBe(0);
    expect(Number.isInteger(mandate.totalCapMinor)).toBe(true);
    expect(mandate.expiresAt).toBe("2026-11-05T10:00:00.000Z");
  });

  it("round-trips through the repository", () => {
    const created = service.create("user-1", REQUEST);
    const fetched = service.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("pause -> resume works", () => {
    const created = service.create("user-1", REQUEST);
    const paused = service.pause(created.id);
    expect(paused.status).toBe("paused");
    const resumed = service.resume(created.id);
    expect(resumed.status).toBe("active");
  });

  it("rejects pausing an already-paused mandate", () => {
    const created = service.create("user-1", REQUEST);
    service.pause(created.id);
    expect(() => service.pause(created.id)).toThrow(InvalidMandateTransitionError);
  });

  it("revoke is terminal and idempotent", () => {
    const created = service.create("user-1", REQUEST);
    const revoked = service.revoke(created.id);
    expect(revoked.status).toBe("revoked");
    expect(() => service.revoke(created.id)).not.toThrow();
    expect(service.get(created.id).status).toBe("revoked");
  });

  it("cannot resume a revoked mandate", () => {
    const created = service.create("user-1", REQUEST);
    service.revoke(created.id);
    expect(() => service.resume(created.id)).toThrow(InvalidMandateTransitionError);
  });

  it("computes remaining budget", () => {
    const created = service.create("user-1", REQUEST);
    expect(service.remainingBudgetMinor(created.id)).toBe(3000);
  });

  it("lazily marks a mandate expired once its expiry has passed", () => {
    const created = service.create("user-1", REQUEST);
    fixedNow = new Date("2026-11-06T00:00:00.000Z"); // past the 24h expiry
    const fetched = service.get(created.id);
    expect(fetched.status).toBe("expired");
  });

  it("throws MandateNotFoundError for an unknown id", () => {
    expect(() => service.get("00000000-0000-0000-0000-000000000000")).toThrow(MandateNotFoundError);
  });
});
