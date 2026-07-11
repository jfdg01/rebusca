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

function makeContext(store) {
  const any = makeAny();
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
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
    location: { reload: noop, href: "", search: "", assign: noop },
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
async function boot(store) {
  const { sandbox, bootErrors } = makeContext(store);
  vm.createContext(sandbox);
  try {
    vm.runInContext(APP, sandbox, { filename: "app.js" });
  } catch (e) {
    bootErrors.push(e); // el bug viejo (bloque síncrono) tiraba aquí, en plena evaluación
  }
  await new Promise((r) => setImmediate(r)); // vacía los microtasks del queueMicrotask del boot
  return bootErrors;
}

async function main() {
  const fail = (m) => {
    throw new Error("FAIL: " + m);
  };

  // 1. arranque en blanco (usuario nuevo): sin crash
  let errs = await boot({});
  if (errs.length) fail("boot en blanco lanzó: " + (errs[0].message || errs[0]));

  // 2. arranque con estado guardado en la clave fija `wp_estado`: hydrateEstado()->render()
  //    en el boot. Es EXACTAMENTE el camino que crasheaba (TDZ de `col`). Debe ir limpio.
  errs = await boot({
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
  errs = await boot(store);
  if (errs.length) fail("boot con migración lanzó: " + (errs[0].message || errs[0]));
  if (store.wp_estado !== '{"trash":["x"],"fav":[],"star":[]}')
    fail("migración: wp_estado no adoptó el estado del perfil activo");
  if (store.wp_searches == null || store.wp_lastcsv !== "ps4.csv")
    fail("migración: no adoptó searches/lastcsv del perfil activo");
  if ("wp_perfil" in store || "wp_perfiles" in store)
    fail("migración: no retiró wp_perfil/wp_perfiles");

  // 4. el scraper del browser (scrape.js) sigue verde
  execFileSync("node", [path.join(__dirname, "scrape.js"), "demo"], { stdio: "pipe" });

  console.log("ok");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
