import { test } from "node:test";
import assert from "node:assert/strict";
import { withStage } from "./helpers/stage.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const task = (id: string, text: string, state: "now" | "queued" | "done") => ({ id, text, state });
const dockBatch = { batch: { label: "First", ops: [{ op: "add", parentId: "home", node: { id: "t1", type: "Text", props: { text: "Hi" }, status: "agreed", children: [] } }] } };
const rows = `[...document.querySelectorAll("#todo li")].map((li) => ({ id: li.dataset.id, cls: li.className, text: li.textContent }))`;
type Row = { id?: string; cls: string; text: string };

test("tasks render in the dock: now first, then queued, then done", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([dockBatch]);
    await page.waitFor(`document.querySelector(".builder").dataset.placement === "dock"`, 2000);
    await script([{ tasks: [task("c", "Login form", "done"), task("b", "Moving search up", "queued"), task("a", "Adding the buttons", "now")] }]);
    await page.waitFor(`document.querySelectorAll("#todo li").length === 3`, 2000);
    const got = await page.eval<Row[]>(rows);
    assert.deepEqual(got.map((r) => r.cls), ["now", "queued", "done"]);
    assert.deepEqual(got.map((r) => r.text), ["Adding the buttons", "Moving search up", "Login form"]);
  });
});

test("more than 4 tasks shows 3 rows and +N more", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([dockBatch]);
    const tasks = [task("1", "One", "now"), ...[2, 3, 4, 5, 6].map((n) => task(String(n), `T${n}`, "queued"))];
    await script([{ tasks }]);
    await page.waitFor(`document.querySelectorAll("#todo li").length === 4`, 2000);
    const got = await page.eval<Row[]>(rows);
    assert.equal(got[3].text, "+3 more");
    assert.ok(got[3].cls.split(" ").includes("more"));
    assert.deepEqual(got.slice(0, 3).map((r) => r.id), ["1", "2", "3"]);

    // Exactly MAX_ROWS tasks show in full.
    await script([{ tasks: tasks.slice(0, 4) }]);
    await page.waitFor(`document.querySelectorAll("#todo li").length === 4 && !document.querySelector("#todo li.more")`, 2000);
  });
});

test("a removed task leaves the list", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([dockBatch]);
    await script([{ tasks: [task("a", "Alpha", "now"), task("b", "Beta", "queued")] }]);
    await page.waitFor(`document.querySelector("#todo li[data-id=a]")`, 2000);
    await script([{ tasks: [task("b", "Beta", "queued")] }]);
    await page.waitFor(`!document.querySelector("#todo li[data-id=a]")`, 2000);
    await page.waitFor(`document.querySelectorAll("#todo li").length === 1`, 2000); // the fade has finished
    assert.deepEqual((await page.eval<Row[]>(rows)).map((r) => r.id), ["b"]);
  });
});

test("an unchanged list keeps its rows and does not re-animate them", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([dockBatch]);
    await script([{ tasks: [task("a", "Alpha", "now")] }]);
    await page.waitFor(`document.querySelector("#todo li[data-id=a]")`, 2000);
    await sleep(600);
    await page.eval(`document.querySelector("#todo li[data-id=a]").dataset.same = "1"`);
    await script([{ tasks: [task("a", "Alpha", "now")] }]);
    await sleep(300);
    assert.equal(await page.eval(`document.querySelector("#todo li[data-id=a]").dataset.same`), "1", "row element is reused");
    assert.equal(await page.eval(`document.querySelector("#todo li[data-id=a]").getAnimations().length`), 0);
  });
});

test("before anything is built, only now rows show under the robot", async (t) => {
  await withStage(t, async ({ page, script }) => {
    assert.equal(await page.eval(`document.querySelector(".builder").dataset.placement`), "center");
    await script([{ tasks: [task("a", "Alpha", "now"), task("b", "Beta", "queued")] }]);
    await page.waitFor(`document.querySelector("#todo li[data-id=a]")`, 2000);
    const shown = await page.eval<boolean[]>(`[...document.querySelectorAll("#todo li")].map((li) => li.getClientRects().length > 0)`);
    assert.deepEqual(shown, [true, false]);
  });
});

test("the snapshot restores the list on reconnect", async (t) => {
  await withStage(t, async ({ page, runtime, sessionId }) => {
    runtime(sessionId).setTasks([task("a", "Alpha", "now"), task("b", "Beta", "queued")]);
    // A navigation that waits for the new page's load, so the wait below never reads the old page's rows.
    await page.goto(await page.eval<string>(`location.href`));
    await page.waitFor(`document.querySelectorAll("#todo li").length === 2`, 5000);
    assert.deepEqual((await page.eval<Row[]>(rows)).map((r) => r.text), ["Alpha", "Beta"]);
  });
});
