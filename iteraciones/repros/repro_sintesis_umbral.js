// repro_sintesis_umbral.js — ¿a partir de qué tasa de aciertos del título corta el tope una
// búsqueda de UNA SOLA PALABRA, sana, con catálogo finito y cero errores?
//   node repro_sintesis_umbral.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const NUEVO = fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8");
const VIEJO = execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" });

const POR_PAGINA = 40, PAGS_CATALOGO = 400;  // 16.000 anuncios en el catálogo: se acaba solo
function load(src, casan, calls) {
  const api = (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/next_page=(\d+)/); const pag = m ? +m[1] : 0;
    const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
      id: `p${pag}-${k}`, title: k < casan ? "sofa impecable" : "mueble de salon",
      price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
      created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
    }));
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: { section: { payload: { items } } },
        meta: { next_page: pag + 1 < PAGS_CATALOGO ? String(pag + 1) : null } }) };
  };
  const sb = { fetch: (u) => (calls.push(1), api(u)), setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error, console: { error(){}, warn(){}, log(){} },
    module: { exports: {} }, require: { main: null } };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports;
}
const filas = (c) => c.trim().split("\r\n").length - 1;
(async () => {
  console.log('Una palabra ("sofa"), casilla "solo en el título" marcada, API perfecta.');
  console.log("aciertos/pag |      426a036^ (sin tope)      |        426a036 (tope 200)");
  for (const casan of [16, 12, 10, 8, 6, 4]) {
    const c1 = [], c2 = [];
    const m1 = load(VIEJO, casan, c1); const t1 = await m1.scrape({ keywords: "sofa", titleOnly: true });
    const m2 = load(NUEVO, casan, c2); const t2 = await m2.scrape({ keywords: "sofa", titleOnly: true });
    console.log(`  ${String(casan).padStart(2)}/40 (${String(Math.round(casan/40*100)).padStart(2)}%)  |` +
      ` ${String(c1.length).padStart(3)} pág, ${String(filas(t1)).padStart(4)} filas, parcial ${String(!!m1.lastScrape.parcial).padEnd(5)} |` +
      ` ${String(c2.length).padStart(3)} pág, ${String(filas(t2)).padStart(4)} filas, parcial ${String(!!m2.lastScrape.parcial).padEnd(5)}` +
      (filas(t2) < filas(t1) ? `  <- PIERDE ${filas(t1)-filas(t2)} anuncios` : ""));
  }
})();
