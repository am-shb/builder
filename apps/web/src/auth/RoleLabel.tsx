import { useOrgQuery } from "../api/ApiProvider.tsx";
import { roleLabel } from "@builder/session-core";

// The member's role in the active organization, from GET /v1/me, on desktop beside the org switcher. It's a nicety:
// while it loads, or if it fails, nothing shows.
export function RoleLabel() {
  const me = useOrgQuery((api, signal) => api.me(signal));
  if (me.status !== "ready" || !me.data) return null;
  return (
    <span className="hidden rounded-full bg-sunk px-2.5 py-1 text-[13px] leading-none font-semibold text-ink-2 md:inline-block">
      <span className="sr-only">Your role: </span>{roleLabel(me.data.role)}
    </span>
  );
}
