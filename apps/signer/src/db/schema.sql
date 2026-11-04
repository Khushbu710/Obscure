-- OBSCURA signer schema - intentionally duplicated, not imported, from
-- services/api/src/db/schema.sql.
--
-- Why duplicated rather than shared: the whole point of the signer being a
-- separate module/process (docs/architecture/security-architecture.md §1/§3)
-- is that it must not re-couple itself to the ordinary backend's code. In
-- this hackathon MVP the signer still points at the SAME physical SQLite
-- file the backend API writes to (CREATE TABLE IF NOT EXISTS means this is
-- safe to run against that already-populated file), which is an explicitly
-- documented, narrowed threat-model limitation: see security-architecture.md
-- §3, "Honest limitation, stated explicitly" - a fully compromised backend
-- process with write access to that file could tamper with mandate/order
-- state before the signer reads it. Plan B (out of scope here) is a
-- signer-owned, backend-unreachable datastore. Only the columns the signer
-- actually reads/writes are declared here.

CREATE TABLE IF NOT EXISTS mandates (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked', 'expired')),
  allowed_categories  TEXT NOT NULL,
  allowed_merchants   TEXT,
  allowed_product_ids TEXT,
  total_cap_minor     INTEGER NOT NULL,
  per_order_cap_minor INTEGER,
  spent_minor         INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL,
  envelope_wallet_ref TEXT,
  receiving_address   TEXT,
  funded_at           TEXT,
  funding_tx_id       TEXT,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  schema_version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  order_id        TEXT PRIMARY KEY,
  mandate_id      TEXT NOT NULL REFERENCES mandates(id),
  product_json    TEXT NOT NULL,
  price_minor     INTEGER NOT NULL,
  nonce           TEXT NOT NULL,
  status          TEXT NOT NULL,
  proposed_at     TEXT NOT NULL,
  agent_reasoning TEXT
);
