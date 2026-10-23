/*
 * Meticulous companion cards, styled like the machine screen / meticulous-shot-card.
 * Only the Meticulous Espresso integration is required. Optional extras, used when they exist:
 * a calendar for the maintenance log. Settings (and the log without a calendar) are kept per machine in
 * Home Assistant's frontend storage. See the README for how each card works:
 * https://github.com/cjborchert/ha-meticulous-cards
 *
 *   type: custom:meticulous-cleaning-card              # cleaning button + piston position + cleaning reminder
 *   type: custom:meticulous-shot-count-card            # shot counter with 14-day bars
 *   type: custom:meticulous-maintenance-counter-card   # shots since descale / grease
 *     calendar: calendar.home_maintenance              #   optional: log maintenance to this calendar
 *     descale_interval: 200                            #   defaults until set from the gear icon
 *     grease_interval: 100
 *   type: custom:meticulous-maintenance-effort-card    # piston friction trend, maintenance levels and forecast
 *     calendar: calendar.home_maintenance              #   optional: where "Log maintenance" adds events
 *     stroke: 76                                       #   piston stroke in mm (for the lower's speed)
 *   type: custom:meticulous-history-navigator-card     # pick a recent shot for the shot + warm-up cards
 *     count: 5                                         #   shots to look back (also set from its gear)
 *     compact: false                                   #   true: no title pill, for tight layouts
 *   prefix: meticulous_espresso                        # every card: entity id prefix of the machine
 */
const MC_VERSION = "3.5.0";

/* Settings and logs are stored per Meticulous machine, shared by everyone, in Home Assistant's own
 * frontend storage ("system data"), so the cards need no helpers, calendar or integration changes.
 * Reading works for every user; changing needs a Home Assistant admin (Home Assistant's rule).
 * Older versions kept these per user; those values are used until the machine has its own. */
const MC_STORE_KEY = "meticulous-cards";
let MC_SYS = null, MC_SYS_LOADING = null, MC_OLD_USER = {};
/* Entity of the machine by its suffix (e.g. "piston_position"): sensor.<prefix>_<suffix> or, for entities
 * Home Assistant created after the device was renamed (sensor.<new name>_<suffix>), the entity with that
 * suffix on the same device as sensor.<prefix>_state. */
const MC_FOUND = new Map();
function mcFind(hass, prefix, suffix, domain = "sensor") {
  const direct = `${domain}.${prefix}_${suffix}`;
  if (!hass || hass.states[direct]) return direct;
  const key = `${domain}|${prefix}|${suffix}`, hit = MC_FOUND.get(key);
  if (hit && hass.states[hit]) return hit;
  const ents = hass.entities || {}, dev = ents[`sensor.${prefix}_state`] && ents[`sensor.${prefix}_state`].device_id;
  if (!dev) return direct;
  const id = Object.keys(ents).find((e) => e.startsWith(`${domain}.`) && e.endsWith(`_${suffix}`) && ents[e].device_id === dev);
  if (id) MC_FOUND.set(key, id);
  return id || direct;
}
function mcMachineId(hass, prefix) {
  const ent = hass.entities && hass.entities[`sensor.${prefix}_state`];
  return (ent && ent.device_id) || prefix;          // the machine's device in Home Assistant
}
function mcStore(hass) {
  if (MC_SYS) return Promise.resolve(MC_SYS);
  if (!MC_SYS_LOADING) {
    const old = hass.callWS({ type: "frontend/get_user_data", key: MC_STORE_KEY })
      .then((r) => { MC_OLD_USER = (r && r.value) || {}; }).catch(() => {});
    const sys = hass.callWS({ type: "frontend/get_system_data", key: MC_STORE_KEY })
      .then((r) => (r && r.value) || {}).catch(() => ({}));
    MC_SYS_LOADING = Promise.all([sys, old]).then(([v]) => {
      MC_SYS = v; MC_SYS.machines = MC_SYS.machines || {};
      // keep in step with changes made on other screens
      try {
        hass.connection.subscribeMessage((msg) => {
          if (msg && msg.value) { MC_SYS = msg.value; MC_SYS.machines = MC_SYS.machines || {}; window.dispatchEvent(new Event("meticulous-store")); }
        }, { type: "frontend/subscribe_system_data", key: MC_STORE_KEY });
      } catch (e) { /* older Home Assistant */ }
      return MC_SYS;
    });
  }
  return MC_SYS_LOADING;
}
// This machine's settings (null until loaded), falling back to the older per-user values
function mcM(hass, prefix) {
  if (!MC_SYS) return null;
  const mine = MC_SYS.machines[mcMachineId(hass, prefix)] || {};
  const old = MC_OLD_USER || {};
  return Object.assign({}, { reminder: old.reminder, intervals: old.intervals, log: old.log,
    maintenance: old.effort, history_count: old.history_count }, mine);
}
// Short message for a failed save; Home Assistant only lets admins change shared settings
function mcSaveErr(e) {
  return e && (e.code === "unauthorized" || /admin|unauthori/i.test(e.message || "")) ? "ONLY AN ADMIN CAN SAVE" : "COULD NOT SAVE";
}
async function mcMSave(hass, prefix, patch) {
  await mcStore(hass);
  const id = mcMachineId(hass, prefix);
  const next = JSON.parse(JSON.stringify(MC_SYS));
  next.machines[id] = Object.assign({}, mcM(hass, prefix), patch);
  await hass.callWS({ type: "frontend/set_system_data", key: MC_STORE_KEY, value: next });   // admin only
  MC_SYS = next;
  return next.machines[id];
}
const MC_PULSE_MS = 2200; // shared pulse period for the moving piston ghost and its text

const MC = {
  blue: "#3a9bff",
  cyan: "#38e0f0",
  green: "#9dffb0",
  yellow: "#f2e66b",
  violet: "#a98bff",
  orange: "#ff5a36",
  label: "#dce9ff",
  dim: "#8fa3b8",
  grid: "#56606b",
};

const MC_BASE_CSS = `
  :host { display: block; }
  ha-card { background: #000; border-radius: 22px; padding: 16px; overflow: hidden; height: 100%;
            box-sizing: border-box; border: 1px solid #1c2530; color: ${MC.label};
            font-family: "Space Mono", "Menlo", "Consolas", ui-monospace, monospace; }
  .pill { margin: 0 auto 10px; width: fit-content; max-width: 92%; text-align: center;
          border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(4px + .05em) 18px calc(4px - .05em); font-weight: 700;
          font-size: 14px; letter-spacing: 3px; text-transform: uppercase; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; text-shadow: 0 0 6px rgba(160,200,255,.35); }
  .n { font-weight: 700; font-size: 13px; letter-spacing: 2px; color: #cfdcef; text-transform: uppercase; }
  .big { font-weight: 700; font-size: 34px; line-height: 1.05; }
  .sub { font-size: 12px; letter-spacing: 1.5px; color: ${MC.dim}; text-transform: uppercase; }
  .glow { filter: drop-shadow(0 0 3px currentColor); }
  button { all: unset; cursor: pointer; }
`;

/* Total shot count that keeps working when the integration's counter is unknown (it is only refreshed
 * after a shot, so it can stay unknown for hours after a Home Assistant restart): the last known value
 * from the recorder (or long-term statistics), plus the shots counted since from the brewing sensor. */
const MC_TOT = { base: null, extra: 0, loadedAt: 0, loading: null, brewing: null, timer: null };
async function mcTotalLoad(hass, e) {
  const end = Date.now();
  const h = await hass.callWS({
    type: "history/history_during_period", entity_ids: [e.total, e.brewing],
    start_time: new Date(end - 30 * 864e5).toISOString(), end_time: new Date(end).toISOString(),
    minimal_response: true, no_attributes: true, significant_changes_only: false,
  });
  let base = null, at = 0;
  for (const r of h[e.total] || []) {
    const v = parseFloat(r.s ?? r.state);
    if (!isNaN(v)) { base = v; at = ((r.lu || r.lc) * 1000) || 0; }
  }
  if (base === null) {
    // Nothing in the last 30 days of history: last value in long-term statistics (kept forever)
    const st = await hass.callWS({
      type: "recorder/statistics_during_period", start_time: new Date(end - 3 * 365 * 864e5).toISOString(),
      statistic_ids: [e.total], period: "day", types: ["state"],
    });
    const rows = (st[e.total] || []).filter((r) => r.state != null);
    if (rows.length) {
      const last = rows[rows.length - 1];
      base = last.state;
      at = Math.min(end, typeof last.end === "number" ? last.end : Date.parse(last.end) || end);
    }
  }
  // Shots finished after that reading (the counter updates a moment after each shot ends)
  let extra = 0, on = null, prev = null;
  for (const r of h[e.brewing] || []) {
    const s = r.s ?? r.state, t = (r.lu || r.lc) * 1000;
    if (s === "on" && prev === "off") on = t;
    else if (s === "off" && prev === "on" && on) { if (t > at) extra++; on = null; }
    if (s === "on" || s === "off") prev = s;
  }
  Object.assign(MC_TOT, { base, extra, loadedAt: Date.now() });
}

/* Call fn when the dashboard becomes visible again or the Home Assistant connection reconnects
 * (a wall tablet waking from sleep does both, and requests made right then can fail). */
function mcOnWake(card, fn) {
  if (card._wakeHooked || !card._hass) return;
  card._wakeHooked = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && card.isConnected) fn(); });
  try { card._hass.connection.addEventListener("ready", () => { if (card.isConnected) fn(); }); } catch (e) { /* older frontend */ }
}

function mcEl(tag) {
  return class extends HTMLElement {
    // Shot counter: the integration's value when it has one, otherwise the recorder-based fallback above
    _total() {
      const live = this._n(this._e.total);
      if (live !== null) return live;
      this._usesTotal = true;
      if (!this._totListen) {
        // re-run the card's own update so anything derived from the count (e.g. today's shots) follows
        this._totListen = () => { if (this._hass && this.isConnected) { this._totalSeen = undefined; this.hass = this._hass; } };
        window.addEventListener("meticulous-total", this._totListen);
      }
      const brewing = this._s(this._e.brewing);
      const shotEnded = MC_TOT.brewing === "on" && brewing === "off";
      if (brewing === "on" || brewing === "off") MC_TOT.brewing = brewing;
      const load = () => {
        if (MC_TOT.loading) return;
        MC_TOT.loading = mcTotalLoad(this._hass, this._e)
          .catch((err) => console.warn("meticulous-cards: shot count fallback failed", err))
          .finally(() => { MC_TOT.loading = null; window.dispatchEvent(new Event("meticulous-total")); });
      };
      if (shotEnded) { clearTimeout(MC_TOT.timer); MC_TOT.timer = setTimeout(load, 8000); }  // let the recorder catch up
      else if (Date.now() - MC_TOT.loadedAt > 10 * 60e3) load();
      return MC_TOT.base === null ? null : MC_TOT.base + MC_TOT.extra;
    }
    setConfig(config) {
      this._cfg = Object.assign({ prefix: "meticulous_espresso" }, this.defaults ? this.defaults() : {}, config || {});
      const p = this._cfg.prefix;
      this._e = {
        state: `sensor.${p}_state`,
        brewing: `binary_sensor.${p}_brewing`,
        total: `sensor.${p}_total_shots`,
        profile: `sensor.${p}_active_profile`,
        raise: this._cfg.raise_button || `button.${p}_home_plunger`,
        lower: this._cfg.lower_button || `button.${p}_purge`,
      };
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._built = false;
    }
    getCardSize() { return 3; }
    _n(id) { const v = parseFloat((this._hass.states[id] || {}).state); return isNaN(v) ? null : v; }
    _s(id) { return (this._hass.states[id] || {}).state; }
  };
}

/* Piston graphic in the style of the machine's "Raising" screen: a rod passing through a mint ring-shaped
 * piston, plus an optional dashed ghost ring (drawn behind the solid one). frac: 0 = top, 1 = bottom. */
function mcPistonSVG(frac, ghost, opts) {
  const o = Object.assign({ colour: MC.cyan, w: 120, h: 200, pulse: false }, opts || {});
  const cx = o.w / 2, rx = 40, ry = 12, th = 13, irx = 13, iry = 4.2;
  // Travel of about 2.3 piston widths, like the machine's screen, centred in the drawing
  const top = 44, bot = 136;
  const Y = (f) => top + Math.min(Math.max(f, 0), 1) * (bot - top);
  const ring = (y, stroke, dashed, fill) => {
    const da = dashed ? `stroke-dasharray="5 5"` : "";
    return `
      <path d="M${cx - rx},${y} L${cx - rx},${y + th} A${rx},${ry} 0 0 0 ${cx + rx},${y + th} L${cx + rx},${y}"
            fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" ${da}/>
      <ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" ${da}/>
      <ellipse cx="${cx}" cy="${y}" rx="${irx}" ry="${iry}" fill="${dashed ? "none" : "#000"}" stroke="${stroke}" stroke-width="2" ${da}/>`;
  };
  const y = Y(frac);
  const delay = `${-((Date.now() % MC_PULSE_MS) / 1000)}s`;
  let g = `<style>@keyframes pistpulse{0%,100%{opacity:1}50%{opacity:.2}} .pist-ghost.pulse{animation:pistpulse ${MC_PULSE_MS / 1000}s ease-in-out infinite; animation-delay:${delay}}</style>`;
  // 1) dashed ghost, behind everything
  if (ghost !== null && ghost !== undefined) {
    g += `<g class="pist-ghost${o.pulse ? " pulse" : ""}">${ring(Y(ghost), o.colour, true, "none")}</g>`;
  }
  // 2) static rod spanning the full travel range: from a little above the raised piston (like the machine's
  //    screen, it pokes out above the top ring) to a little below the lowered piston
  const rod = (y1, y2) => `<line x1="${cx}" x2="${cx}" y1="${y1}" y2="${y2}" stroke="${o.colour}" stroke-width="2.2" stroke-linecap="round"/>`;
  const rodTop = Y(0) - ry - 4;
  // ...and pokes out the same amount below the piston at its lowest position
  g += rod(rodTop, Y(1) + th + ry + 4);
  // 3) solid piston (opaque fill hides the ghost and the rod section inside the body)
  g += `<g>${ring(y, o.colour, false, "#06131a")}</g>`;
  // 4) rod again from its top down through the hole, so it reads as passing through the donut
  g += rod(rodTop, y + iry);
  return `<svg viewBox="0 0 ${o.w} ${o.h}" class="piston">${g}</svg>`;
}

