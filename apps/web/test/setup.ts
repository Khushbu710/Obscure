import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// `globals: false` in vitest.config.ts means Testing Library's automatic
// afterEach-cleanup detection (which looks for a global `afterEach`) never
// fires on its own - without this, every `it` block in a file renders on
// top of the previous one's leftover DOM, causing spurious
// "multiple elements found" failures that have nothing to do with the
// component under test.
afterEach(() => {
  cleanup();
});
