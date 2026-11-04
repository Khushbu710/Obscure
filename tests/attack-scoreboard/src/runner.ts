import type { Scenario } from "./scenarios.js";

export interface ScenarioResult {
  id: string;
  title: string;
  core: boolean;
  attack: string;
  expectedDefense: string;
  passed: boolean;
  observed: string;
  durationMs: number;
}

export interface ScoreboardRun {
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  coreTotal: number;
  corePassed: number;
  results: ScenarioResult[];
}

/**
 * Runs every scenario against the real system and records what happened. A
 * scenario that throws is recorded as FAILED with the error (never
 * swallowed into a pass). Nothing here can mark a scenario passed except
 * the scenario's own checks.
 */
export async function runScoreboard(scenarios: Scenario[], now: () => Date = () => new Date()): Promise<ScoreboardRun> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const started = Date.now();
    let passed = false;
    let observed: string;
    try {
      const out = await s.run();
      passed = out.passed;
      observed = out.observed;
    } catch (e) {
      observed = `scenario threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    results.push({ id: s.id, title: s.title, core: s.core, attack: s.attack, expectedDefense: s.expectedDefense, passed, observed, durationMs: Date.now() - started });
  }
  const core = results.filter((r) => r.core);
  return {
    ranAt: now().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    coreTotal: core.length,
    corePassed: core.filter((r) => r.passed).length,
    results,
  };
}
