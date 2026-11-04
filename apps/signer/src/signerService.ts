import type { DatabaseSync } from "node:sqlite";
import { verifyAuthorizationToken } from "@obscura/guardian";
import type { SignerRequest, SignerResponse } from "@obscura/contracts";
import { withTransaction } from "./db/transaction.js";
import { SignerMandateRepository, SignerOrderRepository } from "./repositories.js";
import type { BlockchainAdapter } from "./blockchainAdapter.js";

const DEFAULT_ADAPTER_TIMEOUT_MS = 10_000;

/** Thrown only by the internal timeout race - never by an adapter itself. */
class AdapterTimeoutError extends Error {}

/**
 * Signer trust boundary, restated here deliberately (not just in
 * docs/architecture/security-architecture.md §3) because this is the file
 * where it matters operationally:
 *
 *   - `request.order`, `request.destinationAddress`, `request.amountZatoshi`
 *     are ALL untrusted caller input, no different in trust level from a
 *     network request, even though in this MVP the only caller is in-process
 *     backend code. They are never used directly to decide what gets signed;
 *     every field is cross-checked against the canonical row this process
 *     reads for itself, AND (2026-11-04 security review) against the
 *     `TransactionIntent` cryptographically bound into the authorization
 *     token - sign-once replay protection alone is not proof that a
 *     specific destination/amount was ever authorized, only that this
 *     particular order hasn't been consumed yet. A request whose token
 *     carries no intent (`null`) cannot be signed at all: there is nothing
 *     to verify its terms against.
 *   - `authorizationToken` is a transport binding only (per
 *     packages/guardian's own doc comment) - it proves an order+nonce+mandate
 *     (+, now, transaction-intent) combination the guardian saw, not that
 *     signing is currently safe.
 *   - The signer re-reads mandate/order state from the SAME SQLite file the
 *     backend API writes to (apps/signer/src/db/schema.sql's header comment,
 *     security-architecture.md §3's "Honest limitation"). A fully compromised
 *     backend process could still tamper with that file before the signer
 *     reads it. That is an explicit, accepted MVP limitation, not something
 *     this class can fix by itself - Plan B is a signer-owned datastore.
 *
 * Known, accepted limitation (2026-11-04 state-transition review): if this
 * process crashes between the `reserved -> authorized` transaction
 * committing and the adapter call returning, the order is left in
 * `authorized` status with its budget still reserved, and nothing in this
 * codebase automatically reconciles it - see the orders table's lack of a
 * status-transition timestamp, discussed in the review report. The adapter
 * timeout below bounds an in-process hang, but does not cover an actual
 * OS-level crash; that requires a reconciliation sweep this pass does not
 * implement.
 */
