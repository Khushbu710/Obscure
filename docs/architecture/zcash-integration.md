# Zcash Integration

Status: **Revised 2026-11-04 (re-audit) against the Free Society Hack / ZECATHON Zcash Developer Resources builder pack.** This revision supersedes the original `@zcashlabs/zcash.js` recommendation — see §2 for why.

## 1. Pool correction (unchanged from prior revision, now builder-pack-confirmed)

**Orchard was sealed to new deposits on 2026-07-28** (network upgrade "Ironwood"/NU6.3) after a soundness bug in its proof circuit. New shielded funds go to **Ironwood**, which reuses a patched Orchard circuit; Unified Addresses (`utest1...` on testnet) continue to work — Ironwood notes are received via the same Orchard receiver type the UA already encodes. [KuCoin](https://www.kucoin.com/news/flash/zcash-activates-ironwood-hard-fork-to-seal-orchard-pool-and-prevent-counterfeit-zec) — confirmed directly by the builder pack ("Orchard is sealed. Since NU6.3, new shielded funds go to Ironwood. Unified addresses continue to work.")

Additional builder-pack-confirmed facts now incorporated: testnet is TAZ-only (no monetary value), average block time ~25s, **v4 transactions are invalid** (only v5/v6 accepted post-NU7), mainnet NU7 activation is **not yet scheduled** as of the builder pack's writing (independent research found a 2026-11-05 target block, 3,543,405 — both can be true: a target height can exist without being irreversibly "scheduled" in the builder pack's stricter sense; treat mainnet NU7 timing as unconfirmed either way and irrelevant since **we are testnet-only**).

## 2. SDK selection — `@zcashlabs/zcash.js` is dropped

The prior architecture recommended `@zcashlabs/zcash.js` with two explicitly unresolved risks (NU7/Ironwood support, account-key isolation). Re-audit verified both negatively, and also found the builder pack's own top recommendation broken:

