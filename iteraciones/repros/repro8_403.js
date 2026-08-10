// repro8_403.js — el 403 que llega ANTES de la primera fila.
//
// Antes de la iteración 8 el 403 sin nada recogido subía como error (`if (rows.length) break;
// throw e;`) y app.js dejaba la pantalla como estaba. Ahora el `return finish()` del 403 va
// DELANTE de esa guarda, así que scrape() resuelve con un CSV de solo cabecera y app.js lo carga
// como si fuera un resultado: `loadCSV("")` borra lo que el usuario tenía en pantalla.
//
// scrape.js y app.js de verdad; el único falso es `fetch`.
//
//   node repro8_403.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { boot } = require("../../src/test_app.js");

const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^ (403 = error)": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036 (403 corta todo)": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};

const buena = (items) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({ data: { section: { payload: { items } } }, meta: { next_page: null } }),
});
const item = (id) => ({ id, title: id, price: { amount: 10 },
  location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
  created_at: Date.now(), taxonomy: [{ name: "Coches" }], user_id: "v", images: [] });

function scraper(src, estado) {
  const sandbox = {
    fetch: async (url) => (estado.bloquea
      ? { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) }
      : buena([item("a1"), item("a2"), item("a3")])),
    setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sandbox, { filename: "scrape.js" });
  return sandbox.module.exports;
}

(async () => {
  for (const [nombre, src] of Object.entries(SRC)) {
    const estado = { bloquea: false };
    const mod = scraper(src, estado);
    const holder = {};
    const b = await boot({}, {
      timers: true,
      scrape: async (o) => {
        const csv = await mod.scrape(o);
        holder.b.sandbox.Rebusca.lastScrape = mod.lastScrape;
        return csv;
      },
    });
    holder.b = b;
    const ev = (code) => vm.runInContext(code, b.sandbox);
    const flush = () => new Promise((r) => setImmediate(r));

    // 1) una búsqueda que sale bien: el usuario está mirando sus 3 anuncios
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    const antes = ev("data.length");

    // 2) repite la búsqueda y Wallapop bloquea la red en la PRIMERA petición
    estado.bloquea = true;
    b.q("#kw").value = "seat";
    await b.q("#scrape").click();
    await flush();

    console.log(nombre);
    console.log(`  anuncios en pantalla antes del 403: ${antes}  ->  después: ${ev("data.length")}`);
    console.log(`  aviso: "${b.q("#snackmsg").textContent}"`);
    console.log(`  búsquedas guardadas: ${b.store["wp_searches"] || "(ninguna)"}`);
    console.log(`  wp_lastcsv: ${b.store["wp_lastcsv"] || "(nada)"}\n`);
  }
})();
