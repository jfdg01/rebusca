// repro8_tope.js — ¿MAX_PAGINAS = 200 recorta un scrape SANO que hoy termina entero?
//
// Mide el mismo escenario contra dos scrape.js: el padre de la iteración 8 (426a036^, sin tope)
// y el de la iteración 8 (con tope). Nada de APIs rotas: catálogo finito, next_page que se
// acaba, cero errores HTTP. La única razón de que las páginas se multipliquen es la que el
// usuario elige a propósito: 32 ramas OR, y filas que no salen de todas las páginas.
//
//   node repro8_tope.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "..");
const SRC_NUEVO = fs.readFileSync(path.join(DIR, "src/scrape.js"), "utf8");
const SRC_VIEJO = execFileSync("git", ["-C", DIR, "show", "426a036^:src/scrape.js"], { encoding: "utf8" });

function load(SRC, fetchFake) {
  const calls = [];
  const esperas = [];
  const sandbox = {
    fetch: (url, init) => (calls.push(String(url)), fetchFake(String(url), init, calls.length - 1)),
    setTimeout: (cb, ms) => (esperas.push(ms), cb(), 0),
    clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error,
    console: { error() {}, warn() {}, log() {} },
    module: { exports: {} },
    require: { main: null },
  };
  vm.runInNewContext(SRC, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls, esperas };
}
const resp = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null },
  json: async () => body,
});
const pagina = (items, next) => ({ data: { section: { payload: { items } } }, meta: { next_page: next } });
const filas = (csv) => csv.trim().split("\r\n").slice(1);

// ── el catálogo de mentira: sano, finito, sin un solo error ──
const POR_PAGINA = 40;      // items por página que devuelve la API
const PAGS_RAMA_REF = { v: 8 };  // el catálogo de cada rama se acaba a las 8 páginas (320 anuncios)
const CASAN = { v: 4 };          // de cada 40 anuncios, cuántos llevan las palabras en el título

// "(sofa | sofá | tresillo | chaise) (barato | oferta | rebajado | nuevo) (gris | beige)" = 32 ramas
const KW = "(sofa | sofá | tresillo | chaise) (barato | oferta | rebajado | nuevo) (gris | beige)";

// devuelve {rama, pag} a partir de la URL (la 1ª página lleva keywords; las demás, el cursor)
function donde(url) {
  const u = decodeURIComponent(url);
  const cur = u.match(/next_page=([^&]*)/);
  if (cur) { const [r, p] = cur[1].split("|"); return { rama: r, pag: +p }; }
  return { rama: u.match(/keywords=([^&]*)/)[1], pag: 0 };
}

// A · el usuario marca "solo en el título": de 40 anuncios de la página, 4 llevan las tres
//     palabras de la rama en el título. La API está perfecta; el filtro es del usuario.
function apiTitleOnly(url) {
  const { rama, pag } = donde(url);
  const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
    id: `${rama}-${pag}-${k}`,
    title: k < CASAN.v ? rama + " impecable" : "Mueble de salón en buen estado",
    price: { amount: 100 }, location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
    created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
  }));
  return resp(200, pagina(items, pag + 1 < PAGS_RAMA_REF.v ? `${rama}|${pag + 1}` : null));
}

// B · sin ningún filtro del usuario: ramas sinónimas que devuelven casi el mismo catálogo.
//     36 de cada 40 anuncios de la página ya salieron en una rama anterior (dedup por `seen`).
function apiSolapada(url) {
  const { rama, pag } = donde(url);
  const items = Array.from({ length: POR_PAGINA }, (_, k) => ({
    id: k < 4 ? `${rama}-${pag}-${k}` : `comun-${pag}-${k}`,   // 36/40 compartidos entre ramas
    title: rama, price: { amount: 100 },
    location: { latitude: 37.78, longitude: -3.78, city: "Jaen" },
    created_at: Date.now(), taxonomy: [{ name: "Hogar" }], user_id: "v", images: [],
  }));
  return resp(200, pagina(items, pag + 1 < PAGS_RAMA_REF.v ? `${rama}|${pag + 1}` : null));
}