/* "Push to purge" graphic, after the machine's own animation: a cup with an arrow rises out of a
 * stack of lines, fades out near the top and starts again from below. Same size as mcPistonSVG. */
function mcPurgeSVG(colour) {
  const c = colour || MC.cyan;
  // Fixed lines in the piston colour, getting heavier towards the bottom; the upper ones fade towards
  // the background in the middle, behind the cup, like the machine's screen.
  let lines = "", grads = "";
  for (let i = 0; i < 9; i++) {
    const k = i / 8, mid = Math.min(1, 0.04 + 1.25 * k ** 1.25);   // opacity in the middle of the line
    // wide, gradual dip centred on the line: full colour only at the very ends (flattened raised cosine)
    let stops = "";
    for (let j = 0; j <= 24; j++) {
      const x = j / 24, a = 1 - (1 - mid) * (0.5 - 0.5 * Math.cos(2 * Math.PI * x)) ** 0.45;
      stops += `<stop offset="${x.toFixed(2)}" stop-color="${c}" stop-opacity="${a.toFixed(3)}"/>`;
    }
    grads += `<linearGradient id="pgl${i}" gradientUnits="userSpaceOnUse" x1="12" x2="108" y1="0" y2="0">${stops}</linearGradient>`;
    lines += `<line x1="12" x2="108" y1="${112 + i * 8}" y2="${112 + i * 8}" stroke="url(#pgl${i})" stroke-width="${(1.3 + 1.6 * k).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 120 200" class="piston">
    <style>
      @keyframes cuprise { 0% { transform: translate(0px, 120px); opacity: 1; }
                           70% { transform: translate(0px, 72px); opacity: 1; }
                           92% { transform: translate(0px, 62px); opacity: 0; }
                           100% { transform: translate(0px, 62px); opacity: 0; } }
      .cup { animation: cuprise 2.8s cubic-bezier(.25,.6,.4,1) infinite; }
    </style>
    <defs>${grads}</defs>
    <g stroke-linecap="round">${lines}</g>
    <g class="cup" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
      <path d="M33,0 L41,46 A19,5 0 0 0 79,46 L87,0 Z" fill="#000"/>
      <ellipse cx="60" cy="0" rx="27" ry="7" fill="#000"/>
      <path d="M60,0 L60,-22 M53,-15 L60,-22 L67,-15"/>
    </g>
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Cleaning / piston card                                              */
/* ------------------------------------------------------------------ */
class MeticulousCleaningCard extends mcEl("plunger") {
  // Cleaning reminder: on/off is kept with the machine's settings (gear icon). Set reminder: false in the
  // card config to remove it completely.
  defaults() { return { reminder: true }; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  _posId() {
    const p = this._cfg.prefix;
    const id = mcFind(this._hass, p, "piston_position");
    return this._hass.states[id] ? id : null;
  }

  connectedCallback() { if (this._hass) this._loadHistory(); }

  /* Piston up/down, using only the Meticulous integration:
   *  1. the Piston Position sensor, when enabled (0 = top, ~76 = bottom)
   *  2. otherwise the last Home (raised) / Purge (lowered) state of the machine,
   *     tracked live and seeded from the recorder history when the card loads */
  _pistonUp(pos) {
    if (pos !== null) {
      const top = this._cfg.piston_top ?? 0, bottom = this._cfg.piston_bottom ?? 76;
      return (pos - top) / Math.max(bottom - top, 1) < 0.5;
    }
    return this._histUp === true;
  }

  async _loadHistory() {
    if (this._histBusy || this._posId()) return;
    this._histBusy = true;
    const id = this._e.state, end = new Date(), start = new Date(end - 30 * 864e5);
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", entity_ids: [id],
        start_time: start.toISOString(), end_time: end.toISOString(),
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const rows = (res && res[id]) || [];
      // A live Home/Purge seen while loading wins over history
      if (this._histLive === undefined) {
        for (let i = rows.length - 1; i >= 0; i--) {
          const st = rows[i].s ?? rows[i].state;
          if (st === "Home") { this._histUp = true; break; }
          if (st === "Purge") { this._histUp = false; break; }
        }
        this._key = null;
        this.hass = this._hass;
      }
    } catch (e) { /* history unavailable: assume down until a move is seen */ }
    this._histBusy = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    const machine = this._s(this._e.state) || "unavailable";
    if (machine !== this._lastMachine) {
      if (machine === "Home") { this._histUp = true; this._histLive = true; this._dirty = 0; this._cleanLive = true; }
      else if (machine === "Purge") { this._histUp = false; this._histLive = true; }
      this._lastMachine = machine;
    }
    // A shot = the integration's brewing flag switching on (works with or without "Click to Start")
    const brewing = this._s(this._e.brewing);
    if (brewing === "on" && this._lastBrewing === "off") { this._dirty = (this._dirty || 0) + 1; this._cleanLive = true; }
    if (brewing === "on" || brewing === "off") this._lastBrewing = brewing;
    if (first) { this._loadHistory(); this._loadClean(); }
    // Shot phase, so the card can say what is going on rather than echo the machine's step name
    // (profile stages like "Prebrew" or "Extraction", and the retract after a shot, before "Click to Purge")
    if (brewing === "on") this._inShot = true;
    else if (["Idle", "Click to Start", "Click to Purge", "Purge", "Finished", "Heating", "Preheating", "Starting..."].includes(machine)) this._inShot = false;
    const timer = brewing === "on" ? Math.floor(this._n(`sensor.${this._cfg.prefix}_shot_timer`) || 0) : "";
    const pid = this._posId();
    const pos = pid ? this._n(pid) : null;
    const up = this._pistonUp(pos);
    const key = `${machine}|${up}|${pos === null ? "" : Math.round(pos * 2) / 2}|${this._dirty}|${this._reminderOn()}|${this._inShot}|${timer}`;
    if (key === this._key) return;
    // A state change is drawn straight away; position-only changes (the piston moving) at most ~6x a second
    const stateKey = key.split("|").filter((_, i) => i !== 2).join("|");
    const now = Date.now();
    if (stateKey === this._stateKey && now - (this._lastDraw || 0) < 160) {
      if (!this._drawT) this._drawT = setTimeout(() => { this._drawT = null; this._key = null; this.hass = this._hass; }, 160);
      return;
    }
    clearTimeout(this._drawT); this._drawT = null;
    this._key = key; this._stateKey = stateKey; this._lastDraw = now;
    this._update(machine, up, pos);
  }

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${MC_BASE_CSS}
        .wrap { display: flex; align-items: center; justify-content: center; gap: 20px; }
        #pv { width: 84px; flex: none; }
        #pv .piston { width: 100%; height: auto; display: block; }
        .info { flex: 0 1 190px; min-width: 0; text-align: left; }
        #status { white-space: nowrap; letter-spacing: 1px; }
        .act { font-weight: 700; font-size: 20px; letter-spacing: 1px; line-height: 1.15; margin: 2px 0 6px; }
        .tap { display: block; width: 100%; box-sizing: border-box; border-radius: 16px; padding: 4px; transition: transform .1s, background .2s; }
        .tap:active { transform: scale(.97); }
        .tap.ok:hover { background: rgba(56,224,240,.06); }
        .tap.busy { cursor: not-allowed; opacity: .55; }
        .moving #act { animation: pistpulse ${MC_PULSE_MS / 1000}s ease-in-out infinite; }
        @keyframes pistpulse { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }
        .tap-wrap { position: relative; }
        .over { position: absolute; inset: 0; background: rgba(0,0,0,.93); border-radius: 16px; display: none;
                flex-direction: column; align-items: center; justify-content: center; gap: 12px; z-index: 2; }
        .over.show { display: flex; }
        .q { font-weight: 700; font-size: 16px; letter-spacing: 1px; text-align: center; line-height: 1.35; }
        .btns { display: flex; gap: 8px; }
        .b { border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(6px + .05em) 16px calc(6px - .05em); font-weight: 700; font-size: 12px; letter-spacing: 2px; }
        .b.yes { border-color: ${MC.cyan}; color: ${MC.cyan}; box-shadow: 0 0 8px rgba(56,224,240,.35); }
        .st { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
        .gear { position: absolute; top: 8px; right: 10px; width: 26px; height: 26px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center; color: ${MC.dim}; }
        .gear:hover { color: ${MC.label}; background: rgba(255,255,255,.06); }
        .gear svg { width: 18px; height: 18px; }
        .ask { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .set { display: none; flex-direction: column; align-items: center; gap: 10px; }
        .over.settings .set { display: flex; }
        .over.settings .ask, .over.settings .gear { display: none; }
        .seg { display: flex; gap: 6px; }
        .opt { border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(6px + .05em) 18px calc(6px - .05em); font-weight: 700; font-size: 12px;
               letter-spacing: 2px; color: ${MC.dim}; }
        .opt.on { border-color: ${MC.cyan}; color: #000; background: ${MC.cyan}; }
      </style>
      <ha-card>
        <div class="pill">Cleaning</div>
        <div class="tap-wrap">
          <button class="tap" id="tap">
            <div class="wrap">
              <div id="pv"></div>
              <div class="info">
                <div class="n" id="pos">Piston</div>
                <div class="act" id="act">—</div>
                <div class="sub" id="status"></div>
              </div>
            </div>
          </button>
          <div class="over" id="over">
            <button class="gear" id="gear" title="Settings"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z"/></svg></button>
            <div class="ask">
              <div class="q" id="q"></div>
              <div class="btns"><button class="b no" id="no">CANCEL</button><button class="b yes" id="yes">RAISE</button></div>
            </div>
            <div class="set">
              <div class="q">CLEANING REMINDER</div>
              <div class="seg"><button class="opt" id="opt-on">ON</button><button class="opt" id="opt-off">OFF</button></div>
              <div class="btns"><button class="b" id="back">BACK</button><button class="b yes" id="save">SAVE</button></div>
            </div>
          </div>
        </div>
      </ha-card>`;
    const r = this.shadowRoot;
    r.getElementById("tap").addEventListener("click", () => this._press());
    r.getElementById("no").addEventListener("click", (e) => { e.stopPropagation(); this._hideConfirm(); });
    r.getElementById("yes").addEventListener("click", (e) => { e.stopPropagation(); this._hideConfirm(); this._run(); });
    r.getElementById("gear").addEventListener("click", (e) => { e.stopPropagation(); this._openSettings(); });
    r.getElementById("back").addEventListener("click", (e) => { e.stopPropagation(); this._closeSettings(); });
    r.getElementById("opt-on").addEventListener("click", (e) => { e.stopPropagation(); this._draftOn = true; this._paintOpts(); });
    r.getElementById("opt-off").addEventListener("click", (e) => { e.stopPropagation(); this._draftOn = false; this._paintOpts(); });
    r.getElementById("save").addEventListener("click", (e) => { e.stopPropagation(); this._saveReminder(); });
    if (!this._cfg.reminder) r.getElementById("gear").style.display = "none";
  }

  // ---- cleaning reminder ----
  _reminderOn() {
    if (!this._cfg.reminder) return false;
    const m = mcM(this._hass, this._cfg.prefix);
    if (!m) { mcStore(this._hass).then(() => { this._key = null; this.hass = this._hass; }); return true; }
    return m.reminder !== false;
  }
  async _loadClean() {
    // Shots (brewing switching on) since the last raise (Home), from the recorder history
    const id = this._e.state, bid = this._e.brewing, end = Date.now();
    let n = 0;
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", entity_ids: [id, bid],
        start_time: new Date(end - 30 * 864e5).toISOString(), end_time: new Date(end).toISOString(),
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const t = (row) => (row.lu || row.lc || 0);
      const ev = [];
      for (const row of (res && res[id]) || []) if ((row.s ?? row.state) === "Home") ev.push([t(row), "clean"]);
      let prev = null;
      for (const row of (res && res[bid]) || []) {
        const st = row.s ?? row.state;
        if (st === "on" && prev === "off") ev.push([t(row), "shot"]);
        if (st === "on" || st === "off") prev = st;
      }
      ev.sort((a, b) => a[0] - b[0]);
      for (const [, kind] of ev) n = kind === "clean" ? 0 : n + 1;
    } catch (e) { /* no history: start counting from now */ }
    if (!this._cleanLive) this._dirty = n;   // a shot or raise seen live while loading wins
    this._key = null;
    this.hass = this._hass;
  }
  _openSettings() {
    this._draftOn = this._reminderOn();
    this._paintOpts();
    this.shadowRoot.getElementById("over").classList.add("show", "settings");
  }
  _closeSettings() {
    const o = this.shadowRoot.getElementById("over");
    o.classList.remove("settings");
    if (!this._askOpen) o.classList.remove("show");
  }
  _paintOpts() {
    const r = this.shadowRoot;
    r.getElementById("opt-on").classList.toggle("on", !!this._draftOn);
    r.getElementById("opt-off").classList.toggle("on", !this._draftOn);
  }
  async _saveReminder() {
    try {
      await mcMSave(this._hass, this._cfg.prefix, { reminder: !!this._draftOn });
    } catch (e) { console.warn("meticulous-cleaning-card", e); }
    this._hideConfirm();
    this._key = null;
    this.hass = this._hass;
  }

  _update(machine, up, pos) {
    const r = this.shadowRoot;
    const ready = ["Idle", "Click to Start", "Finished"].includes(machine) && this._s(this._e.brewing) !== "on";
    // Live position if the integration reports it (0 = top, ~76 = bottom), otherwise the last known end position
    const top = this._cfg.piston_top ?? 0, bottom = this._cfg.piston_bottom ?? 76;
    let frac = pos !== null ? (pos - top) / Math.max(bottom - top, 1) : (up ? 0 : 1);
    frac = Math.min(Math.max(frac, 0), 1);
    // After a purge the machine stays in "Purge" while it depressurizes (~20-30 s) with the piston already
    // at the bottom; only detectable with the Piston Position sensor.
    const depress = machine === "Purge" && pos !== null && frac >= 0.985;
    const moving = (machine === "Home" || machine === "Purge") && !depress;
    // Dashed ghost only while moving: the destination, pulsing
    const ghost = machine === "Home" ? 0 : machine === "Purge" && !depress ? 1 : null;
    const colour = ready || moving || depress ? MC.cyan : "#3b4a57";
    const purgeWait = machine === "Click to Purge";
    r.getElementById("pv").innerHTML = purgeWait ? mcPurgeSVG(MC.cyan) : mcPistonSVG(frac, ghost, { colour, pulse: moving });
    r.querySelector(".wrap").classList.toggle("moving", moving);
    r.getElementById("act").style.animationDelay = moving ? `${-((Date.now() % MC_PULSE_MS) / 1000)}s` : "";
    if (!ready) this._hideConfirm();

    r.getElementById("pos").textContent = purgeWait ? "Brew complete" : moving ? "Piston moving" : `Piston ${up ? "up" : "down"}`;
    let act, status, dot;
    if (purgeWait) { act = "PUSH TO PURGE"; status = "On the machine"; dot = MC.cyan; }
    else if (depress) { act = "DEPRESSURIZING"; status = "Please wait"; dot = MC.cyan; }
    else if (moving) { act = machine === "Home" ? "RAISING…" : "LOWERING…"; status = "Please wait"; dot = MC.cyan; }
    else if (ready && !up && this._reminderOn() && this._dirty > 0) {
      // Subtle reminder on the existing status line (keeps the card height unchanged)
      act = "RAISE PISTON"; status = `Clean due · ${this._dirty} shot${this._dirty === 1 ? "" : "s"}`; dot = "#ffb347";
    }
    else if (ready) { act = up ? "LOWER PISTON" : "RAISE PISTON"; status = "Tap to run"; dot = MC.green; }
    else if (machine === "unavailable" || machine === "unknown") { act = "OFFLINE"; status = "Machine not reachable"; dot = MC.grid; }
    else if (machine === "Retracting" && this._inShot) { act = "SHOT DONE"; status = "Retracting · purge next"; dot = MC.cyan; }
    else if (this._s(this._e.brewing) === "on") {
      const sec = Math.floor(this._n(`sensor.${this._cfg.prefix}_shot_timer`) || 0);
      act = "BREWING"; status = `${machine} · ${sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`}`; dot = MC.orange;
    }
    else if (["Retracting", "Water Filling", "Closing Valve"].includes(machine)) { act = "STARTING SHOT"; status = machine; dot = MC.orange; }
    else if (["Heating", "Preheating", "Starting..."].includes(machine)) { act = "HEATING"; status = machine === "Starting..." ? "Starting" : machine; dot = MC.orange; }
    else { act = "BUSY"; status = machine; dot = MC.orange; }
    r.getElementById("act").textContent = act;
    r.getElementById("status").innerHTML = `<span class="st" style="background:${dot};box-shadow:0 0 6px ${dot}"></span>${status}`;
    const tap = r.getElementById("tap");
    tap.classList.toggle("ok", ready);
    tap.classList.toggle("busy", !ready && !moving && !purgeWait && !depress);
    this._ready = ready;
    this._up = up;
  }

  // Confirm before moving the piston, except when reversing a move made in the last 2 minutes.
  _lastMove() {
    try { return JSON.parse(window.localStorage.getItem("msc-piston-last") || "null"); } catch (e) { return this._last || null; }
  }
  _press() {
    if (!this._hass) return;
    if (!this._ready) { if (this._cfg.reminder) this._openSettings(); return; }
    const dir = this._up ? "lower" : "raise";
    const last = this._lastMove();
    if (last && last.dir !== dir && Date.now() - last.t < 120000) { this._run(); return; }
    const r = this.shadowRoot;
    r.getElementById("q").textContent = `${dir.toUpperCase()} THE PISTON?`;
    r.getElementById("yes").textContent = dir.toUpperCase();
    r.getElementById("over").classList.remove("settings");
    r.getElementById("over").classList.add("show");
    this._askOpen = true;
  }
  _hideConfirm() {
    const o = this.shadowRoot.getElementById("over");
    if (o) o.classList.remove("show", "settings");
    this._askOpen = false;
  }
  _run() {
    if (!this._ready || !this._hass) return;
    const rec = { t: Date.now(), dir: this._up ? "lower" : "raise" };
    this._last = rec;
    try { window.localStorage.setItem("msc-piston-last", JSON.stringify(rec)); } catch (e) { /* ignore */ }
    // Integration buttons: Home Plunger raises, Purge lowers
    this._hass.callService("button", "press", { entity_id: rec.dir === "lower" ? this._e.lower : this._e.raise });
    this.shadowRoot.getElementById("act").textContent = "SENT…";
  }
}

/* ------------------------------------------------------------------ */
/* Shot counter card                                                   */
/* ------------------------------------------------------------------ */
class MeticulousShotCountCard extends mcEl("shots") {
  defaults() { return { days: 14 }; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    const total = this._total();
    if (total !== this._totalSeen) {
      this._totalSeen = total;
      if (!first) clearTimeout(this._t), (this._t = setTimeout(() => this._fetch(), 3000));
      this._render();
    }
    if (first) this._fetch();
  }

  connectedCallback() {
    if (this._hass && (!this._last || Date.now() - this._last > 10 * 60e3)) this._fetch();
  }

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${MC_BASE_CSS}
        .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
        .tot .big { font-size: 40px; color: ${MC.yellow}; text-shadow: 0 0 8px rgba(242,230,107,.35); }
        .stats { display: grid; grid-template-columns: repeat(2, auto); column-gap: 16px; row-gap: 2px; text-align: right; }
        .stats .v { font-weight: 700; font-size: 18px; }
        svg { display: block; width: 100%; height: auto; margin-top: 8px; }
        .lbl { fill: ${MC.dim}; font-size: 10px; font-weight: 700; letter-spacing: 1px; }
      </style>
      <ha-card>
        <div class="pill">Shots</div>
        <div class="row">
          <div class="tot"><div class="n">Total</div><div class="big" id="total">—</div></div>
          <div class="stats">
            <div class="n">Today</div><div class="n">7 days</div>
            <div class="v" id="today">—</div><div class="v" id="week">—</div>
          </div>
        </div>
        <div id="bars"></div>
      </ha-card>`;
  }

  async _fetch() {
    if (!this._hass || this._busy) return;
    this._busy = true;
    this._last = Date.now();
    try {
      const days = this._cfg.days;
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const from = new Date(midnight.getTime() - (days - 1) * 864e5);
      // Daily shot counts from long-term statistics (kept forever)
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: from.toISOString(),
        statistic_ids: [this._e.total],
        period: "day",
        types: ["change", "state"],
      });
      const rows = st[this._e.total] || [];
      const byDay = {};
      for (const r of rows) {
        const d = new Date(typeof r.start === "number" ? r.start : Date.parse(r.start));
        d.setHours(0, 0, 0, 0);
        byDay[d.getTime()] = Math.max(0, Math.round(r.change || 0));
      }
      // Today (and the current, not yet compiled hour) from the live counter vs. its value at midnight
      const h = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: midnight.toISOString(),
        entity_ids: [this._e.total],
        minimal_response: true, no_attributes: true,
      });
      const hr = (h[this._e.total] || []).map((x) => parseFloat(x.s)).filter((v) => !isNaN(v));
      const total = this._total();
      if (hr.length && total !== null) byDay[midnight.getTime()] = Math.max(0, Math.round(total - hr[0]));
      this._days = [];
      for (let i = 0; i < days; i++) {
        const t = from.getTime() + i * 864e5;
        const d = new Date(t); d.setHours(0, 0, 0, 0);
        this._days.push({ t: d.getTime(), n: byDay[d.getTime()] || 0 });
      }
    } catch (e) {
      console.warn("meticulous-shot-count-card", e);
    } finally {
      this._busy = false;
      this._render();
    }
  }

  _render() {
    const r = this.shadowRoot;
    if (!r.getElementById("total")) return;
    const total = this._total();
    r.getElementById("total").textContent = total === null ? "—" : Math.round(total);
    const days = this._days || [];
    const today = days.length ? days[days.length - 1].n : null;
    const week = days.length ? days.slice(-7).reduce((a, d) => a + d.n, 0) : null;
    r.getElementById("today").textContent = today === null ? "—" : today;
    r.getElementById("week").textContent = week === null ? "—" : week;
    if (!days.length) { r.getElementById("bars").innerHTML = ""; return; }
    const W = 300, H = 84, B = 68, T = 16;
    const max = Math.max(4, ...days.map((d) => d.n));
    const bw = W / days.length;
    const wd = ["S", "M", "T", "W", "T", "F", "S"];
    let g = "";
    for (let i = 1; i <= 2; i++) {
      const y = B - (i * (B - T)) / 2;
      g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${MC.grid}" stroke-dasharray="4 6"/>`;
    }
    days.forEach((d, i) => {
      const h = (d.n / max) * (B - T);
      const x = i * bw + bw * 0.22, w = bw * 0.56;
      const isToday = i === days.length - 1;
      g += `<rect x="${x.toFixed(1)}" y="${(B - h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, d.n ? 2 : 0).toFixed(1)}" rx="2"
              fill="${isToday ? MC.orange : MC.yellow}" opacity="${isToday ? 1 : 0.85}"/>`;
      if (d.n) g += `<text class="lbl" x="${(x + w / 2).toFixed(1)}" y="${(B - h - 3).toFixed(1)}" text-anchor="middle" style="fill:${MC.label}">${d.n}</text>`;
      g += `<text class="lbl" x="${(x + w / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle">${wd[new Date(d.t).getDay()]}</text>`;
    });
    g += `<line x1="0" x2="${W}" y1="${B}" y2="${B}" stroke="#2f7fff" stroke-width="2"/>`;
    r.getElementById("bars").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
  }
}

