import { useBackendHealth } from "../../hooks/useBackendHealth";

/**
 * Replaces the original mockup's system bar, which showed fabricated
 * claims ("Guardian online", "Policy hash b7e4…92ac", "Signer attestation
 * valid") with no backend source. The only thing this frontend can
 * actually verify is whether the backend is reachable at all (GET
 * /health), so that is the only claim made here.
 */
export function SystemBar() {
  const health = useBackendHealth();

  return (
    <div className="system-bar" aria-label="Backend connectivity status">
      <span>
        <i style={{ background: health === "connected" ? "#4f896e" : health === "unreachable" ? "#b25e56" : "#b17b2b" }} />
        Backend {health === "checking" ? "checking…" : health === "connected" ? "connected" : "unreachable"}
      </span>
      <span className="system-bar-end">Deterministic guardian and signer run entirely server-side</span>
    </div>
  );
}
