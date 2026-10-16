/*
 * Silnik obliczeniowy (CAS + numeryka) — wspólny rdzeń kalkulatora.
 * Zależności: vendor/math.min.js (mathjs), vendor/nerdamer.all.min.js (nerdamer).
 * UMD: działa w przeglądarce (window.Engine), w Web Workerze (self.Engine) i w Node (require).
 * Nie korzysta z DOM ani localStorage — warstwa UI jest w osobnych plikach.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../vendor/math.min.js"), require("../vendor/nerdamer.all.min.js"));
  } else {
    root.Engine = factory(root.math, root.nerdamer);
  }
})(typeof self !== "undefined" ? self : this, function (math, nerdamer) {
  "use strict";

  /* ============================== Nazwy znane parserowi ============================== */

  // funkcje jednoargumentowe (nazwa kanoniczna, lowercase)
  const FN1 = ["sin","cos","tan","asin","acos","atan","arcsin","arccos","arctan",
               "sinh","cosh","tanh","asinh","acosh","atanh",
               "log","ln","log10","log2","exp","sqrt","cbrt","abs","floor","ceil",
               "round","sign","conj","re","im","arg","factorial"];
  // funkcje dwu- i wieloargumentowe
  const FN2 = ["atan2","gcd","lcm","mod","nthroot","max","min","pow","det","inv","transpose","rank","ncr","npr"];
  // komendy CAS (pierwszy token wyrażenia)
  const COMMANDS = ["solve","nsolve","diff","integrate","int","limit","sum","prod","product",
                    "expand","factor","simplify","taylor","series","odesolve"];
  // stałe / słowa zarezerwowane
  const CONSTS = ["pi","e","i","inf","infinity","true","false","ans","deg"];
  const KNOWN = new Set([...FN1, ...FN2, ...COMMANDS, ...CONSTS]);

  // funkcje, dla których `,` wewnątrz nawiasów jest zdecydowanie przecinkiem dziesiętnym
  // (log/log10 NIE — log(x, b) przyjmuje opcjonalną podstawę)
  const SINGLE_ARG = new Set(["sin","cos","tan","asin","acos","atan","arcsin","arccos","arctan",
                              "sinh","cosh","tanh","asinh","acosh","atanh","ln","log10","log2",
                              "exp","sqrt","cbrt","abs","floor","ceil","round","sign","conj","re",
                              "im","arg","factorial","ans"]);

  // mapy nazw między silnikami
  const MATHJS_RENAME = { ln: "log", nthroot: "nthRoot", arcsin: "asin", arccos: "acos", arctan: "atan" };
  const NERDAMER_RENAME = { ln: "log" };

  /* ============================== Ustawienia i zasoby ============================== */

  const settings = { deg: false, precision: 12, casTimeoutMs: 10000 };
  const scope = { vars: {}, fns: {} };   // zmienne liczbowe i funkcje zdefiniowane przez użytkownika

  // tryb DEG/RAD: podmieniamy funkcje trygonometryczne w instancji mathjs
  const radSin = math.sin, radCos = math.cos, radTan = math.tan;
  const radAsin = math.asin, radAcos = math.acos, radAtan = math.atan;
  function applyAngleMode() {
    const d = settings.deg, D = Math.PI / 180;
    const wrap1 = (fn, out) => (x) => (typeof x === "number" ? out(fn(x)) : fn(x));
    const wrapIn = (fn) => (x) => (typeof x === "number" ? fn(x * D) : fn(x));
    math.import({
      sin: d ? wrapIn(radSin) : radSin,
      cos: d ? wrapIn(radCos) : radCos,
      tan: d ? wrapIn(radTan) : radTan,
      asin: d ? wrap1(radAsin, (y) => y / D) : radAsin,
      acos: d ? wrap1(radAcos, (y) => y / D) : radAcos,
      atan: d ? wrap1(radAtan, (y) => y / D) : radAtan
    }, { override: true });
  }
  applyAngleMode();

  /* ============================== Normalizacja wejścia ============================== */

  const UNI = [
    [/[×·⋅∗]/g, "*"], [/[÷∕]/g, "/"], [/[−–—]/g, "-"], [/≥/g, ">="], [/≤/g, "<="],
    [/≠/g, "!="], [/π/g, " pi "], [/√/g, "sqrt"], [/∞/g, "inf"], [/\*\*/g, "^"],
    [/⁰/g, "^0"], [/¹/g, "^1"], [/²/g, "^2"], [/³/g, "^3"], [/⁴/g, "^4"], [/⁵/g, "^5"],
    [/⁶/g, "^6"], [/⁷/g, "^7"], [/⁸/g, "^8"], [/⁹/g, "^9"], [/⁻/g, "^-"],
    [/½/g, "(1/2)"], [/⅓/g, "(1/3)"], [/¼/g, "(1/4)"], [/¾/g, "(3/4)"]
  ];

  // tokenizacja: liczby, identyfikatory, operatory, nawiasy, przecinki
  function tokenize(s) {
    const out = [];
    const re = /(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\s+)|(.)/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) out.push({ t: "num", v: m[1] });
      else if (m[2]) out.push({ t: "id", v: m[2] });
      else if (m[3]) { /* spacje */ }
      else out.push({ t: m[4], v: m[4] });
    }
    return out;
  }

  // rozdziela wieloliterowe symbole na iloczyny liter (konwencja ClassPad: xy = x*y),
  // kanonizuje znane nazwy funkcji (case-insensitive)
  function canonicalTokens(tokens) {
    const out = [];
    for (const tok of tokens) {
      if (tok.t !== "id") { out.push(tok); continue; }
      const low = tok.v.toLowerCase();
      if (KNOWN.has(low)) { out.push({ t: "id", v: low }); continue; }
      // funkcje zdefiniowane przez użytkownika zostają w całości
      if (scope.fns[tok.v]) { out.push({ t: "id", v: tok.v }); continue; }
      // sprawdź prefiksy znanych słów (np. "xsin" → "x" + "sin")
      let rest = tok.v, buf = "";
      while (rest.length) {
        let matched = null;
        for (let len = Math.min(rest.length, 10); len >= 2; len--) {
          if (KNOWN.has(rest.slice(0, len).toLowerCase())) { matched = len; break; }
        }
        if (matched) {
          if (buf) { out.push(...buf.split("").map(c => ({ t: "id", v: c }))); buf = ""; }
          out.push({ t: "id", v: rest.slice(0, matched).toLowerCase() });
          rest = rest.slice(matched);
        } else { buf += rest[0]; rest = rest.slice(1); }
      }
      if (buf) out.push(...buf.split("").map(c => ({ t: "id", v: c })));
    }
    return out;
  }

  // wstawia jawne mnożenie tam, gdzie tokeny stykają się bez operatora
  function insertMultiplication(tokens) {
    const out = [];
    // coś, co KOŃczy wartość: liczba, identyfikator, nawias zamykający
    const endsValue = (t) => t && (t.t === "num" || t.t === "id" || t.v === ")");
    // coś, co ZACZYNA wartość: liczba, identyfikator, nawias otwierający
    const startsValue = (t) => t && (t.t === "num" || t.t === "id" || t.v === "(");
    const isFn = (t) => t && t.t === "id" && (FN1.includes(t.v) || FN2.includes(t.v) || COMMANDS.includes(t.v) || t.v === "ans" || !!scope.fns[t.v]);
    for (let k = 0; k < tokens.length; k++) {
      const prev = out[out.length - 1], cur = tokens[k];
      if (prev && endsValue(prev) && startsValue(cur)) {
        const fnCall = cur.v === "(" && prev.t === "id" && isFn(prev);
        if (!fnCall) out.push({ t: "*", v: "*" });
      }
      // "sin x" bez nawiasu → zostawiamy; parser zgłosi błąd z podpowiedzią
      out.push(cur);
    }
    return out;
  }

  // rozstrzyga `,`: przecinek dziesiętny czy separator argumentów — reguła deterministyczna:
  // • głębia 0 (poza nawiasami) → zawsze dziesiętny (separatory występują tylko w nawiasach)
  // • wewnątrz `(` funkcji jednoargumentowej (znanej lub użytkownika z 1 parametrem) → dziesiętny
  // • wewnątrz `(` funkcji wieloargumentowej/komendy → separator
  // • wewnątrz zwykłego nawiasu grupującego → dziesiętny
  // • wewnątrz `[ ]` (macierz/wektor) → separator
  function fixCommas(tokens) {
    const out = [];
    const stack = [];          // konteksty otwartych nawiasów: { dot: bool }
    let pendingFn = null;      // nazwa funkcji oczekującej na `(` (id bezpośrednio przed nawiasem)
    for (const tok of tokens) {
      if (tok.t === "id") {
        pendingFn = tok.v;
        out.push(tok);
        continue;
      }
      if (tok.v === "(") {
        let dot = !pendingFn;
        if (pendingFn) {
          if (SINGLE_ARG.has(pendingFn)) dot = true;
          else if (scope.fns[pendingFn] && scope.fns[pendingFn].params.length === 1) dot = true;
        }
        stack.push({ dot });
        pendingFn = null;
        out.push(tok);
        continue;
      }
      if (tok.v === "[") { stack.push({ dot: false }); pendingFn = null; out.push(tok); continue; }
      if (tok.v === ")" || tok.v === "]") { stack.pop(); pendingFn = null; out.push(tok); continue; }
      pendingFn = null;
      if (tok.t === ",") {
        const top = stack[stack.length - 1];
        out.push(!stack.length || (top && top.dot) ? { t: ".", v: "." } : tok);
        continue;
      }
      if (tok.t === "num" && tok.v.includes(",")) { out.push({ t: "num", v: tok.v.replace(",", ".") }); continue; }
      out.push(tok);
    }
    return out;
  }

  function normalize(input) {
    let s = String(input == null ? "" : input);
    for (const [re, rep] of UNI) s = s.replace(re, rep);
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
    let tokens = tokenize(s);
    tokens = canonicalTokens(tokens);
    tokens = fixCommas(tokens);
    tokens = insertMultiplication(tokens);
    return tokens.map(t => t.v).join("");
  }

  /* ============================== Narzędzia tekstowe ============================== */

  // dzieli łańcuch po danym separatorze najwyższego poziomu (uwzględnia nawiasy i [])
  function splitTop(s, sep) {
    sep = sep || ",";
    const parts = []; let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth--;
      if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim() !== "" || parts.length) parts.push(cur.trim());
    return parts;
  }

  // wyciąga elementy z notacji zbioru nerdamera "{a, b}"
  function parseSet(s) {
    const t = String(s).trim();
    if (!t.startsWith("{")) return [t];
    const inner = t.slice(1, -1);
    return inner.trim() === "" ? [] : splitTop(inner);
  }

  // ostatni wynik jako tekst do wstawienia za `ans`
  let lastAns = { text: "0", value: 0 };

  function toNerdamer(expr) {
    let e = expr;
    for (const [k, v] of Object.entries(NERDAMER_RENAME)) e = e.replace(new RegExp("\\b" + k + "\\b", "g"), v);
    e = e.replace(/\bans\b/g, "(" + lastAns.text + ")");
    return e;
  }
  function toMathJS(expr) {
    let e = expr;
    for (const [k, v] of Object.entries(MATHJS_RENAME)) e = e.replace(new RegExp("\\b" + k + "\\b", "g"), v);
    e = e.replace(/\bans\b/g, "(" + lastAns.value + ")");
    return e;
  }

  /* ============================== Formatowanie liczb ============================== */

  function fmtNum(x) {
    if (typeof x !== "number" || Number.isNaN(x)) return "NaN";
    if (!isFinite(x)) return x > 0 ? "∞" : "−∞";
    if (x === 0) return "0";
    const a = Math.abs(x);
    if (a >= 1e13 || a < 1e-10) {
      const s = x.toExponential(9).replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e");
      return s.replace("e+", "·10^").replace("e-", "·10^-").replace(/^−/, "-");
    }
    return String(parseFloat(x.toPrecision(12)));
  }
  function isComplex(v) { return v && typeof v === "object" && typeof v.re === "number" && typeof v.im === "number"; }
  function fmtValue(v) {
    if (isComplex(v)) {
      const re = fmtNum(v.re), im = fmtNum(Math.abs(v.im));
      if (Math.abs(v.im) < 1e-14) return String(v.re);
      const sign = v.im < 0 ? "−" : "+";
      return `${re} ${sign} ${im === "1" ? "" : im}i`;
    }
    if (Array.isArray(v)) return "[" + v.map(fmtValue).join(", ") + "]";
    if (v && v.toArray && typeof v.toArray === "function") return fmtValue(v.toArray());
    if (typeof v === "number") return fmtNum(v);
    return String(v);
  }

  /* ============================== Mini-renderer LaTeX → HTML ============================== */

  const GREEK = ["alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa","lambda",
                 "mu","nu","xi","omicron","pi","rho","sigma","tau","upsilon","phi","chi","psi","omega",
                 "Gamma","Delta","Theta","Lambda","Sigma","Phi","Psi","Omega"];
  const CMD_MAP = { cdot:"·", times:"×", div:"÷", pm:"±", mp:"∓", leq:"≤", geq:"≥", neq:"≠", approx:"≈",
                    infty:"∞", to:"→", rightarrow:"→", implies:"⇒", in:"∈", cup:"∪", cap:"∩",
                    subset:"⊂", forall:"∀", exists:"∃", ldots:"…", cdots:"⋯", prime:"′", degree:"°" };
  const FN_TEX = new Set(["sin","cos","tan","cot","sec","csc","log","ln","exp","lim","min","max","arcsin","arccos","arctan","sinh","cosh","tanh","det","gcd","mod"]);

  function latexToHtml(tex) {
    tex = String(tex == null ? "" : tex);
    // wejście: czysty tekst nerdamera (np. "2^(1/2)*(x+1)/3"); zamieniamy pierwiastki na sqrt/cbrt
    tex = tex.replace(/\(([^()]+)\)\^\(1\/2\)/g, "sqrt($1)");
    tex = tex.replace(/([A-Za-z0-9.]+)\^\(1\/2\)/g, "sqrt($1)");
    tex = tex.replace(/\(([^()]+)\)\^\(1\/3\)/g, "cbrt($1)");
    tex = tex.replace(/([A-Za-z0-9.]+)\^\(1\/3\)/g, "cbrt($1)");
    tex = nerdamer.convertToLaTeX(tex);
    let i = 0;
    function parseSeq(stopBrace) {
      let html = "";
      while (i < tex.length) {
        const ch = tex[i];
        if (ch === "}") { if (stopBrace) { i++; return html; } i++; continue; }
        if (ch === "{") { i++; html += parseGroup(); continue; }
        if (ch === "^" || ch === "_") {
          i++;
          const arg = parseArg();
          html += ch === "^" ? `<sup>${arg}</sup>` : `<sub>${arg}</sub>`;
          continue;
        }
        if (ch === "\\") {
          i++;
          let name = "";
          while (i < tex.length && /[a-zA-Z]/.test(tex[i])) name += tex[i++];
          if (name === "frac" || name === "dfrac") {
            const a = parseArg(), b = parseArg();
            html += `<span class="frac"><span class="num">${a}</span><span class="den">${b}</span></span>`;
          } else if (name === "sqrt") {
            let idx = "";
            if (tex[i] === "[") { i++; while (i < tex.length && tex[i] !== "]") idx += tex[i++]; i++; }
            const a = parseArg();
            html += idx ? `<span class="root">${idx}<span class="rad">√</span><span class="radic">${a}</span></span>`
                        : `<span class="root"><span class="rad">√</span><span class="radic">${a}</span></span>`;
          } else if (name === "cbrt") {
            const a = parseArg();
            html += `<span class="root"><span class="rad">∛</span><span class="radic">${a}</span></span>`;
          } else if (name === "left" || name === "right") { /* pominięte */ }
          else if (GREEK.includes(name)) html += greekChar(name);
          else if (CMD_MAP[name]) html += CMD_MAP[name];
          else if (FN_TEX.has(name)) html += `<span class="fn">${name}</span>`;
          else if (name === "text" || name === "mathrm") html += parseArg();
          else html += name;
          continue;
        }
        if (ch === "<") { html += "&lt;"; i++; continue; }
        if (ch === ">") { html += "&gt;"; i++; continue; }
        if (ch === "&") { html += "&amp;"; i++; continue; }
        html += ch; i++;
      }
      return html;
    }
    function greekChar(name) {
      const lower = GREEK.map(g => g.toLowerCase());
      const idx = lower.indexOf(name.toLowerCase());
      const base = 0x3b1 + idx;
      return String.fromCharCode(name[0] === name[0].toUpperCase() ? base - 0x20 : base);
    }
    function parseGroup() {
      // po `{`; czyta do dopasowania `}`
      let depth = 1, html = "", save = i;
      // proste podejście: użyj parseSeq z stopBrace (obsługuje zagnieżdżenia)
      return parseSeq(true);
    }
    function parseArg() {
      while (tex[i] === " ") i++;
      if (tex[i] === "{") { i++; return parseSeq(true); }
      if (tex[i] === "\\") { const start = i; i++; while (i < tex.length && /[a-zA-Z]/.test(tex[i])) i++; return tex.slice(start, i); }
      return tex[i] ? tex[i++] : "";
    }
    return parseSeq(false);
  }

  /* ============================== Pretty-print drzewa mathjs (podgląd wejścia) ============================== */

  function nodeToHtml(node) {
    if (!node) return "";
    const t = node.type;
    if (t === "OperatorNode" || t === "ParenthesisNode") {
      if (t === "ParenthesisNode") return "(" + nodeToHtml(node.content) + ")";
      const op = node.op, args = node.args;
      const show = (n) => nodeToHtml(n.type === "ParenthesisNode" ? n.content : n);
      const wrap = (n) => {
        if (n.type === "OperatorNode" || n.type === "ParenthesisNode") return "(" + show(n) + ")";
        return show(n);
      };
      if (op === "/") return `<span class="frac"><span class="num">${wrap(args[0])}</span><span class="den">${wrap(args[1])}</span></span>`;
      if (op === "*") return args.map(wrap).join("·");
      if (op === "-") return args.length === 2 ? wrap(args[0]) + "−" + wrap(args[1]) : "−" + wrap(args[0]);
      if (op === "+") return args.map(wrap).join("+");
      if (op === "^") return `${wrap(args[0])}<sup>${show(args[1])}</sup>`;
      return args.map(wrap).join(" " + op + " ");
    }
    if (t === "FunctionNode") {
      const name = node.fn.name || String(node.fn);
      const argsHtml = node.args.map(nodeToHtml).join("; ");
      if (name === "sqrt") return `<span class="root"><span class="rad">√</span><span class="radic">${nodeToHtml(node.args[0])}</span></span>`;
      if (name === "abs") return `|${nodeToHtml(node.args[0])}|`;
      return `<span class="fn">${name}</span>(${argsHtml})`;
    }
    if (t === "SymbolNode") return node.name === "pi" ? "π" : node.name;
    if (t === "ConstantNode") return String(node.value);
    if (t === "AssignmentNode") return nodeToHtml(Object.assign(new math.SymbolNode, {})) || node.toString();
    if (t === "MatrixNode") return "[" + node.items.map(r => Array.isArray(r) ? r.map(nodeToHtml).join(", ") : nodeToHtml(r)).join("; ") + "]";
    return node.toString({ parenthesis: "auto" });
  }

  function previewHtml(expr) {
    try {
      const norm = normalize(expr);
      if (!norm) return { ok: true, html: "" };
      const node = math.parse(norm);
      return { ok: true, html: nodeToHtml(node), norm };
    } catch (e) {
      return { ok: false, html: "", error: e.message };
    }
  }

  /* ============================== Kompilacja funkcji numerycznych ============================== */

  function compile(expr, varName) {
    const vars = varName ? [varName] : [];
    const code = toMathJS(expr);
    let f;
    try {
      f = math.compile(code);
    } catch (e) {
      throw new Error("Nie udało się skompilować wyrażenia: " + e.message);
    }
    // zakres: zmienne + funkcje zdefiniowane przez użytkownika
    const fnsScope = {};
    for (const [name, fn] of Object.entries(scope.fns)) fnsScope[name] = fn.fn || fn.compiled;
    const scopeObj = Object.assign({}, scope.vars, fnsScope);
    return function (x) {
      try {
        scopeObj[varName || "x"] = x;
        const v = f.evaluate(scopeObj);
        if (typeof v === "number") return v;
        if (isComplex(v)) return v.im === 0 ? v.re : NaN;
        if (v && v.re !== undefined) return v.im === 0 ? v.re : NaN;
        return NaN;
      } catch (e) { return NaN; }
    };
  }

  // kompilacja wyrażenia dwóch zmiennych (np. prawa strona y' = f(x, y))
  function compile2(expr, varX, varY) {
    const code = toMathJS(expr);
    let f;
    try { f = math.compile(code); }
    catch (e) { throw new Error("Nie udało się skompilować wyrażenia: " + e.message); }
    const fnsScope = {};
    for (const [name, fn] of Object.entries(scope.fns)) fnsScope[name] = fn.fn || fn.compiled;
    const scopeObj = Object.assign({}, scope.vars, fnsScope);
    return function (x, y) {
      try {
        scopeObj[varX] = x;
        scopeObj[varY] = y;
        const v = f.evaluate(scopeObj);
        if (typeof v === "number") return v;
        if (isComplex(v)) return v.im === 0 ? v.re : NaN;
        return NaN;
      } catch (e) { return NaN; }
    };
  }

  /* ============================== Narzędzia numeryczne ============================== */

  const EPS = 1e-12;

  function bisect(f, a, b, iters) {
    let fa = f(a), fb = f(b);
    if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
    for (let k = 0; k < (iters || 80); k++) {
      const m = (a + b) / 2, fm = f(m);
      if (!isFinite(fm)) return null;
      if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
      if (Math.abs(b - a) < 1e-14 * Math.max(1, Math.abs(a))) break;
    }
    return (a + b) / 2;
  }

  // miejsca zerowe f na [a,b]
  function findRoots(f, a, b, samples) {
    const n = samples || 1600, roots = [];
    let x0 = a, f0 = f(a);
    for (let k = 1; k <= n; k++) {
      const x1 = a + (b - a) * k / n, f1 = f(x1);
      if (isFinite(f0) && isFinite(f1)) {
        if (f0 === 0) roots.push(x0);
        else if (f0 * f1 < 0) {
          const r = bisect(f, x0, x1);
          if (r !== null && !roots.some(v => Math.abs(v - r) < 1e-7 * Math.max(1, Math.abs(r)))) roots.push(r);
        }
      }
      x0 = x1; f0 = f1;
    }
    if (isFinite(f0) && f0 === 0) roots.push(b);
    return roots.sort((p, q) => p - q);
  }

  // pochodna numeryczna
  function deriv(f, x, h) {
    h = h || 1e-6 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - f(x - h)) / (2 * h);
    return isFinite(d) ? d : NaN;
  }

  // ekstrema f na [a,b]: {x, y, type: "min"|"max"} — zerowania pochodnej z dokładnym refiniowaniem
  function findExtrema(f, a, b, samples) {
    const n = samples || 1200, out = [];
    const df = (x) => deriv(f, x);
    let px = a, pd = df(a);
    for (let k = 1; k <= n; k++) {
      const x = a + (b - a) * k / n, d = df(x);
      if (isFinite(pd) && isFinite(d) && pd * d < 0) {
        const xe = bisect(df, px, x);
        if (xe !== null) {
          const ye = f(xe);
          if (isFinite(ye) && !out.some(v => Math.abs(v.x - xe) < 1e-7)) {
            out.push({ x: xe, y: ye, type: pd > 0 ? "max" : "min" });
          }
        }
      }
      px = x; pd = d;
    }
    return out;
  }

  // granica numeryczna w punkcie a: {value, left, right, kind}
  function numericLimit(f, a) {
    const hs = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
    const probe = (dir) => {
      let last = NaN;
      for (const h of hs) {
        const v = f(a + dir * h);
        if (isFinite(v)) last = v;
      }
      return last;
    };
    const L = probe(-1), R = probe(1);
    const both = isFinite(L) && isFinite(R) && Math.abs(L - R) < 1e-6 * Math.max(1, Math.abs(L));
    const kind = both ? (isFinite(L) ? "finite" : "none") : "sides";
    return { value: both ? (L + R) / 2 : NaN, left: L, right: R, kind };
  }

  // całka metodą Simpsona
  function simpson(f, a, b, n) {
    n = n || 1000;
    if (n % 2) n++;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let k = 1; k < n; k++) s += f(a + k * h) * (k % 2 ? 4 : 2);
    return s * h / 3;
  }

  /* -------- równania różniczkowe y' = f(x, y): metoda Rungego-Kotty 4. rzędu -------- */

  // całkuje od x0 w kierunku x1 (x1 < x0 → kroki wstecz); zwraca punkty [[x, y], ...]
  function odeRK4(f, x0, y0, x1, steps) {
    const n = Math.max(8, Math.min(steps || 800, 4000));
    const h = (x1 - x0) / n;
    const pts = [[x0, y0]];
    let x = x0, y = y0;
    for (let k = 0; k < n; k++) {
      const k1 = f(x, y);
      const k2 = f(x + h / 2, y + h / 2 * k1);
      const k3 = f(x + h / 2, y + h / 2 * k2);
      const k4 = f(x + h, y + h * k3);
      y = y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      x = x + h;
      if (!isFinite(y) || Math.abs(y) > 1e12) { pts.push([x, NaN]); break; }
      pts.push([x, y]);
    }
    return pts;
  }

  // rozwiązanie przez punkt (x0, y0) w obu kierunkach — pełna krzywa na widoku
  function odeSolve(fExpr, varX, varY, x0, y0, xEnd) {
    const f = compile2(fExpr, varX, varY);
    return odeRK4(f, x0, y0, xEnd, 800);
  }

  /* ============================== Komendy CAS ============================== */

  function casError(msg) { const e = new Error(msg); e.cas = true; return e; }

  function exactOf(exprText) {
    try { return nerdamer(toNerdamer(exprText)).text(); } catch (e) { return null; }
  }

  // rozwiazania równania: zwraca listę dokładnych tekstów
  function solveEquation(eq, v) {
    const e = toNerdamer(eq);
    const expr = e.includes("=") ? e : e + "=0";
    let res;
    try {
      res = nerdamer(expr).solveFor(v);
    } catch (err) {
      return { solutions: [], symbolic: false, error: err.message };
    }
    if (res === undefined || res === null) return { solutions: [], symbolic: true };
    const sols = parseSet(res.text());
    const periodic = sols.some(s => s.includes("_n"));
    return { solutions: sols.map(s => s.replace(/_n/g, "n")), symbolic: true, periodic };
  }

  // układ równań liniowych: eliminacja Gaussa na wyrażeniach nerdamera (dokładne ułamki)
  // komórki macierzy to teksty wyrażeń; nd/tx robią konwersję string ⇄ Expression
  function gaussSolve(A, b) {
    const n = A.length;
    const M = A.map((row, r) => row.concat([b[r]]));
    const nd = (s) => nerdamer(String(s));
    const tx = (e) => (typeof e === "string" ? e : e.text());
    const isZero = (s) => { try { return nd(tx(s)).text() === "0" || nd(tx(s)).evaluate().text() === "0"; } catch (e) { return false; } };
    for (let col = 0; col < n; col++) {
      let piv = -1;
      for (let r = col; r < n; r++) {
        if (!isZero(M[r][col])) { piv = r; break; }
      }
      if (piv === -1) return { singular: true };
      if (piv !== col) { const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
      const pv = tx(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        const factor = nd(tx(M[r][col])).divide(pv).text();
        for (let c = col; c <= n; c++) {
          const prod = nd(factor).multiply(tx(M[col][c])).text();
          M[r][c] = nd(tx(M[r][c])).subtract(prod).text();
        }
      }
    }
    const x = new Array(n);
    // komórki trzymają postać LHS−RHS (np. "2*x+y-4"), wiersz = a·x_r + (Σ a_c·x_c) + reszta = 0
    // podstawiamy znane x_c LICZBOWO i odejmujemy całość od zera: x_r = −s / a
    for (let r = n - 1; r >= 0; r--) {
      let s = nd(tx(M[r][n]));
      for (let c = r + 1; c < n; c++) {
        // podstawiamy DOKŁADNY tekst rozwiązania (float przez string potrafi być błędnie parsowany)
        s = s.add(nd(tx(M[r][c])).multiply(tx(x[c])));
      }
      x[r] = nd("0").subtract(s).divide(tx(M[r][r])).simplify().text();
    }
    return { x };
  }

  function isLinearIn(eqs, vars) {
    try {
      for (const eq of eqs) {
        const e = nerdamer(toNerdamer(eq.includes("=") ? eq.split("=")[0] + "-(" + eq.split("=")[1] + ")" : eq));
        for (const v of vars) {
          const d2 = e.diff(v).diff(v).text();
          if (d2 !== "0") return false;
        }
      }
      return true;
    } catch (err) { return false; }
  }

  function solveSystem(eqArr, varArr) {
    const n = eqArr.length;
    if (n !== varArr.length) throw casError("Liczba równań musi być równa liczbie niewiadomych.");
    if (n > 5) throw casError("Maksymalnie 5 równań w układzie.");
    const lhs = eqArr.map(eq => {
      const parts = eq.split("=");
      return parts.length === 2 ? nerdamer(toNerdamer(parts[0])).subtract(nerdamer(toNerdamer(parts[1]))) : nerdamer(toNerdamer(eq));
    });
    if (isLinearIn(eqArr, varArr)) {
      const A = varArr.map(() => []), B = [];
      for (let r = 0; r < n; r++) {
        for (const v of varArr) A[r].push(lhs[r].diff(v));
        let cur = lhs[r];
        for (const v of varArr) cur = cur.subst(v, 0);
        B.push(cur);
      }
      const res = gaussSolve(A.map(row => row.map(e => e.text())), B.map(e => e.text()));
      if (res.singular) throw casError("Układ jest nieoznaczony lub sprzeczny (macierz osobliwa).");
      const out = {};
      varArr.forEach((v, r) => { out[v] = res.x[r]; });
      return { type: "system", values: out };
    }
    // układ nieliniowy: eliminacja przez podstawienie (2 równania)
    if (n === 2) {
      const [v1, v2] = varArr;
      const eq1 = eqArr[0], eq2 = eqArr[1];
      let sols1;
      try { sols1 = solveEquation(eq1, v1); } catch (e) { sols1 = { solutions: [] }; }
      if (!sols1.solutions.length) throw casError("Nie umiem rozwiązać układu: nie da się wyznaczyć " + v1 + " z pierwszego równania.");
      const results = [];
      for (const s1 of sols1.solutions.slice(0, 4)) {
        let eq2s;
        try { eq2s = nerdamer(toNerdamer(eq2)).subst(v1, s1).text(); } catch (e) { continue; }
        let sols2;
        try { sols2 = solveEquation(eq2s, v2); } catch (e) { continue; }
        for (const s2 of sols2.solutions.slice(0, 4)) {
          let s1b = s1;
          try { s1b = nerdamer(toNerdamer(s1)).subst(v2, s2).text(); } catch (e) {}
          const key = s1b + "|" + s2;
          if (!results.some(r => r.key === key)) results.push({ key, values: { [v1]: s1b, [v2]: s2 } });
        }
      }
      if (!results.length) throw casError("Nie znaleziono rozwiązań układu.");
      return { type: "system", values: results.map(r => r.values) };
    }
    throw casError("Układy nieliniowe obsługuję dla 2 równań. Dla większych użyj solve równania po kolei.");
  }

  function substituteValues(exprText) {
    // podstawia znane zmienne liczbowe z zakresu
    let e = nerdamer(toNerdamer(exprText));
    for (const [name, val] of Object.entries(scope.vars)) {
      try { e = e.subst(name, nerdamer(String(val)).text()); } catch (err) {}
    }
    return e.text();
  }

  function freeVariables(exprText) {
    try {
      let e = String(exprText);
      // równanie/nierówność: zmienne liczymy z LHS−(RHS)
      const neq = splitTopLevelCompare(e);
      if (neq) e = "(" + neq.l + ")-(" + neq.r + ")";
      const fnNames = new Set([...FN1, ...FN2, ...COMMANDS, ...Object.keys(scope.fns)]);
      const vars = nerdamer(toNerdamer(e)).variables().filter(v => !(v in scope.vars) && !fnNames.has(v));
      return vars;
    } catch (e) { return []; }
  }

  // zwraca nazwy wywoływane jak funkcje, ale nieznane (np. foo(3))
  function unknownFunctionCalls(exprText) {
    const fnNames = new Set([...FN1, ...FN2, ...COMMANDS, ...Object.keys(scope.fns)]);
    const calls = String(exprText).match(/[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) || [];
    return [...new Set(calls.map(c => c.replace(/\s*\($/, "")))].filter(n => !fnNames.has(n.toLowerCase()));
  }

  // rozpoznaje `l = r` / `l < r` itd. na najwyższym poziomie (poza nawiasami)
  function splitTopLevelCompare(s) {
    let depth = 0;
    const ops = ["<=", ">=", "!=", "=", "<", ">"];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (depth === 0) {
        for (const op of ops) {
          if (s.startsWith(op, i)) {
            return { op, l: s.slice(0, i).trim(), r: s.slice(i + op.length).trim() };
          }
        }
      }
    }
    return null;
  }

  /* -------- macierze symboliczne: det i odwrotna na wyrażeniach nerdamera -------- */

  // "[a,b;c,d]" → [["a","b"],["c","d"]]
  function parseMatrixCells(s) {
    const body = String(s).trim().replace(/^\[/, "").replace(/\]$/, "").trim();
    const rows = splitTop(body, ";").filter(Boolean);
    const m = rows.map(r => splitTop(r, ","));
    if (!m.length || m.some(r => r.length !== m[0].length || r.some(c => !c))) {
      throw casError("Zapis macierzy: [wiersz1; wiersz2] z kolumnami po przecinku, np. [a,b;c,d].");
    }
    return m;
  }

  function sdet(m) {
    if (m.length !== m[0].length) throw casError("Wyznacznik tylko dla macierzy kwadratowych.");
    if (m.length > 4) throw casError("Symboliczny wyznacznik do rozmiaru 4×4 (większe policz numerycznie).");
    if (m.length === 1) return m[0][0];
    if (m.length === 2) return nerdamer(`(${m[0][0]})*(${m[1][1]})-(${m[0][1]})*(${m[1][0]})`).simplify().text();
    let acc = "0";
    for (let j = 0; j < m.length; j++) {
      const minor = m.slice(1).map(row => row.filter((_, c) => c !== j));
      const sign = j % 2 ? "-" : "";
      acc = nerdamer(`(${acc})+(${sign}(${m[0][j]}))*(${sdet(minor)})`).simplify().text();
    }
    return acc;
  }

  // odwrotność metodą Gaussa-Jordana na wyrażeniach (dokładne ułamki, także symbole)
  function sinv(m) {
    const n = m.length;
    if (n !== m[0].length) throw casError("Macierz odwrotna tylko dla macierzy kwadratowych.");
    if (n > 4) throw casError("Symboliczna macierz odwrotna do rozmiaru 4×4 (większą policz numerycznie).");
    const nd = (s) => nerdamer(String(s));
    const M = m.map((row, r) => row.map(c => nd(c).text()).concat(row.map((_, c) => (r === c ? "1" : "0"))));
    for (let col = 0; col < n; col++) {
      let piv = -1;
      for (let r = col; r < n; r++) {
        try { if (nd(M[r][col]).text() !== "0" && nd(M[r][col]).evaluate().text() !== "0") { piv = r; break; } }
        catch (e) { piv = r; break; }
      }
      if (piv === -1) throw casError("det = 0 — macierz osobliwa, nie ma macierzy odwrotnej.");
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      const pv = M[col][col];
      for (let c = 0; c < 2 * n; c++) M[col][c] = nd(M[col][c]).divide(pv).simplify().text();
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        try { if (nd(factor).text() === "0") continue; } catch (e) {}
        for (let c = 0; c < 2 * n; c++) {
          M[r][c] = nd(M[r][c]).subtract(nd(factor).multiply(M[col][c])).simplify().text();
        }
      }
    }
    return M.map(row => row.slice(n).map(c => c.replace(/\*1\//g, "/")));
  }

  function matrixCellsToHtml(cells, label) {
    return `<div class="m-resblock"><div class="m-reslabel">${label}</div>
      <table class="mtx">${cells.map(row => `<tr>${row.map(c => `<td>${latexToHtml(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  }

  /* -------- nierówności: liniowe symbolicznie, pozostałe numerycznie w oknie -------- */

  // nierówność liniowa a·v + b (op) 0 → dokładny wynik "x (op) krańców"; zwraca null, gdy nieliniowa
  function solveLinearInequality(L, R, expr, v, op) {
    try {
      const e = nerdamer(toNerdamer(expr));
      const aE = e.diff(v);
      if (aE.diff(v).text() !== "0") return null;
      const aNum = numOf(aE.text());
      if (aNum === null) return null;                    // współczynnik symboliczny → ścieżka numeryczna
      const bE = e.subst(v, "0");
      if (Math.abs(aNum) < 1e-15) {
        const cNum = numOf(bE.text());
        if (cNum === null) return null;
        const holds = op === "<" ? cNum < 0 : op === "<=" ? cNum <= 0 : op === ">" ? cNum > 0 : cNum >= 0;
        return { desc: holds ? "nierówność zawsze prawdziwa (x ∈ ℝ)" : "brak rozwiązań", intervals: [], notes: [], boundary: [] };
      }
      const root = nerdamer("((-1)*(" + bE.text() + "))/(" + aE.text() + ")").simplify().text();
      // przy ujemnym a znak nierówności się odwraca
      const flipped = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
      const finalOp = aNum < 0 ? flipped[op] : op;
      const rootNum = numOf(root);
      const notes = [];
      if (aNum < 0) notes.push("Współczynnik przy " + v + " jest ujemny — znak nierówności został odwrócony.");
      if (rootNum !== null && !/^[\-0-9./]+$/.test(root)) notes.push(`${finalOp} ${root}  ≈  ${fmtNum(rootNum)}`);
      return {
        desc: `${v} ${finalOp} ${root}`,
        relational: true,
        intervals: [],
        notes,
        boundary: [{ exact: root, num: rootNum }]
      };
    } catch (err) { return null; }
  }

  function solveInequality(ineq, v) {
    const m = ineq.match(/(<=|>=|<|>)/);
    if (!m) throw casError("Nie rozpoznano znaku nierówności.");
    const op = m[1];
    const parts = ineq.split(op);
    if (parts.length !== 2) throw casError("Nierówność musi mieć postać: wyrażenie < wyrażenie.");
    const L = parts[0].trim(), R = parts[1].trim();
    const expr = "(" + L + ")-(" + R + ")";

    // nierówność liniowa: rozwiązanie dokładne (symboliczne), bez okna numerycznego
    const lin = solveLinearInequality(L, R, expr, v, op);
    if (lin) return lin;

    const f = compile(expr, v);
    // okno analizy
    const hasTrig = /sin|cos|tan|sec|csc|cot/.test(expr);
    const a = hasTrig ? -3 * Math.PI : -100, b = hasTrig ? 3 * Math.PI : 100;
    // dokładne krańce (równanie graniczne), fallback numeryczny
    let boundary = [];
    const exact = solveEquation(L + "=" + R, v);
    if (exact.solutions && exact.solutions.length) {
      for (const s of exact.solutions) {
        const num = numOf(s);
        if (num !== null && num > a && num < b) boundary.push({ exact: s, num });
      }
    }
    if (!boundary.length) {
      boundary = findRoots(f, a, b).map(r => ({ exact: null, num: r }));
    }
    boundary.sort((p, q) => p.num - q.num);
    boundary = boundary.filter((p, i, arr) => i === 0 || Math.abs(p.num - arr[i - 1].num) > 1e-9);
    // klasyfikacja przedziałów
    const points = [a, ...boundary.map(p => p.num), b];
    const intervals = [];
    const strict = op === "<" || op === ">";
    const want = op === "<" || op === "<=" ? -1 : 1;
    const mid = (x1, x2) => {
      const mm = (x1 + x2) / 2, fv = f(mm);
      return isFinite(fv) && Math.sign(fv) === want && Math.abs(fv) > 0;
    };
    for (let k = 0; k < points.length - 1; k++) {
      if (mid(points[k], points[k + 1])) {
        const lo = { v: points[k], excl: k === 0 }, hi = { v: points[k + 1], excl: k === points.length - 2 };
        intervals.push([lo, hi]);
      }
    }
    // krańce: punkt graniczny spełnia nierówność tylko dla <= i >=
    const endpointHolds = (x) => { const fv = f(x); return !strict && isFinite(fv) && Math.abs(fv) < 1e-9; };
    // budowa opisu
    const fmtPoint = (p) => p.exact ? p.exact : fmtNum(p.v);
    let desc = intervals.map(([lo, hi]) => {
      const l = endpointHolds(lo.v) ? "[" : "(";
      const r = endpointHolds(hi.v) ? "]" : ")";
      return `${l}${fmtPoint(lo)}, ${fmtPoint(hi)}${r}`;
    }).join(" ∪ ");
    // pojedyncze punkty (np. x^2>=0)
    if (!intervals.length) {
      const hold = boundary.some(p => endpointHolds(p.num));
      if (hold) desc = "{x = " + boundary.map(p => fmtPoint(p)).join(", ") + "}";
      else desc = "brak rozwiązań";
    }
    const notes = [];
    if (hasTrig) notes.push("Przedziały podane w oknie [−3π, 3π]; rozwiązanie powtarza się okresowo (okres 2π dla sin/cos).");
    if (intervals.some(([lo, hi]) => lo.excl || hi.excl)) notes.push("Rozwiązanie kontynuuje poza okno analizy.");
    return { desc, intervals, notes, boundary };
  }

  function numOf(text) {
    try {
      const n = nerdamer(toNerdamer(String(text))).evaluate().text();
      const v = parseFloat(n);
      return isFinite(v) ? v : null;
    } catch (e) { return null; }
  }

  /* ============================== Ewaluacja ============================== */

  function evaluateNumeric(exprText) {
    const code = toMathJS(exprText);
    const sc = Object.assign({}, scope.vars);
    const v = math.evaluate(code, sc);
    return v;
  }

  const ASSIGN_FN = /^([a-zA-Z][a-zA-Z0-9_]*)\s*\(([^()]*)\)\s*=\s*(.+)$/;
  const ASSIGN_VAR = /^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(?![=])(.+)$/;

  function evaluate(input) {
    const t0 = Date.now();
    const result = { input: String(input || ""), ok: false, exact: null, approx: null,
                     approxText: "", latex: "", html: "", kind: "", info: [], error: null, ms: 0 };
    try {
      // definicja funkcji wykrywamy na SUROWYM wejściu (normalize wstawiłby '*' przed nawiasem)
      const semi = String(input == null ? "" : input);
      const mfnRaw = semi.match(ASSIGN_FN);
      if (mfnRaw && !KNOWN.has(mfnRaw[1].toLowerCase()) && !mfnRaw[1].includes("ans")) {
        const name = mfnRaw[1];
        const params = mfnRaw[2].split(",").map(p => p.trim()).filter(Boolean);
        const body = normalize(mfnRaw[3]);
        if (!params.length || params.some(p => !/^[a-zA-Z]$/.test(p))) {
          result.error = "Parametry funkcji muszą być pojedynczymi literami, np. f(x) = x^2.";
          return result;
        }
        const fn = compile(body, params[0]);
        // uniwersalne wywołanie przez mathjs (obsługuje dowolną liczbę parametrów)
        const caller = (...args) => {
          const sc = Object.assign({}, scope.vars);
          params.forEach((p, i) => { sc[p] = args[i]; });
          return math.evaluate(toMathJS(body), sc);
        };
        scope.fns[name] = { params, body, fn: caller, compiled: fn };
        try { math.import({ [name]: caller }, { override: true }); } catch (e) {}
        result.ok = true; result.kind = "assignment";
        result.norm = `${name}(${params.join(",")})=${body}`;
        result.exact = `${name}(${params.join(", ")}) = ${body}`;
        result.html = `<span class="fn">${name}</span>(${params.join(", ")}) = ${previewHtml(body).html}`;
        result.info.push("Funkcja zapisana — dostępna w obliczeniach i na wykresach (zakładka WYKRESY).");
        return finish(result, t0);
      }

      const norm = normalize(input);
      result.norm = norm;
      if (!norm) { result.error = "Puste wyrażenie."; return result; }

      // nieznane funkcje (np. foo(3)) — sprawdzane na surowym wejściu (normalize wstawia '*')
      const badFns = unknownFunctionCalls(semi);
      if (badFns.length) {
        result.error = `Nieznana funkcja „${badFns[0]}” — sprawdź pisownię lub zdefiniuj ją (np. ${badFns[0]}(x) = x^2).`;
        return result;
      }


      // ---- przypisanie zmiennej: x = wyrażenie
      const mvar = norm.match(ASSIGN_VAR);
      if (mvar && !KNOWN.has(mvar[1].toLowerCase()) && mvar[1].length <= 1) {
        const name = mvar[1], body = mvar[2].trim();
        const val = evaluateNumeric(body);
        const numVal = typeof val === "number" ? val : (isComplex(val) ? val.re : NaN);
        if (!isFinite(numVal)) { result.error = "Nie udało się przypisać: wartość nie jest liczbą rzeczywistą."; return result; }
        scope.vars[name] = numVal;
        result.ok = true; result.kind = "assignment";
        result.exact = `${name} = ${fmtNum(numVal)}`;
        result.approx = numVal; result.approxText = fmtNum(numVal);
        result.html = `${name} = <b>${fmtNum(numVal)}</b>`;
        result.info.push(`Zmienna ${name} zapisana — używaj jej w dalszych obliczeniach.`);
        return finish(result, t0);
      }

      // ---- komendy CAS (przed gałęzią macierzową — solve([...]) też zawiera nawiasy []) ----
      const cmdMatch = norm.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*\(/);
      if (cmdMatch && COMMANDS.includes(cmdMatch[1].toLowerCase())) {
        return runCommand(cmdMatch[1].toLowerCase(), norm.slice(norm.indexOf("(") + 1, norm.lastIndexOf(")")), result, t0);
      }

      // ---- macierze symboliczne: det([a,b;c,d]) / inv([...]) z niewiadomymi
      const symM = norm.match(/^(det|inv)\s*\((.*)\)$/);
      if (symM && symM[2].includes("[")) {
        const cells = parseMatrixCells(symM[2].trim());
        // nerdamer nie parsuje literałów macierzowych — symbole wyciągamy z komórek tekstowo
        const knownWords = new Set(["pi", "e", "i", "ans", ...FN1, ...FN2]);
        const syms = [...new Set(cells.flat().flatMap(c => String(c).match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []))]
          .filter(w => !knownWords.has(w.toLowerCase()) && !(w in scope.vars));
        if (syms.length) {
          if (symM[1] === "det") {
            const d = sdet(cells);
            result.ok = true; result.kind = "cas";
            result.exact = d; result.latex = d;
            result.html = "det = " + latexToHtml(d);
            const dn = numOf(d);
            if (dn !== null) result.info.push("dla liczb det ≈ " + fmtNum(dn));
          } else {
            const inv = sinv(cells);
            result.ok = true; result.kind = "cas";
            result.exact = "macierz odwrotna";
            result.html = matrixCellsToHtml(inv, "A⁻¹ (symbolicznie)");
          }
          return finish(result, t0);
        }
      }

      // ---- macierze/wektory: mathjs
      if (norm.includes("[")) {
        const v = evaluateNumeric(norm);
        result.ok = true; result.kind = "matrix";
        result.approx = v; result.approxText = fmtValue(v);
        result.html = matrixHtml(v);
        return finish(result, t0);
      }

      // ---- nierówność poza solve(): rozwiązujemy numerycznie w przedziałach
      if (/<=|>=|(?<![<>])<(?!=)|(?<![<>])>(?!=)/.test(norm)) {
        const cmp = splitTopLevelCompare(norm);
        const vars = freeVariables((cmp ? "(" + cmp.l + ")-(" + cmp.r + ")" : norm));
        const v = vars[0] || "x";
        const sol = solveInequality(norm, v);
        result.ok = true; result.kind = "inequality";
        result.desc = sol.desc;
        result.exact = sol.desc;
        result.html = sol.relational ? sol.desc : `<b>${v}</b> ∈ ${sol.desc}`;
        sol.notes.forEach(nn => result.info.push(nn));
        return finish(result, t0);
      }

      // ---- pojedyncze równanie poza solve(): automatyczne rozwiązanie
      if (norm.includes("=") && !norm.match(ASSIGN_VAR)) {
        const vars = freeVariables(norm);
        const cmp = splitTopLevelCompare(norm);
        if (vars.length === 1 && cmp) {
          const v = vars[0];
          const sol = solveEquation(norm, v);
          if (sol.solutions && sol.solutions.length) {
            result.ok = true; result.kind = "solve";
            result.exact = sol.solutions.map(s => `${v} = ${s}`).join("   ∨   ");
            result.latex = sol.solutions.map(s => `${v} = ${s}`).join(" \\lor ");
            result.html = sol.solutions.map(s => `${v} = ${latexToHtml(s)}`).join("<br>");
            if (sol.periodic) result.info.push("n ∈ ℤ — rozwiązania powtarzają się okresowo.");
            for (const s of sol.solutions) {
              const n2 = numOf(s);
              if (n2 !== null && !/^[\-0-9./]+$/.test(s)) result.info.push(`${v} = ${s}  ≈  ${fmtNum(n2)}`);
            }
            return finish(result, t0);
          }
        }
        // brak zmiennych → porównanie liczb
        if (!vars.length && cmp) {
          const lv = evaluateNumeric(cmp.l), rv = evaluateNumeric(cmp.r);
          const eq = Math.abs(lv - rv) < 1e-10 * Math.max(1, Math.abs(lv), Math.abs(rv));
          result.ok = true; result.kind = "boolean";
          result.exact = eq ? "PRAWDA" : "FAŁSZ";
          result.html = `<b>${eq ? "PRAWDA" : "FAŁSZ"}</b>`;
          return finish(result, t0);
        }
        result.error = vars.length > 1
          ? `Równanie z ${vars.length} niewiadomymi — użyj: solve(równanie, ${vars[0]}) lub solve([r1, r2], [${vars.join(", ")}]) dla układu.`
          : "Nie umiem rozwiązać tego równania. Spróbuj: solve(równanie, zmienna).";
        return result;
      }

      // ---- czyste wyrażenie
      const vars = freeVariables(norm);
      const defined = vars.filter(v => v in scope.vars);
      const symbolic = vars.filter(v => !(v in scope.vars));

      if (!symbolic.length) {
        // wszystko znane → wynik dokładny (nerdamer) + przybliżenie (mathjs)
        let exact = null;
        try { exact = nerdamer(toNerdamer(norm)).text(); } catch (e) {}
        // nerdamer nie zna funkcji użytkownika — taki „dokładny” tekst (np. 10*h) jest mylący
        if (exact && Object.keys(scope.fns).some(n => new RegExp("\\b" + n + "\\b").test(exact))) exact = null;
        const approx = evaluateNumeric(norm);
        // dziesiętny artefakt nerdamera (np. „5.0” wobec 5) → zostaje samo przybliżenie;
        // wyniki porządne (14, 1/2, 2^(1/2)) zostają
        if (exact && typeof approx === "number" && isFinite(approx) && exact.includes(".")) {
          const ex = numOf(exact);
          if (ex !== null && Math.abs(ex - approx) <= 1e-12 * Math.max(1, Math.abs(approx))) exact = null;
        }
        result.ok = true;
        result.kind = isComplex(approx) ? "complex" : "number";
        result.exact = exact;
        result.approx = approx; result.approxText = fmtValue(approx);
        result.latex = exact || null;
        result.html = exact ? latexToHtml(exact) : fmtValue(approx);
        if (isComplex(approx) && exact && !exact.includes("i")) {
          result.info.push("Wynik jest liczbą zespoloną.");
        }
        return finish(result, t0);
      }
      // wyrażenie symboliczne
      let exact = null;
      try { exact = nerdamer(toNerdamer(norm)).simplify().text(); } catch (e) { exact = null; }
      if (exact === null) { result.error = "Nie udało się przetworzyć wyrażenia."; return result; }
      result.ok = true; result.kind = "symbolic";
      result.exact = exact;
      result.latex = exact;
      result.html = latexToHtml(exact);
      if (defined.length) result.info.push("Uwzględniono zapisane zmienne: " + defined.join(", ") + ".");
      result.info.push("Wyrażenie symboliczne — podstaw wartości zmiennych (np. x = 2), by policzyć liczbowo.");
      return finish(result, t0);
    } catch (err) {
      result.error = friendlyError(err);
      return result;
    }
  }

  function finish(result, t0) {
    result.ms = Date.now() - t0;
    // zapamiętaj ostatni wynik liczbowy jako `ans`
    if (result.ok) {
      const v = typeof result.approx === "number" ? result.approx : (isComplex(result.approx) ? result.approx.re : null);
      if (v !== null && isFinite(v)) lastAns = { value: v, text: result.exact || result.approxText || String(v) };
      else if (result.exact && !result.approx) lastAns = { value: lastAns.value, text: result.exact };
    }
    return result;
  }

  function friendlyError(err) {
    const msg = String(err && err.message || err);
    if (/Unexpected end of expression|Paradoxa|Value expected/i.test(msg)) return "Niedokończone wyrażenie — sprawdzaj nawiasy i operatory.";
    if (/Undefined symbol|is not defined/i.test(msg)) return "Nieznana zmienna lub funkcja. Zdefiniuj ją (np. x = 2) lub sprawdź pisownię.";
    if (/Parenthesis \) expected/i.test(msg)) return "Brakuje nawiasu zamykającego „)”.";
    if (/Unsupported function/i.test(msg)) return "Nieznana funkcja — sprawdź listę na klawiaturze f(x).";
    if (msg.indexOf("Expected plain variable") >= 0) return "Nazwa zmiennej jest niepoprawna (używaj pojedynczych liter lub nazw bez spacji).";
    if (/Dimension mismatch/i.test(msg)) return "Niezgodne wymiary macierzy/wektorów.";
    if (typeof process !== "undefined" && process.env && process.env.ENGINE_DEBUG) return msg + "\n" + (err && err.stack || "");
    return msg;
  }

  function matrixHtml(v) {
    let arr = v;
    if (v && v.toArray) arr = v.toArray();
    if (!Array.isArray(arr)) return "<b>" + fmtValue(v) + "</b>";
    const isM = Array.isArray(arr[0]);
    if (!isM) return "[ " + arr.map(x => fmtValue(x)).join(",&nbsp; ") + " ]";
    return `<table class="mtx">${arr.map(row => `<tr>${row.map(c => `<td>${fmtValue(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  }

  /* ============================== Obsługa komend ============================== */

  function runCommand(cmd, argsStr, result, t0) {
    const args = splitTop(argsStr);
    const need = (n) => { if (args.length < n) throw casError(`Komenda „${cmd}” wymaga ${n} argumentów: sprawdź podpowiedź na klawiaturze CAS.`); };
    switch (cmd) {
      case "solve": {
        need(1);
        let eqPart = args[0], varPart = args[1];
        // układ?
        if (eqPart.trim().startsWith("[") && eqPart.includes(",")) {
          const eqs = splitTop(eqPart.trim().slice(1, -1));
          const vars = varPart ? splitTop(varPart.trim().replace(/^\[/, "").replace(/\]$/, "")) : detectVars(eqs.join(" "));
          const sys = solveSystem(eqs, vars);
          result.ok = true; result.kind = "system";
          const valList = Array.isArray(sys.values) ? sys.values : [sys.values];
          const rows = valList.map(vals =>
            Object.entries(vals).map(([v, s]) => {
              const n = numOf(s);
              return `${v} = ${latexToHtml(s)}${n !== null ? ` <span class="approx">≈ ${fmtNum(n)}</span>` : ""}`;
            }).join(",&nbsp; "));
          result.html = rows.join("<br>");
          result.exact = valList
            .map(vals => Object.entries(vals).map(([v, s]) => `${v} = ${s}`).join(", ")).join("   ∨   ");
          return finish(result, t0);
        }
        const vars = varPart ? [varPart.trim()] : detectVars(eqPart);
        if (!vars.length) throw casError("Nie znaleziono zmiennej — podaj ją: solve(równanie, zmienna).");
        const v = vars[0];
        // nierówność?
        if (/<=|>=|<|>/.test(eqPart)) {
          const sol = solveInequality(eqPart, v);
          result.ok = true; result.kind = "inequality";
          result.desc = sol.desc;
          result.exact = sol.desc;
          result.html = sol.relational ? sol.desc : `<b>${v}</b> ∈ ${sol.desc}`;
          sol.notes.forEach(nn => result.info.push(nn));
          return finish(result, t0);
        }
        const sol = solveEquation(eqPart, v);
        if (sol.error) throw casError("Błąd rozwiązywania: " + sol.error);
        if (!sol.solutions.length) {
          // fallback numeryczny
          const expr = eqPart.split("=")[0] + "-(" + (eqPart.split("=")[1] || "0") + ")";
          const f = compile(expr, v);
          const roots = findRoots(f, -50, 50, 4000);
          if (roots.length) {
            result.ok = true; result.kind = "solve"; result.numeric = true;
            result.exact = roots.map(r => `${v} ≈ ${fmtNum(r)}`).join("   ∨   ");
            result.html = roots.map(r => `${v} ≈ <b>${fmtNum(r)}</b>`).join("<br>");
            result.info.push("Rozwiązania numeryczne w oknie [−50, 50] (CAS nie znalazł rozwiązania symbolicznego).");
            return finish(result, t0);
          }
          result.ok = true; result.kind = "solve";
          result.exact = "brak rozwiązań";
          result.html = "<i>brak rozwiązań</i>";
          return finish(result, t0);
        }
        result.ok = true; result.kind = "solve";
        result.exact = sol.solutions.map(s => `${v} = ${s}`).join("   ∨   ");
        result.html = sol.solutions.map(s => {
          const n = numOf(s);
          return `${v} = ${latexToHtml(s)}${n !== null && !/^[\-0-9.]+$/.test(s) ? ` <span class="approx">≈ ${fmtNum(n)}</span>` : ""}`;
        }).join("<br>");
        result.latex = sol.solutions.map(s => `${v}=${s}`).join(" \\lor ");
        if (sol.periodic) result.info.push("n ∈ ℤ — rozwiązania powtarzają się okresowo.");
        return finish(result, t0);
      }
      case "nsolve": {
        need(1);
        const v = args[1] ? args[1].trim() : (detectVars(args[0])[0] || "x");
        const parts = args[0].split("=");
        const expr = parts[0] + "-(" + (parts[1] || "0") + ")";
        const f = compile(expr, v);
        const guess = args[2] ? parseFloat(args[2]) : null;
        let root = null;
        if (guess !== null && isFinite(guess)) {
          let x = guess;
          for (let k = 0; k < 200; k++) {
            const fx = f(x), d = deriv(f, x);
            if (!isFinite(fx)) break;
            if (Math.abs(fx) < 1e-14) { root = x; break; }
            if (!isFinite(d) || Math.abs(d) < 1e-15) break;
            x = x - fx / d;
          }
        }
        if (root === null) {
          const roots = findRoots(f, -100, 100, 6000);
          root = roots.length ? roots : null;
        }
        if (!root) { result.ok = true; result.exact = "brak rozwiązania w [−100, 100]"; result.html = "<i>brak rozwiązania</i>"; return finish(result, t0); }
        const list = Array.isArray(root) ? root : [root];
        result.ok = true; result.kind = "solve"; result.numeric = true;
        result.approx = list[0]; result.approxText = fmtNum(list[0]);
        result.exact = list.map(r => `${v} ≈ ${fmtNum(r)}`).join("   ∨   ");
        result.html = list.map(r => `${v} ≈ <b>${fmtNum(r)}</b>`).join("<br>");
        return finish(result, t0);
      }
      case "diff": {
        need(2);
        const f = args[0], v = args[1], n = args[2] ? Math.min(parseInt(args[2], 10) || 1, 12) : 1;
        let e = nerdamer(toNerdamer(f));
        for (let k = 0; k < n; k++) e = e.diff(v);
        const exact = e.text();
        result.ok = true; result.kind = "cas";
        result.exact = exact; result.latex = exact;
        result.html = `d/d${v} [${latexToHtml(f)}] = ` + latexToHtml(exact);
        return finish(result, t0);
      }
      case "integrate": case "int": {
        need(2);
        const f = args[0], v = args[1];
        const F = nerdamer(toNerdamer(f)).integrate(v);
        if (F === undefined || F === null) throw casError("Nie umiem wyznaczyć całki nieoznaczonej symbolicznie.");
        if (args.length >= 4) {
          const aS = args[2], bS = args[3];
          const Fa = F.subst(v, nerdamer(toNerdamer(aS)).text()).text();
          const Fb = F.subst(v, nerdamer(toNerdamer(bS)).text()).text();
          let exactVal;
          try { exactVal = nerdamer(`(${Fb})-(${Fa})`).simplify().text(); } catch (e) { exactVal = `(${Fb})-(${Fa})`; }
          const num = simpson(compile(f, v), parseFloat(numOf(aS)), parseFloat(numOf(bS)), 2000);
          result.ok = true; result.kind = "cas";
          result.exact = exactVal;
          result.latex = exactVal;
          result.html = `∫[${latexToHtml(aS)}, ${latexToHtml(bS)}] ${latexToHtml(f)} d${v} = ` + latexToHtml(exactVal) +
                        ` <span class="approx">≈ ${fmtNum(num)}</span>`;
          result.approx = num; result.approxText = fmtNum(num);
          result.info.push("Całka oznaczona: F(" + bS + ") − F(" + aS + ") dla F — funkcji pierwotnej.");
          return finish(result, t0);
        }
        const exact = F.text();
        result.ok = true; result.kind = "cas";
        result.exact = exact; result.latex = exact;
        result.html = `∫ ${latexToHtml(f)} d${v} = ` + latexToHtml(exact) + " + C";
        return finish(result, t0);
      }
      case "limit": {
        need(3);
        const f = args[0], v = args[1], at = args[2];
        const atLow = at.trim().toLowerCase();
        let out = null;
        if (/^-?inf/.test(atLow)) {
          try {
            const e = nerdamer(`limit(${toNerdamer(f)},${v},${atLow.startsWith("-") ? "-Infinity" : "Infinity"})`).text();
            out = e === "Inf" ? "∞" : e === "-Inf" ? "−∞" : e;
          } catch (err) {}
        } else {
          try {
            const e = nerdamer(`limit(${toNerdamer(f)},${v},${at})`).text();
            out = !/^limit\(/.test(e) ? (e === "Inf" ? "∞" : e === "-Inf" ? "−∞" : e) : null;
          } catch (err) {}
        }
        if (out === null) {
          const a = numOf(at);
          const nl = numericLimit(compile(f, v), a);
          if (nl.kind === "finite") out = fmtNum(nl.value);
          else {
            result.ok = true; result.kind = "cas";
            const fmtSide = (s) => !isFinite(s) ? (s > 0 ? "∞" : "−∞") : fmtNum(s);
            result.exact = nl.left === nl.right ? fmtSide(nl.left) : `lewa: ${fmtSide(nl.left)}, prawa: ${fmtSide(nl.right)}`;
            result.html = `lim(x→${latexToHtml(at)}) ${latexToHtml(f)} = <b>${result.exact}</b>`;
            if (nl.left !== nl.right) result.info.push("Granice jednostronne są różne — granica nie istnieje.");
            return finish(result, t0);
          }
        }
        result.ok = true; result.kind = "cas";
        result.exact = String(out); result.latex = String(out);
        result.html = `lim(x→${latexToHtml(at)}) ${latexToHtml(f)} = <b>${out === "∞" || out === "−∞" ? out : latexToHtml(String(out))}</b>`;
        return finish(result, t0);
      }
      case "sum": case "prod": case "product": {
        need(4);
        const f = args[0], k = args[1], aS = args[2], bS = args[3];
        const a = numOf(aS), b = numOf(bS);
        const isSum = cmd === "sum";
        if (a === null || b === null || !Number.isInteger(a) || !Number.isInteger(b)) {
          const sym = nerdamer(`${isSum ? "sum" : "prod"}(${toNerdamer(f)},${k},${toNerdamer(aS)},${toNerdamer(bS)})`).text();
          result.ok = true; result.kind = "cas";
          result.exact = sym; result.html = latexToHtml(sym);
          result.info.push("Granice muszą być liczbami całkowitymi, by policzyć wartość.");
          return finish(result, t0);
        }
        if (Math.abs(b - a) > 20000) throw casError("Zakres sumy/iloczynu jest za duży (max 20000 wyrazów).");
        let acc;
        if (Math.abs(b - a) <= 2000) {
          acc = nerdamer(isSum ? "0" : "1");
          for (let kk = a; kk <= b; kk++) {
            const term = nerdamer(toNerdamer(f)).subst(k, String(kk)).text();
            acc = isSum ? acc.add(term) : acc.multiply(term);
            if (Date.now() - t0 > 8000) throw casError("Obliczenie trwa za długo — zmniejsz zakres.");
          }
          result.exact = acc.text();
        } else {
          let s = isSum ? 0 : 1;
          const ff = compile(f, k);
          for (let kk = a; kk <= b; kk++) { const term = ff(kk); s = isSum ? s + term : s * term; }
          result.approx = s; result.approxText = fmtNum(s);
          result.info.push("Wynik numeryczny (duży zakres).");
        }
        result.ok = true; result.kind = "cas";
        const sym = isSum ? "Σ" : "Π";
        result.latex = result.exact || result.approxText;
        result.html = `${sym}(k=${latexToHtml(aS)}…${latexToHtml(bS)}) ${latexToHtml(f)} = <b>${result.exact ? latexToHtml(result.exact) : fmtNum(result.approx)}</b>`;
        return finish(result, t0);
      }
      case "expand": case "factor": case "simplify": {
        need(1);
        const e = nerdamer(toNerdamer(args[0]));
        const r = cmd === "expand" ? e.expand() : cmd === "factor" ? e.factor() : e.simplify();
        const exact = r.text();
        result.ok = true; result.kind = "cas";
        result.exact = exact; result.latex = exact;
        const label = cmd === "expand" ? "rozwinięcie" : cmd === "factor" ? "faktoryzacja" : "uproszczenie";
        result.html = `<span class="cas-label">${label}:</span> ` + latexToHtml(exact);
        return finish(result, t0);
      }
      case "odesolve": {
        need(4);
        // odesolve(y' = f(x,y), x0, y0, x1) — krzywa całkowa numerycznie (RK4)
        const fExpr = args[0].replace(/^y\s*'\s*=?\s*/i, "").replace(/^d\s*y\s*\/\s*d\s*x\s*=\s*/i, "");
        const x0 = numOf(args[1]), y0 = numOf(args[2]), x1 = numOf(args[3]);
        if (x0 === null || y0 === null || x1 === null || x0 === x1) {
          throw casError("Użycie: odesolve(y' = f(x,y), x0, y0, x1) — podaj liczby.");
        }
        const pts = odeSolve(fExpr, "x", "y", x0, y0, x1);
        const last = pts[pts.length - 1];
        result.ok = true; result.kind = "cas"; result.ode = { pts };
        result.exact = `y(${fmtNum(last[0])}) ≈ ${fmtNum(last[1])}`;
        result.html = `y' = ${latexToHtml(fExpr)} &nbsp;·&nbsp; y(${latexToHtml(args[1])}) = ${latexToHtml(args[2])} → ` +
          `y(${fmtNum(last[0])}) ≈ <b>${fmtNum(last[1])}</b>`;
        result.info.push("Metoda Rungego-Kotty 4. rzędu (numerycznie). Krzywą narysujesz na WYKRESACH — tryb „y' = f(x,y)”.");
        return finish(result, t0);
      }
      case "taylor": case "series": {
        need(4);
        const f = args[0], v = args[1], at = args[2], n = Math.min(parseInt(args[3], 10) || 4, 10);
        let terms = [];
        for (let k = 0; k <= n; k++) {
          let d = nerdamer(toNerdamer(f));
          for (let j = 0; j < k; j++) d = d.diff(v);
          const coef = d.subst(v, at).text();
          const fact = nerdamer(`factorial(${k})`).text();
          let term = nerdamer(`(${coef})/(${fact})`);
          if (k > 0) term = term.multiply(`((${v})-(${at}))^${k}`);
          terms.push(term.text());
        }
        const total = terms.reduce((acc, t2) => acc.add(t2), nerdamer("0")).expand().text();
        result.ok = true; result.kind = "cas";
        result.exact = total; result.latex = total;
        result.html = `Wielomian Taylora (rząd ${n}, a=${latexToHtml(at)}):<br>` + latexToHtml(total);
        return finish(result, t0);
      }
      default:
        throw casError("Nieznana komenda: " + cmd);
    }
  }

  function detectVars(text) {
    try {
      return nerdamer(toNerdamer(text)).variables();
    } catch (e) {
      const found = String(text).match(/[a-zA-Z]/g) || [];
      return [...new Set(found)].filter(c => !"e".includes(c));
    }
  }

  /* ============================== API publiczne ============================== */

  return {
    version: "1.1.0",
    settings, scope,
    normalize, previewHtml, evaluate, latexToHtml,
    compile, compile2, fmtNum, fmtValue, isComplex,
    findRoots, findExtrema, numericLimit, simpson, bisect, deriv, odeRK4, odeSolve,
    solveEquation, solveInequality, numOf, detectVars,
    sdet, sinv, parseMatrixCells,
    get lastAns() { return lastAns; },
    setAns(value, text) { lastAns = { value: typeof value === "number" ? value : 0, text: text || String(value) }; },
    setDeg(d) { settings.deg = !!d; applyAngleMode(); },
    resetScope() { scope.vars = {}; scope.fns = {}; }
  };
});
