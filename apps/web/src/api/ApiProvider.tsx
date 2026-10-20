import { useAuth } from "@clerk/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createApiClient, isAbort, type ApiClient } from "./client.ts";

const ApiContext = createContext<ApiClient | null>(null);

// One api client for the signed-in app. Each call asks Clerk for a fresh session token; the token is never stored by
// our code.
export function ApiProvider({ baseUrl, fetch, children }: { baseUrl: string; fetch?: typeof globalThis.fetch; children: ReactNode }) {
  const { getToken } = useAuth();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const client = useMemo(() => createApiClient({ baseUrl, getToken: () => tokenRef.current(), ...(fetch ? { fetch } : {}) }), [baseUrl, fetch]);
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi needs an ApiProvider");
  return client;
}

export type OrgQuery<T> = {
  status: "loading" | "ready" | "error";
  data: T | undefined;
  error: unknown;
  // True while a refresh runs with the previous data still shown.
  refreshing: boolean;
  // When `data` arrived, for "showing the list from 3:02 PM" after a failed refresh.
  loadedAt: Date | undefined;
  refresh: () => void;
};

// A read for the active organization. When the org changes, the request in flight is aborted, the old org's data is
// dropped at once, and the read starts again; a late reply for the old org is ignored. Refresh keeps the data on screen
// while it reloads. Nothing is retried automatically.
export function useOrgQuery<T>(load: (api: ApiClient, signal: AbortSignal) => Promise<T>, key = ""): OrgQuery<T> {
  const api = useApi();
  const { orgId } = useAuth();
  const [nonce, setNonce] = useState(0);
  type State = { scope: string; status: OrgQuery<T>["status"]; data: T | undefined; error: unknown; refreshing: boolean; loadedAt: Date | undefined };
  const [state, setState] = useState<State>({ scope: "", status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined });
  const loadRef = useRef(load);
  loadRef.current = load;
  const scope = `${orgId ?? ""}|${key}`;

  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    setState((s) => (s.scope === scope && s.data !== undefined
      ? { ...s, refreshing: true }
      : { scope, status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined }));
    loadRef.current(api, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ scope, status: "ready", data, error: undefined, refreshing: false, loadedAt: new Date() }); },
      (error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setState((s) => (s.scope === scope
          ? { ...s, status: "error", error, refreshing: false }
          : { scope, status: "error", data: undefined, error, refreshing: false, loadedAt: undefined }));
      },
    );
    return () => controller.abort();
  }, [api, orgId, scope, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  // Never show another org's data, even for the one render before the effect runs.
  if (state.scope !== scope) return { status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined, refresh };
  return { ...state, refresh };
}
