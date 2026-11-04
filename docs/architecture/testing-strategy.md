# Testing Strategy

## 1. Ownership

- Dev 1: UI tests, zcash-devtool wrapper tests, transaction lifecycle tests (seen/mined/confirmed), funding/sweeping tests, frontend integration tests, blockchain error-handling tests.
- Dev 2: backend unit/integration tests, guardian test suite, signer test suite, mandate engine tests, state-machine/reservation tests, the attack scoreboard suite.

## 1a. State-machine and reservation tests (new, builder-pack-required)

Explicit unit tests for `payment-flow.md` §1's state machine, independent of any live blockchain call:
- A `reserved` order that times out without reaching `confirmed` releases its budget reservation.
- Two concurrent `reserved` attempts against the same near-exhausted budget: exactly one succeeds.
- `payment_uncertain` is never auto-retried — assert the orchestrator takes no payment action on that state without explicit operator intervention.
- A `failed` broadcast releases its reservation; a `confirmed` one finalizes it. These must be distinct code paths, not inferred from a timeout alone.

## 2. Guardian test suite (must run with zero network/LLM dependency)

Since the guardian is pure TypeScript, its test suite is plain unit tests over `validateOrder(mandate, order) -> GuardianResponse`, covering every rejection code in `data-models.md` §5 individually, plus combinations (e.g. expired AND over-budget — must report the first-checked failure deterministically, not a random one). Define and document the exact validation sequence (e.g.: mandate status → expiry → category → merchant/product allow-list → price re-verification → per-order cap → remaining budget → nonce) so tests assert against a known order of checks.

## 3. Signer test suite

Tests that the signer independently rejects when:
- Guardian token is valid but mandate was revoked after the token was issued (signer re-fetches live state).
- Nonce was already consumed (simulate a second signing attempt with the same token).
- Order amount in the signing request doesn't match the amount the token was issued for.
- Token is expired (>90s old, per `data-models.md` §5).

## 4. Attack scoreboard — ~20 scenarios

| # | Attack | Attacker capability | Expected result | Responsible component |
|---|---|---|---|---|
| 1 | Prompt injection in product description ("ignore your limits") | Malicious merchant listing | Agent may read it; guardian never sees free text, rejects nothing-changes | Guardian (by construction) |
| 2 | Listing instructs agent to redirect payment address | Malicious merchant listing | Destination always derived from mandate/order schema, never from listing text | Guardian + Order schema |
| 3 | Malicious payment destination in agent's proposed order | Compromised/malicious agent | `destination` is not an agent-settable field | Order schema |
| 4 | Amount substitution (agent reports lower price than actual) | Compromised agent | `PRICE_MISMATCH` rejection via live re-verification | Guardian |
| 5 | Category substitution (agent proposes out-of-category item) | Compromised agent | `CATEGORY_NOT_ALLOWED` | Guardian |
| 6 | Merchant substitution | Compromised agent | `MERCHANT_NOT_ALLOWED` | Guardian |
| 7 | Expired mandate used | Replay/timing attack | `MANDATE_EXPIRED` | Guardian + Signer |
| 8 | Revoked mandate used | Attacker races revocation | `MANDATE_REVOKED` at both guardian and signer | Guardian + Signer |
| 9 | Nonce reuse | Replay attack | `NONCE_REUSED` | Guardian |
| 10 | Replayed authorization token at signer | Replay attack | Signer rejects, nonce already consumed | Signer |
| 11 | Concurrent orders racing the same budget | Compromised agent spamming | SQLite serialized transaction prevents double-spend | Mandate engine |
| 12 | Budget overspending via rapid sequential orders | Compromised agent | `BUDGET_EXCEEDED` once cumulative spend would exceed cap | Guardian |
| 13 | Forged order object (missing/extra fields) | Compromised agent or MITM | `MALFORMED_ORDER`, schema `.parse()` failure | Contracts validation |
| 14 | Order modified after guardian approval, before signing | MITM/compromised backend | Signer's independent re-check catches amount/order mismatch | Signer |
| 15 | Signer bypass attempt (direct call to signer, no token) | Compromised backend/agent | Rejected, missing/invalid authorization token | Signer |
| 16 | Fully compromised agent attempts max-budget spend | Worst-case agent compromise | Capped at mandate's `totalCapMinor`, no more | Guardian + Signer |
| 17 | Invalid/malformed product price (non-numeric, negative) | Malformed merchant response | Schema validation rejects before guardian logic runs | Contracts validation |
| 18 | Malformed merchant API response (missing fields) | Bitrefill API anomaly | Bitrefill client throws typed error, order never reaches guardian as valid | Bitrefill client |
| 19 | Unauthorized payment retry after failure | Compromised backend/bug | New guardian approval + new nonce required; stale authorization tokens expire | Guardian + Signer |
| 20 | Double-spend / duplicate execution attempt | Bug or compromised backend | `orderId` idempotency key at invoice creation and signer nonce-consumption prevents duplicate external calls/signing | Payment orchestrator + Signer |

Each scenario is an automated test with a concrete assertion (not a manual/visual check), and the `/api/security/scoreboard` endpoint reports real pass/fail from the latest run — **no hardcoded "20/20 passed"**; if a scenario fails, it shows failed, and that's the honest, more impressive result for a security-focused demo.

## 5. Frontend/blockchain testing (Dev 1)

- `zcash-devtool` wrapper tests against testnet (funding, sweep, balance query) using the `valargroup` faucet confirmed in `zcash-integration.md` §5; `Thus Spoke Zakura` used for fast, network-independent local test runs.
- Transaction lifecycle tests: `pending -> broadcast -> mined -> confirmed -> failed` paths, including simulated network errors — the seen/mined/confirmed distinction is a builder-pack requirement, test it explicitly rather than collapsing "broadcast" and "confirmed."
- UI tests for guardian-rejection rendering (every rejection code has a corresponding UI state, not a generic error), and for the simulated-settlement disclosure banner (`demo-scope.md`) — must always render when `settlementMode: "simulated"`, never silently.
