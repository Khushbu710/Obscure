import { useNavigate } from "react-router-dom";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useMandates } from "../../hooks/useMandates";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import { formatMinor } from "../../lib/formatters/money";
import { mandateLabel } from "../mandates/MandateDocument";

export function OverviewPage() {
  const navigate = useNavigate();
  const mandatesState = useMandates();
  const health = useBackendHealth();

  return (
    <>
      <PageHead
        title="Overview"
        eyebrow={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}
        action={
          <button className="primary" onClick={() => navigate("/mandates")}>
            <Icon name="plus" /> Create mandate
          </button>
        }
      />
      <p className="page-intro">A real-time view of your spending mandates. All figures below are read directly from the backend - nothing here is simulated.</p>

      {mandatesState.status === "loading" && <LoadingState label="Loading overview…" />}
      {mandatesState.status === "error" && <ErrorState error={mandatesState.error} onRetry={mandatesState.reload} />}

      {mandatesState.status === "success" && mandatesState.data.length === 0 && (
        <EmptyState
          icon="file"
          title="No mandates yet"
          description="Create your first spending mandate to let an AI agent shop on your behalf, bounded by rules you define."
          action={
            <button className="primary" style={{ marginTop: 16 }} onClick={() => navigate("/mandates")}>
              <Icon name="plus" /> Create your first mandate
            </button>
          }
        />
      )}

      {mandatesState.status === "success" && mandatesState.data.length > 0 && (() => {
        const mandates = mandatesState.data;
        const currency = mandates[0]?.currency ?? "USD";
        const totalBudget = mandates.reduce((s, m) => s + m.totalCapMinor, 0);
        const totalSpent = mandates.reduce((s, m) => s + m.spentMinor, 0);
        const activeCount = mandates.filter((m) => m.status === "active").length;
        const pausedCount = mandates.filter((m) => m.status === "paused").length;

        return (
          <>
            <section className="financial-strip">
              <div className="lead-metric">
                <span>Available capacity</span>
                <strong>{formatMinor(totalBudget - totalSpent, currency)}</strong>
                <small>of {formatMinor(totalBudget, currency)} allocated</small>
              </div>
              <div>
                <span>Spent / reserved</span>
                <strong>{formatMinor(totalSpent, currency)}</strong>
                <small>{totalBudget > 0 ? `${((totalSpent / totalBudget) * 100).toFixed(1)}% utilization` : "—"}</small>
              </div>
              <div>
                <span>Active mandates</span>
                <strong>{String(activeCount).padStart(2, "0")}</strong>
                <small>{pausedCount > 0 ? `${pausedCount} paused` : "none paused"}</small>
              </div>
              <div>
                <span>Total mandates</span>
                <strong>{String(mandates.length).padStart(2, "0")}</strong>
                <small>all statuses</small>
              </div>
            </section>

            <div className="overview-grid">
              <section className="panel spend-panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Budget position</p>
                    <h2>Spending by mandate</h2>
                  </div>
                </div>
                <div className="data-table" style={{ marginTop: 18 }}>
                  <div className="table-row table-head">
                    <span>Mandate</span>
                    <span>Budget</span>
                    <span>Spent</span>
                    <span>Remaining</span>
                    <span>Status</span>
                    <span></span>
                  </div>
                  {mandates.slice(0, 5).map((m) => (
                    <div className="table-row" key={m.id}>
                      <span>
                        <b>{mandateLabel(m)}</b>
                        <small>{m.id.slice(0, 8)}</small>
                      </span>
                      <span className="mono">{formatMinor(m.totalCapMinor, m.currency)}</span>
                      <span className="mono">{formatMinor(m.spentMinor, m.currency)}</span>
                      <span className="mono">{formatMinor(m.totalCapMinor - m.spentMinor, m.currency)}</span>
                      <span>
                        <Status tone={m.status === "active" ? "green" : m.status === "paused" ? "amber" : m.status === "revoked" ? "red" : "gray"}>{m.status}</Status>
                      </span>
                      <button className="icon-button" aria-label={`View ${mandateLabel(m)}`} onClick={() => navigate("/mandates")}>
                        <Icon name="chevron" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel control-panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">System posture</p>
                    <h2>Control status</h2>
                  </div>
                  <Status tone={health === "connected" ? "green" : health === "unreachable" ? "red" : "amber"}>
                    {health === "connected" ? "Connected" : health === "unreachable" ? "Unreachable" : "Checking"}
                  </Status>
                </div>
                <div className="control-seal">
                  <Icon name="shield" size={25} />
                  <div>
                    <strong>{health === "connected" ? "Backend reachable" : "Backend status unknown"}</strong>
                    <span>Live-checked via GET /health</span>
                  </div>
                </div>
                <dl className="control-list">
                  <div>
                    <dt>Agent key access</dt>
                    <dd className="mono">NONE</dd>
                  </div>
                  <div>
                    <dt>Authorization</dt>
                    <dd>Deterministic guardian, server-side</dd>
                  </div>
                  <div>
                    <dt>Zcash signer / adapter</dt>
                    <dd className="mono">NOT YET CONNECTED</dd>
                  </div>
                </dl>
                <button className="text-button" onClick={() => navigate("/security")}>
                  Review security architecture <Icon name="arrow" />
                </button>
              </section>
            </div>

            <div className="lower-grid">
              <section className="quick-section" style={{ marginTop: 0 }}>
                <p className="eyebrow">Verified ledger</p>
                <h2>Recent activity</h2>
                <EmptyState icon="pulse" title="Activity log not connected" description="No dedicated activity endpoint exists in the backend yet - see the Activity page for detail." />
              </section>
              <section className="quick-section">
                <p className="eyebrow">Continue</p>
                <h2>Quick actions</h2>
                <button onClick={() => navigate("/shopping")}>
                  <span>
                    <Icon name="search" />
                  </span>
                  <div>
                    <b>Start shopping</b>
                    <small>Give the agent a bounded request</small>
                  </div>
                  <Icon name="chevron" />
                </button>
                <button onClick={() => navigate("/mandates")}>
                  <span>
                    <Icon name="file" />
                  </span>
                  <div>
                    <b>Create mandate</b>
                    <small>Define a new spending policy</small>
                  </div>
                  <Icon name="chevron" />
                </button>
              </section>
            </div>
          </>
        );
      })()}
    </>
  );
}
