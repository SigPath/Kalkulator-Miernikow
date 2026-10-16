/* Web Worker silnika CAS — importuje mathjs, nerdamer i Engine, liczy poza wątkiem UI. */
importScripts("../vendor/math.min.js", "../vendor/nerdamer.all.min.js", "engine.js");

function registerScope(scope) {
  if (!scope) return;
  if (scope.vars) Engine.scope.vars = scope.vars;
  if (scope.fns) {
    Engine.scope.fns = {};
    for (const [name, f] of Object.entries(scope.fns)) {
      try {
        const body = Engine.normalize(f.body);
        const compiled = Engine.compile(body, f.params[0] || "x");
        const caller = (...args) => {
          const sc = {};
          (f.params || ["x"]).forEach((p, i) => { sc[p] = args[i]; });
          return math.evaluate(body, Object.assign({}, Engine.scope.vars, sc));
        };
        Engine.scope.fns[name] = { params: f.params, body: f.body, fn: caller, compiled };
        math.import({ [name]: caller }, { override: true });
      } catch (e) { /* pomiń funkcję, której nie da się odtworzyć */ }
    }
  }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.scope) { registerScope(msg.scope); return; }
  if (typeof msg.input !== "string") return;
  try {
    Engine.setDeg(!!msg.deg);
    const res = Engine.evaluate(msg.input);
    self.postMessage({ id: msg.id, ok: !res.error, result: res, error: res.error || null });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
};
