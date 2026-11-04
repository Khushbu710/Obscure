# Bitrefill Integration

Status: **Revised 2026-11-04.** Corrects a wrong tool-count claim from the prior pass and adds explicit failure/reconciliation handling per the re-audit.

## 1. Confirmed capability summary

| Capability | Status | Detail |
|---|---|---|
| Catalog search/browse | Confirmed | `GET /products`, `/products/search`, `/products/esims`, `/products/esims/{id}` |
| Product pricing | Confirmed | Returned with product detail |
| Order/invoice creation | Confirmed | `POST /esims` (and analogous invoice calls); one invoice can bundle multiple products |
| Payment instructions | Confirmed | Invoice response includes `payment.address`, `payment.price`, `payment.currency` |
| Status tracking | Confirmed | Lifecycle `unpaid -> payment_detected -> payment_confirmed -> pending -> complete` (also `blocked`/`denied`/`payment_error`); webhooks available, preferred over polling |
| Delivery retrieval | Confirmed | `redemption_info` (gift cards) or `barcode_value` + activation PIN (eSIMs) on `delivered` |
| Official MCP server | **Corrected** — 7 tools, not 18: `search-products`, `get-product-details`, `buy-products`, `submit-prepayment-step`, `list-invoices`, `get-invoice-by-id`, `update-order`. **There is no `pay-invoice` MCP tool.** Payment is always via the REST invoice object's `payment.address`/`payment.price`, handled entirely outside MCP. | [docs.bitrefill.com/docs/ecommerce-mcp](https://docs.bitrefill.com/docs/ecommerce-mcp), [GitHub](https://github.com/bitrefill/bitrefill-mcp-server) |
| ZEC accepted directly | **Confirmed NOT supported** | Accepted: BTC (+Lightning), ETH, LTC, DOGE, DASH, SOL, TON, USDT, USDC — ZEC absent everywhere checked |
| Account tier for hackathon use | Personal API — self-serve, Bearer token, Account → Developers → API Keys | Business/Affiliate require partner-program approval, not realistic in hackathon timeframe |
| Sandbox | Partial | 6 test products exist but only settle via `payment_method=balance`, not a real crypto payment |
| Rate limits | Confirmed, generous for a demo | e.g. 60 req/min products, 20 req/min invoices, 1 req/3s ping |
| KYC | Not documented at API level | General account-level sanctions/geo restrictions exist but aren't API-tier-specific |

## 2. Agent tool scope — corrected to the real 7-tool list

The AI agent is registered **only** `search-products` and `get-product-details` — discovery/comparison, nothing else. This was already the intended design; the correction is just which real tool names enforce it. `buy-products` (invoice/order creation), `submit-prepayment-step`, `list-invoices`, `get-invoice-by-id`, and `update-order` are called exclusively by the **backend payment orchestrator**, never exposed to the agent's LLM tool list. This remains the concrete implementation of "the agent never authorizes payments" — there is no tool in its registered set that could.

## 3. Price re-verification

Before guardian approval, the backend performs its own fresh `get-product-details` call to confirm the price the agent reported — the implementation of rejection code `PRICE_MISMATCH`. **New, explicit handling for price changes between agent-proposal-time and guardian-check-time**: if the live price differs from what the agent saw, this is **not** treated as an attack (it's normal catalog drift) — the guardian rejects with `PRICE_MISMATCH` and the agent is given one opportunity to re-propose against the new live price, bounded to a maximum of one retry per order to avoid an infinite negotiation loop.

## 4. Invoice lifecycle, uncertainty, and duplicate prevention

- **Invoice expiry**: Bitrefill invoices expire if unpaid within their documented window; the payment orchestrator tracks `merchantInvoiceRef` + its known expiry and moves the order to `expired` rather than attempting payment against a stale invoice.
- **Duplicate purchase prevention**: before creating an invoice, the orchestrator checks for an existing `merchantInvoiceRef` tied to the same `orderId` (idempotency, per `payment-flow.md`); it never calls `buy-products` twice for the same order.
- **Webhooks and reconciliation**: webhooks are the primary status source; a periodic reconciliation poll (`get-invoice-by-id`) covers the case where a webhook is missed, **never** the other way around (polling-only would be both slower and against Bitrefill's own guidance).
- **Provider errors**: a `5xx`/timeout from Bitrefill during invoice creation leaves the order in `authorized` (not `signed`/`broadcast`) if it happens before the Zcash leg — safe to retry invoice creation alone. If it happens *after* a real transaction was already signed/broadcast (MVP: the simulated-settlement step), the order moves to `payment_uncertain`, which a human/operator reconciles manually in the hackathon MVP — **do not auto-retry an uncertain purchase**, per the explicit instruction not to blindly retry.
- **Delivery failures**: if Bitrefill reports `delivered` but `redemption_info`/`barcode_value` is missing or malformed, the order is held in `settlement_pending` with an error flag rather than being marked `delivered` — the receipt is only generated once real redemption data is present (or, in the MVP's simulated leg, once the simulated-delivery record is explicitly created, still labeled as simulated).

## 5. Example invoice creation flow

```
POST /esims
{ "product_id": "esim-japan-5gb", "payment_method": "bitcoin" }
->
{ "invoice_id": "inv_123", "status": "unpaid",
  "payment": { "address": "bc1q...", "price": "0.00021", "currency": "BTC" } }
```
In the MVP, this real `payment.address`/`payment.price` is read and displayed/logged for demo purposes (showing judges that a real invoice was created), but is **not actually paid** — see `payment-flow.md` §2 and `demo-scope.md`.

## 6. What's not available, stated plainly

- No way to pay with ZEC directly, and (new, confirmed this pass) **no way to pay with testnet TAZ via any swap provider either** — the settlement leg is unavoidably simulated for a testnet-only MVP.
- No crypto-payment sandbox — the "malicious listing" and "compromised agent" demo scenes can safely use fabricated/mocked product data (they're expected to be *rejected* before any payment call), but the real invoice-creation step (not payment) should use a real product.
- Business/reseller API tier not realistically obtainable in hackathon time — don't plan around it.
