// repro8_mutante.js — dos preguntas sobre el número 200.
//
// A · ¿lo defiende algún check? Se baja MAX_PAGINAS y se corre ./check.sh entero.
// B · el comentario dice que el tope "corta la fuga en dos minutos y medio". ¿Cuánto tarda de
//     verdad en saltar cuando la API contesta lo que contesta una API que te está frenando
//     (un 429 con Retry-After por página, y el reintento siguiente sí sirve)?
//
//   node repro8_mutante.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "..");
const F = path.join(DIR, "src/scrape.js");
const ORIG = fs.readFileSync(F, "utf8");

// ── A ──────────────────────────────────────────────────────────────────────────
console.log("A · ¿algún check nota que el tope cambie de valor?");
for (const v of [200, 20, 11, 10, 9]) {
  fs.writeFileSync(F, ORIG.replace(/const MAX_PAGINAS = \d+;/, `const MAX_PAGINAS = ${v};`));
  let exit = 0;
  try { execFileSync("./check.sh", { cwd: DIR, stdio: "pipe" }); } catch (e) { exit = e.status; }
  console.log(`  MAX_PAGINAS = ${String(v).padStart(3)}  ->  ./check.sh exit=${exit}` +
    (exit === 0 ? "   (VERDE: el mutante vive)" : "   (rojo)"));
}
fs.writeFileSync(F, ORIG);

// ── B ──────────────────────────────────────────────────────────────────────────
function load(src, fetchFake) {
  const calls = [];
  const reloj = { t: 0 };
  const sandbox = {
    fetch: (url) => (calls.push({ url: String(url), t: reloj.t }), fetchFake(String(url), calls.length - 1)),
    setTimeout: (cb, ms) => ((reloj.t += ms), cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls, reloj };
}
const item = (id) => ({ id, title: "x", price: { amount: 10 },
  location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
  created_at: Date.now(), taxonomy: [{ name: "x" }], user_id: "v", images: [] });
const pag = (items, next) => ({ data: { section: { payload: { items } } }, meta: { next_page: next } });

(async () => {
  console.log("\nB · el tope salta tras 200 páginas. ¿Cuánto tiempo y cuántas peticiones son?");
  const casos = [
    ["API que responde a la primera (el caso del comentario)", (i) => null],
    ["un 429 Retry-After: 5 por página, y el reintento sirve", (i) => (i % 2 === 0 ? 5 : null)],
    ["un 429 Retry-After: 30 por página, y el reintento sirve", (i) => (i % 2 === 0 ? 30 : null)],
  ];
  for (const [nombre, frena] of casos) {
    const { api, calls, reloj } = load(ORIG, async (u, i) => {
      const ra = frena(i);
      if (ra) return { ok: false, status: 429, headers: { get: (k) => (/retry/i.test(k) ? String(ra) : null) }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => null },
               json: async () => pag([item("id" + i)], "CUR" + i) };
    });
    await api.scrape({ keywords: "sofa" });
    console.log(`  ${nombre}`);
    console.log(`     ${calls.length} peticiones a api.wallapop.com en ${(reloj.t / 60000).toFixed(1)} min` +
      `   (el snack dirá "Tope de ${api.lastScrape.paginas - 1} páginas")`);
  }
})();
