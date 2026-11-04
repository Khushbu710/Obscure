import { openDatabase } from "../src/db/client.js";

/** A fresh in-memory database per test - never shared across tests. */
export function createTestDb() {
  return openDatabase(":memory:");
}
