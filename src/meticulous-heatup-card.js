/*
 * Meticulous Heat-up Card – plots the machine's temperature sensors while the water warms up,
 * in the same style as the Meticulous Shot Card, with the target temperature as a reference line.
 *
 * The warm-up window is detected from the integration's machine state (sensor.<prefix>_state): it
 * starts when the machine begins heating and runs until the shot starts, or until the machine gives
 * up waiting and returns to Idle. While that is happening the card plots live (HEATING…, then READY
 * once it waits for "Click to Start"); afterwards it shows the last warm-up from the recorder history.
 * Drag or hover across the chart to move the orange cursor.
 *
 * type: custom:meticulous-heatup-card
 * prefix: meticulous_espresso                 # optional, entity id prefix
 * heating_states: [Starting..., Heating, Preheating]           # optional, states that count as heating
 * active_states: [Starting..., Heating, Preheating, Click to Start]  # optional, states plotted live
 * days: 10                                    # optional, how far back to look for the last warm-up
 *
 * With a meticulous-history-navigator-card on the same dashboard, the card shows the warm-up before the shot
 * picked there (and switches to live whenever the machine starts warming up again).
 */
const MHC_VERSION = "1.3.1";
// Short "when" label for a shot: 08:41 today, otherwise MON 08:41 (this week) or 12 OCT
function mhcWhen(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (now - d < 6 * 864e5) return d.toLocaleDateString("en", { weekday: "short" }).toUpperCase();
  return d.toLocaleDateString("en", { day: "numeric", month: "short" }).toUpperCase();
}
const mhcSel = () => (window.__mscSel && window.__mscSel.active ? window.__mscSel : null);
// Seconds as "47.0 s" below a minute, "7:14" from a minute on.
function mhcTime(sec, dec) {
  if (+sec.toFixed(dec) < 60) return `${sec.toFixed(dec)}<tspan class="u"> s</tspan>`;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


// Solid lines; the external sensors use the shot card's flow blue and pressure cyan.
const MHC_SERIES = [
  { key: "boiler", name: "BOILER", colour: "#c98500", dash: "" },
  { key: "head", name: "HEAD", colour: "#d55181", dash: "" },
  { key: "ext1", name: "EXT 1", colour: "#3a9bff", dash: "" },
  { key: "ext2", name: "EXT 2", colour: "#38e0f0", dash: "" },
];
const MHC_TARGET = "#dce9ff";
const MHC_CURSOR = "#ff5a36";

class MeticulousHeatupCard extends HTMLElement {
  setConfig(config) {
    this._cfg = Object.assign(
      { prefix: "meticulous_espresso", heating_states: ["Starting...", "Heating", "Preheating"],
        active_states: ["Starting...", "Heating", "Preheating", "Click to Start"], days: 10 },
      config || {}
    );
    const p = this._cfg.prefix;
    this._e = {
      state: `sensor.${p}_state`,
      brewing: `binary_sensor.${p}_brewing`,
      target: `sensor.${p}_target_temperature`,
      profile: `sensor.${p}_active_profile`,
      boiler: `sensor.${p}_boiler_temperature`,
      head: `sensor.${p}_brew_head_temperature`,
      ext1: `sensor.${p}_external_temperature_1`,
      ext2: `sensor.${p}_external_temperature_2`,
    };
    this._run = this._run || null;
    this._cursor = 0;
    if (!this._root) this._build();
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _isActive(s) { return this._cfg.active_states.includes(s); }
  _isHeat(s) { return this._cfg.heating_states.includes(s); }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const st = hass.states[this._e.state];
    const active = !!st && this._isActive(st.state);
    if (first) { this._loadCache(); if (!active) this._refresh(); }
    if (active) this._live(st);
    else if (this._wasActive) this._finishLive(st);
    this._wasActive = active;
  }

  connectedCallback() {
    // Follow the shot history card (meticulous-history-navigator-card), if there is one on the page
    if (!this._onSel) this._onSel = () => { if (!this._wasActive) this._refresh(); else this._render(); };
    window.addEventListener("meticulous-shot-select", this._onSel);
    if (this._hass && !this._wasActive && this._lastFetch && Date.now() - this._lastFetch > 5 * 60 * 1000) this._refresh();
  }
  disconnectedCallback() {
    clearInterval(this._tickT); this._tickT = null;
    if (this._onSel) window.removeEventListener("meticulous-shot-select", this._onSel);
  }

  _brewing() { const b = this._hass && this._hass.states[this._e.brewing]; return !!b && b.state === "on"; }

  // What to show when not warming up: the warm-up before the shot picked in the history card,
  // or (without a history card) simply the last warm-up.
  _refresh() {
    const sel = mhcSel();
    if (!sel || !sel.shot) { this._selShown = null; return this._fetchLast(); }
    if (this._brewing() && this._run && this._run.complete && !this._selShown) { this._render(); return; } // warm-up of the live shot
    return this._loadFor(sel);
  }

  async _loadFor(sel) {
    if (!this._hass) return;
    if (this._fetching) { this._pendingSel = true; return; }
    this._fetching = true;
    this._lastFetch = Date.now();
    const shot = sel.shot;
    try {
      const days = Math.max(this._cfg.days, Math.ceil((Date.now() - shot.start) / 864e5) + 1);
      const runs = await this._stateRuns(days);
      // The warm-up that ended just before (or as) the shot started
      const run = runs.filter((r) => r.end !== null && r.end <= shot.start + 60e3 && r.end >= shot.start - 300e3).pop();
      if (this._wasActive) return;
      if (!run) {
        this._run = null; this._noRun = true; this._selShown = { index: sel.index, start: shot.start };
        this._render(); return;
      }
      await this._loadRun(run, sel.index === 0);
      this._selShown = { index: sel.index, start: shot.start };
      this._render();
    } catch (e) {
      console.warn("meticulous-heatup-card: history fetch failed", e);
    } finally {
      this._fetching = false;
      if (this._pendingSel) { this._pendingSel = false; this._refresh(); }
    }
  }

  async _loadRun(run, save) {
    if (this._run && this._run.complete && this._run.detailed && Math.abs(this._run.start - run.start) < 2000) { this._noRun = false; return; }
    const d = await this._temps(run.start, run.end);
    if (this._wasActive) return;                    // a new warm-up started meanwhile
    const dur = (run.end - run.start) / 1000;
    for (const k of ["boiler", "head", "ext1", "ext2", "target"]) if (d[k].length) d[k].push([dur, d[k][d[k].length - 1][1]]);
    this._run = Object.assign(d, {
      start: run.start, duration: dur, complete: true, detailed: true,
      readyAt: run.readyAt !== null ? (run.readyAt - run.start) / 1000 : null,
    });
    this._empty = false; this._noRun = false;
    this._cursor = dur;
    if (save) this._saveCache();
  }

  // ---------- data ----------
  _cacheKey() { return `mhc-last-heatup-${this._cfg.prefix}`; }
  _loadCache() {
    try {
      const raw = window.localStorage.getItem(this._cacheKey());
      if (raw && !this._run) { this._run = JSON.parse(raw); this._cursor = this._run.duration; this._render(); }
    } catch (e) { /* storage unavailable */ }
  }
  _saveCache() {
    try { window.localStorage.setItem(this._cacheKey(), JSON.stringify(this._run)); } catch (e) { /* ignore */ }
  }

  async _hist(ids, startMs, endMs) {
    return this._hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString(),
      entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
    });
  }

  // Runs of consecutive active states that include heating, from the state history.
  _runsFrom(rows) {
    const runs = [];
    let cur = null;
    for (const r of rows) {
      if (this._isActive(r.s)) {
        if (!cur) cur = { start: r.t, end: null, readyAt: null, heat: false };
        if (this._isHeat(r.s)) cur.heat = true;
        if (!this._isHeat(r.s) && cur.readyAt === null) cur.readyAt = r.t;
      } else if (cur) { cur.end = r.t; if (cur.heat) runs.push(cur); cur = null; }
    }
    if (cur && cur.heat) runs.push(cur);   // still running (end = null)
    return runs;
  }

  async _stateRuns(days) {
    const now = Date.now();
    const hs = await this._hist([this._e.state], now - days * 864e5, now);
    const rows = (hs[this._e.state] || []).map((r) => ({ s: r.s, t: (r.lu || r.lc) * 1000 }));
    return this._runsFrom(rows);
  }

  async _temps(startMs, endMs) {
    const ids = [this._e.boiler, this._e.head, this._e.ext1, this._e.ext2, this._e.target, this._e.profile];
    const h = await this._hist(ids, startMs, endMs);
    const dur = (endMs - startMs) / 1000;
    const series = (id) => {
      const out = [];
      for (const r of h[id] || []) {
        const v = parseFloat(r.s);
        if (isNaN(v)) continue;
        out.push([Math.min(Math.max(((r.lu || r.lc) * 1000 - startMs) / 1000, 0), dur), v]);
      }
      if (out.length && out[0][0] > 0) out.unshift([0, out[0][1]]);
      return out;
    };
    const prof = (h[this._e.profile] || []).filter((r) => r.s && r.s !== "unavailable" && r.s !== "unknown");
    return {
      profile: prof.length ? prof[prof.length - 1].s : "",
      boiler: series(this._e.boiler), head: series(this._e.head),
      ext1: series(this._e.ext1), ext2: series(this._e.ext2), target: series(this._e.target),
    };
  }

  // Last finished warm-up from history (used when the machine isn't warming up right now).
  async _fetchLast(attempt = 0) {
    if (!this._hass) return;
    if (this._fetching) { this._pendingSel = true; return; }
    this._fetching = true;
    this._lastFetch = Date.now();
    try {
      const runs = await this._stateRuns(this._cfg.days);
      let run = runs[runs.length - 1];
      if (run && run.end === null) {
        // History still shows it running (recorder not caught up yet): use the previous one for now
        if (attempt < 6 && !this._wasActive) { clearTimeout(this._retryT); this._retryT = setTimeout(() => this._fetchLast(attempt + 1), 10000); }
        run = runs[runs.length - 2];
        if (this._run && this._run.complete) return;   // keep what we have
      }
      if (!run) { if (!this._run) { this._empty = true; this._render(); } return; }
      if (this._wasActive) return;                    // a new warm-up started meanwhile
      await this._loadRun(run, true);
      this._render();
    } catch (e) {
      console.warn("meticulous-heatup-card: history fetch failed", e);
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => this._fetchLast(), 30000);
    } finally {
      this._fetching = false;
      if (this._pendingSel) { this._pendingSel = false; this._refresh(); }
    }
  }

  // Live warm-up: values come straight from the entity states; history only backfills the part
  // before the card was opened. Plots until the shot starts or the machine times out to Idle.
  _live(st) {
    const hass = this._hass;
    const changed = new Date(st.last_changed).getTime();
    if (!this._run || this._run.complete) {
      this._selShown = null; this._noRun = false;
      this._run = {
        start: changed, duration: 0, complete: false, readyAt: null,
        profile: (hass.states[this._e.profile] || {}).state || "",
        boiler: [], head: [], ext1: [], ext2: [], target: [],
      };
      this._backfill(this._run);
    }
    if (!this._tickT) this._tickT = setInterval(() => {
      const s = this._hass && this._hass.states[this._e.state];
      if (s && this._isActive(s.state)) this._live(s); else { clearInterval(this._tickT); this._tickT = null; }
    }, 1000);
    const r = this._run;
    const t = Math.max(0, (Date.now() - r.start) / 1000);
    if (!this._isHeat(st.state) && r.readyAt === null) r.readyAt = Math.max(0, (changed - r.start) / 1000);
    const val = (id) => { const v = parseFloat((hass.states[id] || {}).state); return isNaN(v) ? null : v; };
    const push = (arr, v) => { if (v === null) return; const l = arr[arr.length - 1]; if (!l || l[1] !== v) arr.push([t, v]); };
    for (const s of MHC_SERIES) push(r[s.key], val(this._e[s.key]));
    push(r.target, val(this._e.target));
    r.duration = Math.max(r.duration, t);
    this._cursor = r.duration;
    const now = Date.now();
    if (!this._lastLiveRender || now - this._lastLiveRender > 900) { this._lastLiveRender = now; this._render(); }
  }

  async _backfill(run) {
    try {
      const runs = await this._stateRuns(1);
      const hr = runs[runs.length - 1];
      // Only trust history if it describes this ongoing warm-up (or one that began just before it)
      if (hr && hr.end === null && hr.start <= run.start + 2000 && run === this._run) {
        const shift = (run.start - hr.start) / 1000;
        if (shift > 0) {
          for (const k of ["boiler", "head", "ext1", "ext2", "target"]) run[k].forEach((p) => { p[0] += shift; });
          run.start = hr.start;
          run.duration += shift;
          if (run.readyAt !== null) run.readyAt += shift;
        }
        if (hr.readyAt !== null) run.readyAt = (hr.readyAt - hr.start) / 1000;
      }
      const d = await this._temps(run.start, Date.now());
      if (run !== this._run) return;
      if (d.profile) run.profile = d.profile;
      for (const k of ["boiler", "head", "ext1", "ext2", "target"]) {
        const firstLive = run[k].length ? run[k][0][0] : Infinity;
        run[k] = d[k].filter((p) => p[0] < firstLive).concat(run[k]);
      }
      this._render();
    } catch (e) { /* live data still works without the backfill */ }
  }

  _finishLive(st) {
    clearInterval(this._tickT); this._tickT = null;
    const r = this._run;
    if (r && !r.complete) {
      const end = st ? new Date(st.last_changed).getTime() : Date.now();
      r.duration = Math.max(0.1, Math.min(r.duration, (end - r.start) / 1000) || r.duration);
      for (const k of ["boiler", "head", "ext1", "ext2", "target"]) {
        r[k] = r[k].filter((p) => p[0] <= r.duration);
        if (r[k].length) r[k].push([r.duration, r[k][r[k].length - 1][1]]);
      }
      r.complete = true;
      this._cursor = r.duration;
      this._saveCache();
      this._render();
    }
    // Swap in the full-resolution history once the recorder has caught up
    clearTimeout(this._refetchT);
    this._refetchT = setTimeout(() => this._refresh(), 15000);
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
        .pill.live { border-color: ${MHC_CURSOR}; }
        #chart { touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
        svg { display: block; width: 100%; height: auto; }
        .lbl { fill: #dce9ff; font-weight: 700; font-size: 18px; }
        .lbl .u { fill: #8fa3b8; }
        .ax { fill: #8fa3b8; font-size: 14px; font-weight: 700; }
        .legend { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px;
                  margin: -2px 0 0 4%; text-align: left; }
        .legend .n { font-weight: 700; font-size: 11px; letter-spacing: 1px; color: #8fa3b8; white-space: nowrap; }
        .legend .v { font-weight: 700; font-size: 17px; display: flex; align-items: center; gap: 3px; margin-top: 1px;
                     color: #dce9ff; white-space: nowrap; }
        .legend .sq { width: 13px; height: 13px; border-radius: 1px; flex: none; }
        .msg { text-align: center; padding: 40px 0; color: #8fa3b8; font-size: 14px; letter-spacing: 2px; }
      </style>
      <ha-card>
        <div class="tag" id="tag"></div>
        <div class="pill" id="title">WARM-UP</div>
        <div id="chart"></div>
        <div class="legend" id="legend"></div>
      </ha-card>`;
    this._chart = this._root.getElementById("chart");
    this._title = this._root.getElementById("title");
    this._legend = this._root.getElementById("legend");
  }

  // A sensor is shown when its entity exists (i.e. is enabled) or the loaded warm-up has data for it.
  _has(key) {
    const st = this._hass && this._hass.states[this._e[key]];
    return !!(st || (this._run && this._run[key] && this._run[key].length));
  }
  _shown() { return MHC_SERIES.filter((s) => this._has(s.key)); }

  _liveLabel() {
    const st = this._hass && this._hass.states[this._e.state];
    return st && !this._isHeat(st.state) ? "READY" : "HEATING…";
  }

  _renderTag() {
    const tag = this._root && this._root.getElementById("tag");
    if (!tag) return;
    const card = tag.parentNode, r = this._run, sel = mhcSel();
    let txt = "";
    if (sel) {
      if ((r && !r.complete) || (this._brewing() && !this._selShown)) txt = `<b style="color:${MHC_CURSOR}">●</b><br>LIVE`;
      else if (this._selShown) txt = `<b>#${this._selShown.index + 1}</b><br>${mhcWhen(this._selShown.start)}`;
    }
    tag.innerHTML = txt;
    card.classList.toggle("tagged", !!sel);
  }

  _valueAt(arr, t) {
    if (!arr || !arr.length) return null;
    let v = arr[0][1];
    for (const p of arr) { if (p[0] <= t) v = p[1]; else break; }
    return v;
  }

  _render() {
    if (!this._root) return;
    const r = this._run;
    const shown = this._shown();
    const anyData = r && MHC_SERIES.some((s) => r[s.key].length);
    this._renderTag();
    if (!r || !shown.length || (!r.complete && !anyData)) {
      this._title.textContent = r && !r.complete ? this._liveLabel() : "WARM-UP";
      this._title.classList.toggle("live", !!(r && !r.complete));
      const msg = this._hass && !shown.length ? "NO TEMPERATURE SENSORS ENABLED"
        : this._noRun ? "NO WARM-UP RECORDED FOR THIS SHOT"
        : this._empty ? "NO WARM-UP IN RECENT HISTORY" : "…";
      this._chart.innerHTML = `<div class="msg">${msg}</div>`;
      this._legend.innerHTML = "";
      return;
    }
    this._title.textContent = r.complete ? "WARM-UP" : this._liveLabel();
    this._title.classList.toggle("live", !r.complete);

    const W = 600, H = 350, L = 70, R = 498, T = 44, B = 300;
    const dur = Math.max(r.duration, 1);
    // y range: rounded to 20 °C around everything drawn, target included
    let lo = Infinity, hi = -Infinity;
    for (const k of ["boiler", "head", "ext1", "ext2", "target"]) for (const p of r[k] || []) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    if (!isFinite(lo)) { lo = 20; hi = 100; }
    lo = Math.max(0, Math.floor((lo - 5) / 20) * 20);
    hi = Math.ceil((hi + 20) / 20) * 20;      // headroom above the highest trace, like the shot card
    const x = (t) => L + (t / dur) * (R - L);
    const y = (v) => B - ((v - lo) / Math.max(hi - lo, 1)) * (B - T);
    const hold = (arr) => (!r.complete && arr.length && arr[arr.length - 1][0] < dur ? arr.concat([[dur, arr[arr.length - 1][1]]]) : arr);
    const path = (arr) => hold(arr).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const step = (arr) => arr.map((p, i) => (i ? `H${x(p[0]).toFixed(1)}V${y(p[1]).toFixed(1)}` : `M${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)).join("");

    const grid = [];
    for (let v = lo + 20; v <= hi; v += 20) {   // top gridline sits at the top of the plot
      const gy = y(v);
      grid.push(`<line x1="${L}" x2="${W - 2}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#3a434d" stroke-width="1.2" stroke-dasharray="7 9"/>`);
      grid.push(`<text class="ax" x="${L - 10}" y="${(gy + 5).toFixed(1)}" text-anchor="end">${v}°</text>`);
    }
    const tgt = r.target.length ? r.target[r.target.length - 1][1] : null;
    const lines = shown.map((s) =>
      `<path d="${path(r[s.key])}" stroke="${s.colour}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}${s.offset ? ` stroke-dashoffset="${s.offset}"` : ""}/>`).join("");
    this._geom = { W, H, L, R, T, B, dur };
    this._chart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}">
        <defs>
          <filter id="glow" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="1.4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        ${grid.join("")}
        <line x1="${R}" x2="${R}" y1="${T}" y2="${B}" stroke="#4f6a8f" stroke-width="2" stroke-dasharray="3 6"/>
        <line x1="0" x2="${W}" y1="${B}" y2="${B}" stroke="#24476e" stroke-width="3"/>
        ${r.target.length ? `<path d="${step(hold(r.target))}" fill="none" stroke="${MHC_TARGET}" stroke-width="1.6" opacity=".85"/>` : ""}
        ${r.readyAt !== null && r.readyAt !== undefined && r.readyAt > 0 && r.readyAt < dur ? `
          <line x1="${x(r.readyAt).toFixed(1)}" x2="${x(r.readyAt).toFixed(1)}" y1="${T}" y2="${B}" stroke="#8fa3b8" stroke-width="1.5" stroke-dasharray="2 5"/>
          <text class="ax" x="${(x(r.readyAt) + 5).toFixed(1)}" y="${T + 12}">READY</text>` : ""}
        <g filter="url(#glow)" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="3">${lines}</g>
        ${tgt !== null ? `<text class="lbl" x="${R + 6}" y="${(y(tgt) - 8).toFixed(1)}">${tgt.toFixed(0)}<tspan class="u"> °C</tspan></text>` : ""}
        <text class="lbl" id="tl" y="${T - 14}"></text>
        <text class="lbl" x="${R + 18}" y="${B + 30}">${mhcTime(r.duration, 0)}</text>
        <line id="cl" y1="${T - 6}" y2="${B + 2}" stroke="${MHC_CURSOR}" stroke-width="3.5"/>
        <path id="ct" fill="${MHC_CURSOR}"/>
      </svg>`;
    this._updateCursor();

    if (!this._listening) {
      this._listening = true;
      const host = this._chart;
      const move = (ev) => {
        const svg = host.querySelector("svg");
        if (!svg || !this._geom) return;
        const g = this._geom;
        const b = svg.getBoundingClientRect();
        const px = ((ev.clientX - b.left) / b.width) * g.W;
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
    const r = this._run, g = this._geom;
    if (!r || !g) return;
    const svg = this._chart.querySelector("svg");
    if (!svg) return;
    const ct = Math.min(Math.max(this._cursor, 0), g.dur);
    const cx = g.L + (ct / g.dur) * (g.R - g.L);
    const cl = svg.querySelector("#cl"), tr = svg.querySelector("#ct"), tl = svg.querySelector("#tl");
    cl.setAttribute("x1", cx); cl.setAttribute("x2", cx);
    tr.setAttribute("d", `M${cx + 1},${g.B + 8} l15,9 l-15,9 z`);
    if (cx > g.R - 120) { tl.setAttribute("x", cx - 8); tl.setAttribute("text-anchor", "end"); }
    else { tl.setAttribute("x", Math.max(cx + 6, g.L)); tl.setAttribute("text-anchor", "start"); }
    tl.innerHTML = mhcTime(ct, 0);
    const fmt = (v) => (v === null ? "—" : Math.round(v).toString());
    const shown = this._shown(), withTarget = this._has("target");
    this._legend.style.gridTemplateColumns = `repeat(${shown.length + (withTarget ? 1 : 0)}, minmax(0, 1fr))`;
    const swatch = (c) => `<span class="sq" style="background:${c}"></span>`;
    this._legend.innerHTML = shown.map((s) =>
      `<div><div class="n">${s.name}</div><div class="v">${swatch(s.colour)}${fmt(this._valueAt(r[s.key], ct))}</div></div>`).join("") +
      (withTarget ? `<div><div class="n">TARGET</div><div class="v">${swatch(MHC_TARGET)}${fmt(this._valueAt(r.target, ct))}</div></div>` : "");
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

if (!customElements.get("meticulous-heatup-card")) {
  mcCoverMissing(MeticulousHeatupCard);
  customElements.define("meticulous-heatup-card", MeticulousHeatupCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "meticulous-heatup-card",
    name: "Meticulous Heat-up Card",
    description: "Temperature sensors and target during the last warm-up, styled like the Meticulous machine.",
  });
  console.info(`%c METICULOUS-HEATUP-CARD %c ${MHC_VERSION} `, "background:#c98500;color:#000;font-weight:700", "background:#000;color:#fff");
}
