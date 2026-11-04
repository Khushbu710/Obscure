# OBSCURA — Local Setup

This is the minimal path to running the backend API, the signer, and the
frontend locally. It does not replace the architecture docs in
`docs/architecture/` — it only covers environment configuration and startup.

## 1. Prerequisites

- Node.js >= 22 (the repo uses `node:sqlite`, an experimental built-in that requires a recent Node 22)
- npm (workspaces-aware; this is an npm workspaces monorepo)
- A `zcash-devtool` binary built locally if you want real Zcash testnet functionality (see `docs/architecture/zcash-integration.md` section 2 for how to build it) - **not required** to run the mandate/agent/guardian flow in a "signer not configured" demo mode
- A Google Gemini API key if you want the AI shopping agent to actually run (otherwise `POST /api/shopping/requests` honestly returns `503 AGENT_NOT_CONFIGURED`)
- A Bitrefill Personal API key, same caveat

## 2. Create your local `.env` files

Two components need their own `.env` file, copied from the templates already committed in the repo:

```
cp services/api/.env.example services/api/.env
cp apps/signer/.env.example apps/signer/.env
```

(`apps/web/.env.example` also exists, for the frontend's `VITE_API_BASE_URL` - copy it the same way if you need to override the default `http://localhost:8787`.)

Edit the two new `.env` files with real values as described below. **Never commit `.env` files** - `.gitignore` already excludes `.env`/`.env.*` (with an explicit exception for the `.env.example` templates themselves).

## 3. Where to get external credentials

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) → "Get API key". Free tier is sufficient for development. |
| `BITREFILL_API_KEY` | [bitrefill.com](https://www.bitrefill.com/) → Account → Developers → Personal API. |

Both are optional in the sense that the server still boots and the rest of the API works without them - only `POST /api/shopping/requests` degrades to `503 AGENT_NOT_CONFIGURED` if either is missing.

## 4. Configuring the Zcash devtool path (signer only)

`apps/signer/.env`'s `ZCASH_DEVTOOL_PATH` is **machine-specific** - it must point at wherever you or your teammate built the `zcash-devtool` binary locally (there is no package to install; it's built from source per `docs/architecture/zcash-integration.md` section 2). Set it to the absolute path of that built binary, e.g.:

```
ZCASH_DEVTOOL_PATH=/home/you/zcash-devtool/target/release/zcash-devtool
```

Without a real binary at that path, the signer's wallet/payment operations (`/wallets/create`, `/wallets/status`, `/wallets/sweep`, `/sign`) will fail when actually invoked - the signer still starts, but those calls fail with `WALLET_FAILURE`/`ADAPTER_ERROR` rather than crashing.

## 5. Configuring the signer wallet directory

`SIGNER_WALLETS_DIR` (default `./wallets`, relative to wherever the signer process runs) is where the signer creates one independent wallet subdirectory per mandate, the first time that mandate is funded. This directory **is git-ignored** (`wallets/` in `.gitignore`) and contains real wallet state once used - never commit it, never copy it between machines casually (each wallet's identity file is effectively key material).

If your teammate has already created and funded envelope/main wallets during earlier testnet work, point `SIGNER_WALLETS_DIR` at that existing directory rather than starting fresh, so those funded wallets are reused instead of new empty ones being created.

## 6. Secrets that must match between the API and the signer

Two secrets are shared and **must be set to the identical value** in both `services/api/.env` and `apps/signer/.env`, or the two processes cannot authenticate with each other:

- `GUARDIAN_HMAC_SECRET` - the signer independently verifies the guardian's authorization token using this secret; if it doesn't match what the API used to issue the token, every signing attempt fails closed with `INVALID_TOKEN`.
- `SIGNER_AUTH_SECRET` - the API's `HttpSignerClient` HMAC-signs every request to the signer with this secret; the signer verifies the same secret on every incoming request. A mismatch causes every `/fund`, `/envelope`, `/sweep`, and `/sign` call to fail with `401 UNAUTHORIZED`.

Generate each as a random value (e.g. `openssl rand -hex 32`) and copy the **same** value into both files - do not reuse `GUARDIAN_HMAC_SECRET` as `SIGNER_AUTH_SECRET` or vice versa; they are deliberately distinct secrets for distinct trust boundaries.

Two more values are shared by convention, not by secrecy - both processes should point at the same database file and the same settlement address:
- `OBSCURA_DB_PATH` - both processes read/write the same SQLite file (a documented, narrowed trust-boundary limitation - see `docs/architecture/security-architecture.md` section 3).
- `DEMO_SETTLEMENT_ADDRESS` - the fixed destination the backend binds into every authorization token and the only address the signer's allowlist will pay to; must be the same value in both `.env` files.

## 7. What's generated locally vs. obtained externally

| Generated locally (do not request from anyone, do not commit) | Obtained externally |
|---|---|
| `GUARDIAN_HMAC_SECRET`, `SIGNER_AUTH_SECRET` - random values you generate yourself | `GEMINI_API_KEY` - from Google AI Studio |
| `RECEIPT_KEY_FILE` (default `./receipt-keys.json`) - created automatically on first run by the receipt service; holds an Ed25519 key and an AES-256 key | `BITREFILL_API_KEY` - from Bitrefill |
| `SIGNER_WALLETS_DIR` contents - created automatically by the signer the first time each mandate is funded | `ZCASH_DEVTOOL_PATH` binary - built once from source (see section 4); the *path* to it is machine-specific, the binary itself isn't a secret |

## 8. Starting everything

Build the shared packages once (and after any change to them):

```
npm install
npm run build:contracts
npm run build:guardian
npm run build:bitrefill-client
npm run build:zcash-adapter
npm run build:signer
```

Then, in separate terminals:

```
npm run dev -w @obscura/signer     # port 8789 (apps/signer/.env must be configured)
npm run dev -w @obscura/api        # port 8787 (services/api/.env must be configured)
npm run dev -w @obscura/web        # Vite dev server, defaults to talking to localhost:8787
```

Order matters a little: start the signer before the API if you want wallet/payment routes to be live from the moment the API boots (the API checks `SIGNER_BASE_URL`/`SIGNER_AUTH_SECRET` at startup, not the signer's actual reachability - it will still boot and simply return `502 SIGNER_UNAVAILABLE` per-request if the signer isn't up yet).

To confirm the backend is up: `curl http://localhost:8787/health` should return `{"ok":true}`.
