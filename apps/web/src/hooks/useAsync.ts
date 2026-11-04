import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: unknown };

/**
 * The one place loading/success/error state is modeled for a GET-style
 * fetch - every page uses this instead of re-implementing its own
 * try/catch/useState dance. `deps` controls when the fetch re-runs.
 *
 * `reload(options)` accepts `{ silent: true }` for refetches that should
 * update the data once it arrives WITHOUT flashing the loading skeleton in
 * between - e.g. refreshing mandate budgets after a shopping request
 * completes, where flipping back to "loading" would hide the just-received
 * result the user is looking at.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: (options?: { silent?: boolean }) => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const silentRef = useRef(false);

  const load = useCallback(() => {
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) setState({ status: "loading" });
    fn()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => load(), [load]);

  return {
    ...state,
    reload: (options) => {
      silentRef.current = options?.silent ?? false;
      setTick((t) => t + 1);
    },
  };
}
