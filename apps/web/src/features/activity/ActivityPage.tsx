import { PageHead } from "../../components/common/PageHead";
import { UnavailableState } from "../../components/feedback/UnavailableState";
import { UNAVAILABLE_FEATURES } from "../../lib/api/unavailable";

export function ActivityPage() {
  return (
    <>
      <PageHead title="Activity" eyebrow="Verifiable event log" />
      <p className="page-intro">Every agent action, policy decision, and signer authorization would appear here in chronological order, once a real event source exists.</p>
      <div className="filterbar" style={{ opacity: 0.4, pointerEvents: "none" }}>
        <div className="search-small">
          <input placeholder="Search events or identifiers" disabled />
        </div>
        <select disabled>
          <option>All event types</option>
        </select>
      </div>
      <section style={{ marginTop: 20 }}>
        <UnavailableState title="Activity log not connected" reason={UNAVAILABLE_FEATURES.activityLog} />
      </section>
    </>
  );
}
