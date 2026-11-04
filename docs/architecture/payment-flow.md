# Payment Flow

Status: **Revised 2026-11-04.** The prior version assumed a live ZEC→Bitrefill swap on testnet. This is **structurally impossible**: testnet TAZ has no monetary value, and no swap provider (SideShift, ChangeNOW, the Zcash Router SDK) supports testnet assets — they all deal in real-value assets only, by design. This revision splits the flow into a real leg and a simulated leg, honestly labeled, per `demo-scope.md`.

## 1. Transaction/authorization state machine (new — replaces the old implicit "signed = paid")

```
proposed -> validated -> reserved -> authorized -> signed -> broadcast -> mined -> confirmed -> settlement_pending -> delivered
                                                                                  \-> failed -> refund_pending -> refunded
rejected / expired / payment_uncertain / cancelled are reachable from proposed..authorized
```

| State | Meaning | Budget effect |
|---|---|---|
| `proposed` | Agent produced a structured order | none |
| `validated` | Guardian checked category/merchant/price/expiry/nonce | none yet |
| `reserved` | Guardian provisionally holds the amount against the mandate's remaining budget, inside the same DB transaction as validation | budget **reserved**, not yet final |
| `authorized` | `authorizationToken` issued, bound to orderId+nonce, short expiry | |
| `signed` | Signer independently re-validated and produced a signed tx | **still not final** — a signed tx can still fail to broadcast or confirm |
| `broadcast` | Sent to `testnet.zec.rocks` | |
| `mined` | Seen in a block (distinct from confirmed) | |
| `confirmed` | N further blocks elapsed | **budget reservation becomes final** here, not earlier |
| `settlement_pending` | Commerce leg in progress (simulated in the MVP, see §2) | |
| `delivered` | Receipt created | |
| `failed` | Broadcast/mining failure | reservation released back to available budget |
| `payment_uncertain` | Broadcast succeeded but confirmation can't be verified within a timeout | held, not released, not finalized — requires reconciliation, never silently retried |
| `refund_pending` / `refunded` | N/A for the simulated commerce leg in the MVP; real in Plan B | |
| `rejected` / `expired` / `cancelled` | Terminal, no funds ever moved | reservation released |

**Why this matters**: `reserved` exists specifically so two concurrent orders can't both see "budget available" before either one's transaction is confirmed — this is the real answer to "SQLite transactions can't make the blockchain atomic." The SQLite transaction makes the **reservation** atomic and local; it never claims to make the external broadcast/confirm atomic. A `signed` or even `broadcast` transaction that never confirms must release its reservation (after a timeout, moving to `failed` or `payment_uncertain`), not hold the budget hostage forever, and must never be silently retried (that would risk a double-spend if the original eventually does confirm).

## 2. The MVP flow — real Zcash leg, simulated commerce leg

1. **Funding** (real): user's main `zcash-devtool` wallet sends TAZ to a freshly created per-mandate envelope wallet (`zcash-integration.md` §4). Real testnet transaction, real confirmation.
2. **Shopping** (real): AI agent calls Bitrefill's `search-products`/`get-product-details` MCP tools. Real product data, real prices.
3. **Guardian validation** (real): price re-verified against a fresh `get-product-details` call; category/merchant/budget/expiry/nonce checked.
4. **Invoice creation** (real): backend calls Bitrefill's `buy-products` (REST/MCP) to create a real invoice and read its real `payment.address`/`payment.price`. This step costs nothing and is fully real — creating an invoice doesn't require paying it.
5. **Signer** (real): independently re-validates, then executes a real, signed, broadcast, confirmed **testnet TAZ transaction** from the envelope wallet — but its destination is a **demo settlement address** (e.g., a second test wallet representing "where real funds would go if this were mainnet"), **not** Bitrefill's real BTC address, since TAZ cannot actually settle that invoice.
6. **Settlement** (**simulated, clearly labeled**): the UI explicitly marks this step "SIMULATED — testnet funds cannot be converted to a Bitrefill-accepted asset; in production this step would execute the swap+pay shown in Plan B." The invoice's `delivered` state is not claimed; instead, a clearly-labeled "simulated delivery" record is shown.
7. **Receipt**: generated as usual, but its `commitment` includes a `settlementMode: "simulated"` field — the receipt format itself discloses which parts were real.

**This is the one instruction from the user that overrides everything else here: never present the simulated settlement as a completed real purchase.** The demo narration must say this out loud, not bury it in fine print — see `demo-scope.md` §4 for the exact judge-facing script.

## 3. Plan B (post-hackathon): what a real settlement would require

Documented for completeness, **not built in the MVP**:
- A swap provider supporting **mainnet** ZEC (SideShift documents shielded-ZEC deposit support on mainnet; this needs re-verification — a prior research pass's live `/v2/coins` fetch didn't conclusively show a ZEC entry).
- Real mainnet ZEC, meaning real funds — explicitly requires the user's informed approval before ever building or running this path; never default to it silently.
- The same guardian/signer/state-machine logic, unchanged — only the destination of the signed transaction and the presence of a real swap step differ from the MVP.

## 4. Idempotency (unchanged in principle)

`orderId` remains the idempotency key through every external call (invoice creation, signer, simulated settlement). Backend restart mid-flow resumes from the persisted state-machine value in §1, never re-signs a consumed nonce, never re-creates a duplicate invoice.

## 5. Receipt commitment scheme (unchanged)

```
commitment = SHA256(orderId || priceMinor || merchantId || timestamp || salt || settlementMode)
signature  = Ed25519_sign(receiptServiceKey, commitment)
```
Still explicitly a **signature + hash commitment, not a zero-knowledge proof** — selective disclosure means revealing one purchase's preimage, not proving a predicate over hidden values.