/* ------------------------------------------------------------------ */
/* Maintenance card (descale + grease)                                 */
/* ------------------------------------------------------------------ */
class MeticulousMaintenanceCounterCard extends mcEl("maint") {
  defaults() {
    return { calendar: "calendar.home_maintenance", descale_interval: 200, grease_interval: 100 };
  }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _interval(key) {
    // Interval: the machine's setting (gear icon), else the card config
    const m = this._hass && mcM(this._hass, this._cfg.prefix);
    const u = m && m.intervals && m.intervals[key];
    return u > 0 ? u : this._cfg[`${key}_interval`];
  }
  _hasCal() { return !!(this._cfg.calendar && this._hass && this._hass.states[this._cfg.calendar]); }

  _tasks() {
    return [
      { key: "descale", title: "Descale", summary: "Meticulous: Descale", match: /^meticulous:\s*descal/i,
        interval: this._interval("descale"), colour: MC.cyan, colour2: MC.green },
      { key: "grease", title: "Grease", summary: "Meticulous: Grease piston", match: /^meticulous:\s*greas/i,
        interval: this._interval("grease"), colour: MC.yellow, colour2: "#ffd36b" },
    ];
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    const total = this._total();
    const iv = `${this._interval("descale")}|${this._interval("grease")}`;
    if (total !== this._totalSeen || iv !== this._iv) { this._totalSeen = total; this._iv = iv; this._render(); }
    if (first) this._fetch();
  }

  connectedCallback() {
    // Pick up calendar edits: re-read every minute while the dashboard is visible,
    // and straight away when you come back to the tab/app.
    if (this._hass) this._fetch();
    clearInterval(this._poll);
    this._poll = setInterval(() => { if (document.visibilityState === "visible") this._fetch(); }, 60e3);
    if (!this._vis) {
      this._vis = () => { if (document.visibilityState === "visible" && this.isConnected) this._fetch(); };
      document.addEventListener("visibilitychange", this._vis);
    }
  }

