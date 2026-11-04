# API Contracts

Owner: Developer 2 (backend API), reviewed by Developer 1 as the primary consumer.

## Auth model (hackathon-scoped, stated explicitly so no one overbuilds)

Single-user demo. A simple session token issued on app load, stored in an HttpOnly cookie, checked by backend middleware. **No OAuth, no multi-tenant auth** — building that would be overengineering for this scope. If the demo needs to show "the user," a hardcoded demo user record is enough.

## Endpoints

All responses use the uniform error shape from `data-models.md` §11 on failure.

### Mandates
- `POST /api/mandates` — create. Body: `{allowedCategories, allowedMerchants?, totalCapMinor, perOrderCapMinor?, currency, durationHours}`. Returns `Mandate`.
- `GET /api/mandates` — list for current user.
- `GET /api/mandates/:id` — detail, including live `spentMinor` and envelope funding status.
- `POST /api/mandates/:id/pause` / `POST /api/mandates/:id/resume`
- `POST /api/mandates/:id/revoke` — terminal; guardian must reject all subsequent orders referencing this mandate immediately (not eventually-consistent).

### Envelope funding
- `POST /api/mandates/:id/fund` — triggers the Zcash wrapper service to create a fresh per-mandate `zcash-devtool` wallet, returns its `receivingAddress`; the user's own main-wallet `zcash-devtool` instance sends to this address (outside the API, per `zcash-integration.md` §4). The backend only relays/records the result, it never holds the user's main wallet's key.
- `GET /api/mandates/:id/envelope` — balance, confirmations, fundingTxId.
- `POST /api/mandates/:id/sweep` — triggers the signer to sweep the envelope wallet's remaining balance back to the user's main wallet address once the mandate is `revoked`/`expired`. **Signer-executed**, not user-signed — see `zcash-integration.md` §6 for why this is a deliberate asymmetry from funding.

### Shopping
- `POST /api/shopping-requests` — body: `{mandateId, prompt}`. Starts the agent run asynchronously; returns `{requestId}`.
- `GET /api/shopping-requests/:id/events` — Server-Sent Events stream of `AgentEvent`s for the live activity log.
- `GET /api/orders/:id` — final order status, including guardian result and rejection code/reason if rejected.

### Receipts
- `GET /api/receipts` — list (metadata only, not decrypted payloads).
- `GET /api/receipts/:id` — full decrypted detail (owner-only).
- `POST /api/receipts/:id/disclose` — generates a selective-disclosure artifact for this one receipt. Returns `{commitment, salt, signature, disclosedFields}`.

### Security / attack scoreboard
- `GET /api/security/scoreboard` — returns the latest automated attack-suite run result (pass/fail per scenario, timestamp of last run). **This is read from real stored test results, never hardcoded.**

## Example: mandate creation

Request:
```json
POST /api/mandates
{ "allowedCategories": ["esim"], "totalCapMinor": 3000, "currency": "USD", "durationHours": 24 }
```
Response `201`:
```json
{ "id": "m_8f2a", "status": "active", "allowedCategories": ["esim"], "totalCapMinor": 3000, "spentMinor": 0,
  "envelopeWalletRef": "wallet:m_8f2a", "createdAt": "2026-11-04T10:00:00Z", "expiresAt": "2026-11-05T10:00:00Z",
  "schemaVersion": 1 }
```

## Example: guardian rejection surfaced to the frontend

```json
{ "orderId": "o_112", "status": "rejected", "guardian": { "code": "PRICE_MISMATCH",
  "reason": "Agent-reported price $12.00 does not match live Bitrefill price $19.00" } }
```

## Mock-first parallel development

Developer 1 can build the entire frontend against a **mock backend** generated directly from the Zod schemas in `packages/contracts/` (e.g. a small `msw`-based mock server) before Developer 2's real endpoints exist. Developer 2 can build the backend against **a mock Zcash wrapper service and mock Bitrefill responses** before Developer 1's `zcash-devtool` wrapper is ready. The only hard dependency for a live, non-mocked end-to-end run is the signer-to-Zcash-wrapper boundary and the payment-orchestrator-to-Bitrefill boundary — see `development-roadmap.md` (Plan A) for exactly when those must be real.
