import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_OPTIONS, DEFAULT_THEME_VALUES, themeVars, contrast, themeChange } from "../public/renderer/theme.js";

const defaults = { ...DEFAULT_THEME_VALUES };
const slot = (value: string, status = "agreed") => ({ value, status, previous: value });
const theme = (over: Record<string, any> = {}) => ({
  accent: slot("slate"), warmth: slot("neutral"), radius: slot("soft"), density: slot("regular"), ...over,
});
const proto = (t: any) => ({ root: {}, currentScreen: "home", theme: t }) as any;

test("every accent and warmth gives readable pairs", () => {
  for (const accent of THEME_OPTIONS.accent) {
    for (const warmth of THEME_OPTIONS.warmth) {
      const v = themeVars({ ...defaults, accent, warmth });
      const at = `${accent}/${warmth}`;
      assert.ok(contrast(v["--b-accent-ink"], v["--b-accent"]) >= 4.5, `accent ink ${at}`);
      assert.ok(contrast(v["--b-ink"], v["--b-bg"]) >= 7, `ink ${at}`);
      assert.ok(contrast(v["--b-ink-2"], v["--b-surface"]) >= 4.5, `ink-2 ${at}`);
      for (const s of ["ok", "warn", "bad"]) {
        assert.ok(contrast(v[`--b-${s}`], v[`--b-${s}-bg`]) >= 4.5, `${s} ${at}`);
      }
    }
  }
});

test("gold gets dark text, indigo gets white", () => {
  assert.equal(themeVars({ ...defaults, accent: "gold" })["--b-accent-ink"], "#111827");
  assert.equal(themeVars({ ...defaults, accent: "indigo" })["--b-accent-ink"], "#ffffff");
});

test("a green accent moves success to teal", () => {
  assert.equal(themeVars({ ...defaults, accent: "green" })["--b-ok"], "#115e59");
  assert.equal(themeVars({ ...defaults, accent: "blue" })["--b-ok"], "#166534");
  assert.equal(themeVars({ ...defaults, accent: "red" })["--b-bad"], "#9f1239");
});

test("radius and density map to px", () => {
  const r = themeVars({ ...defaults, radius: "round" });
  assert.equal(r["--b-radius"], "20px");
  assert.equal(r["--b-radius-sm"], "10px");
  const d = themeVars({ ...defaults, density: "compact" });
  assert.equal(d["--b-gap"], "10px");
  assert.equal(d["--b-pad"], "12px");
});

test("themeChange", () => {
  const a = proto(theme());
  assert.equal(themeChange(a, proto(theme({ accent: slot("gold", "draft") }))), "values");
  const draft = proto(theme({ accent: { value: "gold", status: "draft", decisionId: "d1", previous: "slate" } }));
  const droppedId = proto(theme({ accent: { value: "gold", status: "agreed", previous: "gold" } }));
  assert.equal(themeChange(draft, droppedId), null, "losing the decision id is a revert, not an agree");
  const agreed = proto(theme({ accent: { value: "gold", status: "agreed", decisionId: "d1", previous: "slate" } }));
  assert.equal(themeChange(draft, agreed), "settled", "an agree keeps the decision id");
  const sameValueDraft = proto(theme({ accent: { value: "slate", status: "draft", decisionId: "d1", previous: "slate" } }));
  assert.equal(themeChange(sameValueDraft, a), null, "a revert that changes no value is not an agree");
  const reverted = proto(theme({ accent: { value: "slate", status: "agreed", previous: "slate" } }));
  assert.equal(themeChange(draft, reverted), "values", "a revert that changes the value fades");
  assert.equal(themeChange(a, proto(theme())), null);
  assert.equal(themeChange(null, a), null);
});
