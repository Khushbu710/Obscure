import type { Order, OrderStatus } from "@obscura/contracts";
import type { OrderRepository } from "../repositories/orderRepository.js";
import type { PaymentRecord, PaymentRepository } from "../repositories/paymentRepository.js";
import type { OrderAuthorizationService } from "../mandate/orderAuthorizationService.js";
import type { SignerGateway } from "../signer/signerClient.js";

/** Anything that can create an invoice for an already-authorized order id (the real InvoiceService, or a fake). */
export interface InvoiceCreator {
  createInvoiceForOrder(orderId: string): Promise<{ id: string }>;
}

/**
 * Shown verbatim wherever a delivered order is displayed. The MVP never
 * pays the Bitrefill invoice - testnet TAZ has no market value, so no swap
 * provider can convert it (demo-scope.md section 2/4). This label must
 * never be omitted or softened by any consumer of PaymentView.
 */
export const SIMULATED_SETTLEMENT_LABEL =
  "SIMULATED SETTLEMENT: the Zcash testnet transaction is real, but testnet funds cannot be converted into anything Bitrefill accepts, so the Bitrefill invoice was NOT paid and nothing was actually delivered.";

export type StartOutcome =
  | { kind: "submitted"; txId: string }
  | { kind: "already_started" }
  | { kind: "not_reserved"; status: string }
  | { kind: "invoice_failed" }
  | { kind: "signer_rejected"; code: string; reason: string }
  | { kind: "signer_unavailable" }
  | { kind: "payment_uncertain" };

export interface PaymentView {
  orderId: string;
  status: OrderStatus;
  settlementMode: "simulated" | "real";
  merchantInvoiceRef: string | null;
  txId: string | null;
  amountZatoshi: number | null;
  /** Present only once delivered, and always explicitly labelled simulated. */
  simulatedDelivery: { simulated: true; label: string } | null;
}

const SIGNED_STATES: OrderStatus[] = ["signed", "broadcast", "mined"];

/**
 * Orchestrates everything AFTER guardian authorization (payment-flow.md):
 * invoice -> signer -> confirmation tracking -> simulated settlement.
 *
 * Invariants:
 *  - `order_id` in payment_intents is claimed FIRST, so a retry can never
 *    create a second invoice or a second payment (idempotency by orderId).
 *  - An uncertain outcome is NEVER auto-retried or auto-released
 *    (`payment_uncertain` requires manual reconciliation).
 *  - Only the signer ever pays; this class holds no wallet or key.
 */
