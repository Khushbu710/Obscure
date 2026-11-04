import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same process.getBuiltinModule approach as services/api/src/db/client.ts -
// Vite/Vitest can't statically resolve "node:sqlite" yet.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/**
 * Opens the signer's view of the mandate/order database. In production this
 * points at the same file services/api writes to - see schema.sql's header
 * comment for why that is an explicit, documented limitation rather than an
 * oversight. The signer never creates its own writer connection semantics
 * beyond what it needs (status transitions on `orders`, spend release on
 * `mandates`); it does not touch `consumed_nonces` or `payment_intents`,
 * which are the guardian/backend's concerns.
 */
export function openSignerDatabase(path: string): DatabaseSyncType {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export type { DatabaseSyncType as DatabaseSync };
