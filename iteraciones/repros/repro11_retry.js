// repro11_retry.js — el Retry-After del quinto intento, y el corte por rama.
//
// A · un servidor que manda `Retry-After: 3600` en la ÚLTIMA rama: la espera del quinto intento
//     no precede a nada (no hay rama siguiente), así que es una hora de cuelgue pura al final
//     de una búsqueda que ya ha fracasado.
// B · abortar DURANTE esa espera: ¿con qué termina scrape()?
// C · el corte por `break`: el resto de ramas se piden y diag.ramasSecas cuenta bien.
//
//   node repro11_retry.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036  (quinto sin dormir)": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD     (quinto con Retry-After)": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};
const AHORA = fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8");

function load(src, fetchFake, reloj) {
  const calls = [], esperas = [], timers = [], orden = [];
  const sb = {
    fetch: (u, init) => (calls.push(String(u)), orden.push("PET"), fetchFake(String(u), init, calls.length - 1)),
    setTimeout: reloj === "congelado" ? (cb) => (timers.push(cb), 0)
                                      : (cb, ms) => (esperas.push(ms), orden.push("ESP" + Math.round(ms / 1000) + "s"), cb(), 0),
    clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error, console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return { api: sb.module.exports, calls, esperas, timers, orden };
}
const resp = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});
const page = (items, next = null) => ({ data: { section: { payload: { items } } }, meta: { next_page: next } });
const item = (id, o = {}) => ({ id, title: o.title || id, price: { amount: 10 },
  location: { latitude: 37.78, longitude: -3.78, city: "Jaen" }, created_at: Date.now(),
  taxonomy: [{ name: "x" }], user_id: "v", images: [] });

(async () => {
  // ── A · Retry-After: 3600 en una búsqueda de UNA sola rama ──
  console.log("A · una rama, el servidor manda 429 con Retry-After: 3600 siempre.");
  console.log("    La espera del quinto intento no precede a ninguna petición: no hay rama siguiente.\n");
  for (const ra of ["3600", "120"]) {
    console.log(`  ── Retry-After: ${ra} ──`);
    for (const [nombre, src] of Object.entries(SRC)) {
      const { api, esperas, calls, orden } = load(src, async () => resp(429, {}, { "retry-after": ra }));
      const err = await api.scrape({ keywords: "ford" }).then(() => null, (e) => e.message);
      const total = esperas.reduce((a, b) => a + b, 0);
      const ultEsp = orden.map((x, i) => (x.startsWith("ESP") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      const petTras = orden.slice(ultEsp + 1).filter((x) => x === "PET").length;
      console.log(`    ${nombre}`);
      console.log(`      peticiones ${calls.length}  esperas ${esperas.length}  ->  cuelgue total ${(total / 60000).toFixed(1)} min`);
      console.log(`      orden real: ${orden.join(" ")}`);
      console.log(`      peticiones DESPUÉS de la última espera: ${petTras}`);
      console.log(`      termina con: ${err}`);
    }
    console.log("");
  }

  // ── B · abortar durante la última espera. El fetch falso SÍ respeta el signal, como el del
  //        browser: un fetch sobre un signal ya abortado lanza AbortError.
  console.log("B · el usuario le da a «parar» durante la última espera (reloj congelado: no vuelve sola).");
  console.log("    Fetch fiel: sobre un signal abortado lanza AbortError, como el del browser.\n");
  for (const [nombre, src] of Object.entries(SRC)) {
    const listeners = [];
    const signal = { aborted: false, addEventListener: (t, f) => listeners.push(f), removeEventListener: () => {} };
    const fetchFiel = async () => {
      if (signal.aborted) { const e = new Error("The user aborted a request."); e.name = "AbortError"; throw e; }
      return resp(429, {}, { "retry-after": "3600" });
    };
    const { api, calls, timers } = load(src, fetchFiel, "congelado");
    let fin = null, err = null;
    const p = api.scrape({ keywords: "ford", signal }).then((c) => (fin = c), (e) => (err = e));
    for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
    // se descongelan las esperas una a una hasta llegar a la ÚLTIMA del backoff
    while (timers.length && calls.length < 5) {
      timers.shift()();
      for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
    }
    console.log(`  ${nombre}`);
    console.log(`    peticiones antes de parar: ${calls.length}  ·  esperas congeladas pendientes: ${timers.length}`);
    signal.aborted = true; listeners.forEach((f) => f());
    for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
    await Promise.race([p, new Promise((r) => setTimeout(r, 200))]);
    console.log(`    tras parar -> ${fin !== null ? "resuelve con CSV" : err ? "RECHAZA \"" + err.message + "\"  (e.name=" + err.name + ")" : "SIGUE COLGADO"}`);
    console.log(`    diag.abortado = ${api.lastScrape ? api.lastScrape.abortado : "(sin diag: nunca llegó a finish())"}\n`);
  }

  // ── C · el corte hace break: ¿se piden las ramas de detrás? ¿cuenta bien ramasSecas? ──
  console.log("C · «seca OR buena OR seca2»: la 1ª y la 3ª no traen nada nuevo nunca, la 2ª sí.");
  {
    const { api, calls } = load(AHORA, async (u) => {
      const q = decodeURIComponent(u);
      if (q.includes("buena")) return resp(200, page([item("b1"), item("b2")], null));
      return resp(200, page([item("repetido")], "CUR"));   // siempre el mismo id: nunca fila nueva
    });
    const csv = await api.scrape({ keywords: "seca OR buena OR seca2" });
    const d = api.lastScrape;
    const porRama = {};
    for (const c of calls) { const m = decodeURIComponent(c).match(/keywords=([^&]*)/); if (m) porRama[m[1]] = 1; }
    console.log(`    peticiones ${calls.length}  ramas que llegaron a pedir: ${Object.keys(porRama).join(", ")}`);
    console.log(`    filas ${csv.trim().split("\r\n").length - 1}  diag: ramas=${d.ramas} ramasSecas=${d.ramasSecas} parcial=${d.parcial}`);
    console.log(`    el snack diría: "${d.ramasSecas} de ${d.ramas} ramas dejaron de traer anuncios nuevos: resultado recortado, no se guarda."`);
  }
})();
