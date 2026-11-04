import { PageHead } from "../../components/common/PageHead";
import { Icon } from "../../components/common/Icon";
import { UnavailableState } from "../../components/feedback/UnavailableState";
import { UNAVAILABLE_FEATURES } from "../../lib/api/unavailable";

export function ReceiptsPage() {
  return (
    <>
      <PageHead title="Private receipts" eyebrow="Selective disclosure" />
      <p className="page-intro">Purchase records are designed to stay private, with only specific fields revealed on demand. This uses a digital signature and hash commitment - it is explicitly not a zero-knowledge proof.</p>
      <div className="receipt-layout">
        <section>
          <UnavailableState title="Receipt service not connected" reason={UNAVAILABLE_FEATURES.receipts} />
        </section>
        <aside className="disclosure">
          <span>
            <Icon name="receipt" size={26} />
          </span>
          <p className="eyebrow">Selective disclosure (planned)</p>
          <h2>Prove the purchase, not your identity.</h2>
          <p>
            Once implemented, a disclosure reveals only merchant, amount, date, or category for one purchase via its signature and
            hash commitment - never a zero-knowledge proof, and never your full purchase history.
          </p>
          <button className="primary" disabled title="Not available until the receipt backend is implemented">
            Create disclosure
          </button>
        </aside>
      </div>
    </>
  );
}
