import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { sendError } from "../errors.js";

const here = dirname(fileURLToPath(import.meta.url));
/** services/api/src/http/routes -> repo root -> tests/attack-scoreboard/results/latest.json */
export const DEFAULT_SCOREBOARD_PATH = join(here, "..", "..", "..", "..", "..", "tests", "attack-scoreboard", "results", "latest.json");

/**
 * GET /api/security/scoreboard (api-contracts.md). Serves the stored result of
 * the last REAL run of tests/attack-scoreboard (`npm run scoreboard`). It never
 * fabricates or defaults a result: if no run exists it says so.
 */
export function registerSecurityRoutes(app: FastifyInstance, resultsPath: string = process.env.SCOREBOARD_RESULTS_PATH ?? DEFAULT_SCOREBOARD_PATH): void {
  app.get("/api/security/scoreboard", async (_req, reply) => {
    try {
      if (!existsSync(resultsPath)) {
        reply.send({ status: "not_run", message: "The attack scoreboard has not been run yet. Run `npm run scoreboard -w @obscura/attack-scoreboard`." });
        return;
      }
      reply.send({ status: "ok", run: JSON.parse(readFileSync(resultsPath, "utf8")) });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
