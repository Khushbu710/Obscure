import { useState } from "react";
import type { ShoppingRequestResponse } from "@obscura/contracts";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useMandates } from "../../hooks/useMandates";
import { api, ApiError } from "../../lib/api/client";
import { formatMinor } from "../../lib/formatters/money";
import { ShoppingResult } from "./ShoppingResult";

export function ShoppingPage() {
  const mandatesState = useMandates();
  const [mandateId, setMandateId] = useState<string>("");
  const [prompt, setPrompt] = useState("Find me a 5 GB eSIM for Japan under $15.");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ShoppingRequestResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  const activeMandates = mandatesState.status === "success" ? mandatesState.data.filter((m) => m.status === "active") : [];
  const selected = activeMandates.find((m) => m.id === mandateId) ?? activeMandates[0];

  const run = async () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.shopping.submit({ mandateId: selected.id, prompt });
      setResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
      // An authorized (or even rejected) proposal can change the mandate's
      // spentMinor server-side - refetch so the displayed "Available"
      // budget never shows a stale, pre-request value. `silent: true` so
      // this doesn't flash the loading skeleton over the result just shown.
      mandatesState.reload({ silent: true });
    }
  };

  return (
    <>
      <PageHead title="Shopping" eyebrow="Agent commerce" />
      <p className="page-intro">Find products. Set the limits. Let OBSCURA's deterministic guardian enforce them server-side.</p>

      {mandatesState.status === "loading" && <LoadingState label="Loading mandates…" />}
      {mandatesState.status === "error" && <ErrorState error={mandatesState.error} onRetry={mandatesState.reload} />}

      {mandatesState.status === "success" && activeMandates.length === 0 && (
        <EmptyState icon="bag" title="No active mandate" description="You need at least one active spending mandate before the agent can shop on your behalf." />
      )}

      {mandatesState.status === "success" && activeMandates.length > 0 && (
        <>
          <section className="request-box">
            <div className="request-input">
              <Icon name="search" size={22} />
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Shopping request" />
            </div>
            <div className="request-controls">
              <label>
                <span>Spend under mandate</span>
                <select value={selected?.id} onChange={(e) => setMandateId(e.target.value)} aria-label="Select mandate">
                  {activeMandates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.allowedCategories.join(", ")} · {m.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <div className="budget-note">
                  <span>Available</span>
                  <b>{formatMinor(selected.totalCapMinor - selected.spentMinor, selected.currency)}</b>
                </div>
              )}
              <button className="primary" onClick={run} disabled={running || !prompt.trim()}>
                {running ? "Agent working…" : "Find products"}
                <Icon name="arrow" />
              </button>
            </div>
          </section>

          {running && (
            <section className="execution">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Agent request in progress</p>
                  <h2>Processing shopping request…</h2>
                </div>
              </div>
              <p className="page-intro" style={{ marginTop: 8 }}>
                The agent is searching Bitrefill, verifying a live price, and the guardian is evaluating the proposal. This step is
                not broken into visible sub-stages because the backend does not emit intermediate progress events yet.
              </p>
            </section>
          )}

          {error && (
            <div style={{ marginTop: 28 }}>
              <ErrorState error={error} onRetry={run} />
              {error instanceof ApiError && error.status === 503 && (
                <p className="page-intro">The shopping agent requires Gemini and Bitrefill API credentials to be configured on the backend - see services/api/.env.example.</p>
              )}
            </div>
          )}

          {result && !running && (
            <div className="shopping-grid" style={{ gridTemplateColumns: "1fr" }}>
              <ShoppingResult result={result} />
            </div>
          )}
        </>
      )}
    </>
  );
}
