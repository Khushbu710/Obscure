# Threat Model

## 1. What OBSCURA protects against

| Threat | Mitigation | Component |
|---|---|---|
| Surveillance of spending habits | Funds held shielded (Ironwood pool) at rest; fresh address per order | Zcash wrapper service |
| Agent spending beyond user intent | Hard budget/category/merchant/expiry caps, checked twice independently | Guardian + Signer |
| Prompt injection via product listings | Untrusted text never reaches destination/amount/authorization fields | Guardian + Order schema |
| Replay of a prior authorization | Nonce + authorization-token expiry + signer-side consumed-nonce ledger | Signer |
| Concurrent-order overspend | Serialized SQLite transaction around budget deduction + nonce consumption | Mandate engine |
| Compromised AI agent attempting max spend | Capped at the mandate's total, enforced outside the agent's reach | Guardian + Signer |
| Compromised ordinary backend reaching the signer **for signing** | Signer is a separate process reachable only via authenticated internal RPC, re-validates independently | Signer isolation — **but see the narrowed limitation below regarding shared mandate-state storage** |

**Narrowed threat-model boundary, stated explicitly (new, builder-pack-required):** the signer currently reads mandate state from the same SQLite database the backend API writes to. OBSCURA's hackathon-MVP threat model defends against a **compromised AI agent** and a **compromised/malicious API caller submitting forged orders** — it does **not** defend against an attacker with arbitrary write access to the backend's database file or process memory, which is treated as equivalent to full backend compromise and is out of scope for this build. See `security-architecture.md` §3 for the full reasoning and the Plan B mitigation (signer-owned datastore the API process cannot write to).

## 2. What OBSCURA does NOT protect against — stated plainly, per the original spec's own commitment to honesty

| Party | What they can see | Why this is accepted, not hidden |
|---|---|---|
| Public blockchain observers | Nothing of substance — shielded pool | This is the actual privacy win |
| Bitrefill | The product purchased, price, delivery destination/contact, and the real invoice's payment address/amount (even though it is never actually paid in the MVP) | Bitrefill is the merchant; it must know what it's delivering and to whom |
| LLM provider (Google Gemini) | The user's shopping prompt text and the mandate's category/budget summary | Needed for the agent to function; **never the key material, never other mandates, never full spending history** |
| A fully compromised user device | Everything the user's wallet can see/sign | Out of scope — no software system protects against full device compromise; explicitly not claimed |
| Anyone with write access to the backend's SQLite file | Could forge mandate state the signer reads (see narrowed boundary above) | Accepted hackathon-scope limitation, not hidden |

**MVP correction**: there is no live swap-provider counterparty in the hackathon build (settlement is simulated — see `demo-scope.md`), so the previously-listed "SideShift/ChangeNOW sees the ZEC amount and destination" row is **removed as inapplicable to the MVP** and moved to Plan B, where it would apply again once a real swap integration exists.

**Explicitly not claimed anywhere in this project**: that purchases are invisible to Bitrefill; that a swap provider (Plan B) cannot observe the payment; that the system provides complete anonymity; that the simulated settlement leg is a completed real purchase. These are the exact claims the original spec and the re-audit both call out as things not to say, and this architecture does not say them.

## 3. A real-world cautionary note, directly relevant to this project

In May 2026, a researcher found an under-constrained elliptic-curve operation in the Orchard proof circuit — a soundness bug that, left unpatched, could theoretically have allowed undetectable counterfeit ZEC to be created inside a shielded pool that had been considered secure for years. The response (the Ironwood upgrade) didn't try to identify bad actors or freeze specific coins — it sealed the pool to new deposits and opened a fresh one. The lesson for OBSCURA's own design: **treat even well-audited cryptography as potentially flawed, and prefer fail-closed, bounded-blast-radius designs over "trust the crypto, trust the model."** This is exactly the philosophy already baked into the guardian/signer double-check and the envelope-per-mandate isolation — this incident is cited here as validation of that design choice, not as an unrelated aside.

## 4. Threats specific to the two-developer, hackathon-scale build (operational, not cryptographic)

| Risk | Mitigation |
|---|---|
| `zcash-devtool` CLI-wrapping proves too brittle to automate reliably in the time available | First task today — if it fails, fall back to a narrated, operator-run CLI command live in the demo rather than a hidden, unverified abstraction |
| `jinolabs` faucet confirmed paused for NU7; public testnet infra degrades under hackathon load | `valargroup` faucet confirmed paying post-Ironwood; `Thus Spoke Zakura` local network kept running as a zero-network-dependency fallback for the live demo |
| No swap provider supports testnet TAZ — commerce settlement cannot be real | Settlement leg explicitly simulated and labeled; see `demo-scope.md` — never presented as a completed purchase |
| Guardian/signer bugs introduced under time pressure | Guardian is pure/unit-testable without any live dependency — keep it that way; do not let hackathon time pressure justify merging guardian logic without its test suite green |
| Signer trusts a backend-shared database for mandate state | Narrowed threat model, stated explicitly in §1 above — not solved in the MVP, documented as a known limitation rather than silently assumed away |
