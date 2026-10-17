import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_OBJECTION_MS,
  emptyDoc,
  markPending,
  recordSupport,
  recordObjection,
  tickAgreement,
  resolveConflict,
} from "../src/consensus/doc.ts";
import type { ConsensusDoc, Decision } from "../src/consensus/doc.ts";
import { emptyPrototype } from "../src/ui/tree.ts";
import { openStore } from "../src/store.ts";

function decision(over: Partial<Decision> = {}): Decision {
  return { id: "d1", text: "Use a sidebar", status: "draft", proposedBy: "Ann", agreedBy: [], affects: [], rejectedOptions: [], ...over };
}
function docWith(d: Decision): ConsensusDoc {
  return { ...emptyDoc(), decisions: [d] };
}

test("pending promotes after 30s with no objection", () => {
  const doc = markPending(docWith(decision()), "d1", 0);
  assert.equal(doc.decisions[0].status, "pending");
  assert.equal(doc.decisions[0].pendingSince, 0);
  const early = tickAgreement(doc, NO_OBJECTION_MS - 1);
  assert.deepEqual(early.promoted, []);
  assert.equal(early.doc.decisions[0].status, "pending");
  const late = tickAgreement(doc, NO_OBJECTION_MS);
  assert.deepEqual(late.promoted, ["d1"]);
  assert.equal(late.doc.decisions[0].status, "agreed");
  assert.equal(late.doc.decisions[0].decidedAt, NO_OBJECTION_MS);
  assert.equal(doc.decisions[0].status, "pending", "input doc is not mutated");
});

test("support from another participant agrees immediately", () => {
  const doc = markPending(docWith(decision()), "d1", 0);
  const out = recordSupport(doc, "d1", "Bob", 5_000);
  assert.equal(out.decisions[0].status, "agreed");
  assert.equal(out.decisions[0].decidedAt, 5_000);
  assert.ok(out.decisions[0].agreedBy.includes("Bob"));
});

test("recordSupport ignores unknown and self support", () => {
  const doc = markPending(docWith(decision()), "d1", 0);
  for (const who of [null, "", "Unknown", "Ann"]) {
    assert.equal(recordSupport(doc, "d1", who, 1_000).decisions[0].status, "pending");
  }
});

test("objection returns to draft and stops the timer", () => {
  const doc = markPending(docWith(decision()), "d1", 0);
  const out = recordObjection(doc, "d1", "Bob", 1_000);
  assert.equal(out.decisions[0].status, "draft");
  assert.equal(out.decisions[0].pendingSince, undefined);
  const ticked = tickAgreement(out, 10 * NO_OBJECTION_MS);
  assert.deepEqual(ticked.promoted, []);
  assert.equal(ticked.doc.decisions[0].status, "draft");
});

test("resolveConflict creates agreed decision with rejected options", () => {
  const batch = { ops: [], label: "variant" };
  const doc: ConsensusDoc = {
    ...emptyDoc(),
    conflicts: [{
      id: "c1", topic: "Navigation", status: "open", openedAt: 0,
      variants: [
        { label: "A", summary: "Sidebar", backers: ["Ann"], batch },
        { label: "B", summary: "Top tabs", backers: ["Bob"], batch },
      ],
    }],
  };
  const out = resolveConflict(doc, "c1", "B", 9_000);
  assert.equal(out.doc.conflicts[0].status, "resolved");
  assert.equal(out.doc.conflicts[0].winner, "B");
  assert.equal(out.decision.status, "agreed");
  assert.equal(out.decision.decidedAt, 9_000);
  assert.deepEqual(out.decision.rejectedOptions, ["Sidebar"]);
  assert.ok(out.doc.decisions.some((d) => d.id === out.decision.id));
});

test("store round-trips consensus doc and prototype", () => {
  const store = openStore(":memory:");
  assert.equal(store.getConsensus("s1"), undefined);
  const doc = markPending(docWith(decision()), "d1", 123);
  const proto = emptyPrototype("Demo");
  store.saveConsensus("s1", doc, proto);
  assert.deepEqual(store.getConsensus("s1"), { doc, proto });
  store.saveConsensus("s1", emptyDoc(), proto);
  assert.equal(store.getConsensus("s1")!.doc.phase, "opening");
  store.close();
});
