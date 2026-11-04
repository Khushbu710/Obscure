# Demo Scope

Status: **New, 2026-11-04.** This is the single source of truth for what OBSCURA's hackathon demo may claim. If any other document (or any slide, any live narration) conflicts with this file, this file wins.

## 1. What works for real

- Mandate creation, with real budget/category/expiry stored and enforced.
- A real, independently-generated per-mandate `zcash-devtool` wallet, funded by a real testnet transaction from the user's main wallet, on the live NU7/Ironwood testnet (`testnet.zec.rocks`).
- A real AI agent run against Bitrefill's real `search-products`/`get-product-details` tools — real product data, real live prices.
- A real, deterministic guardian check against the mandate, including a real fresh price re-verification call.
- A real, independent signer re-validation.
- A real, signed, broadcast, confirmed testnet transaction moving TAZ out of the mandate's envelope wallet — this is the single most important real artifact in the demo; show the transaction, its confirmation, and its on-chain (testnet explorer) view.
- A real Bitrefill invoice created via `buy-products`, with a real `payment.address`/`payment.price` displayed.
- A real signed receipt with a real hash commitment and real selective-disclosure capability.
- Real, automated attack-scenario tests with a real pass/fail scoreboard (not hardcoded).

## 2. What is simulated

- **The commerce settlement step**: after the real testnet transaction and the real Bitrefill invoice both exist, OBSCURA does **not** actually pay that invoice — no swap provider converts testnet TAZ into anything Bitrefill accepts, and this is not a missing feature, it is a structural fact about testnet assets having no value. The UI shows an explicit **"SIMULATED SETTLEMENT"** banner at this step. The subsequent "delivery" (eSIM code) is a simulated/fixture record, visually distinct from real data (e.g., a watermark or a clearly different color treatment), never a real Bitrefill delivery.

## 3. What is mocked (development-time only, never shown live in the final demo)

- Early-stage frontend-against-mock-backend and backend-against-mock-wrapper development, per `development-roadmap.md`'s parallel-build phase — these mocks are replaced by the real integrations before the demo, not shown to judges as if real.

## 4. What must NEVER be claimed during the demo

- That a real Bitrefill product was actually purchased and paid for with ZEC/TAZ.
- That the eSIM/gift-card shown at the end was really delivered by Bitrefill.
- That the swap/settlement step is "coming in v2" in a way that implies it's just unfinished — say plainly that **no provider today supports converting testnet funds into anything of value**, which is a protocol/market fact, not an OBSCURA limitation.
- That transactions are invisible to Bitrefill, to any future swap provider, or to the AI model provider.
- That the system provides complete anonymity.
- That the receipt's hash commitment is a zero-knowledge proof.
- That the signer is immune to a fully compromised backend — see `threat-model.md`'s narrowed boundary; state the real scope (defends against a compromised agent / malicious API caller, not against arbitrary backend database tampering).

## 5. Exact demo sequence (adapted from the original 8-scene script, re-scoped to what's real)

1. **Create a mandate**: $30 cap, eSIM-only, 24-hour validity. (Real.)
2. **Fund the envelope**: show the real testnet funding transaction and its confirmation on a testnet explorer. (Real.)
3. **AI shopping**: "find me a 5GB eSIM for Japan under $15" — show the agent's real search/comparison against Bitrefill. (Real.)
4. **Guardian approval**: show the real validation sequence and its result. (Real.)
5. **Signed transaction**: show the real signed, broadcast, confirmed testnet transaction from the envelope wallet — narrate explicitly: "this is a real Zcash testnet transaction, authorized independently by the signer." (Real.)
6. **Invoice + simulated settlement**: show the real Bitrefill invoice, then the explicit SIMULATED SETTLEMENT banner, narrated honestly: "testnet funds have no market value, so no swap provider can convert them — this step is simulated to show where real settlement would occur." (Hybrid, explicitly labeled.)
7. **Malicious listing**: inject a product description attempting to redirect funds or override instructions — show the guardian rejecting it with its exact reason code. (Real.)
8. **Compromised agent**: show an agent attempting to propose an over-budget or out-of-category order — show it capped/rejected regardless. (Real.)
9. **Private receipt**: show the encrypted receipt and generate a selective-disclosure artifact for one purchase, explicitly narrated as "a signature and a hash commitment, not a zero-knowledge proof." (Real.)

## 6. Failure fallback

- If public testnet (`testnet.zec.rocks`) or the `valargroup` faucet is degraded during judging, switch to **Thus Spoke Zakura** (local, zero-network-dependency, NU7-active-from-height-1) — rehearse both paths beforehand so the switch is seamless, not a visible scramble.
- Keep a recorded backup video of a full successful run, in case live infrastructure fails entirely during the judging window.

## 7. Judge-facing explanation of constraints (say this out loud, don't bury it)

> "OBSCURA runs entirely on Zcash's public NU7 testnet — these are test coins (TAZ) with no real value, which is the correct and required way to demo a financial protocol safely. Because testnet funds have no market value, no currency-swap provider will convert them into anything Bitrefill accepts, so the final settlement-to-merchant step is simulated and clearly marked as such in the UI. Everything up to that point — the mandate, the shielded testnet transaction, the guardian's and signer's independent authorization checks, and the attack defenses — is real and running live."
