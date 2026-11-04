/**
 * Explicit registry of functionality this frontend WANTS to show but has no
 * real backend endpoint for yet. Keep this in sync with
 * services/api/src/http/routes/ - if a route is added, remove its entry here
 * and wire the real call (see docs/architecture/frontend-integration.md).
 *
 * As of 2026-11-04, wallet/envelope, orders, receipts, and the security
 * scoreboard are all real and connected - removed from this list.
 */
export const UNAVAILABLE_FEATURES = {
  activityStream:
    "No live push/SSE event stream exists yet (GET /api/shopping-requests/:id/events is designed in api-contracts.md but not built). This page polls GET /api/orders instead.",
} as const;
