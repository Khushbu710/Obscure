# Frontend Integration Guide

Status: **2026-11-04.** What the backend actually serves today (taken from the code in `services/api/src/http/routes/`), so the frontend wires to real shapes instead of assumed ones. It replaces the "unavailable" entries in `apps/web/src/lib/api/unavailable.ts` for everything listed here.

All errors use the uniform shape `{ "error": { "code", "message", "details"? } }`.

## What is real vs simulated (must be visible in the UI)

- The Zcash leg is **real**: funding, the signed Ironwood testnet transaction, confirmation.
- The commerce settlement is **simulated**: testnet TAZ cannot pay a Bitrefill invoice. Any order that reaches `delivered` carries `payment.simulatedDelivery.label`. **Show that label verbatim; never display "purchased" or "delivered" without it.**
- Any ZEC/zatoshi amount derived from a price is a **fixed demonstration rate** (10,000 zatoshi per USD cent, set by the backend), not a live exchange rate. Label it as such wherever it is shown.
- Receipts are a **signature + hash commitment, not a zero-knowledge proof.**

## Wallet / envelope (replaces `walletEnvelope`)

| Call | Success | Notable errors |
|---|---|---|
| `POST /api/mandates/:id/fund` | `200 { mandateId, envelopeWalletRef, receivingAddress }` — creates the mandate's own envelope wallet (idempotent) | `409 MANDATE_NOT_ACTIVE`, `404 MANDATE_NOT_FOUND`, `503 SIGNER_NOT_CONFIGURED`, `502 SIGNER_UNAVAILABLE` |
| `GET /api/mandates/:id/envelope` | `200 { mandateId, receivingAddress, spendableZatoshi, totalZatoshi, funded, fundingTxId }` | `404 NO_ENVELOPE` (call `/fund` first) |
| `POST /api/mandates/:id/sweep` | `200 { mandateId, sweepTxId, status }` | `409 MANDATE_STILL_ACTIVE`, `409 ORDERS_IN_FLIGHT`, `409 NOTHING_TO_SWEEP`, `404 NO_ENVELOPE` |

Funding itself happens **outside the API**: the user's own main wallet sends TAZ to `receivingAddress` (`zcash-integration.md` §4). `totalZatoshi` rises once the transaction is seen; `spendableZatoshi` only after about 10 confirmations (~4 minutes), so show both and do not treat `spendable = 0` as "unfunded". `fundingTxId` is currently `null` (the backend does not observe the user's wallet).

## Orders, payment, and activity (replaces `orderHistory`, part of `activityLog`)

- `POST /api/shopping/requests` — unchanged. When the outcome is `authorized`, payment starts **in the background**; the response order is still `reserved`/`authorized`.
- `GET /api/orders/:id` → `{ order, payment }`. **Polling this advances the payment** by one chain observation, so poll it (every ~5–10 s) after an authorized request.
- `GET /api/orders[?mandateId=<uuid>]` → `{ orders: [{ order, payment }] }`, newest first. A read of stored state only (does not poll the chain).

`order` is the sanitized order (never contains `nonce`). `payment`:

```
{ orderId, status, settlementMode: "simulated" | "real",
  merchantInvoiceRef, txId, amountZatoshi,
  simulatedDelivery: { simulated: true, label } | null }   // non-null only when status === "delivered"
```

Order `status` lifecycle to render: `reserved` → `authorized` → `broadcast` → `mined` → `confirmed` → `settlement_pending` → `delivered` (the last three happen in one step in the MVP). Terminal/held: `failed` (budget released), **`payment_uncertain`** (outcome unknown; budget **held**, needs manual reconciliation — show it as such, never as failed), `rejected`.

## Receipts (replaces `receipts`)

- `GET /api/receipts` → `[{ receiptId, orderId, commitment, createdAt }]` (metadata only).
- `GET /api/receipts/:id` → `{ receipt: { receiptId, orderId, commitment, signature, createdAt }, payload: { orderId, priceMinor, currency, merchantId, timestamp, settlementMode, salt }, signatureValid }`.
- `POST /api/receipts/:id/disclose` → `{ commitment, signature, disclosedFields }` (selective disclosure of one receipt).
- `GET /api/receipts/public-key` → `{ algorithm: "Ed25519", format: "SPKI-DER-base64", publicKey, persistentKeys }` for independent verification.

A receipt exists only once an order is `delivered`.

## Security scoreboard (replaces `securityScoreboard`)

`GET /api/security/scoreboard` → `{ status: "not_run", message }` or `{ status: "ok", run: { ranAt, total, passed, failed, coreTotal, corePassed, results: [{ id, title, core, attack, expectedDefense, passed, observed, durationMs }] } }`. It serves the stored result of the last real run (`npm run scoreboard -w @obscura/attack-scoreboard`). It never fabricates a result: render `not_run` honestly.

## Still not provided by the backend

- A live agent-activity stream (`GET /api/shopping-requests/:id/events`, SSE) — designed in `api-contracts.md`, **not built**. The activity page can be built from `GET /api/orders` plus the shopping response.
- A wallet transaction history. Purchase transactions are available as `payment.txId` on orders; the funding deposit is made from the user's own wallet and is not observed by the backend.

## Trust limitation to keep in the docs

The signer reads mandate/order state from the **same SQLite file** the backend writes. A fully compromised backend with direct write access to that file could alter what the signer reads. OBSCURA defends against a compromised agent and a malicious API caller, not against arbitrary backend database tampering (`security-architecture.md` §3).
