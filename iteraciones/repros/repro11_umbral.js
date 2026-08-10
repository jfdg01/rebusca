// repro11_umbral.js — LA PREGUNTA (a): ¿a partir de qué selectividad de "solo en el título"
// el freno nuevo le quita anuncios a una búsqueda SANA?
//
// Igual que repro_sintesis_umbral.js pero contra el freno nuevo, y con los aciertos repartidos
// AL AZAR por el catálogo (semilla fija, mismo catálogo para las tres versiones) en vez de
// k-de-cada-40 exactos: un catálogo real no reparte los aciertos con regla.
// Catálogo finito de 400 páginas (16.000 anuncios), API perfecta, una palabra, sin ramas OR.
//
//   node repro11_umbral.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "sin freno": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "tope 200": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD secas 30": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};
const POR_PAGINA = 40, PAGS = 400;

// azar reproducible: mismo catálogo para las tres versiones
function catalogo(tasa) {
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const casa = [];
  for (let i = 0; i < PAGS * POR_PAGINA; i++) casa.push(rnd() < tasa);
  return casa;
}

function load(src, casa, calls) {
  const api = (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/next_page=(\d+)/); const pag = m ? +m[1] : 0;
    const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
      id: `p${pag}-${k}`,
      title: casa[pag * POR_PAGINA + k] ? "sofa impecable" : "mueble de salon",
      price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
      created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
    }));
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: { section: { payload: { items } } },
        meta: { next_page: pag + 1 < PAGS ? String(pag + 1) : null } }) };
  };
  const sb = { fetch: (u) => (calls.push(1), api(u)), setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error, console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null } };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports;
}
const filas = (c) => c.trim().split("\r\n").length - 1;

(async () => {
  console.log('Una palabra ("sofa"), "solo en el título" marcada, API perfecta, catálogo de 400 pág.');
  console.log("Aciertos repartidos al azar (semilla fija). Sin OR, sin frescura.\n");
  console.log("tasa acierto |      sin freno       |       tope 200       |     HEAD secas 30");
  for (const tasa of [0.05, 0.02, 0.01, 0.005, 0.003, 0.002, 0.001]) {
    const casa = catalogo(tasa);
    const out = [];
    for (const src of Object.values(SRC)) {
      const calls = [];
      const mod = load(src, casa, calls);
      const csv = await mod.scrape({ keywords: "sofa", titleOnly: true });
      out.push({ p: calls.length, f: filas(csv), parcial: !!mod.lastScrape.parcial });
    }
    const c = (o) => `${String(o.p).padStart(3)} pág ${String(o.f).padStart(4)} filas p=${o.parcial ? "S" : "N"}`;
    const perd = out[0].f - out[2].f;
    console.log(`  ${(tasa * 100).toFixed(1).padStart(4)} %      | ${c(out[0])} | ${c(out[1])} | ${c(out[2])}` +
      (perd > 0 ? `  <- HEAD PIERDE ${perd} de ${out[0].f}` : ""));
  }
})();
