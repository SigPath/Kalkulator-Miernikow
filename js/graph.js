/* WYKRESY — rysowanie funkcji: y=f(x), parametryczne, biegunowe; pan/zoom/trace, analizy, tabela wartości. */
(function () {
  "use strict";
  const E = window.Engine;
  const KEY = "kalkulator-wykresy-v1";
  const COLORS = ["#0b5fff", "#d92d20", "#12b76a", "#f79009", "#7a5af8", "#0e9384"];
  let store = {
    mode: "cart",
    fns: [{ t: "x^2", on: true }, { t: "2*x-1", on: true }],
    pt: { x: "3*cos(t)", y: "3*sin(t)", t0: "0", t1: "6.2832" },
    polar: { r: "1+2*cos(theta)", th0: "0", th1: "6.2832" },
    ode: { f: "-2*y", x0: "0", y0: "1", x1: "5" },
    win: { xmin: -10, xmax: 10 },
    trace: false
  };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) store = Object.assign(store, s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  const card = document.createElement("section");
  card.className = "card wide";
  card.hidden = true;
  card.innerHTML = `
  <h2>WYKRESY</h2>
  <div class="g-tabs">
    <button type="button" data-m="cart" aria-selected="true">y = f(x)</button>
    <button type="button" data-m="param">parametryczna</button>
    <button type="button" data-m="polar">biegunowa</button>
    <button type="button" data-m="ode">y' = f(x,y)</button>
    <button type="button" data-m="table">tabela</button>
  </div>
  <div class="g-fns" id="gFns"></div>
  <div class="g-param" id="gParam" hidden>
    <div class="g-prow"><label>x(t)=</label><input id="gPX"></div>
    <div class="g-prow"><label>y(t)=</label><input id="gPY"></div>
    <div class="g-prow"><label>t od</label><input id="gPT0" inputmode=decimal><label>do</label><input id="gPT1" inputmode=decimal></div>
  </div>
  <div class="g-param" id="gPolar" hidden>
    <div class="g-prow"><label>r(θ)=</label><input id="gPR"></div>
    <div class="g-prow"><label>θ od</label><input id="gPTh0" inputmode=decimal><label>do</label><input id="gPTh1" inputmode=decimal></div>
  </div>
  <div class="g-param" id="gOde" hidden>
    <div class="g-prow"><label>y' =</label><input id="gOF" spellcheck="false" autocapitalize="off"></div>
    <div class="g-prow"><label>warunek: x₀ =</label><input id="gOX0" inputmode=decimal style="max-width:70px">
      <label>y₀ =</label><input id="gOY0" inputmode=decimal style="max-width:70px">
      <label>rysuj do x₁ =</label><input id="gOX1" inputmode=decimal style="max-width:70px"></div>
    <div class="g-prow" style="font-size:12px;color:var(--mut)">Krzywa całkowa przez punkt (x₀, y₀) — metoda Rungego-Kotty 4. rzędu.</div>
  </div>
  <div class="g-canvaswrap"><canvas id="gCanvas"></canvas><div class="g-readout" id="gRead" hidden></div></div>
  <div class="g-tools">
    <button type="button" id="gZin" title="Przybliż">＋</button>
    <button type="button" id="gZout" title="Oddal">－</button>
    <button type="button" id="gHome" title="Widok początkowy">⌂</button>
    <button type="button" id="gTrace" aria-selected="false" title="Śledzenie punktu">◎ trace</button>
    <span class="g-hint">przeciągnij = przesuwanie · kółko/szczypnięcie = zoom</span>
  </div>
  <div class="g-analysis" id="gAnalysis">
    <b>Analiza:</b>
    <button type="button" data-a="roots">miejsca zerowe</button>
    <button type="button" data-a="extrema">ekstrema</button>
    <button type="button" data-a="inter">przecięcia</button>
    <button type="button" data-a="int">całka</button>
    <div id="gIntInputs" hidden>
      a = <input id="gA" inputmode=decimal style="width:70px"> b = <input id="gB" inputmode=decimal style="width:70px">
      <button type="button" id="gIntGo">Policz</button>
    </div>
    <div id="gRes" class="g-res"></div>
  </div>
  <div class="g-table" id="gTableWrap" hidden>
    <div class="g-prow">
      <label>x od</label><input id="gT0" inputmode=decimal value="0">
      <label>do</label><input id="gT1" inputmode=decimal value="10">
      <label>krok</label><input id="gTStep" inputmode=decimal value="1">
    </div>
    <div class="g-tscroll"><table id="gTable"></table></div>
  </div>`;
  window.EXTRA_TABS = window.EXTRA_TABS || [];
  window.EXTRA_TABS.push({ id: "g", title: "WYKRESY", card });

  const $ = (q) => card.querySelector(q);
  const canvas = $("#gCanvas"), ctx = canvas.getContext("2d");
  const readout = $("#gRead");

  /* ---------- kompilacja funkcji ---------- */
  let compiled = [];
  function compileAll() {
    compiled = store.fns.map(f => {
      if (!f.on || !f.t.trim()) return null;
      try { return { fn: E.compile(f.t, "x"), expr: f.t }; } catch (e) { return { err: e.message, expr: f.t }; }
    });
  }

  /* ---------- okno widoku ---------- */
  function win() {
    const w = store.win;
    const cw = canvas.width / (window.devicePixelRatio || 1), ch = canvas.height / (window.devicePixelRatio || 1);
    const scale = (w.xmax - w.xmin) * (ch / cw);   // jednostki kwadratowe
    const xc = (w.xmin + w.xmax) / 2;
    return { xmin: w.xmin, xmax: w.xmax, ymin: xc - scale / 2, ymax: xc + scale / 2, w: cw, h: ch };
  }
  const X2P = (W, x) => (x - W.xmin) / (W.xmax - W.xmin) * W.w;
  const Y2P = (W, y) => W.h - (y - W.ymin) / (W.ymax - W.ymin) * W.h;
  const P2X = (W, px) => W.xmin + px / W.w * (W.xmax - W.xmin);
  const P2Y = (W, py) => W.ymin + (W.h - py) / W.h * (W.ymax - W.ymin);

  function niceStep(range, target) {
    const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }
  function fmtTick(v, step) {
    const d = Math.max(0, -Math.floor(Math.log10(step)) + 0);
    return v.toFixed(Math.min(d, 6)).replace(/\.?0+$/, "");
  }

  /* ---------- rysowanie ---------- */
  let analysisMarks = { roots: [], extrema: [], inter: [], area: null };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.width * 0.8 * dpr);
    canvas.style.height = Math.round(rect.width * 0.8) + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const W = win(), css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--card").trim(), fg = css.getPropertyValue("--fg").trim(),
          mut = css.getPropertyValue("--mut").trim(), line = css.getPropertyValue("--line").trim(),
          acc = css.getPropertyValue("--acc").trim();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W.w, W.h);
    // siatka
    const sx = niceStep(W.xmax - W.xmin, W.w / 70), sy = niceStep(W.ymax - W.ymin, W.h / 60);
    ctx.strokeStyle = line; ctx.fillStyle = mut; ctx.lineWidth = 1;
    ctx.font = "10px -apple-system,sans-serif";
    for (let x = Math.ceil(W.xmin / sx) * sx; x <= W.xmax; x += sx) {
      const px = X2P(W, x);
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, W.h); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(fmtTick(x, sx), px + 2, Math.min(Math.max(Y2P(W, 0) + 11, 11), W.h - 3));
    }
    for (let y = Math.ceil(W.ymin / sy) * sy; y <= W.ymax; y += sy) {
      const py = Y2P(W, y);
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W.w, py); ctx.stroke(); ctx.globalAlpha = 1;
      if (Math.abs(y) > sx / 10) ctx.fillText(fmtTick(y, sy), Math.min(Math.max(X2P(W, 0) + 3, 3), W.w - 30), py - 2);
    }
    // osie
    ctx.strokeStyle = mut; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(X2P(W, 0), 0); ctx.lineTo(X2P(W, 0), W.h);
    ctx.moveTo(0, Y2P(W, 0)); ctx.lineTo(W.w, Y2P(W, 0)); ctx.stroke();
    // pole pod całką
    if (analysisMarks.area) {
      const { fn, a, b } = analysisMarks.area;
      ctx.fillStyle = "rgba(11,95,255,.14)";
      ctx.beginPath();
      let started = false;
      const n = 200;
      for (let k = 0; k <= n; k++) {
        const x = a + (b - a) * k / n, y = fn(x);
        if (!isFinite(y)) continue;
        const px = X2P(W, x), py = Y2P(W, Math.max(Math.min(y, W.ymax), W.ymin));
        started ? ctx.lineTo(px, py) : (ctx.moveTo(px, Y2P(W, 0)), ctx.lineTo(px, py), started = true);
      }
      if (started) { ctx.lineTo(X2P(W, b), Y2P(W, 0)); ctx.closePath(); ctx.fill(); }
    }
    // krzywe
    if (store.mode === "cart") {
      compiled.forEach((c, i) => {
        if (!c || c.err) return;
        ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.lineWidth = 2;
        ctx.beginPath();
        const n = Math.min(1400, Math.round(W.w * 1.5));
        let prevY = null;
        for (let k = 0; k <= n; k++) {
          const x = W.xmin + (W.xmax - W.xmin) * k / n;
          const y = c.fn(x);
          const px = X2P(W, x);
          const jump = prevY !== null && isFinite(prevY) && isFinite(y) && Math.abs(y - prevY) > (W.ymax - W.ymin) * 1.5;
          if (!isFinite(y) || y > 1e6 || y < -1e6 || jump) { ctx.beginPath(); prevY = y; continue; }
          const py = Y2P(W, y);
          if (Math.abs(py) > 1e5) { prevY = y; continue; }
          ctx.lineTo(px, py);
          prevY = y;
        }
        ctx.stroke();
      });
    } else if (store.mode === "param" || store.mode === "polar") {
      const { fx, fy, t0, t1 } = paramFns();
      if (fx && fy) {
        ctx.strokeStyle = COLORS[0]; ctx.lineWidth = 2;
        ctx.beginPath();
        const n = 1200;
        for (let k = 0; k <= n; k++) {
          const t = t0 + (t1 - t0) * k / n;
          const px = X2P(W, fx(t)), py = Y2P(W, fy(t));
          if (!isFinite(px) || !isFinite(py)) continue;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    } else if (store.mode === "ode") {
      odePtsAll = drawOde(W);
      // znacznik warunku początkowego
      const x0 = num(store.ode.x0, 0), y0 = num(store.ode.y0, 1);
      if (isFinite(x0) && isFinite(y0)) {
        ctx.fillStyle = acc; ctx.strokeStyle = bg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X2P(W, x0), Y2P(W, y0), 5, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    // znaczniki analiz
    const mark = (x, y, kind, color) => {
      const px = X2P(W, x), py = Y2P(W, y);
      ctx.strokeStyle = color; ctx.fillStyle = bg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    };
    analysisMarks.roots.forEach(r => isFinite(r.y) && mark(r.x, r.y, "root", acc));
    analysisMarks.extrema.forEach(e2 => mark(e2.x, e2.y, "ext", "#f79009"));
    analysisMarks.inter.forEach(p => mark(p.x, p.y, "int", "#12b76a"));
    // trace
    if (tracePt) {
      ctx.strokeStyle = mut; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X2P(W, tracePt.x), 0); ctx.lineTo(X2P(W, tracePt.x), W.h);
      ctx.moveTo(0, Y2P(W, tracePt.y)); ctx.lineTo(W.w, Y2P(W, tracePt.y));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(X2P(W, tracePt.x), Y2P(W, tracePt.y), 5, 0, 7); ctx.fill();
    }
  }

  function paramFns() {
    try {
      if (store.mode === "param") {
        return { fx: E.compile(store.pt.x, "t"), fy: E.compile(store.pt.y, "t"), t0: num(store.pt.t0, 0), t1: num(store.pt.t1, 2 * Math.PI) };
      }
      const r = E.compile(store.polar.r, "t");
      const t0 = num(store.polar.th0, 0), t1 = num(store.polar.th1, 2 * Math.PI);
      return { fx: (t) => r(t) * Math.cos(t), fy: (t) => r(t) * Math.sin(t), t0, t1 };
    } catch (e) { return {}; }
  }
  const num = (v, d) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : d; };

  /* ---------- ODE: krzywa całkowa y' = f(x, y) przez (x0, y0) ---------- */
  let odePtsAll = [];
  function drawOde(W) {
    let pts = [];
    try {
      const f = E.compile2(store.ode.f, "x", "y");
      const x0 = num(store.ode.x0, 0), y0 = num(store.ode.y0, 1), x1 = num(store.ode.x1, 5);
      if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || x0 === x1) return pts;
      const fwd = E.odeRK4(f, x0, y0, x1, 900);
      const bwd = E.odeRK4(f, x0, y0, 2 * x0 - x1, 900);
      pts = bwd.reverse().concat(fwd);
    } catch (e) { return pts; }
    ctx.strokeStyle = COLORS[0]; ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const [px, py] of pts) {
      if (!isFinite(py)) { started = false; continue; }
      const sx = X2P(W, px), sy = Y2P(W, py);
      if (sy < -3000 || sy > 3000) { started = false; continue; }
      started ? ctx.lineTo(sx, sy) : (ctx.moveTo(sx, sy), started = true);
    }
    ctx.stroke();
    return pts;
  }

  /* ---------- interakcje: pan / zoom / trace ---------- */
  let drag = null, pointers = new Map(), tracePt = null, pinch = null;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), win: { ...store.win } };
      drag = null;
    } else if (store.trace) {
      moveTrace(ev.offsetX);
    } else {
      drag = { x: ev.offsetX, win: { ...store.win } };
    }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (pinch && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const k = pinch.d / Math.max(d, 10);
      const W0 = pinch.win, cx = (W0.xmin + W0.xmax) / 2, half = (W0.xmax - W0.xmin) / 2 * k;
      store.win = { xmin: cx - half, xmax: cx + half };
      save(); draw();
      return;
    }
    if (drag) {
      const W = win();
      const dx = (ev.offsetX - drag.x) / W.w * (drag.win.xmax - drag.win.xmin);
      store.win = { xmin: drag.win.xmin - dx, xmax: drag.win.xmax - dx };
      draw();
    } else if (store.trace) {
      moveTrace(ev.offsetX);
    }
  });
  const endPointer = (ev) => { pointers.delete(ev.pointerId); if (pointers.size < 2) pinch = null; drag = null; };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const W = win();
    const cx = P2X(W, ev.offsetX), k = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    store.win = { xmin: cx - (cx - W.xmin) * k, xmax: cx + (W.xmax - cx) * k };
    save(); draw();
  }, { passive: false });

  function moveTrace(px) {
    const W = win(), x = P2X(W, px);
    if (store.mode === "cart") {
      const c = compiled.find(c2 => c2 && !c2.err);
      if (!c) return;
      const y = c.fn(x);
      tracePt = isFinite(y) ? { x, y } : { x, y: 0 };
      showRead(`x = ${E.fmtNum(x)}   y = ${isFinite(y) ? E.fmtNum(y) : "—"}`);
    } else if (store.mode === "ode") {
      if (!odePtsAll.length) return;
      let best = odePtsAll[0];
      for (const p of odePtsAll) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      tracePt = { x: best[0], y: best[1] };
      showRead(`x = ${E.fmtNum(best[0])}   y ≈ ${E.fmtNum(best[1])}`);
    } else {
      const { fx, fy, t0, t1 } = paramFns();
      if (!fx) return;
      const t = t0 + (px / W.w) * (t1 - t0);
      tracePt = { x: fx(t), y: fy(t) };
      showRead(`t = ${E.fmtNum(t)}   x = ${E.fmtNum(tracePt.x)}   y = ${E.fmtNum(tracePt.y)}`);
    }
    draw();
  }
  function showRead(text) { readout.hidden = false; readout.textContent = text; }

  $("#gZin").onclick = () => zoom(1 / 1.4);
  $("#gZout").onclick = () => zoom(1.4);
  $("#gHome").onclick = () => { store.win = { xmin: -10, xmax: 10 }; save(); draw(); };
  $("#gTrace").onclick = () => {
    store.trace = !store.trace;
    $("#gTrace").setAttribute("aria-selected", String(store.trace));
    if (!store.trace) { tracePt = null; readout.hidden = true; draw(); }
  };
  function zoom(k) {
    const cx = (store.win.xmin + store.win.xmax) / 2, half = (store.win.xmax - store.win.xmin) / 2 * k;
    store.win = { xmin: cx - half, xmax: cx + half };
    save(); draw();
  }

  /* ---------- lista funkcji ---------- */
  const gFns = $("#gFns");
  function renderFns() {
    gFns.innerHTML = "";
    if (store.mode !== "cart") { gFns.hidden = true; return; }
    gFns.hidden = false;
    store.fns.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "g-fnrow";
      row.innerHTML = `<span class="g-dot" style="background:${COLORS[i % COLORS.length]}"></span>
        <span class="g-eq">y=</span>
        <input value="${escapeAttr(f.t)}" spellcheck="false" autocapitalize="off">
        <button type="button" class="g-eye" aria-selected="${f.on}" title="Pokaż/ukryj">${f.on ? "👁" : "—"}</button>
        <button type="button" class="g-del" title="Usuń">✕</button>`;
      const inp = row.querySelector("input");
      inp.addEventListener("input", () => { f.t = inp.value; compileAll(); save(); draw(); scheduleTable(); });
      row.querySelector(".g-eye").onclick = (ev) => { f.on = !f.on; save(); compileAll(); renderFns(); draw(); scheduleTable(); };
      row.querySelector(".g-del").onclick = () => { store.fns.splice(i, 1); save(); compileAll(); renderFns(); draw(); scheduleTable(); };
      gFns.appendChild(row);
    });
    if (store.fns.length < 6) {
      const add = document.createElement("button");
      add.type = "button"; add.className = "g-add"; add.textContent = "+ dodaj funkcję";
      add.onclick = () => { store.fns.push({ t: "", on: true }); renderFns(); };
      gFns.appendChild(add);
    }
  }
  function escapeAttr(t) { return String(t).replace(/"/g, "&quot;"); }

  /* ---------- tryby ---------- */
  const tabsEl = card.querySelector(".g-tabs");
  tabsEl.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
    store.mode = b.dataset.m; save();
    tabsEl.querySelectorAll("[data-m]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    $("#gParam").hidden = store.mode !== "param";
    $("#gPolar").hidden = store.mode !== "polar";
    $("#gOde").hidden = store.mode !== "ode";
    $("#gAnalysis").hidden = store.mode === "table" || store.mode === "ode";
    $("#gTableWrap").hidden = store.mode !== "table";
    renderFns(); draw(); scheduleTable();
    if (store.mode === "table") buildTable();
  });

  function bindParam(id, key) {
    const el = $(id);
    el.value = store[store.mode === "param" ? "pt" : "polar"][key];
    el.addEventListener("input", () => {
      store[store.mode === "param" ? "pt" : "polar"][key] = el.value;
      save(); draw();
    });
  }
  function bindParamAll() {
    const map = [["#gPX", "x"], ["#gPY", "y"], ["#gPT0", "t0"], ["#gPT1", "t1"]];
    map.forEach(([id, k]) => {
      const el = $(id); el.value = store.pt[k];
      el.oninput = () => { store.pt[k] = el.value; save(); draw(); };
    });
    const m2 = [["#gPR", "r"], ["#gPTh0", "th0"], ["#gPTh1", "th1"]];
    m2.forEach(([id, k]) => {
      const el = $(id); el.value = store.polar[k];
      el.oninput = () => { store.polar[k] = el.value; save(); draw(); };
    });
    const m3 = [["#gOF", "f"], ["#gOX0", "x0"], ["#gOY0", "y0"], ["#gOX1", "x1"]];
    m3.forEach(([id, k]) => {
      const el = $(id); el.value = store.ode[k];
      el.oninput = () => { store.ode[k] = el.value; save(); draw(); };
    });
  }

  /* ---------- analizy ---------- */
  const resEl = $("#gRes");
  function firstVisible() {
    const i = compiled.findIndex(c => c && !c.err);
    return i >= 0 ? { c: compiled[i], i } : null;
  }
  card.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "int") { $("#gIntInputs").hidden = !$("#gIntInputs").hidden; return; }
    const f = firstVisible();
    if (!f) { resEl.textContent = "Brak funkcji do analizy."; return; }
    const W = win();
    if (a === "roots") {
      const roots = E.findRoots(f.c.fn, W.xmin, W.xmax);
      analysisMarks = { ...analysisMarks, roots: roots.map(x => ({ x, y: 0 })), extrema: [], inter: [], area: null };
      resEl.textContent = roots.length
        ? "Miejsca zerowe: " + roots.map(x => `x ≈ ${E.fmtNum(x)}`).join(", ")
        : "Brak miejsc zerowych w widocznym zakresie.";
    } else if (a === "extrema") {
      const ext = E.findExtrema(f.c.fn, W.xmin, W.xmax);
      analysisMarks = { ...analysisMarks, extrema: ext, roots: [], inter: [], area: null };
      resEl.innerHTML = ext.length
        ? ext.map(e2 => `${e2.type === "min" ? "Minimum" : "Maksimum"}: (${E.fmtNum(e2.x)}, ${E.fmtNum(e2.y)})`).join("<br>")
        : "Brak ekstremów w widocznym zakresie.";
    } else if (a === "inter") {
      const vis = compiled.map((c, i) => ({ c, i })).filter(o => o.c && !o.c.err);
      if (vis.length < 2) { resEl.textContent = "Potrzebne dwie widoczne funkcje."; return; }
      const [c1, c2] = vis;
      const g = (x) => c1.c.fn(x) - c2.c.fn(x);
      const roots = E.findRoots(g, W.xmin, W.xmax);
      analysisMarks = { ...analysisMarks, inter: roots.map(x => ({ x, y: c1.c.fn(x) })), roots: [], extrema: [], area: null };
      resEl.textContent = roots.length
        ? "Punkty przecięcia: " + roots.map(x => `(${E.fmtNum(x)}, ${E.fmtNum(c1.c.fn(x))})`).join(", ")
        : "Brak przecięć w widocznym zakresie.";
    }
    draw();
  });
  $("#gIntGo").onclick = () => {
    const f = firstVisible();
    if (!f) return;
    const a = num($("#gA").value, NaN), b = num($("#gB").value, NaN);
    if (!isFinite(a) || !isFinite(b) || a === b) { resEl.textContent = "Podaj różne krańce a i b."; return; }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const val = E.simpson(f.c.fn, lo, hi, 2000);
    analysisMarks = { ...analysisMarks, area: { fn: f.c.fn, a: lo, b: hi }, roots: [], extrema: [], inter: [] };
    resEl.textContent = `∫[${E.fmtNum(lo)}, ${E.fmtNum(hi)}] ${f.c.expr} dx ≈ ${E.fmtNum(val)}`;
    draw();
  };

  /* ---------- tabela wartości ---------- */
  let tableTimer = null;
  function scheduleTable() { if (store.mode === "table") { clearTimeout(tableTimer); tableTimer = setTimeout(buildTable, 250); } }
  function buildTable() {
    const t0 = num($("#gT0").value, 0), t1 = num($("#gT1").value, 10), st = Math.abs(num($("#gTStep").value, 1)) || 1;
    const table = $("#gTable");
    if (store.mode !== "table") return;
    const vis = compiled.map((c, i) => ({ c, i })).filter(o => o.c && !o.c.err).slice(0, 4);
    if (!vis.length) { table.innerHTML = "<tr><td><i>Dodaj funkcję w trybie y=f(x).</i></td></tr>"; return; }
    let html = "<tr><th>x</th>" + vis.map(o => `<th>y${o.i + 1}=${escapeAttr(o.c.expr)}</th>`).join("") + "</tr>";
    if ((t1 - t0) / st > 500) { table.innerHTML = `<tr><td>Zakres za duży dla kroku ${st}.</td></tr>`; return; }
    for (let x = t0; (st > 0 ? x <= t1 + 1e-12 : x >= t1 - 1e-12); x += st) {
      html += `<tr><td><b>${E.fmtNum(Math.round(x * 1e10) / 1e10)}</b></td>` +
        vis.map(o => { const y = o.c.fn(x); return `<td>${isFinite(y) ? E.fmtNum(Math.round(y * 1e10) / 1e10) : "—"}</td>`; }).join("") + "</tr>";
    }
    table.innerHTML = html;
  }
  ["#gT0", "#gT1", "#gTStep"].forEach(id => $(id).addEventListener("input", scheduleTable));

  /* ---------- start ---------- */
  window.addEventListener("resize", resize);
  window.addEventListener("cp-mode-change", () => { compileAll(); draw(); scheduleTable(); });
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  compileAll();
  renderFns();
  bindParamAll();
  resize();
})();
