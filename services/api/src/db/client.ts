import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Loaded via process.getBuiltinModule rather than a static `import ... from
// "node:sqlite"` because Vite/Vitest's module graph doesn't yet recognize
// this experimental built-in and fails to resolve it statically. This way
// bypasses Vite's resolver entirely and asks Node directly for it.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/**
 * Single DatabaseSync connection for the whole process. node:sqlite is
 * synchronous by design, which is exactly what we want: it gives us a
 * single-writer connection with no extra locking library, matching the
 * concurrency design in docs/architecture/security-architecture.md §4.
 * Do not open a second connection to the same file elsewhere in the backend.
 */
export function openDatabase(path: string): DatabaseSyncType {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  // The signer is a separate process writing to this same file (documented MVP limitation):
  // wait for its brief write lock instead of failing immediately with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000;");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export type { DatabaseSyncType as DatabaseSync };
