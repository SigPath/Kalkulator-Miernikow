/*
 * Testy silnika obliczeniowego (Node, bez przeglądarki).
 * Uruchamianie: node tests/run-tests.js
 */
"use strict";
const Engine = require("../js/engine.js");

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; failures.push({ name, extra }); }
}

function evalText(input) {
  const r = Engine.evaluate(input);
  return r;
}

function approx(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }

/* ---------------- normalizacja ---------------- */
{
  const cases = [
    ["2×3", "2*3"],
    ["10÷4", "10/4"],
    ["5−2", "5-2"],
    ["2π", "2*pi"],
    ["x²", "x^2"],
    ["x³−2x", "x^3-2*x"],
    ["1,5+2", "1.5+2"],
    ["xy", "x*y"],
    ["2x", "2*x"],
    ["(x+1)(x-1)", "(x+1)*(x-1)"],
    ["factor(x^2-5*x+6)", "factor(x^2-5*x+6)"],
  ];
  for (const [inp, want] of cases) {
    const got = Engine.normalize(inp);
    check(`normalize(${inp})`, got === want, `got "${got}" want "${want}"`);
  }
  // przecinek NIE zamieniany, gdy jest separatorem argumentów funkcji
  check("normalize keep sep comma", Engine.normalize("sum(k,k,1,10)").includes(","), Engine.normalize("sum(k,k,1,10)"));
  check("normalize sin comma decimal", Engine.normalize("sin(1,5)").includes("1.5"), Engine.normalize("sin(1,5)"));
}

/* ---------------- arytmetyka dokładna ---------------- */
{
  const t = (inp, wantExact) => {
    const r = evalText(inp);
    check(`exact ${inp}`, r.ok && r.exact === wantExact, JSON.stringify({ ok: r.ok, exact: r.exact, err: r.error }));
  };
  t("1/3+1/6", "1/2");
  t("2+3*4", "14");
  t("2^10", "1024");
  t("sqrt(2)*sqrt(8)", "4");
  t("7/4", "7/4");
  t("(1/2+1/3)/(5/6)", "1");
}

/* ---------------- liczby zespolone ---------------- */
{
  const r = evalText("(1+2*i)*(2-i)");
  check("complex exact", r.ok && r.exact === "4+3*i", JSON.stringify(r));
  const r2 = evalText("sqrt(-4)");
  check("complex sqrt(-4)", r2.ok && /2\*i/.test(r2.exact || ""), JSON.stringify(r2.exact));
  const r3 = evalText("(1+2*i)*(2-i)");
  check("complex approx", r3.approxText.replace(/\s/g, "").replace("−", "-") === "4+3i", r3.approxText);
}

/* ---------------- tryby DEG/RAD ---------------- */
{
  Engine.setDeg(false);
  let r = evalText("sin(pi/6)");
  check("rad sin(pi/6)", approx(r.approx, 0.5, 1e-12), r.approx);
  Engine.setDeg(true);
  r = evalText("sin(30)");
  check("deg sin(30)", approx(r.approx, 0.5, 1e-12), r.approx);
  r = evalText("asin(0.5)");
  check("deg asin(0.5)", approx(r.approx, 30, 1e-9), r.approx);
  r = evalText("tan(45)");
  check("deg tan(45)", approx(r.approx, 1, 1e-12), r.approx);
  Engine.setDeg(false);
  r = evalText("sin(pi/6)");
  check("back to rad", approx(r.approx, 0.5, 1e-12), r.approx);
}

/* ---------------- solve ---------------- */
{
  let r = evalText("solve(x^2-4=0,x)");
  check("solve quad set", r.ok && r.exact.includes("2") && r.exact.includes("-2"), r.exact);
  r = evalText("solve(x^2-2=0,x)");
  check("solve irrational", r.ok && r.exact.includes("2^(1/2)"), r.exact);
  r = evalText("solve(x^3-6*x^2+11*x-6=0,x)");
  check("solve cubic", r.ok && ["1", "2", "3"].every(n => r.exact.includes(n)), r.exact);
  r = evalText("solve(cos(x)=0,x)");
  check("solve trig periodic", r.ok && r.exact.includes("pi") && r.exact.includes("n"), r.exact);
  r = evalText("solve(e^x=2,x)");
  check("solve transcendental", r.ok && r.exact.includes("log(2)"), r.exact);
  r = evalText("solve(x^2+1=0,x)");
  check("solve no real roots -> numeric fallback empty", r.ok, JSON.stringify(r));
  // równanie wpisane bezpośrednio
  r = evalText("x^2-9=0");
  check("bare equation auto-solve", r.ok && r.kind === "solve" && r.exact.includes("3"), JSON.stringify(r));
}

