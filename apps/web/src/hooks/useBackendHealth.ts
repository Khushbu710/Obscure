import { useEffect, useState } from "react";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export type BackendHealth = "checking" | "connected" | "unreachable";

/** Polls the real GET /health endpoint - the only "system status" claim this frontend can actually verify. */
export function useBackendHealth(intervalMs = 15_000): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`${BASE_URL}/health`)
        .then((res) => {
          if (!cancelled) setHealth(res.ok ? "connected" : "unreachable");
        })
        .catch(() => {
          if (!cancelled) setHealth("unreachable");
        });
    };
    check();
    const id = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return health;
}