  disconnectedCallback() {
    clearInterval(this._poll);
    if (this._vis) { document.removeEventListener("visibilitychange", this._vis); this._vis = null; }
  }

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${MC_BASE_CSS}
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .tile { display: block; width: 100%; box-sizing: border-box; text-align: center; border: 1px solid #1c2530; border-radius: 18px; padding: 10px 6px 12px;
                transition: transform .1s, background .2s; position: relative; }
        .tile:hover { background: rgba(255,255,255,.03); }
        .tile:active { transform: scale(.97); }
        svg { width: 118px; height: 118px; display: block; margin: 0 auto; }
        .num { font-weight: 700; font-size: 30px; }
        .of { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; fill: ${MC.dim}; }
        .due { font-size: 11px; letter-spacing: 1.5px; margin-top: 4px; font-weight: 700; text-transform: uppercase; }
        .over { position: absolute; inset: 0; background: rgba(0,0,0,.92); border-radius: 18px; display: none;
                flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 10px; z-index: 2; }
        .over.show { display: flex; }
        .q { font-weight: 700; font-size: 14px; letter-spacing: 1px; line-height: 1.35; }
        .btns { display: flex; gap: 8px; }
        .b { border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(6px + .05em) 14px calc(6px - .05em); font-weight: 700; font-size: 12px;
             letter-spacing: 2px; }
        .b.yes { border-color: ${MC.orange}; color: ${MC.orange}; box-shadow: 0 0 8px rgba(255,90,54,.35); }
        @keyframes pulse { 50% { opacity: .45; } }
        .overdue .ring { animation: pulse 1.6s infinite; }
        .gear { position: absolute; top: 8px; right: 10px; width: 26px; height: 26px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center; color: ${MC.dim}; }
        .gear:hover { color: ${MC.label}; background: rgba(255,255,255,.06); }
        .gear svg { width: 18px; height: 18px; margin: 0; }
        .set { display: none; flex-direction: column; align-items: center; gap: 8px; }
        .over.settings .set { display: flex; }
        .over.settings .ask { display: none; }
        .ask { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .step { display: flex; align-items: center; gap: 10px; }
        .step .pm { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid ${MC.dim}; display: flex;
                    align-items: center; justify-content: center; font-weight: 700; font-size: 20px; }
        .step .val { font-weight: 700; font-size: 28px; min-width: 70px; text-align: center; }
      </style>
      <ha-card>
        <div class="pill">Maintenance</div>
        <div class="grid" id="grid"></div>
      </ha-card>`;
    const grid = this.shadowRoot.getElementById("grid");
    for (const t of this._tasks()) {
      const el = document.createElement("div");
      el.innerHTML = `
        <button class="tile" id="tile-${t.key}">
          <div class="n">${t.title}</div>
          <svg viewBox="0 0 120 120" id="svg-${t.key}"></svg>
          <div class="due" id="due-${t.key}">—</div>
        </button>
        <div class="over" id="over-${t.key}">
          <button class="gear" title="Change interval">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z"/></svg>
          </button>
          <div class="ask">
            <div class="q" id="q-${t.key}"></div>
            <div class="btns"><button class="b no">CANCEL</button><button class="b yes">LOG</button></div>
          </div>
          <div class="set">
            <div class="q">${t.title.toUpperCase()} EVERY</div>
            <div class="step"><button class="pm minus">−</button><div class="val" id="val-${t.key}">—</div><button class="pm plus">+</button></div>
            <div class="sub">shots</div>
            <div class="btns"><button class="b back">BACK</button><button class="b yes save">SAVE</button></div>
          </div>
        </div>`;
      el.style.position = "relative";
      grid.appendChild(el);
      el.querySelector(".tile").addEventListener("click", () => this._ask(t));
      el.querySelector(".no").addEventListener("click", (e) => { e.stopPropagation(); this._close(t); });
      el.querySelector(".ask .yes").addEventListener("click", (e) => { e.stopPropagation(); this._log(t); });
      el.querySelector(".gear").addEventListener("click", (e) => { e.stopPropagation(); this._openSettings(t); });
      el.querySelector(".back").addEventListener("click", (e) => { e.stopPropagation(); this._closeSettings(t); });
      el.querySelector(".minus").addEventListener("click", (e) => { e.stopPropagation(); this._step(t, -1); });
      el.querySelector(".plus").addEventListener("click", (e) => { e.stopPropagation(); this._step(t, +1); });
      el.querySelector(".save").addEventListener("click", (e) => { e.stopPropagation(); this._saveInterval(t); });
    }
  }

  async _fetch() {
    if (!this._hass || this._busy) return;
    this._busy = true;
    this._last = Date.now();
    try {
      const start = new Date(Date.now() - 5 * 365 * 864e5).toISOString();
      const end = new Date(Date.now() + 864e5).toISOString();
      await mcStore(this._hass);
      // Calendar if there is one, otherwise the machine's own log (same shape as calendar events)
      const events = this._hasCal()
        ? await this._hass.callApi("GET",
            `calendars/${this._cfg.calendar}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
        : mcLogEvents(this._hass, this._cfg.prefix);
      this._lastDone = {};
      for (const t of this._tasks()) {
        const list = events.filter((e) => t.match.test(e.summary || ""));
        list.sort((a, b) => this._evTime(b) - this._evTime(a));
        const ev = list[0];
        if (!ev) { this._lastDone[t.key] = null; continue; }
        const when = this._evTime(ev);
        const day = this._ymd(new Date(when));
        // The stored count is only trusted if the event is still on the day it was logged.
        // If the event was moved (or entered by hand), work it out from the shot statistics.
        const m = /shot count:\s*(\d+)/i.exec(ev.description || "");
        const lg = /logged\s+(\d{4}-\d{2}-\d{2})/i.exec(ev.description || "");
        const loggedDay = lg ? lg[1] : null;
        let shots = null, est = false;
        if (m && loggedDay === day) shots = parseInt(m[1], 10);
        else if (m && !loggedDay && day === this._ymd(new Date())) shots = parseInt(m[1], 10);
        else { const r = await this._shotsAt(when); shots = r.shots; est = r.est; }
        this._lastDone[t.key] = { when, shots, est };
      }
    } catch (e) {
      console.warn("meticulous-maintenance-counter-card", e);
    } finally {
      this._busy = false;
      this._render();
    }
  }

  _evTime(ev) {
    const s = ev.start || {};
    if (s.dateTime) return Date.parse(s.dateTime);
    if (s.date) { const [y, m, d] = s.date.split("-").map(Number); return new Date(y, m - 1, d).getTime(); }
    return Date.parse(s) || 0;
  }

  _ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async _shotsAt(dayStart) {
    // Shot counter at the end of the maintenance day, from long-term statistics.
    // Before statistics began, estimate it from the average shots per day.
    const id = this._e.total;
    const total = this._total();
    const d0 = new Date(dayStart); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(d0.getTime() + 864e5);
    if (d1.getTime() > Date.now()) return { shots: total, est: false };
    try {
      const h = await this._hass.callWS({
        type: "recorder/statistics_during_period", start_time: d0.toISOString(), end_time: d1.toISOString(),
        statistic_ids: [id], period: "hour", types: ["state"],
      });
      const hr = (h[id] || []).filter((r) => r.state != null);
      if (hr.length) return { shots: Math.round(hr[hr.length - 1].state), est: false };
      const d = await this._hass.callWS({
        type: "recorder/statistics_during_period", start_time: d0.toISOString(),
        statistic_ids: [id], period: "day", types: ["state"],
      });
      const dr = (d[id] || []).filter((r) => r.state != null);
      if (!dr.length) return { shots: null, est: false };
      const t = (r) => (typeof r.start === "number" ? r.start : Date.parse(r.start));
      const first = dr[0], last = dr[dr.length - 1];
      const spanDays = Math.max(1, (t(last) - t(first)) / 864e5);
      const rate = Math.max(0, (last.state - first.state) / spanDays);
      const gapDays = Math.max(0, (t(first) - d1.getTime()) / 864e5);
      return { shots: Math.max(0, Math.round(first.state - rate * gapDays)), est: gapDays > 0.5 };
    } catch (e) { return { shots: null, est: false }; }
  }

  _render() {
    if (!this._built) return;
    const total = this._total();
    const fmt = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
    for (const t of this._tasks()) {
      const svg = this.shadowRoot.getElementById(`svg-${t.key}`);
      const due = this.shadowRoot.getElementById(`due-${t.key}`);
      const tile = this.shadowRoot.getElementById(`tile-${t.key}`);
      const done = this._lastDone ? this._lastDone[t.key] : undefined;
      const since = done && done.shots !== null && total !== null ? Math.max(0, Math.round(total - done.shots)) : null;
      const frac = since === null ? 0 : Math.min(since / t.interval, 1);
      const over = since !== null && since >= t.interval;
      const warn = since !== null && since >= t.interval * 0.85;
      const col = over ? MC.orange : warn ? "#ffb347" : t.colour;
      const R = 48, C = 2 * Math.PI * R;
      // tick marks like a dial
      let ticks = "";
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 2 * Math.PI - Math.PI / 2;
        const r1 = 57, r2 = i % 5 ? 54 : 52;
        ticks += `<line x1="${60 + r1 * Math.cos(a)}" y1="${60 + r1 * Math.sin(a)}" x2="${60 + r2 * Math.cos(a)}" y2="${60 + r2 * Math.sin(a)}" stroke="${MC.grid}" stroke-width="1.5"/>`;
      }
      svg.innerHTML = `
        <defs><linearGradient id="g-${t.key}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${over || warn ? col : t.colour2}"/></linearGradient></defs>
        ${ticks}
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="#1c2530" stroke-width="8"/>
        <circle class="ring" cx="60" cy="60" r="${R}" fill="none" stroke="url(#g-${t.key})" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"
          style="filter: drop-shadow(0 0 4px ${col})"/>
        <text x="60" y="64" text-anchor="middle" class="num" fill="${MC.label}">${since === null ? "—" : (done && done.est ? "≈" : "") + since}</text>
        <text x="60" y="82" text-anchor="middle" class="of">OF ${t.interval}</text>`;
      tile.classList.toggle("overdue", over);
      if (done === undefined) due.textContent = "…";
      else if (!done) { due.textContent = "No record · tap to log"; due.style.color = MC.dim; }
      else {
        const left = since === null ? null : t.interval - since;
        due.textContent = `Last ${fmt(done.when)} · ` + (left === null ? "" : over ? `${-left} over` : `${left} left`);
        due.style.color = over ? MC.orange : warn ? "#ffb347" : MC.dim;
      }
    }
  }

  _ask(t) {
    const total = this._total();
    this.shadowRoot.getElementById(`q-${t.key}`).innerHTML =
      `LOG ${t.title.toUpperCase()} TODAY?<br><span class="sub">at ${total === null ? "?" : Math.round(total)} shots</span>`;
    this.shadowRoot.getElementById(`over-${t.key}`).classList.add("show");
  }
  _close(t) { const o = this.shadowRoot.getElementById(`over-${t.key}`); o.classList.remove("show", "settings"); }

  _openSettings(t) {
    this._draft = this._draft || {};
    this._draft[t.key] = this._interval(t.key);
    this.shadowRoot.getElementById(`val-${t.key}`).textContent = this._draft[t.key];
    this.shadowRoot.getElementById(`over-${t.key}`).classList.add("settings");
  }
  _closeSettings(t) { this.shadowRoot.getElementById(`over-${t.key}`).classList.remove("settings"); }
  _step(t, dir) {
    const v = this._draft[t.key];
    const step = v >= 500 ? 50 : v >= 100 ? 10 : 5;
    this._draft[t.key] = Math.min(5000, Math.max(5, v + dir * step));
    this.shadowRoot.getElementById(`val-${t.key}`).textContent = this._draft[t.key];
  }
  async _saveInterval(t) {
    const v = this._draft[t.key];
    try {
      await mcMSave(this._hass, this._cfg.prefix, { intervals: Object.assign({}, (mcM(this._hass, this._cfg.prefix) || {}).intervals || {}, { [t.key]: v }) });
      this._closeSettings(t); this._close(t); this._render();
    } catch (e) {
      console.warn("meticulous-maintenance-counter-card", e);
      this.shadowRoot.getElementById(`val-${t.key}`).textContent = mcSaveErr(e) === "COULD NOT SAVE" ? "ERR" : "ADMIN";
    }
  }

  async _log(t) {
    const q = this.shadowRoot.getElementById(`q-${t.key}`);
    try {
      q.textContent = "SAVING…";
      await mcLogService(this._hass, this._cfg.prefix, this._hasCal() ? this._cfg.calendar : null, [t.key], this._total());
      q.textContent = "LOGGED ✓";
      setTimeout(() => this._close(t), 1200);
      setTimeout(() => this._fetch(), 1500);
    } catch (e) {
      q.textContent = mcSaveErr(e);
      console.warn("meticulous-maintenance-counter-card", e);
      setTimeout(() => this._close(t), 2500);
    }
  }
}

/* Log a descale and/or grease today: one all-day calendar event per kind when the calendar exists,
 * otherwise in the machine's own log. Used by the maintenance card and the piston effort card. */
const MC_SERVICE_NAMES = { descale: "Meticulous: Descale", grease: "Meticulous: Grease piston" };
async function mcLogService(hass, prefix, calendar, kinds, total) {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date(), d0 = ymd(today), d1 = ymd(new Date(today.getTime() + 864e5));
  const hm = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
  const shots = total === null || total === undefined ? null : Math.round(total);
  for (const kind of kinds) {
    if (calendar && hass.states[calendar]) {
      await hass.callService("calendar", "create_event", {
        summary: MC_SERVICE_NAMES[kind],
        description: `Meticulous shot count: ${shots === null ? "unknown" : shots}\nLogged ${d0} ${hm} from the Home Assistant dashboard. If you move this event, the card recalculates the count for the new date.`,
        start_date: d0, end_date: d1,
      }, { entity_id: calendar });
    } else {
      await mcStore(hass);
      const log = ((mcM(hass, prefix) || {}).log || []).concat([{ kind, date: d0, time: hm, shots }]);
      await mcMSave(hass, prefix, { log });
    }
  }
}

/* The machine's own maintenance log, shaped like calendar events so the cards read it the same way. */
function mcLogEvents(hass, prefix) {
  const names = { descale: "Meticulous: Descale", grease: "Meticulous: Grease piston" };
  return (((hass && mcM(hass, prefix)) || {}).log || []).map((e) => ({
    summary: names[e.kind] || e.kind,
    description: `Meticulous shot count: ${e.shots === null || e.shots === undefined ? "unknown" : e.shots}\nLogged ${e.date}${e.time ? ` ${e.time}` : ""}`,
    start: { date: e.date },
  }));
}

