import { useState } from "react";
import { PageHead } from "../../components/common/PageHead";
import { Icon, type IconName } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import { useAsync } from "../../hooks/useAsync";
import { api } from "../../lib/api/client";

export function SecurityPage() {
  const health = useBackendHealth();
  const scoreboardState = useAsync(() => api.security.scoreboard(), []);
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
          <p>This reflects a live GET /health check. The attack scoreboard below is a separate, real scoreboard served from the last actual test run.</p>
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
            ["03", "lock", "Isolated signer", "Independently re-validates authorization before signing.", "A separate process; HMAC-authenticated HTTP from the backend."],
            ["04", "wallet", "Zcash network", "Broadcasts and confirms the shielded transaction.", "Real testnet transactions via zcash-devtool - see the Wallet page."],
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
          {scoreboardState.status === "success" && (
            <button className="icon-button" aria-label="Refresh scoreboard" onClick={() => scoreboardState.reload()}>
              <Icon name="pulse" />
            </button>
          )}
        </div>

        {scoreboardState.status === "loading" && <LoadingState label="Loading scoreboard…" />}
        {scoreboardState.status === "error" && <ErrorState error={scoreboardState.error} onRetry={scoreboardState.reload} />}

        {scoreboardState.status === "success" && scoreboardState.data.status === "not_run" && (
          <div className="info-box" style={{ background: "var(--amber-soft)", color: "var(--amber)", marginTop: 14 }}>
            <Icon name="alert" />
            <p>{scoreboardState.data.message}</p>
          </div>
        )}

        {scoreboardState.status === "success" && scoreboardState.data.status === "ok" && (() => {
          const run = scoreboardState.data.run;
          return (
            <>
              <p className="page-intro" style={{ marginTop: 4 }}>
                Last run {new Date(run.ranAt).toLocaleString()}: <b>{run.passed}/{run.total}</b> passed ({run.corePassed}/{run.coreTotal}{" "}
                core scenarios). This is the real, stored result of the last <code>npm run scoreboard</code> execution against the
                actual implementation - never a hardcoded pass.
              </p>
              <div className="scoreboard-table">
                <div className="scoreboard-row table-head">
                  <span>Scenario</span>
                  <span>Attack</span>
                  <span>Observed</span>
                  <span>Status</span>
                </div>
                {run.results.map((r) => (
                  <div key={r.id}>
                    <button
                      className="scoreboard-row"
                      style={{ width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <span>
                        <b>
                          {r.id} {r.title}
                        </b>
                        <small>{r.expectedDefense}</small>
                      </span>
                      <span>{r.attack}</span>
                      <span className="mono">{r.observed}</span>
                      <span>
                        <Status tone={r.passed ? "green" : "red"}>{r.passed ? "Passed" : "Failed"}</Status>
                      </span>
                    </button>
                    {expanded === r.id && (
                      <div style={{ padding: "12px 10px 18px", fontSize: 10, color: "var(--muted)", background: "#fafaf7" }}>
                        {r.core ? "Core scenario. " : ""}Duration {r.durationMs}ms.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </section>
    </>
  );
}
