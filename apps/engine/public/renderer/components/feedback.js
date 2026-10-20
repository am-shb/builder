// Feedback (empty states, notices, loading) and conversation (chat, comments).
import { h, str, arr, clampInt, setText, setHidden, setClass, syncIcon, setOptional, withParts, changed, cells, cellEl, avatar, syncAvatar } from "@renderer/components/dom.js";

const SKELETON_WIDTHS = ["100%", "92%", "78%", "96%", "70%", "86%"];

export const FEEDBACK = {
  EmptyState: {
    create() {
      const el = h("div", "b-empty b-panel");
      const art = h("span", "b-empty-art");
      art.setAttribute("aria-hidden", "true");
      const title = h("div", "b-empty-title");
      const text = h("div", "b-empty-text");
      const actions = h("div", "b-empty-actions");
      el.append(art, title, text, actions);
      return withParts(el, { art, title, text, actions });
    },
    update(el, node) {
      // With an icon the picture is that icon in the soft tile; without one it stays the generic placeholder art.
      const art = el.parts.art;
      syncIcon(art, node.props.icon, 28);
      setHidden(art, false);
      setClass(art, "has-icon", !!art.firstChild);
      setText(el.parts.title, str(node.props.title, "Nothing here yet"));
      setOptional(el.parts.text, str(node.props.text));
    },
    slot: (el) => el.parts.actions,
  },

  Banner: {
    create() {
      const el = h("div", "b-banner");
      el.setAttribute("role", "status");
      const title = h("div", "b-banner-title");
      const text = h("div", "b-banner-text");
      el.append(title, text);
      return withParts(el, { title, text });
    },
    update(el, node) {
      setOptional(el.parts.title, str(node.props.title));
      setOptional(el.parts.text, str(node.props.text));
    },
  },

  Toast: {
    create() {
      const el = h("div", "b-toast");
      el.setAttribute("role", "status");
      const dot = h("span", "b-toast-dot");
      const text = h("span", "b-toast-text");
      el.append(dot, text);
      return withParts(el, { text });
    },
    update(el, node) {
      setText(el.parts.text, str(node.props.text));
    },
  },

  Skeleton: {
    create: () => h("div", "b-skeleton b-panel"),
    update(el, node) {
      const lines = clampInt(node.props.lines, 1, 6, 3);
      if (!changed(el, String(lines))) return;
      el.replaceChildren(...SKELETON_WIDTHS.slice(0, lines).map((w) => {
        const line = h("span", "b-skeleton-line");
        line.style.width = w;
        return line;
      }));
    },
  },

  // "Name | message"; the name "me" is the viewer and aligns right. A name shows when the sender changes.
  ChatThread: {
    create: () => h("div", "b-chat b-panel"),
    update(el, node) {
      const messages = arr(node.props.messages);
      if (!changed(el, JSON.stringify(messages))) return;
      let last = "";
      el.replaceChildren(...messages.map((row) => {
        const cs = cells(row);
        const [who, ...rest] = cs.length > 1 ? cs : [{ kind: "text", text: "" }, ...cs];
        const name = who.text;
        const mine = name.trim().toLowerCase() === "me";
        const msg = h("div", mine ? "b-msg is-mine" : "b-msg");
        const first = name !== last;
        last = name;
        if (!mine) {
          const av = name ? avatar(name, "is-sm") : h("span", "b-av is-sm");
          av.classList.toggle("is-ghost", !first);
          msg.append(av);
        }
        const col = h("div", "b-msg-col");
        if (first && !mine && name) col.append(h("span", "b-msg-name", name));
        const bubble = h("div", "b-msg-bubble");
        bubble.append(...rest.map((c) => (c.kind === "text" ? document.createTextNode(c.text) : cellEl(c))));
        col.append(bubble);
        msg.append(col);
        return msg;
      }));
    },
  },

  Comment: {
    create() {
      const el = h("div", "b-comment b-panel");
      const circle = h("span", "b-av");
      const body = h("div", "b-comment-body");
      const top = h("div", "b-comment-top");
      const author = h("span", "b-comment-author");
      const time = h("span", "b-comment-time");
      top.append(author, time);
      const text = h("div", "b-comment-text");
      body.append(top, text);
      el.append(circle, body);
      return withParts(el, { circle, author, time, text });
    },
    update(el, node) {
      const author = str(node.props.author);
      setHidden(el.parts.circle, !author);
      syncAvatar(el.parts.circle, author);
      setText(el.parts.author, author);
      setOptional(el.parts.time, str(node.props.time));
      setText(el.parts.text, str(node.props.text));
    },
  },
};
