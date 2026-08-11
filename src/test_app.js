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
const CSS = fs.readFileSync(path.join(__dirname, "app.css"), "utf8");

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
// recorre la tarjeta que pinta fillCard y devuelve "clase:texto" de cada hijo, anidados incluidos
const carta = (b, i) =>
  vm.runInContext(
    `(() => { const el = document.createElement("div"); fillCard(el, data[${i}]); const out = [];
      (function walk(n) { for (const c of n.children || []) { out.push(c.className + ":" + c.textContent); walk(c); } })(el);
      return out.join("|"); })()`,
    b.sandbox,
  );
// Todos los id que existen de verdad: los del HTML estático, más los que app.js se pinta a
// sí misma por innerHTML (la barra de estado, las cabeceras de orden). El arnés fabrica un
// elemento por selector, así que sin esta lista `$("#boton-que-ya-no-existe")` devuelve un
// objeto que funciona, los siete checks salen verdes y el botón está muerto en el navegador.
const IDS = new Set(
  [...HTML.matchAll(/\bid="([\w-]+)"/g), ...APP.matchAll(/\bid="([\w-]+)"/g)].map(([, id]) => id),
);
// El mismo agujero que el de IDS, por la puerta de las etiquetas: `querySelector("header")` no
// lleva `#`, así que la lista de arriba no lo mira. `enterOverlay` apunta a `header` y `main` para
// sacar el fondo del tab; si el HTML deja de tenerlas, el arnés se las inventa y la a11y de los
// overlays sale verde con el fondo navegable en el navegador.
// `html`/`head`/`body` van sembradas: HTML5 deja escribirlas implícitas, y index.html no las lleva.
const TAGS = new Set(["html", "head", "body",
  ...[...HTML.matchAll(/<([a-zA-Z][\w-]*)[\s/>]/g)].map(([, t]) => t.toLowerCase())]);
