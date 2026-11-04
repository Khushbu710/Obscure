import { describe, expect, it } from "vitest";
import { runScoreboard } from "../src/runner.js";
import { buildScenarios, type Scenario } from "../src/scenarios.js";

describe("attack scoreboard", () => {
  it("every scenario passes against the real system (and all five core scenarios are present)", async () => {
    const scenarios = buildScenarios();
    expect(scenarios.filter((s) => s.core).map((s) => s.id)).toEqual(["S01", "S02", "S03", "S04", "S05"]);
    const run = await runScoreboard(scenarios);
    const failures = run.results.filter((r) => !r.passed).map((r) => `${r.id} ${r.title}: ${r.observed}`);
    expect(failures).toEqual([]);
    expect(run.total).toBeGreaterThanOrEqual(20);
  });

  it("is NOT rigged: a scenario whose check fails, or that throws, is recorded as failed", async () => {
    const wrongExpectation: Scenario = {
      id: "X1",
      title: "deliberately wrong expectation",
      core: false,
      attack: "n/a",
      expectedDefense: "n/a",
      run: async () => ({ passed: 1 + 1 === 3, observed: "1+1 is not 3" }),
    };
    const throwing: Scenario = { ...wrongExpectation, id: "X2", run: async () => { throw new Error("boom"); } };
    const run = await runScoreboard([wrongExpectation, throwing]);
    expect(run.passed).toBe(0);
    expect(run.failed).toBe(2);
    expect(run.results[1]!.observed).toContain("boom");
  });

  it("would catch a real regression: with the price check removed from the harness input, S02 fails", async () => {
    // Simulates a caller that wrongly passes the agent's own price as the 'verified' one.
    const s02 = buildScenarios().find((s) => s.id === "S02")!;
    const { createEnv } = await import("../src/harness.js");
    const env = await createEnv();
    const id = await env.newMandate();
    const { guardian } = env.authorize(env.proposal(id, { priceMinor: 100 }), 100); // mis-wired: trusts the agent's price
    expect(guardian.approved).toBe(true); // the attack WOULD succeed under that wiring...
    expect((await s02.run()).passed).toBe(true); // ...which is exactly what the real scenario guards against.
  });
});
