// repro8_backoff.js — el helper `esperar` de getJSON (arreglo 3 de la iteración 8).
//
// A · ¿cambió la duración del backoff de los intentos 1..4?
// B · ¿un 429 seguido de un 200 sigue funcionando?
// C · el 429 del ÚLTIMO intento trae `Retry-After`. El servidor dice "espera 30 s" y el cliente
//     se rinde SIN esperar: la rama muere y la SIGUIENTE rama pide de inmediato, sin jitter.
//     El scrape acaba mandando peticiones al doble de ritmo contra el servidor que pide calma,
//     que es justo lo que esta iteración dice querer evitar.
//
//   node repro8_backoff.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036 ": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};

// reloj simulado: cada sleep adelanta el reloj, así se puede fechar cada petición
function load(src, fetchFake) {
  const calls = [];      // [{url, t}] con t = ms simulados desde el inicio
  const esperas = [];
  const reloj = { t: 0 };
  const sandbox = {
    fetch: (url) => (calls.push({ url: String(url), t: reloj.t }), fetchFake(String(url), calls.length - 1)),
    setTimeout: (cb, ms) => (esperas.push(ms), (reloj.t += ms), cb(), 0),
    clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls, esperas, reloj };
}
const resp = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});
const pag = (items, next = null) => ({ data: { section: { payload: { items } } }, meta: { next_page: next } });
const item = (id) => ({ id, title: id, price: { amount: 10 },
  location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
  created_at: Date.now(), taxonomy: [{ name: "x" }], user_id: "v", images: [] });

(async () => {
  console.log("A · 503 en todo: duración de cada espera (redondeada a s, el jitter es aleatorio)");
  for (const [n, src] of Object.entries(SRC)) {
    const { api, esperas } = load(src, async () => resp(503, {}));
    await api.scrape({ keywords: "ford" }).catch(() => {});
    console.log(`  ${n}  esperas: [${esperas.map((m) => (m / 1000).toFixed(1)).join(", ")}] s`);
  }

  console.log("\nB · 429 y luego 200");
  for (const [n, src] of Object.entries(SRC)) {
    const { api, calls } = load(src, async (u, i) =>
      i === 0 ? resp(429, {}, { "retry-after": "1" }) : resp(200, pag([item("a")])));
    const csv = await api.scrape({ keywords: "ford" });
    console.log(`  ${n}  peticiones ${calls.length}  filas ${csv.trim().split("\r\n").length - 1}`);
  }

  console.log('\nC · "buena OR mala OR tercera": la rama mala devuelve 429 con Retry-After: 30.');
  console.log("     ¿cuánto pasa entre el último 429 (que dice «espera 30 s») y la petición siguiente?");
  for (const [n, src] of Object.entries(SRC)) {
    const { api, calls, reloj } = load(src, async (u) =>
      /mala/.test(u) ? resp(429, {}, { "retry-after": "30" }) : resp(200, pag([item(/tercera/.test(u) ? "c" : "a")])));
    await api.scrape({ keywords: "buena OR mala OR tercera" });
    const iUlt = calls.map((c) => /mala/.test(c.url)).lastIndexOf(true);
    const ultimo429 = calls[iUlt], siguiente = calls[iUlt + 1];
    const hueco = siguiente ? (siguiente.t - ultimo429.t) / 1000 : null;
    console.log(`  ${n}  peticiones ${calls.length}  scrape entero ${(reloj.t / 1000).toFixed(0)} s` +
      `  ·  hueco tras el último 429: ${hueco === null ? "n/a" : hueco.toFixed(1) + " s"} (el servidor pidió 30)`);
  }

  console.log("\nD · 32 ramas contra un servidor que solo devuelve 429 Retry-After: 30 (más una rama sana");
  console.log("     al principio para que el scrape no lance): peticiones y ritmo total.");
  for (const [n, src] of Object.entries(SRC)) {
    const kw = "(a | b | c | d) (e | f | g | h) (i | j)";  // 32 ramas
    const { api, calls, reloj } = load(src, async (u, i) =>
      i === 0 ? resp(200, pag([item("a")])) : resp(429, {}, { "retry-after": "30" }));
    await api.scrape({ keywords: kw });
    console.log(`  ${n}  peticiones ${calls.length}  en ${(reloj.t / 60000).toFixed(1)} min` +
      `  ->  ${(calls.length / (reloj.t / 60000)).toFixed(1)} peticiones/min`);
  }
})();