/* ---------------- układy równań ---------------- */
{
  let r = evalText("solve([x+y=3, x-y=1], [x, y])");
  check("system 2x2 numeric", r.ok && r.exact.includes("x = 2") && r.exact.includes("y = 1"), JSON.stringify({ exact: r.exact, err: r.error }));
  r = evalText("solve([2*x+y/2=4, x/3+y=3], [x, y])");
  check("system 2x2 fractions", r.ok && r.exact.length > 0 && !r.error, JSON.stringify({ exact: r.exact, err: r.error }));
  const m = r.exact.match(/x = ([\d./]+)/);
  if (m) {
    const [num, den] = m[1].split("/").map(Number);
    check("system exact fraction value", den ? approx(num / den, 15 / 11, 1e-9) : approx(num, 15 / 11, 1e-9), m[1]);
  }
  r = evalText("solve([x+y+z=6, x-y=1, 2*z+x=8], [x, y, z])");
  check("system 3x3", r.ok && r.exact.includes("x = 2") && r.exact.includes("y = 1") && r.exact.includes("z = 3"), JSON.stringify({ exact: r.exact, err: r.error }));
}

/* ---------------- nierówności ---------------- */
{
  let r = evalText("solve(x^2-4<0,x)");
  check("ineq quad", r.ok && r.desc.includes("-2") && r.desc.includes("2") && r.desc.startsWith("(") && r.desc.endsWith(")"), JSON.stringify(r.desc));
  r = evalText("2*x+3>=5");
  check("ineq linear exact", r.ok && r.desc === "x >= 1", JSON.stringify(r.desc));
  r = evalText("5-2*x<1");
  check("ineq linear flip", r.ok && r.desc === "x > 2", JSON.stringify(r.desc));
  r = evalText("3*x>2");
  check("ineq linear fraction", r.ok && r.desc === "x > 2/3", JSON.stringify(r.desc));
  r = evalText("solve(x^2-9>0,x)");
  check("ineq strict excluded", r.ok && r.desc.includes("(-100, -3)") && r.desc.includes("(3, 100)"), JSON.stringify(r.desc));
  r = evalText("solve(sin(x)>0,x)");
  check("ineq trig window", r.ok && r.info.some(s => s.includes("okresowo")), JSON.stringify(r.info));
}

/* ---------------- różniczkowanie, całki, granice, sumy ---------------- */
{
  let r = evalText("diff(x^3*sin(x),x)");
  check("diff product", r.ok && r.exact.includes("3*x^2*sin(x)") && r.exact.includes("cos(x)"), r.exact);
  r = evalText("diff(x^4,x,2)");
  check("diff order 2", r.ok && r.exact === "12*x^2", r.exact);
  r = evalText("integrate(x^2,x)");
  check("integrate", r.ok && r.exact.includes("x^3"), r.exact);
  r = evalText("integrate(x^2,x,0,1)");
  check("defint exact", r.ok && r.exact === "1/3", JSON.stringify({ exact: r.exact, err: r.error }));
  r = evalText("limit(sin(x)/x,x,0)");
  check("limit classic", r.ok && r.exact === "1", r.exact);
  r = evalText("limit(1/x,x,0)");
  check("limit divergent", r.ok && (r.exact.includes("lewa") || r.exact.includes("∞")), r.exact);
  r = evalText("limit((2*x+1)/(x+3),x,inf)");
  check("limit at inf", r.ok && r.exact === "2", r.exact);
  r = evalText("sum(k,k,1,10)");
  check("sum 1..10", r.ok && r.exact === "55", r.exact);
  r = evalText("sum(k^2,k,1,4)");
  check("sum k^2", r.ok && r.exact === "30", r.exact);
  r = evalText("prod(k,k,1,5)");
  check("prod 1..5", r.ok && (r.exact === "120" || r.approxText === "120"), JSON.stringify({ e: r.exact, a: r.approxText }));
}

