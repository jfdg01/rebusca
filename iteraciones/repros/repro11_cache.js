// repro11_cache.js — LA PREGUNTA (a), por la puerta nueva: el freno dispara sobre una búsqueda
// que NO pierde ni un anuncio, la marca `parcial`, y con eso le quita el cache. Es exactamente el
// daño que la iteración 11 vino a arreglar (el freno multiplica el martilleo a Wallapop en vez de
// cortarlo), reintroducido por `diag.ramasSecas > 0` -> `diag.parcial`.
//
// El escenario es el que la propia iteración 11 declara como el ACIERTO del arreglo:
// «la rama que solo repite lo que ya trajo otra se corta sola». Búsqueda «sofa OR sofá» con
// "solo en el título" marcado. Wallapop normaliza acentos, así que las dos ramas devuelven el
// MISMO catálogo: la 2ª rama es 100% duplicada. Catálogo finito de 40 páginas, API perfecta.
//
// Se conduce con el app.js de verdad: Buscar, y luego abrir la búsqueda guardada dos veces.
//
//   node repro11_cache.js
"use strict";
const vm = require("vm"), fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const { boot } = require("../../src/test_app.js");

const DIR = path.join(__dirname, "..", "..");
const SRC = {
  "426a036^ (sin freno)": execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" }),
  "426a036  (MAX_PAGINAS=200)": execFileSync("git", ["-C", DIR, "show", "426a036:src/scrape.js"], { encoding: "utf8" }),
  "HEAD     (MAX_PAGINAS_SECAS=30)": fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8"),
};

let POR_PAGINA = 40, PAGS = 40, CASAN = (pag) => 4;   // A: 1600 anuncios, 160 con "sofa" en el título
let KW = "sofa OR sofá";

// El cursor lleva rama|pag para paginar, pero los IDS dependen SOLO de la página: las dos ramas
// ven el mismo catálogo, que es lo que hace Wallapop con "sofa" y "sofá".
function donde(url) {
  const u = decodeURIComponent(url);
  const cur = u.match(/next_page=([^&]*)/);
  if (cur) { const [r, p] = cur[1].split("|"); return { rama: r, pag: +p }; }
  return { rama: u.match(/keywords=([^&]*)/)[1], pag: 0 };
}
const api = (url) => {
  const { rama, pag } = donde(String(url));
  const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
    id: `cat-${pag}-${k}`,                       // <- MISMO id para las dos ramas
    title: k < CASAN(pag) ? "sofa gris impecable" : "mueble de salon",
    price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
    created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
  }));
  return { ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ data: { section: { payload: { items } } },
      meta: { next_page: pag + 1 < PAGS ? `${rama}|${pag + 1}` : null } }) };
};

function scraper(src, calls) {
  const sb = {
    fetch: (u) => (calls.push(String(u)), api(u)),
    setTimeout: (cb) => (cb(), 0), clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} }, require: { main: null },
  };
  vm.runInNewContext(src, sb, { filename: "scrape.js" });
  return sb.module.exports;
}

async function escenario(titulo) {
  console.log(titulo);
  for (const [nombre, src] of Object.entries(SRC)) {
    const calls = [];
    const mod = scraper(src, calls);
    const holder = {};
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
    const d = mod.lastScrape;

    await ev(`loadQuery(${JSON.stringify(csv)})`);
    const tras2 = calls.length;
    await ev(`loadQuery(${JSON.stringify(csv)})`);
    const tras3 = calls.length;

    console.log(nombre);
    console.log(`  buscar        -> ${tras1} páginas, ${ev("data.length")} anuncios en pantalla`);
    console.log(`  diag             parcial=${d.parcial}  ramasSecas=${d.ramasSecas ?? "-"} ` +
                `ramasTope=${d.ramasTope} tope=${d.tope} paginasTope=${d.paginasTope ?? "-"}`);
    console.log(`  ¿se cachea?      ${cacheado}   badge "sin ver": ${badge === null ? "null (muerto)" : badge}`);
    console.log(`  abrir guardada-> +${tras2 - tras1} páginas · otra vez -> +${tras3 - tras2} páginas`);
    console.log(`  TOTAL a api.wallapop.com en tres aperturas: ${tras3} páginas\n`);
  }
}

(async () => {
  await escenario(
    'A · "sofa OR sofá" + "solo en el título". Wallapop normaliza acentos: las dos ramas ven el\n' +
    "    MISMO catálogo (40 pág x 40, 4/40 casan = 160 anuncios). La 2ª rama es 100% duplicada.\n" +
    "    Es el caso que el contrato de la iteración 11 vende como el ACIERTO del arreglo.\n");

  // B · una sola palabra, sin OR: el catálogo va por relevancia, así que los aciertos del título
  //     están al principio y la cola es morralla. Cortar ahí no pierde NI UN anuncio.
  KW = "sofa";
  PAGS = 200;
  CASAN = (pag) => (pag < 40 ? 4 : 0);
  await escenario(
    'B · "sofa" (UNA palabra, sin OR) + "solo en el título", catálogo de 200 páginas ordenado por\n' +
    "    relevancia: los aciertos están en las 40 primeras, la cola no casa. Cortar no pierde nada.\n");
})();
