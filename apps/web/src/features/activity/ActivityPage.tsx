import { useEffect, useState } from "react";
import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { Status } from "../../components/common/Status";
import { LoadingState } from "../../components/feedback/LoadingState";
import { ErrorState } from "../../components/feedback/ErrorState";
import { EmptyState } from "../../components/feedback/EmptyState";
import { useMandates } from "../../hooks/useMandates";
import { useAsync } from "../../hooks/useAsync";
import { api } from "../../lib/api/client";
import type { OrderWithPayment } from "../../lib/api/schemas";
import { UNAVAILABLE_FEATURES } from "../../lib/api/unavailable";
import { formatMinor, formatZatoshi } from "../../lib/formatters/money";
import { formatDateTime } from "../../lib/formatters/date";

const POLL_MS = 7_000;
const NON_TERMINAL = new Set(["proposed", "validated", "reserved", "authorized", "signed", "broadcast", "mined", "settlement_pending", "payment_uncertain"]);

const statusTone: Record<string, "green" | "amber" | "red" | "gray"> = {
  delivered: "green",
  confirmed: "green",
  reserved: "amber",
  authorized: "amber",
  signed: "amber",
  broadcast: "amber",
  mined: "amber",
  settlement_pending: "amber",
  payment_uncertain: "amber",
  failed: "red",
  rejected: "red",
  cancelled: "red",
  expired: "red",
  refund_pending: "gray",
  refunded: "gray",
  proposed: "gray",
  validated: "gray",
};

function OrderDetail({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const detailState = useAsync(() => api.orders.get(orderId), [orderId]);

  useEffect(() => {
    if (detailState.status !== "success") return;
    if (!NON_TERMINAL.has(detailState.data.order.status)) return;
    const id = setInterval(() => detailState.reload({ silent: true }), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailState.status, detailState.status === "success" ? detailState.data.order.status : null]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Order detail" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Order</p>
            <h2>{orderId.slice(0, 8).toUpperCase()}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body" style={{ minHeight: "auto", padding: "26px 28px" }}>
          {detailState.status === "loading" && <LoadingState label="Loading order…" />}
          {detailState.status === "error" && <ErrorState error={detailState.error} onRetry={detailState.reload} />}
          {detailState.status === "success" && (
            <OrderDetailBody order={detailState.data.order} payment={detailState.data.payment} />
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetailBody({ order, payment }: OrderWithPayment) {
  const uncertain = order.status === "payment_uncertain";
  return (
    <>
      <dl className="review">
        <div>
          <dt>Product</dt>
          <dd>{order.product.name}</dd>
        </div>
        <div>
          <dt>Merchant</dt>
          <dd>{order.product.merchantId}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd className="mono">{formatMinor(order.priceMinor, order.product.currency)}</dd>
        </div>
        <div>
          <dt>Order status</dt>
          <dd>
            <Status tone={statusTone[order.status] ?? "gray"}>{order.status}</Status>
          </dd>
        </div>
        <div>
          <dt>Proposed at</dt>
          <dd>{formatDateTime(order.proposedAt)}</dd>
        </div>
        {payment && (
          <>
            <div>
              <dt>Zcash transaction</dt>
              <dd className="mono">{payment.txId ? `${payment.txId.slice(0, 20)}…` : "Not yet broadcast"}</dd>
            </div>
            <div>
              <dt>Amount (real, Zcash testnet)</dt>
              <dd className="mono">{formatZatoshi(payment.amountZatoshi)}</dd>
            </div>
            <div>
              <dt>Merchant settlement</dt>
              <dd>
                <Status tone={payment.settlementMode === "real" ? "green" : "amber"}>{payment.settlementMode === "real" ? "Real" : "Simulated"}</Status>
              </dd>
            </div>
          </>
        )}
      </dl>

      {uncertain && (
        <div className="info-box" style={{ background: "var(--amber-soft)", color: "var(--amber)", marginTop: 16 }}>
          <Icon name="alert" />
          <p>
            <b>Payment outcome uncertain.</b> The signer did not receive a confirmed response from the Zcash network in time - the
            transaction may or may not have broadcast. The reserved budget is held, not released, and this will not be automatically
            retried (retrying could double-send). This requires manual reconciliation by an operator with signer access.
          </p>
        </div>
      )}

      {payment?.simulatedDelivery && (
        <div className="info-box" style={{ marginTop: 16 }}>
          <Icon name="alert" />
          <p>{payment.simulatedDelivery.label}</p>
        </div>
      )}
    </>
  );
}

export function ActivityPage() {
  const mandatesState = useMandates();
  const [mandateId, setMandateId] = useState<string>("");
  const ordersState = useAsync(() => api.orders.list(mandateId || undefined), [mandateId]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const mandates = mandatesState.status === "success" ? mandatesState.data : [];

  return (
    <>
      <PageHead title="Activity" eyebrow="Order history" />
      <p className="page-intro">Every order the guardian has decided on, newest first, with its live payment status. {UNAVAILABLE_FEATURES.activityStream}</p>

      <div className="filterbar">
        <select aria-label="Filter by mandate" value={mandateId} onChange={(e) => setMandateId(e.target.value)}>
          <option value="">All mandates</option>
          {mandates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <button className="icon-button" aria-label="Refresh" onClick={() => ordersState.reload()}>
          <Icon name="pulse" />
        </button>
      </div>

      <section style={{ marginTop: 20 }}>
        {ordersState.status === "loading" && <LoadingState label="Loading orders…" />}
        {ordersState.status === "error" && <ErrorState error={ordersState.error} onRetry={ordersState.reload} />}
        {ordersState.status === "success" && ordersState.data.length === 0 && (
          <EmptyState icon="pulse" title="No orders yet" description="Orders appear here once the agent proposes a purchase and the guardian makes a decision." />
        )}
        {ordersState.status === "success" && ordersState.data.length > 0 && (
          <div className="data-table">
            <div className="table-row table-head">
              <span>Order</span>
              <span>Price</span>
              <span>Settlement</span>
              <span>Transaction</span>
              <span>Status</span>
              <span></span>
            </div>
            {ordersState.data.map(({ order, payment }) => (
              <button key={order.orderId} className="table-row" style={{ width: "100%", textAlign: "left", border: 0, cursor: "pointer" }} onClick={() => setOpenOrderId(order.orderId)}>
                <span>
                  <b>{order.product.name}</b>
                  <small>{order.orderId.slice(0, 8)}</small>
                </span>
                <span className="mono">{formatMinor(order.priceMinor, order.product.currency)}</span>
                <span>
                  {payment ? <Status tone={payment.settlementMode === "real" ? "green" : "amber"}>{payment.settlementMode}</Status> : <small>—</small>}
                </span>
                <span className="mono">{payment?.txId ? `${payment.txId.slice(0, 10)}…` : "—"}</span>
                <span>
                  <Status tone={statusTone[order.status] ?? "gray"}>{order.status}</Status>
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        )}
      </section>

      {openOrderId && <OrderDetail orderId={openOrderId} onClose={() => setOpenOrderId(null)} />}
    </>
  );
}
