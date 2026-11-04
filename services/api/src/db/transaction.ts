import type { DatabaseSync } from "node:sqlite";

/**
 * BEGIN IMMEDIATE takes the write lock immediately rather than on first
 * write, so two concurrent callers against the same DatabaseSync-backed
 * file genuinely serialize here rather than racing to the lock later -
 * this is what makes the budget reservation in orderAuthorizationService.ts
 * atomic under concurrency (see security-architecture.md §4 and the
 * concurrency test in orderAuthorizationService.test.ts).
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