/* ------------------------------------------------------------------ */
/* Piston effort trend card (friction / maintenance)                   */
/* ------------------------------------------------------------------ */
class MeticulousMaintenanceEffortCard extends mcEl("effort") {
  defaults() { return { calendar: "calendar.home_maintenance", stroke: 76 }; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  /* Two repeatable piston moves (see README-meticulous-cards.md):
   *  lower      = manual lower (Purge from Idle), measured by the integration once per move
   *  retraction = the full-power retraction right after every shot (Piston After-Shot sensors) */
  static get MOVES() {
    return [
      { key: "lower", label: "Lower", hint: "Manual lower from idle",
        ids: { current: ["piston_lower_avg_current", "plunger_lower_avg_current"],
               speed: ["piston_lower_duration", "plunger_lower_duration"] } },   // speed = stroke / duration
      { key: "retraction", label: "Retraction", hint: "Post-shot retraction, every shot",
        ids: { current: ["piston_after_shot_current"], speed: ["piston_after_shot_speed"] } },
    ];
  }
  static get METRICS() {
    return [
      { key: "current", label: "Current", colour: MC.blue, unit: " A", u: "A", dp: 2 },
      { key: "speed", label: "Speed", colour: MC.violet, unit: " mm/s", u: "mm/s", dp: 2 },
    ];
  }
  static get RANGES() { return [["15D", 15], ["30D", 30], ["90D", 90], ["6M", 182], ["1Y", 365]]; }
  static get LEVELS() {
    return { ok: { label: "OK", colour: MC.green }, soon: { label: "Maintenance soon", colour: "#ffb347" },
             due: { label: "Maintenance due", colour: MC.orange } };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._loadPrefs();
    if (!this._built) this._build();
    if (first) mcStore(hass).then(() => this._fetch());
    if (first) window.addEventListener("meticulous-store", () => { if (this.isConnected) this._fetch(); });
    mcOnWake(this, () => { if (this._failed || !this._last || Date.now() - this._last > 10 * 60e3) this._fetch(); });
    // Refetch shortly after a new measurement arrives (either move)
    const stamp = ["lower", "retraction"].map((m) => { const st = hass.states[this._entity(m, "current").id]; return st ? st.last_updated : ""; }).join("|");
    if (stamp !== this._stamp) {
      if (this._stamp !== undefined) { clearTimeout(this._t); this._t = setTimeout(() => this._fetch(), 4000); }
      this._stamp = stamp;
    }
  }

  connectedCallback() {
    if (this._hass && (!this._last || Date.now() - this._last > 10 * 60e3)) this._fetch();
  }

  // Entity for a move/metric: first one that exists (integration naming or the older local patch naming)
  _entity(move, metric) {
    const m = MeticulousMaintenanceEffortCard.MOVES.find((x) => x.key === (move || this._move));
    const key = metric || this._metric;
    const ids = m.ids[key].map((slug) => mcFind(this._hass, this._cfg.prefix, slug));
    const id = ids.find((x) => this._hass && this._hass.states[x]) || ids[0];
    // the lower's speed comes from its duration over the full stroke
    const xform = m.key === "lower" && key === "speed" ? (v) => (v > 0 ? this._cfg.stroke / v : NaN) : (v) => v;
    return { id, xform };
  }

  _loadPrefs() {
    this._move = "retraction"; this._metric = "current"; this._range = 90;
    try {
      const p = JSON.parse(window.localStorage.getItem("msc-effort-prefs") || "{}");
      if (MeticulousMaintenanceEffortCard.MOVES.some((m) => m.key === p.move)) this._move = p.move;
      else if (p.move === "aftershot") this._move = "retraction";
      else if (p.move) this._move = "lower";                       // older "raise"/"lower" choices
      if (MeticulousMaintenanceEffortCard.METRICS.some((m) => m.key === p.metric)) this._metric = p.metric;
      if (MeticulousMaintenanceEffortCard.RANGES.some((r) => r[1] === p.range)) this._range = p.range;
    } catch (e) { /* ignore */ }
  }
  _savePrefs() {
    try { window.localStorage.setItem("msc-effort-prefs", JSON.stringify({ move: this._move, metric: this._metric, range: this._range })); } catch (e) { /* ignore */ }
  }

  // Maintenance levels and the measure they are based on (per machine)
  _settings() {
    const u = ((this._hass && mcM(this._hass, this._cfg.prefix)) || {}).maintenance || {};
    // default: the retraction (every shot) when its sensor exists, else the manual lower
    const has = (m) => this._hass && this._hass.states[this._entity(m, "current").id];
    const auto = has("retraction") || !has("lower") ? "retraction" : "lower";
    return { basis: u.basis || this._cfg.basis || auto, levels: u.levels || {} };
  }

  _build() {
    this._built = true;
    const gear = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z"/></svg>`;
    this.shadowRoot.innerHTML = `
      <style>${MC_BASE_CSS}
        ha-card { position: relative; }
        .seg { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; margin: 4px 0 6px; }
        .seg button { border: 1.5px solid #2a3542; border-radius: 9999px; padding: calc(4px + .05em) 12px calc(4px - .05em); font-weight: 700;
                      font-size: 12px; letter-spacing: 2px; color: ${MC.dim}; text-transform: uppercase; }
        .seg button.on { color: #000; background: var(--c, ${MC.cyan}); border-color: var(--c, ${MC.cyan});
                         box-shadow: 0 0 8px var(--c, ${MC.cyan}); }
        .hint { text-align: center; margin-bottom: 4px; }
        #chart { touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
        svg { display: block; width: 100%; height: auto; }
        .ax { fill: ${MC.dim}; font-weight: 700; font-size: 11px; letter-spacing: 1px; }
        .legend .cap { grid-column: 2 / -1; margin-top: 4px; font-size: 11px; letter-spacing: 1px; color: ${MC.dim}; text-transform: uppercase; }
        .ax.tl { font-size: 15px; fill: ${MC.label}; stroke: #000; stroke-width: 4px; paint-order: stroke; stroke-linejoin: round; }
        .legend { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; margin-top: 6px; }
        .legend .n { font-size: 11px; letter-spacing: 1.5px; white-space: nowrap; }
        .legend .v { font-weight: 700; font-size: 18px; margin-top: 2px; white-space: nowrap; }
        .msg { text-align: center; padding: 34px 8px; color: ${MC.dim}; font-size: 13px; letter-spacing: 2px; line-height: 1.6; }
        .key { display: flex; justify-content: center; gap: 4px 8px; margin-top: 8px; flex-wrap: wrap; }
        .key span { font-size: 11px; letter-spacing: .5px; color: ${MC.dim}; font-weight: 700; white-space: nowrap; }
        .key i { display: inline-block; width: 10px; height: 0; border-top: 2px dashed; vertical-align: middle; margin-right: 4px; }
        .svc { margin-top: 10px; border-top: 1px solid #1c2530; padding-top: 10px; }
        .svc .top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
        .svc .st { flex: 1 0 auto; font-weight: 700; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; }
        .svc .st .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
        .svc .b { margin-left: auto; letter-spacing: 1.5px; }
        .svc .sub { margin-top: 6px; }
        .b { border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(6px + .05em) 14px calc(6px - .05em); font-weight: 700;
             font-size: 12px; letter-spacing: 2px; white-space: nowrap; }
        .b.yes { border-color: ${MC.orange}; color: ${MC.orange}; box-shadow: 0 0 8px rgba(255,90,54,.35); }
        .gear { position: absolute; top: 14px; right: 14px; width: 26px; height: 26px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center; color: ${MC.dim}; z-index: 1; }
        .gear:hover { color: ${MC.label}; background: rgba(255,255,255,.06); }
        .gear svg { width: 18px; height: 18px; }
        .over { position: absolute; inset: 0; background: #000; border-radius: 22px; display: none; z-index: 2;
                flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; text-align: center; }
        .over.show { display: flex; }
        .q { font-weight: 700; font-size: 14px; letter-spacing: 1px; line-height: 1.4; }
        .btns { display: flex; gap: 8px; justify-content: center; }
        .step { display: flex; align-items: center; gap: 10px; justify-content: center; }
        .step .pm { width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid ${MC.dim}; display: flex;
                    align-items: center; justify-content: center; font-weight: 700; font-size: 20px; }
        .step .val { font-weight: 700; font-size: 24px; min-width: 96px; text-align: center; }
        .grp { display: flex; flex-direction: column; gap: 6px; align-items: center; }
      </style>
      <ha-card>
        <div class="pill">Piston effort</div>
        <button class="gear" id="gear" title="Maintenance levels">${gear}</button>
        <div class="seg" id="moves"></div>
        <div class="seg" id="metrics"></div>
        <div class="sub hint" id="hint"></div>
        <div id="chart"></div>
        <div class="legend" id="legend"></div>
        <div class="key" id="key">
          <span id="kTrend"><i style="border-color:${MC.label}"></i>Trend</span>
          <span id="kSoon"><i style="border-color:#ffb347"></i>Soon</span>
          <span id="kDue"><i style="border-color:${MC.orange}"></i>Due</span>
          <span id="kDescale"><i style="border-color:${MC.cyan}"></i>Descale</span>
          <span id="kGrease"><i style="border-color:${MC.yellow}"></i>Grease</span>
        </div>
        <div class="seg" id="ranges" style="margin-top:10px"></div>
        <div class="svc">
          <div class="top"><div class="st" id="svcSt">—</div><button class="b" id="logBtn">LOG MAINTENANCE</button></div>
          <div class="sub" id="svcEta"></div>
        </div>
        <div class="over" id="setOver">
          <div class="grp"><div class="q">PREDICT FROM</div><div class="seg" id="setBasis"></div></div>
          <div class="grp"><div class="q" style="color:#ffb347">MAINTENANCE SOON AT</div>
            <div class="step"><button class="pm" data-k="soon" data-d="-1">−</button><div class="val" id="vSoon">—</div><button class="pm" data-k="soon" data-d="1">+</button></div></div>
          <div class="grp"><div class="q" style="color:${MC.orange}">MAINTENANCE DUE AT</div>
            <div class="step"><button class="pm" data-k="due" data-d="-1">−</button><div class="val" id="vDue">—</div><button class="pm" data-k="due" data-d="1">+</button></div></div>
          <div class="sub" id="setNote"></div>
          <div class="sub" id="setSug" style="margin-top:-6px"></div>
          <div class="btns"><button class="b" id="setBack">BACK</button><button class="b yes" id="setSave">SAVE</button></div>
        </div>
        <div class="over" id="logOver">
          <div class="q" id="logQ">WHAT DID YOU DO TODAY?</div>
          <div class="seg" id="logKinds"></div>
          <div class="sub" id="logWhere"></div>
          <div class="btns"><button class="b" id="logBack">CANCEL</button><button class="b yes" id="logSave">LOG</button></div>
        </div>
      </ha-card>`;
    const r = this.shadowRoot;
    this._chart = r.getElementById("chart");
    this._renderButtons();
    r.getElementById("gear").addEventListener("click", () => this._openSettings());
    r.getElementById("setBack").addEventListener("click", () => r.getElementById("setOver").classList.remove("show"));
    r.getElementById("setSave").addEventListener("click", () => this._saveSettings());
    r.querySelectorAll("#setOver .pm").forEach((b) => b.addEventListener("click", () => this._stepLevel(b.dataset.k, +b.dataset.d)));
    r.getElementById("logBtn").addEventListener("click", () => this._openLog());
    r.getElementById("logBack").addEventListener("click", () => r.getElementById("logOver").classList.remove("show"));
    r.getElementById("logSave").addEventListener("click", () => this._logService());
    const host = this._chart;
    const move = (ev) => {
      const svg = host.querySelector("svg"); if (!svg || !this._geom || !this._pts || !this._pts.length) return;
      const g = this._geom, b = svg.getBoundingClientRect();
      const px = ((ev.clientX - b.left) / b.width) * g.W;
      const t = g.t0 + ((px - g.L) / (g.R - g.L)) * (g.t1 - g.t0);
      let best = 0, bd = Infinity;
      this._pts.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = i; } });
      this._sel = best;
      if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this._updateCursor(); });
    };
    host.addEventListener("pointerdown", (ev) => { this._drag = true; try { host.setPointerCapture(ev.pointerId); } catch (e) {} move(ev); });
    host.addEventListener("pointermove", (ev) => { if (this._drag || ev.pointerType === "mouse") move(ev); });
    const stop = () => { this._drag = false; };
    host.addEventListener("pointerup", stop); host.addEventListener("pointercancel", stop);
  }

  _renderButtons() {
    const r = this.shadowRoot;
    const metric = MeticulousMaintenanceEffortCard.METRICS.find((x) => x.key === this._metric);
    const mk = (id, items, cur, onPick, colour) => {
      const el = r.getElementById(id); el.innerHTML = "";
      for (const [val, label] of items) {
        const b = document.createElement("button");
        b.textContent = label; b.className = val === cur ? "on" : "";
        b.style.setProperty("--c", colour);
        b.addEventListener("click", () => onPick(val));
        el.appendChild(b);
      }
    };
    mk("moves", MeticulousMaintenanceEffortCard.MOVES.map((m) => [m.key, m.label]), this._move, (v) => { this._move = v; this._changed(); }, MC.label);
    mk("metrics", MeticulousMaintenanceEffortCard.METRICS.map((m) => [m.key, m.label]), this._metric, (v) => { this._metric = v; this._changed(); }, metric.colour);
    mk("ranges", MeticulousMaintenanceEffortCard.RANGES.map(([l, d]) => [d, l]), this._range, (v) => { this._range = v; this._changed(); }, MC.dim);
    const mv = MeticulousMaintenanceEffortCard.MOVES.find((x) => x.key === this._move);
    r.getElementById("hint").textContent = mv ? mv.hint : "";
  }

  _changed() { this._savePrefs(); this._renderButtons(); this._fetch(); }

  // ---------- data ----------
  // One value per move: exact values from recent history, older ones from long-term statistics (hourly means)
  async _series(move, metric, start, end) {
    const { id, xform } = this._entity(move, metric);
    const h = await this._hass.callWS({
      type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false,
      include_start_time_state: false,      // only real measurements, not the value carried over to the start
    });
    const hist = (h[id] || []).map((x) => ({ t: (x.lu || x.lc) * 1000, v: parseFloat(x.s) })).filter((p) => !isNaN(p.v) && p.t >= start);
    const histStart = hist.length ? hist[0].t : end;
    const old = [];
    if (histStart - start > 864e5) {
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(), end_time: new Date(histStart).toISOString(),
        statistic_ids: [id], period: "hour", types: ["mean"],
      });
      let prev = null;
      for (const r of st[id] || []) {
        if (r.mean == null) continue;
        const v = Math.round(r.mean * 1000) / 1000;
        if (v !== prev) old.push({ t: typeof r.start === "number" ? r.start : Date.parse(r.start), v });
        prev = v;
      }
    }
    // de-duplicate repeated identical states (restarts re-publish the same value)
    const pts = []; let prev = null;
    for (const p of old.concat(hist)) { if (prev === null || p.v !== prev.v || p.t - prev.t > 6 * 3600e3) pts.push(p); prev = p; }
    return pts.map((p) => ({ t: p.t, v: xform(p.v) })).filter((p) => isFinite(p.v));
  }

  /* Descale / grease markers from the calendar, or from the machine's own log when there is no calendar.
   * All-day events count from midday, unless the card logged them: then from the time they were logged
   * (as long as the event wasn't moved to another day), so shots earlier that day stay in the old cycle. */
  async _markers(start, end) {
    const marks = [];
    try {
      await mcStore(this._hass);
      const hasCal = this._cfg.calendar && this._hass.states[this._cfg.calendar];
      const ev = hasCal ? await this._hass.callApi("GET",
        `calendars/${this._cfg.calendar}?start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(new Date(end).toISOString())}`)
        : mcLogEvents(this._hass, this._cfg.prefix);
      for (const e of ev) {
        const s = e.summary || "";
        const kind = /^meticulous:\s*descal/i.test(s) ? "descale" : /^meticulous:\s*greas/i.test(s) ? "grease" : null;
        if (!kind) continue;
        const st = e.start || {};
        const lg = /logged\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/i.exec(e.description || "");
        const t = st.dateTime ? Date.parse(st.dateTime)
          : st.date ? (() => {
            const [y, m, d] = st.date.split("-").map(Number);
            return lg && lg[1] === st.date ? new Date(y, m - 1, d, +lg[2], +lg[3]).getTime() : new Date(y, m - 1, d, 12).getTime();
          })() : null;
        if (t && t >= start && t <= end) marks.push({ t, kind });
      }
    } catch (e) { /* calendar optional */ }
    return marks.sort((a, b) => a.t - b.t);
  }

  // Shots per day over the last 30 days, from the shot counter's long-term statistics
  async _shotsPerDay() {
    try {
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period", start_time: new Date(Date.now() - 30 * 864e5).toISOString(),
        statistic_ids: [this._e.total], period: "day", types: ["change"],
      });
      const rows = (st[this._e.total] || []).filter((r) => r.change != null);
      if (!rows.length) return null;
      return rows.reduce((a, r) => a + Math.max(0, r.change), 0) / 30;
    } catch (e) { return null; }
  }

  async _fetch() {
    if (!this._hass) return;
    const token = (this._token = (this._token || 0) + 1);
    this._last = Date.now();
    const end = Date.now(), start = end - this._range * 864e5;
    let pts = [], marks = [], pred = null, cycles = [], failed = false;
    try {
      // maintenance in the last year; the data is read from the start of the first cycle in view
      const year = await this._markers(end - 365 * 864e5, end);
      const bounds = [...new Set(year.map((m) => m.t))].sort((a, b) => a - b);
      const before = bounds.filter((b) => b <= start);
      const from = before.length ? before[before.length - 1] : bounds.length ? end - 365 * 864e5 : end - 60 * 864e5;
      const full = await this._series(this._move, this._metric, Math.min(start, from), end);
      pts = full.filter((q) => q.t >= start);
      marks = year.filter((m) => m.t >= start);
      cycles = this._cycles(full, bounds, from, end);
      this._marksYear = bounds.length;
      pred = await this._predict();
    } catch (e) {
      console.warn("meticulous-maintenance-effort-card", e);
      failed = true;
    }
    if (token !== this._token) return; // a newer fetch started
    clearTimeout(this._retryT);
    this._failed = failed;
    if (failed) {
      // Couldn't reach the history (e.g. the tablet just woke up): keep what we had and try again soon
      this._retries = (this._retries || 0) + 1;
      this._retryT = setTimeout(() => this._fetch(), Math.min(60e3, 5e3 * 2 ** (this._retries - 1)));
      if (this._pts && this._pts.length) return;
    } else this._retries = 0;
    this._pts = pts; this._marks = marks; this._pred = pred; this._cycles_ = cycles; this._sel = pts.length - 1;
    this._t0 = start; this._t1 = end;
    this._render();
  }

  // ---------- maintenance prediction ----------
  // Smoothed level: 7-day median for the retraction (one value per shot), median of the last 3 lowers
  _level(move, pts) {
    const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    if (!pts.length) return null;
    if (move === "retraction") { const tl = pts[pts.length - 1].t; return med(pts.filter((p) => p.t >= tl - 7 * 864e5).map((p) => p.v)); }
    return med(pts.slice(-3).map((p) => p.v));
  }
  _baseLevel(move, pts) {
    const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    if (!pts.length) return null;
    if (move === "retraction") { const t0 = pts[0].t; return med(pts.filter((p) => p.t <= t0 + 7 * 864e5).map((p) => p.v)); }
    return med(pts.slice(0, 3).map((p) => p.v));
  }
  /* Suggested levels until the user sets their own, relative to the level right after the last maintenance:
   * retraction +30 % / +50 % (it rose ~55 % over a full maintenance cycle), lower +10 % / +15 % (it rises about a
   * quarter as fast). Rounded to 0.05 A. */
  static get SUGGEST() { return { retraction: [1.3, 1.5], lower: [1.1, 1.15] }; }
  _levelsFor(basis, base) {
    const saved = this._settings().levels[basis] || {};
    const [fs, fd] = MeticulousMaintenanceEffortCard.SUGGEST[basis];
    const r5 = (v) => Math.round(v * 20) / 20;
    return {
      soon: saved.soon ?? (base ? r5(base * fs) : null),
      due: saved.due ?? (base ? r5(base * fd) : null),
      suggested: saved.soon == null || saved.due == null,
    };
  }

  async _predict(basisOverride) {
    const basis = basisOverride || this._settings().basis;
    const end = Date.now();
    const marks = await this._markers(end - 365 * 864e5, end);
    const lastService = marks.length ? marks[marks.length - 1].t : null;
    const start = lastService ?? end - 60 * 864e5;
    if (!this._hass.states[this._entity(basis, "current").id]) return { basis, enough: false, missing: true, n: 0, lastService };
    const pts = await this._series(basis, "current", start, end);
    const shotsPerDay = await this._shotsPerDay();
    if (pts.length < 3) {
      const saved = this._settings().levels[basis] || {};          // levels you set still show on the chart
      return { basis, enough: false, n: pts.length, lastService, soon: saved.soon ?? null, due: saved.due ?? null };
    }
    const level = this._level(basis, pts), base = this._baseLevel(basis, pts);
    const lv = this._levelsFor(basis, base);
    const fit = pts.length >= 5 && pts[pts.length - 1].t - pts[0].t >= 3 * 864e5 ? this._fit(pts) : null;
    const slope = fit ? fit.perMonth / 30 : null;                     // A per day
    let status = "ok";
    if (lv.due != null && level >= lv.due) status = "due"; else if (lv.soon != null && level >= lv.soon) status = "soon";
    let days = null;
    if (status !== "due" && slope && slope > 0 && lv.due != null) days = (lv.due - level) / slope;
    return { basis, enough: true, level, base, ...lv, status, days, shots: days != null && shotsPerDay ? days * shotsPerDay : null,
             slope, lastService, n: pts.length };
  }

  _renderService() {
    const r = this.shadowRoot, p = this._pred;
    const st = r.getElementById("svcSt"), eta = r.getElementById("svcEta");
    const mvName = (k) => (k === "lower" ? "Lower" : "Retraction");
    if (!p) { st.innerHTML = "—"; eta.textContent = ""; return; }
    if (p.missing) {
      const noMachine = !this._hass.states[this._e.state];
      st.innerHTML = `<span class="dot" style="background:${MC.grid}"></span>No forecast`; st.style.color = "";
      eta.textContent = noMachine ? "Machine not found" : p.basis === "lower" ? "Needs the integration's Piston Lower sensors" : "Needs the integration's Piston After-Shot sensors";
      return;
    }
    if (!p.enough) {
      const when = p.lastService ? new Date(p.lastService).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase() : null;
      st.innerHTML = `<span class="dot" style="background:${p.lastService ? MC.green : MC.grid}"></span>${p.lastService ? `Maintained ${when}` : "Not enough data"}`;
      st.style.color = "";
      eta.textContent = `${mvName(p.basis)}: ${p.n} of 3 measurements ${p.lastService ? "since then" : "so far"}`; return;
    }
    const L = MeticulousMaintenanceEffortCard.LEVELS[p.status];
    st.innerHTML = `<span class="dot" style="background:${L.colour};box-shadow:0 0 6px ${L.colour}"></span>${L.label}`;
    st.style.color = p.status === "ok" ? "" : L.colour;
    const lvl = `${mvName(p.basis)} ${p.level.toFixed(2)} A`;
    let txt;
    if (p.status === "due") txt = `${lvl} · due level ${p.due.toFixed(2)} A reached`;
    else if (p.days == null) txt = `${lvl} · ${p.slope != null && p.slope <= 0 ? "not rising" : "no trend yet"}`;
    else {
      const d = Math.max(0, Math.round(p.days));
      const s = p.shots != null ? ` · ~${Math.max(0, Math.round(p.shots))} shots` : "";
      txt = `${lvl} · due in ~${d > 365 ? ">365" : d} day${d === 1 ? "" : "s"}${d > 365 ? "" : s}`;
    }
    eta.textContent = txt;
  }

  // ---------- settings ----------
  _openSettings() {
    const r = this.shadowRoot, s = this._settings();
    this._draft = { basis: s.basis, levels: JSON.parse(JSON.stringify(s.levels)) };
    this._predAll = { [s.basis]: this._pred };
    this._paintSettings();
    r.getElementById("setOver").classList.add("show");
    // levels right after the last maintenance for both moves, for the suggestions and the note
    for (const m of MeticulousMaintenanceEffortCard.MOVES) {
      if (this._predAll[m.key]) continue;
      this._predict(m.key).then((p) => { this._predAll[m.key] = p; if (r.getElementById("setOver").classList.contains("show")) this._paintSettings(); }).catch(() => {});
    }
  }
  _draftLevels() {
    const d = this._draft, saved = d.levels[d.basis] || {};
    const p = (this._predAll || {})[d.basis] || null;
    const r5 = (v) => Math.round(v * 20) / 20;
    const base = p && p.base ? p.base : null;
    const [fs, fd] = MeticulousMaintenanceEffortCard.SUGGEST[d.basis];
    return { soon: saved.soon ?? (base ? r5(base * fs) : 1.3), due: saved.due ?? (base ? r5(base * fd) : 1.5) };
  }
  _paintSettings() {
    const r = this.shadowRoot, d = this._draft;
    const el = r.getElementById("setBasis"); el.innerHTML = "";
    for (const m of MeticulousMaintenanceEffortCard.MOVES) {
      const b = document.createElement("button");
      b.textContent = m.label; b.className = m.key === d.basis ? "on" : ""; b.style.setProperty("--c", MC.label);
      b.addEventListener("click", () => { d.basis = m.key; this._paintSettings(); });
      el.appendChild(b);
    }
    const lv = this._draftLevels();
    r.getElementById("vSoon").textContent = `${lv.soon.toFixed(2)} A`;
    r.getElementById("vDue").textContent = `${lv.due.toFixed(2)} A`;
    const pa = (this._predAll || {})[d.basis], p = pa && pa.enough ? pa : null;
    r.getElementById("setNote").textContent = p
      ? `Now ${p.level.toFixed(2)} A · after maintenance ${p.base.toFixed(2)} A`
      : pa && pa.missing ? "No sensor for this move"
      : pa && pa.lastService ? "Too few measurements since the last maintenance" : "Too few measurements yet";
    const saved = d.levels[d.basis] || {}, [fs, fd] = MeticulousMaintenanceEffortCard.SUGGEST[d.basis];
    r.getElementById("setSug").textContent = saved.soon == null || saved.due == null
      ? `Suggested: +${Math.round((fs - 1) * 100)} % / +${Math.round((fd - 1) * 100)} % of the level after maintenance` : "";
    // Only admins can change the machine's shared settings
    const admin = !this._hass.user || this._hass.user.is_admin;
    r.querySelectorAll("#setOver .pm, #setBasis button").forEach((b) => { b.disabled = !admin; b.style.opacity = admin ? "" : ".4"; });
    r.getElementById("setSave").style.display = admin ? "" : "none";
    r.getElementById("setBack").textContent = admin ? "BACK" : "CLOSE";
    if (!admin) r.getElementById("setSug").textContent = "Only a Home Assistant admin can change these";
  }
  _stepLevel(k, dir) {
    const d = this._draft, lv = this._draftLevels();
    lv[k] = Math.max(0.05, Math.round((lv[k] + dir * 0.01) * 100) / 100);
    if (k === "soon" && lv.soon > lv.due) lv.due = lv.soon;
    if (k === "due" && lv.due < lv.soon) lv.soon = lv.due;
    d.levels[d.basis] = { soon: lv.soon, due: lv.due };
    this._paintSettings();
  }
  async _saveSettings() {
    const d = this._draft, lv = this._draftLevels();
    d.levels[d.basis] = { soon: lv.soon, due: lv.due };
    try {
      await mcMSave(this._hass, this._cfg.prefix, { maintenance: { basis: d.basis, levels: d.levels } });
    } catch (e) {
      this.shadowRoot.getElementById("setNote").textContent = mcSaveErr(e) === "COULD NOT SAVE" ? "Could not save" : "Only a Home Assistant admin can change these";
      return;
    }
    this.shadowRoot.getElementById("setOver").classList.remove("show");
    this._fetch();
  }

  // ---------- log maintenance ----------
  _openLog() {
    const r = this.shadowRoot;
    this._logSel = new Set();
    const el = r.getElementById("logKinds"); el.innerHTML = "";
    for (const [k, label, c] of [["descale", "Descaled", MC.cyan], ["grease", "Greased", MC.yellow]]) {
      const b = document.createElement("button");
      b.textContent = label; b.style.setProperty("--c", c);
      b.addEventListener("click", () => { this._logSel.has(k) ? this._logSel.delete(k) : this._logSel.add(k); b.className = this._logSel.has(k) ? "on" : ""; });
      el.appendChild(b);
    }
    r.getElementById("logQ").textContent = "WHAT DID YOU DO TODAY?";
    const cal = this._cfg.calendar && this._hass.states[this._cfg.calendar];
    const admin = !this._hass.user || this._hass.user.is_admin;
    const blocked = !cal && !admin;          // without a calendar the log is a shared setting
    r.getElementById("logWhere").textContent = cal
      ? `Adds an event to ${cal.attributes.friendly_name || this._cfg.calendar}`
      : blocked ? "No calendar set up, and only a Home Assistant admin can log without one"
      : "Saved with this machine's settings (no calendar set up)";
    r.getElementById("logSave").style.display = blocked ? "none" : "";
    r.getElementById("logBack").textContent = blocked ? "CLOSE" : "CANCEL";
    r.getElementById("logOver").classList.add("show");
  }
  async _logService() {
    const r = this.shadowRoot, q = r.getElementById("logQ");
    if (!this._logSel || !this._logSel.size) { q.textContent = "PICK DESCALED, GREASED OR BOTH"; return; }
    q.textContent = "SAVING…";
    try {
      await mcLogService(this._hass, this._cfg.prefix, this._cfg.calendar, [...this._logSel], this._total());
      q.textContent = "LOGGED ✓";
      setTimeout(() => { r.getElementById("logOver").classList.remove("show"); this._fetch(); }, 1200);
    } catch (e) {
      console.warn("meticulous-maintenance-effort-card", e);
      q.textContent = mcSaveErr(e);
    }
  }

  /* Maintenance cycles of the shown move and measure: the stretches between descales/greases. Each gets its
   * own trend, fitted over the whole cycle (not just the visible part), so the trend lines and the legend's
   * change and trend don't move when the time range changes. Without any logged maintenance in the last
   * year, the current cycle is the last 60 days, the same window the forecast uses. The stretch before the
   * first logged maintenance gets no trend: its start is unknown and it may hide an unlogged cleaning. */
  _cycles(full, bounds, from, end) {
    const edges = [from, ...bounds.filter((b) => b > from && b < end), end];
    const out = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i], b = edges[i + 1], last = i === edges.length - 2;
      const pts = full.filter((q) => q.t >= a && (last ? q.t <= b : q.t < b));
      const c = { from: a, to: b, pts, base: null, level: null, change: null, fit: null, perMonth: null };
      const known = i > 0 || bounds.includes(a) || !bounds.length;
      if (known && pts.length >= 3) {
        c.base = this._baseLevel(this._move, pts); c.level = this._level(this._move, pts);
        c.change = c.base ? ((c.level - c.base) / Math.abs(c.base)) * 100 : null;
      }
      if (known && pts.length >= 5 && pts[pts.length - 1].t - pts[0].t >= 3 * 864e5) {
        c.fit = this._fit(pts);
        c.perMonth = c.fit && c.base ? (c.fit.perMonth / Math.abs(c.base)) * 100 : null;
      }
      out.push(c);
    }
    return out;
  }

  // ---------- chart ----------
  _fit(pts) {
    if (pts.length < 3) return null;
    const x0 = pts[0].t, xs = pts.map((p) => (p.t - x0) / 864e5), ys = pts.map((p) => p.v);
    const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0; xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
    if (!sxx) return null;
    const b = sxy / sxx, a = my - b * mx;
    return { at: (t) => a + b * ((t - x0) / 864e5), perMonth: b * 30, mean: my };
  }

  _render() {
    const r = this.shadowRoot;
    this._renderService();
    const metric = MeticulousMaintenanceEffortCard.METRICS.find((x) => x.key === this._metric);
    const pts = this._pts || [];
    const legend = r.getElementById("legend");
    if (!pts.length) {
      this._geom = null;
      const st = this._hass && this._hass.states;
      const noMachine = st && !st[this._e.state];
      const noSensor = st && !st[this._entity().id];
      const msg = (a, b) => `<div class="msg">${a}<br><span style="font-size:11px">${b}</span></div>`;
      this._chart.innerHTML = this._failed || !this._pts ? msg("LOADING…", "Waiting for Home Assistant history")
        : noMachine ? msg("MACHINE NOT FOUND", `No sensor.${this._cfg.prefix}_state. Set <b>prefix:</b> in the card to your machine's entity prefix.`)
        : noSensor ? (this._move === "retraction"
          ? msg("NO RETRACTION DATA", "Needs the integration's Piston After-Shot sensors.")
          : msg("NO LOWER DATA", "Needs the integration's Piston Lower sensors."))
        : this._range < 365 ? msg("NOTHING IN THIS RANGE", "No measurements in this period. Try a longer range.")
        : msg("NO MEASUREMENTS YET", this._move === "retraction" ? "One is recorded after every shot." : "One is recorded each time you lower the piston from idle.");
      legend.innerHTML = ""; r.getElementById("key").style.display = "none"; return;
    }
    const W = 600, H = 260, L = 46, R = 588, T = 18, B = 222;
    const t0 = this._t0, t1 = this._t1;
    // maintenance levels as lines when showing the current of the move the prediction uses
    const p = this._pred;
    const showLv = p && (p.soon != null || p.due != null) && this._metric === "current" && this._move === p.basis;
    let lo = Math.min(...pts.map((q) => q.v)), hi = Math.max(...pts.map((q) => q.v));
    if (showLv) { if (p.soon != null) { lo = Math.min(lo, p.soon); hi = Math.max(hi, p.soon); } if (p.due != null) { lo = Math.min(lo, p.due); hi = Math.max(hi, p.due); } }
    const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.03, 0.01); lo -= pad; hi += pad;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (R - L);
    const y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const gy = T + (i * (B - T)) / 4, val = hi - (i * (hi - lo)) / 4;
      g += `<line x1="${L}" x2="${R}" y1="${gy}" y2="${gy}" stroke="${MC.grid}" stroke-dasharray="6 8"/>`;
      g += `<text class="ax" x="${L - 6}" y="${gy + 4}" text-anchor="end">${val.toFixed(metric.dp)}</text>`;
    }
    const fmt = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
    for (let i = 0; i <= 3; i++) { const t = t0 + (i * (t1 - t0)) / 3; g += `<text class="ax" x="${x(t)}" y="${B + 18}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}">${fmt(t)}</text>`; }
    if (showLv) {
      for (const [v, c, lbl] of [[p.soon, "#ffb347", "SOON"], [p.due, MC.orange, "DUE"]]) {
        if (v == null) continue;
        g += `<line x1="${L}" x2="${R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${c}" stroke-width="1.6" stroke-dasharray="10 6" opacity=".9"/>`;
        g += `<text class="ax" x="${L + 4}" y="${(y(v) - 4).toFixed(1)}" style="fill:${c}">${lbl}</text>`;
      }
    }
    // descale (D, cyan) and grease (G, yellow) markers; both on the same day share one two-colour line
    const byT = new Map();
    for (const m of this._marks || []) if (m.t >= t0 && m.t <= t1) byT.set(m.t, (byT.get(m.t) || new Set()).add(m.kind));
    for (const [t, kinds] of byT) {
      const both = kinds.size > 1, xs = x(t).toFixed(1);
      [...kinds].sort().forEach((k, i) => {
        const c = k === "descale" ? MC.cyan : MC.yellow;
        g += `<line x1="${xs}" x2="${xs}" y1="${T - 6}" y2="${B}" stroke="${c}" stroke-width="2" stroke-dasharray="${both ? "3 13" : "3 5"}" stroke-dashoffset="${both ? -8 * i : 0}" opacity=".9"/>`;
        g += `<text class="ax" x="${(x(t) + (both ? (i ? 5 : -5) : 0)).toFixed(1)}" y="${T - 8}" text-anchor="middle" style="fill:${c}">${k === "descale" ? "D" : "G"}</text>`;
      });
    }
    g += `<line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="#2f7fff" stroke-width="2.5"/>`;
    // a trend line per maintenance cycle (fitted over the whole cycle), cut to the visible part,
    // labelled with its change per month when there is room
    const cycles = this._cycles_ || [], cyc = cycles[cycles.length - 1];
    let drewTrend = false;
    for (const c of cycles) {
      if (!c.fit) continue;
      const a = Math.max(c.pts[0].t, t0), b = c.pts[c.pts.length - 1].t;
      if (b <= a) continue;
      drewTrend = true;
      g += `<line x1="${x(a).toFixed(1)}" y1="${y(c.fit.at(a)).toFixed(1)}" x2="${x(b).toFixed(1)}" y2="${y(c.fit.at(b)).toFixed(1)}" stroke="${MC.label}" stroke-width="2" stroke-dasharray="8 6" opacity=".8"/>`;
      if (c.perMonth != null && x(b) - x(a) >= 60) {
        const lx = Math.max(L + 40, Math.min(R - 40, (x(a) + x(b)) / 2)), ly = Math.max(T + 14, Math.min(B - 6, y(c.fit.at((a + b) / 2)) - 14));
        g += `<text class="ax tl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${c.perMonth >= 0 ? "+" : ""}${c.perMonth.toFixed(1)}%/mo</text>`;
      }
    }
    // Smoothed line: a 7-day running median when there is a point per shot, otherwise a running median of
    // 3 consecutive measurements (manual lowers happen about once a day). Medians ignore one-off outliers.
    const dense = pts.length > 40;
    const med = (a) => { const s = a.slice().sort((p1, p2) => p1 - p2); return s[Math.floor(s.length / 2)]; };
    const line = pts.map((q, i) => ({
      t: q.t,
      v: dense ? med(pts.filter((z) => Math.abs(z.t - q.t) <= 3.5 * 864e5).map((z) => z.v))
        : pts.length >= 3 ? med(pts.slice(Math.max(0, Math.min(i - 1, pts.length - 3)), Math.max(0, Math.min(i - 1, pts.length - 3)) + 3).map((z) => z.v)) : q.v,
    }));
    this._line = line; this._dense = dense;
    g += `<path d="${line.map((q, i) => `${i && q.t - line[i - 1].t < 7 * 864e5 ? "L" : "M"}${x(q.t).toFixed(1)},${y(q.v).toFixed(1)}`).join("")}" fill="none" stroke="${metric.colour}" stroke-opacity="${dense ? 1 : 0.6}" stroke-width="${dense ? 2.5 : 2}"/>`;
    for (const q of pts) g += dense
      ? `<circle cx="${x(q.t).toFixed(1)}" cy="${y(q.v).toFixed(1)}" r="2" fill="${metric.colour}" opacity=".45"/>`
      : `<circle cx="${x(q.t).toFixed(1)}" cy="${y(q.v).toFixed(1)}" r="4" fill="${metric.colour}"/>`;
    g += `<line id="cl" y1="${T - 4}" y2="${B + 2}" stroke="${MC.orange}" stroke-width="3"/><circle id="cp" r="7" fill="none" stroke="${MC.orange}" stroke-width="2.5"/>`;
    this._geom = { W, L, R, T, B, t0, t1, x, y };
    this._chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    // legend: latest (smoothed for the retraction), then the change and trend of the current maintenance
    // cycle: from the level right after the last descale/grease to now (same for every range)
    const latest = dense ? line[line.length - 1].v : pts[pts.length - 1].v;
    const pct = (v, suf = "") => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%${suf}`);
    const ch = cyc ? cyc.change : null;
    // more current = worse; for speed, slower = worse
    const worse = ch == null ? 0 : this._metric === "speed" ? -ch : ch;
    const chCol = ch == null ? MC.dim : worse > 10 ? MC.orange : worse > 5 ? "#ffb347" : MC.green;
    const fromTxt = cyc ? new Date(cyc.from).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    legend.innerHTML = `
      <div><div class="n" id="selT">${dense ? "7-day median" : "Latest"}</div><div class="v" id="selV" style="color:${metric.colour}">${latest.toFixed(metric.dp)}${metric.unit}</div></div>
      <div><div class="n">Change</div><div class="v" style="color:${chCol}">${pct(ch)}</div></div>
      <div><div class="n">Trend</div><div class="v"${cyc && cyc.perMonth == null ? ` style="color:${MC.dim}"` : ""}>${pct(cyc && cyc.perMonth, "/mo")}</div></div>
      <div class="cap">${!cyc ? "" : this._marksYear ? `Since maintenance ${fromTxt}` : "Over the last 60 days"}</div>`;
    // key: only what is on the chart
    const marksIn = (this._marks || []).filter((m) => m.t >= t0 && m.t <= t1);
    const show = { key: true, kTrend: drewTrend, kSoon: showLv && p.soon != null, kDue: showLv && p.due != null,
                   kDescale: marksIn.some((m) => m.kind === "descale"), kGrease: marksIn.some((m) => m.kind === "grease") };
    show.key = Object.values(show).slice(1).some(Boolean);
    for (const [id, on] of Object.entries(show)) r.getElementById(id).style.display = on ? "" : "none";
    this._updateCursor();
  }

  _updateCursor() {
    const g = this._geom, pts = this._pts; if (!g || !pts || !pts.length) return;
    const p = pts[Math.min(Math.max(this._sel ?? pts.length - 1, 0), pts.length - 1)];
    const svg = this._chart.querySelector("svg"); if (!svg) return;
    const cx = g.x(p.t), cy = g.y(p.v);
    const cl = svg.querySelector("#cl"), cp = svg.querySelector("#cp");
    cl.setAttribute("x1", cx); cl.setAttribute("x2", cx); cp.setAttribute("cx", cx); cp.setAttribute("cy", cy);
    const metric = MeticulousMaintenanceEffortCard.METRICS.find((x) => x.key === this._metric);
    const idx = pts.indexOf(p), isLast = idx === pts.length - 1;
    const sm = this._line && this._line[idx] ? this._line[idx].v : p.v;
    const selT = this.shadowRoot.getElementById("selT"), selV = this.shadowRoot.getElementById("selV");
    if (selT) selT.textContent = isLast ? (this._dense ? "7-day median" : "Latest")
      : new Date(p.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
    // retraction: the 7-day median at that moment (single shots scatter); lower: the measured value
    if (selV) selV.textContent = `${(this._dense ? sm : p.v).toFixed(metric.dp)}${metric.unit}`;
  }
}

/* ------------------------------------------------------------------ */
/* Shot history selector: pick which shot the shot / warm-up cards show */
/* ------------------------------------------------------------------ */
/* Talks to meticulous-shot-card and meticulous-heatup-card on the same page through
 * window.__mscSel and a "meticulous-shot-select" event. Without this card they show the latest shot. */
function mcWhen(ms) {
  const d = new Date(ms), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  if (now - d < 6 * 864e5) return `${d.toLocaleDateString("en", { weekday: "short" }).toUpperCase()} ${hm}`;
  return d.toLocaleDateString("en", { day: "numeric", month: "short" }).toUpperCase();
}
function mcDur(sec) {
  const s = Math.round(sec);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

class MeticulousHistoryNavigatorCard extends mcEl("history") {
  defaults() { return { count: 5, days: 14, compact: false,
    live_states: ["Starting...", "Heating", "Preheating", "Click to Start"] }; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }
  getCardSize() { return this._cfg && this._cfg.compact ? 2 : 3; }

  _count() {
    const u = this._hass && (mcM(this._hass, this._cfg.prefix) || {}).history_count;
    return Math.max(1, Math.min(20, u > 0 ? u : this._cfg.count));
  }
  _isLive() {
    const st = this._s(this._e.state), b = this._s(this._e.brewing);
    return b === "on" || this._cfg.live_states.includes(st);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    const live = this._isLive(), brewing = this._s(this._e.brewing) === "on";
    if (first) { this._idx = 0; mcStore(hass).then(() => this._fetch()); }
    mcOnWake(this, () => { if (this._retries || !this._last || Date.now() - this._last > 10 * 60e3) this._fetch(); });
    // A new warm-up or shot always brings the cards back to the latest / live view
    if (live && !this._wasLive && this._idx) { this._idx = 0; this._broadcast(); }
    if (this._wasBrewing && !brewing) { clearTimeout(this._t); this._t = setTimeout(() => { this._idx = 0; this._fetch(); }, 6000); }
    const key = `${live}|${this._s(this._e.state)}`;
    if (live !== this._wasLive || key !== this._key) { this._key = key; this._render(); }
    this._wasLive = live; this._wasBrewing = brewing;
  }

  connectedCallback() {
    if (this._hass && this._shots) this._broadcast();
    if (this._hass && (!this._last || Date.now() - this._last > 10 * 60e3)) this._fetch();
  }
  disconnectedCallback() {
    // Without the selector the other cards go back to showing the latest shot
    if (window.__mscSel && window.__mscSel.owner === this) {
      window.__mscSel = null;
      window.dispatchEvent(new CustomEvent("meticulous-shot-select", { detail: { index: 0, shot: null } }));
    }
  }

  async _fetch() {
    if (!this._hass || this._busy) return;
    this._busy = true;
    this._last = Date.now();
    try {
      const end = Date.now(), start = end - this._cfg.days * 864e5;
      const ids = [this._e.brewing, this._e.profile];
      const h = await this._hass.callWS({
        type: "history/history_during_period", entity_ids: ids,
        start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const rows = (id) => (h[id] || []).map((r) => ({ s: r.s ?? r.state, t: (r.lu || r.lc) * 1000 }));
      // Shots = clean off -> on -> off cycles of the brewing sensor (same rule as the shot card)
      const shots = [];
      let on = null, prev = null;
      for (const r of rows(this._e.brewing)) {
        if (r.s === "on" && prev === "off") on = r.t;
        else if (r.s === "off" && prev === "on" && on) { shots.push({ start: on, end: r.t }); on = null; }
        if (r.s === "on" || r.s === "off") prev = r.s;
      }
      const prof = rows(this._e.profile).filter((r) => r.s && r.s !== "unavailable" && r.s !== "unknown");
      for (const s of shots) {
        let p = "";
        for (const r of prof) { if (r.t <= s.start + 2000) p = r.s; else break; }
        s.profile = p;
      }
      this._shots = shots.reverse();   // newest first: index 0 = latest
      this._idx = Math.min(this._idx || 0, Math.max(0, this._list().length - 1));
      this._broadcast();
      this._retries = 0;
    } catch (e) {
      console.warn("meticulous-history-navigator-card", e);
      this._retries = (this._retries || 0) + 1;
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => this._fetch(), Math.min(60e3, 5e3 * 2 ** (this._retries - 1)));
    } finally {
      this._busy = false;
      this._render();
    }
  }
  _list() { return (this._shots || []).slice(0, this._count()); }

  _broadcast() {
    const list = this._list(), shot = list[this._idx] || null;
    window.__mscSel = { active: true, owner: this, index: this._idx, total: list.length,
      shot: shot ? { start: shot.start, end: shot.end, profile: shot.profile } : null };
    window.dispatchEvent(new CustomEvent("meticulous-shot-select", { detail: window.__mscSel }));
  }

  _go(i) {
    const n = this._list().length;
    if (!n || this._isLive()) return;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === this._idx) return;
    this._idx = i;
    this._broadcast();
    this._render();
  }

  _build() {
    this._built = true;
    const gear = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z"/></svg>`;
    const c = this._cfg.compact;
    this.shadowRoot.innerHTML = `
      <style>${MC_BASE_CSS}
        ha-card { position: relative; ${c ? "padding: 10px 14px;" : ""} }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .arrow { width: 40px; height: 40px; border-radius: 50%; border: 1.5px solid ${MC.dim}; flex: none;
                 display: flex; align-items: center; justify-content: center; color: ${MC.label}; }
        .arrow svg { width: 22px; height: 22px; }
        .arrow:hover { background: rgba(255,255,255,.05); }
        .arrow.off { opacity: .25; pointer-events: none; }
        .mid { flex: 1; min-width: 0; text-align: center; }
        .when { font-weight: 700; font-size: 20px; letter-spacing: 1px; white-space: nowrap; }
        .when.live { color: ${MC.orange}; }
        .mid .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
        .dots { display: flex; justify-content: center; gap: 8px; margin-top: ${c ? 6 : 10}px; flex-wrap: wrap; }
        .dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid ${MC.dim}; box-sizing: border-box; }
        .dot.on { background: ${MC.cyan}; border-color: ${MC.cyan}; box-shadow: 0 0 6px rgba(56,224,240,.5); }
        .dots.off .dot.on { background: transparent; border-color: ${MC.dim}; box-shadow: none; }
        .gear { position: absolute; top: ${c ? 8 : 14}px; right: 12px; width: 26px; height: 26px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center; color: ${MC.dim}; z-index: 1; }
        .gear:hover { color: ${MC.label}; background: rgba(255,255,255,.06); }
        .gear svg { width: 18px; height: 18px; }
        .over { position: absolute; inset: 0; background: #000; border-radius: 22px; display: none;
                flex-direction: column; align-items: center; justify-content: center; gap: ${c ? 8 : 14}px; z-index: 2; }
        .line { display: flex; align-items: center; gap: 14px; }
        .over.show { display: flex; }
        .q { font-weight: 700; font-size: 14px; letter-spacing: 1px; }
        .btns { display: flex; gap: 8px; }
        .b { border: 1.5px solid ${MC.dim}; border-radius: 9999px; padding: calc(6px + .05em) 14px calc(6px - .05em); font-weight: 700; font-size: 12px; letter-spacing: 2px; }
        .b.yes { border-color: ${MC.orange}; color: ${MC.orange}; box-shadow: 0 0 8px rgba(255,90,54,.35); }
        .step { display: flex; align-items: center; gap: 10px; }
        .step .pm { width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid ${MC.dim}; display: flex;
                    align-items: center; justify-content: center; font-weight: 700; font-size: 20px; }
        .step .val { font-weight: 700; font-size: 26px; min-width: 44px; text-align: center; }
      </style>
      <ha-card>
        ${c ? "" : `<div class="pill">Shot history</div>`}
        <button class="gear" id="gear" title="Settings">${gear}</button>
        <div class="row" ${c ? `style="margin-right: 30px"` : ""}>
          <button class="arrow" id="older" title="Older shot"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>
          <div class="mid"><div class="when" id="when">—</div><div class="sub" id="what"></div></div>
          <button class="arrow" id="newer" title="Newer shot"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg></button>
        </div>
        <div class="dots" id="dots"></div>
        <div class="over" id="over">
          <div class="line">
            <div class="q">LOOK BACK</div>
            <div class="step"><button class="pm" id="minus">−</button><div class="val" id="val">5</div><button class="pm" id="plus">+</button></div>
            <div class="q">SHOTS</div>
          </div>
          <div class="btns"><button class="b" id="back">BACK</button><button class="b yes" id="save">SAVE</button></div>
        </div>
      </ha-card>`;
    const r = this.shadowRoot;
    r.getElementById("older").addEventListener("click", () => this._go(this._idx + 1));
    r.getElementById("newer").addEventListener("click", () => this._go(this._idx - 1));
    r.getElementById("dots").addEventListener("click", (e) => { const i = e.target && e.target.dataset && e.target.dataset.i; if (i !== undefined) this._go(+i); });
    r.getElementById("gear").addEventListener("click", () => { this._draft = this._count(); this._paintDraft(); r.getElementById("over").classList.add("show"); });
    r.getElementById("back").addEventListener("click", () => r.getElementById("over").classList.remove("show"));
    r.getElementById("minus").addEventListener("click", () => { this._draft = Math.max(1, this._draft - 1); this._paintDraft(); });
    r.getElementById("plus").addEventListener("click", () => { this._draft = Math.min(20, this._draft + 1); this._paintDraft(); });
    r.getElementById("save").addEventListener("click", async () => {
      r.getElementById("over").classList.remove("show");
      try { await mcMSave(this._hass, this._cfg.prefix, { history_count: this._draft }); } catch (e) { console.warn("meticulous-history-navigator-card: only an admin can change this", e); }
      this._idx = Math.min(this._idx, Math.max(0, this._list().length - 1));
      this._broadcast();
      this._render();
    });
  }
  _paintDraft() { this.shadowRoot.getElementById("val").textContent = this._draft; }

  _render() {
    const r = this.shadowRoot;
    if (!r.getElementById("when")) return;
    const list = this._list(), live = this._isLive(), n = list.length;
    const when = r.getElementById("when"), what = r.getElementById("what");
    when.classList.toggle("live", live);
    if (live) {
      const brewing = this._s(this._e.brewing) === "on";
      when.textContent = "● LIVE";
      what.textContent = brewing ? (this._s(this._e.profile) || "Shot running") : "Warming up";
    } else if (!this._shots) { when.textContent = "…"; what.textContent = ""; }
    else if (!n) { when.textContent = "NO SHOTS"; what.textContent = `in the last ${this._cfg.days} days`; }
    else {
      const s = list[this._idx];
      when.textContent = `#${this._idx + 1} · ${mcWhen(s.start)}`;
      what.textContent = [this._idx === 0 ? "Latest" : null, mcDur((s.end - s.start) / 1000), s.profile || null].filter(Boolean).join(" · ");
    }
    r.getElementById("older").classList.toggle("off", live || this._idx >= n - 1);
    r.getElementById("newer").classList.toggle("off", live || this._idx <= 0);
    // Dots: oldest on the left, latest on the right
    let d = "";
    for (let i = n - 1; i >= 0; i--) d += `<button class="dot${i === this._idx ? " on" : ""}" data-i="${i}" title="#${i + 1}"></button>`;
    const dots = r.getElementById("dots");
    dots.innerHTML = n > 1 ? d : "";
    dots.style.display = n > 1 ? "" : "none";
    dots.classList.toggle("off", live);
  }
}

