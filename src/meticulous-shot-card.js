/*
 * Meticulous Shot Card – shows the last shot like the machine's "brew complete" graph.
 * Data comes from Home Assistant's recorder history (survives restarts/reloads):
 * the last off→on→off cycle of binary_sensor.<prefix>_brewing and the pressure / flow /
 * weight sensors in that window. Drag or hover across the chart to move the orange cursor.
 *
 * type: custom:meticulous-shot-card
 * prefix: meticulous_espresso        # optional, entity id prefix
 * flow_max: 15                       # optional y-scale maxima
 * pressure_max: 12
 * weight_max: 55                     # grows automatically if the shot is heavier
 */
const MSC_VERSION = "1.5.1";
// Seconds as "47.0 s" below a minute, "7:14" from a minute on.
// Short "when" label for a shot: 08:41 today, otherwise MON 08:41 (this week) or 12 OCT
function mscWhen(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (now - d < 6 * 864e5) return d.toLocaleDateString("en", { weekday: "short" }).toUpperCase();
  return d.toLocaleDateString("en", { day: "numeric", month: "short" }).toUpperCase();
}
function mscTime(sec, dec) {
  if (+sec.toFixed(dec) < 60) return `${sec.toFixed(dec)}<tspan class="u"> s</tspan>`;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


/* Piston graphic in the style of the machine's "Raising" screen: a rod passing through a mint ring-shaped
 * piston, plus an optional dashed ghost ring (drawn behind the solid one). frac: 0 = top, 1 = bottom. */
function mscPistonSVG(frac, ghost, opts) {
  const o = Object.assign({ colour: "#58f0cf", ghostColour: "#9fb3c8", w: 120, h: 230, pulse: false }, opts || {});
  const cx = o.w / 2, rx = 40, ry = 12, th = 13, irx = 13, iry = 4.2;
  const top = 26, bot = o.h - 46;
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
  let g = `<style>@keyframes pistpulse{0%,100%{opacity:1}50%{opacity:.2}} .pist-ghost.pulse{animation:pistpulse 1.1s ease-in-out infinite}</style>`;
  // 1) dashed ghost, behind everything
  if (ghost !== null && ghost !== undefined) {
    g += `<g class="pist-ghost${o.pulse ? " pulse" : ""}">${ring(Y(ghost), o.ghostColour, true, "none")}</g>`;
  }
  // 2) solid piston (opaque fill hides the ghost where they overlap)
  g += `<g style="filter: drop-shadow(0 0 4px ${o.colour})">${ring(y, o.colour, false, "#06131a")}</g>`;
  // 3) rod: from the top down into the hole (visible through it), then out of the bottom face
  g += `<line x1="${cx}" x2="${cx}" y1="6" y2="${y + iry}" stroke="${o.colour}" stroke-width="2.2" stroke-linecap="round"/>`;
  g += `<line x1="${cx}" x2="${cx}" y1="${y + th + ry}" y2="${o.h - 6}" stroke="${o.colour}" stroke-width="2.2" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 ${o.w} ${o.h}" class="piston">${g}</svg>`;
}


class MeticulousShotCard extends HTMLElement {
  setConfig(config) {
    this._cfg = Object.assign(
      { prefix: "meticulous_espresso", flow_max: 15, pressure_max: 12, weight_max: 55, days: 10,
        piston_top: 0, piston_bottom: 76 },
      config || {}
    );
    const p = this._cfg.prefix;
    this._e = {
      brewing: `binary_sensor.${p}_brewing`,
      pressure: `sensor.${p}_pressure`,
      flow: `sensor.${p}_flow_rate`,
      weight: `sensor.${p}_shot_weight`,
      profile: `sensor.${p}_active_profile`,
      piston: `sensor.${p}_piston_position`,
      pistonAlt: null,   // set on the first update: the piston sensor on the same device, if it has another name
    };
    this._shot = this._shot || null;
    this._cursor = 0;
    if (!this._root) this._build();
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && !hass.states[this._e.piston]) {
      // Home Assistant names entities added after a device rename after the new name: look on the same device
      const ents = hass.entities || {}, st = ents[`sensor.${this._cfg.prefix}_state`], dev = st && st.device_id;
      this._e.pistonAlt = (dev && Object.keys(ents).find((e) => e.startsWith("sensor.") && e.endsWith("_piston_position") && ents[e].device_id === dev)) || null;
    }
    const b = hass.states[this._e.brewing];
    const brewing = b && b.state === "on";
    if (first) {
      this._loadCache();
      const sel = window.__mscSel;
      if (sel && sel.active && sel.index > 0 && sel.shot) this._select(sel); else this._fetch();
    }
    if (brewing) {
      this._selIdx = 0;          // a new shot always takes over; the history card resets to latest too
      this._live(hass);
    } else if (this._wasBrewing) {
      // Shot just ended: give the recorder a moment, then load the full trace.
      clearTimeout(this._refetchT);
      this._refetchT = setTimeout(() => this._fetch(), 6000);
    }
    this._wasBrewing = brewing;
  }

  connectedCallback() {
    // Follow the shot history card (meticulous-history-navigator-card), if there is one on the page
    if (!this._onSel) this._onSel = (e) => this._select(e.detail);
    window.addEventListener("meticulous-shot-select", this._onSel);
    // Re-check history when the dashboard is shown again (e.g. after a tab was asleep).
    if (this._hass && !this._selIdx && this._lastFetch && Date.now() - this._lastFetch > 5 * 60 * 1000) this._fetch();
  }
  disconnectedCallback() { if (this._onSel) window.removeEventListener("meticulous-shot-select", this._onSel); }

  // Show the shot the history card selected (index 0 = the most recent completed shot)
  _select(sel) {
    if (!sel) return;
    const b = this._hass && this._hass.states[this._e.brewing];
    if (b && b.state === "on") { this._render(); return; }   // live shot wins
    this._selIdx = sel.index || 0;
    if (!this._selIdx || !sel.shot) this._fetch();
    else this._fetch({ start: sel.shot.start, end: sel.shot.end });
    this._render();
  }

  // ---------- data ----------
  _cacheKey() { return `msc-last-shot-${this._cfg.prefix}`; }
  _loadCache() {
    try {
      const raw = window.localStorage.getItem(this._cacheKey());
      if (raw && !this._shot) { this._shot = JSON.parse(raw); this._cursor = 0; this._render(); }
    } catch (e) { /* storage unavailable */ }
  }
  _saveCache() {
    try { window.localStorage.setItem(this._cacheKey(), JSON.stringify(this._shot)); } catch (e) { /* ignore */ }
  }

  async _fetch(win) {
    if (!this._hass) return;
    if (this._fetching) { this._pending = win || "latest"; return; }
    if (!win && this._selIdx) return;          // showing an older shot from the history card
    this._fetching = true;
    this._lastFetch = Date.now();
    try {
      let shotStart = null, shotEnd = null;
      if (win) { shotStart = win.start; shotEnd = win.end; } else {
      const now = new Date();
      const start = new Date(now.getTime() - this._cfg.days * 864e5);
      const hb = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        entity_ids: [this._e.brewing],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const rows = (hb[this._e.brewing] || []).map((r) => ({ s: r.s, t: (r.lu || r.lc) * 1000 }));
      // Last clean off -> on -> off cycle (ignore unavailable/unknown flips).
      let on = null, prev = null;
      for (const r of rows) {
        if (r.s === "on" && prev === "off") on = r.t;
        else if (r.s === "off" && prev === "on" && on) { shotStart = on; shotEnd = r.t; on = null; }
        if (r.s === "on" || r.s === "off") prev = r.s;
      }
      if (!shotStart) {
        if (!this._shot) { this._empty = true; this._render(); }
        return;
      }
      }
      if (this._shot && this._shot.start === shotStart && this._shot.complete) { this._render(); return; } // already have it
      const ids = [this._e.pressure, this._e.flow, this._e.weight, this._e.profile, this._e.piston, this._e.pistonAlt].filter(Boolean);
      const h = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(shotStart - 1000).toISOString(),
        end_time: new Date(shotEnd + 1000).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const dur = (shotEnd - shotStart) / 1000;
      const series = (id, clampMin) => {
        const out = [];
        for (const r of h[id] || []) {
          const v = parseFloat(r.s);
          if (isNaN(v)) continue;
          let t = ((r.lu || r.lc) * 1000 - shotStart) / 1000;
          t = Math.min(Math.max(t, 0), dur);
          out.push([t, clampMin === undefined ? v : Math.max(clampMin, v)]);
        }
        if (out.length && out[0][0] > 0) out.unshift([0, out[0][1]]);
        if (out.length) out.push([dur, out[out.length - 1][1]]);
        return out;
      };
      const prof = (h[this._e.profile] || []).filter((r) => r.s && r.s !== "unavailable" && r.s !== "unknown");
      const flow = series(this._e.flow, 0);
      const pressure = series(this._e.pressure, 0);
      const weight = series(this._e.weight, 0);
      let piston = series(this._e.piston);
      if (!piston.length) piston = series(this._e.pistonAlt);
      // Weight at the end of the shot (skip the last re-tare reading if it collapsed to 0)
      let finalW = 0;
      for (const p of weight) if (p[1] > finalW) finalW = p[1];
      const endW = weight.length ? weight[weight.length - 1][1] : 0;
      if (endW > finalW * 0.8) finalW = endW;
      if (!win && this._selIdx) return;        // an older shot was picked meanwhile
      this._shot = {
        start: shotStart,
        duration: dur,
        profile: prof.length ? prof[0].s : (this._hass.states[this._e.profile] || {}).state || "",
        flow, pressure, weight, piston,
        final_weight: finalW,
        complete: true,
      };
      this._empty = false;
      this._cursor = 0;
      if (!win) this._saveCache();
      if (win && this._selIdx === 0) return this._fetch();   // selection changed back to latest meanwhile
      this._render();
    } catch (e) {
      // Keep showing whatever we had; try again later.
      console.warn("meticulous-shot-card: history fetch failed", e);
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => this._fetch(), 30000);
    } finally {
      this._fetching = false;
      if (this._pending) {
        const w = this._pending; this._pending = null;
        if (w === "latest") { if (!this._selIdx) this._fetch(); } else if (this._selIdx) this._fetch(w);
      }
    }
  }

  _live(hass) {
    // Build the trace live while a shot is running.
    const b = hass.states[this._e.brewing];
    const startMs = new Date(b.last_changed).getTime();
    if (!this._shot || this._shot.start !== startMs) {
      this._shot = {
        start: startMs, duration: 0, complete: false,
        profile: (hass.states[this._e.profile] || {}).state || "",
        flow: [], pressure: [], weight: [], piston: [], final_weight: 0,
      };
      this._cursor = 0;
    }
    const s = this._shot;
    const t = Math.max(0, (Date.now() - startMs) / 1000);
    const val = (id) => { const v = parseFloat((hass.states[id] || {}).state); return isNaN(v) ? 0 : Math.max(0, v); };
    // Like the recorder: store a point only when the value changes, so the live trace is drawn
    // exactly the way the finished trace is (straight lines between readings).
    const push = (arr, v) => { const l = arr[arr.length - 1]; if (!l || l[1] !== v) arr.push([t, v]); };
    push(s.flow, val(this._e.flow));
    push(s.pressure, val(this._e.pressure));
    push(s.weight, val(this._e.weight));
    const pid = hass.states[this._e.piston] ? this._e.piston : this._e.pistonAlt;
    const pv = parseFloat((hass.states[pid] || {}).state);
    if (!isNaN(pv)) { s.piston = s.piston || []; push(s.piston, pv); }
    s.duration = t;
    s.final_weight = Math.max(s.final_weight, val(this._e.weight));
    this._cursor = t;
    this._queueRender();
  }

  // Live redraws at most ~5 times a second: Home Assistant sends many updates per second during a
  // shot, and redrawing the whole chart for each one can swamp a slow wall tablet (which then shows
  // every card's state late).
  _queueRender() {
    if (this._rq) return;
    const wait = Math.max(0, 200 - (Date.now() - (this._lastRender || 0)));
    this._rq = setTimeout(() => {
      requestAnimationFrame(() => { this._rq = null; this._lastRender = Date.now(); this._render(); });
    }, wait);
  }

  // ---------- view ----------
  _build() {
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `
      <style>
        :host { display: block; }
        .tag { position: absolute; top: 17px; left: 16px; font-size: 10px; font-weight: 700; letter-spacing: 1px;
               line-height: 1.3; color: #8fa3b8; white-space: nowrap; pointer-events: none; }
        .tag b { color: #dce9ff; }
        ha-card.tagged .pill { max-width: calc(100% - 104px); }
        ha-card { position: relative; background: #000; border-radius: 22px; padding: 16px; overflow: hidden;
                  border: 1px solid #1c2530; color: #e8f1ff;
                  font-family: "Space Mono", "Menlo", "Consolas", ui-monospace, monospace; }
        .pill { margin: 0 auto 2px; width: fit-content; max-width: 92%; box-sizing: border-box;
                text-align: center; border: 1.5px solid #8fa3b8;
                border-radius: 9999px; padding: calc(4px + .05em) 18px calc(4px - .05em); font-weight: 700; font-size: 14px;
                letter-spacing: 3px; text-transform: uppercase; white-space: nowrap; overflow: hidden;
                text-overflow: ellipsis; color: #dce9ff; text-shadow: 0 0 6px rgba(160,200,255,.35); }
        #chart { touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
        svg { display: block; width: 100%; height: auto; }
        .lbl { fill: #dce9ff; font-weight: 700; font-size: 18px; }
        .lbl .u { fill: #8fa3b8; }
        /* legend sits under the plot area, left-aligned columns like the machine */
        .legend { display: grid; grid-template-columns: auto auto auto; justify-content: space-between; column-gap: 10px; margin: -2px 17% 0 20.5%; text-align: left; }
        .legend .n { font-weight: 700; font-size: 11px; letter-spacing: 1px; color: #8fa3b8; white-space: nowrap; }
        .legend .v { font-weight: 700; font-size: 17px; display: flex; align-items: center; gap: 3px; margin-top: 1px; color: #dce9ff; }
        .legend .sq { width: 13px; height: 13px; border-radius: 1px; flex: none; }
        .msg { text-align: center; padding: 40px 0; color: #8fa3b8; font-size: 14px; letter-spacing: 2px; }
      </style>
      <ha-card>
        <div class="tag" id="tag"></div>
        <div class="pill" id="title">LAST SHOT</div>
        <div id="chart"></div>
        <div class="legend" id="legend"></div>
      </ha-card>`;
    this._chart = this._root.getElementById("chart");
    this._title = this._root.getElementById("title");
    this._legend = this._root.getElementById("legend");
  }

  _renderTag() {
    const tag = this._root && this._root.getElementById("tag");
    if (!tag) return;
    const sel = window.__mscSel, s = this._shot;
    const card = tag.parentNode;
    if (!sel || !sel.active) { tag.innerHTML = ""; card.classList.remove("tagged"); return; }
    card.classList.add("tagged");
    if (s && !s.complete) { tag.innerHTML = `<b style="color:#ff5a36">●</b><br>LIVE`; return; }
    tag.innerHTML = `<b>#${(this._selIdx || 0) + 1}</b>${s ? "<br>" + mscWhen(s.start) : ""}`;
  }

  _valueAt(arr, t) {
    if (!arr || !arr.length) return 0;
    let v = arr[0][1];
    for (const p of arr) { if (p[0] <= t) v = p[1]; else break; }
    return v;
  }

  _render() {
    if (!this._root) return;
    const s = this._shot;
    this._renderTag();
    if (!s) {
      this._title.textContent = "LAST SHOT";
      this._chart.innerHTML = `<div class="msg">${this._empty ? "NO SHOT IN RECENT HISTORY" : "…"}</div>`;
      this._legend.innerHTML = "";
      return;
    }
    this._title.textContent = s.profile || "LAST SHOT";

    // Geometry (viewBox units)
    const W = 600, H = 350, L = 123, R = 498, T = 44, B = 300;
    // Piston indicator proportions taken from the machine screen: bar ≈ 16% x 5% of the plot width,
    // centred ≈ 19% of the plot width left of the plot; rod hangs from ≈ 72% of the plot height.
    const PW = (R - L) * 0.159, PH = (R - L) * 0.05;
    const PX = L - (R - L) * 0.194;
    const dur = Math.max(s.duration, 0.1);
    const x = (t) => L + (t / dur) * (R - L);
    const fMax = this._cfg.flow_max, pMax = this._cfg.pressure_max;
    const wMax = Math.max(this._cfg.weight_max, s.final_weight * 1.25);
    const y = (v, max) => B - (Math.min(v, max) / max) * (B - T);
    const path = (arr, max) => {
      if (!arr.length) return "";
      // while live, hold the latest reading out to "now"
      const pts = !s.complete && arr[arr.length - 1][0] < dur ? arr.concat([[dur, arr[arr.length - 1][1]]]) : arr;
      return pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1], max).toFixed(1)}`).join("");
    };
    const grid = [];
    for (let i = 0; i <= 5; i++) {
      const gy = T + (i * (B - T)) / 6;
      grid.push(`<line x1="${L}" x2="${W - 2}" y1="${gy}" y2="${gy}" stroke="#3a434d" stroke-width="1.2" stroke-dasharray="7 9"/>`);
    }
    this._geom = { W, H, L, R, T, B, dur, PX, PW, PH };
    this._chart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="pg" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#38d6ff"/><stop offset="1" stop-color="#9dffb0"/>
          </linearGradient>
          <filter id="glow" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="1.6" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        ${grid.join("")}
        <line x1="${R}" x2="${R}" y1="${T}" y2="${B}" stroke="#4f6a8f" stroke-width="2" stroke-dasharray="3 6"/>
        <line x1="0" x2="${W}" y1="${B}" y2="${B}" stroke="#24476e" stroke-width="3"/>
        <!-- piston position indicator (machine style: rod + bar) -->
        <line id="prod" x1="${PX.toFixed(1)}" x2="${PX.toFixed(1)}" stroke="#2f5a5e" stroke-width="2.5"/>
        <rect id="pbar" x="${(PX - PW / 2).toFixed(1)}" width="${PW.toFixed(1)}" height="${PH.toFixed(1)}" rx="1" fill="#38e0f0"/>
        <g filter="url(#glow)" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="3">
          <path d="${path(s.flow, fMax)}" stroke="#3a9bff"/>
          <path d="${path(s.weight, wMax)}" stroke="#f2e66b"/>
          <path d="${path(s.pressure, pMax)}" stroke="#38e0f0"/>
        </g>
        <text class="lbl" id="tl" y="${T - 14}"></text>
        <text class="lbl" x="${R + 6}" y="${T - 12}">${s.final_weight.toFixed(1)}<tspan class="u"> g</tspan></text>
        <text class="lbl" x="${R + 18}" y="${B + 30}">${mscTime(s.duration, 1)}</text>
        <line id="cl" y1="${T - 6}" y2="${B + 2}" stroke="#ff5a36" stroke-width="3.5"/>
        <path id="ct" fill="#ff5a36"/>
      </svg>`;
    this._updateCursor();

    if (!this._listening) {
      this._listening = true;
      const host = this._chart;
      const move = (ev) => {
        const svg = host.querySelector("svg");
        if (!svg || !this._geom) return;
        const g = this._geom;
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * g.W;
        this._cursor = Math.min(Math.max((px - g.L) / (g.R - g.L), 0), 1) * g.dur;
        if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this._updateCursor(); });
      };
      host.addEventListener("pointerdown", (ev) => {
        this._drag = true;
        try { host.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        move(ev);
      });
      host.addEventListener("pointermove", (ev) => { if (this._drag || ev.pointerType === "mouse") move(ev); });
      const stop = () => { this._drag = false; };
      host.addEventListener("pointerup", stop);
      host.addEventListener("pointercancel", stop);
    }
  }

  _updateCursor() {
    const s = this._shot, g = this._geom;
    if (!s || !g) return;
    const svg = this._chart.querySelector("svg");
    if (!svg) return;
    const ct = Math.min(Math.max(this._cursor, 0), g.dur);
    const cx = g.L + (ct / g.dur) * (g.R - g.L);
    const cl = svg.querySelector("#cl"), tr = svg.querySelector("#ct"), tl = svg.querySelector("#tl");
    cl.setAttribute("x1", cx); cl.setAttribute("x2", cx);
    tr.setAttribute("d", `M${cx + 1},${g.B + 8} l15,9 l-15,9 z`);
    // keep the time label clear of the weight label on the right
    if (cx > g.R - 120) { tl.setAttribute("x", cx - 8); tl.setAttribute("text-anchor", "end"); }
    else { tl.setAttribute("x", Math.max(cx + 6, g.L)); tl.setAttribute("text-anchor", "start"); }
    tl.innerHTML = mscTime(ct, 1);
    const f = this._valueAt(s.flow, ct), p = this._valueAt(s.pressure, ct), w = this._valueAt(s.weight, ct);
    this._legend.innerHTML = `
      <div><div class="n">FLOW</div><div class="v"><span class="sq" style="background:#3a9bff"></span>${f.toFixed(1)}</div></div>
      <div><div class="n">PRESSURE</div><div class="v"><span class="sq" style="background:#38e0f0"></span>${p.toFixed(1)}</div></div>
      <div><div class="n">WEIGHT</div><div class="v"><span class="sq" style="background:#f2e66b"></span>${w.toFixed(1)}</div></div>`;
    this._renderPiston(ct);
  }

  _renderPiston(ct) {
    const g = this._geom, svg = this._chart && this._chart.querySelector("svg");
    if (!g || !svg) return;
    const rod = svg.querySelector("#prod"), bar = svg.querySelector("#pbar");
    const s = this._shot;
    const arr = (s && s.piston) || [];
    // Bar travels between yTop (piston up) and yBot (piston down); the rod hangs from a fixed point above.
    const Hc = g.B - (g.T - 6);                 // plot height (cursor top to baseline)
    const rodTop = g.B - 0.725 * Hc;            // rod anchor, as on the machine
    const yTop = rodTop + 6;                    // bar top when the piston is fully up
    const yBot = g.B - 0.29 * Hc;               // bar top when fully down (matches the machine photo)
    let f = 1, known = arr.length > 0;
    if (known) {
      let top = this._cfg.piston_top, bottom = this._cfg.piston_bottom;
      for (const p of arr) { if (p[1] < top) top = p[1]; if (p[1] > bottom) bottom = p[1]; }
      f = Math.min(Math.max((this._valueAt(arr, ct) - top) / Math.max(bottom - top, 1), 0), 1);
    }
    const y = yTop + f * (yBot - yTop);
    // Static rod = full travel range: from the bar's top edge when fully up to its bottom edge when fully down.
    rod.setAttribute("y1", yTop.toFixed(1)); rod.setAttribute("y2", (yBot + g.PH).toFixed(1));
    bar.setAttribute("y", y);
    bar.setAttribute("fill", known ? "#38e0f0" : "#2a3a44");
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

if (!customElements.get("meticulous-shot-card")) {
  mcCoverMissing(MeticulousShotCard);
  customElements.define("meticulous-shot-card", MeticulousShotCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "meticulous-shot-card",
    name: "Meticulous Shot Card",
    description: "Last shot graph styled like the Meticulous machine, with a draggable cursor.",
  });
  console.info(`%c METICULOUS-SHOT-CARD %c ${MSC_VERSION} `, "background:#ff5a36;color:#000;font-weight:700", "background:#000;color:#fff");
}
