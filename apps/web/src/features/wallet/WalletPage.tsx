import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useMandates } from "../../hooks/useMandates";
import { useAsync } from "../../hooks/useAsync";
import { api, ApiError } from "../../lib/api/client";
import { formatZatoshi } from "../../lib/formatters/money";
import { mandateLabel } from "../mandates/MandateDocument";

/** Backend-asserted "not yet funded" rather than a real failure - never shown as a scary error. */
function isNoEnvelope(err: unknown): boolean {
  return err instanceof ApiError && err.code === "NO_ENVELOPE";
}

export function WalletPage() {
  const mandatesState = useMandates();
  const [params, setParams] = useSearchParams();
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<unknown>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepError, setSweepError] = useState<unknown>(null);
  const [sweepResult, setSweepResult] = useState<{ sweepTxId: string; status: string } | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);

  const mandates = mandatesState.status === "success" ? mandatesState.data : [];
  const mandateId = params.get("mandateId") ?? mandates[0]?.id ?? "";
  const mandate = mandates.find((m) => m.id === mandateId) ?? null;

  const fetchEnvelope = useCallback(() => {
    if (!mandate?.envelopeWalletRef) return Promise.resolve(null);
    return api.wallet.envelope(mandate.id);
  }, [mandate?.id, mandate?.envelopeWalletRef]);
  const envelopeState = useAsync(fetchEnvelope, [mandate?.id, mandate?.envelopeWalletRef]);

  const fund = async () => {
    if (!mandate) return;
    setFunding(true);
    setFundError(null);
    try {
      await api.wallet.fund(mandate.id);
      mandatesState.reload({ silent: true });
      envelopeState.reload();
    } catch (err) {
      setFundError(err);
    } finally {
      setFunding(false);
    }
  };

  const sweep = async () => {
    if (!mandate) return;
    setSweeping(true);
    setSweepError(null);
    try {
      const res = await api.wallet.sweep(mandate.id);
      setSweepResult({ sweepTxId: res.sweepTxId, status: res.status });
      envelopeState.reload();
    } catch (err) {
      setSweepError(err);
    } finally {
      setSweeping(false);
      setConfirmSweep(false);
    }
  };

  const canSweep = mandate && (mandate.status === "revoked" || mandate.status === "expired");

  return (
    <>
      <PageHead title="Shielded wallet" eyebrow="Zcash testnet" />
      <p className="page-intro">
        Each mandate gets its own independent envelope wallet, isolated from every other mandate and from your main wallet. The agent
        never has key access; only the signer (a separate, HMAC-authenticated process) can move funds, and only for an order the
        guardian already authorized.
      </p>

      {mandatesState.status === "loading" && <LoadingState label="Loading mandates…" />}
      {mandatesState.status === "error" && <ErrorState error={mandatesState.error} onRetry={mandatesState.reload} />}

      {mandatesState.status === "success" && mandates.length === 0 && (
        <EmptyState icon="wallet" title="No mandates yet" description="Create a spending mandate first - each one gets its own envelope wallet." />
      )}

      {mandatesState.status === "success" && mandates.length > 0 && mandate && (
        <>
          <div className="filterbar">
            <select aria-label="Select mandate" value={mandate.id} onChange={(e) => setParams({ mandateId: e.target.value })}>
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {mandateLabel(m)} · {m.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          {!mandate.envelopeWalletRef && (
            <section style={{ marginTop: 24 }}>
              <EmptyState
                icon="wallet"
                title="This mandate has no envelope wallet yet"
                description="Creating one asks the signer to generate a fresh, independent Zcash wallet for this mandate only. No key material ever reaches this browser or the backend - only a wallet reference and a receiving address."
                action={
                  <button className="primary" style={{ marginTop: 16 }} onClick={fund} disabled={funding || mandate.status !== "active"}>
                    {funding ? "Creating…" : "Create envelope wallet"} <Icon name="arrow" />
                  </button>
                }
              />
              {mandate.status !== "active" && (
                <p className="page-intro">Only an active mandate can be funded - this one is {mandate.status}.</p>
              )}
              {fundError ? <ErrorState error={fundError} onRetry={fund} /> : null}
            </section>
          )}

          {mandate.envelopeWalletRef && (
            <>
              {envelopeState.status === "loading" && <LoadingState label="Loading wallet status…" />}
              {envelopeState.status === "error" && !isNoEnvelope(envelopeState.error) && (
                <ErrorState error={envelopeState.error} onRetry={envelopeState.reload} />
              )}
              {envelopeState.status === "error" && isNoEnvelope(envelopeState.error) && (
                <EmptyState icon="wallet" title="Envelope not found" description="The backend recorded a wallet reference but the signer has no matching wallet. This is an inconsistent state - try creating the envelope again." />
              )}

              {envelopeState.status === "success" && envelopeState.data && (
                <>
                  <section className="wallet-hero">
                    <div>
                      <p className="eyebrow">Spendable balance</p>
                      <strong>{formatZatoshi(envelopeState.data.spendableZatoshi)}</strong>
                      <span>
                        {formatZatoshi(envelopeState.data.totalZatoshi)} total received
                        {envelopeState.data.totalZatoshi !== envelopeState.data.spendableZatoshi && " (some unconfirmed - spendable lags receipt by ~10 confirmations, ~4 minutes)"}
                      </span>
                    </div>
                    <div className="wallet-address">
                      <span>RECEIVING ADDRESS (REAL ZCASH TESTNET)</span>
                      <b className="mono">{envelopeState.data.receivingAddress}</b>
                      <button
                        aria-label="Copy address"
                        onClick={() => navigator.clipboard?.writeText(envelopeState.data!.receivingAddress)}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                    </div>
                  </section>

                  <section style={{ marginTop: 18 }}>
                    <Status tone={envelopeState.data.funded ? "green" : "amber"}>{envelopeState.data.funded ? "Funded" : "Awaiting funding"}</Status>
                    <p className="page-intro" style={{ marginTop: 10 }}>
                      Funding happens outside this app: send TAZ to the receiving address above from your own main wallet
                      (docs/architecture/zcash-integration.md §4). This balance is read live from the signer, which reads it from the
                      real Zcash testnet.
                    </p>
                  </section>

                  <section className="wallet-grid">
                    <section className="panel">
                      <p className="eyebrow">Isolation model</p>
                      <h2>Who can access these funds?</h2>
                      <dl className="access-list">
                        <div>
                          <dt>You (main wallet)</dt>
                          <dd>Signs funding transactions only</dd>
                        </div>
                        <div>
                          <dt>Isolated signer</dt>
                          <dd>Holds this envelope's key; re-validates every order before signing</dd>
                        </div>
                        <div>
                          <dt>Shopping agent</dt>
                          <dd>
                            <span className="mono">NO KEY ACCESS</span>
                          </dd>
                        </div>
                      </dl>
                    </section>
                    <section className="panel">
                      <p className="eyebrow">Sweep-back</p>
                      <h2>Revoked or expired only</h2>
                      <p className="panel-copy">
                        A mandate's envelope can be swept back to your main wallet once it is revoked or expired, and only once no
                        order is still in flight. {canSweep ? "This mandate is eligible." : `This mandate is ${mandate.status} - sweeping is not available yet.`}
                      </p>
                      <button className="secondary" disabled={!canSweep || sweeping} onClick={() => setConfirmSweep(true)}>
                        <Icon name="download" size={14} /> Sweep remaining balance
                      </button>
                      {sweepError ? <ErrorState error={sweepError} onRetry={() => setSweepError(null)} /> : null}
                      {sweepResult && (
                        <div className="info-box" style={{ marginTop: 16 }}>
                          <Icon name="check" />
                          <p>
                            Sweep broadcast. Transaction <b className="mono">{sweepResult.sweepTxId.slice(0, 16)}…</b>, status{" "}
                            <b>{sweepResult.status}</b>.
                          </p>
                        </div>
                      )}
                    </section>
                  </section>
                </>
              )}
            </>
          )}

          {confirmSweep && (
            <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmSweep(false)}>
              <div className="modal" role="alertdialog" aria-modal="true" aria-label="Confirm sweep" style={{ maxWidth: 480 }}>
                <div className="modal-header">
                  <div>
                    <p className="eyebrow">Irreversible</p>
                    <h2>Sweep this envelope?</h2>
                  </div>
                  <button className="icon-button" onClick={() => setConfirmSweep(false)} aria-label="Close">
                    <Icon name="close" />
                  </button>
                </div>
                <div className="modal-body" style={{ minHeight: "auto", padding: "26px 28px" }}>
                  <div className="info-box" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
                    <Icon name="alert" />
                    <p>
                      This sends the envelope's entire spendable balance (minus the network fee) to your configured main-wallet
                      address, on the real Zcash testnet. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="secondary" onClick={() => setConfirmSweep(false)} disabled={sweeping}>
                    Cancel
                  </button>
                  <button className="danger" onClick={sweep} disabled={sweeping}>
                    {sweeping ? "Sweeping…" : "Sweep balance"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
