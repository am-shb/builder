// Content: headings, text, marketing blocks, cards with pictures, people and labels.
import {
  h, str, arr, num, clampInt, setText, setHidden, setOptional, setVariant, withParts, changed,
  cells, cellEl, avatar, syncAvatar, imageBlock, imageKey, subject, icon,
} from "@renderer/components/dom.js";

/** Picture part of Hero, MediaCard, ProductCard and Image: a built-in photo (or a tinted block naming the word), rebuilt only when what it shows changes. */
function syncImage(slot, image, cls, nodeId, hideEmpty = true) {
  if (hideEmpty) setHidden(slot, !image);
  if (hideEmpty && !image) return;
  if (!changed(slot, imageKey(image, nodeId))) return;
  slot.replaceChildren(imageBlock(image, cls, nodeId));
}

function stars(rating) {
  const full = Math.floor(rating + 0.25); // 4.5 shows four stars, 4.8 five
  return "★".repeat(full) + "☆".repeat(5 - full);
}

export const CONTENT = {
  Heading: {
    create: () => h("h2", "b-heading"),
    update(el, node) {
      setText(el, str(node.props.text));
      const level = clampInt(node.props.level, 1, 3, 1);
      setVariant(el, "is-level-", String(level));
      if (el.getAttribute("aria-level") !== String(level)) el.setAttribute("aria-level", String(level));
    },
  },

  Text: {
    create: () => h("p", "b-text"),
    update(el, node) {
      setText(el, str(node.props.text));
    },
  },

  Hero: {
    create() {
      const el = h("div", "b-hero b-panel");
      const text = h("div", "b-hero-text");
      const title = h("h1", "b-hero-title");
      const subtitle = h("p", "b-hero-subtitle");
      const actions = h("div", "b-hero-actions");
      text.append(title, subtitle, actions);
      const media = h("div", "b-hero-media");
      el.append(text, media);
      return withParts(el, { title, subtitle, actions, media });
    },
    update(el, node) {
      setText(el.parts.title, str(node.props.title));
      setOptional(el.parts.subtitle, str(node.props.subtitle));
      const image = str(node.props.image);
      el.classList.toggle("has-media", !!image);
      syncImage(el.parts.media, image, "is-fill", node.id);
    },
    slot: (el) => el.parts.actions,
  },

  // "icon | title | text"; with two cells "title | text". An unknown or missing icon draws nothing.
  FeatureGrid: {
    create: () => h("div", "b-features"),
    update(el, node) {
      const items = arr(node.props.items);
      if (!changed(el, JSON.stringify(items))) return;
      el.replaceChildren(...items.map((row) => {
        const cs = cells(row);
        const [title, text] = cs.length >= 3 ? cs.slice(1) : cs;
        const item = h("div", "b-feature b-panel");
        const glyph = cs.length >= 3 ? icon(cs[0].text, 24) : null;
        if (glyph) {
          const chip = h("span", "b-feature-icon");
          chip.append(glyph);
          item.append(chip);
          item.classList.add("has-icon");
        }
        if (title) item.append(h("div", "b-feature-title", title.text));
        if (text) item.append(h("div", "b-feature-text", text.text));
        for (const extra of cs.slice(cs.length >= 3 ? 3 : 2)) item.append(cellEl(extra));
        return item;
      }));
    },
  },

  PricingTier: {
    create() {
      const el = h("div", "b-tier b-panel");
      const name = h("div", "b-tier-name");
      const price = h("div", "b-tier-price");
      const amount = h("span", "b-tier-amount");
      const period = h("span", "b-tier-period");
      price.append(amount, period);
      const features = h("ul", "b-tier-features");
      const actions = h("div", "b-tier-actions");
      el.append(name, price, features, actions);
      return withParts(el, { name, amount, period, features, actions });
    },
    update(el, node) {
      const p = node.props;
      setText(el.parts.name, str(p.name));
      setText(el.parts.amount, str(p.price));
      setOptional(el.parts.period, str(p.period));
      el.classList.toggle("is-highlighted", p.highlighted === true);
      const features = arr(p.features);
      if (changed(el.parts.features, JSON.stringify(features))) {
        el.parts.features.replaceChildren(...features.map((f) => h("li", "b-tier-feature", f)));
      }
    },
    slot: (el) => el.parts.actions,
  },

  ProductCard: {
    create() {
      const el = h("div", "b-product b-panel");
      const media = h("div", "b-product-media");
      const badge = h("span", "b-pill is-tone-accent b-product-badge");
      const pic = h("div", "b-product-pic");
      media.append(pic, badge);
      const title = h("div", "b-product-title");
      const foot = h("div", "b-product-foot");
      const price = h("span", "b-product-price");
      const rating = h("span", "b-product-rating");
      foot.append(price, rating);
      el.append(media, title, foot);
      return withParts(el, { pic, badge, title, price, rating });
    },
    update(el, node) {
      const p = node.props;
      syncImage(el.parts.pic, str(p.image), "is-fill", node.id, false);
      setOptional(el.parts.badge, str(p.badge));
      setText(el.parts.title, str(p.title));
      setText(el.parts.price, str(p.price));
      const r = num(p.rating, NaN);
      const rating = Number.isFinite(r) ? Math.min(5, Math.max(0, r)) : NaN;
      setOptional(el.parts.rating, Number.isFinite(rating) ? `${stars(rating)} ${Number(rating.toFixed(1))}` : "");
    },
  },

  MediaCard: {
    create() {
      const el = h("div", "b-media b-panel");
      const media = h("div", "b-media-pic");
      const body = h("div", "b-media-body");
      const meta = h("div", "b-media-meta");
      const title = h("div", "b-media-title");
      const text = h("div", "b-media-text");
      body.append(meta, title, text);
      el.append(media, body);
      return withParts(el, { media, meta, title, text });
    },
    update(el, node) {
      const p = node.props;
      syncImage(el.parts.media, str(p.image), "is-fill", node.id);
      setOptional(el.parts.meta, str(p.meta));
      setText(el.parts.title, str(p.title));
      setOptional(el.parts.text, str(p.text));
    },
  },

  Image: {
    create() {
      const el = h("figure", "b-image");
      const pic = h("div", "b-image-pic");
      const caption = h("figcaption", "b-image-caption");
      el.append(pic, caption);
      return withParts(el, { pic, caption });
    },
    update(el, node) {
      const image = str(node.props.image);
      syncImage(el.parts.pic, image, "is-fill", node.id, false);
      const aspect = ["wide", "square", "tall"].includes(str(node.props.aspect)) ? str(node.props.aspect) : "wide";
      setVariant(el, "is-aspect-", aspect);
      setOptional(el.parts.caption, str(node.props.label));
      const alt = str(node.props.label) || subject(image) || "Image";
      if (el.getAttribute("aria-label") !== alt) el.setAttribute("aria-label", alt);
    },
  },

  Avatar: {
    create() {
      const el = h("div", "b-avatar");
      const circle = h("span", "b-av");
      const text = h("span", "b-avatar-text");
      const name = h("span", "b-avatar-name");
      const subtitle = h("span", "b-avatar-sub");
      text.append(name, subtitle);
      el.append(circle, text);
      return withParts(el, { circle, name, subtitle });
    },
    update(el, node) {
      const name = str(node.props.name);
      syncAvatar(el.parts.circle, name);
      setText(el.parts.name, name);
      setOptional(el.parts.subtitle, str(node.props.subtitle));
    },
  },

  AvatarGroup: {
    create: () => h("div", "b-avgroup"),
    update(el, node) {
      const names = arr(node.props.names);
      if (!changed(el, JSON.stringify(names))) return;
      const shown = names.length > 5 ? names.slice(0, 4) : names;
      const kids = shown.map((n) => avatar(n));
      if (names.length > shown.length) kids.push(h("span", "b-av is-more", `+${names.length - shown.length}`));
      el.replaceChildren(...kids);
      el.setAttribute("aria-label", names.join(", "));
    },
  },

  Badge: {
    create: () => h("span", "b-badge"),
    update(el, node) {
      setText(el, str(node.props.text));
    },
  },

  Quote: {
    create() {
      const el = h("figure", "b-quote b-panel");
      const text = h("blockquote", "b-quote-text");
      const by = h("figcaption", "b-quote-by");
      const circle = h("span", "b-av");
      const who = h("span", "b-quote-who");
      const author = h("span", "b-quote-author");
      const role = h("span", "b-quote-role");
      who.append(author, role);
      by.append(circle, who);
      el.append(text, by);
      return withParts(el, { text, by, circle, author, role });
    },
    update(el, node) {
      const author = str(node.props.author);
      setText(el.parts.text, str(node.props.text));
      setHidden(el.parts.by, !author);
      syncAvatar(el.parts.circle, author);
      setText(el.parts.author, author);
      setOptional(el.parts.role, str(node.props.role));
    },
  },
};
