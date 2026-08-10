// SÍNTESIS · ¿el "goteo" de 44.971 peticiones sobrevive a una distribución REALISTA?
// El repro de la lente reparte los aciertos con espaciado EXACTO (1 cada N anuncios). Aquí el
// mismo catálogo infinito pero con los aciertos al azar (semilla fija), que es lo que hace un
// catálogo de verdad. Se mide HEAD contra sus dos predecesores.
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "sin freno ": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "tope 200  ": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD secas": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};
let sem = 12345;
const rnd = () => (sem = (sem * 1103515245 + 12345) % 2147483648) / 2147483648;
function corre(src, p) {
  sem = 12345;
  let n = 0, id = 0;
  const sb = {
    fetch: async () => {
      n++;
      const items = Array.from({ length: 40 }, () => ({
        id: "x" + (id++), title: rnd() < p ? "sofa gris" : "otra cosa",
        price: { amount: 10 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
        created_at: Date.now(), taxonomy: [{ name: "H" }], user_id: "v", images: [],
      }));
      return { ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ data: { section: { payload: { items } } }, meta: { next_page: "C" + n } }) };
    },
    setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports.scrape({ keywords: "sofa", titleOnly: true })
    .then((csv) => ({ n, filas: csv.trim().split("\n").length - 1, parcial: sb.module.exports.lastScrape.parcial }));
}
(async () => {
  console.log("Catálogo INFINITO (el cursor no se acaba), 40 anuncios nuevos por página,");
  console.log("aciertos AL AZAR con probabilidad p por anuncio. maxRows = 1500.\n");
  console.log("1 acierto cada |    sin freno     |     tope 200     |    HEAD secas 30");
  for (const cada of [40, 100, 200, 400, 800, 1200, 2000]) {
    const p = 1 / cada;
    const out = [];
    for (const [nombre, src] of Object.entries(SRC)) {
      const r = await corre(src, p);
      out.push(`${String(r.n).padStart(6)} pág ${String(r.filas).padStart(4)} filas`);
    }
    console.log(`${String(cada).padStart(9)}      | ${out.join(" | ")}`);
  }
})();
