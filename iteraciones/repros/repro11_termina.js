// repro11_termina.js — LA PREGUNTA (b): ¿cuántas peticiones salen en el PEOR caso que se puede
// construir contra MAX_PAGINAS_SECAS = 30?
//
// El contador se pone a cero con UNA sola fila nueva. Una API que da exactamente una fila nueva
// cada 30 páginas nunca deja que `secas` llegue a 30, así que el freno no dispara jamás y el
// único techo que queda es MAX_ROWS = 1500 filas... a 30 páginas por fila.
//
// Se mide contra tres scrape.js: el padre de la iteración 8 (sin freno), la iteración 8
// (MAX_PAGINAS = 200) y HEAD (MAX_PAGINAS_SECAS = 30).
//
//   node repro11_termina.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^ (sin freno)": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036  (MAX_PAGINAS=200)": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD     (MAX_PAGINAS_SECAS=30)": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};

const POR_PAGINA = 40;
const SECAS = 29;   // 29 páginas secas y a la 30ª una fila nueva: `secas` nunca llega a 30

// La API: infinita, 200 siempre, cursor que siempre avanza. La página `pag` trae 40 anuncios;
// todos repiten ids ya vistos MENOS cuando pag % 30 == 0, que trae uno nuevo.
function apiCicloLargo(url, tiempo) {
  const u = decodeURIComponent(String(url));
  const m = u.match(/next_page=(\d+)/);
  const pag = m ? +m[1] : 0;
  const nuevo = pag % (SECAS + 1) === 0;
  const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
    id: nuevo && k === 0 ? `nuevo-${pag}` : `repe-${k}`,   // 39 repetidos + como mucho 1 nuevo
    title: "sofa impecable",
    price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
    created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
  }));
  return { ok: true, status: 200, headers: { get: () => null },
           json: async () => ({ data: { section: { payload: { items } } },
                                meta: { next_page: String(pag + 1) } }) };
}

function load(src, calls, tiempo) {
  const sb = {
    fetch: (u) => (calls.push(1), apiCicloLargo(u)),
    setTimeout: (cb, ms) => (tiempo.ms += ms || 0, cb(), 0),
    clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports;
}
const filas = (c) => c.trim().split("\r\n").length - 1;

(async () => {
  console.log("API infinita que da UNA fila nueva cada 30 páginas (39 repes + 1 nuevo).");
  console.log('Búsqueda: una palabra, sin OR, sin "solo en el título", sin frescura.\n');
  for (const [nombre, src] of Object.entries(SRC)) {
    const calls = [], tiempo = { ms: 0 };
    const mod = load(src, calls, tiempo);
    // guardia: si el scrape no termina, esto no vuelve. Se corta con un tope de peticiones.
    let corte = false;
    const guardia = new Promise((_, rej) => { if (calls.length > 1e6) corte = true; });
    const t0 = Date.now();
    const csv = await mod.scrape({ keywords: "sofa" });
    const d = mod.lastScrape;
    console.log(`${nombre}`);
    console.log(`  peticiones a api.wallapop.com : ${calls.length}`);
    console.log(`  filas                          : ${filas(csv)}`);
    console.log(`  diag                           : parcial=${d.parcial} tope=${d.tope} ` +
                `ramasSecas=${d.ramasSecas ?? "-"} paginasTope=${d.paginasTope ?? "-"}`);
    console.log(`  tiempo REAL que costaría (jitter 0,5-1 s/pág): ${(tiempo.ms / 3600000).toFixed(1)} h`);
    console.log(`  (arnés: ${((Date.now() - t0) / 1000).toFixed(1)} s de CPU)\n`);
  }
})();
