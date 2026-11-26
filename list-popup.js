/*
 * list-popup: a list pop-up for Home Assistant dashboards that any card can
 * open with a standard `fire-dom-event` tap action.
 *
 * It holds no house logic. It draws a list that a Home Assistant helper
 * provides as an attribute: one row per item, with an icon, a name, a
 * secondary line and a "since" time. Rows are display only.
 * See README.md for the config reference.
 */

const VERSION = "0.5.0";

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
    this._hadItems = false;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._key = (ev) => {
      if (ev.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this._key);
    document.body.appendChild(this);
    this._render();
    // Follow the helper while open, so the list stays current.
    this._timer = setInterval(() => this._render(), 1000);
  }

  close() {
    clearInterval(this._timer);
    clearTimeout(this._closing);
    document.removeEventListener("keydown", this._key);
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
    const ts = item.since || (st && st.last_changed);
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const lang = (hass.locale && hass.locale.language) || undefined;
    const today = new Date().toDateString() === d.toDateString();
    const when = today
      ? d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(lang, { day: "numeric", month: "short" });
    return `since<br>${esc(when)}`;
  }

  // The row's action button. It disables once sent and comes back after a minute
  // if the row is still listed (the helper drops the row when the action worked).
  _actionButton(item, key, wide) {
    const a = item.action;
    if (!a || !a.action) return "";
    const sent = this._sent[key] && Date.now() - this._sent[key] < 60000;
    const col = colourOf(a.colour || "quiet");
    const label = sent ? a.busy_label || "Sent…" : a.label || "Go";
    const ic = a.icon ? `<ha-icon icon="${esc(a.icon)}"></ha-icon>` : "";
    return `<button class="btn${wide ? " wide" : ""}" data-act="${esc(key)}" ${sent ? "disabled" : ""}
      style="background:${esc(col.bg)};color:${esc(col.fg)}">${ic}<span>${esc(label)}</span></button>`;
  }

  _feed(hass, cam) {
    const st = hass.states[cam];
    const token = st && st.attributes.access_token;
    const label = (st && st.attributes.friendly_name) || cam;
    if (!token) return `<div class="feed off">Camera unavailable</div>`;
    // HA's own MJPEG proxy: works anywhere an <img> does, no extra card needed.
    return `<div class="feed"><img src="/api/camera_proxy_stream/${esc(cam)}?token=${esc(token)}" alt=""><span class="live">LIVE</span><span class="cam">${esc(label)}</span></div>`;
  }

  _run(item, key) {
    const hass = currentHass();
    const a = item.action;
    if (!hass || !a || !a.action) return;
    const [domain, service] = String(a.action).split(".");
    if (!domain || !service) return;
    this._sent[key] = Date.now();
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
    if (!n && this._hadItems && c.close_when_empty !== false && !this._closing) {
      this._closing = setTimeout(() => this.close(), 1500);
    }
    if (this._expanded && !items.some((i) => this._keyOf(i) === this._expanded)) this._expanded = null;
    const colour = colourOf(c.colour);
    // `icon_colour` colours the icons themselves (as on a quiet status strip pill);
    // rows are tinted with it, else with the chip colour.
    const iconFg = c.icon_colour || colour.fg;
    const tint = c.icon_colour || colour.bg;
    const icon = c.icon || "mdi:format-list-bulleted";
    const count = c.noun ? `${n} ${esc(c.noun)}${n === 1 ? "" : "s"}` : `${n}`;
    const rows = items
      .map((i) => {
        const key = this._keyOf(i);
        const st = i.entity_id && hass.states[i.entity_id];
        const ri = i.icon || (st && st.attributes.icon) || icon;
        const since = c.since === false ? "" : `<div class="since">${this._since(hass, i)}</div>`;
        const name = i.name || (st && st.attributes.friendly_name) || i.entity_id;
        const sec = i.secondary ? `<div class="sec">${esc(i.secondary)}</div>` : "";
        // `cameras` (or one `camera`): shown side by side when the row is expanded.
        const cams = [].concat(i.cameras || i.camera || []).filter(Boolean);
        const open = cams.length > 0 && this._expanded === key;
        // A row with a camera shows View; its action sits under the feed, so you look first.
        const right = cams.length
          ? `<button class="btn${open ? " on" : ""}" data-view="${esc(key)}"><ha-icon icon="${open ? "mdi:chevron-up" : "mdi:cctv"}"></ha-icon><span>${open ? "Hide" : "View"}</span></button>`
          : this._actionButton(i, key, false);
        const head = `<div class="row${open ? " open" : ""}"><div class="icon"><ha-icon icon="${esc(ri)}"></ha-icon></div><div class="txt"><div class="name">${esc(name)}</div>${sec}</div>${since}${right}</div>`;
        if (!open) return head;
        const feeds = cams.map((cam) => this._feed(hass, cam)).join("");
        return `${head}<div class="expand"><div class="feeds${cams.length > 1 ? " two" : ""}">${feeds}</div>${this._actionButton(i, key, true)}</div>`;
      })
      .join("");
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
        <div class="list">${body}</div>
      </div>`;
    if (html === this._sig) return;
    this._sig = html;
    this._shown = items;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${html}`;
    this.shadowRoot.querySelector(".scrim").addEventListener("click", () => this.close());
    this.shadowRoot.querySelector(".close").addEventListener("click", () => this.close());
    this.shadowRoot.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => {
        this._expanded = this._expanded === b.dataset.view ? null : b.dataset.view;
        this._sig = null;
        this._render();
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
  width: min(560px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column;
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
.list { overflow-y: auto; padding: 4px 0; }
.row { display: flex; align-items: center; gap: 14px; padding: 12px; margin: 6px 8px; border-radius: 14px; }
.icon { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px;
  background: color-mix(in srgb, var(--c) 30%, transparent); color: color-mix(in srgb, var(--c) 88%, white); --mdc-icon-size: 22px; }
.txt { flex: 1 1 auto; min-width: 0; }
.name { font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sec { font-size: 13px; margin-top: 2px; color: var(--secondary-text-color, #a3a7b0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.since { flex: none; font-size: 13px; text-align: right; color: var(--secondary-text-color, #a3a7b0); }
.btn { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 12px;
  border: none; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  background: rgba(158, 158, 158, 0.25); color: var(--primary-text-color, #eaebee); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  --mdc-icon-size: 18px; }
.btn.on { background: rgba(158, 158, 158, 0.45); }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn.wide { width: 100%; height: 46px; margin-top: 10px; font-size: 15px; }
.row.open { background: rgba(255, 255, 255, 0.05); border-radius: 14px 14px 0 0; margin-bottom: 0; }
.expand { margin: 0 8px 6px; padding: 0 12px 12px; background: rgba(255, 255, 255, 0.05); border-radius: 0 0 14px 14px; }
.feed { position: relative; border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 9; background: #111; }
.feed img { display: block; width: 100%; height: 100%; object-fit: cover; }
.feed.off { display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color, #a3a7b0); }
.live { position: absolute; top: 8px; left: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  padding: 2px 6px; border-radius: 6px; background: #db4437; color: #fff; }
.feeds { display: grid; grid-template-columns: 1fr; gap: 8px; }
.feeds.two { grid-template-columns: 1fr 1fr; }
.cam { position: absolute; bottom: 6px; left: 8px; right: 8px; font-size: 12px; color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
