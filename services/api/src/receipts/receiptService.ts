import { randomBytes, randomUUID } from "node:crypto";
import type { Receipt, ReceiptPayload, SelectiveDisclosure } from "@obscura/contracts";
import type { OrderRepository } from "../repositories/orderRepository.js";
import type { PaymentRepository } from "../repositories/paymentRepository.js";
import type { ReceiptRepository } from "../repositories/receiptRepository.js";
import {
  ReceiptKeyring,
  computeCommitment,
  decryptPayload,
  encryptPayload,
  signCommitment,
  verifyCommitmentSignature,
} from "./receiptCrypto.js";

export interface ReceiptMetadata {
  receiptId: string;
  orderId: string;
  commitment: string;
  createdAt: string;
}

export class ReceiptNotFoundError extends Error {
  constructor(id: string) {
    super(`Receipt ${id} not found`);
    this.name = "ReceiptNotFoundError";
  }
}

/**
 * Creates and serves signed hash-commitment receipts for delivered orders.
 * The receipt records `settlementMode` inside the commitment itself, so the
 * receipt format discloses which parts were real (payment-flow.md section 2).
 */
export class ReceiptService {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly orders: OrderRepository,
    private readonly payments: PaymentRepository,
    private readonly keys: ReceiptKeyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Idempotent: a second call for the same order returns the existing receipt. */
  createForOrder(orderId: string): Receipt | null {
    const existing = this.receipts.getByOrderId(orderId);
    if (existing) return existing;

    const order = this.orders.getById(orderId);
    const payment = this.payments.getByOrderId(orderId);
    // Only a delivered order has a receipt - never earlier, never for a rejected/failed one.
    if (!order || !payment || order.status !== "delivered") return null;

    const payload: ReceiptPayload = {
      orderId,
      priceMinor: order.priceMinor,
      currency: order.product.currency,
      merchantId: order.product.merchantId,
      timestamp: this.now().toISOString(),
      settlementMode: payment.settlementMode,
      salt: randomBytes(16).toString("hex"),
    };
    const commitment = computeCommitment(payload);
    const receipt: Receipt = {
      receiptId: randomUUID(),
      orderId,
      commitment,
      signature: signCommitment(commitment, this.keys.signingKey),
      encryptedPayload: encryptPayload(payload, this.keys.encryptionKey),
      createdAt: payload.timestamp,
    };
    try {
      this.receipts.insert(receipt);
    } catch {
      // Lost a race with a concurrent creator: the UNIQUE(order_id) row is the winner.
      return this.receipts.getByOrderId(orderId);
    }
    return receipt;
  }

  /** Metadata only - never the decrypted payload (api-contracts.md). */
  list(): ReceiptMetadata[] {
    return this.receipts.list().map(({ receiptId, orderId, commitment, createdAt }) => ({ receiptId, orderId, commitment, createdAt }));
  }

  /** Full decrypted detail (single-user demo: the one demo owner). */
  get(receiptId: string): { receipt: Omit<Receipt, "encryptedPayload">; payload: ReceiptPayload; signatureValid: boolean } {
    const r = this.receipts.getById(receiptId);
    if (!r) throw new ReceiptNotFoundError(receiptId);
    const payload = decryptPayload<ReceiptPayload>(r.encryptedPayload, this.keys.encryptionKey);
    const { encryptedPayload: _e, ...safe } = r;
    return {
      receipt: safe,
      payload,
      signatureValid: computeCommitment(payload) === r.commitment && verifyCommitmentSignature(r.commitment, r.signature, this.keys.publicKey),
    };
  }

  /** Selective disclosure artifact for exactly one receipt. */
  disclose(receiptId: string): SelectiveDisclosure {
    const r = this.receipts.getById(receiptId);
    if (!r) throw new ReceiptNotFoundError(receiptId);
    return {
      commitment: r.commitment,
      signature: r.signature,
      disclosedFields: decryptPayload<ReceiptPayload>(r.encryptedPayload, this.keys.encryptionKey),
    };
  }

  publicKeyBase64(): string {
    return this.keys.publicKeyBase64();
  }

  isPersistent(): boolean {
    return this.keys.persistent;
  }
}
