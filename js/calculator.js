/* KALKULATOR — zakładka w stylu ClassPad II: klawiatura, historia, DEG/RAD, dokładne i przybliżone wyniki. */
(function () {
  "use strict";
  const E = window.Engine, CB = window.CasBridge;
  const KEY = "kalkulator-classpad-v1";
  let store = { hist: [], deg: false, exact: true };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === "object") store = Object.assign(store, s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  E.setDeg(!!store.deg);

  const card = document.createElement("section");
  card.className = "card";
  card.hidden = true;
  card.innerHTML = `
  <h2>KALKULATOR</h2>
  <div class="cp-topbar">
    <div class="cp-seg" role="group" aria-label="Jednostka kąta">
      <button type="button" data-mode="deg">RAD</button><button type="button" data-mode="deg2">DEG</button>
    </div>
    <div class="cp-seg" role="group" aria-label="Forma wyniku">
      <button type="button" id="cpExact" title="Przełącz dokładny / dziesiętny">s⇔D</button>
    </div>
    <button type="button" id="cpClear" class="cp-ghost" title="Wyczyść historię">🗑</button>
  </div>
  <div class="cp-hist" id="cpHist"></div>
  <div class="cp-inputwrap">
    <div class="cp-preview" id="cpPreview" hidden></div>
    <textarea id="cpInput" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off"
      placeholder="Wpisz wyrażenie, np. 2+3·4 · solve(x^2-4=0,x) · f(x)=x^2"></textarea>
  </div>
  <div class="cp-keypads">
    <div class="cp-panels" id="cpPanels"></div>
  </div>`;
  window.EXTRA_TABS = window.EXTRA_TABS || [];
  window.EXTRA_TABS.push({ id: "c", title: "KALKULATOR", card });

  const input = card.querySelector("#cpInput");
  const preview = card.querySelector("#cpPreview");
  const histEl = card.querySelector("#cpHist");
  let lastResult = null;   // wynik bieżącej linii (do s⇔D)

  /* ---------- pasek trybu ---------- */
  const segBtns = [...card.querySelectorAll("[data-mode]")];
  function refreshSeg() {
    segBtns[0].setAttribute("aria-selected", String(!E.settings.deg));
    segBtns[1].setAttribute("aria-selected", String(E.settings.deg));
    segBtns[0].textContent = E.settings.deg ? "RAD" : "RAD";
    segBtns[1].textContent = E.settings.deg ? "DEG" : "DEG";
  }
  segBtns.forEach((b, i) => b.onclick = () => {
    E.setDeg(i === 1);
    store.deg = E.settings.deg; save();
    CB.syncScope();
    refreshSeg();
    window.dispatchEvent(new CustomEvent("cp-mode-change", { detail: { deg: E.settings.deg } }));
    runPreview();
  });
  card.querySelector("#cpExact").onclick = () => {
    store.exact = !store.exact; save();
    if (lastResult) renderResult(lastResult, histEl.querySelector(".cp-last"));
  };
  card.querySelector("#cpClear").onclick = () => { store.hist = []; save(); renderHist(); };

  /* ---------- wstawianie tekstu ---------- */
  function insert(text, caretBack) {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    input.setRangeText(text, s, e, "end");
    if (caretBack) {
      const p = Math.max(input.selectionStart - caretBack, 0);
      input.setSelectionRange(p, p);
    }
    input.focus();
    runPreview();
  }
  function backspace() {
    const s = input.selectionStart, e = input.selectionEnd;
    if (s === e && s > 0) input.setRangeText("", s - 1, s, "end");
    else input.setRangeText("", s, e, "end");
    input.focus();
    runPreview();
  }

  /* ---------- klawiatura ---------- */
  const PANELS = [
    { name: "123", keys: [
      ["7","8","9","÷","⌫|bs"],
      ["4","5","6","×","("],
      ["1","2","3","−",")"],
      ["0",".","EE","+"],
      ["EXE|exe|wide"]
    ]},
    { name: "f(x)", keys: [
      ["x","x²|^2","x^|^","√(sqrt(|back1","x⁻¹|^(-1)"],
      ["π|pi","e","sin(|back1","cos(|back1","tan(|back1"],
      ["ln(|back1","log(|back1","e^(e^(","|x||abs(|back1","n!|factorial("],
      ["sin⁻¹|asin(|back1","cos⁻¹|acos(|back1","tan⁻¹|atan(|back1","∛|cbrt(|back1","mod(|back2"],
      ["nCr|combinations(|back1","nPr|permutations(|back1","gcd(|back1","lcm(|back1","abs(|back1"]
    ]},
    { name: "CAS", keys: [
      ["solve(|back1","nsolve(|back1","=","<","≤|<="],
      ["d/dx|diff(|back1","∫|integrate(|back1","lim|limit(|back2",">","≥|>="],
      ["Σ|sum(|back1","Π|prod(|back1","expand(|back1","factor(|back1","simplify(|back1"],
      ["taylor(|back1","|a|=0","x","y","z"],
      ["ans"]
    ]},
    { name: "abc", keys: [
      ["a","b","c","d","f","g"],
      ["h","i","j","k","l","m"],
      ["n","p","q","r","s","t"],
      ["u","v","w","x","y","z"]
    ]}
  ];
  const panelsEl = card.querySelector("#cpPanels");
  let panelBtns = [];
  PANELS.forEach((p, pi) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = p.name; btn.className = "cp-pbtn";
    btn.onclick = () => showPanel(pi);
    panelsEl.appendChild(btn); panelBtns.push(btn);
    const grid = document.createElement("div");
    grid.className = "cp-keys";
    grid.hidden = pi !== 0;
    p.keys.flat().forEach(kdef => {
      const [label, ins, opt] = kdef.split("|");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = label.replace("^2", "<sup>2</sup>").replace("^(-1)", "<sup>−1</sup>");
      b.className = "cp-key" + (opt === "wide" ? " wide" : "") + (opt === "exe" ? " exe" : "") + (opt === "bs" ? " danger" : "");
      b.onclick = () => {
        if (opt === "exe") { runExe(); return; }
        if (opt === "bs") { backspace(); return; }
        if (label === "EE") { insert("*10^"); return; }
        if (label === "|a|=0") { insert("|"); return; }
        insert(ins || label, opt === "back1" ? (ins ? ins.length - 1 : label.length - 1) : opt === "back2" ? 2 : 0);
      };
      grid.appendChild(b);
    });
    panelsEl.appendChild(grid);
  });
  function showPanel(pi) {
    panelBtns.forEach((b, i) => b.setAttribute("aria-selected", String(i === pi)));
    [...panelsEl.querySelectorAll(".cp-keys")].forEach((g, i) => g.hidden = i !== pi);
  }

  /* ---------- podgląd ---------- */
  let previewTimer = null;
  function runPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const v = input.value.trim();
      if (!v) { preview.hidden = true; input.style.height = "auto"; return; }
      const p = E.previewHtml(v);
      preview.hidden = false;
      preview.innerHTML = p.ok ? p.html : `<span class="cp-warn">…sprawdź zapis</span>`;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }, 60);
  }
  input.addEventListener("input", runPreview);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); runExe(); }
    else if (ev.key === "ArrowUp" && !input.value && store.hist.length) {
      input.value = store.hist[0].i; runPreview(); ev.preventDefault();
    }
  });

  /* ---------- wynik i historia ---------- */
  function renderResult(res, el) {
    if (!el) return;
    const showExact = store.exact;
    const main = res.error ? `<span class="cp-err">${escapeHtml(res.error)}</span>`
      : (showExact && res.html ? res.html : `<b>${escapeHtml(res.approxText || (res.exact || ""))}</b>`);
    let approxLine = "";
    if (!res.error && res.approxText && res.exact && plain(res.exact) !== res.approxText) {
      approxLine = `<div class="cp-approx">≈ ${escapeHtml(res.approxText)}${E.settings.deg ? "" : ""}</div>`;
    }
    const info = (res.info || []).map(i => `<div class="cp-info">${escapeHtml(i)}</div>`).join("");
    el.innerHTML = `<div class="cp-line-in">${escapeHtml(res.input)}</div>
      <div class="cp-line-out">${main}${approxLine}${info}</div>`;
  }
  function plain(s) { return String(s); }
  function escapeHtml(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  async function runExe() {
    const v = input.value.trim();
    if (!v) return;
    let res;
    try {
      res = await CB.evaluate(v, { deg: E.settings.deg, timeoutMs: 10000 });
    } catch (err) {
      res = { input: v, ok: false, error: err.message, info: [] };
    }
    // definicje zmiennych/funkcji wykonaj też lokalnie — zakres main thread jest potrzebny wykresom
    if (res.ok && /^[a-zA-Z][a-zA-Z0-9_]*\s*(\([^()]*\))?\s*=\s*[^=]/.test(v)) {
      try { E.evaluate(v); } catch (e) { /* definicja już odnotowana w workerze */ }
    }
    lastResult = res;
    const entry = document.createElement("div");
    entry.className = "cp-entry";
    renderResult(res, entry);
    entry.addEventListener("click", (ev) => {
      // klik na treść wstawia tekst do pola wprowadzania
      if (window.getSelection && String(window.getSelection())) return;
      insert(res.error ? res.input : (res.exact || res.approxText || res.input));
    });
    histEl.prepend(entry);
    if (res.ok) {
      store.hist.unshift({ i: res.input, e: res.exact || "", a: res.approxText || "", h: res.html || "", info: res.info || [] });
      if (store.hist.length > 100) store.hist.length = 100;
      save();
    }
    CB.syncScope();
    input.value = "";
    runPreview();
    histEl.scrollTop = 0;
  }

  function renderHist() {
    histEl.innerHTML = "";
    for (const h of store.hist.slice(0, 40)) {
      const d = document.createElement("div");
      d.className = "cp-entry";
      d.innerHTML = `<div class="cp-line-in">${escapeHtml(h.i)}</div>
        <div class="cp-line-out">${h.h || escapeHtml(h.e || h.a)}</div>`;
      d.addEventListener("click", () => { if (!(window.getSelection && String(window.getSelection()))) insert(h.i); });
      histEl.appendChild(d);
    }
  }

  // odtworzenie zakresu (zmienne/funkcje) po odświeżeniu strony
  (function restoreScope() {
    for (const h of [...store.hist].reverse()) {
      if (/[a-zA-Z]\s*\([^)]*\)\s*=/.test(h.i)) E.evaluate(h.i);         // definicje funkcji
      else if (/^[a-zA-Z]\s*=\s*[^=]/.test(h.i)) E.evaluate(h.i);        // przypisania zmiennych
    }
  })();

  renderHist();
  refreshSeg();
  CB.syncScope();
})();