/* "Machine not found" cover for a card whose sensor.<prefix>_state doesn't exist (wrong or missing prefix),
 * instead of messages that would suggest the machine is offline or has no data. */
function mcCoverMissing(cls) {
  const d = Object.getOwnPropertyDescriptor(cls.prototype, "hass");
  if (!d || !d.set) return;
  Object.defineProperty(cls.prototype, "hass", {
    configurable: true, get: d.get,
    set(hass) {
      d.set.call(this, hass);
      try {
        const prefix = (this._cfg && this._cfg.prefix) || "meticulous_espresso";
        const card = this.shadowRoot && this.shadowRoot.querySelector("ha-card");
        if (!card) return;
        const missing = !hass.states[`sensor.${prefix}_state`];
        let cover = card.querySelector(":scope > .mc-missing");
        if (missing && !cover) {
          cover = document.createElement("div");
          cover.className = "mc-missing";
          cover.style.cssText = "position:absolute;inset:0;z-index:5;background:#000;border-radius:inherit;display:flex;" +
            "flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;" +
            "color:#8fa3b8;font-weight:700;font-size:13px;letter-spacing:2px;min-height:110px";
          cover.innerHTML = `<div style="color:#dce9ff">MACHINE NOT FOUND</div><div style="font-size:11px;letter-spacing:1px;line-height:1.6">` +
            `No sensor.${prefix}_state. Set <b>prefix:</b> in the card to your machine's entity prefix.</div>`;
          if (getComputedStyle(card).position === "static") card.style.position = "relative";
          if (card.offsetHeight < 110) card.style.minHeight = "110px";
          card.appendChild(cover);
        } else if (!missing && cover) { cover.remove(); card.style.minHeight = ""; }
      } catch (e) { /* never break the card over this */ }
    },
  });
}