const HTML_INIT = (() => {
  const html = HTML;
  const init = {};
  for (const [, tag, attrs] of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\s([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(attrs);
    if (!id) continue;
    const val = /\bvalue="([^"]*)"/.exec(attrs);
    init["#" + id[1]] = {
      tagName: tag.toUpperCase(), // como el DOM real. Lo usa `closest` para casar "a,button,input"
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
// quién cuelga de quién. Sin esto `remove()` era un no-op: la foto que no carga se quitaba en
// el navegador y en la suite seguía ahí, así que borrar el `onerror` de app.js no rompía nada.
const PARENT = new WeakMap();
// ¿casa este elemento con el selector? Solo la gramática que usa app.js: lista con comas, y de
// cada trozo el tag, las clases y un `[data-*]` presente. Nada de descendencia ni de :not().
// ponytail: un motor CSS entero sobra; si algún día aparece un selector que no encaja, `sel`
// no casa con la expresión regular y `querySelectorAll` devuelve [] como antes.
const camelize = (n) => n.replace(/-(\w)/g, (_, x) => x.toUpperCase());
const matches = (el, sel) =>
  String(sel).split(",").some((s) => {
    const m = /^([a-z]*)((?:\.[\w-]+)*)(?:\[data-([\w-]+)\])?$/.exec(s.trim());
    if (!m || !s.trim()) return false;
    if (m[1] && String(el.tagName || "").toLowerCase() !== m[1]) return false;
    for (const c of m[2].split(".").filter(Boolean)) if (!el.classList.contains(c)) return false;
    const camel = camelize(m[3] || "");
    return !camel || camel in (el.dataset || {});
  });
// `append("texto")` es legal en el DOM y una cadena no vale como clave de un WeakMap
const link = (c, padre) => { if (Object(c) === c) PARENT.set(c, padre); };
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
    open: false, // <details> cerrado. Sin esto el stub universal responde truthy y "está plegado" nunca falla
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
    // `closest` solo se mira a sí mismo. En el único uso de app.js (la guarda anti-arrastre del
    // mazo) el target ES el elemento a excluir, así que no hace falta subir el árbol. Antes
    // devolvía siempre null: la guarda era inalcanzable y borrarla dejaba los siete en verde.
    closest: (q) =>
      String(q)
        .split(",")
        .some((s) => {
          s = s.trim();
          return s.startsWith(".") ? cls().includes(s.slice(1)) : st.tagName === s.toUpperCase();
        })
        ? el
        : null,
    remove() {
      const p = PARENT.get(el);
      if (p) p.children = p.children.filter((c) => c !== el);
      PARENT.delete(el);
    },
    appendChild(c) {
      st.children.push(c);
      link(c, st);
      return c;
    },
    append(...cs) {
      st.children.push(...cs);
      for (const c of cs) link(c, st);
    },
    insertBefore: (c) => c,
    replaceChildren() {
      st.children = [];
    },
    // los dos únicos atributos que app.js escribe y borra son `data-dir` y `role`. En el DOM real
    // `removeAttribute("data-dir")` borra `dataset.dir`; el no-op de antes dejaba la flecha vieja
    // pegada, así que "no limpia la flecha" era indistinguible de "la limpia".
    setAttribute(n, v) {
      if (String(n).startsWith("data-")) st.dataset[camelize(String(n).slice(5))] = String(v);
      else st[n] = String(v);
    },
    removeAttribute(n) {
      if (String(n).startsWith("data-")) delete st.dataset[camelize(String(n).slice(5))];
      else delete st[n];
    },
    getAttribute: () => null,
    hasAttribute: () => false,
    // memoizado igual que el del document: `card.querySelector(".sc-del")` devuelve siempre
    // el mismo hijo, así el test puede pulsar el botón al que app.js le puso el onclick.
    querySelector(s) {
      if (!kids.has(s)) kids.set(s, makeEl(s, any));
      return kids.get(s);
    },
    // recorre el subárbol de verdad. Antes devolvía [] siempre, así que las cabeceras de orden,
    // la limpieza del mazo y la espera de las fotos del PDF eran código inalcanzable para la suite.
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) {
        for (const c of n.children || []) {
          if (ELS.has(c) && matches(c, sel)) out.push(c);
          walk(c);
        }
      })(el);
      return out;
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    // deja rastro: `focus()` es lo único que el arnés sabe del foco, y la a11y de los overlays
    // (el fondo `inert` + el foco dentro) se cae entera si nadie lo mira. Con el noop de antes
    // el test tampoco podía espiarlo: el `get` del Proxy mira `api` antes que el estado, así que
    // un `el.focus = miEspía` desde fuera se escribía y no se leía nunca.
    focus() {
      st.focused = true;
    },
    blur() {
      st.focused = false;
    },
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

// IndexedDB de mentira. Sin esto el arnés no definía `indexedDB`, así que el `idb` de app.js
// caía siempre al Map de memoria con el que `idb` sale del paso, y ningún check tocaba el wrapper de
// verdad: ni las transacciones, ni `almacenRoto`, ni el commit. Y el commit es justo donde la
// cuota de IndexedDB revienta una escritura que la petición ya había dado por buena.
// `opts.idbFalla`: "commit" = la petición dice que sí y la transacción aborta después (la cuota
// real); "peticion" = falla ya la petición; "anular" = aborta como lo hace `abort()`, que según la
// spec deja `transaction.error` a null. Se lee en cada operación, así que un test puede romper el
// almacén a mitad mutando el `opts` con el que arrancó.
// `opts.idbFallaClave`: limita el fallo a las claves que empiezan por ese texto. Un fallo PARCIAL
// —una escritura del bucle aborta y la de después entra— es lo que distingue mirar cada booleano
// de mirar solo el último.
function makeIndexedDB(opts, mem) {
  const luego = (fn) => Promise.resolve().then(fn);
  const fallo = (n) => Object.assign(new Error("almacén de mentira: " + n), { name: n });
  const db = {
    createObjectStore: () => {},
    transaction: (_n, mode) => {
      const t = { error: null };
      let mia = !opts.idbFallaClave; // ¿esta transacción toca una clave de las que fallan?
      // Las escrituras esperan al commit. Una transacción de IndexedDB es atómica: la que aborta
      // no deja nada escrito. Es la premisa con la que el importador se ahorra reponer las filas.
      const pend = [];
      const op = (fn) => {
        const q = { result: undefined, error: null };
        luego(() => {
          if (opts.idbFalla === "peticion" && mia) {
            q.error = fallo("QuotaExceededError");
            q.onerror && q.onerror(q);
          } else {
            q.result = fn();
            q.onsuccess && q.onsuccess(q);
          }
          // el commit va un microtask DESPUÉS de la petición: así es como una escritura que ya
          // dijo que sí se pierde igual.
          luego(() => {
            if (opts.idbFalla && mia && mode === "readwrite") {
              if (opts.idbFalla !== "anular") t.error = fallo("AbortError");
              t.onabort && t.onabort(t);
            } else {
              for (const f of pend) f();
              t.oncomplete && t.oncomplete(t);
            }
          });
        });
        return q;
      };
      const marca = (k) => (mia = mia || String(k).startsWith(opts.idbFallaClave || "\u0000"));
      t.objectStore = () => ({
        get: (k) => (marca(k), op(() => (mem.has(k) ? mem.get(k) : undefined))),
        put: (v, k) => (marca(k), op(() => void pend.push(() => mem.set(k, v)))),
        delete: (k) => (marca(k), op(() => void pend.push(() => mem.delete(k)))),
      });
      return t;
    },
  };
  return {
    open: () => {
      const r = { result: db, error: null };
      luego(() => r.onsuccess && r.onsuccess(r));
      return r;
    },
  };
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
    // length/key: la API real de Storage. La copia de seguridad recorre el almacén con ella,
    // porque una lista de claves escrita a mano se queda coja en cuanto se añade una.
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] ?? null,
  };
  // memoizado por selector: `$("#scrape")` devuelve SIEMPRE el mismo elemento, así el test
  // puede leer el onclick que le puso app.js y pulsarlo.
  const els = new Map();
  const q = (sel) => {
    const id = /^#([\w-]+)$/.exec(sel);
    if (id && !IDS.has(id[1]))
      throw new Error(`el arnés se inventó ${sel}: ese id no está ni en index.html ni en app.js`);
    const tag = /^[a-zA-Z][\w-]*$/.test(sel) && sel.toLowerCase();
    if (tag && !TAGS.has(tag))
      throw new Error(`el arnés se inventó <${tag}>: esa etiqueta no está en index.html`);
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
    if (!lists.has(sel)) {
      // el mismo agujero que el de `q`, por la otra puerta: si el contenedor se renombra,
      // `htmlChildren` devuelve [] sin quejarse, el bucle de app.js no hace nada y el check
      // que lo mira no distingue "no hay botones" de "los botones ya no se llaman así".
      if (!htmlChildren(m[1], m[2]).length)
        throw new Error(`el arnés se inventó "${sel}": #${m[1]} no tiene ningún <${m[2]}> en index.html`);
      lists.set(
        sel,
        htmlChildren(m[1], m[2]).map((data, i) => {
          const e = makeEl(sel + ":" + i, any);
          Object.assign(e.dataset, data);
          return e;
        }),
      );
    }
    return lists.get(sel);
  };
  const document = {
    querySelector: q,
    querySelectorAll: qa,
    getElementById: (id) => q("#" + id),
    // con su etiqueta: `querySelectorAll("th[data-col]")` y `closest("a,button,input")`
    // necesitan saber qué es cada nodo, y antes todo lo creado nacía sin tagName
    createElement: (tag) => {
      const e = makeEl("", any);
      e.tagName = String(tag).toUpperCase();
      return e;
    },
    createDocumentFragment: () => makeEl("", any), // elemento normal: así los <tr> que se le
    // cuelgan siguen siendo alcanzables desde tbody y el test puede pulsar sus botones
    // un objeto llano, no `makeAny()`: el proxy se tragaba el texto y la distancia y la ciudad de
    // la tarjeta quedaban invisibles para la suite. Los dos únicos usos de app.js lo `append`an y
    // no lo vuelven a tocar, así que con estas cuatro propiedades basta.
    createTextNode: (t) => ({ nodeType: 3, className: "", textContent: String(t), children: [] }),
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
  const spy = { copied: [], opened: [], printed: 0, alerts: [], warns: [], blobs: [], reloads: 0 };
  const sandbox = {
    document,
    localStorage,
    // `opts.idbMem`: un Map propio del test, para arrancar DOS veces sobre el mismo almacén y ver
    // qué se lleva una sesión a la siguiente (una restauración marca trabajo para el arranque).
    indexedDB: makeIndexedDB(opts, opts.idbMem || new Map()),
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
    // origin: un navegador siempre lo tiene, y el enlace de una búsqueda se construye con él
    location: { reload: () => spy.reloads++, href: "", origin: "https://rebusca.dibogomez.com",
      search: opts.search || "", pathname: "/", assign: noop },
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
    // createObjectURL/revokeObjectURL no están en el URL de node: los pone el navegador, y son
    // lo que baja la copia de seguridad. El spy guarda el Blob para poder leer lo que se bajó.
    URL: { createObjectURL: (b) => (spy.blobs.push(b), "blob:copia"), revokeObjectURL: noop },
    URLSearchParams,
    Event: class {},
    CustomEvent: class {},
    Blob: class { constructor(partes) { this.partes = partes; } },
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

  // 0. el arnés se queja de un selector inventado. Va el primero a propósito: los otros 400
  //    checks se apoyan en que `q("#x")` devuelve el elemento de verdad, y el arnés fabrica
  //    uno por selector. Sin este check, quitar los dos guardias deja los siete en verde y la
  //    suite vuelve a creerse cualquier errata (así vivió `#snackundo` en test_buttons.js).
  const b0 = await boot({});
  for (const [pide, que] of [
    [() => b0.q("#no-existe-en-ninguna-parte"), "un id inventado"],
    [() => vm.runInContext('document.querySelectorAll("#no-existe-tampoco button")', b0.sandbox),
      "un contenedor inventado"],
  ]) {
    let saltó = false;
    try {
      pide();
    } catch {
      saltó = true;
    }
    if (!saltó) fail(`el arnés se tragó ${que} sin quejarse`);
  }

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

  // 3b. …y si la copia NO cabe, el puntero se queda. La migración duplica el estado, así que es
  //     justo el gesto que llena la cuota. Con wp_perfil ya borrado no se reintenta nunca más: la
  //     app sale vacía con los datos intactos en localStorage e inalcanzables para siempre.
  //     El `ok = setLS(b, v) && ok` que lo impide no lo medía nadie; con `||` los siete seguían
  //     verdes. Aquí wp_estado_Javi no cabe duplicado y los tres pequeños sí: fallo parcial.
  {
    const parcial = {
      wp_perfil: "Javi",
      wp_perfiles: JSON.stringify([{ name: "Javi", color: "#22aa77" }]),
      wp_estado_Javi: JSON.stringify({ trash: ["x".repeat(900)], fav: [], star: [] }),
      wp_lastcsv_Javi: "ps4.csv",
    };
    const b = await boot(parcial, { limit: 1500 });
    if (b.store.wp_estado !== undefined)
      fail("el escenario no reprodujo el fallo: la copia gorda si cupo");
    if (b.store.wp_perfil !== "Javi")
      fail("se borró wp_perfil con la migración a medias: el estado queda inalcanzable para siempre");
    if (b.store.wp_lastcsv !== "ps4.csv")
      fail("la copia pequeña tenía que caber: el escenario no es un fallo PARCIAL");
  }

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

  // 5-bis. La barra de orden es el UNICO setItem que se escapo de setLS, y entro anoche. Con la
  //     cuota llena la excepcion mata el handler ANTES del render(): el usuario toca "precio" y la
  //     lista ni se ordena ni repinta el boton, sin el aviso de almacen lleno y con el "Fallo
  //     interno" generico. Es la misma carta congelada del bloque 5, en otro boton.
  //     Presupuesto propio: el del bloque 5 esta calibrado para que reject() quepa justo, y con
  //     ese margen la clave de orden (8 bytes) entraba sin rozar el tope.
  {
    const tope = { wp_estado: JSON.stringify({ rejected: {}, favorite: {} }), wp_lastcsv: "ford.csv" };
    const b2 = await boot(tope, { limit: 6000 });
    tope.relleno = "x".repeat(5990); // no cabe ni una clave mas, por corta que sea
    if (typeof b2.sandbox.applyListSort !== "function") fail("applyListSort no quedo en el sandbox");
    try {
      b2.sandbox.applyListSort("precio");
    } catch (e) {
      fail("applyListSort lanzo con la cuota llena: la lista no se ordena ni repinta: " + (e.message || e));
    }
  }

  // 5b. CUOTA LLENA + DATO DAÑADO: el caso en que `aparta` no puede respaldar. La copia a
  //     "roto:<clave>" es la UNICA copia, y hydrateEstado reescribe esa misma clave saneada unas
  //     lineas despues. Si `setLS` dijera que guardo sin guardar, el usuario se queda sin copia
  //     Y sin original: el dato desaparece del todo, con un aviso diciendo que esta a salvo.
  //     Por eso `setLS` devuelve un booleano y `sinRespaldo` frena a `espejo`.
  //     Presupuesto a medida: cabe todo lo que ya hay, no cabe duplicar el dañado.
  {
    const danado = "[" + "1,".repeat(900) + "1]"; // JSON valido, forma equivocada (va un objeto)
    const est = {
      wp_excl: danado,
      wp_estado: JSON.stringify({ rejected: {}, favorite: {} }),
      wp_lastcsv: "ford.csv",
    };
    const b = await boot(est, { limit: 2400 });
    if (b.store["roto:wp_excl"] !== undefined)
      fail("el escenario no reprodujo el fallo de respaldo: la copia si cupo");
    if (b.store.wp_excl !== danado)
      fail("el original dañado se machaco sin haberlo podido respaldar; quedo " + b.store.wp_excl);
    if (!b.errs.some((e) => String(e).includes("roto:wp_excl")))
      fail("el respaldo fallido no dejo aviso por consola: " + JSON.stringify(b.errs.map(String)));
  }

  // 5c. …y el blob GORDO tiene que estar igual de protegido. 5b mide `wp_excl`, que es una de las
  //     claves espejo pequeñas, y esas iban por `espejo()`. `wp_estado` no: `pushEstado()` y
  //     `saveBuckets()` escribían por `setLS()` directo, o sea que la marca de `sinRespaldo` los
  //     frenaba a todos MENOS a los dos que de verdad importan. Un solo swipe con el blob dañado
  //     y sin copia destruia el unico original que quedaba.
  {
    const danado = "[" + "1,".repeat(900) + "1]"; // JSON valido, forma equivocada (va un objeto)
    const est = { wp_estado: danado, wp_lastcsv: "ford.csv" };
    const b = await boot(est, { limit: 2400 });
    if (b.store["roto:wp_estado"] !== undefined)
      fail("el escenario no reprodujo el fallo de respaldo: la copia si cupo");
    b.sandbox.reject("k1", "Cosa"); // un gesto cualquiera: dispara saveBuckets -> pushEstado
    if (b.store.wp_estado !== danado)
      fail("un swipe machaco el estado dañado que no se pudo respaldar; quedo " + b.store.wp_estado);
  }

  // 5d. …y lo mismo por el otro escritor. `saveBuckets()` escribe los cajones uno por uno, y
  //     tambien iba por `setLS()`: con `wp_rejected` dañado y sin copia, el primer swipe se
  //     llevaba por delante el unico original. Dos escritores, dos redes.
  //     Un array NO sirve de dato dañado aqui: los cubos se leen con fb=null a proposito, porque
  //     una lista es el formato global viejo y `toMap` lo migra. El escalar si lo es.
  {
    const danado = JSON.stringify("x".repeat(1800));
    const est = { wp_rejected: danado, wp_lastcsv: "ford.csv" };
    const b = await boot(est, { limit: 2400 });
    if (b.store["roto:wp_rejected"] !== undefined)
      fail("el escenario no reprodujo el fallo de respaldo: la copia si cupo");
    b.sandbox.reject("k1", "Cosa");
    if (b.store.wp_rejected !== danado)
      fail("saveBuckets machaco el cajon dañado que no se pudo respaldar; quedo " + b.store.wp_rejected);
  }

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

  // 9a. un anuncio del lote que YA salió en una búsqueda vieja: su veredicto va al cajón del LOTE,
  //     no al `_csv` de aquella (que es la primera búsqueda que lo vio y nunca se reescribe). Con
  //     el `_csv` viejo el favorito se archivaba en el otro cajón y en el que acabas de cribar
  //     salía como "sin ver": pasó de verdad, 2 de 3 conservados desaparecieron de la vista.
  const vj = {
    wp_rows: JSON.stringify({
      a1: { id: "a1", _csv: "vieja.csv" }, // repetido: lo vio antes otra búsqueda
      a2: { id: "a2", _csv: "ps4.csv" },
    }),
    wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2"] }),
  };
  errs = await bootErrs(vj, { search: "?keep=a1" });
  if (errs.length) fail("?keep con origen viejo lanzó: " + (errs[0].message || errs[0]));
  if (vj.wp_favorite !== '{"ps4.csv":["a1"]}')
    fail("?keep: el conservado no cayó en el cajón del lote, salió " + vj.wp_favorite);

  // 9b. ?keep= SIN wp_rows: el id cae en el cajón del propio lote (wp_aisent.csv), no en "".
  //     Es el caso real de responder al enlace desde otro navegador o tras limpiar el cache.
  const kp2 = { wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2"] }) };
  errs = await bootErrs(kp2, { search: "?keep=a1" });
  if (errs.length) fail("?keep sin wp_rows lanzó: " + (errs[0].message || errs[0]));
  if (kp2.wp_favorite !== '{"ps4.csv":["a1"]}')
    fail("?keep sin wp_rows: el conservado no cayó en el cajón del lote, salió " + kp2.wp_favorite);

  // 9bis. el ?keep= con cache ABRE los favoritos ya pintados. Antes solo sincronizaba el combobox
  //     (selectQueryUI no carga filas), así que el enlace de la IA aterrizaba en la bienvenida y
  //     había que volver atrás y re-seleccionar la búsqueda a mano para ver el veredicto.
  const kc = { wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2", "a3"] }) };
  const bk = await boot(kc, {
    search: "?keep=a1",
    idbMem: new Map([
      ["csvIndex", { "ps4.csv": { ts: 1, ids: ["a1", "a2", "a3"] } }],
      ["csv:ps4.csv", "id,titulo,precio\na1,Una,10\na2,Otra,20\na3,Tres,30"],
    ]),
  });
  if (bk.errs.length) fail("?keep con cache lanzó: " + (bk.errs[0].message || bk.errs[0]));
  if (bk.q("table").hidden) fail("?keep con cache: la lista de favoritos salió oculta (la bienvenida otra vez)");
  if (bk.q("#listTitle").textContent !== "Favoritos")
    fail("?keep con cache: no abrió en favoritos, el título dice " + bk.q("#listTitle").textContent);

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

  // 9e. los ids del enlace llegan con "#" (así se pegan en el filtro de las listas, y así los
  //     devuelve la IA). Sin recortarla, ningún id casa: el veredicto no aplica nada y, peor,
  //     ?keep manda el lote ENTERO a la papelera porque ningún conservado se reconoce.
  const al = {
    wp_rows: JSON.stringify({ a1: { id: "a1", _csv: "ps4.csv" }, a2: { id: "a2", _csv: "ps4.csv" } }),
    wp_aisent: JSON.stringify({ csv: "ps4.csv", ids: ["a1", "a2"] }),
  };
  errs = await bootErrs(al, { search: "?keep=%23a1" });
  if (errs.length) fail("?keep con almohadilla lanzó: " + (errs[0].message || errs[0]));
  if (al.wp_favorite !== '{"ps4.csv":["a1"]}')
    fail("?keep=#a1: no se quitó la almohadilla del id, favoritos salió " + al.wp_favorite);
  if (al.wp_rejected !== '{"ps4.csv":["a2"]}')
    fail("?keep=#a1: el lote entero acabó en la papelera, salió " + al.wp_rejected);

  // 9f. los cubos son exclusivos: un id que llega en ?no= y estaba en favoritos SALE de favoritos.
  const nf = {
    wp_rows: JSON.stringify({ a1: { id: "a1", _csv: "ps4.csv" } }),
    wp_favorite: JSON.stringify({ "ps4.csv": ["a1"] }),
    wp_estado: JSON.stringify({ favorite: { "ps4.csv": ["a1"] } }),
  };
  errs = await bootErrs(nf, { search: "?no=a1" });
  if (errs.length) fail("?no= sobre un favorito lanzó: " + (errs[0].message || errs[0]));
  if ((JSON.parse(nf.wp_favorite)["ps4.csv"] || []).includes("a1"))
    fail("?no=: el rechazado sigue en favoritos, está en los dos cubos: " + nf.wp_favorite);
  if (!(JSON.parse(nf.wp_rejected || "{}")["ps4.csv"] || []).includes("a1"))
    fail("?no=: el id no llegó a la papelera, salió " + nf.wp_rejected);

  // 10. deep-link con topes ?maxp/?maxd: son los topes del cajón (wp_lim), se aplican al render
  const tp = {};
  errs = await bootErrs(tp, { search: "?q=kindle&maxp=80&maxd=30" });
  if (errs.length) fail("deep-link ?maxp/?maxd lanzó: " + (errs[0].message || errs[0]));
  if (tp.wp_lim !== '{"kindle.csv":{"precio":80,"dias":30}}')
    fail("?maxp/?maxd: no quedaron como topes del cajón, salió " + tp.wp_lim);

  // 10d. un tope no numérico se AVISA. `NaN > 0` es false, así que ?maxp=barato se descartaba en
  //      silencio: el usuario veía precios por encima de su tope creyendo que el enlace lo aplicaba.
  const tm = {};
  const bt = await boot(tm, { search: "?q=kindle&maxp=barato&maxd=30", timers: true });
  if (bt.errs.length) fail("?maxp no numérico lanzó: " + (bt.errs[0].message || bt.errs[0]));
  await new Promise((r) => setTimeout(r, 5)); // el aviso sale en un setTimeout(..., 0)
  if (!/maxp=barato/.test(String(bt.q("#snackmsg").textContent)))
    fail("?maxp=barato se ignoró sin avisar, el snack dijo: " + bt.q("#snackmsg").textContent);
  if (tm.wp_lim !== '{"kindle.csv":{"dias":30}}')
    fail("?maxp=barato: el tope bueno no sobrevivió al malo, salió " + tm.wp_lim);

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
  //     Se mide la CONDUCTA, no el nombre: a2 está a 25 km y sin envío, con el umbral en 10.
  //     Un check de `typeof enforceLejos === "function"` pasaría con la función renombrada.
  {
    const lj = await boot({ wp_autoexcllejos: "1", wp_lejoskm: "10" }, { csv: CSV, timers: true });
    if (lj.errs.length) fail("boot con autoExclLejos lanzó: " + (lj.errs[0].message || lj.errs[0]));
    const ev = (expr) => vm.runInContext(expr, lj.sandbox);
    lj.sandbox.__CSV = CSV;
    ev('loadCSV(__CSV, "ford.csv"); render(); render()'); // dos veces: el bug pegaba en el 2º render
    const enPapelera = ev("JSON.stringify([...rejected])");
    if (enPapelera !== "[]")
      fail("el ajuste rechazó los lejos en vez de excluirlos del mazo: " + enPapelera);
    const vistos = ev('JSON.stringify(filteredRows().map((r) => col(r, "id")))');
    if (vistos !== '["a1"]')
      fail("los lejos sin envío no salen del mazo con el ajuste puesto, quedaron " + vistos);
  }

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

  // 12g-bis. el resto de la tarjeta compuesta, parte por parte. `fillCard()` monta nueve piezas y
  //          la suite solo miraba cuatro. La cara: con envío la etiqueta enseña el precio FINAL
  //          estimado, no el del anuncio — comparar precios comparables es para lo que existe la
  //          app —, y un precio vacío pone una raya, porque `dec1("")` devuelve "0" y un anuncio
  //          sin precio no vale 0 €.
  {
    const b = await boot({});
    b.sandbox.__CSV =
      [CSV_FIELDS,
        csvRow({ id: "c1", titulo: "Ford Focus", precio: 100, categoria: "Coches", ciudad: "Jaen",
          dias: 1, reservado: "False", envio: "True", url: "https://w/c1", vendedor: "Ana",
          imagen: "http://x/1.jpg", descripcion: "buen estado" }),
        csvRow({ id: "c2", titulo: "Ford Fiesta", categoria: "Coches", ciudad: "Ubeda", km: 25,
          dias: 40, reservado: "False", envio: "False", url: "https://w/c2", vendedor: "Bea",
          descripcion: "sin precio" }),
      ].join("\r\n") + "\r\n";
    vm.runInContext('view = ""; loadCSV(__CSV, "carta.csv")', b.sandbox);

    const final = vm.runInContext("eur(finalPrice(100))", b.sandbox);
    const c1 = carta(b, 0);
    if (!c1.includes("li-price:" + final))
      fail(`con envío la etiqueta no enseña el precio final ${final}: ` + c1);
    if (!/li-age:[^|]/.test(c1)) fail("la tarjeta no lleva el chip de frescura: " + c1);
    // el texto suelto de la línea de envío es un nodo de texto, por eso sale como "|:, (Jaen)"
    if (!/ship:Con envío\|:, \(Jaen\)/.test(c1))
      fail("con envío y sin km la línea no es «Con envío, (Jaen)»: " + c1);
    if (/li-id/.test(c1)) fail("el chip del id salió en el mazo, donde no hay veredicto que cotejar: " + c1);

    const c2 = carta(b, 1);
    if (!c2.includes("li-price:—")) fail("un anuncio sin precio no pone la raya: " + c2);
    if (!/ship no:Sin envío/.test(c2)) fail("un anuncio sin envío no lo dice en naranja: " + c2);
    if (!/ship no:Sin envío\|:, a 25 km \(Ubeda\)/.test(c2))
      fail("sin envío la línea no es «Sin envío, a 25 km (Ubeda)»: " + c2);

    // la foto que no carga se quita y queda el fondo neutro, no el icono roto del navegador
    const rota = vm.runInContext(
      `(() => { const el = document.createElement("div"); fillCard(el, data[0]);
        const media = el.children[0], antes = media.children.length;
        media.children[0].onerror();
        return antes + "->" + media.children.length; })()`,
      b.sandbox,
    );
    if (rota !== "3->2") fail("la foto que no carga no se quita de la tarjeta: " + rota);

    // en las listas sale el chip del id, y un toque lo copia
    vm.runInContext('view = "favorite"', b.sandbox);
    if (!carta(b, 0).includes("li-id:#c1")) fail("en la lista la tarjeta no lleva el chip del id: " + carta(b, 0));
    vm.runInContext(
      `(() => { const el = document.createElement("div"); fillCard(el, data[0]); let chip = null;
        (function walk(n) { for (const c of n.children || []) { if (c.className === "li-id") chip = c; walk(c); } })(el);
        chip.onclick(); })()`,
      b.sandbox,
    );
    if (b.spy.copied.join() !== "c1")
      fail("el chip del id no copió el id: " + JSON.stringify(b.spy.copied));

    // cuándo se clasificó: la línea nombra el cubo en el que está, y sin marca de tiempo no sale
    vm.runInContext("stamp[key(data[0])] = Date.now() - 3600e3", b.sandbox);
    if (!/li-when interested:Favorito /.test(carta(b, 0)))
      fail("en Destacados la línea no dice «Favorito»: " + carta(b, 0));
    vm.runInContext('view = "rejected"', b.sandbox);
    if (!/li-when:Rechazado /.test(carta(b, 0)))
      fail("en la Papelera la línea no dice «Rechazado»: " + carta(b, 0));
    vm.runInContext("delete stamp[key(data[0])]", b.sandbox);
    if (/li-when/.test(carta(b, 0)))
      fail("sin marca de tiempo salió la línea de cuándo se clasificó: " + carta(b, 0));
  }

  // 12g-ter. las cabeceras de la tabla dicen por qué columna se ordena, en qué sentido y con qué
  //          prioridad. `paintSortHeaders()` era código inalcanzable: el arnés devolvía [] a
  //          `thead.querySelectorAll("th[data-col]")`, así que borrar la función entera no rompía
  //          nada. El orden multinivel es lo que más se nota: sin el número, dos flechas a la vez
  //          no dicen cuál manda.
  {
    const b = await boot({});
    b.sandbox.__CSV = CSV;
    vm.runInContext('loadCSV(__CSV, "orden.csv")', b.sandbox);
    const cabeceras = () =>
      vm.runInContext(
        `thead.querySelectorAll("th[data-col]")
           .filter((t) => t.classList.contains("sorted"))
           .map((t) => headers[+t.dataset.col] + ":" + (t.dataset.dir || "")).join("|")`,
        b.sandbox,
      );
    const iCol = (h) => vm.runInContext(`headers.indexOf("${h}")`, b.sandbox);

    if (cabeceras() !== "") fail("sin ordenar ya había cabeceras marcadas: " + cabeceras());
    vm.runInContext(`toggleSort(${iCol("precio")})`, b.sandbox);
    if (cabeceras() !== "precio:▲") fail("ordenar por precio no marca su cabecera: " + cabeceras());
    vm.runInContext(`toggleSort(${iCol("precio")})`, b.sandbox);
    if (cabeceras() !== "precio:▼") fail("el reclic no invierte la flecha: " + cabeceras());
    vm.runInContext(`toggleSort(${iCol("km")})`, b.sandbox);
    if (cabeceras() !== "precio:1 ▼|km:2 ▲")
      fail("con dos columnas las cabeceras no numeran la prioridad: " + cabeceras());
    vm.runInContext("clearSort()", b.sandbox);
    if (cabeceras() !== "") fail("limpiar el orden deja cabeceras marcadas: " + cabeceras());
    // y la flecha vieja se va con la marca: si `data-dir` se queda pegado, al volver a ordenar
    // por otra columna la tabla enseña dos flechas
    const pegadas = vm.runInContext(
      'thead.querySelectorAll("th[data-col]").filter((t) => t.dataset.dir).length',
      b.sandbox,
    );
    if (pegadas !== 0) fail("tras limpiar quedaron " + pegadas + " flechas pegadas");
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

  // 12i. lo que cambia solo (el contador de la búsqueda y el snack) tiene que anunciarse: sin una
  //      región viva, quien usa lector de pantalla no sabe que la búsqueda arrancó ni que hay
  //      "Deshacer".
  for (const id of ["loadingCount", "snack"]) {
    const tag = (HTML.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>')) || [])[0] || "";
    if (!/role="status"/.test(tag) || !/aria-live="polite"/.test(tag))
      fail(`#${id} no es una región viva: ` + tag);
  }

  // 12i-bis. …pero el cronómetro NO. `startTimer` lo reescribe cada segundo, y dentro de la región
  //          viva el lector repetía el estado entero una vez por segundo durante toda la búsqueda.
  {
    const vivo = (HTML.match(/<div[^>]*id="loadingCount"[^>]*>[\s\S]*?<\/div>/) || [])[0] || "";
    if (/loadingTime/.test(vivo)) fail("el cronómetro vive dentro de la región viva: " + vivo);
    const caja = (HTML.match(/<div[^>]*id="loading"[^>]*>/) || [])[0] || "";
    if (/aria-live|role="status"/.test(caja)) fail("la caja entera sigue siendo región viva: " + caja);
  }

  // 12j. el botón que destruye es rojo en REPOSO: en un móvil no hay ratón y un rojo que solo
  //      sale con :hover no lo ve nadie.
  {
    const reposo = (CSS.match(/\.btn\.quitar \{[^}]*\}/) || [])[0] || "";
    if (!/--danger/.test(reposo)) fail("el botón Quitar no es rojo en reposo: " + reposo);
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

  // 12l. progreso por rama: con doce ramas el usuario veía el reloj subir sin saber cuántas le
  //      quedaban. Van de cuatro en cuatro, así que el número es el de ramas TERMINADAS: los tres
  //      avisos de entrada seguidos con el contador a 0 son las tres ramas arrancando a la vez.
  {
    const Rebusca = require("./scrape.js");
    const item = (id) => ({ id, title: "x", location: {} });
    const antes = global.fetch;
    // rama 1: un anuncio. rama 2: vacía (tiene que mover el contador igual). rama 3: un anuncio.
    let pedida = 0;
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ data: { section: { payload: { items: ++pedida === 2 ? [] : [item("i" + pedida)] } } } }),
    });
    const pasos = [];
    try {
      await Rebusca.scrape({ keywords: "a OR b OR c", onProgress: (n, r, t) => pasos.push(`${n}/${r}/${t}`) });
    } finally {
      global.fetch = antes;
    }
    // entrada de rama + una llamada por fila nueva
    const esperado = ["0/0/3", "0/0/3", "0/0/3", "1/0/3", "2/0/3"].join(" ");
    if (pasos.join(" ") !== esperado) fail("el progreso no cuenta las ramas: " + pasos.join(" "));
  }

  // 12m. un tope de filas corta la búsqueda muy amplia y la marca como parcial
  {
    const Rebusca = require("./scrape.js");
    const antes = global.fetch;
    let pag = 0;
    // 10 páginas de 3 anuncios = 30 filas. Sin tope se recogen las 30; el tope corta en la 5.
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        data: { section: { payload: { items: [0, 1, 2].map((k) => ({ id: `p${pag}i${k}`, title: "x", location: {} })) } } },
        meta: { next_page: ++pag < 10 ? "n" + pag : null },
      }),
    });
    let csv;
    try { csv = await Rebusca.scrape({ keywords: "sofa", maxRows: 5 }); }
    finally { global.fetch = antes; }
    const filas = csv.trim().split("\n").length - 1; // menos la cabecera
    if (filas !== 5) fail("el tope no cortó la búsqueda: " + filas + " filas"); // corta en la fila justa, no al final de la página
    const diag = Rebusca.lastScrape;
    if (diag.tope !== 5 || !diag.parcial) fail("el tope no marca el resultado como parcial: " + JSON.stringify(diag));
  }

  // 12n. la gramática OR vive en el popover de la "i": el placeholder rota ejemplos de andar por
  //      casa (microondas, ps5...), así que ese popover es el único sitio donde descubrir OR,
  //      comillas y paréntesis. Si se cae, buscar una palabra suelta se vuelve el techo de la app
  {
    const tag = (HTML.match(/<input[^>]*id="kw"[^>]*>/) || [])[0] || ""; // el tag ocupa varias líneas; [^>] las cruza
    // el ejemplo es un span encima del campo; el placeholder nativo se queda en blanco a propósito,
    // solo para que `:placeholder-shown` siga escondiendo el span cuando el usuario escribe
    if (!/placeholder=" "/.test(tag)) fail("sin placeholder en blanco el ejemplo tapa lo escrito: " + tag);
    if (!/id="kwph"[^>]*>\s*\S/.test(HTML)) fail("el buscador se quedó sin ejemplo que enseñar");
    if (!/<code>corsair OR seasonic<\/code>/.test(HTML)) fail("la ayuda ya no explica la gramática OR");
    if (!/aria-label="/.test(tag)) fail("el buscador se quedó sin nombre accesible: " + tag);
  }

  // 12ñ. la rueda de la cabecera abre las opciones y nada más. Llevó un badge con los anuncios sin
  //      clasificar de todas las búsquedas guardadas: con volúmenes reales vivía clavado en "99+",
  //      así que no avisaba de nada y hacía pensar en mensajes. El recuento vive en el gestor.
  if (/id="cogBadge"/.test(HTML)) fail("la rueda volvió a llevar un contador encima");

  // 12o. cada tope del cajón lleva su rótulo fuera del campo. Estuvo en el placeholder, que se
  //      borra al escribir: tres cajas con «30 10 20» y ni idea de cuál era el precio.
  //      Se mira celda a celda (el bloque .lims partido por <label>): si el bloque se renombra,
  //      no hay celdas y los cuatro fallan, en vez de aprobar por no encontrar nada.
  {
    const celdas = ((HTML.match(/<details class="lims"[\s\S]*?\n        <\/details>/) || [""])[0]).split("<label");
    for (const c of ["precioMin", "precio", "dias", "km"]) {
      const celda = celdas.find((s) => s.includes(`id="lim_${c}"`));
      if (!celda || !/<span class="lim-t">[^<]+<\/span/.test(celda))
        fail(`el tope ${c} se quedó sin rótulo visible`);
    }
  }

  // 12o-bis. la ✕ de vaciar va PEGADA a su campo: `input:placeholder-shown + .clr` la esconde
  //      cuando no hay nada escrito, y ese `+` pide hermano inmediato. Un espacio o un comentario
  //      en medio y la cruz se queda visible sobre los seis campos vacíos.
  for (const id of ["kw", "exclAdd", "lim_precioMin", "lim_precio", "lim_dias", "lim_km"]) {
    if (!new RegExp(`id="${id}"[^>]*/><button[^>]*id="clr_${id}"`).test(HTML))
      fail(`la ✕ de ${id} no es hermana inmediata de su campo (o no está)`);
    // sin placeholder no hay :placeholder-shown y la ✕ se ve siempre, también en vacío
    if (!new RegExp(`id="${id}"[^>]*placeholder=`).test(HTML))
      fail(`el campo ${id} se quedó sin placeholder: su ✕ ya no sabe esconderse`);
  }

  // 12p. el modo oscuro no se pudre. Solo se invierten variables, así que un color
  //      escrito a pelo en una regla se queda claro sobre fondo oscuro y nadie lo ve hasta prod.
  {
    const dark = (CSS.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n  \}\n/) || [])[0];
    if (!dark) fail("no hay bloque @media (prefers-color-scheme: dark) en app.css");
    for (const v of dark.match(/--[\w-]+(?=:)/g) || [])
      if (!new RegExp("^\\s*\\" + v + ":", "m").test(CSS.slice(0, CSS.indexOf(dark))))
        fail("el modo oscuro redefine " + v + ", que no existe en :root");
    // blancos y negros sobre sólidos de marca (--pine/--amber/--danger) o sobre foto: iguales en los dos temas
    const OK = /^(#fff|#ffffff|#000|#f3f5f1|#fff0)$/i;
    const cuerpo = CSS.slice(CSS.indexOf(dark) + dark.length, CSS.indexOf("@media print"));
    for (const [linea] of cuerpo.matchAll(/^.*#[0-9a-f]{3,8}\b.*$/gim))
      for (const c of linea.match(/#[0-9a-f]{3,8}\b/gi) || [])
        if (!OK.test(c)) fail("color a pelo fuera de :root, no se invierte en oscuro: " + linea.trim());
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
