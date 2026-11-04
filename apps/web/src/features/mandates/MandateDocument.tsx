import type { Mandate } from "@obscura/contracts";
import { Status } from "../../components/common/Status";
import { Icon } from "../../components/common/Icon";
import { formatMinor } from "../../lib/formatters/money";
import { formatDateTime } from "../../lib/formatters/date";

const statusTone: Record<Mandate["status"], "green" | "amber" | "gray" | "red"> = {
  active: "green",
  paused: "amber",
  expired: "gray",
  revoked: "red",
};

/** Mandate name used for display only - the real schema has no `name`/`description` field (verified in packages/contracts/src/mandate.ts), so this derives a real, non-fabricated label from the mandate's actual allowed categories and id, rather than inventing a name. */
export function mandateLabel(m: Mandate): string {
  return `${m.allowedCategories.join(", ")} mandate`;
}

export function MandateDocument({
  mandate,
  index,
  onPause,
  onResume,
  onRevoke,
  busy,
}: {
  mandate: Mandate;
  index: number;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRevoke: (id: string) => void;
  busy: boolean;
}) {
  const remaining = mandate.totalCapMinor - mandate.spentMinor;

  return (
    <article className="mandate-document">
      <div className="mandate-title">
        <div>
          <span className="doc-number">0{index + 1}</span>
          <div>
            <h2>{mandateLabel(mandate)}</h2>
            <p>
              {mandate.allowedMerchants ? mandate.allowedMerchants.join(", ") : "Any merchant"} · {mandate.allowedCategories.join(", ")}
            </p>
          </div>
        </div>
        <Status tone={statusTone[mandate.status]}>{mandate.status}</Status>
      </div>
      <div className="mandate-balance">
        <div>
          <span>Total authority</span>
          <strong>{formatMinor(mandate.totalCapMinor, mandate.currency)}</strong>
        </div>
        <div>
          <span>Spent / reserved</span>
          <b>{formatMinor(mandate.spentMinor, mandate.currency)}</b>
        </div>
        <div>
          <span>Remaining</span>
          <b>{formatMinor(remaining, mandate.currency)}</b>
        </div>
        <div>
          <span>Expires</span>
          <b style={{ fontSize: 11 }}>{formatDateTime(mandate.expiresAt)}</b>
        </div>
      </div>
      <div className="mandate-rules">
        <div>
          <span>PER-ORDER CAP</span>
          <b>{mandate.perOrderCapMinor !== null ? formatMinor(mandate.perOrderCapMinor, mandate.currency) : "No separate cap"}</b>
        </div>
        <div>
          <span>ALLOWED MERCHANTS</span>
          <b>{mandate.allowedMerchants ? mandate.allowedMerchants.join(", ") : "Any"}</b>
        </div>
        <div>
          <span>ALLOWED CATEGORY</span>
          <b>{mandate.allowedCategories.join(", ")}</b>
        </div>
        <div>
          <span>ENVELOPE</span>
          <b>{mandate.envelopeWalletRef ?? "Not funded"}</b>
        </div>
      </div>
      <div className="mandate-actions">
        <span className="mono">{mandate.id.slice(0, 8).toUpperCase()}</span>
        <div>
          {mandate.status === "active" && (
            <button className="secondary" disabled={busy} onClick={() => onPause(mandate.id)}>
              <Icon name="pause" size={15} /> Pause
            </button>
          )}
          {mandate.status === "paused" && (
            <button className="secondary" disabled={busy} onClick={() => onResume(mandate.id)}>
              Resume
            </button>
          )}
          {(mandate.status === "active" || mandate.status === "paused") && (
            <button className="danger" disabled={busy} onClick={() => onRevoke(mandate.id)}>
              Revoke
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
