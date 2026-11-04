import type { GuardianRequest, GuardianResponse, RejectionCode } from "@obscura/contracts";
import { issueAuthorizationToken } from "./authorizationToken.js";

/**
 * The exact, documented validation sequence (docs/architecture/testing-strategy.md §2).
 * First-failure-wins and MUST stay in this order so tests can assert against
 * a known, deterministic sequence rather than an arbitrary one.
 */
export const VALIDATION_SEQUENCE = [
  "malformed",
  "mandateRevoked",
  "mandatePaused",
  "mandateExpired",
  "nonceReused",
  "category",
  "merchant",
  "product",
  "price",
  "perOrderCap",
  "budget",
] as const;

function reject(code: RejectionCode, reason: string, nowIso: string): GuardianResponse {
  return { approved: false, code, reason, checkedAt: nowIso };
}

/**
 * Pure, deterministic, synchronous. No I/O: no database, no network, no LLM,
 * no wallet access. Everything it needs is in `request`. The caller
 * (mandate engine) is responsible for supplying a freshly-verified price and
 * an accurate nonce-consumption flag - this function trusts neither the
 * agent's reported price nor any free-text product field for its decision.
 *
 * `hmacSecret` is used only to bind the issued authorization token to this
 * exact order+nonce+mandate - it is an internal token secret, not a wallet
 * or signing key, and the guardian never persists or logs it.
 */
export function validateOrder(request: GuardianRequest, hmacSecret: string): GuardianResponse {
  const { mandate, order, verifiedPriceMinor, nonceAlreadyConsumed, now } = request;
  const nowMs = Date.parse(now);

  // 1. Malformed / binding check - order must actually belong to this mandate.
  if (order.mandateId !== mandate.id) {
    return reject("MALFORMED_ORDER", "Order's mandateId does not match the mandate being checked against.", now);
  }
  if (!order.nonce || order.nonce.length < 16) {
    return reject("MALFORMED_ORDER", "Order nonce is missing or too short to be cryptographically random.", now);
  }
  if (order.priceMinor <= 0) {
    return reject("MALFORMED_ORDER", "Order priceMinor must be a positive integer.", now);
  }

  // 2-4. Mandate status / expiry.
  if (mandate.status === "revoked") {
    return reject("MANDATE_REVOKED", "This mandate has been revoked and can no longer authorize spending.", now);
  }
  if (mandate.status === "paused") {
    return reject("MANDATE_PAUSED", "This mandate is currently paused.", now);
  }
  if (Date.parse(mandate.expiresAt) <= nowMs || mandate.status === "expired") {
    return reject("MANDATE_EXPIRED", "This mandate has expired.", now);
  }

  // 5. Replay protection.
  if (nonceAlreadyConsumed) {
    return reject("NONCE_REUSED", "This nonce has already been consumed by a prior order.", now);
  }

  // 6. Category restriction.
  if (!mandate.allowedCategories.includes(order.product.category)) {
    return reject(
      "CATEGORY_NOT_ALLOWED",
      `Category "${order.product.category}" is not in the mandate's allowed categories.`,
      now,
    );
  }

  // 7. Merchant restriction (null = any merchant allowed within category).
  if (mandate.allowedMerchants !== null && !mandate.allowedMerchants.includes(order.product.merchantId)) {
    return reject(
      "MERCHANT_NOT_ALLOWED",
      `Merchant "${order.product.merchantId}" is not in the mandate's allowed merchants.`,
      now,
    );
  }

  // 8. Product restriction (null = any product allowed).
  if (mandate.allowedProductIds !== null && !mandate.allowedProductIds.includes(order.product.merchantProductId)) {
    return reject(
      "PRODUCT_NOT_ALLOWED",
      `Product "${order.product.merchantProductId}" is not in the mandate's allowed products.`,
      now,
    );
  }

  // 9. Price re-verification - never trust the agent's reported price alone.
  if (order.priceMinor !== verifiedPriceMinor) {
    return reject(
      "PRICE_MISMATCH",
      `Agent-reported price ${order.priceMinor} does not match freshly verified price ${verifiedPriceMinor}.`,
      now,
    );
  }

  // 10. Per-order cap.
  if (mandate.perOrderCapMinor !== null && order.priceMinor > mandate.perOrderCapMinor) {
    return reject(
      "PER_ORDER_CAP_EXCEEDED",
      `Order amount ${order.priceMinor} exceeds the per-order cap of ${mandate.perOrderCapMinor}.`,
      now,
    );
  }

  // 11. Remaining budget.
  const projectedSpent = mandate.spentMinor + order.priceMinor;
  if (projectedSpent > mandate.totalCapMinor) {
    const remaining = mandate.totalCapMinor - mandate.spentMinor;
    return reject(
      "BUDGET_EXCEEDED",
      `Order amount ${order.priceMinor} exceeds remaining budget ${remaining}.`,
      now,
    );
  }

  // Approved - issue a short-lived authorization token bound to this exact order+nonce+mandate.
  const authorizationToken = issueAuthorizationToken(
    { orderId: order.orderId, nonce: order.nonce, mandateId: mandate.id },
    hmacSecret,
    nowMs,
  );
  return { approved: true, authorizationToken, checkedAt: now };
}