/* ---------------- expand/factor/simplify/taylor ---------------- */
{
  let r = evalText("expand((x+1)*(x+2))");
  check("expand", r.ok && r.exact.includes("x^2") && r.exact.includes("3*x"), r.exact);
  r = evalText("factor(x^2-5*x+6)");
  check("factor", r.ok && /\(x-3\)|\(3-x\)|\(-3\+x\)|\(x\+3\)/.test(r.exact) && /\(x-2\)|\(2-x\)|\(-2\+x\)|\(x\+2\)/.test(r.exact), r.exact);
  r = evalText("simplify((x^2-1)/(x-1))");
  check("simplify", r.ok && r.exact.includes("1+x"), r.exact);
  r = evalText("taylor(sin(x),x,0,5)");
  check("taylor sin", r.ok && r.exact.includes("x") && r.exact.length > 5 && !r.error, JSON.stringify({ e: r.exact, err: r.error }));
}

/* ---------------- nsolve i numeryka ---------------- */
{
  let r = evalText("nsolve(cos(x)=x,x,0)");
  check("nsolve", r.ok && r.numeric && approx(parseFloat(r.approxText), 0.7390851332, 1e-6), r.approxText);
}
{
  const f = Engine.compile("x^2-2", "x");
  const roots = Engine.findRoots(f, -5, 5);
  check("findRoots sqrt2", roots.length === 2 && approx(roots[0], -Math.SQRT2, 1e-6) && approx(roots[1], Math.SQRT2, 1e-6), JSON.stringify(roots));
  const f2 = Engine.compile("x^3-3*x", "x");
  const ext = Engine.findExtrema(f2, -5, 5);
  check("findExtrema", ext.length === 2 && approx(ext.find(e => e.type === "min").x, 1, 1e-6) && approx(ext.find(e => e.type === "max").x, -1, 1e-6), JSON.stringify(ext));
  const f3 = Engine.compile("x^2", "x");
  check("simpson", approx(Engine.simpson(f3, 0, 1), 1 / 3, 1e-10));
  const f4 = Engine.compile("1/x", "x");
  const nl = Engine.numericLimit(f4, 0);
  check("numericLimit sides", nl.kind === "sides" && approx(nl.left, -1e7, 1e10) === false || nl.kind === "sides", JSON.stringify(nl.kind));
  const f5 = Engine.compile("sin(x)/x", "x");
  const nl2 = Engine.numericLimit(f5, 0);
  check("numericLimit finite", nl2.kind === "finite" && approx(nl2.value, 1, 1e-5), JSON.stringify(nl2));
}

/* ---------------- zmienne, przypisania, ans ---------------- */
{
  Engine.resetScope();
  let r = evalText("x = 5");
  check("assign x", r.ok && r.kind === "assignment", JSON.stringify(r));
  r = evalText("x^2+1");
  check("use var numeric", r.ok && approx(r.approx, 26, 1e-12), JSON.stringify({ a: r.approx, e: r.exact, err: r.error }));
  r = evalText("f(t) = t^2+2*t");
  check("define fn", r.ok && r.kind === "assignment", JSON.stringify(r));
  r = evalText("f(3)");
  check("call fn", r.ok && approx(r.approx, 15, 1e-12), JSON.stringify({ a: r.approx, err: r.error }));
  r = evalText("2*ans");
  check("ans", r.ok && approx(r.approx, 30, 1e-12), JSON.stringify({ a: r.approx, err: r.error }));
  Engine.resetScope();
}

/* ---------------- macierze (mathjs + symboliczne + zespolone) ---------------- */
{
  let r = evalText("det([1,2;3,4])");
  check("matrix det", r.ok && approx(r.approx, -2, 1e-12), JSON.stringify(r));
  r = evalText("[1,2;3,4]*[5;6]");
  check("matrix mul", r.ok && r.approxText.includes("17"), r.approxText);
  r = evalText("inv([4,7;2,6])");
  check("matrix inv", r.ok && r.approxText.includes("0.6"), r.approxText);
  r = evalText("det([a,b;c,d])");
  check("sdet 2x2", r.ok && r.exact === "a*d-b*c", JSON.stringify(r.exact));
  r = evalText("det([x,1;1,x])");
  check("sdet x", r.ok && r.exact.includes("x") && r.exact.includes("-1") || r.exact.includes("1+x"), r.exact);
  r = evalText("inv([a,1;1,a])");
  check("sinv", r.ok && r.html.includes("mtx") && r.html.includes("a"), r.html.slice(0, 80));
  // zespolone przez mathjs
  r = evalText("det([1+i,2;3,4-i])");
  check("det complex", r.ok && r.approxText.includes("i"), r.approxText);
}

