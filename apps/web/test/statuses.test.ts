// One list of statuses, kept in step in four places: the api's, the pill's labels, the session page's explanations
// and the start rules. A status added to the api without words here fails this test, instead of showing "Unknown"
// beside a known label in the demo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionStatus } from "@builder/contracts";
import { describe, expect, it } from "vitest";
import { isInProgress, STATUS_LABELS } from "../src/components/StatusPill.tsx";
import { STATUS_EXPLANATIONS, statusExplanation, UNKNOWN_STATUS_EXPLANATION } from "../src/sessions/detail.ts";
import { ACTIVE_STATUSES } from "../src/sessions/start.ts";

// The api's statuses: the contract's, plus the api's own, read from its source (they move to contracts/ in WC1).
function apiStatuses(): string[] {
  const source = readFileSync(join(import.meta.dirname, "../../api/src/routes/schemas.ts"), "utf8");
  const m = /export const ApiSessionStatus = z\.enum\(\[([^\]]*?)\.\.\.SessionStatusSchema\.options\]\)/.exec(source);
  if (!m) throw new Error("apps/api/src/routes/schemas.ts should define ApiSessionStatus as its own statuses plus the contract's");
  const own = [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
  return [...own, ...SessionStatus.options].sort();
}

describe("statuses", () => {
  it("every status the api sends has a label and an explanation, and there are no extras", () => {
    const api = apiStatuses();
    expect(api).toContain("start_unknown");
    expect(Object.keys(STATUS_LABELS).sort()).toEqual(api);
    expect(Object.keys(STATUS_EXPLANATIONS).sort()).toEqual(api);
    for (const status of api) expect(statusExplanation(status)).not.toBe(UNKNOWN_STATUS_EXPLANATION);
  });

  it("the statuses still on their way are the active ones, short of being in the meeting", () => {
    const api = apiStatuses();
    for (const s of ACTIVE_STATUSES) expect(api).toContain(s);
    expect(api.filter(isInProgress)).toEqual(ACTIVE_STATUSES.filter((s) => s !== "in_meeting").sort());
  });
});
