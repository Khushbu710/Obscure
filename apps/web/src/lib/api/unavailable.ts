/**
 * Explicit registry of functionality this frontend WANTS to show but has no
 * real backend endpoint for yet. Referenced by the relevant pages to render
 * an honest "not connected" state instead of fabricating data. Keep this
 * list in sync with services/api/src/http/routes/ - if a route is added,
 * remove it from here and wire the real call.
 */
export const UNAVAILABLE_FEATURES = {
  walletEnvelope: "No `/fund` or `/envelope` backend endpoint exists yet - Developer 1's Zcash adapter integration is still pending agreement (see docs/architecture/zcash-integration.md).",
  activityLog: "No dedicated activity/audit-log endpoint exists yet. Only what a shopping request's own response returns can be shown reliably.",
  receipts: "No receipt generation or retrieval endpoint exists yet (see docs/architecture/payment-flow.md - receipts are designed but not implemented).",
  securityScoreboard: "No `/api/security/scoreboard` endpoint exists yet. The ~20-scenario attack suite described in docs/architecture/testing-strategy.md runs as backend unit tests, not as a queryable API.",
  orderHistory: "No `GET /api/orders` or mandate-scoped order-listing endpoint is exposed over HTTP yet, even though OrderRepository exists in the backend.",
} as const;