| Candidate | Verified status | Verdict |
|---|---|---|
| **WebZjs + `@zcash/sdk`** (builder pack's "Web app" recommendation) | **Confirmed broken for our need.** Builder pack explicitly excludes WebZjs from the NU7/Ironwood path. Independently confirmed: `@zcash/sdk` is a thin TypeScript convenience layer (`@zcash/uri`, `@zcash/qr`, `@zcash/monitor`) built **directly on top of WebZjs** — it inherits the same break. [Forum RFC](https://forum.zcashcommunity.com/t/zcash-sdk-a-typescript-developer-layer-over-webzjs-rfc-feedback-wanted/56944) | **Do not use.** |
| **Noir Wallet SDK** | **Confirmed currently broken on NU7 testnet.** Open issue: "NU7 not supported — all Zcash sends fail on Testnet since the Oct 4 activation (invalid consensus branch id)," because the wallet's `NetworkUpgrade` enum has no `Nu7` variant. [GitHub #23](https://github.com/NoirWallet/noir-wallet-sdk/issues/23) | **Do not use.** |
| **Zallet / zecd** | Builder pack states no NU7 release exists. | **Do not use** (builder-pack-confirmed exclusion). |
| **zcli/zecli** | Builder pack states these generate Orchard-only addresses that cannot receive NU7/Ironwood funds. | **Do not use** (builder-pack-confirmed exclusion). |
| **`@zcashlabs/zcash.js`** (prior pick) | Re-audit: README/API reference never mention Orchard or Ironwood; "NU7 compatibility" claimed in a release note but not demonstrated; account-key isolation undocumented. Small project (9 stars, 42 commits). | **Dropped — insufficient verified evidence, better-verified alternatives exist.** |
| **zcash-devtool** (official, `zcash/zcash-devtool`) | **Confirmed working with Ironwood.** Merged to `main`: balance, `list-unspent`, `send-max` surface the Ironwood pool; `pczt prove` builds Ironwood proofs; `wallet send` accepts `--tx-version 6`; shielding targets Ironwood. Built against current `librustzcash` crates (`zcash_client_backend` 0.24.0, `orchard` 0.15.5, `zip321` 0.9.0 — all final, non-pre-release). Rust CLI. | **Selected — see §3.** |
| **zingolib** | **Confirmed working against live testnet.** A recent build "synced 16,410 blocks across the [NU7] activation and decrypted 32,000 Ironwood outputs without error" against `testnet.zec.rocks`. Rust library, heavier integration lift than a CLI. | **Noted as the stronger long-term (Plan B) option; not chosen for the 1-day MVP due to integration time.** |
| **zeccheckout** (`samizdatproject/zeccheckout`) | Real reference implementation, confirmed Ironwood support in a live testnet demo, implements exactly the "server holds UFVK, never a spending key" pattern. Rust/axum/rusqlite. MIT, but dormant (0 stars, 12 commits) — a ZECATHON artifact itself, not a maintained dependency. | **Used as a validated reference pattern for the viewing-key monitoring design, not pulled in as a dependency.** |

**Decision: `zcash-devtool` (official Rust CLI) is the Zcash engine for the hackathon MVP**, invoked via a thin Node.js wrapper service that shells out to its subcommands and parses output. This is the fastest path to a *provably working* Ironwood testnet transaction, since it is the one option in this table with concrete, cited evidence of Ironwood support today, without requiring either developer to write new Rust code from scratch.

**Not yet verified (requires a live PoC, not more research — first task, today):** whether `zcash-devtool`'s CLI output is stable and parseable enough for reliable Node wrapping within the remaining hackathon time. If it proves too brittle under time pressure, the fallback is to drive it via its scripting/JSON output mode if one exists, or to accept a more manual, narrated demo step (operator runs a CLI command on camera) rather than a fully automated pipeline — **a visible, real CLI transaction is more defensible than a hidden, unverified abstraction.**

## 3. Where cryptographic operations actually run

| Operation | Owner | How |
|---|---|---|
| Wallet creation, address generation | `zcash-devtool wallet init` / equivalent | Produces a `utest1...` Unified Address |
| Balance query | `zcash-devtool wallet balance` | |
| Transaction construction + signing + broadcast | `zcash-devtool wallet send` | Builds a v6 (NU7-valid) transaction, fees computed by the tool per ZIP 317 |
| Confirmation monitoring | Poll `zcash-devtool wallet sync` / balance against `testnet.zec.rocks:443` | Distinguish **seen** (in mempool) vs **mined** (included in a block) vs **confirmed** (N further blocks) — see `payment-flow.md`'s state machine |

The frontend (React) **does not perform shielded cryptography itself** — it is a thin UI calling this wrapper service's HTTP API. This removes all browser/WASM-compatibility risk from the critical path.

## 4. Account/envelope isolation model — revised (Option 2′)

The original design proposed deriving a hardened ZIP-32 sub-account per mandate from one shared seed. This is **dropped**, not because the cryptography is wrong (ZIP-32 hardened derivation genuinely is independent — see [Orchard Book](https://zcash.github.io/orchard/design/keys.html)), but because **no verified tool in our stack exposes single-account spending-key export from a larger seed** — asserting isolation without being able to prove the export mechanism is exactly the mistake the builder pack warns against.

**Revised design: each mandate gets a wholly independent `zcash-devtool` wallet instance** (its own fresh seed, its own wallet database/directory), created at mandate-creation time — not a derived child of the user's main wallet. The user's main wallet (a separate `zcash-devtool` instance, logically "the user's device") sends exactly the mandate's budget to the new envelope wallet's address in one funding transaction. The signer service is handed only that one envelope wallet's directory/key material.

This gives **genuine, trivial-to-prove isolation**: the envelope's key has no cryptographic relationship to the user's main key or to any other mandate's key — it is simply a separate key. It directly satisfies every item the builder pack asked to be proven:

- *Exact derivation scheme*: none needed — independent generation, not derivation.
- *No master seed enters backend*: true by construction — the main wallet and envelope wallet are different processes/files; the user's main seed is never copied into the envelope's wallet or the signer.
- *No cross-mandate key exposure*: true by construction — separate wallet instances.
- *Can construct/sign Ironwood NU7 transactions*: yes, same `zcash-devtool` capability as §2–3.
- *Key material not persisted/logged*: the wrapper service must redact wallet-directory paths and any printed seed/key material from logs — this is an implementation requirement, not yet verified in code since no code exists yet.

**What this design does NOT prove by itself**: that the signer enforces the mandate's *spending limit* correctly — a wallet can still be asked to send more than the policy allows if the signer's own logic is buggy. The hard backstop is that **the envelope wallet can never send more than it was ever funded with** (on-chain balance is a real ceiling), which is a strictly stronger guarantee than relying on application logic alone — but application-level per-order and category checks still live in the guardian/signer, not in the wallet.

## 5. Testnet feasibility — re-verified

| Requirement | Status | Source |
|---|---|---|
| Public endpoint | **Confirmed live**: `testnet.zec.rocks:443`, 99.81% 30-day uptime, running Zebra 6.3.0 + lightwalletd 0.6.0 (Zaino), reporting the NU7 branch id | [hosh.zec.rocks/zec](https://hosh.zec.rocks/zec), community forum |
| NU7/Ironwood active on testnet | **Confirmed** — activated block 4,465,026, 2026-10-04 | [crowdfundinsider.com](https://www.crowdfundinsider.com/2026/10/315795-zcash-zec-turns-on-nu7-on-testnet-prior-to-nov-2026-mainnet-target/) |
| Faucet: `faucet.testnet.valargroup.dev` | **Confirmed paying post-NU7/Ironwood** — faucet payouts observed mined at blocks 4,478,666 and 4,478,900, both after the NU7 activation height | community forum / GitHub PR activity |
| Faucet: `zcashfaucet.jinolabs.xyz` | **Confirmed currently degraded** — an open PR in that repo is titled "drips are paused for NU7, point at a faucet that pays" | [jinolabs-xyz/zcash-faucet PR #743](https://github.com/jinolabs-xyz/zcash-faucet/pull/743) |
| Faucet: `fauzec.com` | **Not independently confirmed** for Ironwood specifically in this pass | Unverified — treat `valargroup` as primary |
| Local fallback: Thus Spoke Zakura v0.4.0 | **Confirmed real and NU7-ready** — a fully local, Docker-based private Zcash network; "activates every network upgrade through NU7 at height 1"; includes its own faucet, auto-mining, lightwalletd, browser wallet, explorer. No external network dependency. | repo README |

**Decision: primary funding path is the public testnet via `valargroup`'s faucet and `testnet.zec.rocks`. `Thus Spoke Zakura` is kept running in reserve as the live-demo fallback** if public testnet infrastructure degrades during judging — it requires no network connection and mines instantly, which is strictly better for a time-boxed demo than waiting on ~25s public blocks and rate-limited faucets.

## 6. Fresh address per order and sweeping

Unchanged in principle: a fresh receiving address is used for each outbound payment where practical; on mandate `revoked`/`expired`, remaining envelope funds are swept back to the user's main wallet via a normal `zcash-devtool send` from the envelope wallet, which the signer (not the user) can execute since it already holds that envelope's key — **note this is a deliberate asymmetry from the original "sweep is always user-signed" statement**: since the envelope key lives with the signer by design (not the user), sweep-back is signer-executed, triggered by mandate state transitioning to `revoked`/`expired`, not a separate user signature. This is simpler and consistent with the rest of Option 2′.

## 7. What this buys privacy-wise, stated honestly

Unchanged from the prior revision: shielded at rest in the Ironwood pool; not hidden from the swap/settlement step (now moot for the MVP, see `demo-scope.md` — testnet TAZ cannot be swapped to anything of value anyway); not hidden from Bitrefill; explicitly no protection against a compromised user device.


## 8. Live PoC results (2026-11-04, measured — not research)

This section is the "live PoC" the roadmap required. Everything below was run against the live Zcash testnet (`testnet.zec.rocks:443`, chain tip ≈ 4,582,000, NU7/Ironwood active) with `zcash-devtool` built from `zcash/zcash-devtool` at commit `0b3436bb`. Re-run: `scripts/checkpoint-a.ts` (script) and `scripts/live-http-run.ts` (over HTTP with a separate signer process).

**Verdict: the Zcash leg is real.** `zcash-devtool` can be driven from Node (create wallet, address, balance, send, confirmation status, sweep) and produces Ironwood-pool transactions that the testnet accepts and confirms.

### Faucets (what actually worked)

| Faucet | Result |
|---|---|
| `faucet.testnet.valargroup.dev` | **Failed.** `/api/status` said `ready: true`, but every claim failed with "the wallet cannot pay this address" — reproduced through its own API, even for a plain transparent address. |
| `zcashfaucet.jinolabs.xyz` | **Down.** Its own status showed 0 drips in 30 days, the miner inactive for ~27 days, the node ~8,600 blocks behind. A request showed "in line" and never paid. |
| `faucet.zecpages.com` | Unreachable. |
| **`fauzec.com`** | **Worked.** 1 TAZ to a Unified Address (Orchard+Sapling receivers), received as **Ironwood**, tx `a58b9ce6…2660`, block 4,582,318. Needs a browser Cloudflare check; 1 TAZ per address per 24 h. Does not accept plain transparent addresses. |

### Verified transactions

| Step | txid | Block | Notes |
|---|---|---|---|
| Faucet → main wallet | `a58b9ce674f7f4212432f6a95fefe891b0c35f88d7ccd55863a098c449812660` | 4,582,318 | 1.00000000 TAZ, Ironwood |
| Main → envelope (funding) | `3edb8a5f2efad42b85e7d1bb9b4ee1af9bb0083954a121985911f0a71ffb4dfa` | 4,582,329 | 0.30 TAZ, Ironwood → Ironwood, fee 0.00025 TAZ |
| Checkpoint A (1st, pre-merge signer) | `f786a9a624fbc6f48b5c649fb4221cf60d83e4c1383232b296e9774295f3958c` | 4,582,465 | guardian-approved order, signer-paid 0.05 TAZ from the envelope, fee 0.00015 |
| Checkpoint A (reconciled signer) | `929488e9184326444a210c67eb5f524bacbdf39962480612075427886c4e9b1f` | 4,582,521 | status progressed broadcast → mined → confirmed |
| Live HTTP run: funding | `1865a9ba6c5ebcbb9cd0b2a7891c636f395e414d3cd5bbdb532fb2aa550af9b2` | 4,582,576 | the signer process created the envelope wallet over HTTP |
| Live HTTP run: order payment | `ef297b23aa6fdfe407820eac4b4175fcdd90e2d6d39f082311043916d06b8b50` | 4,582,587 | 0.05 TAZ (500 cents × 10,000 zatoshi/cent), delivered (simulated settlement) |
| Live HTTP run: sweep-back | `d9fcf1c89caceb37740f3adddaba7ca775cf52ff502a6f9e08101081cb4274bc` | 4,582,591 | 0.0498 TAZ back to the user's main wallet |

Every payment above was confirmed from the **receiving** wallet's own `list-tx`, not only from the sender's log.

### Measured behaviour to design around

- **Spendability lags receipt.** A received note shows in `total` after about one block but is `spendable` only after ~10 confirmations (≈ 4–5 minutes on this testnet). The UI must show both and must not treat `spendable = 0` as unfunded.
- **Fees (ZIP-317):** 0.00015 TAZ for a simple 1-recipient send; 0.00025 TAZ when the wallet splits change into 4 notes (the default note management).
- **Transaction version:** `wallet send` chose the version itself and the network accepted it. Its help text says `--tx-version` takes 4 or 5; this earlier doc claimed 6. **We did not independently inspect the version field** — only that the testnet accepted and confirmed the transactions.
- **Output format:** `wallet send` prints the txid as its final line; `wallet list-tx` prints `Mined: <height>` once mined; `wallet balance --json` and `wallet get-info` emit single-line JSON. Parsers in `packages/zcash-adapter/src/cliAdapter.ts` are tested against verbatim captured output.
- **A hang was observed once:** the first run of `wallet init` for a new wallet from a Node subprocess hung until killed; the same command worked in seconds from a shell. The cause was not confirmed. Mitigation (not proof of cause): the adapter's runner now closes the child's stdin and applies a per-command timeout.
- **Per-command latency:** each CLI call (sync, balance) takes seconds, not milliseconds. Confirmation tracking therefore polls; it does not subscribe.

### What this does and does not show

- Shows: Ironwood wallets, funding, signed payments from an isolated per-mandate envelope wallet, confirmation tracking, and sweep-back all work on the live testnet through the real signer and adapter.
- Does not show: any real Bitrefill purchase (testnet TAZ cannot pay one — see `demo-scope.md`), live Anthropic/Bitrefill calls (no keys were available; the live run used a scripted agent and a fixture product), or that the signer is isolated from a compromised backend with write access to the shared SQLite file (`security-architecture.md` §3).
