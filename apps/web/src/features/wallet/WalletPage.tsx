import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { UnavailableState } from "../../components/feedback/UnavailableState";
import { UNAVAILABLE_FEATURES } from "../../lib/api/unavailable";

export function WalletPage() {
  return (
    <>
      <PageHead title="Shielded wallet" eyebrow="Zcash testnet" />
      <p className="page-intro">Funds are designed to be isolated from agent access and released only through validated mandates. This integration is not connected yet.</p>

      <section className="wallet-hero" style={{ opacity: 0.55 }}>
        <div>
          <p className="eyebrow">Shielded envelope balance</p>
          <strong>
            — <small>ZEC</small>
          </strong>
          <span>No wallet connected</span>
        </div>
        <div className="wallet-address">
          <span>SHIELDED ADDRESS</span>
          <b className="mono">Not available</b>
        </div>
      </section>

      <section style={{ marginTop: 30 }}>
        <UnavailableState title="Zcash wallet integration not connected" reason={UNAVAILABLE_FEATURES.walletEnvelope} />
      </section>

      <section className="wallet-grid">
        <section className="panel">
          <p className="eyebrow">Isolation model</p>
          <h2>Who will be able to access funds?</h2>
          <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 14, lineHeight: 1.6 }}>
            This describes the intended design, not a live, verified state:
          </p>
          <dl className="access-list">
            <div>
              <dt>You (main wallet)</dt>
              <dd>Signs funding transactions only</dd>
            </div>
            <div>
              <dt>Isolated signer</dt>
              <dd>Policy-bound signing, not yet implemented</dd>
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
          <p className="eyebrow">Adapter status</p>
          <h2>Integration draft</h2>
          <p className="panel-copy">
            <Icon name="alert" size={14} /> No real Zcash send has been verified yet. The adapter is owned by Developer 1; this
            frontend is prepared to connect once <code>createWallet</code>, <code>getAddress</code>, <code>getBalance</code>,{" "}
            <code>send</code>, and <code>getTxStatus</code> are agreed and exposed via backend endpoints.
          </p>
        </section>
      </section>
    </>
  );
}