export class PaymentService {
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly refreshing = new Set<string>();

  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: PaymentRepository,
    private readonly authService: OrderAuthorizationService,
    private readonly invoices: InvoiceCreator,
    private readonly signer: SignerGateway,
    private readonly opts: {
      confirmationTimeoutMs?: number;
      now?: () => Date;
      onError?: (e: unknown) => void;
      /** Called once an order reaches `delivered` (e.g. to create its receipt). Must not throw into the payment path. */
      onDelivered?: (orderId: string) => void;
    } = {},
  ) {}

  /** Fire-and-forget wrapper used by the HTTP layer; errors are reported, never thrown into a request. */
  start(order: Order, authorizationToken: string): void {
    const p = this.execute(order, authorizationToken).catch((e) => this.opts.onError?.(e));
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  /** Resolves when every started payment has finished (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async execute(order: Order, authorizationToken: string): Promise<StartOutcome> {
    const stored = this.orders.getById(order.orderId);
    if (!stored || stored.status !== "reserved") return { kind: "not_reserved", status: stored?.status ?? "missing" };

    // Claim the order id before any external side effect.
    try {
      this.payments.insert(order.orderId, "reserved", null);
    } catch {
      return { kind: "already_started" };
    }

    try {
      const invoice = await this.invoices.createInvoiceForOrder(order.orderId);
      this.payments.setInvoiceRef(order.orderId, invoice.id);
    } catch {
      // Nothing has been signed or paid yet: safe to release the reservation.
      this.authService.release(stored);
      this.payments.setStatus(order.orderId, "failed");
      return { kind: "invoice_failed" };
    }

    let outcome;
    try {
      outcome = await this.signer.sign({ authorizationToken, order: stored });
    } catch {
      return this.resolveUnreachableSigner(order.orderId);
    }

    if (!outcome.signed) {
      const current = this.orders.getById(order.orderId);
      if (current) this.authService.release(current);
      this.payments.setStatus(order.orderId, "failed");
      return { kind: "signer_rejected", code: outcome.code, reason: outcome.reason };
    }

    // Record the broadcast ourselves rather than relying on the signer's write to a
    // shared database (idempotent today; required if the signer gets its own datastore).
    this.orders.setStatus(order.orderId, "broadcast");
    this.payments.setPayment(order.orderId, "broadcast", outcome.tx.txId, outcome.amountZatoshi);
    return { kind: "submitted", txId: outcome.tx.txId };
  }

  /**
   * The signer call threw (network / 5xx). We share one database with the
   * signer, so the persisted order status says how far it got.
   */
  private resolveUnreachableSigner(orderId: string): StartOutcome {
    const current = this.orders.getById(orderId);
    if (!current) return { kind: "signer_unavailable" };
    if (current.status === "reserved") {
      // Never signed: nothing moved. Release.
      this.authService.release(current);
      this.payments.setStatus(orderId, "failed");
      return { kind: "signer_unavailable" };
    }
    if (current.status === "failed") {
      // Signer hit a definitive wallet failure and already released the budget.
      this.payments.setStatus(orderId, "failed");
      return { kind: "signer_unavailable" };
    }
    if (SIGNED_STATES.includes(current.status)) {
      // It may have broadcast. Hold the budget; never retry, never release.
      this.orders.setStatus(orderId, "payment_uncertain");
      this.payments.setStatus(orderId, "payment_uncertain");
      return { kind: "payment_uncertain" };
    }
    return { kind: "signer_unavailable" };
  }

  /**
   * Advances an in-flight payment by one observation of the chain. Safe to
   * call repeatedly (e.g. on every GET /api/orders/:id).
   */
  async refresh(orderId: string): Promise<PaymentView | null> {
    const order = this.orders.getById(orderId);
    const pay = this.payments.getByOrderId(orderId);
    if (!order || !pay) return null;

    if ((order.status === "broadcast" || order.status === "mined") && pay.txId && !this.refreshing.has(orderId)) {
      this.refreshing.add(orderId);
      try {
        await this.advance(order, pay.txId);
      } finally {
        this.refreshing.delete(orderId);
      }
    }
    return this.view(orderId);
  }

  view(orderId: string): PaymentView | null {
    const order = this.orders.getById(orderId);
    const pay = this.payments.getByOrderId(orderId);
    if (!order || !pay) return null;
    return {
      orderId,
      status: order.status,
      settlementMode: pay.settlementMode,
      merchantInvoiceRef: pay.merchantInvoiceRef,
      txId: pay.txId,
      amountZatoshi: pay.amountZatoshi,
      simulatedDelivery: order.status === "delivered" ? { simulated: true, label: SIMULATED_SETTLEMENT_LABEL } : null,
    };
  }

  private async advance(order: Order, txId: string): Promise<void> {
    let res;
    try {
      res = await this.signer.txStatus(order.orderId, txId);
    } catch {
      return; // transient: try again on the next refresh, change nothing
    }
    if (!res.ok) return;

    const set = (s: OrderStatus) => {
      this.orders.setStatus(order.orderId, s);
      this.payments.setStatus(order.orderId, s);
    };

    switch (res.tx.status) {
      case "failed": {
        // Definitive on-chain/broadcast failure: release the reservation.
        this.authService.release(order);
        this.payments.setStatus(order.orderId, "failed");
        return;
      }
      case "confirmed": {
        set("confirmed"); // budget reservation becomes final here
        set("settlement_pending");
        set("delivered"); // SIMULATED settlement - see SIMULATED_SETTLEMENT_LABEL
        try {
          this.opts.onDelivered?.(order.orderId);
        } catch (e) {
          this.opts.onError?.(e); // a receipt failure must never undo or hide a delivered order
        }
        return;
      }
      case "mined": {
        if (order.status === "broadcast") set("mined");
        break;
      }
      default:
        break;
    }

    // Not confirmed yet: a payment stuck too long is held for reconciliation, not released or retried.
    const timeout = this.opts.confirmationTimeoutMs ?? 30 * 60_000;
    const now = (this.opts.now ?? (() => new Date()))().getTime();
    if (now - Date.parse(order.proposedAt) > timeout) set("payment_uncertain");
  }
}
