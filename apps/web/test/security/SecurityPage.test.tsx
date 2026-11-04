import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SecurityPage } from "../../src/features/security/SecurityPage";

vi.mock("../../src/lib/api/client", () => ({
  api: { security: { scoreboard: vi.fn() } },
}));

import { api } from "../../src/lib/api/client";

describe("SecurityPage - scoreboard", () => {
  it("honestly reports not_run instead of fabricating a result", async () => {
    vi.mocked(api.security.scoreboard).mockResolvedValue({ status: "not_run", message: "The attack scoreboard has not been run yet." });
    render(<SecurityPage />);
    await waitFor(() => expect(screen.getByText(/has not been run yet/i)).toBeInTheDocument());

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/\d+\/\d+ passed/);
  });

  it("renders the real stored scoreboard run, including a failed scenario, never hiding it", async () => {
    vi.mocked(api.security.scoreboard).mockResolvedValue({
      status: "ok",
      run: {
        ranAt: "2026-11-04T12:00:00.000Z",
        total: 2,
        passed: 1,
        failed: 1,
        coreTotal: 2,
        corePassed: 1,
        results: [
          { id: "S01", title: "Prompt injection in product text", core: true, attack: "injected text", expectedDefense: "fixed tool allow-list", passed: true, observed: "rejected", durationMs: 12 },
          { id: "S04", title: "Nonce reuse / replay", core: true, attack: "replay nonce", expectedDefense: "reject replay", passed: false, observed: "accepted twice", durationMs: 8 },
        ],
      },
    });
    render(<SecurityPage />);

    await waitFor(() => expect(screen.getByText((_, el) => el?.tagName === "B" && el.textContent === "1/2")).toBeInTheDocument());
    expect(screen.getByText(/S01 Prompt injection in product text/)).toBeInTheDocument();
    expect(screen.getByText(/S04 Nonce reuse/)).toBeInTheDocument();
    expect(screen.getAllByText("Passed")).toHaveLength(1);
    expect(screen.getAllByText("Failed")).toHaveLength(1);
  });
});
