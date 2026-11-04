import { useState } from "react";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useAsync } from "../../hooks/useAsync";
import { api } from "../../lib/api/client";
import type { SelectiveDisclosure } from "@obscura/contracts";
import { formatMinor } from "../../lib/formatters/money";
import { formatDateTime } from "../../lib/formatters/date";

function ReceiptDetail({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const detailState = useAsync(() => api.receipts.get(receiptId), [receiptId]);
  const [disclosure, setDisclosure] = useState<SelectiveDisclosure | null>(null);
  const [discloseError, setDiscloseError] = useState<unknown>(null);
  const [disclosing, setDisclosing] = useState(false);

  const disclose = async () => {
    setDisclosing(true);
    setDiscloseError(null);
    try {
      setDisclosure(await api.receipts.disclose(receiptId));
    } catch (err) {
      setDiscloseError(err);
    } finally {
      setDisclosing(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Receipt detail" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Receipt</p>
            <h2>{receiptId.slice(0, 8).toUpperCase()}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body" style={{ minHeight: "auto", padding: "26px 28px" }}>
          {detailState.status === "loading" && <LoadingState label="Loading receipt…" />}
          {detailState.status === "error" && <ErrorState error={detailState.error} onRetry={detailState.reload} />}
          {detailState.status === "success" && (
            <>
              <div className="info-box" style={{ background: detailState.data.signatureValid ? "var(--green-soft)" : "var(--red-soft)", color: detailState.data.signatureValid ? "var(--green)" : "var(--red)" }}>
                <Icon name={detailState.data.signatureValid ? "check" : "alert"} />
                <p>
                  <b>{detailState.data.signatureValid ? "Signature valid" : "Signature INVALID"}</b> — Ed25519 signature over a SHA-256
                  hash commitment. This is a digital signature plus a hash commitment, explicitly <b>not</b> a zero-knowledge proof.
                </p>
              </div>
              <dl className="review" style={{ marginTop: 16 }}>
                <div>
                  <dt>Order</dt>
                  <dd className="mono">{detailState.data.payload.orderId.slice(0, 8)}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd className="mono">{formatMinor(detailState.data.payload.priceMinor, detailState.data.payload.currency)}</dd>
                </div>
                <div>
                  <dt>Merchant</dt>
                  <dd>{detailState.data.payload.merchantId}</dd>
                </div>
                <div>
                  <dt>Settlement</dt>
                  <dd>
                    <Status tone={detailState.data.payload.settlementMode === "real" ? "green" : "amber"}>{detailState.data.payload.settlementMode}</Status>
                  </dd>
                </div>
                <div>
                  <dt>Timestamp</dt>
                  <dd>{formatDateTime(detailState.data.payload.timestamp)}</dd>
                </div>
                <div>
                  <dt>Hash commitment</dt>
                  <dd className="mono" style={{ wordBreak: "break-all" }}>
                    {detailState.data.receipt.commitment}
                  </dd>
                </div>
                <div>
                  <dt>Encrypted payload</dt>
                  <dd>
                    <span className="mono">AES-256-GCM</span> — available server-side only; never sent to this page except decrypted,
                    owner-only
                  </dd>
                </div>
              </dl>

              <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 18 }}>
                <p className="eyebrow">Selective disclosure</p>
                <p className="panel-copy">
                  Generates a standalone artifact (commitment + signature + the underlying fields) that anyone can verify against the
                  published public key, without needing OBSCURA's backend.
                </p>
                <button className="secondary" onClick={disclose} disabled={disclosing}>
                  {disclosing ? "Generating…" : "Create disclosure"}
                </button>
                {discloseError ? <ErrorState error={discloseError} onRetry={disclose} /> : null}
                {disclosure && (
                  <pre className="mono" style={{ marginTop: 14, padding: 14, background: "#fff", border: "1px solid var(--line)", fontSize: 9, overflow: "auto", maxHeight: 220 }}>
                    {JSON.stringify(disclosure, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReceiptsPage() {
  const listState = useAsync(() => api.receipts.list(), []);
  const keyState = useAsync(() => api.receipts.publicKey(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHead title="Private receipts" eyebrow="Selective disclosure" />
      <p className="page-intro">
        Purchase records stay private, with only specific fields revealed on demand. This uses a digital signature and hash
        commitment - it is explicitly not a zero-knowledge proof.
      </p>
      <div className="receipt-layout">
        <section>
          {listState.status === "loading" && <LoadingState label="Loading receipts…" />}
          {listState.status === "error" && <ErrorState error={listState.error} onRetry={listState.reload} />}
          {listState.status === "success" && listState.data.length === 0 && (
            <EmptyState icon="receipt" title="No receipts yet" description="A receipt is created automatically once an order reaches delivered." />
          )}
          {listState.status === "success" &&
            listState.data.map((r) => (
              <button key={r.receiptId} className="receipt-row" style={{ width: "100%", textAlign: "left", border: 0, cursor: "pointer" }} onClick={() => setOpenId(r.receiptId)}>
                <span className="receipt-logo">
                  <Icon name="receipt" size={18} />
                </span>
                <div>
                  <b>{r.orderId.slice(0, 8)}</b>
                  <small className="mono">{r.commitment.slice(0, 16)}…</small>
                </div>
                <strong className="mono" style={{ fontSize: 8 }}>
                  {r.receiptId.slice(0, 6)}
                </strong>
                <time>{formatDateTime(r.createdAt)}</time>
                <span>
                  <Status tone="green">Signed</Status>
                </span>
                <Icon name="chevron" />
              </button>
            ))}
        </section>
        <aside className="disclosure">
          <span>
            <Icon name="receipt" size={26} />
          </span>
          <p className="eyebrow">Selective disclosure</p>
          <h2>Prove the purchase, not your identity.</h2>
          <p>
            A disclosure reveals only the fields for one purchase (merchant, amount, date, settlement mode) via its signature and
            hash commitment - never a zero-knowledge proof, and never your full purchase history.
          </p>
          {keyState.status === "success" && (
            <p style={{ fontSize: 8, wordBreak: "break-all" }}>
              Verifier public key ({keyState.data.algorithm}): <span className="mono">{keyState.data.publicKey.slice(0, 24)}…</span>
              {!keyState.data.persistentKeys && (
                <>
                  {" "}
                  <br />
                  <Icon name="alert" size={10} /> Ephemeral keys - receipts will not verify after a server restart.
                </>
              )}
            </p>
          )}
        </aside>
      </div>
      {openId && <ReceiptDetail receiptId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
