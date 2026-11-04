import type { DatabaseSync } from "node:sqlite";
import type { Mandate, MandateStatus, Order, OrderStatus, Product } from "@obscura/contracts";

// Deliberately narrower than services/api's repositories: the signer only
// needs enough of `mandates`/`orders` to independently re-validate an
// authorization and record its own outcome. It never reads/writes
// `consumed_nonces` or `payment_intents` - those stay the guardian/backend's
// concern (see schema.sql's header comment on why this is duplicated, not
// imported).

interface MandateRow {
  id: string;
  status: MandateStatus;
  total_cap_minor: number;
  per_order_cap_minor: number | null;
  spent_minor: number;
  currency: string;
  expires_at: string;
}

function rowToMandate(row: MandateRow): Pick<Mandate, "id" | "status" | "totalCapMinor" | "perOrderCapMinor" | "spentMinor" | "currency" | "expiresAt"> {
  return {
    id: row.id,
    status: row.status,
    totalCapMinor: row.total_cap_minor,
    perOrderCapMinor: row.per_order_cap_minor,
    spentMinor: row.spent_minor,
    currency: row.currency,
    expiresAt: row.expires_at,
  };
}

export class SignerMandateRepository {
  constructor(private readonly db: DatabaseSync) {}

  getById(id: string) {
    const row = this.db
      .prepare(
        "SELECT id, status, total_cap_minor, per_order_cap_minor, spent_minor, currency, expires_at FROM mandates WHERE id = ?",
      )
      .get(id) as MandateRow | undefined;
    return row ? rowToMandate(row) : null;
  }

  /**
   * Additive (2026-11-04, wallet operations): the fields the envelope
   * create/status/sweep operations need. Read-only; never used to authorize a
   * payment (SignerService.sign does that from its own checks).
   */
  getEnvelopeInfo(id: string): { status: MandateStatus; expiresAt: string; envelopeWalletRef: string | null } | null {
    const row = this.db.prepare("SELECT status, expires_at, envelope_wallet_ref FROM mandates WHERE id = ?").get(id) as
      | { status: MandateStatus; expires_at: string; envelope_wallet_ref: string | null }
      | undefined;
    return row ? { status: row.status, expiresAt: row.expires_at, envelopeWalletRef: row.envelope_wallet_ref } : null;
  }

  /** Releases a reservation back to available budget on signing/adapter failure. */
  releaseSpend(id: string, amountMinor: number): void {
    this.db.prepare("UPDATE mandates SET spent_minor = spent_minor - ? WHERE id = ?").run(amountMinor, id);
  }
}

interface OrderRow {
  order_id: string;
  mandate_id: string;
  product_json: string;
  price_minor: number;
  nonce: string;
  status: OrderStatus;
  proposed_at: string;
  agent_reasoning: string | null;
}

function rowToOrder(row: OrderRow): Order {
  const product: Product = JSON.parse(row.product_json);
  return {
    orderId: row.order_id,
    mandateId: row.mandate_id,
    product,
    priceMinor: row.price_minor,
    nonce: row.nonce,
    status: row.status,
    proposedAt: row.proposed_at,
    agentReasoning: row.agent_reasoning ?? undefined,
  };
}

export class SignerOrderRepository {
  constructor(private readonly db: DatabaseSync) {}

  getById(orderId: string): Order | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE order_id = ?").get(orderId) as OrderRow | undefined;
    return row ? rowToOrder(row) : null;
  }

  /**
   * Atomic compare-and-set: only transitions status if the order is still
   * in `fromStatus`. Returns false (and leaves the row untouched) if it
   * isn't - this is what makes "sign exactly once, even under concurrent
   * requests" hold without a separate lock: two concurrent callers racing
   * this statement inside a BEGIN IMMEDIATE transaction will have the
   * second one observe zero affected rows.
   */
  compareAndSetStatus(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
    const result = this.db
      .prepare("UPDATE orders SET status = ? WHERE order_id = ? AND status = ?")
      .run(toStatus, orderId, fromStatus);
    return result.changes !== 0;
  }

  /** Orders that still hold a reservation or an unconfirmed payment - a sweep must wait for these. */
  countInFlight(mandateId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM orders WHERE mandate_id = ? AND status IN ('reserved','authorized','signed','broadcast','mined','payment_uncertain')",
      )
      .get(mandateId) as { n: number };
    return row.n;
  }

  setStatus(orderId: string, status: OrderStatus): void {
    this.db.prepare("UPDATE orders SET status = ? WHERE order_id = ?").run(status, orderId);
  }
}
