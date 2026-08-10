// repro8_403b.js — los dos frentes que salen limpios, medidos igual.
//
// A · el 403 corta con `return finish()` desde dentro del for de ramas: ¿sobreviven las filas de
//     las ramas ANTERIORES, no solo las de la rama cortada?
// B · el comentario de src/scrape.js:225-227 afirma que `bloqueado` solo se pone detrás de
//     `ramasRotas++`. Se comprueba a la fuerza bruta: se recorren caminos de error y se mira si
//     alguna vez sale `bloqueado: true` con `ramasRotas: 0` (que dejaría `parcial` en false).
//
//   node repro8_403b.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "../../src/scrape.js"), "utf8");
function load(fetchFake) {
  const calls = [];
  const sandbox = {
    fetch: (url) => (calls.push(String(url)), fetchFake(String(url), calls.length - 1)),
    setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(SRC, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls };
}
const R = (status, body, h = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: (k) => h[k.toLowerCase()] ?? null }, json: async () => body });
const item = (id) => ({ id, title: id, price: { amount: 10 },
  location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
  created_at: Date.now(), taxonomy: [{ name: "x" }], user_id: "v", images: [] });
const pag = (items) => ({ data: { section: { payload: { items } } }, meta: { next_page: null } });
const filas = (csv) => csv.trim().split("\r\n").slice(1);

(async () => {
  // A · el 403 llega en la TERCERA rama, con dos ramas ya recogidas
  const { api, calls } = load(async (u) =>
    /ccc/.test(decodeURIComponent(u)) ? R(403, {}) : R(200, pag([item(decodeURIComponent(u).match(/keywords=(\w+)/)[1])])));
  const csv = await api.scrape({ keywords: "aaa OR bbb OR ccc OR ddd" });
  console.log("A · 403 en la 3ª de 4 ramas");
  console.log(`   filas que sobreviven: [${filas(csv).map((l) => l.split(",")[0]).join(", ")}]`);
  console.log(`   peticiones: ${calls.length} (la 4ª rama no llegó a pedir)  bloqueado: ${api.lastScrape.bloqueado}` +
    `  parcial: ${api.lastScrape.parcial}`);

  // B · barrido de caminos de error: ¿bloqueado sin ramasRotas?
  console.log("\nB · ¿alguna combinación deja `bloqueado: true` con `ramasRotas: 0`?");
  const codigos = [403, 429, 500, 502, 503, 504, 404, 400];
  let sospechoso = 0, casos = 0;
  for (const c of codigos) {
    for (const kws of ["aaa", "aaa OR bbb", "aaa OR bbb OR ccc"]) {
      for (const donde of ["primera", "ultima", "todas"]) {
        const { api } = load(async (u) => {
          const kw = (decodeURIComponent(u).match(/keywords=(\w+)/) || [, "cur"])[1];
          const malo = donde === "todas" || (donde === "primera" ? kw === "aaa" : kw === kws.split(" OR ").pop());
          return malo ? R(c, {}) : R(200, pag([item(kw)]));
        });
        await api.scrape({ keywords: kws }).catch(() => {});
        const d = api.lastScrape;
        casos++;
        if (d && d.bloqueado && !(d.ramasRotas > 0)) sospechoso++;
        if (d && d.bloqueado && !d.parcial) console.log(`   ¡bloqueado sin parcial! ${c} ${kws} ${donde}`);
      }
    }
  }
  console.log(`   ${casos} combinaciones probadas, ${sospechoso} con bloqueado sin ramasRotas.` +
    ` El comentario se sostiene: el término \`|| diag.bloqueado\` en \`parcial\` sería redundante.`);
})();
