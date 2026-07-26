// test_app.js — smoke test de app.js SIN navegador ni dependencias (solo stdlib: vm).
// Evalúa app.js bajo un DOM/localStorage falsos y dispara el boot, comprobando que NO
// crashea. Pilla la clase de bug que rompió esta versión: el módulo abortaba a mitad de
// la evaluación (TDZ de `const col`) al arrancar con un perfil guardado, dejando funciones
// sin inicializar -> al pulsar Buscar saltaba "can't access lexical declaration 'col'".
//
//   node src/test_app.js        # corre el suite (también invoca `node scrape.js demo`)
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

// ── stub universal de DOM: `any` responde a cualquier acceso/llamada sin romper ──
// (función encadenable, iterable vacío, coerciona a ""). Suficiente para evaluar el
// módulo y correr render() con dataset vacío; no simula layout ni eventos reales.
function makeAny() {
  const any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === Symbol.toPrimitive || p === "toString" || p === "valueOf")
        return () => "";
      if (p === Symbol.iterator)
        return function* () {}; // spread/for-of -> vacío
      if (p === "then") return undefined; // no thenable
      if (p === "length") return 0;
      if (p === "nodeType") return 1;
      return any;
    },
    apply() {
      return any;
    },
    set() {
      return true;
    },
  });
  return any;
}