/* ---------------- przecinek dziesiętny (deterministyczny) ---------------- */
{
  check("comma plain", Engine.normalize("1,5+2") === "1.5+2", Engine.normalize("1,5+2"));
  check("comma in fn", Engine.normalize("sin(1,5)") === "sin(1.5)", Engine.normalize("sin(1,5)"));
  check("comma in group", Engine.normalize("(1,5)+2") === "(1.5)+2", Engine.normalize("(1,5)+2"));
  check("comma max sep", Engine.normalize("max(1,5)") === "max(1,5)", Engine.normalize("max(1,5)"));
  check("comma log base", Engine.normalize("log(8,2)") === "log(8,2)", Engine.normalize("log(8,2)"));
  check("comma mixed", Engine.normalize("2,5+sin(1,5)") === "2.5+sin(1.5)", Engine.normalize("2,5+sin(1,5)"));
  const r = evalText("max(2,5)");
  check("comma max value", r.ok && r.approx === 5, JSON.stringify({ a: r.approx, e: r.error }));
  const r2 = evalText("2,5*2");
  check("comma decimal value", r2.ok && approx(r2.approx, 5, 1e-12), JSON.stringify({ a: r2.approx, e: r2.error }));
}

/* ---------------- równania różniczkowe (RK4) ---------------- */
{
  let pts = Engine.odeSolve("y", "x", "y", 0, 1, 1);
  let y1 = pts[pts.length - 1][1];
  check("ode y'=y", approx(y1, Math.E, 1e-8), y1);
  pts = Engine.odeSolve("-2*y", "x", "y", 0, 1, 1);
  check("ode y'=-2y", approx(pts[pts.length - 1][1], Math.exp(-2), 1e-8), pts[pts.length - 1][1]);
  pts = Engine.odeSolve("x", "x", "y", 0, 0, 1);
  check("ode y'=x", approx(pts[pts.length - 1][1], 0.5, 1e-8), pts[pts.length - 1][1]);
  const r = evalText("odesolve(y'=-2*y, 0, 1, 2)");
  check("odesolve cmd", r.ok && r.exact.includes("0.0183"), JSON.stringify({ e: r.exact, err: r.error }));
}

/* ---------------- formatowanie ---------------- */
{
  check("fmt sci", /10\^/.test(Engine.fmtNum(1.23456789e15)), Engine.fmtNum(1.23456789e15));
  check("fmt small", /10\^/.test(Engine.fmtNum(1e-12)), Engine.fmtNum(1e-12));
  check("fmt plain", Engine.fmtNum(0.5) === "0.5");
  check("fmt inf", Engine.fmtNum(Infinity) === "∞");
  const html = Engine.latexToHtml("1/2");
  check("latex frac html", html.includes("frac") && html.includes("num"), html);
  const html2 = Engine.latexToHtml("2^(1/2)");
  check("latex sqrt html", html2.includes("√"), html2);
  const html3 = Engine.latexToHtml("3*pi");
  check("latex pi html", html3.includes("π"), html3);
}

/* ---------------- podpowiedź (preview) ---------------- */
{
  const p = Engine.previewHtml("(x+1)/2");
  check("preview frac", p.ok && p.html.includes("frac"), p.html);
  const p2 = Engine.previewHtml("2+(;");
  check("preview error", !p2.ok || p2.error !== undefined, JSON.stringify(p2));
}

/* ---------------- błędy przyjazne ---------------- */
{
  const r = evalText("2+");
  check("friendly incomplete", r.error && /niedokończone/i.test(r.error), r.error);
  const r2 = evalText("foo(3)");
  check("unknown fn", r2.error && r2.error.length > 0, r2.error);
}

console.log(`\nWYNIK: ${passed} zaliczonych, ${failed} niepowodzeń`);
if (failures.length) {
  console.log("\nNiepowodzenia:");
  for (const f of failures) console.log(`  ✗ ${f.name}${f.extra ? " → " + f.extra : ""}`);
  process.exit(1);
}
