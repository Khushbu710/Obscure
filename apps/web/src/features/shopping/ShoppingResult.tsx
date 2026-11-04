import type { ShoppingRequestResponse } from "@obscura/contracts";
import { Icon } from "../../components/common/Icon";
import { formatMinor } from "../../lib/formatters/money";

/**
 * Renders the ACTUAL discriminated-union response from
 * POST /api/shopping/requests, verbatim per case - never collapsed into a
 * generic "success" state, never implying payment/delivery beyond what the
 * backend returned. "authorized" means the guardian approved and budget
 * was reserved - it does NOT mean a transaction was signed, broadcast, or
 * confirmed (no signer/Zcash adapter exists yet - see Wallet page).
 */
export function ShoppingResult({ result }: { result: ShoppingRequestResponse }) {
  if (result.status === "authorized") {
    return (
      <aside className="proposal">
        <div className="proposal-head">
          <div>
            <p className="eyebrow">Purchase proposal</p>
            <h2>Guardian authorized</h2>
          </div>
          <span className="proposal-id mono">{result.order.orderId.slice(0, 8).toUpperCase()}</span>
        </div>
        <div className="decision">
          <span>
            <Icon name="shield" />
          </span>
          <div>
            <small>GUARDIAN DECISION</small>
            <strong>Authorized</strong>
            <p>Proposal satisfies every mandate condition. Budget has been reserved.</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Product</dt>
            <dd>{result.order.product.name}</dd>
          </div>
          <div>
            <dt>Verified merchant</dt>
            <dd>
              <Icon name="check" size={14} /> {result.order.product.merchantId}
            </dd>
          </div>
          <div>
            <dt>Verified price</dt>
            <dd className="mono">{formatMinor(result.order.priceMinor, result.order.product.currency)}</dd>
          </div>
          <div>
            <dt>Order status</dt>
            <dd className="mono">{result.order.status}</dd>
          </div>
          <div>
            <dt>Proposed at</dt>
            <dd>{new Date(result.order.proposedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <div className="auth-note">
          <Icon name="lock" />
          <p>
            <b>Authorization is not payment.</b>
            <br />
            No Zcash transaction has been signed or broadcast. The isolated signer and Zcash adapter integration are not connected yet
            (see the Wallet page) - this order is reserved against your mandate's budget, nothing more.
          </p>
        </div>
      </aside>
    );
  }

  if (result.status === "rejected") {
    return (
      <aside className="proposal">
        <div className="proposal-head">
          <div>
            <p className="eyebrow">Purchase proposal</p>
            <h2>Guardian rejected</h2>
          </div>
          <span className="proposal-id mono">{result.order.orderId.slice(0, 8).toUpperCase()}</span>
        </div>
        <div className="decision rejected">
          <span>
            <Icon name="close" />
          </span>
          <div>
            <small>GUARDIAN DECISION</small>
            <strong>{result.rejection.code}</strong>
            <p>{result.rejection.reason}</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Product attempted</dt>
            <dd>{result.order.product.name}</dd>
          </div>
          <div>
            <dt>Price attempted</dt>
            <dd className="mono">{formatMinor(result.order.priceMinor, result.order.product.currency)}</dd>
          </div>
        </dl>
        <div className="auth-note">
          <Icon name="lock" />
          <p>No budget was reserved and nothing was signed or sent to a merchant. The mandate's full remaining budget is still available.</p>
        </div>
      </aside>
    );
  }

  if (result.status === "malformed_proposal") {
    return (
      <aside className="proposal">
        <div className="proposal-head">
          <div>
            <p className="eyebrow">Purchase proposal</p>
            <h2>Malformed proposal</h2>
          </div>
        </div>
        <div className="decision rejected">
          <span>
            <Icon name="close" />
          </span>
          <div>
            <small>AGENT OUTPUT REJECTED</small>
            <strong>Malformed</strong>
            <p>{result.reason}</p>
          </div>
        </div>
        <div className="auth-note">
          <Icon name="lock" />
          <p>The agent's output did not pass schema validation and was rejected before reaching the guardian. No budget was touched.</p>
        </div>
      </aside>
    );
  }

  if (result.status === "product_not_verified") {
    return (
      <aside className="proposal">
        <div className="proposal-head">
          <div>
            <p className="eyebrow">Purchase proposal</p>
            <h2>Product could not be verified</h2>
          </div>
        </div>
        <div className="decision rejected">
          <span>
            <Icon name="close" />
          </span>
          <div>
            <small>VERIFICATION FAILED</small>
            <strong>Not found</strong>
            <p className="mono" style={{ wordBreak: "break-all" }}>
              {result.merchantProductId}
            </p>
          </div>
        </div>
        <div className="auth-note">
          <Icon name="lock" />
          <p>A fresh live lookup for this exact product/package could not be completed - it may be discontinued or out of stock. No authorization was attempted.</p>
        </div>
      </aside>
    );
  }

  // no_proposal
  return (
    <aside className="proposal">
      <div className="proposal-head">
        <div>
          <p className="eyebrow">Purchase proposal</p>
          <h2>No proposal produced</h2>
        </div>
      </div>
      <div className="decision">
        <span>
          <Icon name="search" />
        </span>
        <div>
          <small>AGENT RESULT</small>
          <strong>No match</strong>
          <p>{result.reason}</p>
        </div>
      </div>
    </aside>
  );
}
