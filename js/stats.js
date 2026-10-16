/* STATYSTYKA — statystyka opisowa, regresje, rozkłady prawdopodobieństwa, kombinatoryka, histogram. */
(function () {
  "use strict";
  const math = window.math;
  const E = window.Engine;
  const KEY = "kalkulator-statystyka-v1";
  let store = { data: "5\n7\n7\n8\n10\n12\n15", dataY: "", pairs: false };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) store = Object.assign(store, s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  const card = document.createElement("section");
  card.className = "card wide";
  card.hidden = true;
  card.innerHTML = `
  <h2>STATYSTYKA</h2>
  <div class="s-tabs">
    <button type="button" data-s="desc" aria-selected="true">opisowa</button>
    <button type="button" data-s="reg">regresja</button>
    <button type="button" data-s="distr">rozkłady</button>
    <button type="button" data-s="comb">kombinatoryka</button>
  </div>
  <div class="s-pairtoggle">
    <label><input type="checkbox" id="sPairs"> dane parami (x, y) — dwie kolumny</label>
  </div>
  <div class="s-data">
    <textarea id="sData" rows="4" spellcheck="false" placeholder="wartości x — jedna na wiersz lub po przecinku"></textarea>
    <textarea id="sDataY" rows="4" spellcheck="false" placeholder="wartości y (dla par x,y)" hidden></textarea>
  </div>
  <canvas id="sHist" height="120"></canvas>
  <div id="sDesc" class="s-section"></div>
  <div id="sReg" class="s-section" hidden>
    <div class="s-row">
      <label>Model</label>
      <select id="sModel">
        <option value="lin">liniowa y = a + b·x</option>
        <option value="quad">kwadratowa y = a + b·x + c·x²</option>
        <option value="cubic">sześcienna y = a + b·x + c·x² + d·x³</option>
        <option value="exp">wykładnicza y = a·e^(b·x)</option>
        <option value="log">logarytmiczna y = a + b·ln(x)</option>
        <option value="pow">potęgowa y = a·x^b</option>
      </select>
    </div>
    <div class="s-row"><label>Prognoza dla x =</label><input id="sPredX" inputmode=decimal style="max-width:110px"></div>
    <div id="sRegOut"></div>
  </div>
  <div id="sDistr" class="s-section" hidden>
    <h3>Rozkład normalny N(μ, σ)</h3>
    <div class="s-row">μ <input id="nMu" value="0" inputmode=decimal style="max-width:80px">
      σ <input id="nSg" value="1" inputmode=decimal style="max-width:80px">
      x <input id="nX" value="1" inputmode=decimal style="max-width:80px">
      <button type="button" id="nGo">P(X&lt;x)</button></div>
    <div id="nOut" class="s-miniout"></div>
    <h3>Rozkład dwumianowy B(n, p)</h3>
    <div class="s-row">n <input id="bN" value="10" inputmode=numeric style="max-width:70px">
      p <input id="bP" value="0.5" inputmode=decimal style="max-width:80px">
      k <input id="bK" value="5" inputmode=numeric style="max-width:70px">
      <button type="button" id="bGo">P(X=k) i P(X≤k)</button></div>
    <div id="bOut" class="s-miniout"></div>
    <h3>Rozkład Poissona P(λ)</h3>
    <div class="s-row">λ <input id="pL" value="2" inputmode=decimal style="max-width:80px">
      k <input id="pK" value="3" inputmode=numeric style="max-width:70px">
      <button type="button" id="pGo">P(X=k) i P(X≤k)</button></div>
    <div id="pOut" class="s-miniout"></div>
  </div>
  <div id="sComb" class="s-section" hidden>
    <div class="s-row">n <input id="cN" value="10" inputmode=numeric style="max-width:80px">
      k <input id="cK" value="3" inputmode=numeric style="max-width:80px"></div>
    <div id="cOut" class="s-miniout"></div>
  </div>`;
  window.EXTRA_TABS = window.EXTRA_TABS || [];
  window.EXTRA_TABS.push({ id: "s", title: "STATYSTYKA", card });

  const $ = (q) => card.querySelector(q);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v) => E.fmtNum(Math.round(v * 1e10) / 1e10);
  const numOf = (s) => { const v = parseFloat(String(s).trim().replace(",", ".")); return isFinite(v) ? v : null; };

  /* ---------- dane ---------- */
  function parseData(txt) {
    return String(txt).split(/[\n;]+/).flatMap(s => s.split(",")).map(s => numOf(s)).filter(v => v !== null);
  }
  function parsePairs() {
    const xs = parseData(store.data), ys = parseData(store.dataY);
    const n = Math.min(xs.length, ys.length);
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([xs[i], ys[i]]);
    return pairs;
  }

  /* ---------- statystyka opisowa ---------- */
  function describe(xs) {
    if (!xs.length) return null;
    const n = xs.length, sorted = [...xs].sort((a, b) => a - b);
    const sum = xs.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const q = (p) => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
    const med = q(0.5);
    const varP = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const varS = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : NaN;
    const counts = new Map();
    xs.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const maxC = Math.max(...counts.values());
    const modes = maxC > 1 ? [...counts.entries()].filter(([, c]) => c === maxC).map(([v]) => v) : [];
    return {
      n, sum, mean, med, modes, min: sorted[0], max: sorted[n - 1],
      q1: q(0.25), q3: q(0.75), range: sorted[n - 1] - sorted[0], iqr: q(0.75) - q(0.25),
      varP, varS, sdP: Math.sqrt(varP), sdS: Math.sqrt(varS), sumSq: xs.reduce((a, b) => a + b * b, 0)
    };
  }

  function renderDesc() {
    const out = $("#sDesc");
    const xs = parseData(store.data);
    if (store.pairs) {
      const pairs = parsePairs();
      if (pairs.length < 2) { out.innerHTML = "<i>Podaj co najmniej 2 pary x,y.</i>"; return; }
      const d = describe(pairs.map(p => p[0])), d2 = describe(pairs.map(p => p[1]));
      out.innerHTML = descTable(d, "x") + descTable(d2, "y");
    } else {
      const d = describe(xs);
      out.innerHTML = d ? descTable(d, "") : "<i>Podaj dane liczbowe.</i>";
    }
  }
  function descTable(d, lbl) {
    const r = (k, v) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`;
    return `<div class="s-resblock"><div class="m-reslabel">Zmienna ${lbl || "dane"}</div><table class="s-table">
      ${r("liczebność n", d.n)}${r("suma Σx", fmt(d.sum))}${r("średnia x̄", fmt(d.mean))}
      ${r("mediana", fmt(d.med))}${r("dominanta", d.modes.length ? d.modes.map(fmt).join(", ") : "—")}
      ${r("min / maks", `${fmt(d.min)} / ${fmt(d.max)}`)}${r("rozstęp", fmt(d.range))}
      ${r("kwartyl Q1 / Q3", `${fmt(d.q1)} / ${fmt(d.q3)}`)}${r("rozstęp międzykwartylowy", fmt(d.iqr))}
      ${r("wariancja (pop./prób.)", `${fmt(d.varP)} / ${fmt(d.varS)}`)}
      ${r("odchylenie σ / s", `${fmt(d.sdP)} / ${fmt(d.sdS)}`)}${r("Σx²", fmt(d.sumSq))}
    </table></div>`;
  }

  /* ---------- histogram ---------- */
  function drawHist() {
    const cv = $("#sHist"), c = cv.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || cv.parentElement.clientWidth;
    if (!w) return;
    cv.width = w * dpr; cv.height = 120 * dpr; cv.style.height = "120px";
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const xs = parseData(store.data);
    c.fillStyle = css.getPropertyValue("--card").trim(); c.fillRect(0, 0, w, 120);
    if (xs.length < 2) return;
    const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(xs.length))));
    const min = Math.min(...xs), max = Math.max(...xs), bw = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    xs.forEach(v => counts[Math.min(bins - 1, Math.floor((v - min) / bw))]++);
    const maxC = Math.max(...counts);
    const barW = w / bins;
    for (let i = 0; i < bins; i++) {
      const h = counts[i] / maxC * 100;
      c.fillStyle = css.getPropertyValue("--acc").trim();
      c.globalAlpha = 0.75;
      c.fillRect(i * barW + 1, 110 - h, barW - 2, h);
      c.globalAlpha = 1;
      if (counts[i]) {
        c.fillStyle = css.getPropertyValue("--mut").trim();
        c.font = "9px -apple-system,sans-serif";
        c.fillText(String(counts[i]), i * barW + barW / 2 - 4, 108 - h);
      }
    }
    c.fillStyle = css.getPropertyValue("--mut").trim();
    c.fillText(fmt(min), 2, 118);
    const tw = c.measureText(fmt(max)).width;
    c.fillText(fmt(max), w - tw - 2, 118);
  }

  /* ---------- regresja ---------- */
  function polyfit(xs, ys, deg) {
    const n = xs.length;
    const m = deg + 1;
    const ATA = [], ATy = [];
    for (let i = 0; i < m; i++) {
      ATA.push(new Array(m).fill(0));
      ATy.push(0);
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < m; j++) ATA[i][j] += Math.pow(xs[k], i + j);
        ATy[i] += Math.pow(xs[k], i) * ys[k];
      }
    }
    const sol = math.lusolve(ATA, ATy).toArray().flat();
    return sol;
  }
  function polyEval(coef, x) { return coef.reduce((a, c, i) => a + c * Math.pow(x, i), 0); }

  function runReg() {
    const out = $("#sRegOut");
    const pairs = parsePairs();
    if (pairs.length < 2) { out.innerHTML = "<i>Podaj co najmniej 2 pary x,y.</i>"; return; }
    const model = $("#sModel").value;
    let xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
    let coef, formula, predict;
    try {
      if (model === "lin") {
        coef = polyfit(xs, ys, 1);
        formula = `y = ${fmt(coef[0])} + ${fmt(coef[1])}·x`;
        predict = (x) => polyEval(coef, x);
      } else if (model === "quad") {
        coef = polyfit(xs, ys, 2);
        formula = `y = ${fmt(coef[0])} + ${fmt(coef[1])}·x + ${fmt(coef[2])}·x²`;
        predict = (x) => polyEval(coef, x);
      } else if (model === "cubic") {
        coef = polyfit(xs, ys, 3);
        formula = `y = ${fmt(coef[0])} + ${fmt(coef[1])}·x + ${fmt(coef[2])}·x² + ${fmt(coef[3])}·x³`;
        predict = (x) => polyEval(coef, x);
      } else if (model === "exp") {
        if (ys.some(v => v <= 0)) throw new Error("Model wykładniczy wymaga y > 0.");
        const b = polyfit(xs, ys.map(Math.log), 1);
        coef = b;
        formula = `y = ${fmt(Math.exp(b[0]))}·e^(${fmt(b[1])}·x)`;
        predict = (x) => Math.exp(b[0]) * Math.exp(b[1] * x);
      } else if (model === "log") {
        if (xs.some(v => v <= 0)) throw new Error("Model logarytmiczny wymaga x > 0.");
        const b = polyfit(xs.map(Math.log), ys, 1);
        coef = b;
        formula = `y = ${fmt(b[0])} + ${fmt(b[1])}·ln(x)`;
        predict = (x) => b[0] + b[1] * Math.log(x);
      } else {
        if (xs.some(v => v <= 0) || ys.some(v => v <= 0)) throw new Error("Model potęgowy wymaga x > 0 i y > 0.");
        const b = polyfit(xs.map(Math.log), ys.map(Math.log), 1);
        coef = b;
        formula = `y = ${fmt(Math.exp(b[0]))}·x^${fmt(b[1])}`;
        predict = (x) => Math.exp(b[0]) * Math.pow(x, b[1]);
      }
      // R²
      const ym = ys.reduce((a, b2) => a + b2, 0) / ys.length;
      const ssTot = ys.reduce((a, v) => a + (v - ym) ** 2, 0);
      const ssRes = ys.reduce((a, v, i) => a + (v - predict(xs[i])) ** 2, 0);
      const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
      const r = ssTot > 0 && (model === "lin") ? Math.sign(coef[1]) * Math.sqrt(Math.max(r2, 0)) : null;
      out.innerHTML = `<div class="s-resblock"><table class="s-table">
        <tr><td>Wzór</td><td><b>${esc(formula)}</b></td></tr>
        ${r !== null ? `<tr><td>współczynnik korelacji r</td><td><b>${fmt(r)}</b></td></tr>` : ""}
        <tr><td>R²</td><td><b>${fmt(r2)}</b></td></tr>
      </table></div>`;
      const px = numOf($("#sPredX").value);
      if (px !== null) {
        out.innerHTML += `<div class="s-pred">Prognoza: y(${fmt(px)}) ≈ <b>${fmt(predict(px))}</b></div>`;
      }
    } catch (err) {
      out.innerHTML = `<span class="cp-err">${esc(err.message)}</span>`;
    }
  }

  /* ---------- rozkłady ---------- */
  function normalCdf(x, mu, sg) { return 0.5 * (1 + math.erf((x - mu) / (sg * Math.SQRT2))); }
  function normalPdf(x, mu, sg) { return Math.exp(-((x - mu) ** 2) / (2 * sg * sg)) / (sg * Math.sqrt(2 * Math.PI)); }
  function binomPmf(k, n, p) {
    if (k < 0 || k > n) return 0;
    return Math.exp(logChoose(k, n) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  function logChoose(k, n) { return logFact(n) - logFact(k) - logFact(n - k); }
  const LOGF = [0];
  function logFact(n) {
    for (let i = LOGF.length; i <= n; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
    return LOGF[n];
  }
  function poissonPmf(k, l) { return Math.exp(-l + k * Math.log(l) - logFact(k)); }

  $("#nGo").onclick = () => {
    const mu = numOf($("#nMu").value), sg = numOf($("#nSg").value), x = numOf($("#nX").value);
    const out = $("#nOut");
    if (sg === null || sg <= 0 || mu === null || x === null) { out.innerHTML = err("Sprawdź μ, σ (σ>0) i x."); return; }
    const p = normalCdf(x, mu, sg);
    out.innerHTML = `P(X&lt;x) = <b>${fmt(p)}</b> &nbsp;·&nbsp; gęstość f(x) = ${fmt(normalPdf(x, mu, sg))}`;
  };
  $("#bGo").onclick = () => {
    const n = parseInt($("#bN").value, 10), p = numOf($("#bP").value), k = parseInt($("#bK").value, 10);
    const out = $("#bOut");
    if (!Number.isInteger(n) || n < 1 || p === null || p < 0 || p > 1 || !Number.isInteger(k)) { out.innerHTML = err("Sprawdź n, p∈[0,1], k."); return; }
    let cum = 0;
    for (let i = 0; i <= k; i++) cum += binomPmf(i, n, p);
    out.innerHTML = `P(X=k) = <b>${fmt(binomPmf(k, n, p))}</b> &nbsp;·&nbsp; P(X≤k) = <b>${fmt(Math.min(cum, 1))}</b>`;
  };
  $("#pGo").onclick = () => {
    const l = numOf($("#pL").value), k = parseInt($("#pK").value, 10);
    const out = $("#pOut");
    if (l === null || l <= 0 || !Number.isInteger(k) || k < 0) { out.innerHTML = err("Sprawdź λ>0 i k≥0."); return; }
    let cum = 0;
    for (let i = 0; i <= k; i++) cum += poissonPmf(i, l);
    out.innerHTML = `P(X=k) = <b>${fmt(poissonPmf(k, l))}</b> &nbsp;·&nbsp; P(X≤k) = <b>${fmt(cum)}</b>`;
  };
  const err = (m) => `<span class="cp-err">${esc(m)}</span>`;

  /* ---------- kombinatoryka ---------- */
  function bigFact(n) { let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; return r; }
  function runComb() {
    const n = parseInt($("#cN").value, 10), k = parseInt($("#cK").value, 10);
    const out = $("#cOut");
    if (!Number.isInteger(n) || n < 0 || n > 500 || !Number.isInteger(k) || k < 0 || k > n) {
      out.innerHTML = err("Podaj 0 ≤ k ≤ n ≤ 500."); return;
    }
    const nPr = bigFact(n) / bigFact(n - k);
    const nCr = nPr / bigFact(k);
    out.innerHTML = `<table class="s-table">
      <tr><td>${n}! </td><td><b>${bigFact(n)}</b></td></tr>
      <tr><td>${n}P${k} (wariacje bez powtórzeń)</td><td><b>${nPr}</b></td></tr>
      <tr><td>${n}C${k} = ${"C"}(${n},${k}) (kombinacje)</td><td><b>${nCr}</b></td></tr>
    </table>`;
  }

  /* ---------- zakładki i zdarzenia ---------- */
  card.querySelectorAll("[data-s]").forEach(b => b.onclick = () => {
    card.querySelectorAll("[data-s]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    $("#sDesc").hidden = b.dataset.s !== "desc";
    $("#sReg").hidden = b.dataset.s !== "reg";
    $("#sDistr").hidden = b.dataset.s !== "distr";
    $("#sComb").hidden = b.dataset.s !== "comb";
    if (b.dataset.s === "reg") runReg();
    if (b.dataset.s === "comb") runComb();
    if (b.dataset.s === "desc") drawHist();
  });
  const dataEl = $("#sData"), dataYEl = $("#sDataY");
  dataEl.value = store.data; dataYEl.value = store.dataY;
  function dataChanged() {
    store.data = dataEl.value; store.dataY = dataYEl.value; save();
    renderDesc(); drawHist();
    if (!$("#sReg").hidden) runReg();
  }
  dataEl.addEventListener("input", dataChanged);
  dataYEl.addEventListener("input", dataChanged);
  $("#sPairs").checked = !!store.pairs;
  dataYEl.hidden = !store.pairs;
  $("#sPairs").addEventListener("change", (ev) => {
    store.pairs = ev.target.checked; save();
    dataYEl.hidden = !store.pairs;
    renderDesc();
  });
  $("#sModel").addEventListener("change", runReg);
  $("#sPredX").addEventListener("input", runReg);
  window.addEventListener("cp-mode-change", drawHist);
  window.addEventListener("resize", drawHist);

  renderDesc();
  requestAnimationFrame(drawHist);
})();
