import type { DatabaseSync } from "node:sqlite";
import type { Receipt } from "@obscura/contracts";

interface ReceiptRow {
  receipt_id: string;
  order_id: string;
  commitment: string;
  signature: string;
  encrypted_payload: string;
  created_at: string;
}

const toReceipt = (r: ReceiptRow): Receipt => ({
  receiptId: r.receipt_id,
  orderId: r.order_id,
  commitment: r.commitment,
  signature: r.signature,
  encryptedPayload: r.encrypted_payload,
  createdAt: r.created_at,
});

/** `receipts.order_id` is UNIQUE: at most one receipt per order, even under a race. */
export class ReceiptRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(r: Receipt): void {
    this.db
      .prepare("INSERT INTO receipts (receipt_id, order_id, commitment, signature, encrypted_payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.receiptId, r.orderId, r.commitment, r.signature, r.encryptedPayload, r.createdAt);
  }

  getById(id: string): Receipt | null {
    const r = this.db.prepare("SELECT * FROM receipts WHERE receipt_id = ?").get(id) as ReceiptRow | undefined;
    return r ? toReceipt(r) : null;
  }

  getByOrderId(orderId: string): Receipt | null {
    const r = this.db.prepare("SELECT * FROM receipts WHERE order_id = ?").get(orderId) as ReceiptRow | undefined;
    return r ? toReceipt(r) : null;
  }

  list(): Receipt[] {
    return (this.db.prepare("SELECT * FROM receipts ORDER BY created_at DESC").all() as unknown as ReceiptRow[]).map(toReceipt);
  }
}
