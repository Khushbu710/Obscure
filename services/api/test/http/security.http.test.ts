import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/http/server.js";
import { createTestDb } from "../testDb.js";

describe("GET /api/security/scoreboard", () => {
  it("says not_run when no real run exists - it never invents a result", async () => {
    const app = await buildServer(createTestDb(), { scoreboardResultsPath: join(tmpdir(), "does-not-exist-obscura.json") });
    const res = await app.inject({ method: "GET", url: "/api/security/scoreboard" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe("not_run");
  });

  it("serves the stored run verbatim", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "obscura-sb-")), "latest.json");
    const run = { ranAt: "2026-11-04T12:00:00.000Z", total: 1, passed: 0, failed: 1, coreTotal: 0, corePassed: 0, results: [{ id: "S99", passed: false, observed: "real failure" }] };
    writeFileSync(path, JSON.stringify(run));
    const app = await buildServer(createTestDb(), { scoreboardResultsPath: path });
    const body = JSON.parse((await app.inject({ method: "GET", url: "/api/security/scoreboard" })).payload);
    expect(body).toEqual({ status: "ok", run }); // a failing stored run is reported as failing, not massaged
  });
});
