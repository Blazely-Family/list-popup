/*
 * list-popup: a list pop-up for Home Assistant dashboards that any card can
 * open with a standard `fire-dom-event` tap action.
 *
 * It holds no house logic. It draws a list that a Home Assistant helper
 * provides as an attribute: one row per item, with an icon, a name, a
 * secondary line and a "since" time. Rows are display only.
 * See README.md for the config reference.
 */

const VERSION = "0.16.2";

// Named colours match status-strip-card's pill colours; any CSS colour works too.
const COLOURS = {
  yellow: { bg: "#ffc107", fg: "#1c1d21" },
  green: { bg: "#43a047", fg: "#f1f8f1" },
  blue: { bg: "#3a7ca5", fg: "#f2f8fc" },
  red: { bg: "#db4437", fg: "#fdf1f0" },
  grey: { bg: "rgba(158, 158, 158, 0.35)", fg: "#eaebee" },
  quiet: { bg: "rgba(158, 158, 158, 0.25)", fg: "#eaebee" },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function colourOf(name) {
  if (!name) return COLOURS.quiet;
  return COLOURS[name] || { bg: name, fg: "#1c1d21" };
}

function currentHass() {
  const root = document.querySelector("home-assistant");
  return root && root.hass;
}

class ListPopup extends HTMLElement {
  open(cfg) {
    this._cfg = cfg || {};
    this._sig = null;
    this._expanded = null; // key of the row whose camera is showing
    this._sent = {}; // key -> time its action was sent
    this._presses = {}; // key -> presses of its current action (for `cycle`)
    this._lastStyle = {}; // row key -> the action style it last showed
    this._hadItems = false;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._key = (ev) => {
      if (ev.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this._key);
    // Any navigation (e.g. tapping a camera to open its page) closes the pop-up.
    this._nav = () => this.close();
    window.addEventListener("location-changed", this._nav);
    // Mount inside Home Assistant itself (where its own dialogs live), not on
    // <body>: cards such as camera players look up HA context from their
    // ancestors, and outside the app they fall back to slow snapshots.
    const ha = document.querySelector("home-assistant");
    (ha && ha.shadowRoot ? ha.shadowRoot : document.body).appendChild(this);
    this._render();
    // Follow the helper while open, so the list stays current.
    this._timer = setInterval(() => this._render(), 1000);
    // `auto_close` (seconds, default 30; 0 = never): close after that long
    // with no touch, click, scroll or key. Not while a camera row is open.
    this._touched = Date.now();
    this._poke = () => (this._touched = Date.now());
    ["pointerdown", "wheel", "touchmove", "keydown"].forEach((e) => this.addEventListener(e, this._poke, true));
    const idle = this._cfg.auto_close ?? 30;
    if (idle > 0) {
      this._idle = setInterval(() => {
        if (this._expanded) this._touched = Date.now();
        else if (Date.now() - this._touched > idle * 1000) this.close();
      }, 1000);
    }
  }

  close() {
    clearInterval(this._timer);
    clearInterval(this._idle);
    if (this._ro) this._ro.disconnect();
    this._dropCards();
    document.removeEventListener("keydown", this._key);
    window.removeEventListener("location-changed", this._nav);
    this.remove();
    if (ListPopup.current === this) ListPopup.current = null;
  }

  _items(hass) {
    const c = this._cfg;
    const st = hass.states[c.entity];
    let items = st && st.attributes[c.attribute || "items"];
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch (e) {
        items = [];
      }
    }
    return Array.isArray(items) ? items.filter((i) => i && (i.name || i.entity_id)) : [];
  }

  _keyOf(item) {
    return String(item.key || item.entity_id || item.name);
  }

  // The item's own `since` (a timestamp the helper chose), else when its entity last changed.
  _since(hass, item) {
    const st = item.entity_id && hass.states[item.entity_id];
    // An item that carries `since` (even null, for "no meaningful time") overrides the entity.
    const ts = "since" in item ? item.since : st && st.last_changed;
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const lang = (hass.locale && hass.locale.language) || undefined;
    const today = new Date().toDateString() === d.toDateString();
    const when = today
      ? d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(lang, { day: "numeric", month: "short" });
    return `since ${esc(when)}`;
  }

  // The row's action button. It disables once sent and comes back after a minute
  // if the row is still listed (the helper drops the row when the action worked).
  // The helper says what to do (`action: { service, target }`); how its button
  // looks comes from the pop-up's `actions` config, keyed by service.
  _actionButton(item, key, wide) {
    const a = item.action;
    const service = a && (a.service || a.action);
    if (!service) return "";
    // `style` (optional) names the `actions` entry to look like, e.g. "stop" for
    // a pulse that stops a moving door; it defaults to the service.
    const styleKey = a.style || service;
    const look = { ...((this._cfg.actions || {})[styleKey] || {}), ...a };
    // A new style for this row (e.g. Close → Stop) starts its count afresh.
    if (this._lastStyle[key] !== styleKey) {
      this._lastStyle[key] = styleKey;
      delete this._presses[`${key}|${styleKey}`];
      delete this._sent[`${key}|${styleKey}`];
    }
    // `cycle: [{ label, icon?, colour? }, …]`: the button stays live and its
    // look steps through the list with each press (e.g. Stop → Resume → Stop),
    // for actions where every press does the same thing (a door's pulse).
    if (Array.isArray(look.cycle) && look.cycle.length) {
      const n = (this._presses[`${key}|${styleKey}`] || 0) % look.cycle.length;
      const step = { ...look, ...look.cycle[n] };
      const c = colourOf(step.colour || "quiet");
      const txt = String(step.label || "Go").replace(/\{name\}/g, item.name || "");
      const ico = step.icon ? `<ha-icon icon="${esc(step.icon)}"></ha-icon>` : "";
      return `<button class="btn${wide ? " wide" : ""}" data-act="${esc(key)}"
        style="background:${esc(c.bg)};color:${esc(c.fg)}">${ico}<span>${esc(txt)}</span></button>`;
    }
    const sentAt = this._sent[`${key}|${styleKey}`];
    const sent = sentAt && Date.now() - sentAt < 60000;
    // `disabled_by: { field, labels }`: greyed out while the item's field is set
    // (e.g. `moving`), labelled by its value ("Opening…" / "Closing…").
    const by = look.disabled_by;
    const busyValue = by && item[by.field];
    const col = colourOf(look.colour || "quiet");
    const fill = (t) => String(t).replace(/\{name\}/g, item.name || "");
    const label = fill(
      busyValue
        ? (by.labels && by.labels[busyValue]) || String(busyValue)
        : sent ? look.busy_label || "Sent…" : look.label || "Go"
    );
    const ic = look.icon ? `<ha-icon icon="${esc(look.icon)}"></ha-icon>` : "";
    return `<button class="btn${wide ? " wide" : ""}" data-act="${esc(key)}" ${sent || busyValue || look.disabled ? "disabled" : ""}
      style="background:${esc(col.bg)};color:${esc(col.fg)}">${ic}<span>${esc(label)}</span></button>`;
  }

  // The camera card for one camera: the pop-up's `camera_card` config with every
  // "$camera" / "$title" / "$page" string replaced ($page: the camera's own
  // dashboard page, from the pop-up's `camera_pages` map), built by HA's own card helpers, so it
  // looks and behaves exactly like that card does elsewhere on the dashboard.
  async _cameraCard(cam, title) {
    const fill = (v) =>
      typeof v === "string"
        ? v
            .replace(/\$camera/g, cam)
            .replace(/\$title/g, title)
            .replace(/\$page/g, (this._cfg.camera_pages || {})[cam] || "")
        : Array.isArray(v)
          ? v.map(fill)
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
            : v;
    const config = fill(this._cfg.camera_card);
    // Load it the way a dashboard section does: HA's own <hui-card> wrapper
    // (it creates the card, handles rebuilds and visibility). Fall back to the
    // card helpers on older frontends.
    if (customElements.get("hui-card")) {
      const el = document.createElement("hui-card");
      el.config = config;
      el.hass = currentHass();
      el.preview = false;
      return el;
    }
    const helpers = await window.loadCardHelpers();
    const el = helpers.createCardElement(config);
    el.hass = currentHass();
    return el;
  }

  _camList(item) {
    return [].concat(item.cameras || item.camera || []).filter(Boolean)
      .map((c) => (typeof c === "string" ? { entity: c } : c));
  }

  // Keep the expanded row's camera cards alive across redraws (rebuilding them
  // would restart the streams): build once per expansion, then move them in.
  _placeCards(hass, item, key) {
    if (!this._cfg.camera_card) return;
    if (this._cardsKey !== key) {
      this._cardsKey = key;
      this._cards = Promise.all(
        this._camList(item).map((c) => {
          const st = hass.states[c.entity];
          return this._cameraCard(c.entity, c.title || (st && st.attributes.friendly_name) || c.entity);
        })
      );
    }
    // The cards live in the pop-up's light DOM and are shown through a <slot>,
    // so redrawing the list never detaches them (a detach restarts the stream).
    this._cards.then((els) => {
      if (this._cardsKey !== key) return;
      els.forEach((el, n) => {
        el.hass = currentHass();
        el.slot = `feed-${n}`;
        if (el.parentNode !== this) this.appendChild(el);
      });
    });
  }

  // Animate the panel's height to fit its content, growing and shrinking
  // smoothly as rows open, close, or camera cards finish loading. The height
  // carries over between redraws so a redraw never snaps it.
  _watchSize() {
    const dlg = this.shadowRoot.querySelector(".dialog");
    const rows = this.shadowRoot.querySelector(".rows");
    if (!dlg || !rows) return;
    if (this._ro) this._ro.disconnect();
    if (this._lastH) dlg.style.height = `${this._lastH}px`;
    const fit = () => {
      const head = dlg.querySelector(".head");
      const divider = dlg.querySelector(".divider");
      const cs = getComputedStyle(dlg);
      const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
      const list = dlg.querySelector(".list");
      const ls = getComputedStyle(list);
      const want =
        (head ? head.offsetHeight : 0) + (divider ? divider.offsetHeight : 0) +
        rows.offsetHeight + parseFloat(ls.paddingTop) + parseFloat(ls.paddingBottom) + chrome;
      const h = Math.min(want, window.innerHeight * 0.7);
      if (Math.abs(h - (this._lastH || 0)) < 1) return;
      this._lastH = h;
      dlg.style.height = `${h}px`;
    };
    this._ro = new ResizeObserver(() => fit());
    this._ro.observe(rows);
    requestAnimationFrame(fit);
  }

  // Slide an expanded row's body open or shut. The panel's own height
  // transition is paused meanwhile, so the panel follows the rows frame by
  // frame and everything below the row moves with it.
  _slide(el, opening, done) {
    const dlg = this.shadowRoot.querySelector(".dialog");
    this._sliding = (this._sliding || 0) + 1;
    if (dlg) dlg.style.transition = "none";
    const full = el.scrollHeight;
    Object.assign(el.style, { boxSizing: "border-box", overflow: "hidden", transition: "none",
      height: opening ? "0px" : `${full}px`, paddingBottom: opening ? "0px" : "", opacity: opening ? "0" : "1" });
    void el.offsetHeight;
    Object.assign(el.style, { transition: "height 260ms ease, padding-bottom 260ms ease, opacity 200ms ease",
      height: opening ? `${full}px` : "0px", paddingBottom: opening ? "" : "0px", opacity: opening ? "1" : "0" });
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this._sliding = Math.max(0, this._sliding - 1);
      if (dlg && !this._sliding) dlg.style.transition = "";
      if (done) return done();
      Object.assign(el.style, { boxSizing: "", overflow: "", transition: "", height: "", paddingBottom: "", opacity: "" });
    };
    el.addEventListener("transitionend", (ev) => { if (ev.target === el && ev.propertyName === "height") end(); });
    setTimeout(end, 320);
  }

  _dropCards() {
    this._cardsKey = null;
    this._cards = null;
    this.querySelectorAll('[slot^="feed-"]').forEach((el) => el.remove());
  }

  // HA's own name for an entity: the frontend's formatter where this HA has it,
  // else the entity registry's name, else the friendly name.
  _entityName(hass, id) {
    const st = hass.states[id];
    try {
      if (st && typeof hass.formatEntityName === "function") {
        const n = hass.formatEntityName(st, "entity");
        if (n) return n;
      }
    } catch (e) {
      /* fall through */
    }
    const reg = hass.entities && hass.entities[id];
    return (reg && reg.name) || (st && st.attributes.friendly_name) || id;
  }

  // The line under the name, built from the item's fields by the pop-up's
  // `secondary` config: a list of parts joined with " · ". A part is a field
  // name, or { field, unit?, prefix?, text?, map?, duration?, round? }: `text` shows when the field
  // is true; `map` translates values; otherwise prefix + value + unit. A list
  // value is joined with ", ". Without `secondary`, the item's own `secondary`.
  _secondary(hass, item) {
    const spec = this._cfg.secondary;
    if (!Array.isArray(spec)) return item.secondary || "";
    const parts = spec.map((p) => {
      const part = typeof p === "string" ? { field: p } : p || {};
      let v = item[part.field];
      if (v === undefined || v === null || v === "" || v === false) return "";
      // `names`: the field holds entity ids; show HA's own entity names (as a
      // tile under its device would, e.g. "Door"), else their friendly names.
      if (part.names) v = [].concat(v).map((id) => this._entityName(hass, id));
      if (Array.isArray(v)) v = v.filter((x) => x !== null && x !== "").join(", ");
      if (part.text !== undefined) return v ? part.text : "";
      if (part.map) v = part.map[v] ?? v;
      // `round`: decimal places for a number (e.g. 0 for a battery level).
      if (part.round !== undefined && !Number.isNaN(Number(v))) v = Number(v).toFixed(part.round);
      // `duration`: seconds shown as "14m" / "1h 5m", like the status strip timers.
      if (part.duration && !Number.isNaN(Number(v))) {
        const m = Math.max(0, Math.floor(Number(v) / 60));
        v = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
      }
      if (v === "") return "";
      return `${part.prefix ?? ""}${v}${part.unit ?? ""}`;
    });
    return parts.filter(Boolean).join(" · ");
  }

  // Without a `camera_card`, a plain HA MJPEG proxy image.
  _feed(hass, cam) {
    if (this._cfg.camera_card) return "";
    const st = hass.states[cam];
    const token = st && st.attributes.access_token;
    if (!token) return `<div class="feed off">Camera unavailable</div>`;
    return `<div class="feed"><img src="/api/camera_proxy_stream/${esc(cam)}?token=${esc(token)}" alt=""></div>`;
  }

  // HA state icons need their entity handed over as properties after each draw.
  _stateIcons(hass) {
    this.shadowRoot.querySelectorAll("ha-state-icon[data-entity]").forEach((el) => {
      el.hass = hass;
      el.stateObj = hass.states[el.dataset.entity];
    });
  }

  _run(item, key) {
    const hass = currentHass();
    const a = item.action;
    const svc = a && (a.service || a.action);
    if (!hass || !svc) return;
    const [domain, service] = String(svc).split(".");
    if (!domain || !service) return;
    // Remember per row AND service, so a new action (e.g. Stop while a gate
    // closes) is live straight away rather than greyed out by the last one.
    const styleKey = a.style || svc;
    this._sent[`${key}|${styleKey}`] = Date.now();
    this._presses[`${key}|${styleKey}`] = (this._presses[`${key}|${styleKey}`] || 0) + 1;
    hass.callService(domain, service, a.data || {}, a.target || (item.entity_id ? { entity_id: item.entity_id } : undefined));
    this._sig = null;
    this._render();
  }

  _render() {
    const hass = currentHass();
    if (!hass || !this.shadowRoot) return;
    const c = this._cfg;
    const items = this._items(hass);
    const n = items.length;
    // Close by itself once the last row has gone (e.g. the gate shut), unless told not to.
    if (n) this._hadItems = true;
    if (!n && this._hadItems && c.close_when_empty !== false) {
      this.close();
      return;
    }
    if (this._expanded && !items.some((i) => this._keyOf(i) === this._expanded)) this._expanded = null;
    const colour = colourOf(c.colour);
    // `icon_colour` colours the icons themselves (as on a quiet status strip pill);
    // rows are tinted with it, else with the chip colour.
    const iconFg = c.icon_colour || colour.fg;
    const tint = c.icon_colour || colour.bg;
    const icon = c.icon || "mdi:format-list-bulleted";
    const count = c.noun ? `${n} ${esc(c.noun)}${n === 1 ? "" : "s"}` : `${n}`;
    // As HA's own expansion panels: when any row expands, every row keeps the
    // chevron's slot, so the times line up down the list.
    const anyCams = items.some((i) => this._camList(i).length > 0);
    const rowOf = (i, groupColour) => {
        const key = this._keyOf(i);
        // A row in a coloured section takes that colour for its icon tint.
        const tintStyle = groupColour ? ` style="--c:${esc(groupColour)}"` : "";
        const st = i.entity_id && hass.states[i.entity_id];
        // Row icon: the item's own override, else HA's own icon for its entity
        // (`icon_entity`, else `entity_id`), as a tile would show it.
        const iconEntity = i.icon_entity || i.entity_id;
        const rowIcon = i.icon
          ? `<ha-icon icon="${esc(i.icon)}"></ha-icon>`
          : iconEntity && hass.states[iconEntity]
            ? `<ha-state-icon data-entity="${esc(iconEntity)}"></ha-state-icon>`
            : `<ha-icon icon="${esc(icon)}"></ha-icon>`;
        const since = c.since === false ? "" : `<div class="since">${this._since(hass, i)}</div>`;
        const name = i.name || (st && st.attributes.friendly_name) || i.entity_id;
        const secText = this._secondary(hass, i);
        const sec = secText ? `<div class="sec">${esc(secText)}</div>` : "";
        // `cameras` (or one `camera`): shown side by side when the row is expanded.
        const cams = this._camList(i);
        const open = cams.length > 0 && this._expanded === key;
        // A row with a camera expands (chevron); its action sits under the feed, so you look first.
        const right = cams.length
          ? `<ha-icon class="chev${open ? " up" : ""}" icon="mdi:chevron-down"></ha-icon>`
          : this._actionButton(i, key, false) || (anyCams ? `<span class="chev slot"></span>` : "");
        const head = `<div class="row${open ? " open" : ""}${cams.length ? " tap" : ""}"${cams.length ? ` data-view="${esc(key)}"` : ""}${tintStyle}><div class="icon">${rowIcon}</div><div class="txt"><div class="name">${esc(name)}</div>${sec}</div>${since}${right}</div>`;
        if (!open) return head;
        const feeds = cams.map((cam) => this._feed(hass, cam.entity)).join("");
        const grow = this._grow === key ? " grow" : "";
        return `${head}<div class="expand${grow}"><div class="feeds${cams.length > 1 ? " two" : ""}">${feeds}${c.camera_card ? cams.map((_, n) => `<div class="cell"><slot name="feed-${n}"></slot></div>`).join("") : ""}</div>${this._actionButton(i, key, true)}</div>`;
    };
    // `groups`: sections in the given order, each a value of the items' `group`
    // field with a title and colour: [{ value, title, colour }]. Items in no
    // listed group come last, untitled.
    // Each row (and each section title) sits in its own .item, so it can slide
    // in and out as the list changes.
    const keys = [];
    const wrap = (k, inner) => {
      keys.push(k);
      return `<div class="item" data-key="${esc(k)}">${inner}</div>`;
    };
    const itemOf = (i, groupColour) => wrap(this._keyOf(i), rowOf(i, groupColour));
    let rows;
    if (Array.isArray(c.groups) && c.groups.length) {
      const field = c.group_field || "group";
      const listed = c.groups.map((g) => g.value);
      const sections = c.groups
        .map((g) => ({ g, rows: items.filter((i) => i[field] === g.value) }))
        .filter((s) => s.rows.length)
        .map(({ g, rows: r }) => {
          const col = g.colour ? ` style="color:${esc(g.colour)}"` : "";
          const title = g.title ? wrap(`group:${g.value}`, `<div class="group"${col}>${esc(g.title)}</div>`) : "";
          return title + r.map((i) => itemOf(i, g.colour)).join("");
        });
      const rest = items.filter((i) => !listed.includes(i[field])).map((i) => itemOf(i)).join("");
      rows = sections.join("") + rest;
    } else {
      rows = items.map((i) => itemOf(i)).join("");
    }
    const link = c.link && c.link.path
      ? `<a class="link" href="${esc(c.link.path)}">${esc(c.link.label || "Show all")}</a>`
      : "";
    const body = rows || `<div class="empty">${esc(c.empty || "Nothing to show")}</div>`;
    const html = `<div class="scrim"></div>
      <div class="dialog" role="dialog" aria-modal="true" style="--c:${esc(tint)}">
        <div class="head">
          <div class="lead" style="background:${esc(colour.bg)};color:${esc(iconFg)}"><ha-icon icon="${esc(icon)}"></ha-icon></div>
          <div class="title">${esc(c.title || "")}<span class="sub"> · ${count}</span></div>
          ${link}<ha-icon class="close" icon="mdi:close"></ha-icon>
        </div>
        <div class="divider"></div>
        <div class="list"><div class="rows">${body}</div></div>
      </div>`;
    // Camera cards: drop them when their row closes; keep them current while open.
    if (this._cardsKey && this._cardsKey !== this._expanded) this._dropCards();
    if (this._cards) this._cards.then((els) => els.forEach((el) => (el.hass = hass)));
    if (html === this._sig) {
      this._stateIcons(hass);
      return;
    }
    // Rows that have left the list slide shut first, so the rows below move up
    // and the panel shrinks with them; then the list is redrawn.
    if (this._removing) return;
    const prev = [...this.shadowRoot.querySelectorAll(".item[data-key]")];
    const gone = prev.filter((el) => !keys.includes(el.dataset.key));
    if (gone.length && keys.length) {
      this._removing = true;
      let left = gone.length;
      gone.forEach((el) => this._slide(el, false, () => {
        el.remove(); // gone for good, so the redraw doesn't see it as leaving again
        if (--left) return;
        this._removing = false;
        this._sig = null;
        this._render();
      }));
      return;
    }
    const before = prev.length ? new Set(prev.map((el) => el.dataset.key)) : null;
    this._sig = html;
    this._shown = items;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${html}`;
    this._stateIcons(hass);
    const openItem = this._expanded && items.find((i) => this._keyOf(i) === this._expanded);
    if (openItem) this._placeCards(hass, openItem, this._expanded);
    this._watchSize();
    // A row just opened: slide its cameras open rather than snapping them in.
    const growing = this._grow && this.shadowRoot.querySelector(".expand.grow");
    this._grow = null;
    if (growing) this._slide(growing, true);
    // Rows new to the list slide open, pushing the rows below down.
    if (before) this.shadowRoot.querySelectorAll(".item[data-key]").forEach((el) => {
      if (!before.has(el.dataset.key)) this._slide(el, true);
    });
    this.shadowRoot.querySelector(".scrim").addEventListener("click", () => this.close());
    this.shadowRoot.querySelector(".close").addEventListener("click", () => this.close());
    // The whole row (not just its chevron) opens and closes its cameras.
    this.shadowRoot.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => {
        if (this._sliding) return;
        const next = this._expanded === b.dataset.view ? null : b.dataset.view;
        const go = () => {
          this._expanded = next;
          this._grow = next; // slide this row open once it is drawn
          this._sig = null;
          this._render();
        };
        // The open row (if any) slides shut first, so the rows below move with it.
        const open = this.shadowRoot.querySelector(".expand");
        if (open) this._slide(open, false, go);
        else go();
      })
    );
    this.shadowRoot.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = (this._shown || []).find((i) => this._keyOf(i) === b.dataset.act);
        if (item) this._run(item, b.dataset.act);
      })
    );
    const a = this.shadowRoot.querySelector(".link");
    if (a) {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.close();
        // Navigate inside HA (same as a navigate action), not a page load.
        history.pushState(null, "", this._cfg.link.path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      });
    }
  }
}

const STYLE = `
:host { position: fixed; inset: 0; z-index: 9; display: block;
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, inherit)); }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
.dialog {
  position: absolute; left: 50%; top: 12vh; transform: translateX(-50%);
  width: min(560px, calc(100vw - 32px)); max-height: 70vh; transition: height 260ms ease; display: flex; flex-direction: column;
  box-sizing: border-box; padding: 18px 0 10px; border-radius: 20px; overflow: hidden;
  color: var(--primary-text-color, #eaebee);
  /* The same surface as HA's own dialogs. */
  background: var(--list-popup-background, var(--ha-dialog-surface-background, var(--mdc-theme-surface, #1c1d21)));
  border: 1px solid var(--list-popup-border, var(--ha-card-border-color, var(--divider-color)));
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: var(--list-popup-backdrop, blur(18px));
  backdrop-filter: var(--list-popup-backdrop, blur(18px));
}
ha-icon { display: flex; line-height: 0; }
.head { display: flex; align-items: center; gap: 12px; padding: 0 20px 12px; }
.lead { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); --mdc-icon-size: 18px; }
.title { flex: 1 1 auto; font-size: 20px; font-weight: 500; }
.sub { font-size: 13px; font-weight: 400; color: var(--secondary-text-color, #a3a7b0); }
.link { flex: none; font-size: 14px; font-weight: 500; text-decoration: none; padding: 6px 10px; border-radius: 8px;
  color: var(--primary-text-color, #eaebee); background: rgba(158, 158, 158, 0.25); }
.close { cursor: pointer; color: var(--secondary-text-color, #a3a7b0); --mdc-icon-size: 22px; padding: 4px; }
.divider { height: 1px; background: var(--divider-color, rgba(255, 255, 255, 0.08)); margin: 0 20px; }
.list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 0; scrollbar-width: none; }
/* No visible scrollbar: one appearing while the panel grows would shift the rows left. */
.list::-webkit-scrollbar { display: none; }
.head, .divider { flex: none; }
.rows { display: flow-root; padding: 3px 0; }
.item { display: flow-root; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px; margin: 3px 8px; border-radius: 14px; }
.icon { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px;
  background: color-mix(in srgb, var(--c) 30%, transparent); color: color-mix(in srgb, var(--c) 88%, white); --mdc-icon-size: 22px; }
.txt { flex: 1 1 auto; min-width: 0; }
.name { font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sec { font-size: 13px; margin-top: 2px; color: var(--secondary-text-color, #a3a7b0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.since { flex: none; font-size: 13px; text-align: right; white-space: nowrap; color: var(--secondary-text-color, #a3a7b0); }
.btn { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 12px;
  border: none; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  background: rgba(158, 158, 158, 0.25); color: var(--primary-text-color, #eaebee); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  --mdc-icon-size: 18px; }
.btn.on { background: rgba(158, 158, 158, 0.45); }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn.wide { width: 100%; height: 46px; margin-top: 10px; font-size: 15px; }
.row.open { background: rgba(255, 255, 255, 0.05); border-radius: 14px 14px 0 0; margin-bottom: 0; }
.row.tap { cursor: pointer; }
.expand { margin: 0 8px 3px; padding: 0 12px 12px; background: rgba(255, 255, 255, 0.05); border-radius: 0 0 14px 14px; }
.feed { position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 9; background: #111; }
.feed img { display: block; width: 100%; height: 100%; object-fit: cover; }
.feed.off { display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color, #a3a7b0); }
.feeds { display: grid; grid-template-columns: 1fr; gap: 8px; }
.feeds.two { grid-template-columns: 1fr 1fr; }
.feeds > *, ::slotted(*) { display: block; min-width: 0; }
/* Holds a camera card's 16:9 space before it has drawn, so a row slides open to its full height. */
.cell { min-width: 0; aspect-ratio: 16 / 9; }
.chev { flex: none; width: 24px; height: 24px; cursor: pointer; padding: 4px; color: var(--secondary-text-color, #a3a7b0); --mdc-icon-size: 24px;
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1); }
.chev.up { transform: rotate(180deg); }
.chev.slot { cursor: default; }
.group { padding: 10px 20px 2px; font-size: 12px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; color: var(--secondary-text-color, #a3a7b0); }
.empty { padding: 16px 20px; color: var(--secondary-text-color, #a3a7b0); }
`;

if (!customElements.get("list-popup")) {
  customElements.define("list-popup", ListPopup);

  // Any card's `tap_action: { action: fire-dom-event, list_popup: {...} }` opens it.
  window.addEventListener("ll-custom", (ev) => {
    const cfg = ev.detail && ev.detail.list_popup;
    if (!cfg || !cfg.entity) return;
    if (ListPopup.current) ListPopup.current.close();
    const popup = document.createElement("list-popup");
    ListPopup.current = popup;
    popup.open(cfg);
  });

  console.info(`%c LIST-POPUP %c ${VERSION} `, "background:#43a047;color:#fff", "");
}
