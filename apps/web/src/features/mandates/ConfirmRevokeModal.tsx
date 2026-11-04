import { Icon } from "../../components/common/Icon";

export function ConfirmRevokeModal({ onConfirm, onCancel, busy }: { onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label="Confirm revoke" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Irreversible</p>
            <h2>Revoke this mandate?</h2>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body" style={{ minHeight: "auto", padding: "26px 28px" }}>
          <div className="info-box" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
            <Icon name="alert" />
            <p>
              Revoking immediately and permanently blocks the guardian from authorizing any future order under this mandate. This
              does not reverse any transaction that has already been broadcast to the Zcash network - a revoked mandate only
              prevents new authorizations.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Revoking…" : "Revoke mandate"}
          </button>
        </div>
      </div>
    </div>
  );
}
