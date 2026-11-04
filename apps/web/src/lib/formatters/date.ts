export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatRelativeExpiry(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return "—";
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}m remaining`;
  if (hours < 48) return `${hours}h remaining`;
  return `${Math.floor(hours / 24)}d remaining`;
}
