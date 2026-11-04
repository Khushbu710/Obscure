# Component Architecture

## 1. Module list and ownership

| # | Module | Directory | Owner | Depends on |
|---|---|---|---|---|
| 1 | Frontend (dashboard) | `apps/web/` | Dev 1 | api-contracts, shared contracts |
| 2 | User wallet | own `zcash-devtool` wallet instance, managed via the Zcash wrapper service | Dev 1 | Zcash wrapper service |
| 3 | Zcash wrapper service | `packages/zcash-adapter/` | Dev 1 | `zcash-devtool` (official Rust CLI, shelled out to) |
| 4 | Backend API | `services/api/` | Dev 2 | mandate engine, guardian, agent, receipts, shared contracts |
| 5 | Mandate engine | `services/api/mandate/` | Dev 2 | persistence |
| 6 | Deterministic guardian | `packages/guardian/` | Dev 2 | mandate engine (read-only), shared contracts — **no AI, no network** |
| 7 | AI shopping agent | `services/api/agent/` | Dev 2 | Bitrefill MCP/API, guardian (as a gate, not a dependency of the agent itself) |
| 8 | Bitrefill client | `packages/bitrefill-client/` | Dev 2 | Bitrefill Personal API |
| 9 | Signer service | `apps/signer/` | Dev 2 | Zcash adapter (as library), mandate engine (read-only query) |
| 10 | Payment orchestrator | `services/api/payment/` | Dev 2 | Bitrefill client, signer — settlement is **simulated** in the MVP (no swap provider supports testnet TAZ); real swap integration is Plan B only |
| 11 | Receipt & proof service | `services/api/receipts/` | Dev 2 | persistence, crypto (signing + commitments) |
| 12 | Shared contracts | `packages/contracts/` | **Dev 2 maintains, both propose changes via PR** | none (leaf package) |
| 13 | Security/attack test suite | `tests/attack-scoreboard/` | Dev 2 | guardian, signer (as test subjects) |

## 2. Trust boundaries (critical — read alongside `security-architecture.md`)

There are exactly **three** processes that ever see cryptographic key material, and they are never the same process as the AI agent:

1. **User's main wallet** — an independent `zcash-devtool` wallet instance. Only operation: fund a newly created, wholly separate envelope wallet per mandate. Never called by the agent, backend, or signer.
2. **Signer service** — a separate OS process from the backend API, holding **one independent `zcash-devtool` wallet instance per mandate** (its own seed, generated fresh — not derived from the user's wallet, never another mandate's wallet). Only reachable via an internal, authenticated RPC call carrying a guardian-approved authorization object. See `zcash-integration.md` §4 ("Option 2′") for why this replaced the original hardened-sub-account design.
3. **Zcash wrapper service**, shared — shells out to `zcash-devtool`; stateless with respect to keys beyond invoking the CLI against a given wallet directory, and must not log wallet paths/seeds/keys.

The **backend API** and **AI agent** never hold any key material, shielded balance beyond what the guardian reports as "remaining budget," or the ability to call the signer directly without a guardian-approved authorization object.

## 3. Component interaction — approval path (the one that matters most)

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant API as Backend API
    participant A as AI Agent
    participant BR as Bitrefill
    participant G as Guardian
    participant S as Signer
    participant ZA as Zcash Wrapper (devtool)

    U->>FE: "find me a 5GB eSIM for Japan under $15"
    FE->>API: POST /shopping-requests
    API->>A: run agent with mandate context (category/budget only, not keys)
    A->>BR: search + compare products (Bitrefill MCP: search-products, get-product-details only)
    BR-->>A: product list (UNTRUSTED text)
    A->>API: propose structured order {item, price, merchant, nonce}
    API->>G: validateOrder(order, mandateId)
    G->>G: check category, merchant, live price, budget, per-order cap, expiry, nonce
    alt rejected
        G-->>API: {approved:false, code, reason}
        API-->>FE: show rejection + reason
    else approved
        G-->>API: {approved:true, authorizationToken} -- order moves to reserved
        API->>BR: buy-products (create real invoice, read payment.address/price)
        API->>S: requestSignature(authorizationToken, order)
        S->>S: INDEPENDENTLY re-validate mandate + order + nonce unconsumed
        S->>ZA: zcash-devtool send from this mandate's wallet (real testnet tx)
        ZA-->>S: signed, broadcast tx
        S->>S: mark nonce consumed (atomic); wait for confirmation
        S-->>API: {txId, status: confirmed}
        API->>API: mark settlement SIMULATED (no testnet->Bitrefill path exists, see demo-scope.md)
        API->>FE: order complete (real Zcash leg + simulated settlement), receipt created
    end
