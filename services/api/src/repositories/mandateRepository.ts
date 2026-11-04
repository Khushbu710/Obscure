import type { DatabaseSync } from "node:sqlite";
import type { Mandate, MandateSnapshotForGuardian, MandateStatus } from "@obscura/contracts";

interface MandateRow {
  id: string;
  user_id: string;
  status: MandateStatus;
  allowed_categories: string;
  allowed_merchants: string | null;
  allowed_product_ids: string | null;
  total_cap_minor: number;
  per_order_cap_minor: number | null;
  spent_minor: number;
  currency: string;
  envelope_wallet_ref: string | null;
  receiving_address: string | null;
  funded_at: string | null;
  funding_tx_id: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  schema_version: number;
}

function rowToMandate(row: MandateRow): Mandate {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    allowedCategories: JSON.parse(row.allowed_categories),
    allowedMerchants: row.allowed_merchants ? JSON.parse(row.allowed_merchants) : null,
    allowedProductIds: row.allowed_product_ids ? JSON.parse(row.allowed_product_ids) : null,
    totalCapMinor: row.total_cap_minor,
    perOrderCapMinor: row.per_order_cap_minor,
    spentMinor: row.spent_minor,
    currency: row.currency,
    envelopeWalletRef: row.envelope_wallet_ref,
    receivingAddress: row.receiving_address,
    fundedAt: row.funded_at,
    fundingTxId: row.funding_tx_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    schemaVersion: row.schema_version,
  };
}

export function toGuardianSnapshot(mandate: Mandate): MandateSnapshotForGuardian {
  return {
    id: mandate.id,
    status: mandate.status,
    allowedCategories: mandate.allowedCategories,
    allowedMerchants: mandate.allowedMerchants,
    allowedProductIds: mandate.allowedProductIds,
    totalCapMinor: mandate.totalCapMinor,
    perOrderCapMinor: mandate.perOrderCapMinor,
    spentMinor: mandate.spentMinor,
    currency: mandate.currency,
    expiresAt: mandate.expiresAt,
  };
}

export class MandateRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(mandate: Mandate): void {
    this.db
      .prepare(
        `INSERT INTO mandates (
          id, user_id, status, allowed_categories, allowed_merchants, allowed_product_ids,
          total_cap_minor, per_order_cap_minor, spent_minor, currency,
          envelope_wallet_ref, receiving_address, funded_at, funding_tx_id,
          created_at, expires_at, revoked_at, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mandate.id,
        mandate.userId,
        mandate.status,
        JSON.stringify(mandate.allowedCategories),
        mandate.allowedMerchants ? JSON.stringify(mandate.allowedMerchants) : null,
        mandate.allowedProductIds ? JSON.stringify(mandate.allowedProductIds) : null,
        mandate.totalCapMinor,
        mandate.perOrderCapMinor,
        mandate.spentMinor,
        mandate.currency,
        mandate.envelopeWalletRef,
        mandate.receivingAddress,
        mandate.fundedAt,
        mandate.fundingTxId,
        mandate.createdAt,
        mandate.expiresAt,
        mandate.revokedAt,
        mandate.schemaVersion,
      );
  }

  getById(id: string): Mandate | null {
    const row = this.db.prepare("SELECT * FROM mandates WHERE id = ?").get(id) as MandateRow | undefined;
    return row ? rowToMandate(row) : null;
  }

  listByUser(userId: string): Mandate[] {
    const rows = this.db
      .prepare("SELECT * FROM mandates WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as MandateRow[];
    return rows.map(rowToMandate);
  }

  setStatus(id: string, status: MandateStatus, revokedAt: string | null): void {
    this.db
      .prepare("UPDATE mandates SET status = ?, revoked_at = COALESCE(?, revoked_at) WHERE id = ?")
      .run(status, revokedAt, id);
  }

  setFunding(id: string, envelopeWalletRef: string, receivingAddress: string): void {
    this.db
      .prepare("UPDATE mandates SET envelope_wallet_ref = ?, receiving_address = ? WHERE id = ?")
      .run(envelopeWalletRef, receivingAddress, id);
  }

  markFunded(id: string, fundedAt: string, fundingTxId: string): void {
    this.db
      .prepare("UPDATE mandates SET funded_at = ?, funding_tx_id = ? WHERE id = ?")
      .run(fundedAt, fundingTxId, id);
  }

  /**
   * Only safe to call from inside the reservation transaction - see
   * orderAuthorizationService.ts. Throws if the UPDATE affected zero rows
   * (e.g. the mandate's status changed between the guardian's read and this
   * write) rather than silently proceeding as if the reservation succeeded -
   * fail closed, never assume a write applied.
   */
  reserveSpend(id: string, amountMinor: number): void {
    const result = this.db
      .prepare("UPDATE mandates SET spent_minor = spent_minor + ? WHERE id = ? AND status = 'active'")
      .run(amountMinor, id);
    if (result.changes === 0) {
      throw new Error(`reserveSpend affected 0 rows for mandate ${id} - refusing to proceed as if it succeeded`);
    }
  }

  /** Releases a previously-reserved amount back to available budget (failed/rejected/expired/cancelled). */
  releaseSpend(id: string, amountMinor: number): void {
    this.db.prepare("UPDATE mandates SET spent_minor = spent_minor - ? WHERE id = ?").run(amountMinor, id);
  }
}
