// test_scrape.js — el scraper contra una API de Wallapop de mentira.
// `node scrape.js demo` es 100% offline: no toca getJSON() ni scrape(), o sea que la
// paginación, los reintentos, el corte por antigüedad y el aborto no los probaba nadie.
// Aquí se ejecuta scrape.js dentro de un vm con `fetch` falso y `setTimeout` instantáneo
// (los backoff son de segundos: sin esto el test tardaría minutos).
//
//   node src/test_scrape.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "scrape.js"), "utf8");
const DIA = 86400000;

let n = 0;
const fail = (m) => { throw new Error("FAIL: " + m); };
const ok = (cond, m) => { n++; if (!cond) fail(m); };

// respuesta de fetch falsa. `body` puede ser un objeto (se sirve como JSON) o una función
// (se llama al parsear: así se simula un 200 con HTML, donde res.json() rechaza).
const resp = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === "function" ? body() : body),
});
const page = (items, next = null) => ({ data: { section: { payload: { items } } }, meta: { next_page: next } });
// anuncio mínimo con la forma que devuelve la API
const item = (id, o = {}) => ({
  id,
  title: o.title || id,
  price: { amount: o.precio ?? 10 },
  location: { latitude: o.lat ?? 37.78, longitude: o.lon ?? -3.78, city: "Jaen", postal_code: "23001" },
  created_at: Date.now() - (o.dias ?? 0) * DIA,
  taxonomy: [{ name: "Coches" }],
  user_id: "v1",
  images: [],
});

// carga scrape.js con su propio fetch y sin esperas reales
function load(fetchFake) {
  const calls = [];
  const sandbox = {
    fetch: (url, init) => (calls.push(String(url)), fetchFake(String(url), init, calls.length - 1)),
    setTimeout: (cb) => (cb(), 0), // los sleep de backoff/jitter no cuestan tiempo en el test
    URLSearchParams, Math, Date, JSON, Promise, Error, console,
    module: { exports: {} },
    require: { main: null },
  };
  vm.runInNewContext(SRC, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls };
}
const filas = (csv) => csv.trim().split("\r\n").slice(1); // sin la cabecera
const col = (linea, i) => linea.split(",")[i];

