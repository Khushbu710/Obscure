import { BitrefillClient, parseMerchantProductId, type BitrefillInvoiceRaw } from "@obscura/bitrefill-client";
import type { OrderRepository } from "../repositories/orderRepository.js";

export class OrderNotFoundForInvoiceError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = "OrderNotFoundForInvoiceError";
  }
}

export class OrderNotAuthorizedForInvoiceError extends Error {
  constructor(orderId: string, status: string) {
    super(`Order ${orderId} is not in an invoiceable state (status: ${status})`);
    this.name = "OrderNotAuthorizedForInvoiceError";
  }
}

/**
 * BACKEND-ONLY. Creates and reconciles Bitrefill invoices. The AI agent must
 * never receive an instance of this class - see ProductDiscoveryService for
 * what the agent is allowed to touch, and security-architecture.md
 * principle 2.
 *
 * SECURITY INVARIANT (re-audit fix): `createInvoiceForOrder` takes an
 * `orderId`, NOT an `Order` object. It always re-fetches the canonical,
 * persisted order from `OrderRepository` and uses ONLY that record's
 * product/price/nonce - it never trusts an in-memory `Order` object a
 * caller might pass in, which could have been constructed or mutated to
 * not match what was actually authorized. The orders table itself only
 * ever has its `status` column updated post-insert (verified by
 * inspection of orderRepository.ts - product_json/price_minor/nonce are
 * write-once), but that DB-level immutability was not, by itself, enough:
 * a confused-deputy caller could still have passed a different in-memory
 * object. Re-fetching by id closes that gap regardless of what any caller
 * passes.
 */
export class InvoiceService {
  constructor(
    private readonly client: BitrefillClient,
    private readonly orders: OrderRepository,
    private readonly paymentMethod: string = "balance", // "balance" for dev/sandbox; see bitrefill-integration.md re: no crypto sandbox
  ) {}

  async createInvoiceForOrder(orderId: string): Promise<BitrefillInvoiceRaw> {
    const order = this.orders.getById(orderId);
    if (!order) throw new OrderNotFoundForInvoiceError(orderId);

    // Only ever invoice an order that actually passed guardian authorization
    // and has a live reservation against it - never a merely-proposed,
    // rejected, expired, or already-terminal order.
    if (order.status !== "reserved") {
      throw new OrderNotAuthorizedForInvoiceError(orderId, order.status);
    }

    const { productId, value } = parseMerchantProductId(order.product.merchantProductId);
    return this.client.createEsimInvoice({
      productId,
      value,
      quantity: 1,
      paymentMethod: this.paymentMethod,
      autoPay: false, // never auto-pay; payment/settlement is orchestrated separately and is simulated in the MVP - see demo-scope.md
    });
  }

  /**
   * Reconciliation ONLY - read-only. Per payment-flow.md §4 and
   * bitrefill-integration.md §4: a `payment_uncertain` order must be
   * reconciled against its EXISTING invoice, never resolved by blindly
   * creating a new one or retrying payment. This method does not create
   * anything; it is safe to call repeatedly.
   */
  async reconcileInvoice(invoiceId: string): Promise<BitrefillInvoiceRaw> {
    return this.client.getInvoiceById(invoiceId);
  }
}