for (const [tag, cls, name, desc, oldTag] of [
  ["meticulous-cleaning-card", MeticulousCleaningCard, "Meticulous Cleaning",
    "Raise/lower the piston with a live position graphic and a cleaning reminder.", "meticulous-plunger-card"],
  ["meticulous-shot-count-card", MeticulousShotCountCard, "Meticulous Shot Count",
    "Total shots, today, last 7 days and a 14-day bar chart.", "meticulous-shots-card"],
  ["meticulous-maintenance-counter-card", MeticulousMaintenanceCounterCard, "Meticulous Maintenance Counter",
    "Shots since the last descale and grease against intervals you set, with logging.", "meticulous-maintenance-card"],
  ["meticulous-history-navigator-card", MeticulousHistoryNavigatorCard, "Meticulous History Navigator",
    "Step back through recent shots on the shot and warm-up cards.", "meticulous-history-card"],
  ["meticulous-maintenance-effort-card", MeticulousMaintenanceEffortCard, "Meticulous Maintenance Effort",
    "Piston friction over time, with maintenance levels, a forecast and maintenance logging.", "meticulous-effort-card"],
]) {
  if (!customElements.get(tag)) {
    if (cls !== MeticulousMaintenanceEffortCard) mcCoverMissing(cls);   // the effort card shows its own message
    customElements.define(tag, cls);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: tag, name, description: desc });
  }
  // The names used before 1.1 keep working (not listed in the card picker)
  if (oldTag && !customElements.get(oldTag)) customElements.define(oldTag, class extends cls {});
}
console.info(`%c METICULOUS-CARDS %c ${MC_VERSION} `, "background:#38e0f0;color:#000;font-weight:700", "background:#000;color:#fff");