async function main() {
  // ── 1. camino feliz: una página, dos anuncios, ordenados por cercanía ──
  {
    const { api, calls } = load(async () => resp(200, page([item("lejos", { lat: 38.5 }), item("cerca")])));
    const csv = await api.scrape({ keywords: "ford" });
    ok(csv.startsWith(api.FIELDS.join(",") + "\r\n"), "el CSV no lleva la cabecera del esquema");
    ok(filas(csv).length === 2, "no salieron las dos filas: " + filas(csv).length);
    ok(col(filas(csv)[0], 0) === "cerca", "el CSV no salió ordenado por km");
    ok(calls[0].includes("keywords=ford") && calls[0].includes("latitude=37.7796"),
      "la query no lleva keywords/lat por defecto: " + calls[0]);
    ok(!calls[0].includes("time_filter") && !calls[0].includes("order_by"),
      "sin `since` no debería mandar time_filter/order_by: " + calls[0]);
  }

  // ── 2. paginación: el cursor next_page manda, y ya no repite keywords ──
  {
    const { api, calls } = load(async (url) =>
      url.includes("next_page") ? resp(200, page([item("b")])) : resp(200, page([item("a")], "CUR")));
    const csv = await api.scrape({ keywords: "ford" });
    ok(filas(csv).length === 2, "la segunda página no se pidió o no se sumó");
    ok(calls.length === 2 && calls[1].includes("next_page=CUR"), "el cursor no se usó: " + calls[1]);
    ok(!calls[1].includes("keywords"), "el cursor ya lleva la búsqueda dentro, no hay que repetirla");
  }

  // ── 3. ramas OR: una búsqueda por rama y dedup del anuncio repetido ──
  {
    const { api, calls } = load(async () => resp(200, page([item("dup")])));
    const csv = await api.scrape({ keywords: "corsair OR seasonic" });
    ok(calls.length === 2, "no se lanzó una búsqueda por rama: " + calls.length);
    ok(filas(csv).length === 1, "el anuncio que sale en las dos ramas se duplicó");
  }

  // ── 4. titleOnly: descarta lo que no lleva TODAS las palabras en el título ──
  {
    const { api } = load(async () => resp(200, page([item("x", { title: "Funda de móvil" }), item("y", { title: "iPhone 12 azul" })])));
    const csv = await api.scrape({ keywords: "iphone azul", titleOnly: true });
    ok(filas(csv).length === 1 && col(filas(csv)[0], 0) === "y", "titleOnly no filtró por título");
  }

  // ── 5. `since`: filtro del servidor + corte en cliente al llegar a lo viejo ──
  {
    const { api, calls } = load(async () => resp(200, page([item("nuevo", { dias: 1 }), item("viejo", { dias: 40 }), item("tras", { dias: 2 })], "CUR")));
    const csv = await api.scrape({ keywords: "ford", since: "semana" });
    ok(calls[0].includes("time_filter=lastWeek") && calls[0].includes("order_by=newest"),
      "since no se tradujo a time_filter/order_by: " + calls[0]);
    ok(filas(csv).length === 1, "el corte por antigüedad no dejó solo el fresco");
    ok(calls.length === 1, "al llegar a lo viejo hay que parar la rama, no pedir la página siguiente");
  }

  // ── 6. 429: reintenta con backoff y sigue como si nada ──
  {
    const { api, calls } = load(async (url, init, i) =>
      i === 0 ? resp(429, {}, { "retry-after": "1" }) : resp(200, page([item("a")])));
    const csv = await api.scrape({ keywords: "ford" });
    ok(calls.length === 2 && filas(csv).length === 1, "un 429 no se reintentó");
  }

  // ── 7. 200 con cuerpo que no es JSON (página de error servida con 200): también se reintenta.
  //     res.json() estaba FUERA del try de reintentos, así que su rechazo se escapaba entero.
  {
    const { api, calls } = load(async (url, init, i) =>
      i === 0 ? resp(200, () => { throw new SyntaxError("Unexpected token < in JSON"); })
              : resp(200, page([item("a")])));
    const csv = await api.scrape({ keywords: "ford" });
    ok(calls.length === 2 && filas(csv).length === 1, "un 200 con cuerpo no-JSON no se reintentó");
  }

  // ── 8. 200 con error blando {"status":400}: params malos. Se avisa, no se reintenta.
  //     Antes caía en el fallback de "sin items": 0 resultados en silencio, y el usuario
  //     creyendo que en Wallapop no hay nada.
  {
    const { api, calls } = load(async () => resp(200, { status: 400, message: "bad param" }));
    let err = null;
    await api.scrape({ keywords: "ford" }).catch((e) => (err = e));
    ok(err && /400/.test(err.message), "un 400 blando de la API pasó en silencio: " + (err && err.message));
    ok(calls.length === 1, "un 400 de params no se reintenta: " + calls.length);
  }

  // ── 9. una rama que se cae NO tira lo ya recogido por las anteriores ──
  {
    const { api } = load(async (url) =>
      url.includes("mala") ? resp(500, {}) : resp(200, page([item("a")])));
    const csv = await api.scrape({ keywords: "buena OR mala" });
    ok(filas(csv).length === 1, "la rama caída se llevó por delante las filas de la buena");
  }

  // ── 9b. …pero si no hay NADA que salvar, el error sube y se ve ──
  {
    const { api } = load(async () => resp(500, {}));
    let err = null;
    await api.scrape({ keywords: "ford" }).catch((e) => (err = e));
    ok(err, "una búsqueda que falla entera debe avisar, no devolver un CSV vacío");
  }

  // ── 10. 403 (DataDome): corta la rama y conserva lo recogido ──
  {
    const { api } = load(async (url) => (url.includes("mala") ? resp(403, {}) : resp(200, page([item("a")]))));
    const csv = await api.scrape({ keywords: "buena OR mala" });
    ok(filas(csv).length === 1, "el 403 de una rama se llevó por delante lo de la otra");
  }

  // ── 11. parar la búsqueda: devuelve lo que llevaba, sin lanzar ──
  {
    const ctrl = { aborted: false };
    const { api } = load(async () => (ctrl.aborted = true, resp(200, page([item("a")], "CUR"))));
    const csv = await api.scrape({ keywords: "ford", signal: ctrl });
    ok(filas(csv).length === 1, "al parar se perdió lo ya recogido");
  }

  // ── 12. onProgress: un aviso por anuncio nuevo, con el total acumulado ──
  {
    const vistos = [];
    const { api } = load(async () => resp(200, page([item("a"), item("b")])));
    await api.scrape({ keywords: "ford", onProgress: (k) => vistos.push(k) });
    ok(vistos.join() === "1,2", "onProgress no contó bien: " + vistos.join());
  }

  console.log("ok (" + n + " comprobaciones)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
