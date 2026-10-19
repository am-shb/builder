// Input: buttons and form controls. Typed and picked values live in ui.values (interact.js sets them from the
// bubbling "input" event), so every control reads ui.values[node.id] before its own prop.
import { h, str, arr, clampInt, setText, setOptional, setAttr, withParts, syncTexts, changed } from "@renderer/components/dom.js";

/** Label above a field, shared by Input, Select, Slider and DatePicker. */
function field(cls, tag = "label") {
  const el = h(tag, `b-field ${cls}`);
  const label = h("span", "b-field-label");
  el.append(label);
  return { el, label };
}

function syncField(el, node, ui, input) {
  setOptional(el.parts.label, str(node.props.label));
  const value = str(ui.values[node.id] ?? node.props.value);
  if (input.value !== value) input.value = value;
}

const VARIANTS = ["primary", "secondary", "ghost", "danger"];

export const INPUT = {
  Button: {
    create() {
      const el = h("button", "b-button");
      el.type = "button";
      return el;
    },
    update(el, node) {
      setText(el, str(node.props.label, "Button"));
      const variant = VARIANTS.includes(str(node.props.variant)) ? str(node.props.variant) : "primary";
      for (const v of VARIANTS) el.classList.toggle(`is-${v}`, v === variant);
    },
  },

  Input: {
    create() {
      const { el, label } = field("b-input");
      const box = h("span", "b-field-box");
      const input = h("input", "b-field-input");
      input.type = "text";
      box.append(input);
      el.append(box);
      return withParts(el, { label, input });
    },
    update(el, node, ui) {
      setAttr(el.parts.input, "placeholder", str(node.props.placeholder));
      syncField(el, node, ui, el.parts.input);
    },
  },

  Search: {
    create() {
      const el = h("label", "b-search");
      const glass = h("span", "b-search-glass");
      glass.setAttribute("aria-hidden", "true");
      const input = h("input", "b-search-input");
      input.type = "search";
      el.append(glass, input);
      return withParts(el, { input });
    },
    update(el, node, ui) {
      setAttr(el.parts.input, "placeholder", str(node.props.placeholder, "Search"));
      const value = str(ui.values[node.id]);
      if (el.parts.input.value !== value) el.parts.input.value = value;
    },
  },

  Select: {
    create() {
      const { el, label } = field("b-select");
      const box = h("span", "b-field-box b-select-box");
      const select = h("select", "b-field-input b-select-input");
      box.append(select);
      el.append(box);
      return withParts(el, { label, select });
    },
    update(el, node, ui) {
      setOptional(el.parts.label, str(node.props.label));
      const options = arr(node.props.options);
      syncTexts(el.parts.select, options, (t) => h("option", "", t));
      const value = str(ui.values[node.id] ?? node.props.value, options[0] ?? "");
      if (el.parts.select.value !== value) el.parts.select.value = value;
    },
  },

  // Radio inputs under the labels: picking one fires "input", which interact.js turns into setValue.
  Segmented: {
    create(node) {
      const el = h("div", "b-segmented");
      el.setAttribute("role", "radiogroup");
      el.parts = { name: `b-seg-${node.id}` };
      return el;
    },
    update(el, node, ui) {
      const options = arr(node.props.options);
      const value = str(ui.values[node.id] ?? node.props.value, options[0] ?? "");
      if (changed(el, JSON.stringify(options))) {
        el.replaceChildren(...options.map((o) => {
          const opt = h("label", "b-segment");
          const radio = h("input", "b-segment-radio");
          radio.type = "radio";
          radio.name = el.parts.name;
          radio.value = o;
          opt.append(radio, document.createTextNode(o));
          return opt;
        }));
      }
      [...el.children].forEach((c, i) => c.classList.toggle("is-active", options[i] === value));
    },
  },

  Toggle: {
    create() {
      const el = h("div", "b-toggle");
      el.setAttribute("role", "switch");
      el.tabIndex = 0;
      const track = h("span", "b-toggle-track");
      const label = h("span", "b-toggle-label");
      el.append(track, label);
      return withParts(el, { label });
    },
    update(el, node, ui) {
      const on = ui.toggles[node.id] ?? node.props.on === true;
      el.classList.toggle("is-on", on);
      setAttr(el, "aria-checked", String(on));
      setOptional(el.parts.label, str(node.props.label));
    },
  },

  Checkbox: {
    create() {
      const el = h("div", "b-checkbox");
      el.setAttribute("role", "checkbox");
      el.tabIndex = 0;
      const box = h("span", "b-checkbox-box");
      const label = h("span", "b-checkbox-label");
      el.append(box, label);
      return withParts(el, { box, label });
    },
    update(el, node, ui) {
      const on = ui.toggles[node.id] ?? node.props.checked === true;
      el.classList.toggle("is-on", on);
      setAttr(el, "aria-checked", String(on));
      setText(el.parts.box, on ? "✓" : "");
      setOptional(el.parts.label, str(node.props.label));
    },
  },

  Slider: {
    create() {
      const { el, label } = field("b-slider", "div");
      const value = h("span", "b-slider-value");
      label.after(value);
      const track = h("div", "b-slider-track");
      const fill = h("span", "b-slider-fill");
      const thumb = h("span", "b-slider-thumb");
      const input = h("input", "b-slider-input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      track.append(fill, thumb, input);
      el.append(track);
      return withParts(el, { label, value, fill, thumb, input });
    },
    update(el, node, ui) {
      setOptional(el.parts.label, str(node.props.label));
      const v = clampInt(ui.values[node.id] ?? node.props.value, 0, 100, 0);
      setText(el.parts.value, String(v));
      const pct = `${v}%`;
      if (el.parts.fill.style.width !== pct) el.parts.fill.style.width = pct;
      if (el.parts.thumb.style.left !== pct) el.parts.thumb.style.left = pct;
      if (el.parts.input.value !== String(v)) el.parts.input.value = String(v);
    },
  },

  DatePicker: {
    create() {
      const { el, label } = field("b-date", "div");
      const box = h("span", "b-field-box b-date-box");
      const value = h("span", "b-date-value");
      const cal = h("span", "b-date-cal");
      cal.setAttribute("aria-hidden", "true");
      box.append(value, cal);
      el.append(box);
      return withParts(el, { label, value });
    },
    update(el, node, ui) {
      setOptional(el.parts.label, str(node.props.label));
      const value = str(ui.values[node.id] ?? node.props.value);
      setText(el.parts.value, value || "Pick a date");
      el.parts.value.classList.toggle("is-empty", !value);
    },
  },

  Steps: {
    create: () => h("ol", "b-steps"),
    update(el, node) {
      const steps = arr(node.props.steps);
      const current = clampInt(node.props.current, 0, Math.max(0, steps.length - 1), 0);
      if (!changed(el, JSON.stringify([steps, current]))) return;
      el.replaceChildren(...steps.map((s, i) => {
        const state = i < current ? "is-done" : i === current ? "is-current" : "is-todo";
        const step = h("li", `b-step ${state}`);
        step.append(h("span", "b-step-dot", i < current ? "✓" : String(i + 1)), h("span", "b-step-label", s));
        return step;
      }));
    },
  },

  FileUpload: {
    create() {
      const el = h("div", "b-upload");
      const mark = h("span", "b-upload-mark", "↑");
      mark.setAttribute("aria-hidden", "true");
      const label = h("span", "b-upload-label");
      const hint = h("span", "b-upload-hint");
      el.append(mark, label, hint);
      return withParts(el, { label, hint });
    },
    update(el, node) {
      setText(el.parts.label, str(node.props.label, "Upload a file"));
      setOptional(el.parts.hint, str(node.props.hint));
    },
  },
};

