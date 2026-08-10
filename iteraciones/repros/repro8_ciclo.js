// repro8_ciclo.js — el precio real del tope: el recorte se marca `parcial`, app.js no lo cachea,
// y `loadQuery` vuelve a scrapear CADA vez que el usuario abre esa búsqueda guardada.
//
// Mismo escenario A de repro8_tope.js (API sana, catálogo finito, 32 ramas + "solo en el título"),
// pero conducido por app.js de verdad: se pulsa Buscar y luego se abre la búsqueda guardada dos
// veces. Se cuentan las páginas que salen a api.wallapop.com en total.
//
//   node repro8_ciclo.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { boot } = require("../../src/test_app.js");

const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^ (sin tope)": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036 (tope 200)": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};

const POR_PAGINA = 40, PAGS_RAMA = 8;
const KW = "(sofa | sofá | tresillo | chaise) (barato | oferta | rebajado | nuevo) (gris | beige)";

function donde(url) {
  const u = decodeURIComponent(url);
  const cur = u.match(/next_page=([^&]*)/);
  if (cur) { const [r, p] = cur[1].split("|"); return { rama: r, pag: +p }; }
  return { rama: u.match(/keywords=([^&]*)/)[1], pag: 0 };
}
const apiSana = (url) => {
  const { rama, pag } = donde(url);
  const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
    id: `${rama}-${pag}-${k}`,
    title: k < 4 ? rama + " impecable" : "Mueble de salón en buen estado",
    price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
    created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
  }));
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ data: { section: { payload: { items } } },
                         meta: { next_page: pag + 1 < PAGS_RAMA ? `${rama}|${pag + 1}` : null } }),
  };
};

// carga scrape.js de verdad en su propio vm, con fetch falso y sleeps instantáneos
function scraper(src, calls) {
  const sandbox = {
    fetch: (url) => (calls.push(String(url)), apiSana(String(url))),
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
    const calls = [];
    const mod = scraper(src, calls);
    const holder = {};
    // el usuario tiene marcado "solo en el título": el delegado lo mantiene también al reabrir
    const b = await boot({}, {
      timers: true,
      scrape: async (o) => {
        const csv = await mod.scrape({ ...o, titleOnly: true });
        holder.b.sandbox.Rebusca.lastScrape = mod.lastScrape;
        return csv;
      },
    });
    holder.b = b;
    const ev = (code) => vm.runInContext(code, b.sandbox);

    b.q("#kw").value = KW;
    b.q("#titleOnly").checked = true;
    await b.q("#scrape").click();
    await new Promise((r) => setImmediate(r));
    const tras1 = calls.length;
    const csv = ev("curCsv");
    const cacheado = !!ev(`csvIndex[${JSON.stringify(csv)}]`);
    const badge = ev(`unseenCount(${JSON.stringify(csv)})`);

    // el usuario vuelve a abrir su búsqueda guardada, dos veces
    await ev(`loadQuery(${JSON.stringify(csv)})`);
    const tras2 = calls.length;
    await ev(`loadQuery(${JSON.stringify(csv)})`);
    const tras3 = calls.length;

    console.log(`${nombre}`);
    console.log(`  buscar        -> ${tras1} páginas, ${ev("data.length")} anuncios en pantalla`);
    console.log(`  ¿se cachea?      ${cacheado}   badge "sin ver": ${badge === null ? "null (muerto)" : badge}`);
    console.log(`  abrir guardada-> +${tras2 - tras1} páginas`);
    console.log(`  abrir otra vez-> +${tras3 - tras2} páginas`);
    console.log(`  TOTAL a api.wallapop.com en tres aperturas: ${tras3} páginas\n`);
  }
})();
