import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateOrder, type TransactionIntent } from "@obscura/guardian";
import { RESERVED_STATUSES, type GuardianResponse, type Order, type ProposedOrder } from "@obscura/contracts";
import { MandateRepository, toGuardianSnapshot } from "../repositories/mandateRepository.js";
import { OrderRepository } from "../repositories/orderRepository.js";
import { NonceRepository } from "../repositories/nonceRepository.js";
import { withTransaction } from "../db/transaction.js";

export class MandateNotFoundForOrderError extends Error {
  constructor(mandateId: string) {
    super(`Mandate ${mandateId} not found`);
  }
}

export interface AuthorizeOrderResult {
  order: Order;
  guardian: GuardianResponse;
}

/**
 * Orchestrates: build the Order, call the guardian (pure function, no I/O
 * of its own), and - only on approval - atomically reserve the budget and
 * consume the nonce in the SAME database transaction as the guardian's
 * decision being acted on. This is the concrete implementation of
 * docs/architecture/payment-flow.md §1's `reserved` state and
 * security-architecture.md §4's reservation transaction.
 *
 * This service does NOT call Bitrefill itself - `verifiedPriceMinor` must
 * be supplied by the caller (the Bitrefill client / agent orchestration,
 * Phase E), which is responsible for fetching a fresh live price before
 * authorization is attempted. This keeps the guardian boundary honest: it
 * never trusts a price it didn't receive as an explicit, separate input.
 *
 * IMPORTANT INVARIANT: the callback passed to `withTransaction` below MUST
 * remain fully synchronous (no `await`, no Promise). Correctness under
 * concurrency currently relies on two things together: SQLite's
 * BEGIN IMMEDIATE taking the write lock immediately, AND Node's single
 * JS thread never yielding partway through this function. If a future
 * change (e.g. an in-transaction call out to Bitrefill or the signer)
 * introduces an `await` inside this callback, the atomicity guarantee this
 * class provides - and the concurrency test in
 * orderAuthorizationService.test.ts - no longer holds. Fetch anything
 * async (verifiedPriceMinor, etc.) BEFORE calling authorize(), never inside it.
 */
export class OrderAuthorizationService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly mandates: MandateRepository,
    private readonly orders: OrderRepository,
    private readonly nonces: NonceRepository,
    private readonly guardianHmacSecret: string,
    private readonly now: () => Date = () => new Date(),
    /**
     * Additive (2026-11-04, payment orchestration): the TRUSTED source of the
     * canonical transaction terms, used when the caller of authorize() does
     * not pass an explicit intent. Supplied by the payment-orchestration
     * layer (configured destination + fixed demo rate) - never by the agent.
     * `null` (default) keeps the earlier behaviour: no intent is bound, so the
     * signer will refuse to sign (TRANSACTION_INTENT_NOT_BOUND) - fail closed.
     */
    private readonly intentProvider: ((proposed: ProposedOrder) => TransactionIntent | null) | null = null,
  ) {}

  /**
   * `transactionIntent` (2026-11-04, signer security review): the canonical
   * destination/amount to cryptographically bind into the issued
   * authorization token, if the caller has one. This service is the right
   * place to construct it once a real settlement/payment orchestrator
   * exists (it already owns the moment of approval), but no such component
   * exists yet in this MVP - see demo-scope.md - so there is nothing honest
   * to default it to beyond `null`; callers that do have a resolved intent
   * must supply it explicitly rather than this service inventing one.
   */
  authorize(proposed: ProposedOrder, verifiedPriceMinor: number, transactionIntent: TransactionIntent | null = null): AuthorizeOrderResult {
    const nowIso = this.now().toISOString();
    // An explicit intent wins; otherwise the trusted provider; otherwise none (signer will refuse).
    const intent = transactionIntent ?? this.intentProvider?.(proposed) ?? null;

    const order: Order = {
      orderId: randomUUID(),
      mandateId: proposed.mandateId,
      product: proposed.product,
      priceMinor: proposed.priceMinor,
      nonce: randomBytes(24).toString("hex"), // backend-generated; the agent never chooses this
      status: "proposed",
      proposedAt: nowIso,
      agentReasoning: proposed.agentReasoning,
    };

    return withTransaction(this.db, () => {
      const mandate = this.mandates.getById(order.mandateId);
      if (!mandate) throw new MandateNotFoundForOrderError(order.mandateId);

      this.orders.insert(order);

      const guardianResult = validateOrder(
        {
          mandate: toGuardianSnapshot(mandate),
          order,
          verifiedPriceMinor,
          nonceAlreadyConsumed: this.nonces.isConsumed(order.nonce),
          now: nowIso,
        },
        this.guardianHmacSecret,
        intent,
      );

      if (!guardianResult.approved) {
        this.orders.setStatus(order.orderId, "rejected");
        return { order: { ...order, status: "rejected" }, guardian: guardianResult };
      }

      this.mandates.reserveSpend(mandate.id, order.priceMinor);
      this.nonces.consume(order.nonce, order.orderId, nowIso);
      this.orders.setStatus(order.orderId, "reserved");

      return { order: { ...order, status: "reserved" }, guardian: guardianResult };
    });
  }

  /**
   * Releases a reservation on failure/expiry/cancellation - see
   * payment-flow.md §1. Deliberately does NOT release a `payment_uncertain`
   * order - that state must be reconciled manually, never auto-released or
   * auto-retried (payment-flow.md §4 / bitrefill-integration.md §4).
   */
  release(order: Order): void {
    if (RESERVED_STATUSES.includes(order.status)) {
      withTransaction(this.db, () => {
        this.mandates.releaseSpend(order.mandateId, order.priceMinor);
        this.orders.setStatus(order.orderId, "failed");
      });
    }
  }
}
