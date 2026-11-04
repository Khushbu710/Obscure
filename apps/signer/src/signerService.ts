import { verifyAuthorizationToken } from "@obscura/guardian";
import type { BlockchainTxResult, SignerRejectionCode, SignerRequest } from "@obscura/contracts";
import type { ZcashAdapter } from "@obscura/zcash-adapter";
import type { SignerStore } from "./store.js";

export interface SignerConfig {
  /** Shared with the guardian; used ONLY to verify the transport-binding token. */
  tokenSecret: string;
  /**
   * Where every payment goes. Fixed in the signer's own config - the
   * destination never comes from the request, the agent, or product text
   * (security-architecture.md principle 10). In the MVP this is the demo
   * settlement wallet, NOT Bitrefill (payment-flow.md section 2).
   */
  settlementAddress: string;
  /**
   * Where a revoked/expired envelope's remainder is swept: the user's main
   * wallet. Fixed in config, never taken from a request.
   */
  sweepAddress: string;
  /** Fixed demo conversion rate: zatoshi per minor currency unit (cent). */
  zatoshiPerMinor: number;
}

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

export type SignerOutcome =
  | { signed: true; walletRef: string; amountZatoshi: number; signedAt: string; tx: BlockchainTxResult }
  | { signed: false; code: SignerRejectionCode; reason: string };

const reject = (code: SignerRejectionCode, reason: string): SignerOutcome => ({ signed: false, code, reason });

/**
 * Independent re-validation + signing. Every rule is fail-closed. The token
 * and the request body are treated as claims to be checked against
 * persisted state, never as authority.
 */
