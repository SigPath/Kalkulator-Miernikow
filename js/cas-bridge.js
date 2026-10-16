/* CAS w Web Workerze — ciężkie obliczenia symboliczne bez blokowania UI.
 * Fallback: gdy Worker niedostępny (file://), obliczenia synchroniczne na wątku głównym. */
(function () {
  "use strict";

  let worker = null, seq = 0;
  const pending = new Map();   // id → {resolve, reject, timer}

  function spawn() {
    try {
      worker = new Worker("js/cas-worker.js");
    } catch (e) {
      worker = null;           // np. file:// — fallback synchroniczny
      return;
    }
    worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      ok ? p.resolve(result) : p.reject(new Error(error || "Błąd CAS"));
    };
    worker.onerror = () => {
      // awaria workera → odrzuć oczekujące i przejdź w tryb synchroniczny
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("Silnik CAS chwilowo niedostępny.")); }
      pending.clear();
      try { worker.terminate(); } catch (e) {}
      worker = null;
    };
  }

  function request(input, settings) {
    if (!worker) {
      // fallback synchroniczny (również w Node/testach)
      return Promise.resolve().then(() => {
        const res = window.Engine.evaluate(input);
        if (res.error) throw new Error(res.error);
        return res;
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        // przekroczono czas → restart workera (nie da się przerwać jednego zadania)
        try { worker.terminate(); } catch (e) {}
        spawn();
        reject(new Error("Przekroczono limit czasu obliczeń (10 s). Uprość wyrażenie lub użyj nsolve."));
      }, settings.timeoutMs || 10000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, input, deg: settings.deg });
    });
  }

  function syncScope() {
    if (worker && window.Engine) {
      worker.postMessage({
        scope: {
          vars: window.Engine.scope.vars,
          fns: Object.fromEntries(Object.entries(window.Engine.scope.fns).map(([k, f]) => [k, { params: f.params, body: f.body }]))
        }
      });
    }
  }

  spawn();

  window.CasBridge = { evaluate: request, syncScope, get workerActive() { return !!worker; } };
})();
