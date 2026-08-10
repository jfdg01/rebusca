// repro11_goteo.js — LA PREGUNTA (b), versión SIN API rota.
//
// El escenario C de la iteración 8, el que su propio contrato llama «el que se ve en producción»:
// "solo en el título" + un cursor que no se acaba. La iteración 8 lo mataba a las 200 páginas.
// El freno nuevo solo lo mata si NO cae ni un acierto en 1200 anuncios seguidos; en cuanto el
// título casa de vez en cuando, el contador se pone a cero y el scrape se va hasta MAX_ROWS.
//
// Aquí no hay ids repetidos ni cursores que giren: cada página trae 40 anuncios NUEVOS, y una
// fracción de sus títulos casa. Es literalmente una búsqueda sana sobre un catálogo grande.
//
//   node repro11_goteo.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^ sin freno": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036  tope 200 ": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD     secas 30 ": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};
const POR_PAGINA = 40;

// aciertos regulares: uno cada `cada` anuncios. Cursor infinito (Wallapop lo da para términos
// amplios). Sin repetir un solo id.
function load(src, cada, calls, tiempo) {
  const api = (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/next_page=(\d+)/); const pag = m ? +m[1] : 0;
    const items = Array.from({ length: POR_PAGINA }, (_, k) => {
      const n = pag * POR_PAGINA + k;
      return { id: `a${n}`, title: n % cada === 0 ? "sofa cama chaise longue gris" : "mueble de salon",
        price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
        created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [] };
    });
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: { section: { payload: { items } } }, meta: { next_page: String(pag + 1) } }) };
  };
  const sb = { fetch: (u) => (calls.push(1), api(u)),
    setTimeout: (cb, ms) => (tiempo.ms += ms || 0, cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error, console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null } };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports;
}
const filas = (c) => c.trim().split("\r\n").length - 1;

(async () => {
  console.log('"solo en el título" sobre un catálogo grande: cada página trae 40 anuncios NUEVOS');
  console.log("y el cursor no se acaba. Un acierto cada N anuncios. Nada roto en la API.\n");
  console.log("1 acierto cada | 426a036^ sin freno |  426a036 tope 200  |    HEAD secas 30");
  for (const cada of [40, 100, 200, 400, 800, 1200, 2000]) {
    const out = [];
    for (const src of Object.values(SRC)) {
      const calls = [], tiempo = { ms: 0 };
      const mod = load(src, cada, calls, tiempo);
      const csv = await mod.scrape({ keywords: "sofa cama chaise longue gris", titleOnly: true });
      out.push({ p: calls.length, f: filas(csv), h: tiempo.ms / 3600000 });
    }
    const c = (o) => `${String(o.p).padStart(5)} pág ${String(o.f).padStart(4)} filas`;
    console.log(`  ${String(cada).padStart(5)}        | ${c(out[0])} | ${c(out[1])} | ${c(out[2])}` +
      `   (${out[2].h.toFixed(1)} h de reloj)`);
  }
})();
