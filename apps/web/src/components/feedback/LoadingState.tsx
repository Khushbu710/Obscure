export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="panel" role="status" aria-live="polite">
      <div className="skeleton" style={{ height: 14, width: "40%", marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: "70%", marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: "55%" }} />
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{label}</span>
    </div>
  );
}
