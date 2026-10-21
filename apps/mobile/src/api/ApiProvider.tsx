import { useAuth } from "@clerk/expo";
import { createApiClient, isAbort, type ApiClient } from "@builder/session-core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const ApiContext = createContext<ApiClient | null>(null);

// One api client for the signed-in app. Each call asks Clerk for a fresh session token; the token is never stored by
// our code. The same shape as apps/web/src/api/ApiProvider.tsx, on React Native's fetch and AbortController.
export function ApiProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { getToken } = useAuth();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const client = useMemo(() => createApiClient({ baseUrl, getToken: () => tokenRef.current() }), [baseUrl]);
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
  loadedAt: Date | undefined;
  refresh: () => void;
  // A refresh in the background (while a session may still change): no busy state, and a failure changes nothing on
  // screen. Skipped while another load is running, so it never cancels one.
  quietRefresh: () => void;
};

// A read for the active organization. When the org changes, the request in flight is aborted, the old org's data is
// dropped at once, and the read starts again; a late reply for the old org is ignored. Nothing is retried on its own.
export function useOrgQuery<T>(load: (api: ApiClient, signal: AbortSignal) => Promise<T>, key = ""): OrgQuery<T> {
  const api = useApi();
  const { orgId } = useAuth();
  const [nonce, setNonce] = useState({ n: 0, quiet: false });
  const running = useRef<"quiet" | "loud" | null>(null);
  type State = { scope: string; status: OrgQuery<T>["status"]; data: T | undefined; error: unknown; refreshing: boolean; loadedAt: Date | undefined };
  const [state, setState] = useState<State>({ scope: "", status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined });
  const loadRef = useRef(load);
  loadRef.current = load;
  const scope = `${orgId ?? ""}|${key}`;

  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    const quiet = nonce.quiet;
    running.current = quiet ? "quiet" : "loud";
    const settled = () => { if (!controller.signal.aborted) running.current = null; };
    setState((s) => (s.scope === scope && s.data !== undefined
      ? { ...s, refreshing: quiet ? s.refreshing : true }
      : { scope, status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined }));
    loadRef.current(api, controller.signal).then(
      (data) => {
        settled();
        if (!controller.signal.aborted) setState({ scope, status: "ready", data, error: undefined, refreshing: false, loadedAt: new Date() });
      },
      (error) => {
        settled();
        if (controller.signal.aborted || isAbort(error)) return;
        setState((s) => {
          if (quiet && s.scope === scope && s.data !== undefined) return { ...s, refreshing: false };
          return s.scope === scope
            ? { ...s, status: "error", error, refreshing: false }
            : { scope, status: "error", data: undefined, error, refreshing: false, loadedAt: undefined };
        });
      },
    );
    return () => controller.abort();
  }, [api, orgId, scope, nonce]);

  const refresh = useCallback(() => setNonce((x) => ({ n: x.n + 1, quiet: false })), []);
  const quietRefresh = useCallback(() => {
    if (running.current === "loud") return;
    setNonce((x) => ({ n: x.n + 1, quiet: true }));
  }, []);
  if (state.scope !== scope) return { status: "loading", data: undefined, error: undefined, refreshing: false, loadedAt: undefined, refresh, quietRefresh };
  return { ...state, refresh, quietRefresh };
}
