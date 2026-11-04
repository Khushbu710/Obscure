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
