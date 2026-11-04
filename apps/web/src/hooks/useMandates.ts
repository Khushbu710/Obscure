import { useCallback } from "react";
import type { Mandate } from "@obscura/contracts";
import { api } from "../lib/api/client";
import { useAsync } from "./useAsync";

/** Shared across Overview, Mandates, and Shopping pages - the single source of real mandate data, never duplicated per-page fetch logic. */
export function useMandates() {
  const fetchMandates = useCallback(() => api.mandates.list(), []);
  return useAsync<Mandate[]>(fetchMandates, []);
}