export class SignerService {
  constructor(
    private readonly store: SignerStore,
    private readonly adapter: ZcashAdapter,
    private readonly config: SignerConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!config.settlementAddress) throw new Error("SIGNER_CONFIG: settlementAddress is required");
    if (!config.sweepAddress) throw new Error("SIGNER_CONFIG: sweepAddress is required");
    if (!(config.zatoshiPerMinor > 0)) throw new Error("SIGNER_CONFIG: zatoshiPerMinor must be positive");
  }

  async signOrder(request: SignerRequest): Promise<SignerOutcome> {
    const nowMs = this.now().getTime();

    // 1. Token: transport binding only.
    const tok = verifyAuthorizationToken(request.authorizationToken, this.config.tokenSecret, nowMs);
    if (!tok.valid) {
      return tok.reason === "EXPIRED"
        ? reject("TOKEN_EXPIRED", "Authorization token expired.")
        : reject("INVALID_TOKEN", "Authorization token invalid.");
    }

    // 2. Persisted truth about the order - the request's copy is only a claim.
    const stored = this.store.getOrder(tok.payload.orderId);
    if (!stored) return reject("ORDER_MISMATCH", "Order not found.");

    if (
      tok.payload.orderId !== request.order.orderId ||
      tok.payload.nonce !== request.order.nonce ||
      tok.payload.mandateId !== request.order.mandateId ||
      stored.nonce !== request.order.nonce ||
      stored.mandateId !== request.order.mandateId ||
      stored.merchantProductId !== request.order.product.merchantProductId
    ) {
      return reject("ORDER_MISMATCH", "Request does not match the persisted, authorized order.");
    }
    if (stored.priceMinor !== request.order.priceMinor) {
      return reject("AMOUNT_MISMATCH", "Requested amount differs from the persisted authorized amount.");
    }

    // 3. The guardian must have consumed this nonce for THIS order.
    if (this.store.nonceOwner(stored.nonce) !== stored.orderId) {
      return reject("ORDER_MISMATCH", "Nonce was not consumed by this order's authorization.");
    }

    // 4. Live mandate state, re-read here (never cached).
    const mandate = this.store.getMandate(stored.mandateId);
    if (!mandate) return reject("MANDATE_NOT_ACTIVE", "Mandate not found.");
    if (mandate.status !== "active") return reject("MANDATE_NOT_ACTIVE", `Mandate is ${mandate.status}.`);
    if (Date.parse(mandate.expiresAt) <= nowMs) return reject("MANDATE_NOT_ACTIVE", "Mandate has expired.");
    if (!mandate.envelopeWalletRef) return reject("MANDATE_NOT_ACTIVE", "Mandate has no funded envelope wallet.");
    if (!mandate.allowedCategories.includes(stored.category)) return reject("ORDER_MISMATCH", "Category not allowed by mandate.");
    if (mandate.allowedMerchants !== null && !mandate.allowedMerchants.includes(stored.merchantId)) {
      return reject("ORDER_MISMATCH", "Merchant not allowed by mandate.");
    }
    if (mandate.perOrderCapMinor !== null && stored.priceMinor > mandate.perOrderCapMinor) {
      return reject("AMOUNT_MISMATCH", "Amount exceeds the mandate's per-order cap.");
    }
    // spent_minor already includes this order's reservation, so it must never exceed the cap.
    if (mandate.spentMinor > mandate.totalCapMinor) return reject("AMOUNT_MISMATCH", "Mandate budget is over its cap.");

    // 5. Exactly-once: only a `reserved` order may be signed, and the flip is atomic.
    if (!this.store.transitionOrder(stored.orderId, "reserved", "signed")) {
      return reject("NONCE_ALREADY_CONSUMED", `Order is ${stored.status}, not reserved; refusing to sign again.`);
    }

    // 6. Build and broadcast. Destination and amount come only from signer config + persisted price.
    const amountZatoshi = Math.round(stored.priceMinor * this.config.zatoshiPerMinor);
    try {
      const tx = await this.adapter.send({
        walletRef: mandate.envelopeWalletRef,
        outputs: [{ address: this.config.settlementAddress, amountZatoshi }],
        memo: null,
      });
      this.store.transitionOrder(stored.orderId, "signed", "broadcast");
      return { signed: true, walletRef: mandate.envelopeWalletRef, amountZatoshi, signedAt: this.now().toISOString(), tx };
    } catch (err) {
      // Definitive local failure before broadcast: release the reservation.
      // NB: a send that may have partially succeeded must be reconciled, not
      // retried (payment-flow.md section 1) - the adapter must throw only on definitive failure.
      this.store.failAndRelease(stored.orderId, stored.mandateId, stored.priceMinor);
      throw err;
    }
  }

  /**
   * Creates the mandate's own independent envelope wallet (fresh seed, no
   * relation to the user's wallet or any other mandate - zcash-integration.md
   * section 4). Idempotent: if the mandate already has one, returns it
   * instead of creating a second.
   */
  async createEnvelope(mandateId: string): Promise<WalletOpResult<EnvelopeInfo>> {
    const mandate = this.store.getMandate(mandateId);
    if (!mandate) return { ok: false, code: "MANDATE_NOT_FOUND", reason: "Mandate not found." };
    if (mandate.status !== "active") return { ok: false, code: "MANDATE_NOT_ACTIVE", reason: `Mandate is ${mandate.status}.` };
    if (mandate.envelopeWalletRef) {
      return { ok: true, walletRef: mandate.envelopeWalletRef, receivingAddress: await this.adapter.getAddress(mandate.envelopeWalletRef) };
    }
    const wallet = await this.adapter.createWallet(`m-${mandateId}`);
    return { ok: true, walletRef: wallet.walletRef, receivingAddress: wallet.address };
  }

  /** Live balance of the mandate's envelope (syncs first). */
  async envelopeStatus(mandateId: string): Promise<WalletOpResult<EnvelopeStatus>> {
    const mandate = this.store.getMandate(mandateId);
    if (!mandate) return { ok: false, code: "MANDATE_NOT_FOUND", reason: "Mandate not found." };
    if (!mandate.envelopeWalletRef) return { ok: false, code: "NO_ENVELOPE", reason: "Mandate has no envelope wallet yet." };
    await this.adapter.sync(mandate.envelopeWalletRef);
    const bal = await this.adapter.getBalance(mandate.envelopeWalletRef);
    return {
      ok: true,
      walletRef: mandate.envelopeWalletRef,
      receivingAddress: await this.adapter.getAddress(mandate.envelopeWalletRef),
      spendableZatoshi: bal.spendableZatoshi,
      totalZatoshi: bal.totalZatoshi,
      funded: bal.totalZatoshi > 0,
    };
  }

  /**
   * Read-only confirmation lookup for an order's payment. The wallet is
   * resolved from persisted state (order -> mandate -> envelope), never from
   * the request, and only orders that were actually signed can be queried.
   */
  async txStatus(orderId: string, txId: string): Promise<WalletOpResult<{ tx: BlockchainTxResult }>> {
    const order = this.store.getOrder(orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND", reason: "Order not found." };
    if (!["broadcast", "mined", "confirmed"].includes(order.status)) {
      return { ok: false, code: "ORDER_NOT_PAID", reason: `Order is ${order.status}; no payment to look up.` };
    }
    const mandate = this.store.getMandate(order.mandateId);
    if (!mandate?.envelopeWalletRef) return { ok: false, code: "NO_ENVELOPE", reason: "Mandate has no envelope wallet." };
    await this.adapter.sync(mandate.envelopeWalletRef);
    return { ok: true, tx: await this.adapter.getTxStatus(mandate.envelopeWalletRef, txId) };
  }

  /**
   * Sweep-back (zcash-integration.md section 6): signer-executed, only for a
   * revoked/expired mandate, only to the configured user address, and only
   * when no order is still in flight (a sweep must never race a payment).
   */
  async sweep(mandateId: string): Promise<WalletOpResult<{ tx: BlockchainTxResult }>> {
    const mandate = this.store.getMandate(mandateId);
    if (!mandate) return { ok: false, code: "MANDATE_NOT_FOUND", reason: "Mandate not found." };
    if (!mandate.envelopeWalletRef) return { ok: false, code: "NO_ENVELOPE", reason: "Mandate has no envelope wallet." };
    const expired = Date.parse(mandate.expiresAt) <= this.now().getTime();
    if (mandate.status !== "revoked" && mandate.status !== "expired" && !expired) {
      return { ok: false, code: "MANDATE_STILL_ACTIVE", reason: "Only a revoked or expired mandate can be swept." };
    }
    if (this.store.countInFlightOrders(mandateId) > 0) {
      return { ok: false, code: "ORDERS_IN_FLIGHT", reason: "Orders are still in flight; sweep after they settle or fail." };
    }
    try {
      const tx = await this.adapter.sweep(mandate.envelopeWalletRef, this.config.sweepAddress);
      return { ok: true, tx };
    } catch (e) {
      if (e instanceof Error && e.message === "NOTHING_TO_SWEEP") {
        return { ok: false, code: "NOTHING_TO_SWEEP", reason: "Envelope balance does not cover the network fee." };
      }
      throw e;
    }
  }
}
