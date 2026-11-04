/**
 * All amounts from the backend are integer minor units (cents) - see
 * packages/contracts/src/common.ts MinorUnitsSchema. Never do float math on
 * these; only format for display.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isFinite(amountMinor)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}

export function formatMinorCompact(amountMinor: number): string {
  if (!Number.isFinite(amountMinor)) return "—";
  return (amountMinor / 100).toFixed(2);
}

const ZATOSHI_PER_ZEC = 100_000_000;

/**
 * 1 ZEC = 100,000,000 zatoshi is a fixed protocol constant, not an exchange
 * rate - this is unit conversion, not pricing. Never use this for USD/ZEC
 * conversion; that is DEMO_ZATOSHI_PER_MINOR, a configured demonstration
 * rate (see docs/architecture/zcash-integration.md and the Wallet page).
 */
export function formatZatoshi(zatoshi: number | null): string {
  if (zatoshi === null || !Number.isFinite(zatoshi)) return "—";
  return `${(zatoshi / ZATOSHI_PER_ZEC).toFixed(8)} ZEC`;
}