export class SignerService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly mandates: SignerMandateRepository,
    private readonly orders: SignerOrderRepository,
    private readonly hmacSecret: string,
    private readonly adapter: BlockchainAdapter,
    private readonly now: () => number = () => Date.now(),
    private readonly adapterTimeoutMs: number = DEFAULT_ADAPTER_TIMEOUT_MS,
    /**
     * Additive (2026-11-04): when set, the signer refuses to pay any
     * destination not in this fixed, operator-configured set - in addition to
     * the token's bound TransactionIntent. The agent and frontend can never
     * widen it. `null` (default) = no allowlist check (the intent binding
     * still applies).
     */
    private readonly allowedDestinations: ReadonlySet<string> | null = null,
  ) {
    // Fail closed at construction, not at first request: an unconfigured
    // signer must refuse to exist rather than silently accept/reject every
    // request the same way.
    if (!hmacSecret || hmacSecret.length === 0) {
      throw new Error("SignerService requires a non-empty HMAC secret");
    }
  }

  async sign(request: SignerRequest): Promise<SignerResponse> {
    let prepared: PreparedSign;
    try {
      const outcome = this.validateAndReserve(request);
      if (!outcome.ok) return outcome.response;
      prepared = outcome.prepared;
    } catch {
      // Database errors, or any other unexpected throw during validation -
      // fail closed, never let a raw exception (which could carry file
      // paths or other internals) escape as the response.
      return { signed: false, code: "INTERNAL_ERROR", reason: "An internal error occurred while validating the request." };
    }

    let adapterResult;
    try {
      adapterResult = await this.callAdapterWithTimeout(prepared);
    } catch (err) {
      if (err instanceof AdapterTimeoutError) {
        // The outcome is genuinely unknown - the transaction may or may not
        // have broadcast. Do NOT retry (a retry could double-send) and do
        // NOT release the reservation (the funds may already be gone) or
        // mark the order failed (it may actually have succeeded). Freeze it
        // in `payment_uncertain` - an existing, documented status this
        // codebase already treats as "requires manual reconciliation, never
        // auto-released or auto-retried" (see orderAuthorizationService.ts's
        // `release()` doc comment).
        try {
          this.orders.setStatus(prepared.orderId, "payment_uncertain");
        } catch {
          // Best-effort; the response below already reflects the uncertainty.
        }
        return {
          signed: false,
          code: "BROADCAST_UNCERTAIN",
          reason: "The blockchain adapter did not respond in time; the broadcast outcome is unknown and requires manual reconciliation.",
        };
      }
      // A definite failure asserted by the adapter itself (not a timeout) -
      // safe to treat as "never happened" and release the reservation.
      try {
        this.orders.setStatus(prepared.orderId, "failed");
        this.mandates.releaseSpend(prepared.mandateId, prepared.order.priceMinor);
      } catch {
        // Best-effort cleanup; the sign attempt is already a failure either
        // way. A failure here leaves the budget incorrectly held - a known,
        // documented residual risk (see the review report), not silently
        // pretended away.
      }
      return { signed: false, code: "ADAPTER_ERROR", reason: "The blockchain adapter failed to sign or broadcast the transaction." };
    }

    try {
      this.orders.setStatus(prepared.orderId, "broadcast");
    } catch {
      // The transaction was already signed/broadcast by the adapter; a
      // bookkeeping-write failure here must not be reported as a signing
      // failure (that would be dishonest - the funds already moved). The
      // order is left at `authorized` rather than `broadcast`, a known,
      // documented bookkeeping-drift risk requiring manual reconciliation.
    }

    return {
      signed: true,
      txProposal: {
        walletRef: prepared.mandateId,
        outputs: [{ address: prepared.destinationAddress, amountZatoshi: prepared.amountZatoshi }],
        memo: null,
      },
      signedAt: new Date(this.now()).toISOString(),
      txId: adapterResult.txId,
    };
  }

  private async callAdapterWithTimeout(prepared: PreparedSign) {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AdapterTimeoutError("adapter call timed out")), this.adapterTimeoutMs);
    });
    try {
      return await Promise.race([
        this.adapter.signAndBroadcast({
          walletRef: prepared.mandateId,
          outputs: [{ address: prepared.destinationAddress, amountZatoshi: prepared.amountZatoshi }],
          memo: null,
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Synchronous validation + the one irreversible state transition
   * (`reserved` -> `authorized`), run inside a single BEGIN IMMEDIATE
   * transaction. MUST remain fully synchronous end to end - the atomicity
   * that makes "sign exactly once under concurrency" hold depends on
   * Node never yielding to another caller mid-transaction (same invariant
   * as services/api/src/mandate/orderAuthorizationService.ts).
   */
  private validateAndReserve(request: SignerRequest): ValidationOutcome {
    const nowMs = this.now();

    const tokenResult = verifyAuthorizationToken(request.authorizationToken, this.hmacSecret, nowMs);
    if (!tokenResult.valid) {
      if (tokenResult.reason === "EXPIRED") {
        return fail("TOKEN_EXPIRED", "The authorization token has expired.");
      }
      return fail("INVALID_TOKEN", "The authorization token is malformed or has an invalid signature.");
    }
    const token = tokenResult.payload;

    // Never trust `request.order` for lookup or for its own validity - it is
    // caller-supplied. Always re-fetch the canonical row by the token's
    // orderId (the one value the token's signature actually commits to).
    const canonical = this.orders.getById(token.orderId);
    if (!canonical) {
      return fail("ORDER_MISMATCH", "No order exists for the authorized orderId.");
    }

    // Bind to the exact mandate ID, order ID, and nonce: token, canonical
    // record, and the caller-supplied order must all agree.
    if (
      token.orderId !== canonical.orderId ||
      token.orderId !== request.order.orderId ||
      token.mandateId !== canonical.mandateId ||
      token.mandateId !== request.order.mandateId ||
      token.nonce !== canonical.nonce ||
      token.nonce !== request.order.nonce
    ) {
      return fail("ORDER_MISMATCH", "The order, mandate, or nonce does not match the authorized values.");
    }

    // Bind to the exact amount and currency: the caller-supplied order must
    // match the canonical, guardian-approved price exactly.
    if (request.order.priceMinor !== canonical.priceMinor || request.order.product.currency !== canonical.product.currency) {
      return fail("AMOUNT_MISMATCH", "The order amount or currency does not match the authorized value.");
    }

    // Bind to the exact blockchain destination and amount via the token's
    // cryptographically-signed TransactionIntent - NOT via caller-supplied
    // request fields alone (2026-11-04 security review: the earlier design
    // only checked these were non-empty/positive and relied on sign-once
    // replay protection to catch tampering, which does not hold on a first
    // and only signing attempt with an already-tampered destination/amount).
    // A token issued with no intent (`null`) cannot authorize any specific
    // transaction - that is a configuration/integration gap, not a signable
    // request, and must fail closed rather than fall back to trusting the
    // caller.
    if (token.transactionIntent === null) {
      return fail(
        "TRANSACTION_INTENT_NOT_BOUND",
        "The authorization token does not carry a bound transaction intent; nothing to verify the requested destination/amount against.",
      );
    }
    if (token.transactionIntent.destinationAddress !== request.destinationAddress) {
      return fail("DESTINATION_MISMATCH", "The requested destination address does not match the authorized transaction intent.");
    }
    if (token.transactionIntent.amountZatoshi !== request.amountZatoshi) {
      return fail("AMOUNT_MISMATCH", "The requested zatoshi amount does not match the authorized transaction intent.");
    }

    if (this.allowedDestinations !== null && !this.allowedDestinations.has(request.destinationAddress)) {
      return fail("DESTINATION_MISMATCH", "The destination address is not in the signer's configured allowlist.");
    }

    // Reject expired, revoked, paused, or otherwise-non-active mandates.
    const mandate = this.mandates.getById(canonical.mandateId);
    if (!mandate) {
      return fail("MANDATE_NOT_ACTIVE", "The mandate for this order no longer exists.");
    }
    if (mandate.status !== "active") {
      return fail("MANDATE_NOT_ACTIVE", `The mandate is ${mandate.status}, not active.`);
    }
    if (new Date(mandate.expiresAt).getTime() <= nowMs) {
      return fail("MANDATE_NOT_ACTIVE", "The mandate has expired.");
    }

    // The order must still be in `reserved` - this is both "the reservation
    // is valid" AND the replay/already-signed check in one: any order that
    // has moved past `reserved` (via a prior successful sign, or because it
    // was never approved) cannot be signed again. This is a SEPARATE concern
    // from the transaction-intent binding above: this prevents re-signing
    // an already-consumed order at all, regardless of what terms a replay
    // attempt claims; it is not what makes those terms trustworthy in the
    // first place.
    if (canonical.status !== "reserved") {
      return fail("NONCE_ALREADY_CONSUMED", `Order is in status '${canonical.status}', not 'reserved' - it has already been signed or was never approved.`);
    }

    // Atomic compare-and-set: the actual concurrency-safety mechanism. Two
    // concurrent sign() calls for the same order will both reach this point
    // having both seen status === 'reserved' above, but only one UPDATE can
    // win inside this BEGIN IMMEDIATE transaction - the loser observes
    // `changes === 0` and is rejected here, not after an adapter call.
    const transitioned = withTransaction(this.db, () => this.orders.compareAndSetStatus(canonical.orderId, "reserved", "authorized"));
    if (!transitioned) {
      return fail("NONCE_ALREADY_CONSUMED", "Order was concurrently signed by another request.");
    }

    return {
      ok: true,
      prepared: {
        orderId: canonical.orderId,
        mandateId: canonical.mandateId,
        destinationAddress: request.destinationAddress,
        amountZatoshi: request.amountZatoshi,
        order: canonical,
      },
    };
  }
}

interface PreparedSign {
  orderId: string;
  mandateId: string;
  destinationAddress: string;
  amountZatoshi: number;
  order: { priceMinor: number };
}

type ValidationOutcome = { ok: true; prepared: PreparedSign } | { ok: false; response: SignerResponse };

function fail(code: Extract<SignerResponse, { signed: false }>["code"], reason: string): ValidationOutcome {
  return { ok: false, response: { signed: false, code, reason } };
}
