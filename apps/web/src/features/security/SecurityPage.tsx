import { useState } from "react";
import { PageHead } from "../../components/common/PageHead";
import { Icon, type IconName } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import { ATTACK_SCENARIOS, type ScoreboardStatus } from "./attackScenarios";

const statusTone: Record<ScoreboardStatus, "green" | "red" | "amber" | "gray"> = {
  Passed: "green",
  Failed: "red",
  "Not Run": "amber",
  Unavailable: "gray",
};

export function SecurityPage() {
  const health = useBackendHealth();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <PageHead title="Security" eyebrow="Trust architecture" />
      <p className="page-intro">Independent controls separate product discovery, policy decisions, and transaction signing. The sections below distinguish what is architecturally guaranteed from what is live-verified right now.</p>

      <section className="security-banner">
        <div>
          <Icon name="shield" size={28} />
        </div>
        <div>
          <p className="eyebrow">Current posture</p>
          <h2>Backend {health === "connected" ? "is reachable" : health === "unreachable" ? "is unreachable" : "status checking"}.</h2>
          <p>This reflects only a live GET /health check - it is not a claim that the signer has independently passed verification (no signer exists yet).</p>
        </div>
        <Status tone={health === "connected" ? "green" : health === "unreachable" ? "red" : "amber"}>
          {health === "connected" ? "Connected" : health === "unreachable" ? "Unreachable" : "Checking"}
        </Status>
      </section>

      <div className="security-flow">
        {(
          [
            ["01", "search", "Shopping agent", "Discovers products and prepares proposals.", "Cannot access keys or move funds."],
            ["02", "shield", "Policy guardian", "Deterministically checks every mandate rule.", "Cannot be bypassed by agent output."],
            ["03", "lock", "Isolated signer", "Would re-validate authorization before signing.", "Not yet implemented - no live transactions occur."],
            ["04", "wallet", "Zcash network", "Would broadcast and confirm the shielded transaction.", "Not yet connected - see Wallet page."],
          ] satisfies [string, IconName, string, string, string][]
        ).map(([num, icon, title, desc, note], i) => (
          <article key={title}>
            <span>{num}</span>
            <Icon name={icon} size={24} />
            <h3>{title}</h3>
            <p>{desc}</p>
            <small>{note}</small>
            {i < 3 && <i className="connector" />}
          </article>
        ))}
      </div>

      <section className="section-block scoreboard">
        <div className="section-head">
          <div>
            <p className="eyebrow">Adversarial test coverage</p>
            <h2>Attack scoreboard</h2>
          </div>
        </div>
        <p className="page-intro" style={{ marginTop: 4 }}>
          These scenarios are implemented as real backend tests (see docs/architecture/testing-strategy.md) but there is no{" "}
          <code>/api/security/scoreboard</code> endpoint to query live results from this UI yet - every status below is honestly{" "}
          <b>Unavailable</b>, never a hardcoded pass.
        </p>
        <div className="scoreboard-table">
          <div className="scoreboard-row table-head">
            <span>Scenario</span>
            <span>Expected result</span>
            <span>Actual result</span>
            <span>Status</span>
          </div>
          {ATTACK_SCENARIOS.map((s) => (
            <div key={s.name}>
              <button
                className="scoreboard-row"
                style={{ width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                onClick={() => setExpanded(expanded === s.name ? null : s.name)}
              >
                <span>
                  <b>{s.name}</b>
                  <small>{s.description}</small>
                </span>
                <span>{s.expected}</span>
                <span className="mono">{s.actual}</span>
                <span>
                  <Status tone={statusTone[s.actual]}>{s.actual}</Status>
                </span>
              </button>
              {expanded === s.name && (
                <div style={{ padding: "12px 10px 18px", fontSize: 10, color: "var(--muted)", background: "#fafaf7" }}>{s.details}</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
