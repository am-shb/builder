import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldWait, countLogs } from "../scripts/demo-run.ts";

test("demo-run waits for the comparison only when a key is set", () => {
  assert.equal(shouldWait({ OPENROUTER_API_KEY: "k" }), true);
  assert.equal(shouldWait({ OPENROUTER_API_KEY: "" }), false);
  assert.equal(shouldWait({ OPENROUTER_API_KEY: "  " }), false);
  assert.equal(shouldWait({}), false);
});

test("demo-run counts report fields from server log lines", () => {
  const lines = [
    JSON.stringify({ msg: "llm_tool_dropped" }), JSON.stringify({ msg: "build.run", ops_unoffered: 2 }),
    JSON.stringify({ msg: "build.run", ops_unoffered: 0 }), JSON.stringify({ msg: "conversation.spoken_pick" }), "not json",
  ];
  assert.deepEqual(countLogs(lines), { llm_tool_dropped: 1, build_runs: 2, ops_unoffered: 2, spoken_picks: 1 });
});
