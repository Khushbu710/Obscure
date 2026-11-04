-- OBSCURA backend schema.
-- Single SQLite file, single writer connection (node:sqlite DatabaseSync).
-- See docs/architecture/security-architecture.md §4 for why this is sufficient
-- at hackathon scale: SQLite serializes writers, so the reservation
-- transaction below is genuinely atomic for concurrent order approvals.

CREATE TABLE IF NOT EXISTS mandates (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked', 'expired')),
  allowed_categories  TEXT NOT NULL,              -- JSON array
  allowed_merchants   TEXT,                       -- JSON array or NULL = any
  allowed_product_ids TEXT,                       -- JSON array or NULL = any
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

CREATE INDEX IF NOT EXISTS idx_orders_mandate_id ON orders(mandate_id);

-- Unique constraint is the replay backstop even if application logic has a bug.
CREATE TABLE IF NOT EXISTS consumed_nonces (
  nonce       TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_intents (
  order_id            TEXT PRIMARY KEY REFERENCES orders(order_id),
  status              TEXT NOT NULL,
  merchant_invoice_ref TEXT,
  amount_zatoshi      INTEGER,
  tx_id               TEXT,
  settlement_mode     TEXT NOT NULL DEFAULT 'simulated' CHECK (settlement_mode IN ('real', 'simulated'))
);

-- One signed hash-commitment receipt per delivered order. UNIQUE(order_id) is the idempotency backstop.
CREATE TABLE IF NOT EXISTS receipts (
  receipt_id        TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL UNIQUE REFERENCES orders(order_id),
  commitment        TEXT NOT NULL,
  signature         TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