function makeContext(store, opts = {}) {
  const any = makeAny();
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    // `opts.limit` = presupuesto en bytes: reproduce el QuotaExceededError real del navegador
    setItem: (k, v) => {
      v = String(v);
      if (opts.limit) {
        let n = v.length;
        for (const o in store) if (o !== k) n += store[o].length;
        if (n > opts.limit) {
          const e = new Error("Setting the value of '" + k + "' exceeded the quota.");
          e.name = "QuotaExceededError";
          throw e;
        }
      }
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  const document = {
    querySelector: () => any,
    querySelectorAll: () => [],
    getElementById: () => any,
    createElement: () => makeAny(),
    createDocumentFragment: () => makeAny(),
    createTextNode: () => makeAny(),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: any,
    documentElement: any,
    head: any,
    activeElement: any,
    hidden: false,
    visibilityState: "visible",
    execCommand: () => {},
  };
  const noop = () => {};
  const Obs = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  const bootErrors = [];
  const sandbox = {
    document,
    localStorage,
    console: new Proxy(
      { error: (...a) => bootErrors.push(a) },
      { get: (t, p) => (p in t ? t[p] : noop) }, // assert/log/warn/debug/... -> noop
    ),
    // queueMicrotask envuelto: captura el crash del boot en vez de tumbar el proceso
    queueMicrotask: (cb) =>
      Promise.resolve().then(() => {
        try {
          cb();
        } catch (e) {
          bootErrors.push(e);
        }
      }),
    setTimeout: (cb) => {
      // no ejecuta callbacks diferidos (evita bucles/timers en el test); devuelve id
      return 0;
    },
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
    fetch: () => new Promise(() => {}), // no resuelve; en boot no se llama
    navigator: { userAgent: "test", clipboard: { writeText: () => Promise.resolve() } },
    location: { reload: noop, href: "", search: opts.search || "", pathname: "/", assign: noop },
    history: { pushState: noop, replaceState: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => makeAny(),
    alert: noop,
    confirm: () => true,
    prompt: () => null,
    IntersectionObserver: Obs,
    ResizeObserver: Obs,
    MutationObserver: Obs,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    scrollTo: noop,
    scroll: noop,
    innerWidth: 320,
    innerHeight: 632,
    devicePixelRatio: 2,
    URL,
    URLSearchParams,
    Event: class {},
    CustomEvent: class {},
    Blob: class {},
    Math,
    Date,
    JSON,
    isNaN,
    parseFloat,
    parseInt,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, bootErrors };
}

// Evalúa app.js con `store` como localStorage inicial; devuelve los errores de boot.
async function boot(store, opts) {
  const { sandbox, bootErrors } = makeContext(store, opts);
  vm.createContext(sandbox);
  try {
    vm.runInContext(APP, sandbox, { filename: "app.js" });
  } catch (e) {
    bootErrors.push(e); // el bug viejo (bloque síncrono) tiraba aquí, en plena evaluación
  }
  await new Promise((r) => setImmediate(r)); // vacía los microtasks del queueMicrotask del boot
  return { errs: bootErrors, sandbox };
}
const bootErrs = async (store, opts) => (await boot(store, opts)).errs;

async function main() {
  const fail = (m) => {
    throw new Error("FAIL: " + m);
  };

  // 1. arranque en blanco (usuario nuevo): sin crash
  let errs = await bootErrs({});
  if (errs.length) fail("boot en blanco lanzó: " + (errs[0].message || errs[0]));

  // 2. arranque con estado guardado en la clave fija `wp_estado`: hydrateEstado()->render()
  //    en el boot. Es EXACTAMENTE el camino que crasheaba (TDZ de `col`). Debe ir limpio.
  errs = await bootErrs({
    wp_estado: JSON.stringify({
      trash: ["a", "b"],
      fav: ["c"],
      star: ["d"],
      blockSel: ["v1"],
      excl: { "ford.csv": ["rojo"] },
      catExcl: {},
      catMode: {},
      alias: { "ford.csv": "coches" },
      stamp: { a: 1 },
    }),
    wp_lastcsv: "ford.csv",
    wp_searches: JSON.stringify([{ csv: "ford.csv", rows: 3, mtime: 1 }]),
  });
  if (errs.length)
    fail("boot con estado lanzó (regresión del bug 'col'): " + (errs[0].message || errs[0]));

  // 3. migración one-shot perfiles->local: adopta el estado del perfil activo a las claves
  //    fijas y retira wp_perfil/wp_perfiles. Sin esto, un usuario del modelo viejo pierde datos.
  const store = {
    wp_perfil: "Javi",
    wp_perfiles: JSON.stringify([{ name: "Javi", color: "#22aa77" }]),
    wp_estado_Javi: JSON.stringify({ trash: ["x"], fav: [], star: [] }),
    wp_searches_Javi: JSON.stringify([{ csv: "ps4.csv", rows: 1, mtime: 1 }]),
    wp_lastcsv_Javi: "ps4.csv",
  };
  errs = await bootErrs(store);
  if (errs.length) fail("boot con migración lanzó: " + (errs[0].message || errs[0]));
  if (store.wp_estado !== '{"trash":["x"],"fav":[],"star":[]}')
    fail("migración: wp_estado no adoptó el estado del perfil activo");
  if (store.wp_searches == null || store.wp_lastcsv !== "ps4.csv")
    fail("migración: no adoptó searches/lastcsv del perfil activo");
  if ("wp_perfil" in store || "wp_perfiles" in store)
    fail("migración: no retiró wp_perfil/wp_perfiles");

  // 4. migración cubos GLOBALES (Array) -> POR CAJÓN {csv:[ids]}: cada id va al cajón de su
  //    origen (wp_rows._csv). Sin esto, favoritos/interesantes viejos caerían todos en un cajón.
  const gs = {
    wp_rows: JSON.stringify({
      c: { id: "c", _csv: "ford.csv" },
      d: { id: "d", _csv: "ps4.csv" },
    }),
    wp_estado: JSON.stringify({ favorite: ["c", "d"], rejected: [], interested: [] }), // formato global viejo
  };
  errs = await bootErrs(gs);
  if (errs.length) fail("boot con cubos globales viejos lanzó: " + (errs[0].message || errs[0]));
  if (gs.wp_favorite !== '{"ford.csv":["c"],"ps4.csv":["d"]}')
    fail("migración por cajón: wp_favorite no se repartió por origen, salió " + gs.wp_favorite);

  // 5. CUOTA LLENA: escribir en localStorage NUNCA debe lanzar. Bug real (Brave, movil): el
  //    setItem de wp_rows petaba por quota y la excepcion abortaba fling()/reject() JUSTO despues
  //    de mover la carta con el dedo y ANTES de animarla/avanzar -> la carta se quedaba congelada
  //    y no se clasificaba nada ("los botones no funcionan"). setLS() desaloja el cache de CSVs
  //    (desechable) y reintenta; si aun asi no cabe, devuelve false en vez de tirar.
  const lleno = {
    wp_estado: JSON.stringify({ rejected: {}, interested: { "ford.csv": ["k1"] }, favorite: {} }),
    wp_lastcsv: "ford.csv",
  };
  const b = await boot(lleno, { limit: 6000 });
  if (b.errs.length) fail("boot con presupuesto lanzo: " + (b.errs[0].message || b.errs[0]));
  if (typeof b.sandbox.setLS !== "function") fail("setLS no quedo definido");
  lleno.relleno = "x".repeat(5800); // almacen a tope, como en el movil real
  let tiro = null;
  try {
    b.sandbox.reject("k1", "Cosa"); // clasificar con el almacen a tope
  } catch (e) {
    tiro = e;
  }
  if (tiro) fail("reject() lanzo con la cuota llena (el bug de la carta congelada): " + (tiro.message || tiro));

  // 6. CAJON POR KEYWORD: "ps4--dia" y "ps4--semana" son la misma caza. Antes el `since` iba en la
  //    clave, asi que cambiar la ventana temporal abria un cajon virgen y resucitaba los rechazados.
  const cajones = {
    wp_estado: JSON.stringify({
      rejected: { "ps4--dia.csv": ["a"], "ps4--semana.csv": ["b"], "tv.csv": ["c"] },
      interested: {}, favorite: {},
      excl: { "ps4--dia.csv": ["roto"], "ps4--semana.csv": ["piezas"] },
    }),
  };
  errs = await bootErrs(cajones);
  if (errs.length) fail("boot con cajones por ventana lanzo: " + (errs[0].message || errs[0]));
  if (cajones.wp_rejected !== '{"ps4.csv":["a","b"],"tv.csv":["c"]}')
    fail("cajon por keyword: no se fundieron los rechazados, salio " + cajones.wp_rejected);
  if (cajones.wp_excl !== '{"ps4.csv":["roto","piezas"]}')
    fail("cajon por keyword: no se fundieron las exclusiones, salio " + cajones.wp_excl);

  // 7. ?fav=<ids> SIN ?q=: el deep-link que devuelve la IA. curCsv aun es null al arrancar (fromURL
  //    corre antes que restoreLastCsv), asi que los favoritos caian en el cajon "" -> invisibles.
  const deep = {
    wp_estado: JSON.stringify({ rejected: {}, interested: {}, favorite: {} }),
    wp_lastcsv: "ford--semana.csv",
  };
  errs = await bootErrs(deep, { search: "?fav=999,1000" });
  if (errs.length) fail("boot con ?fav= lanzo: " + (errs[0].message || errs[0]));
  if (deep.wp_favorite !== '{"ford.csv":["999","1000"]}')
    fail("?fav= sin ?q=: los favoritos no cayeron en el cajon de la ultima busqueda, salio " + deep.wp_favorite);

  // 8. migración: el cubo "interesantes" desaparece; sus ids ascienden a favoritos
  const mi = {
    wp_rows: JSON.stringify({ i1: { id: "i1", _csv: "ford.csv" } }),
    wp_estado: JSON.stringify({ rejected: {}, favorite: {}, interested: { "ford.csv": ["i1"] } }),
  };
  errs = await bootErrs(mi);
  if (errs.length) fail("boot con interesantes viejos lanzó: " + (errs[0].message || errs[0]));
  if (mi.wp_favorite !== '{"ford.csv":["i1"]}')
    fail("migración interesantes: no ascendieron a favoritos, salió " + mi.wp_favorite);

  // 9. deep-link ?keep=<ids> (veredicto de la IA): los conservados van a favoritos y el
  //    RESTO del lote enviado (wp_aisent) se rechaza; el lote queda consumido.
  const kp = {
    wp_rows: JSON.stringify({
      a1: { id: "a1", _csv: "ps4.csv" },
      a2: { id: "a2", _csv: "ps4.csv" },
      a3: { id: "a3", _csv: "ps4.csv" },
    }),
    wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2", "a3"] }),
  };
  errs = await bootErrs(kp, { search: "?keep=a1" });
  if (errs.length) fail("deep-link ?keep lanzó: " + (errs[0].message || errs[0]));
  if (kp.wp_favorite !== '{"ps4.csv":["a1"]}')
    fail("?keep: el conservado no acabó en favoritos, salió " + kp.wp_favorite);
  if (kp.wp_rejected !== '{"ps4.csv":["a2","a3"]}')
    fail("?keep: el resto del lote no se rechazó, salió " + kp.wp_rejected);
  if ("wp_aisent" in kp) fail("?keep: no consumió wp_aisent");

  // 10. deep-link con topes ?maxp/?maxd: son los topes del cajón (wp_lim), se aplican al render
  const tp = {};
  errs = await bootErrs(tp, { search: "?q=kindle&maxp=80&maxd=30" });
  if (errs.length) fail("deep-link ?maxp/?maxd lanzó: " + (errs[0].message || errs[0]));
  if (tp.wp_lim !== '{"kindle.csv":{"precio":80,"dias":30}}')
    fail("?maxp/?maxd: no quedaron como topes del cajón, salió " + tp.wp_lim);

  // 11. ajuste "excluir lejos sin envío": EXCLUYE del mazo, no rechaza. Bug real: enforceLejos()
  //     corría en cada render() y volvía a rechazar lo que acababas de restaurar -> "vaciar
  //     papelera" y "seleccionar todo > restaurar" no hacían nada visible.
  const lj = await boot({ wp_autoexcllejos: "1", wp_lejoskm: "10" });
  if (lj.errs.length) fail("boot con autoExclLejos lanzó: " + (lj.errs[0].message || lj.errs[0]));
  if (typeof lj.sandbox.enforceLejos === "function")
    fail("enforceLejos sigue vivo: re-rechaza en cada render lo que restauras");

  // 12. el scraper del browser (scrape.js) sigue verde
  execFileSync("node", [path.join(__dirname, "scrape.js"), "demo"], { stdio: "pipe" });

  console.log("ok");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
