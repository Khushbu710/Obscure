import { Icon } from "../common/Icon";

/**
 * Distinct from EmptyState: this is NOT "zero results," it's "this
 * functionality has no backend endpoint yet." Used for Wallet/Activity/
 * Receipts/Security sections that have no real data source - see
 * lib/api/unavailable.ts. Never replace this with mock data.
 */
export function UnavailableState({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="unavailable-state">
      <Icon name="lock" size={24} />
      <h2>{title}</h2>
      <p>{reason}</p>
    </div>
  );
}
