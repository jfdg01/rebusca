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

// Estado inicial real de cada id según el HTML (hidden/disabled/value): sin esto un
// `#swipeMenu` que nace oculto arrancaría visible en el test y taparía el bug de verdad.
const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// CSV de juguete con las columnas que produce scrape.js
// las columnas salen del scraper, no de una copia a mano: una columna nueva descolocaba las
// filas del juguete en silencio (cada celda pasaba a la de al lado)
const CSV_COLS = require("./scrape.js").FIELDS;
const CSV_FIELDS = CSV_COLS.join(",");
const csvRow = (o) => CSV_COLS.map((f) => (f in o ? String(o[f]) : "")).join(",");
const CSV = [CSV_FIELDS,
  csvRow({ id: "a1", titulo: "Ford Focus", precio: 1000, categoria: "Coches", ciudad: "Jaen", cp: "23001",
    km: 3, dias: 1, reservado: "False", envio: "False", url: "https://w/a1", vendedor: "Ana", descripcion: "buen estado" }),
  csvRow({ id: "a2", titulo: "Ford Fiesta", precio: 200, categoria: "Coches", ciudad: "Ubeda", cp: "23400",
    km: 25, dias: 2, reservado: "False", envio: "False", url: "https://w/a2", vendedor: "Bea", descripcion: "con arreglos" }),
].join("\r\n") + "\r\n";
// hijos de un contenedor del HTML: [{dataset}] por cada <tag ...> dentro de #id (sin anidar)
function htmlChildren(id, tag) {
  const i = HTML.indexOf('id="' + id + '"');
  if (i < 0) return [];
  const block = HTML.slice(i, HTML.indexOf("</div>", i));
  return [...block.matchAll(new RegExp("<" + tag + "\\b([^>]*)>", "g"))].map(([, attrs]) => {
    const dataset = {};
    for (const [, k, v] of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) dataset[k] = v;
    return dataset;
  });
}
const HTML_INIT = (() => {
  const html = HTML;
  const init = {};
  for (const [, attrs] of html.matchAll(/<[a-zA-Z][a-zA-Z0-9]*\s([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(attrs);
    if (!id) continue;
    const val = /\bvalue="([^"]*)"/.exec(attrs);
    init["#" + id[1]] = {
      hidden: /\bhidden(?=[\s/>]|$)/.test(attrs),
      disabled: /\bdisabled(?=[\s/>]|$)/.test(attrs),
      checked: /\bchecked(?=[\s/>]|$)/.test(attrs),
      value: val ? val[1] : "",
    };
  }
  return init;
})();

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

// ── elemento falso: guarda lo que le escriben y sabe recibir un click ──
// El `any` de arriba tragaba las escrituras (`set` -> true sin guardar), así que no se podía
// leer de vuelta ni el `onclick` ni el `hidden`. Este guarda todo en `st` y cae al `any` para
// lo que no conozca; los handlers (`on*`) arrancan en null para poder preguntar "¿está cableado?".
const ELS = new WeakSet(); // los elementos falsos, para distinguirlos del stub `any`
function makeEl(sel, any) {
  const st = {
    id: sel.replace(/^#/, ""),
    nodeType: 1,
    isConnected: true,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    checked: false,
    indeterminate: false,
    disabled: false,
    hidden: false,
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    onclick: null,
    onchange: null,
    oninput: null,
    onkeydown: null,
    onload: null,
    onerror: null,
    dataset: {},
    style: {},
    children: [],
  };
  // classList sobre `className`: una sola fuente de verdad. Antes `contains` devolvía siempre
  // false, así que "¿tiene la clase X?" (a11y de los .link, chips activos) no se podía probar.
  const cls = () => st.className.split(/\s+/).filter(Boolean);
  st.classList = {
    add: (...c) => (st.className = [...new Set([...cls(), ...c])].join(" ")),
    remove: (...c) => (st.className = cls().filter((x) => !c.includes(x)).join(" ")),
    toggle(c, f) {
      (f ?? !this.contains(c)) ? this.add(c) : this.remove(c);
    },
    contains: (c) => cls().includes(c),
  };
  Object.assign(st, HTML_INIT[sel]); // hidden/disabled/checked/value tal y como nacen en el HTML
  const listeners = {};
  const kids = new Map(); // hijos por selector (memoizados, ver querySelector)
  let el;
  const mkEvent = (type, extra) =>
    Object.assign(
      { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} },
      extra,
    );
  const api = {
    // dispara el handler como lo haría el navegador (on<tipo> + addEventListener).
    // Devuelve lo que devuelva el handler: los async (p.ej. #scrape) se pueden await-ear.
    dispatch(type, extra) {
      const ev = mkEvent(type, extra);
      const on = st["on" + type];
      const res = typeof on === "function" ? on(ev) : undefined;
      for (const fn of listeners[type] || []) fn(ev);
      return res;
    },
    click: (extra) => api.dispatch("click", extra),
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    removeEventListener: (t, fn) => {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
    // contiene = es él mismo o cuelga de él. Solo se recorren elementos falsos (ELS): el stub
    // universal `any` responde truthy a todo y daría un "sí" a cualquier nodo.
    contains: (n) => n === el || st.children.some((c) => ELS.has(c) && c.contains(n)),
    closest: () => null,
    remove() {},
    appendChild(c) {
      st.children.push(c);
      return c;
    },
    append(...cs) {
      st.children.push(...cs);
    },
    insertBefore: (c) => c,
    replaceChildren() {
      st.children = [];
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    // memoizado igual que el del document: `card.querySelector(".sc-del")` devuelve siempre
    // el mismo hijo, así el test puede pulsar el botón al que app.js le puso el onclick.
    querySelector(s) {
      if (!kids.has(s)) kids.set(s, makeEl(s, any));
      return kids.get(s);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    focus() {},
    blur() {},
    scrollIntoView() {},
    animate: () => ({ finished: Promise.resolve() }),
  };
  el = new Proxy(function () {}, {
    get(_t, p) {
      if (p === Symbol.toPrimitive || p === "toString" || p === "valueOf") return () => "";
      if (p === Symbol.iterator) return function* () {};
      if (p === "then") return undefined;
      if (p in api) return api[p];
      if (p in st) return st[p];
      return any;
    },
    set(_t, p, v) {
      if (p === "innerHTML") st.children = []; // repintar vacía el subárbol, como en el navegador
      st[p] = v;
      return true;
    },
    apply: () => any,
  });
  ELS.add(el);
  return el;
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
  // memoizado por selector: `$("#scrape")` devuelve SIEMPRE el mismo elemento, así el test
  // puede leer el onclick que le puso app.js y pulsarlo.
  const els = new Map();
  const q = (sel) => {
    if (!els.has(sel)) els.set(sel, makeEl(sel, any));
    return els.get(sel);
  };
  const docListeners = {};
  // "#listSort button" y similares: se sacan del HTML (con su data-*) y se memoizan, porque
  // app.js los recorre dos veces (una para pintar el activo, otra para cablear el onclick).
  const lists = new Map();
  const qa = (sel) => {
    const m = /^#([\w-]+)\s+([a-z]+)$/.exec(sel);
    if (!m) return [];
    if (!lists.has(sel))
      lists.set(
        sel,
        htmlChildren(m[1], m[2]).map((data, i) => {
          const e = makeEl(sel + ":" + i, any);
          Object.assign(e.dataset, data);
          return e;
        }),
      );
    return lists.get(sel);
  };
  const document = {
    querySelector: q,
    querySelectorAll: qa,
    getElementById: (id) => q("#" + id),
    createElement: () => makeEl("", any),
    createDocumentFragment: () => makeEl("", any), // elemento normal: así los <tr> que se le
    // cuelgan siguen siendo alcanzables desde tbody y el test puede pulsar sus botones
    createTextNode: () => makeAny(),
    addEventListener: (t, fn) => (docListeners[t] ||= []).push(fn),
    removeEventListener: (t, fn) => {
      docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn);
    },
    body: q("body"),
    documentElement: q("html"),
    head: q("head"),
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
  const winListeners = {};
  const hist = []; // entradas de historial sintéticas que empuja la app (botón atrás del móvil)
  // dispara un evento de window/document como lo haría el navegador
  const fire = (bag) => (type, extra) => {
    const ev = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, extra);
    for (const fn of bag[type] || []) fn(ev);
  };
  const fireWin = fire(winListeners);
  // lo que el test observa "desde fuera": qué se copió al portapapeles, qué se abrió/imprimió
  const spy = { copied: [], opened: [], printed: 0, alerts: [], warns: [] };
  const sandbox = {
    document,
    localStorage,
    AbortController,
    performance: { now: () => 0 },
    // scrape.js no se carga aquí: el scraper del browser se falsea y devuelve el CSV que pida el test
    Rebusca: { scrape: opts.scrape || (async () => opts.csv || "") },
    print: () => spy.printed++,
    open: (u) => {
      spy.opened.push(u);
      return { focus() {} };
    },
    console: new Proxy(
      {
        error: (...a) => bootErrors.push(a),
        // los console.assert() de app.js son checks reales: si fallan, la suite se entera
        assert: (cond, ...a) => cond || bootErrors.push(["console.assert:", ...a]),
        warn: (...a) => spy.warns.push(a.join(" ")), // el aviso de un descarte, no un fallo
      },
      { get: (t, p) => (p in t ? t[p] : noop) }, // log/warn/debug/... -> noop
    ),
    // queueMicrotask envuelto: captura el crash del boot en vez de tumbar el proceso
    // El callback del boot es `async`: su rechazo NO pasa por el try, se va como
    // unhandledRejection y tumba el proceso de test sin decir qué clave lo rompió.
    queueMicrotask: (cb) =>
      Promise.resolve().then(() => {
        try {
          return Promise.resolve(cb()).catch((e) => bootErrors.push(e));
        } catch (e) {
          bootErrors.push(e);
        }
      }),
    // por defecto NO ejecuta callbacks diferidos (evita bucles/timers en el test); con
    // `opts.timers` sí corren (unref: no mantienen vivo el proceso) para poder probar lo
    // que la app hace tras la animación (p.ej. la carta siguiente del mazo tras un swipe).
    setTimeout: (cb, ms) => {
      if (!opts.timers) return 0;
      const t = setTimeout(() => {
        try {
          cb();
        } catch (e) {
          bootErrors.push(e);
        }
      }, ms || 0);
      t.unref && t.unref();
      return t;
    },
    clearTimeout: (t) => t && clearTimeout(t),
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
    fetch: () => new Promise(() => {}), // no resuelve; en boot no se llama
    navigator: {
      userAgent: "test",
      clipboard: {
        writeText: (t) => {
          spy.copied.push(String(t));
          return Promise.resolve();
        },
      },
    },
    location: { reload: noop, href: "", search: opts.search || "", pathname: "/", assign: noop },
    // historial de verdad: `back()` dispara popstate como el navegador. Con un noop, el
    // botón atrás del móvil (la única "capa" sin botón propio en pantalla) no lo probaba nadie.
    history: {
      pushState: (s) => hist.push(s),
      replaceState: (s) => (hist.length ? (hist[hist.length - 1] = s) : hist.push(s)),
      back: () => {
        hist.pop();
        fireWin("popstate", { state: hist[hist.length - 1] ?? null });
      },
      forward: noop,
      go: noop,
      get length() {
        return hist.length + 1;
      },
      get state() {
        return hist[hist.length - 1] ?? null;
      },
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => makeAny(),
    alert: (m) => spy.alerts.push(String(m)),
    confirm: () => (opts.confirm === undefined ? true : opts.confirm),
    prompt: () => (opts.prompt === undefined ? null : opts.prompt),
    IntersectionObserver: Obs,
    ResizeObserver: Obs,
    MutationObserver: Obs,
    addEventListener: (t, fn) => (winListeners[t] ||= []).push(fn),
    removeEventListener: (t, fn) => {
      winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn);
    },
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
  return { sandbox, bootErrors, q, spy, docListeners, winListeners, hist, fireWin, fireDoc: fire(docListeners) };
}

// Evalúa app.js con `store` como localStorage inicial; devuelve los errores de boot.
async function boot(store, opts) {
  const ctx = makeContext(store, opts);
  const { sandbox, bootErrors } = ctx;
  vm.createContext(sandbox);
  try {
    vm.runInContext(APP, sandbox, { filename: "app.js" });
  } catch (e) {
    bootErrors.push(e); // el bug viejo (bloque síncrono) tiraba aquí, en plena evaluación
  }
  await new Promise((r) => setImmediate(r)); // vacía los microtasks del queueMicrotask del boot
  return Object.assign({}, ctx, { errs: bootErrors, store });
}
const bootErrs = async (store, opts) => (await boot(store, opts)).errs;

async function main() {
  const fail = (m) => {
    throw new Error("FAIL: " + m);
  };

  // 1. arranque en blanco (usuario nuevo): sin crash
  let errs = await bootErrs({});
  if (errs.length) fail("boot en blanco lanzó: " + (errs[0].message || errs[0]));

  // 1b. arranque Y USO con UNA clave envenenada, clave a clave y veneno a veneno.
  //     Dos venenos, no uno: texto que no es JSON (escritura cortada por la cuota) y JSON
  //     válido con la forma equivocada (versión vieja, otra pestaña, edición a mano).
  //     app.js es un módulo único: un throw en la evaluación deja la app inerte PARA SIEMPRE
  //     y el usuario no tiene botón con el que recuperarse. Ninguna clave puede hacer eso.
  //     Arrancar no basta: hay claves (wp_lastseen) que solo se leen al usar la app.
  const CLAVES = ["wp_estado", "wp_searches", "wp_lastseen", "wp_lastcsv", "wp_rejected",
                  "wp_favorite", "wp_interested", "wp_blocksel", "wp_stamp", "wp_excl",
                  "wp_lim", "wp_catexcl", "wp_catmode", "wp_alias", "wp_rows", "wp_aisent",
                  "wp_loc", "wp_lejoskm", "wp_autoexcllejos", "wp_csv",
                  "wp_perfil", "wp_perfiles"];
  const VENENOS = ["{json roto", "null", "5", '"texto"', "[]", '{"ford.csv":5}', "[1,2]"];
  const USO = 'loadCSV(__CSV, "ford.csv"); renderQlist(""); openManager(); paintSearches(); render()';
  for (const k of CLAVES) {
    for (const v of VENENOS) {
      const b = await boot({ [k]: v });
      if (b.errs.length) fail(`boot con ${k}=${v} lanzó: ` + (b.errs[0].message || b.errs[0]));
      b.sandbox.__CSV = CSV;
      try {
        vm.runInContext(USO, b.sandbox);
      } catch (e) {
        fail(`con ${k}=${v} la app arranca pero se rompe al usarla: ` + (e.message || e));
      }
      if (b.errs.length) fail(`con ${k}=${v} usar la app lanzó: ` + (b.errs[0].message || b.errs[0]));
    }
  }

  // 1c. el blob `wp_estado` bien formado pero con UN campo de la forma equivocada. La clave
  //     entera envenenada ya se prueba arriba; esto es el escalón de dentro: una versión vieja
  //     del blob (o un merge de dos pestañas) trae `blockSel` como objeto o `trash` como número
  //     y hydrateEstado corre en el boot, fuera de todo try: el rechazo se pierde y el arranque
  //     muere en silencio a mitad, sin render() ni restoreLastCsv().
  const CAMPOS = ["trash", "fav", "star", "blockSel", "excl", "catExcl", "catMode", "alias", "stamp"];
  for (const campo of CAMPOS) {
    for (const forma of [5, "texto", [], {}, null, [1, 2], { "ford.csv": 5 }]) {
      const b = await boot({ wp_estado: JSON.stringify({ [campo]: forma }), wp_lastcsv: "ford.csv" });
      if (b.errs.length)
        fail(`wp_estado con ${campo}=${JSON.stringify(forma)} tumbó el boot: ` + (b.errs[0].message || b.errs[0]));
      b.sandbox.__CSV = CSV;
      try {
        vm.runInContext(USO, b.sandbox);
      } catch (e) {
        fail(`wp_estado con ${campo}=${JSON.stringify(forma)} rompe la app al usarla: ` + (e.message || e));
      }
    }
  }

  // 1d. un descarte NO puede ser mudo. La app se protege tirando lo que tiene la forma
  //     equivocada, y eso está bien; lo que no vale es que el dato desaparezca sin dejar
  //     nada. Sin rastro, "me faltan búsquedas" no se puede diagnosticar, y el original se
  //     pierde de verdad en la siguiente escritura de esa clave.
  //     Contrato: aviso por consola + copia intacta en "roto:<clave>" + el original se queda.
  {
    const CASOS = [
      ["wp_excl", "5", "un objeto donde va un objeto"],
      ["wp_excl", "{", "un JSON que ni parsea"],
      // el blob entero: era el único descarte mudo que quedaba (un try/catch vacío en hydrateEstado)
      ["wp_estado", "{", "un JSON que ni parsea"],
      ["wp_estado", "5", "un escalar donde va el blob"],
      ["wp_blocksel", '{"a":1}', "un objeto donde va una lista"],
      ["wp_rejected", '{"ford.csv":5}', "un cajón que no es lista de ids"],
      ["wp_searches", '[{"csv":"ford.csv","rows":2,"mtime":1},{"rows":9}]', "una entrada sin csv"],
    ];
    for (const [clave, crudo, que] of CASOS) {
      const b = await boot({ [clave]: crudo, wp_lastcsv: "ford.csv" });
      if (b.errs.length) fail(`${clave} con ${que} tumbó el boot: ` + (b.errs[0].message || b.errs[0]));
      if (!b.store["roto:" + clave])
        fail(`${clave} con ${que}: se descartó sin copia en roto:${clave}`);
      if (b.store["roto:" + clave] !== crudo)
        fail(`roto:${clave} no guarda el original tal cual: ` + b.store["roto:" + clave]);
      // el original NO se comprueba a propósito: hydrateEstado reescribe varias de estas
      // claves saneadas en el mismo boot. Por eso hace falta la copia y no basta con dejarlo.
      if (!b.spy.warns.some((w) => w.includes(clave)))
        fail(`${clave} con ${que}: ni un aviso por consola. Avisos: ` + JSON.stringify(b.spy.warns));
    }
    // la búsqueda sana del lote envenenado sobrevive: se tira la entrada, no la lista
    const b = await boot({ wp_searches: '[{"csv":"ford.csv","rows":2,"mtime":1},{"rows":9}]' });
    if (vm.runInContext("loadSearches().length", b.sandbox) !== 1)
      fail("una entrada sin csv se llevó por delante la búsqueda sana");
    // y un arranque limpio no aparta nada ni avisa de nada
    const limpio = await boot({ wp_excl: '{"ford.csv":["roto"]}' });
    if (limpio.spy.warns.length) fail("aviso de descarte con un estado sano: " + JSON.stringify(limpio.spy.warns));
    if (Object.keys(limpio.store).some((k) => k.startsWith("roto:"))) fail("apartó una clave sana");
  }

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

  // 4b. …y un id del formato viejo SIN origen conocido se descarta, no se archiva bajo "".
  //     El cajón "" es real pero inalcanzable: allQueries se puebla solo desde wp_searches.
  const lg = { wp_estado: JSON.stringify({ favorite: ["idX"], rejected: [] }) }; // sin wp_rows
  errs = await bootErrs(lg);
  if (errs.length) fail("boot con id legacy sin origen lanzó: " + (errs[0].message || errs[0]));
  if ("" in JSON.parse(lg.wp_favorite || "{}")) fail("la migración legacy creó el cajón fantasma \"\"");

  // 4c. la clave espejo manda sobre el blob wp_estado, campo a campo. Los dos guardan lo
  //     mismo; si la escritura del blob falla por cuota (es el grande y va el último), el
  //     arranque revertía al estado viejo y encima machacaba la espejo con él.
  const div = {
    wp_rejected: JSON.stringify({ "ford.csv": ["a1"] }), // lo que el usuario acaba de rechazar
    wp_estado: JSON.stringify({ rejected: {}, favorite: {} }), // blob obsoleto
  };
  errs = await bootErrs(div);
  if (errs.length) fail("boot con espejo/blob divergentes lanzó: " + (errs[0].message || errs[0]));
  if (!(JSON.parse(div.wp_rejected)["ford.csv"] || []).includes("a1"))
    fail("hydrateEstado revirtió un rechazo desde el blob obsoleto, quedó " + div.wp_rejected);

  // 4d. …y al revés: la espejo NO tiene el id y el blob sí. Es una RETIRADA (deshacer, quitar
  //     un favorito). No debe resucitar. Este caso descarta fusionar por unión.
  const ret = {
    wp_rejected: JSON.stringify({ "ford.csv": [] }),
    wp_estado: JSON.stringify({ rejected: { "ford.csv": ["a1"] }, favorite: {} }),
  };
  errs = await bootErrs(ret);
  if (errs.length) fail("boot con retirada lanzó: " + (errs[0].message || errs[0]));
  if ((JSON.parse(ret.wp_rejected)["ford.csv"] || []).includes("a1"))
    fail("hydrateEstado resucitó un rechazo ya retirado, quedó " + ret.wp_rejected);

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

  // 9b. ?keep= SIN wp_rows: el id cae en el cajón del propio lote (wp_aisent.csv), no en "".
  //     Es el caso real de responder al enlace desde otro navegador o tras limpiar el cache.
  const kp2 = { wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2"] }) };
  errs = await bootErrs(kp2, { search: "?keep=a1" });
  if (errs.length) fail("?keep sin wp_rows lanzó: " + (errs[0].message || errs[0]));
  if (kp2.wp_favorite !== '{"ps4.csv":["a1"]}')
    fail("?keep sin wp_rows: el conservado no cayó en el cajón del lote, salió " + kp2.wp_favorite);

  // 9c. id irresoluble (sin ?q=, sin origen, sin última búsqueda): NO se archiva bajo "" y se avisa
  const hu = {};
  const bh = await boot(hu, { search: "?fav=zzz" });
  if (bh.errs.length) fail("?fav= huérfano lanzó: " + (bh.errs[0].message || bh.errs[0]));
  if ("" in JSON.parse(hu.wp_favorite || "{}")) fail("?fav= huérfano creó el cajón fantasma \"\"");
  if (!/sin búsqueda conocida/.test(String(bh.q("#snackmsg").textContent)))
    fail("?fav= huérfano no avisó, el snack dijo: " + bh.q("#snackmsg").textContent);

  // 9d. dos orígenes distintos: el enlace reparte y el mensaje lo dice
  const dos = {
    wp_rows: JSON.stringify({ a1: { id: "a1", _csv: "coches.csv" }, a2: { id: "a2", _csv: "motos.csv" } }),
  };
  const bd = await boot(dos, { search: "?fav=a1,a2" });
  if (bd.errs.length) fail("?fav= repartido lanzó: " + (bd.errs[0].message || bd.errs[0]));
  if (!/2 búsquedas/.test(String(bd.q("#snackmsg").textContent)))
    fail("?fav= repartido no dijo en cuántas búsquedas cayó, el snack dijo: " + bd.q("#snackmsg").textContent);

  // 10. deep-link con topes ?maxp/?maxd: son los topes del cajón (wp_lim), se aplican al render
  const tp = {};
  errs = await bootErrs(tp, { search: "?q=kindle&maxp=80&maxd=30" });
  if (errs.length) fail("deep-link ?maxp/?maxd lanzó: " + (errs[0].message || errs[0]));
  if (tp.wp_lim !== '{"kindle.csv":{"precio":80,"dias":30}}')
    fail("?maxp/?maxd: no quedaron como topes del cajón, salió " + tp.wp_lim);

  // 10b. ?excl= FUSIONA con lo que el usuario ya vetó a mano en ese cajón, no lo sustituye.
  //      Se siembra también wp_estado: hoy hydrateEstado() reasigna exclMap desde el blob, así
  //      que sembrar solo la clave espejo no sobrevive al arranque (eso es H10, otra tanda).
  const ex = {
    wp_excl: JSON.stringify({ "ford.csv": ["carcamal"] }),
    wp_estado: JSON.stringify({ excl: { "ford.csv": ["carcamal"] } }),
  };
  errs = await bootErrs(ex, { search: "?q=ford&excl=barato" });
  if (errs.length) fail("deep-link ?excl lanzó: " + (errs[0].message || errs[0]));
  const w = (JSON.parse(ex.wp_excl)["ford.csv"] || []).sort();
  if (w.join() !== "barato,carcamal") fail("?excl= borró las exclusiones manuales, quedó " + w);

  // 10c. ?since= solo acepta el vocabulario de SINCE_LABEL. "constructor" viene del prototipo,
  //      así que un `in` lo dejaba pasar y el cajón salía "ford--constructor.csv".
  const sc = {};
  errs = await bootErrs(sc, { search: "?q=ford&since=constructor&maxp=80" });
  if (errs.length) fail("deep-link ?since=constructor lanzó: " + (errs[0].message || errs[0]));
  if (sc.wp_lim !== '{"ford.csv":{"precio":80}}')
    fail("?since= coló una ventana temporal que no existe, el cajón salió " + sc.wp_lim);

  // 11. ajuste "excluir lejos sin envío": EXCLUYE del mazo, no rechaza. Bug real: enforceLejos()
  //     corría en cada render() y volvía a rechazar lo que acababas de restaurar -> "vaciar
  //     papelera" y "seleccionar todo > restaurar" no hacían nada visible.
  const lj = await boot({ wp_autoexcllejos: "1", wp_lejoskm: "10" });
  if (lj.errs.length) fail("boot con autoExclLejos lanzó: " + (lj.errs[0].message || lj.errs[0]));
  if (typeof lj.sandbox.enforceLejos === "function")
    fail("enforceLejos sigue vivo: re-rechaza en cada render lo que restauras");

  // 12b. CSV degenerado: vacío, y con una fila más corta que la cabecera. Un scrape abortado
  //      o un cache truncado producen las dos formas. parseCSV("") devuelve [], así que
  //      `headers` quedaba undefined y loadCSV lanzaba un TypeError que runScrape le enseñaba
  //      al usuario como fallo de red. Y la fila corta dejaba huecos `undefined`: la celda
  //      salía "undefined" y ordenar por esa columna tumbaba render() PARA SIEMPRE, porque
  //      toggleSort apunta la columna antes de que render lance.
  {
    const b = await boot({});
    const ev = (expr) => vm.runInContext(expr, b.sandbox);
    b.sandbox.__CSV = "";
    try {
      ev('loadCSV(__CSV, "vacio.csv"); render()');
    } catch (e) {
      fail("loadCSV con un CSV vacío lanzó: " + (e.message || e));
    }
    // el esquema por defecto ES el del scraper: contra un número fijo, añadir una columna al
    // scraper dejaba la cabecera de emergencia corta y nadie se enteraba
    if (ev("JSON.stringify(headers)") !== JSON.stringify(require("./scrape.js").FIELDS))
      fail("un CSV vacío dejó la cabecera en " + ev("JSON.stringify(headers)"));

    b.sandbox.__CSV = CSV_FIELDS + "\r\n" + "a1,Ford Focus,1000\r\n" + CSV.split("\r\n")[1] + "\r\n";
    try {
      ev('loadCSV(__CSV, "corta.csv"); render()');
    } catch (e) {
      fail("loadCSV con una fila corta lanzó: " + (e.message || e));
    }
    if (ev("data[0].length") !== ev("headers.length"))
      fail("la fila corta no se rellenó: " + ev("data[0].length") + " celdas de " + ev("headers.length"));
    if (ev("data[0].some((c) => typeof c !== 'string')"))
      fail("la fila corta dejó celdas que no son texto: " + ev("JSON.stringify(data[0])"));
    try {
      ev('toggleSort(headers.indexOf("descripcion")); render(); view = "rejected"; listSort = "descripcion"; sortList(data.slice()); view = ""');
    } catch (e) {
      fail("ordenar por una columna que la fila corta no trae lanzó: " + (e.message || e));
    }
  }

  // 12c. contrato scrape.js -> app.js: lo que escribe toCSV, parseCSV lo lee IGUAL.
  //      Cada fichero probaba su mitad (el demo de scrape.js comprueba el entrecomillado al
  //      escribir), pero nadie cerraba el círculo con comas, comillas y saltos dentro del campo.
  {
    const { toCSV, FIELDS } = require("./scrape.js");
    const raro = {
      id: "x1", titulo: 'Ford "Focus", 1.6', precio: 1000, categoria: "Coches, usados",
      ciudad: "Jaén", cp: "23001", km: 3, dias: 1, reservado: false, envio: true,
      top: true, garantia: false, reacond: false,
      url: "https://w/x1?a=1&b=2", vendedor: 'Ana "la del taller"', imagen: "", imagenes: "",
      descripcion: "primera línea\nsegunda, con coma\ny una \"cita\"",
    };
    const b = await boot({});
    b.sandbox.__CSV = toCSV([raro]);
    vm.runInContext('loadCSV(__CSV, "raro.csv")', b.sandbox);
    for (const f of FIELDS) {
      const got = vm.runInContext(`data[0][headers.indexOf(${JSON.stringify(f)})]`, b.sandbox);
      const want = String(raro[f] === true ? "True" : raro[f] === false ? "False" : raro[f]);
      if (got !== want) fail(`ida y vuelta del CSV: ${f} salió ${JSON.stringify(got)}, se escribió ${JSON.stringify(want)}`);
    }
    if (vm.runInContext("data.length", b.sandbox) !== 1)
      fail("el salto de línea dentro del campo partió la fila en " + vm.runInContext("data.length", b.sandbox));

    // wallapop.py es la referencia local del MISMO scraper: si los esquemas se separan, un CSV
    // hecho con el CLI ya no es el que la app espera. Nadie lo comprobaba.
    const py = fs.readFileSync(path.join(__dirname, "wallapop.py"), "utf8");
    const pyFields = ((py.match(/^FIELDS = \[([\s\S]*?)\]/m) || [])[1] || "").match(/"([a-z]+)"/g) || [];
    if (JSON.stringify(pyFields.map((s) => s.slice(1, -1))) !== JSON.stringify(FIELDS))
      fail("wallapop.py y scrape.js ya no comparten esquema: " + pyFields.join(","));
  }

  // 12d. dos pestañas abiertas: el evento `storage` de la OTRA pestaña re-hidrata esta.
  //      Sin el listener, esta pestaña se quedaba con su copia en memoria y el siguiente
  //      pushEstado() borraba lo que la otra acababa de clasificar.
  {
    const b = await boot({});
    b.sandbox.__CSV = CSV;
    vm.runInContext('loadCSV(__CSV, "ford.csv")', b.sandbox);
    b.store["wp_rejected"] = JSON.stringify({ "ford.csv": ["a1"] }); // la otra pestaña rechaza a1
    b.fireWin("storage", { key: "wp_rejected" });
    const rej = vm.runInContext('[...buckets.rejected["ford.csv"]]', b.sandbox);
    if (!rej.includes("a1")) fail("el evento storage no trajo el rechazo de la otra pestaña: " + JSON.stringify(rej));
    // una clave ajena (otra app en el mismo dominio) no dispara nada raro
    b.fireWin("storage", { key: "otracosa" });
    if (b.errs.length) fail("una clave ajena en el evento storage lanzó: " + (b.errs[0].message || b.errs[0]));
  }

  // 12e. primer arranque: el panel "Búsqueda activa" está vacío y no debe salir encima de la
  //      bienvenida. Vuelve en cuanto hay un CSV cargado (o una búsqueda guardada).
  {
    const b = await boot({});
    if (b.q(".picker").hidden !== true) fail("el panel de búsqueda activa sale en el primer arranque");
    b.sandbox.__CSV = CSV;
    vm.runInContext('loadCSV(__CSV, "ford.csv")', b.sandbox);
    if (b.q(".picker").hidden !== false) fail("el panel de búsqueda activa sigue oculto con un CSV cargado");
  }

  // 12f. señal de precio: el chip "−N %" sale en la tarjeta del anuncio muy por debajo de la
  //      mediana del lote, y CALLA con muestra corta (una búsqueda con OR mezcla productos y
  //      ahí la mediana engaña).
  {
    // recorre la tarjeta que pinta fillCard y devuelve "clase:texto" de cada hijo
    const carta = (b, i) =>
      vm.runInContext(
        `(() => { const el = document.createElement("div"); fillCard(el, data[${i}]); const out = [];
          (function walk(n) { for (const c of n.children || []) { out.push(c.className + ":" + c.textContent); walk(c); } })(el);
          return out.join("|"); })()`,
        b.sandbox,
      );
    const lote = (precios) =>
      [CSV_FIELDS, ...precios.map((p, i) => csvRow({ id: "a" + i, titulo: "Ford Focus", precio: p,
        categoria: "Coches", ciudad: "Jaen", cp: "23001", km: 3, dias: 1, reservado: "False",
        envio: "False", url: "https://w/a" + i, vendedor: "Ana", descripcion: "buen estado" }))]
        .join("\r\n") + "\r\n";

    const b = await boot({});
    // 9 precios: mediana 1000. El primero (500) está un 50 % por debajo; el segundo (900), un 10 %.
    b.sandbox.__CSV = lote([500, 900, 1000, 1000, 1000, 1000, 1000, 1100, 1200]);
    vm.runInContext('loadCSV(__CSV, "lote.csv")', b.sandbox);
    if (vm.runInContext("medianPrice", b.sandbox) !== 1000)
      fail("la mediana del lote no es 1000: " + vm.runInContext("medianPrice", b.sandbox));
    if (!/li-deal:−50 %/.test(carta(b, 0))) fail("el anuncio a mitad de precio no lleva chip: " + carta(b, 0));
    if (/li-deal/.test(carta(b, 1))) fail("un 10 % por debajo no es un chollo y llevó chip: " + carta(b, 1));

    // muestra corta: la misma diferencia, pero con 4 anuncios no hay referencia que valga
    b.sandbox.__CSV = lote([500, 1000, 1000, 1000]);
    vm.runInContext('loadCSV(__CSV, "corto.csv")', b.sandbox);
    if (vm.runInContext("medianPrice", b.sandbox) !== null) fail("con 4 precios la mediana debería ser null");
    if (/li-deal/.test(carta(b, 0))) fail("salió chip con una muestra de 4 anuncios: " + carta(b, 0));
  }

  // 12g. la tarjeta pinta lo que el CSV ya sabía: reservado (solo lo leía el texto para la IA),
  //      número de fotos (solo lo usaba el PDF) y las banderas garantía/reacondicionado/perfil top.
  {
    const carta = (b, i) =>
      vm.runInContext(
        `(() => { const el = document.createElement("div"); fillCard(el, data[${i}]); const out = [];
          (function walk(n) { for (const c of n.children || []) { out.push(c.className + ":" + c.textContent); walk(c); } })(el);
          return out.join("|"); })()`,
        b.sandbox,
      );
    const b = await boot({});
    b.sandbox.__CSV =
      [CSV_FIELDS,
        csvRow({ id: "b1", titulo: "Ford Focus", precio: 1000, categoria: "Coches", ciudad: "Jaen",
          km: 3, dias: 1, reservado: "True", top: "True", garantia: "True", reacond: "True",
          envio: "True", url: "https://w/b1", vendedor: "Ana",
          imagenes: "http://x/1.jpg http://x/2.jpg http://x/3.jpg", descripcion: "buen estado" }),
        csvRow({ id: "b2", titulo: "Ford Fiesta", precio: 900, categoria: "Coches", ciudad: "Jaen",
          km: 3, dias: 1, reservado: "False", top: "False", garantia: "False", reacond: "False",
          envio: "True", url: "https://w/b2", vendedor: "Bea", imagenes: "http://x/1.jpg",
          descripcion: "con arreglos" }),
      ].join("\r\n") + "\r\n";
    vm.runInContext('loadCSV(__CSV, "flags.csv")', b.sandbox);

    const c1 = carta(b, 0);
    if (!/li-res:Reservado/.test(c1)) fail("un anuncio reservado no lo dice en la tarjeta: " + c1);
    for (const t of ["3 fotos", "garantía", "reacondicionado", "perfil top"])
      if (!c1.includes(t)) fail(`la tarjeta no pinta "${t}": ` + c1);

    const c2 = carta(b, 1);
    if (/li-res/.test(c2)) fail("un anuncio libre salió como reservado: " + c2);
    if (!/li-extra: · 1 foto$|li-extra: · 1 foto\|/.test(c2 + "|"))
      fail("con una sola foto la tarjeta no dice «1 foto»: " + c2);
    for (const t of ["garantía", "reacondicionado", "perfil top"])
      if (c2.includes(t)) fail(`la tarjeta pinta "${t}" en un anuncio que no lo trae: ` + c2);
  }

  // 12h. la tabla solo existe en modo lista: en el mazo el swipe monta su propia tarjeta, así que
  //      construir un <tr> por fila era trabajo tirado justo al terminar la búsqueda.
  {
    const b = await boot({});
    b.sandbox.__CSV = CSV;
    vm.runInContext('loadCSV(__CSV, "ford.csv")', b.sandbox);
    const n = () => vm.runInContext("tbody.children.length", b.sandbox);
    if (vm.runInContext("filteredRows().length", b.sandbox) !== 2)
      fail("el mazo no tiene las 2 filas del CSV de juguete");
    if (n() !== 0) fail("el mazo construyó " + n() + " <tr> que nadie ve");
    vm.runInContext('favorite.add("a1"); view = "favorite"; render()', b.sandbox);
    if (n() !== 1) fail("la lista de favoritos no pintó su fila: " + n() + " <tr>");
    vm.runInContext('view = ""; render()', b.sandbox);
    if (n() !== 0) fail("al volver al mazo la tabla se quedó con " + n() + " <tr>");
  }

  // 12i. lo que cambia solo (el overlay de carga y el snack) tiene que anunciarse: sin una región
  //      viva, quien usa lector de pantalla no sabe que la búsqueda arrancó ni que hay "Deshacer".
  for (const id of ["loading", "snack"]) {
    const tag = (HTML.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>')) || [])[0] || "";
    if (!/role="status"/.test(tag) || !/aria-live="polite"/.test(tag))
      fail(`#${id} no es una región viva: ` + tag);
  }

  // 12j. el botón que destruye es rojo en REPOSO: en un móvil no hay ratón y un rojo que solo
  //      sale con :hover no lo ve nadie.
  {
    const css = fs.readFileSync(path.join(__dirname, "app.css"), "utf8");
    const reposo = (css.match(/\.btn\.quitar \{[^}]*\}/) || [])[0] || "";
    if (!/#b03024/.test(reposo)) fail("el botón Quitar no es rojo en reposo: " + reposo);
  }

  // 12k. manifest: sin él la app no se instala en la pantalla de inicio. Un icono con la ruta mal
  //      escrita no rompe nada visible, así que aquí se comprueba que cada fichero existe.
  {
    if (!/<link rel="manifest" href="manifest\.webmanifest"/.test(HTML)) fail("index.html no enlaza el manifest");
    if (!/<link rel="apple-touch-icon" href="apple-touch-icon\.png"/.test(HTML)) fail("index.html no da icono a iOS");
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.webmanifest"), "utf8"));
    if (man.display !== "standalone" || !man.start_url) fail("el manifest no declara una app instalable");
    for (const ic of man.icons)
      if (!fs.existsSync(path.join(__dirname, ic.src.replace(/^\//, "")))) fail("icono del manifest que no existe: " + ic.src);
  }

  // 12. el scraper del browser (scrape.js) sigue verde
  execFileSync("node", [path.join(__dirname, "scrape.js"), "demo"], { stdio: "pipe" });

  console.log("ok");
}

module.exports = { boot, makeContext }; // test_buttons.js reutiliza este arranque

if (require.main === module)
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
