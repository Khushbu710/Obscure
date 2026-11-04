import { randomUUID } from "node:crypto";
import type { CreateMandateRequest, Mandate } from "@obscura/contracts";
import { MandateRepository } from "../repositories/mandateRepository.js";

export class MandateNotFoundError extends Error {
  constructor(id: string) {
    super(`Mandate ${id} not found`);
  }
}

export class InvalidMandateTransitionError extends Error {
  constructor(id: string, from: string, to: string) {
    super(`Mandate ${id} cannot transition from ${from} to ${to}`);
  }
}

/**
 * Mandate lifecycle + budget accounting. This service owns everything about
 * a mandate EXCEPT the authorization decision itself - that's the guardian's
 * job (see orderAuthorizationService.ts). This file never imports the
 * guardian package.
 */
export class MandateService {
  constructor(
    private readonly mandates: MandateRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(userId: string, request: CreateMandateRequest): Mandate {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + request.durationHours * 60 * 60 * 1000);

    const mandate: Mandate = {
      id: randomUUID(),
      userId,
      status: "active",
      allowedCategories: request.allowedCategories,
      allowedMerchants: request.allowedMerchants ?? null,
      allowedProductIds: request.allowedProductIds ?? null,
      totalCapMinor: request.totalCapMinor,
      perOrderCapMinor: request.perOrderCapMinor ?? null,
      spentMinor: 0,
      currency: request.currency,
      envelopeWalletRef: null,
      receivingAddress: null,
      fundedAt: null,
      fundingTxId: null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      schemaVersion: 1,
    };

    this.mandates.insert(mandate);
    return mandate;
  }

  get(id: string): Mandate {
    const mandate = this.mandates.getById(id);
    if (!mandate) throw new MandateNotFoundError(id);
    return this.withLiveExpiry(mandate);
  }

  listForUser(userId: string): Mandate[] {
    return this.mandates.listByUser(userId).map((m) => this.withLiveExpiry(m));
  }

  pause(id: string): Mandate {
    const mandate = this.get(id);
    if (mandate.status !== "active") {
      throw new InvalidMandateTransitionError(id, mandate.status, "paused");
    }
    this.mandates.setStatus(id, "paused", null);
    return this.get(id);
  }

  resume(id: string): Mandate {
    const mandate = this.get(id);
    if (mandate.status !== "paused") {
      throw new InvalidMandateTransitionError(id, mandate.status, "active");
    }
    this.mandates.setStatus(id, "active", null);
    return this.get(id);
  }

  revoke(id: string): Mandate {
    const mandate = this.get(id);
    if (mandate.status === "revoked") return mandate; // idempotent
    this.mandates.setStatus(id, "revoked", this.now().toISOString());
    return this.get(id);
  }

  remainingBudgetMinor(id: string): number {
    const mandate = this.get(id);
    return mandate.totalCapMinor - mandate.spentMinor;
  }

  /**
   * Expiry is time-based, not an event someone has to trigger - so we
   * compute it live on every read rather than relying on a background job
   * to flip the stored status. The stored `status` column still gets
   * written to 'expired' lazily the first time this is observed, so
   * subsequent direct SQL reads are also consistent.
   */
  private withLiveExpiry(mandate: Mandate): Mandate {
    if (mandate.status === "active" && Date.parse(mandate.expiresAt) <= this.now().getTime()) {
      this.mandates.setStatus(mandate.id, "expired", null);
      return { ...mandate, status: "expired" };
    }
    return mandate;
  }
}
