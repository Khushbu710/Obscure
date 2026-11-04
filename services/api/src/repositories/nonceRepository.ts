import type { DatabaseSync } from "node:sqlite";

/**
 * The replay backstop: `consumed_nonces.nonce` is a PRIMARY KEY, so a second
 * attempt to consume the same nonce throws a UNIQUE constraint violation
 * even if every other guard in the application has a bug. See
 * docs/architecture/security-architecture.md §4.
 */
export class NonceRepository {
  constructor(private readonly db: DatabaseSync) {}

  isConsumed(nonce: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM consumed_nonces WHERE nonce = ?").get(nonce);
    return row !== undefined;
  }

  /** Must be called inside the same transaction as the budget reservation. */
  consume(nonce: string, orderId: string, consumedAt: string): void {
    this.db
      .prepare("INSERT INTO consumed_nonces (nonce, order_id, consumed_at) VALUES (?, ?, ?)")
      .run(nonce, orderId, consumedAt);
  }
}
