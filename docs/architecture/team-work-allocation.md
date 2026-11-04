# Team Work Allocation

Status: **Revised 2026-11-04** for the 1-day (Nov 4–5) hackathon MVP — see `development-roadmap.md` for Plan A (hackathon) vs Plan B (post-hackathon) task sequencing. The ownership boundaries below apply to both plans; only the task list and timeline differ.

## 1. Repository structure

```
zcash/                                   # repo root (git re-rooted here 2026-11-04)
├── .gitignore                           # shared, Dev 2 maintains
├── apps/
│   ├── web/                             # DEV 1 EXCLUSIVE — frontend (React+Vite+TS)
│   │   ├── src/pages/                   # dashboard, mandate creation, funding, shopping, receipts
│   │   ├── src/components/
│   │   ├── src/state/                   # client state mgmt
│   │   ├── src/wallet/                  # calls the zcash-adapter wrapper service's HTTP API — no crypto in-browser
│   │   └── src/api/                     # typed API client generated from packages/contracts
│   └── signer/                          # DEV 2 EXCLUSIVE — isolated signer process
│       └── src/                         # holds one independent zcash-devtool wallet per mandate; separate from services/api
├── services/
│   └── api/                             # DEV 2 EXCLUSIVE — backend
│       ├── src/mandate/
│       ├── src/guardian/ -> imports packages/guardian
│       ├── src/agent/                   # AI shopping agent orchestration (search-products, get-product-details only)
│       ├── src/payment/                 # Bitrefill invoice orchestration + simulated-settlement bookkeeping (MVP)
│       └── src/receipts/
├── packages/
│   ├── contracts/                       # SHARED — Dev 2 maintains, Dev 1 proposes via PR
│   ├── guardian/                        # DEV 2 EXCLUSIVE — pure, no-AI validation engine
│   ├── zcash-adapter/                   # DEV 1 EXCLUSIVE — Node wrapper shelling out to zcash-devtool (CLI)
│   └── bitrefill-client/                # DEV 2 EXCLUSIVE — Bitrefill API/MCP wrapper (7-tool MCP list, see bitrefill-integration.md)
├── tests/
│   └── attack-scoreboard/               # DEV 2 EXCLUSIVE — ~20 adversarial scenarios
├── docs/
│   └── architecture/                    # this deliverable; both developers may propose edits via PR, no direct pushes after initial approval
└── scripts/                             # shared utility scripts (seed/demo data) — Dev 2 maintains, single owner to avoid conflicts
```

Root-level config files (`package.json` workspace root, `tsconfig.base.json`, CI config if added) — **Dev 2 maintains**, since the backend/monorepo tooling is their domain; Dev 1 proposes changes via PR rather than editing directly, to avoid both developers racing on the same root files.

## 2. Hard ownership boundaries

- Developer 1 **never** edits: `services/api/`, `packages/guardian/`, `packages/bitrefill-client/`, `apps/signer/`, `tests/attack-scoreboard/`.
- Developer 2 **never** edits: `apps/web/`, `packages/zcash-adapter/`.
- `packages/contracts/` — see `data-models.md`'s change-approval process; neither developer edits it as a drive-by part of an unrelated PR.
- `docs/architecture/` — after this initial approval, changes go through PR review by both, since both rely on it as the source of truth.

## 3. Git workflow

- `main` — protected, only merges from `dev` after both developers approve.
- `dev` — integration branch.
- Feature branches: `dev1/<short-desc>` and `dev2/<short-desc>`, e.g. `dev1/wallet-funding-ui`, `dev2/guardian-budget-checks`.
- Commit convention: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`) — lightweight, not enforced by tooling, just a shared norm.
- PRs require the other developer's review **only when touching shared files** (`packages/contracts/`, `docs/architecture/`, root config); exclusively-owned directories can self-merge after passing tests, to keep velocity up.
- No direct commits to `main`.

## 4. The git-remote situation (do not act on this without the user)

Confirmed via `git remote -v` and `git log` on 2026-11-04:
- Remote `origin` → `github.com/Khushbu710/Email-assistant.git`, an unrelated repository name.
- Current branch: `TeamError`.
- Repo was previously (incorrectly) rooted at the home directory (`C:\Users\khush`), tracking unrelated home-directory files. This was fixed by moving `.git` into `C:\Users\khush\zcash\` and untracking the stale files — commit history preserved (`ee95b37` → `4a9e405` → `cd21fc5`).
- **No push has been made.** Per explicit instruction, the remote is left as-is until the correct OBSCURA repository URL is provided — do not push OBSCURA work to `Email-assistant.git`.

## 5. Dependency-locking and environment ownership

- `package-lock.json` (or equivalent) — whoever's PR changes dependencies commits the updated lockfile in the same PR; no separate "lockfile maintenance" owner needed at this scale.
- `.env.example` — Dev 2 maintains (backend has the most secrets: Bitrefill API key, signer's internal auth secret); Dev 1 adds frontend-only env vars (public, non-secret) and the `zcash-devtool` binary path/testnet endpoint config to the same example file via PR.
- Database file/migrations (SQLite) — Dev 2 owns; Dev 1 never writes migrations.