async function mide(nombre, SRC, api, opts) {
  const { api: mod, calls, esperas } = load(SRC, async (u) => api(u));
  const csv = await mod.scrape({ keywords: KW, ...opts });
  const d = mod.lastScrape;
  const seg = esperas.reduce((a, b) => a + b, 0) / 1000;
  console.log(`  ${nombre.padEnd(10)} páginas ${String(calls.length).padStart(3)}` +
    `  filas ${String(filas(csv).length).padStart(4)}  parcial ${String(!!d.parcial).padEnd(5)}` +
    `  paginasTope ${String(!!d.paginasTope).padEnd(5)}  ~${seg.toFixed(0)}s de espera`);
  return { calls: calls.length, filas: filas(csv).length, d };
}

(async () => {
  console.log(`A · 32 ramas OR + "solo en el título" (4 de cada 40 títulos casan). API SANA, catálogo finito.`);
  const a1 = await mide("426a036^", SRC_VIEJO, apiTitleOnly, { titleOnly: true });
  const a2 = await mide("426a036", SRC_NUEVO, apiTitleOnly, { titleOnly: true });

  console.log(`\nB · 32 ramas OR de sinónimos, SIN filtros: 36 de cada 40 anuncios ya se vieron.`);
  const b1 = await mide("426a036^", SRC_VIEJO, apiSolapada, {});
  const b2 = await mide("426a036", SRC_NUEVO, apiSolapada, {});

  // C · el umbral: con 32 ramas el tope reparte 6,2 páginas por rama. Sin ramas OR también corta.
  console.log(`\nC · variantes, todas con API sana y catálogo que se acaba solo:`);
  const variante = async (nombre, kw, pags, casan, opts) => {
    const antes = PAGS_RAMA_REF.v, antesC = CASAN.v;
    PAGS_RAMA_REF.v = pags; CASAN.v = casan;
    const { api: m1, calls: c1 } = load(SRC_VIEJO, async (u) => apiTitleOnly(u));
    const csv1 = await m1.scrape({ keywords: kw, ...opts });
    const { api: m2, calls: c2 } = load(SRC_NUEVO, async (u) => apiTitleOnly(u));
    const csv2 = await m2.scrape({ keywords: kw, ...opts });
    console.log(`  ${nombre}`);
    console.log(`     426a036^: ${c1.length} páginas, ${filas(csv1).length} filas, parcial ${!!m1.lastScrape.parcial}` +
      `  |  426a036: ${c2.length} páginas, ${filas(csv2).length} filas, parcial ${!!m2.lastScrape.parcial}`);
    PAGS_RAMA_REF.v = antes; CASAN.v = antesC;
  };
  await variante("16 ramas, 16 páginas de catálogo por rama (640 resultados), 4/40 casan",
    "(sofa | sofá | tresillo | chaise) (barato | oferta | rebajado | nuevo)", 16, 4, { titleOnly: true });
  await variante("1 sola palabra + solo-en-el-título, 250 páginas de catálogo, 4/40 casan",
    "sofa", 250, 4, { titleOnly: true });
  await variante("32 ramas, 7 páginas por rama, 12/40 casan (título poco exigente)",
    KW, 7, 12, { titleOnly: true });

  console.log("\nLo que pierde el usuario:");
  for (const [n, v, w] of [["A", a1, a2], ["B", b1, b2]]) {
    console.log(`  ${n}: ${v.filas} anuncios, parcial=${!!v.d.parcial}` +
      ` -> ${w.filas} anuncios, parcial=${!!w.d.parcial} (app.js NO lo cachea: cada apertura re-scrapea 200 páginas)`);
    console.log(`     ramas buscadas: ${Math.ceil(v.calls / 8)} de 32  ->  ${Math.ceil(w.calls / 8)} de 32`);
  }
})();
