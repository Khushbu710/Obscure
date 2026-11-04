import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScoreboard } from "./runner.js";
import { buildScenarios } from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RESULTS_PATH = join(here, "..", "results", "latest.json");

const run = await runScoreboard(buildScenarios());
const path = process.env.SCOREBOARD_RESULTS_PATH ?? DEFAULT_RESULTS_PATH;
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(run, null, 2));

for (const r of run.results) console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.id}  ${r.title}  ->  ${r.observed}`);
console.log(`\n${run.passed}/${run.total} passed (core ${run.corePassed}/${run.coreTotal}). Results written to ${path}`);
process.exit(run.failed === 0 ? 0 : 1);
