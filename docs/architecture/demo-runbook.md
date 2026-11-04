# Demo Runbook

Status: **2026-11-04.** How to start OBSCURA reliably, prepare the demo, and recover when something breaks. Everything here was exercised on the live Zcash testnet except where marked **(not yet verified)**. The claims you may make are governed by `demo-scope.md`; if anything here conflicts with it, `demo-scope.md` wins.

## 0. Three rules for the demo

1. **Pre-fund the envelope before you go on stage or record.** A new envelope's funds take about **5 minutes** (≈10 confirmations) to become spendable. Never fund live.
2. **Say what is simulated.** The Zcash transaction is real; the Bitrefill settlement is simulated (testnet TAZ cannot pay Bitrefill). The amount uses a fixed demonstration rate, not a live exchange rate.
3. **Never improvise a claim** beyond `demo-scope.md` §4 ("never claim" list).

## 1. One-time prerequisites

- Node **22+** (`node -v`).
- `zcash-devtool` built (see `zcash-integration.md` §8). Note its path, e.g. `…/tools/zcash-devtool/bin/zcash-devtool.exe`.
- A funded **main wallet** (the user's wallet) and a **settlement wallet** (where demo payments go). Each lives in a folder with its age identity file next to it (`main`, `main.identity.txt`, `settlement`, `settlement.identity.txt`). These are test-only wallets; their files are git-ignored. Never commit them.
- `npm install` at the repo root, then `npm run build:contracts && npm run build:guardian && npm run build:zcash-adapter`.

Get the two addresses you will need:

```sh
D=<path-to>/zcash-devtool.exe
$D wallet -w <wallets-dir>/main list-addresses       # copy "Default Address" -> USER_SWEEP_ADDRESS
$D wallet -w <wallets-dir>/settlement list-addresses # copy "Default Address" -> DEMO_SETTLEMENT_ADDRESS
```

Check the main wallet has funds (the demo needs about 0.1 TAZ per run):

```sh
$D wallet -w <wallets-dir>/main sync && $D wallet -w <wallets-dir>/main balance --json
```

Need more TAZ? `fauzec.com` gave 1 TAZ per address per 24 h (browser Cloudflare check). Other faucets were broken on 2026-11-04; see `zcash-integration.md` §8. Zcash mentors on site can also send TAZ.

## 2. Environment variables

The API and signer read **process environment only** (there is no `.env` loader), so export them in the shell that starts each process. Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use **three different** random values.

| Variable | Used by | Meaning |
|---|---|---|
| `OBSCURA_DB_PATH` | API, signer | **The same SQLite file** for both (documented MVP limitation). |
| `GUARDIAN_HMAC_SECRET` | API, signer | Signs/verifies the guardian's authorization token. Must match. |
| `SIGNER_AUTH_SECRET` | API, signer | HMAC for backend→signer requests. Must match. |
| `SIGNER_BASE_URL` | API | `http://127.0.0.1:8789` |
| `DEMO_SETTLEMENT_ADDRESS` | API, signer | The only address payments may go to. |
| `DEMO_ZATOSHI_PER_MINOR` | API | Fixed demo rate. Default `10000` (zatoshi per USD cent). |
| `USER_SWEEP_ADDRESS` | signer | Where a revoked/expired envelope is swept. |
| `ZCASH_DEVTOOL_PATH` | signer | Path to the `zcash-devtool` binary. |
| `SIGNER_WALLETS_DIR` | signer | Folder where the signer keeps the per-mandate envelope wallets. |
| `RECEIPT_KEY_FILE` | API | e.g. `./receipt-keys.json`. **Set it**, or receipts become unreadable after a restart. |
| `ANTHROPIC_API_KEY`, `BITREFILL_API_KEY` | API | Live agent + real invoices. **Not yet verified:** no working keys were available. Without them `POST /api/shopping/requests` returns `503 AGENT_NOT_CONFIGURED` and no payment can start. |
| `VITE_API_BASE_URL` | web | Defaults to `http://localhost:8787`. |

## 3. Start order

Always **signer → API → web**, each in its own terminal, from the repo root.

```sh
# Terminal 1 - signer (loopback only)
export OBSCURA_DB_PATH=./obscura.sqlite SIGNER_PORT=8789 \
  SIGNER_AUTH_SECRET=<secret-A> GUARDIAN_HMAC_SECRET=<secret-B> \
  ZCASH_DEVTOOL_PATH=<path> SIGNER_WALLETS_DIR=./wallets \
  DEMO_SETTLEMENT_ADDRESS=<settlement-address> USER_SWEEP_ADDRESS=<main-address> \
  SIGNER_ADAPTER_TIMEOUT_MS=120000
npx tsx apps/signer/src/main.ts

# Terminal 2 - API
export OBSCURA_DB_PATH=./obscura.sqlite PORT=8787 \
  GUARDIAN_HMAC_SECRET=<secret-B> SIGNER_BASE_URL=http://127.0.0.1:8789 SIGNER_AUTH_SECRET=<secret-A> \
  DEMO_SETTLEMENT_ADDRESS=<settlement-address> DEMO_ZATOSHI_PER_MINOR=10000 \
  RECEIPT_KEY_FILE=./receipt-keys.json \
  ANTHROPIC_API_KEY=<key> BITREFILL_API_KEY=<key>
npm run dev -w @obscura/api

# Terminal 3 - frontend
npm run dev -w @obscura/web
```

Smoke checks: `curl localhost:8787/health` → `{"ok":true}`; `curl localhost:8789/health` → `{"ok":true}`; the frontend's Settings page shows the backend as reachable.

## 4. Pre-demo checklist (start 30 minutes before)

1. Start the three processes (§3). Confirm both `/health` endpoints.
2. **Refresh the attack scoreboard** so the page shows a fresh, real run: `npm run scoreboard -w @obscura/attack-scoreboard` (expect `24/24 passed`). It must say so honestly; if anything fails, fix it or say so.
3. **Create the demo mandate** in the UI: $30 cap, eSIM only, 24 h. Or by API: `POST /api/mandates` with `{"allowedCategories":["esim"],"totalCapMinor":3000,"currency":"USD","durationHours":24}`.
4. **Create its envelope:** `POST /api/mandates/<id>/fund` → note `receivingAddress`.
5. **Fund the envelope from the main wallet** (0.1 TAZ = 10,000,000 zatoshi):
   ```sh
   $D wallet -w <wallets-dir>/main send -i <wallets-dir>/main.identity.txt --address <receivingAddress> --value 10000000
   ```
   Copy the printed txid; you will show it.
6. **Wait until spendable:** poll `GET /api/mandates/<id>/envelope` until `spendableZatoshi >= 10000000` (about 5 minutes). `total` rises first; do not start until `spendable` does.
7. Rehearse the exact prompt once on a *different* throwaway mandate if time allows; do not reuse the demo mandate's budget.

## 5. Demo sequence (maps to `demo-scope.md` §5)

| # | Show | Say (honestly) |
|---|---|---|
| 1 | The mandate: $30, eSIM-only, 24 h | "A budget, not my keys." |
| 2 | The funding txid and its confirmation | "Real Zcash testnet transaction, Ironwood pool." |
| 3 | Shopping prompt, e.g. "find me a 1GB eSIM for Japan" | Real agent search **only if live keys are verified**; otherwise say the agent step is scripted. |
| 4 | Guardian result | "Deterministic code, no AI, checked the mandate." |
| 5 | The payment: `broadcast → mined → delivered` and its txid | "Real signed transaction from the isolated signer; it re-validated everything itself." |
| 6 | The **SIMULATED SETTLEMENT** label | "Testnet funds have no market value, so no swap provider can convert them; this step is simulated and labelled." |
| 7 | Security page: the scoreboard, then one attack (price mismatch / revoked mandate / replay) | "Real runs against the real code, 24 scenarios." |
| 8 | The receipt, then *disclose* | "A signature and a hash commitment, **not** a zero-knowledge proof." |
| 9 (optional) | Revoke the mandate, then sweep | "Unspent funds return to the user's wallet, executed by the signer." |

Explorer links for txids: the faucet's status reported `https://testnet.zcashexplorer.app/transactions/{txid}`. **(not yet verified for Ironwood transactions — open one before the demo; if it does not show them, show `list-tx` output from the wallet instead).**

## 6. If something breaks

| Symptom | Cause / fix |
|---|---|
| `502 SIGNER_UNAVAILABLE` | Signer process is down or secrets differ. Restart terminal 1; check `SIGNER_AUTH_SECRET` matches on both. |
| `503 SIGNER_NOT_CONFIGURED` | API started without `SIGNER_BASE_URL`/`SIGNER_AUTH_SECRET`. |
| `503 AGENT_NOT_CONFIGURED` | Missing `ANTHROPIC_API_KEY`/`BITREFILL_API_KEY`/`GUARDIAN_HMAC_SECRET`. Fall back to the recorded video or `scripts/live-http-run.ts` (scripted agent, real chain). Say so. |
| Order stays `reserved`, nothing is paid | The API has no `DEMO_SETTLEMENT_ADDRESS` (so no intent is bound and the signer refuses) or no invoice creator. Set it and restart. |
| `403` with `DESTINATION_MISMATCH` | `DEMO_SETTLEMENT_ADDRESS` differs between API and signer. |
| Envelope shows `spendable = 0` | Wait: ~10 confirmations. |
| Order `payment_uncertain` | The wallet did not answer in time; the system **holds** the budget and never retries (by design). Explain it; reconcile by checking the envelope wallet's `list-tx`. |
| Testnet slow | Blocks are ~25–40 s. Use the pre-funded envelope and the backup video. |
| Receipts unreadable after a restart | `RECEIPT_KEY_FILE` was unset (ephemeral keys). Create a new order after restart with it set. |

## 7. Rehearsal checklist (do it twice, end to end)

- [ ] Fresh start of all three processes from a cold terminal, using only this document.
- [ ] Demo mandate created, envelope funded, `spendable` reached **before** the run starts.
- [ ] Full demo sequence (§5) in under ~5 minutes, narrating the real vs simulated parts out loud.
- [ ] One deliberate failure shown (an attack from the scoreboard) and its exact rejection code.
- [ ] Record a **backup video** of a complete successful run, in case live infrastructure fails during judging.
- [ ] Note the txids from each rehearsal in a scratch file; they are your evidence if the live run fails.
