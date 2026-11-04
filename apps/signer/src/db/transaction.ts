import type { DatabaseSync } from "node:sqlite";

/**
 * Identical pattern to services/api/src/db/transaction.ts: BEGIN IMMEDIATE
 * takes the write lock immediately, so concurrent sign() calls against the
 * same order genuinely serialize here rather than racing. `fn` MUST remain
 * fully synchronous (no `await`, no Promise) - see signerService.ts for why.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
