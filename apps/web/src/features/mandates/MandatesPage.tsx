import { useState } from "react";
import type { Mandate, MandateStatus } from "@obscura/contracts";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useMandates } from "../../hooks/useMandates";
import { api } from "../../lib/api/client";
import { formatMinor } from "../../lib/formatters/money";
import { MandateDocument } from "./MandateDocument";
import { CreateMandateModal } from "./CreateMandateModal";
import { ConfirmRevokeModal } from "./ConfirmRevokeModal";

const TABS: { label: string; status: MandateStatus | "All" }[] = [
  { label: "All", status: "All" },
  { label: "Active", status: "active" },
  { label: "Paused", status: "paused" },
  { label: "Expired", status: "expired" },
  { label: "Revoked", status: "revoked" },
];

export function MandatesPage() {
  const { reload, ...state } = useMandates();
  const [tab, setTab] = useState<MandateStatus | "All">("All");
  const [showCreate, setShowCreate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const runAction = async (id: string, action: (id: string) => Promise<Mandate>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await action(id);
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    await runAction(revokeTarget, api.mandates.revoke);
    setRevokeTarget(null);
  };

  return (
    <>
      <PageHead
        title="Spending mandates"
        eyebrow="Policy control"
        action={
          <button className="primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" /> Create mandate
          </button>
        }
      />
      <p className="page-intro">Define exactly what your agents are allowed to spend. Every limit here is enforced by the deterministic guardian, not by this interface.</p>

      {state.status === "success" && state.data.length > 0 && (
        <div className="mandate-summary">
          <div>
            <span>Controlled budget</span>
            <strong className="mono">{formatMinor(state.data.reduce((s, m) => s + m.totalCapMinor, 0), state.data[0]?.currency ?? "USD")}</strong>
          </div>
          <div>
            <span>Available</span>
            <strong className="mono">{formatMinor(state.data.reduce((s, m) => s + (m.totalCapMinor - m.spentMinor), 0), state.data[0]?.currency ?? "USD")}</strong>
          </div>
          <div>
            <span>Active mandates</span>
            <strong className="mono">{String(state.data.filter((m) => m.status === "active").length).padStart(2, "0")}</strong>
          </div>
          <div>
            <span>Total mandates</span>
            <strong className="mono">{String(state.data.length).padStart(2, "0")}</strong>
          </div>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.label} className={tab === t.status ? "active" : ""} onClick={() => setTab(t.status)}>
            {t.label}
          </button>
        ))}
      </div>

      {actionError && <ErrorState error={actionError} onRetry={() => setActionError(null)} />}

      <section className="mandate-list">
        {state.status === "loading" && <LoadingState label="Loading mandates…" />}
        {state.status === "error" && <ErrorState error={state.error} onRetry={reload} />}
        {state.status === "success" && (
          <>
            {state.data
              .filter((m) => tab === "All" || m.status === tab)
              .map((m, i) => (
                <MandateDocument
                  key={m.id}
                  mandate={m}
                  index={i}
                  busy={busyId === m.id}
                  onPause={(id) => runAction(id, api.mandates.pause)}
                  onResume={(id) => runAction(id, api.mandates.resume)}
                  onRevoke={(id) => setRevokeTarget(id)}
                />
              ))}
            {state.data.filter((m) => tab === "All" || m.status === tab).length === 0 &&
              (state.data.length === 0 ? (
                <EmptyState
                  icon="file"
                  title="No mandates yet"
                  description="Create your first spending mandate to give the agent a bounded budget."
                  action={
                    <button className="primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>
                      <Icon name="plus" /> Create mandate
                    </button>
                  }
                />
              ) : (
                <EmptyState icon="file" title={`No ${tab.toLowerCase()} mandates`} description="Mandates in this state will appear here with their full policy history." />
              ))}
          </>
        )}
      </section>

      {showCreate && <CreateMandateModal onClose={() => setShowCreate(false)} onCreated={() => reload()} />}
      {revokeTarget && <ConfirmRevokeModal busy={busyId === revokeTarget} onConfirm={confirmRevoke} onCancel={() => setRevokeTarget(null)} />}
    </>
  );
}
