import type { DatabaseSync } from "node:sqlite";
import type { OrderStatus, SettlementMode } from "@obscura/contracts";

export interface PaymentRecord {
  orderId: string;
  status: OrderStatus;
  merchantInvoiceRef: string | null;
  amountZatoshi: number | null;
  txId: string | null;
  settlementMode: SettlementMode;
}

interface PaymentRow {
  order_id: string;
  status: OrderStatus;
  merchant_invoice_ref: string | null;
  amount_zatoshi: number | null;
  tx_id: string | null;
  settlement_mode: SettlementMode;
}

/**
 * payment_intents is keyed by order_id (the idempotency key, payment-flow.md
 * section 4): `insert` of a second row for the same order throws, so a retry
 * can never create a second invoice/payment record.
 */
export class PaymentRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(orderId: string, status: OrderStatus, merchantInvoiceRef: string | null): void {
    this.db
      .prepare("INSERT INTO payment_intents (order_id, status, merchant_invoice_ref, settlement_mode) VALUES (?, ?, ?, 'simulated')")
      .run(orderId, status, merchantInvoiceRef);
  }

  getByOrderId(orderId: string): PaymentRecord | null {
    const r = this.db.prepare("SELECT * FROM payment_intents WHERE order_id = ?").get(orderId) as PaymentRow | undefined;
    return r
      ? {
          orderId: r.order_id,
          status: r.status,
          merchantInvoiceRef: r.merchant_invoice_ref,
          amountZatoshi: r.amount_zatoshi,
          txId: r.tx_id,
          settlementMode: r.settlement_mode,
        }
      : null;
  }

  setInvoiceRef(orderId: string, merchantInvoiceRef: string): void {
    this.db.prepare("UPDATE payment_intents SET merchant_invoice_ref = ? WHERE order_id = ?").run(merchantInvoiceRef, orderId);
  }

  setStatus(orderId: string, status: OrderStatus): void {
    this.db.prepare("UPDATE payment_intents SET status = ? WHERE order_id = ?").run(status, orderId);
  }

  setPayment(orderId: string, status: OrderStatus, txId: string, amountZatoshi: number): void {
    this.db
      .prepare("UPDATE payment_intents SET status = ?, tx_id = ?, amount_zatoshi = ? WHERE order_id = ?")
      .run(status, txId, amountZatoshi, orderId);
  }
}
