import type { DatabaseSync } from "node:sqlite";

/**
 * The signer's own, deliberately small view of persisted state. It does NOT
 * import the backend's repositories: the signer must re-derive its verdict
 * from persisted rows itself (security-architecture.md section 3), so it keeps
 * its own narrow SQL. Honest limitation (same doc): this is the same SQLite
 * file the backend writes to - see Plan B for a signer-owned datastore.
 */
export interface StoredOrder {
  orderId: string;
  mandateId: string;
  merchantProductId: string;
  category: string;
  merchantId: string;
  priceMinor: number;
  nonce: string;
  status: string;
}

export interface StoredMandate {
  id: string;
  status: string;
  allowedCategories: string[];
  allowedMerchants: string[] | null;
  totalCapMinor: number;
  perOrderCapMinor: number | null;
  spentMinor: number;
  expiresAt: string;
  envelopeWalletRef: string | null;
}

export interface SignerStore {
  getOrder(orderId: string): StoredOrder | null;
  getMandate(mandateId: string): StoredMandate | null;
  /** The order_id that consumed this nonce, or null if never consumed. */
  nonceOwner(nonce: string): string | null;
  /** Atomic compare-and-set: returns true only if the order was `from` and is now `to`. */
  transitionOrder(orderId: string, from: string, to: string): boolean;
  /** Orders that still hold a reservation or an unconfirmed payment (a sweep must wait for these). */
  countInFlightOrders(mandateId: string): number;
  /** Failure path: mark the order failed and give the reserved budget back, atomically. */
  failAndRelease(orderId: string, mandateId: string, amountMinor: number): void;
}

export class SqliteSignerStore implements SignerStore {
  constructor(private readonly db: DatabaseSync) {}

  getOrder(orderId: string): StoredOrder | null {
    const r = this.db.prepare("SELECT * FROM orders WHERE order_id = ?").get(orderId) as
      | { order_id: string; mandate_id: string; product_json: string; price_minor: number; nonce: string; status: string }
      | undefined;
    if (!r) return null;
    const product = JSON.parse(r.product_json) as { merchantProductId: string; category: string; merchantId: string };
    return {
      orderId: r.order_id,
      mandateId: r.mandate_id,
      merchantProductId: product.merchantProductId,
      category: product.category,
      merchantId: product.merchantId,
      priceMinor: r.price_minor,
      nonce: r.nonce,
      status: r.status,
    };
  }

  getMandate(mandateId: string): StoredMandate | null {
    const r = this.db.prepare("SELECT * FROM mandates WHERE id = ?").get(mandateId) as
      | {
          id: string;
          status: string;
          allowed_categories: string;
          allowed_merchants: string | null;
          total_cap_minor: number;
          per_order_cap_minor: number | null;
          spent_minor: number;
          expires_at: string;
          envelope_wallet_ref: string | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      status: r.status,
      allowedCategories: JSON.parse(r.allowed_categories),
      allowedMerchants: r.allowed_merchants ? JSON.parse(r.allowed_merchants) : null,
      totalCapMinor: r.total_cap_minor,
      perOrderCapMinor: r.per_order_cap_minor,
      spentMinor: r.spent_minor,
      expiresAt: r.expires_at,
      envelopeWalletRef: r.envelope_wallet_ref,
    };
  }

  nonceOwner(nonce: string): string | null {
    const r = this.db.prepare("SELECT order_id FROM consumed_nonces WHERE nonce = ?").get(nonce) as { order_id: string } | undefined;
    return r?.order_id ?? null;
  }

  countInFlightOrders(mandateId: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE mandate_id = ? AND status IN ('reserved','authorized','signed','broadcast','mined','payment_uncertain')")
      .get(mandateId) as { n: number };
    return r.n;
  }

  transitionOrder(orderId: string, from: string, to: string): boolean {
    return this.db.prepare("UPDATE orders SET status = ? WHERE order_id = ? AND status = ?").run(to, orderId, from).changes === 1;
  }

  failAndRelease(orderId: string, mandateId: string, amountMinor: number): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db.prepare("UPDATE orders SET status = 'failed' WHERE order_id = ? AND status = 'signed'").run(orderId).changes;
      if (changed === 1) {
        this.db.prepare("UPDATE mandates SET spent_minor = spent_minor - ? WHERE id = ?").run(amountMinor, mandateId);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
