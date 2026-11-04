import type { TransactionIntent } from "@obscura/guardian";

/**
 * Shown wherever a ZEC amount derived from this builder is displayed.
 * The MVP conversion is a CONFIGURED, DETERMINISTIC DEMONSTRATION RATE - not a
 * live exchange rate, not a market quote, and not an actual ZEC-to-Bitrefill
 * conversion. Bitrefill does not accept ZEC, testnet TAZ has no market value,
 * and no swap provider converts it (docs/architecture/demo-scope.md).
 */
export const DEMO_RATE_LABEL =
  "FIXED DEMONSTRATION RATE: this testnet amount is a configured constant (zatoshi per USD cent), not a live exchange rate, and is not a real conversion to anything Bitrefill accepts.";

/**
 * The trusted payment-orchestration layer's source of the canonical
 * blockchain terms for an order:
 *
 *   amountZatoshi = priceMinor x zatoshiPerMinor      (priceMinor = USD cents)
 *   destination   = the operator-configured settlement address
 *
 * Neither value is ever supplied by the AI agent, the frontend, or product
 * text. The guardian binds this exact intent into the authorization token
 * (HMAC), and the signer independently verifies it, so a request cannot
 * substitute different terms afterwards.
 */
export class TransactionIntentBuilder {
  readonly destinationAddress: string;
  readonly zatoshiPerMinor: number;

  constructor(config: { destinationAddress: string; zatoshiPerMinor: number }) {
    if (!config.destinationAddress) throw new Error("TransactionIntentBuilder: destinationAddress is required");
    if (!Number.isSafeInteger(config.zatoshiPerMinor) || config.zatoshiPerMinor <= 0) {
      throw new Error("TransactionIntentBuilder: zatoshiPerMinor must be a positive integer");
    }
    this.destinationAddress = config.destinationAddress;
    this.zatoshiPerMinor = config.zatoshiPerMinor;
  }

  /** `null` (never a guess) when the price is not a positive integer number of cents. */
  forPriceMinor(priceMinor: number): TransactionIntent | null {
    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return null;
    const amountZatoshi = priceMinor * this.zatoshiPerMinor;
    if (!Number.isSafeInteger(amountZatoshi)) return null;
    return { destinationAddress: this.destinationAddress, amountZatoshi };
  }
}
