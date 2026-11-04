import type { BlockchainTxResult } from "@obscura/contracts";
import type { ZcashAdapter } from "@obscura/zcash-adapter";
import type { SignerMandateRepository, SignerOrderRepository } from "./repositories.js";

export type WalletOpResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string };

export interface EnvelopeInfo {
  walletRef: string;
  receivingAddress: string;
}
export interface EnvelopeStatus extends EnvelopeInfo {
  spendableZatoshi: number;
  totalZatoshi: number;
  funded: boolean;
}

const fail = (code: string, reason: string) => ({ ok: false as const, code, reason });

/**
 * Wallet operations that are NOT order payments: creating a mandate's
 * envelope wallet, reading its balance, looking up a payment's confirmation,
 * and sweeping the remainder back. Payments themselves only ever go through
 * SignerService.sign (which holds the authorization checks).
 *
 * `sweepAddress` is fixed, operator-configured signer config. It is never
 * accepted from a request, so neither the agent nor the frontend can choose
 * where swept funds go.
 */
export class WalletOpsService {
  constructor(
    private readonly mandates: SignerMandateRepository,
    private readonly orders: SignerOrderRepository,
    private readonly zcash: ZcashAdapter,
    private readonly config: { sweepAddress: string },
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!config.sweepAddress) throw new Error("WalletOpsService requires a configured sweepAddress");
  }

  /**
   * Creates the mandate's own independent envelope wallet (fresh seed, no
   * relation to the user's wallet or any other mandate - zcash-integration.md
   * section 4). Idempotent: an existing wallet is returned, never recreated.
   */
  async createEnvelope(mandateId: string): Promise<WalletOpResult<EnvelopeInfo>> {
    const info = this.mandates.getEnvelopeInfo(mandateId);
    if (!info) return fail("MANDATE_NOT_FOUND", "Mandate not found.");
    if (info.status !== "active") return fail("MANDATE_NOT_ACTIVE", `Mandate is ${info.status}.`);
    if (info.envelopeWalletRef) {
      return { ok: true, walletRef: info.envelopeWalletRef, receivingAddress: await this.zcash.getAddress(info.envelopeWalletRef) };
    }
    const label = `m-${mandateId}`;
    try {
      // A previous attempt may have created the wallet without the backend recording it.
      return { ok: true, walletRef: label, receivingAddress: await this.zcash.getAddress(label) };
    } catch {
      const wallet = await this.zcash.createWallet(label);
      return { ok: true, walletRef: wallet.walletRef, receivingAddress: wallet.address };
    }
  }

  /** Live balance of the mandate's envelope (syncs first). */
  async envelopeStatus(mandateId: string): Promise<WalletOpResult<EnvelopeStatus>> {
    const info = this.mandates.getEnvelopeInfo(mandateId);
    if (!info) return fail("MANDATE_NOT_FOUND", "Mandate not found.");
    if (!info.envelopeWalletRef) return fail("NO_ENVELOPE", "Mandate has no envelope wallet yet.");
    await this.zcash.sync(info.envelopeWalletRef);
    const bal = await this.zcash.getBalance(info.envelopeWalletRef);
    return {
      ok: true,
      walletRef: info.envelopeWalletRef,
      receivingAddress: await this.zcash.getAddress(info.envelopeWalletRef),
      spendableZatoshi: bal.spendableZatoshi,
      totalZatoshi: bal.totalZatoshi,
      funded: bal.totalZatoshi > 0,
    };
  }

  /**
   * Read-only confirmation lookup for an order's payment. The wallet is
   * resolved from persisted state (order -> mandate -> envelope), never from
   * the request, and only orders that were actually paid can be queried.
   */
  async txStatus(orderId: string, txId: string): Promise<WalletOpResult<{ tx: BlockchainTxResult }>> {
    const order = this.orders.getById(orderId);
    if (!order) return fail("ORDER_NOT_FOUND", "Order not found.");
    if (!["broadcast", "mined", "confirmed", "payment_uncertain"].includes(order.status)) {
      return fail("ORDER_NOT_PAID", `Order is ${order.status}; no payment to look up.`);
    }
    const envelope = this.mandates.getEnvelopeInfo(order.mandateId)?.envelopeWalletRef;
    if (!envelope) return fail("NO_ENVELOPE", "Mandate has no envelope wallet.");
    await this.zcash.sync(envelope);
    return { ok: true, tx: await this.zcash.getTxStatus(envelope, txId) };
  }

  /**
   * Sweep-back (zcash-integration.md section 6): signer-executed, only for a
   * revoked/expired mandate, only to the configured address, and only when no
   * order is still in flight (a sweep must never race a payment).
   */
  async sweep(mandateId: string): Promise<WalletOpResult<{ tx: BlockchainTxResult }>> {
    const info = this.mandates.getEnvelopeInfo(mandateId);
    if (!info) return fail("MANDATE_NOT_FOUND", "Mandate not found.");
    if (!info.envelopeWalletRef) return fail("NO_ENVELOPE", "Mandate has no envelope wallet.");
    const expired = Date.parse(info.expiresAt) <= this.now();
    if (info.status !== "revoked" && info.status !== "expired" && !expired) {
      return fail("MANDATE_STILL_ACTIVE", "Only a revoked or expired mandate can be swept.");
    }
    if (this.orders.countInFlight(mandateId) > 0) {
      return fail("ORDERS_IN_FLIGHT", "Orders are still in flight; sweep after they settle or fail.");
    }
    try {
      return { ok: true, tx: await this.zcash.sweep(info.envelopeWalletRef, this.config.sweepAddress) };
    } catch (e) {
      if (e instanceof Error && e.message === "NOTHING_TO_SWEEP") {
        return fail("NOTHING_TO_SWEEP", "Envelope balance does not cover the network fee.");
      }
      throw e;
    }
  }
}
