/* MACIERZE — działania na macierzach i wektorach: det, odwrotność, układy Ax=b, wartości własne, wektory. */
(function () {
  "use strict";
  const math = window.math;
  const E = window.Engine;
  const KEY = "kalkulator-macierze-v1";
  let store = {
    A: { r: 2, c: 2, d: ["1", "2", "3", "4"] },
    B: { r: 2, c: 2, d: ["1", "0", "0", "1"] }
  };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.A && s.B) store = s; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  const card = document.createElement("section");
  card.className = "card wide";
  card.hidden = true;
  card.innerHTML = `
  <h2>MACIERZE</h2>
  <div class="m-grid2">
    <div class="m-box"><h3>Macierz A</h3><div class="m-dims"></div><div class="m-cells" id="mA"></div></div>
    <div class="m-box"><h3>Macierz B</h3><div class="m-dims"></div><div class="m-cells" id="mB"></div></div>
  </div>
  <div class="m-ops">
    <b>Operacje:</b>
    <button type="button" data-op="add">A+B</button>
    <button type="button" data-op="sub">A−B</button>
    <button type="button" data-op="mul">A·B</button>
    <button type="button" data-op="det">det(A)</button>
    <button type="button" data-op="inv">A⁻¹</button>
    <button type="button" data-op="trans">Aᵀ</button>
    <button type="button" data-op="rank">rz(A)</button>
    <button type="button" data-op="pow">Aᵏ</button>
    <button type="button" data-op="solve">A·X=B</button>
    <button type="button" data-op="eigs">wartości własne</button>
  </div>
  <div class="m-result" id="mOut"><span class="m-hint">Wybierz operację — wynik pojawi się tutaj.</span></div>
  <h3 style="margin-top:14px">Wektory (pierwszy wiersz A i B lub kolumny)</h3>
  <div class="m-ops">
    <button type="button" data-v="dot">a·b</button>
    <button type="button" data-v="cross">a×b</button>
    <button type="button" data-v="norm">|a|</button>
    <button type="button" data-v="angle">kąt(a,b)</button>
  </div>
  <div class="m-result" id="mVOut"></div>`;
  window.EXTRA_TABS = window.EXTRA_TABS || [];
  window.EXTRA_TABS.push({ id: "m", title: "MACIERZE", card });

  const $ = (q) => card.querySelector(q);
  const fmt = (v) => {
    if (typeof v === "number") return E.fmtNum(Math.round(v * 1e10) / 1e10);
    if (v && v.re !== undefined) {
      const im = Math.round(v.im * 1e10) / 1e10;
      return Math.abs(im) < 1e-10 ? E.fmtNum(v.re) : `${E.fmtNum(v.re)} ${im < 0 ? "−" : "+"} ${Math.abs(im) === 1 ? "" : E.fmtNum(Math.abs(im))}i`;
    }
    return String(v);
  };

  function matrixOf(which) {
    const s = store[which];
    const d = [];
    for (let r = 0; r < s.r; r++) {
      const row = [];
      for (let c = 0; c < s.c; c++) {
        const raw = String(s.d[r * s.c + c] ?? "").trim();
        let v;
        try {
          // pozwalamy na wyrażenia i liczby zespolone, np. 1+2i, sqrt(2), pi/4
          v = math.evaluate(raw.replace(/,/g, "."));
        } catch (e) { v = NaN; }
        const isNum = typeof v === "number" && isFinite(v);
        const isCx = v && typeof v === "object" && typeof v.re === "number" && isFinite(v.re) && isFinite(v.im);
        if (!isNum && !isCx) throw new Error(`Macierz ${which}: komórka [${r + 1},${c + 1}] nie jest liczbą (dozwolone też zespolone, np. 1+2i).`);
        row.push(v);
      }
      d.push(row);
    }
    return d;
  }
  const flat = (m) => Array.isArray(m[0]) ? m.flat() : m;
  const hasComplex = (m) => flat(Array.isArray(m[0]) ? m : [m]).some(v => v && typeof v === "object" && typeof v.re === "number");

  function renderMatrix(which) {
    const s = store[which];
    const cells = $(`#m${which}`);
    cells.style.gridTemplateColumns = `repeat(${s.c}, minmax(52px, 1fr))`;
    cells.innerHTML = "";
    for (let r = 0; r < s.r; r++) {
      for (let c = 0; c < s.c; c++) {
        const inp = document.createElement("input");
        inp.inputMode = "decimal";
        inp.value = s.d[r * s.c + c] ?? "";
        inp.addEventListener("input", () => { s.d[r * s.c + c] = inp.value; save(); });
        cells.appendChild(inp);
      }
    }
  }
  function pad(which) {
    const s = store[which];
    while (s.d.length < s.r * s.c) s.d.push("0");
  }
  function decDim(which, axis) {
    const s = store[which];
    if (axis === "r" && s.r > 1) { s.r--; save(); renderMatrix(which); }
    if (axis === "c" && s.c > 1) { s.c--; save(); renderMatrix(which); }
  }
  function incDim(which, axis) {
    const s = store[which];
    if (axis === "r" && s.r < 6) { s.r++; pad(which); save(); renderMatrix(which); }
    if (axis === "c" && s.c < 6) { s.c++; pad(which); save(); renderMatrix(which); }
  }

  function renderDims(which) {
    const s = store[which];
    const dims = $(`#m${which}`).closest(".m-box").querySelector(".m-dims");
    dims.innerHTML = "";
    const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = fn; return b; };
    dims.append(
      mk("w−", () => decDim(which, "r")), document.createTextNode(` ${s.r}×${s.c} `),
      mk("w+", () => incDim(which, "r")),
      mk("k−", () => decDim(which, "c")),
      mk("k+", () => incDim(which, "c"))
    );
  }

  function htmlMatrix(m, label) {
    const rows = Array.isArray(m[0]) ? m : [m];
    return `<div class="m-resblock"><div class="m-reslabel">${label}</div>
      <table class="mtx">${rows.map(r => `<tr>${(Array.isArray(r) ? r : [r]).map(v => `<td>${fmt(v)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  }

  function runOp(op) {
    const out = $("#mOut");
    try {
      const A = matrixOf("A"), B = matrixOf("B");
      const mA = math.matrix(A), mB = math.matrix(B);
      switch (op) {
        case "add": out.innerHTML = htmlMatrix(math.subtract(mA, mB).toArray(), "A+B"); break;
        case "sub": out.innerHTML = htmlMatrix(math.subtract(mA, mB).toArray(), "A−B"); break;
        case "mul": out.innerHTML = htmlMatrix(math.multiply(mA, mB).toArray(), "A·B"); break;
        case "det": {
          if (store.A.r !== store.A.c) throw new Error("Wyznacznik tylko dla macierzy kwadratowych.");
          out.innerHTML = `<div class="m-resblock"><div class="m-reslabel">det(A)</div><b>${fmt(math.det(A))}</b></div>`; break;
        }
        case "inv": {
          if (store.A.r !== store.A.c) throw new Error("Macierz odwrotna tylko dla macierzy kwadratowych.");
          const d = math.det(A);
          if (Math.abs(d) < 1e-12) throw new Error("det(A) = 0 — macierz osobliwa, nie ma macierzy odwrotnej.");
          out.innerHTML = htmlMatrix(math.inv(mA).toArray(), "A⁻¹"); break;
        }
        case "trans": out.innerHTML = htmlMatrix(math.transpose(mA).toArray(), "Aᵀ"); break;
        case "rank":
          if (hasComplex(A)) throw new Error("Rząd macierzy liczony tylko dla macierzy rzeczywistych.");
          out.innerHTML = `<div class="m-resblock"><div class="m-reslabel">rz(A)</div><b>${math.rank(A)}</b></div>`; break;
        case "pow": {
          const k = parseInt(prompt2("Potęga k (1–8):", "2"), 10);
          if (!Number.isInteger(k) || k < 1 || k > 8) throw new Error("Podaj k od 1 do 8.");
          let R = math.identity(store.A.r, store.A.r);
          for (let i = 0; i < k; i++) R = math.multiply(R, mA);
          out.innerHTML = htmlMatrix(R.toArray(), `A^${k}`); break;
        }
        case "solve": {
          if (store.A.r !== store.A.c) throw new Error("Układ A·X=B wymaga macierzy kwadratowej A.");
          const bVec = store.B.r === store.A.r && store.B.c === 1 ? B : (store.B.r === store.A.r && store.B.c === store.A.c ? B : null);
          if (!bVec) throw new Error(`B musi mieć wymiary ${store.A.r}×1 (wektor) lub ${store.A.r}×${store.A.c}.`);
          const X = math.multiply(math.inv(mA), math.matrix(bVec));
          out.innerHTML = htmlMatrix(X.toArray(), "X = A⁻¹·B"); break;
        }
        case "eigs": {
          if (store.A.r !== store.A.c) throw new Error("Wartości własne tylko dla macierzy kwadratowych.");
          const eg = math.eigs(A);
          // mathjs ≥15: eg.eigenvectors = [{value, vector}]; starsze: eg.vectors (macierz kolumn)
          let vals = [], vecs = null;
          if (eg.eigenvectors) {
            eg.eigenvectors.forEach(p => {
              vals.push(p.value);
              const v = p.vector && p.vector.toArray ? p.vector.toArray() : p.vector;
              vecs = vecs || [];
              vecs.push(flat(v));
            });
          } else {
            vals = flat(eg.values && (eg.values.toArray ? eg.values.toArray() : eg.values));
            if (eg.vectors) {
              const m = eg.vectors.toArray ? eg.vectors.toArray() : eg.vectors;
              vecs = (Array.isArray(m[0]) && Array.isArray(m[0][0])) ? m : m.map(col => col);
            }
          }
          let html = `<div class="m-resblock"><div class="m-reslabel">Wartości własne</div>${vals.map(fmt).join(",&nbsp; ")}</div>`;
          if (vecs) {
            html += `<div class="m-resblock"><div class="m-reslabel">Wektory własne (kolumny)</div>
              <table class="mtx">${vecs.map(r => `<tr>${r.map(v => `<td>${fmt(v)}</td>`).join("")}</tr>`).join("")}</table></div>`;
          }
          out.innerHTML = html; break;
        }
      }
    } catch (err) {
      out.innerHTML = `<span class="cp-err">${escapeHtml(err.message)}</span>`;
    }
  }

  function runVec(op) {
    const out = $("#mVOut");
    try {
      const A = matrixOf("A"), B = matrixOf("B");
      const va = firstVector(A), vb = firstVector(B);
      if (op === "dot") {
        if (va.length !== vb.length) throw new Error("Wektory różnych długości.");
        out.innerHTML = `<b>a·b = ${fmt(math.dot(va, vb))}</b>`;
      } else if (op === "cross") {
        if (va.length !== 3 || vb.length !== 3) throw new Error("Iloczyn wektorowy tylko dla wektorów 3D.");
        out.innerHTML = `<b>a×b = [${math.cross(va, vb).map(fmt).join(", ")}]</b>`;
      } else if (op === "norm") {
        out.innerHTML = `<b>|a| = ${fmt(math.norm(va))}</b>`;
      } else if (op === "angle") {
        if (va.length !== vb.length) throw new Error("Wektory różnych długości.");
        if (hasComplex(va) || hasComplex(vb)) throw new Error("Kąt między wektorami liczony tylko dla wektorów rzeczywistych.");
        const cos = math.dot(va, vb) / (math.norm(va) * math.norm(vb));
        const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
        out.innerHTML = `<b>kąt(a,b) ≈ ${fmt(Math.round(ang * 100) / 100)}°</b> (cos = ${fmt(Math.round(cos * 1e6) / 1e6)})`;
      }
    } catch (err) {
      out.innerHTML = `<span class="cp-err">${escapeHtml(err.message)}</span>`;
    }
  }
  function firstVector(m) {
    if (Array.isArray(m[0])) {
      if (m[0].length === 1) return m.map(r => r[0]);   // kolumna
      return m[0];                                       // pierwszy wiersz
    }
    return m;
  }
  function escapeHtml(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function prompt2(msg, def) { return window.prompt(msg, def); }

  card.querySelectorAll("[data-op]").forEach(b => b.onclick = () => runOp(b.dataset.op));
  card.querySelectorAll("[data-v]").forEach(b => b.onclick = () => runVec(b.dataset.v));

  renderMatrix("A"); renderMatrix("B");
  renderDims("A"); renderDims("B");
})();
