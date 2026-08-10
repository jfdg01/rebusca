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

// carga scrape.js con su propio fetch y sin esperas reales.
// `reloj: "congelado"` hace lo contrario: los sleep NO vuelven solos. Es la única forma de
// probar que abortar corta una espera en curso; con el setTimeout instantáneo de siempre, un
// sleep que ignora el signal se ve idéntico a uno que lo respeta.
function load(fetchFake, reloj) {
  const calls = [];
  const timers = [];
  const esperas = [];   // ms de cada sleep: el reloj es instantáneo, pero el tiempo se apunta
  const sandbox = {
    fetch: (url, init) => (calls.push(String(url)), fetchFake(String(url), init, calls.length - 1)),
    setTimeout: reloj === "congelado"
      ? (cb) => timers.push(cb)                 // se guarda y no se llama nunca
      : (cb, ms) => (esperas.push(ms), cb(), 0), // los sleep de backoff/jitter no cuestan tiempo
    clearTimeout: () => {},
    URLSearchParams, Math, Date, JSON, Promise, Error, console,
    module: { exports: {} },
    require: { main: null },
  };
  vm.runInNewContext(SRC, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports, calls, esperas };
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

  // ── 9. una rama que se cae corta ESA rama, no la búsqueda entera. Con la rama mala en
  //     medio se ve: las de detrás se tienen que pedir igual. (El 403 no: ese corta todo, test 15.)
  {
    const { api, calls } = load(async (url) =>
      url.includes("mala") ? resp(500, {}) : resp(200, page([item(url.includes("tercera") ? "c" : "a")])));
    const csv = await api.scrape({ keywords: "buena OR mala OR tercera" });
    ok(calls.some((u) => u.includes("tercera")), "la rama caída se llevó por delante las que van detrás");
    ok(filas(csv).length === 2, "faltan filas de las ramas sanas: " + filas(csv).length);
  }

  // ── 9b. …pero si no hay NADA que salvar, el error sube y se ve ──
  {
    const { api } = load(async () => resp(500, {}));
    let err = null;
    await api.scrape({ keywords: "ford" }).catch((e) => (err = e));
    ok(err, "una búsqueda que falla entera debe avisar, no devolver un CSV vacío");
  }

  // ── 9c. la PRIMERA rama es la que se cae ──
  //     El corte era `if (rows.length) break; throw e;`, y en la primera rama `rows.length`
  //     vale 0 siempre. O sea: la red floja al empezar tiraba la búsqueda entera sin llegar
  //     a pedir las otras ramas. El test 9 no lo veía porque pone la rama mala en medio.
  {
    const { api, calls } = load(async (url) => (url.includes("mala") ? resp(500, {}) : resp(200, page([item("a")]))));
    const csv = await api.scrape({ keywords: "mala OR buena" });
    ok(calls.some((u) => u.includes("buena")), "la primera rama caída se llevó por delante a la segunda");
    ok(filas(csv).length === 1, "se perdieron las filas de la rama sana: " + filas(csv).length);
    ok(api.lastScrape.parcial, "una rama caída tiene que marcar el resultado parcial");
  }

  // ── 9d. el error que sube dice de qué murió ──
  //     "agotados los reintentos" a secas tapaba por igual un 429, un preflight CORS rechazado
  //     (la app muerta para todos) y un SyntaxError de una página de DataDome servida con 200.
  {
    const { api } = load(async () => resp(503, {}));
    let err = null;
    await api.scrape({ keywords: "ford" }).catch((e) => (err = e));
    ok(err && /503/.test(err.message), "el error final no dice la causa: " + (err && err.message));
    ok(err && err.cause, "el error final no lleva la causa original en `cause`");
  }

  // ── 9e. el sobre de la respuesta cambia de forma ──
  //     `data.section.payload` se leía con `|| []`, así que un renombrado en la API daba cero
  //     anuncios con `parcial` en false: una caída total pintada como "no hay resultados", y
  //     cacheada para siempre porque el cache no caduca. `wallapop.py` indexa el sobre directo
  //     y peta; aquí tiene que marcar la rama rota.
  {
    const { api } = load(async () => resp(200, { data: { seccion: { payload: { items: [item("a")] } } } }));
    const csv = await api.scrape({ keywords: "ford" });
    ok(filas(csv).length === 0, "un sobre desconocido no puede devolver filas");
    ok(api.lastScrape.ramasRotas === 1, "el sobre roto no contó como rama rota");
    ok(api.lastScrape.parcial, "el sobre roto tiene que marcar parcial: si no, se cachea el vacío");
  }

  // ── 9e-bis. el sobre llega, pero la lista de dentro se llama de otra forma ──
  //     Los dos lados del guard hacen falta: el payload ausente lo caza `!items`, y el payload
  //     presente con la lista renombrada solo lo caza el `Array.isArray`.
  {
    const { api } = load(async () => resp(200, { data: { section: { payload: { results: [item("a")] } } } }));
    const csv = await api.scrape({ keywords: "ford" });
    ok(filas(csv).length === 0, "una lista renombrada no puede devolver filas");
    ok(api.lastScrape.ramasRotas === 1, "la lista renombrada no contó como rama rota");
  }

  // ── 9f. …y a media paginación es peor: trunca con filas ya recogidas ──
  {
    let p = 0;
    const { api } = load(async () => (++p === 1 ? resp(200, page([item("a")], "CUR")) : resp(200, { data: {} })));
    const csv = await api.scrape({ keywords: "ford" });
    ok(filas(csv).length === 1, "se perdió lo recogido antes de que cambiara la forma");
    ok(api.lastScrape.parcial, "un truncado por forma desconocida se estaba cacheando como definitivo");
  }

  // ── 10. 403 (DataDome): conserva lo recogido (que corte el scrape entero, en el test 15) ──
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
    // …y ese recorte tiene que quedar marcado. `app.js` no cachea lo `parcial`, y el cache no
    // caduca: sin la marca, lo que el usuario paró a medias se guarda como definitivo para siempre.
    // Los sitios de `test_buttons.js` que miran `.parcial` escriben `lastScrape` a mano; este
    // es el único que lo saca del `scrape.js` de verdad.
    ok(api.lastScrape.abortado, "parar no quedó registrado en el diagnóstico");
    ok(api.lastScrape.parcial, "una búsqueda parada no se marca parcial: se cachearía como completa");
  }

  // ── 11b. parar DURANTE una espera: el sleep tiene que cortarse, no cumplirse ──
  //      El check 11 aborta antes de un sleep; este aborta con el sleep ya en marcha, que es
  //      lo que pasa de verdad: el usuario pulsa parar mientras corre el jitter entre páginas
  //      (medio segundo) o un backoff por 429 (los 15 s del backoff propio, más jitter, o lo
  //      que mande un Retry-After).
  {
    const ac = new AbortController();
    const { api } = load(async () => resp(200, page([item("a")], "CUR")), "congelado");
    const p = api.scrape({ keywords: "ford", signal: ac.signal });
    await new Promise((r) => setImmediate(r));   // deja que la primera página llegue al sleep
    ac.abort();
    const tarde = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("FAIL: scrape() sigue esperando 300ms después de abortar")), 300));
    const csv = await Promise.race([p, tarde]);
    ok(filas(csv).length === 1, "al parar durante la espera se perdió lo ya recogido");
  }

  // ── 11c. la espera que se cumple no deja su listener pegado al signal ──
  //      El listener de abort se arma con {once:true}, que solo lo retira si el abort llega.
  //      En una búsqueda normal el abort no llega nunca, así que cada página dejaba uno detrás.
  {
    const ac = new AbortController();
    const { api } = load(async (_u, _i, i) => resp(200, page([item("a" + i)], i < 9 ? "CUR" + i : null)));
    await api.scrape({ keywords: "ford", signal: ac.signal });
    const pegados = require("events").getEventListeners(ac.signal, "abort").length;
    ok(pegados === 0, "una búsqueda de 10 páginas dejó " + pegados + " listeners de abort pegados");
  }

  // ── 12. onProgress: un aviso al entrar en cada rama y otro por anuncio nuevo ──
  //      El 0 de cabeza es el aviso de entrada: sin él, una rama que no devuelve nada deja el
  //      contador congelado y la búsqueda parece colgada.
  {
    const vistos = [];
    const { api } = load(async () => resp(200, page([item("a"), item("b")])));
    await api.scrape({ keywords: "ford", onProgress: (k) => vistos.push(k) });
    ok(vistos.join() === "0,1,2", "onProgress no contó bien: " + vistos.join());
  }

  // ── 13. el tope se reparte entre las ramas del OR ──
  //      Sin reparto, la primera rama se come el tope entero y las siguientes no llegan a pedir
  //      ni una página: buscas "iphone OR pixel OR xiaomi" y ves 1500 iPhones y cero Xiaomis.
  {
    const kwDe = (url) => (decodeURIComponent(url).match(/keywords=([^&]*)/) || [, "cursor"])[1];
    const { api } = load(async (url) => {
      const kw = kwDe(url);
      return resp(200, page(Array.from({ length: 10 }, (_, i) => item(kw + i))));
    });
    const csv = await api.scrape({ keywords: "aaa OR bbb OR ccc", maxRows: 9 });
    const ids = filas(csv).map((l) => col(l, 0));
    for (const kw of ["aaa", "bbb", "ccc"])
      ok(ids.some((id) => id.startsWith(kw)), `la rama "${kw}" se quedó sin pedir: ` + ids.join());
    ok(filas(csv).length === 9, "el reparto se pasa del tope total: " + filas(csv).length);
    ok(api.lastScrape.parcial, "un resultado recortado por el tope no se marca como parcial");
  }

  // ── 13b. lo que una rama no gasta pasa a las siguientes ──
  //      Un cupo rígido de maxRows/ramas dejaría el resultado corto cuando una rama viene vacía.
  {
    const { api } = load(async (url) => {
      const kw = (decodeURIComponent(url).match(/keywords=([^&]*)/) || [, "cursor"])[1];
      return resp(200, page(kw === "bbb" ? [] : Array.from({ length: 10 }, (_, i) => item(kw + i))));
    });
    const csv = await api.scrape({ keywords: "aaa OR bbb OR ccc", maxRows: 9 });
    ok(filas(csv).length === 9, "el cupo de la rama vacía se perdió: " + filas(csv).length + " de 9");
  }

  // ── 13c. el cupo de UNA rama basta para marcar parcial, sin tocar el tope total ──
  //      El check 13 llega al tope global; este no. La rama "aaa" llena su cupo de 5 y "bbb" viene
  //      vacía, así que el total se queda en 5 de 10 y `diag.tope` nunca se pone. Si `ramasTope` se
  //      cayera de `diag.parcial`, ese recorte se cachearía como el resultado definitivo.
  {
    const { api } = load(async (url) => {
      const kw = (decodeURIComponent(url).match(/keywords=([^&]*)/) || [, "cursor"])[1];
      return resp(200, page(kw === "bbb" ? [] : Array.from({ length: 20 }, (_, i) => item(kw + i))));
    });
    const csv = await api.scrape({ keywords: "aaa OR bbb", maxRows: 10 });
    ok(filas(csv).length === 5, "el cupo de la rama no recortó: " + filas(csv).length + " de 5");
    ok(api.lastScrape.tope === 0, "este escenario no debe llegar al tope total: " + api.lastScrape.tope);
    ok(api.lastScrape.ramasTope === 1, "el cupo de la rama no quedó contado: " + api.lastScrape.ramasTope);
    ok(api.lastScrape.parcial, "una rama que llena su cupo no marca parcial: se cachearía un recorte");
  }

  // ── 14. una API que nunca deja de dar cursor no puede hacer un bucle sin fin ──
  //     Sin filtro de frescura `old` no se pone nunca, y `lleno` mira las filas: si las filas
  //     no crecen, las dos condiciones locales no llegan jamás. Tres formas de que no crezcan,
  //     y la tercera no necesita una API rota.
  {
    // El cursor se apaga a las 400 páginas: sin ese freno el test no falla, se queda sin
    // memoria. Que 400 sea el número que salva al test, y no el scraper, es justo el defecto.
    // El límite de abajo es 31 y no 200: el freno cuenta páginas SECAS —sin una fila nueva— y en
    // los tres escenarios ninguna página trae nada, así que la racha nunca se rompe.
    const fin = (i, pag) => (i >= 400 ? resp(200, page([], null)) : pag);
    const escenarios = [
      ["páginas vacías", async (u, _init, i) => fin(i, resp(200, page([], "CUR" + i))), {}],
      ["el mismo item una y otra vez", async (u, _init, i) => fin(i, resp(200, page([item("a")], "CUR"))), {}],
      ["titleOnly y nada que case", async (u, _init, i) => fin(i, resp(200, page([item("x" + i, { title: "otra cosa" })], "CUR" + i))),
        { titleOnly: true }],
    ];
    for (const [nombre, f, extra] of escenarios) {
      const { api, calls } = load(f);
      const csv = await api.scrape({ keywords: "ford", ...extra });
      ok(calls.length <= 31, `sin freno por no avanzar: "${nombre}" pidió ${calls.length} veces`);
      // `ramasSecas`, no `parcial`: el corte es determinista —re-scrapear da las mismas páginas
      // secas—, así que sí se cachea. Lo que se exige es que el corte quede contado, porque de ese
      // contador salen el aviso al usuario y este mismo check.
      ok(api.lastScrape.ramasSecas === 1, `el recorte de "${nombre}" no quedó contado: ${api.lastScrape.ramasSecas}`);
      ok(!api.lastScrape.parcial, `"${nombre}" se marcó parcial: pierde el cache y se re-scrapea entero en cada apertura`);
      ok(csv.startsWith(api.FIELDS.join(",")), `"${nombre}" no devolvió un CSV`);
    }
  }

  // ── 14b. …y el freno NO puede tocar una búsqueda que avanza despacio ──
  //     Este es el check que la iteración 8 no tuvo, y por eso su tope de páginas totales pasó
  //     verde recortando búsquedas sanas. API perfecta, catálogo finito de 250 páginas, "solo en
  //     el título" y 4 aciertos de cada 40: avanza despacio, pero avanza y termina sola.
  {
    // Tres páginas seguidas sin un solo acierto de cada 25: un tramo del catálogo donde no hay
    // nada que case. Es lo que hace que un freno demasiado impaciente muera aquí y no en prod.
    const aciertos = (i) => (i % 25 >= 22 ? 0 : 4);
    const pagina = (i) => page(
      Array.from({ length: 40 }, (_, j) => item(`i${i}_${j}`, { title: j < aciertos(i) ? "sofa gris" : "otra cosa" })),
      i >= 249 ? null : "CUR" + i);
    const { api, calls } = load(async (u, _init, i) => resp(200, pagina(i)));
    const csv = await api.scrape({ keywords: "sofa", titleOnly: true });
    ok(calls.length === 250, "el freno recortó una búsqueda que avanza: " + calls.length + " páginas de 250");
    ok(filas(csv).length === 880, "faltan anuncios de un catálogo que se agota solo: " + filas(csv).length + " de 880");
    ok(!api.lastScrape.parcial, "una búsqueda completa se marcó parcial: no se cachea y se re-scrapea en cada apertura");
  }

  // ── 14c. el freno corta SU rama, no el scrape: las de detrás se siguen pidiendo ──
  //     Es lo que dice el comentario de `scrape.js` y lo que nadie comprobaba. Con un
  //     `return finish()` en vez del `break`, la rama "bbb" no se pide nunca: se pierde entera,
  //     `ramasRotas` sigue en cero, no hay error en consola, y `parcial` sigue en `false`. Un
  //     resultado al que le falta una rama, cacheado como definitivo y sin un solo indicio.
  {
    const { api, calls } = load(async (_u, _init, i) =>
      i < 30 ? resp(200, page([], "CUR")) : resp(200, page([item("bbb-hit")], null)));
    const csv = await api.scrape({ keywords: "aaa OR bbb" });
    ok(filas(csv).length === 1, "la rama de detrás se perdió con la rama seca: " + filas(csv).length);
    ok(calls.some((u) => decodeURIComponent(u).includes("keywords=bbb")), "la rama 'bbb' no se pidió");
    ok(api.lastScrape.ramasSecas === 1, "la rama seca no quedó contada: " + api.lastScrape.ramasSecas);
  }

  // ── 15. el 403 corta el scrape ENTERO: insistir con el bloqueo puesto lo alarga ──
  {
    const { api, calls } = load(async (url) => (url.includes("aaa") ? resp(403, {}) : resp(200, page([item("a")]))));
    const csv = await api.scrape({ keywords: "aaa OR bbb OR ccc" });
    ok(calls.length === 1, "tras el 403 se siguió pidiendo: " + calls.length + " peticiones");
    ok(api.lastScrape.bloqueado, "el bloqueo no sale por el diagnóstico y el usuario no sabe qué le pasa");
    ok(api.lastScrape.parcial, "un scrape cortado por bloqueo no puede cachearse como definitivo");
    ok(csv.startsWith(api.FIELDS.join(",")), "el 403 no debe lanzar: devuelve lo que llevara");
  }

  // ── 15b. …y lo ya recogido se conserva (el 403 llega con la rama buena ya hecha) ──
  {
    const { api } = load(async (url) => (url.includes("mala") ? resp(403, {}) : resp(200, page([item("a")]))));
    const csv = await api.scrape({ keywords: "buena OR mala" });
    ok(filas(csv).length === 1, "el 403 se llevó por delante lo que ya había recogido");
  }

  // ── 16. el quinto reintento no duerme: esperar 16 s y rendirse igual es espera regalada ──
  {
    const { api, esperas } = load(async () => resp(503, {}));
    await api.scrape({ keywords: "ford" }).catch(() => {});
    ok(esperas.length === 4, "el intento que no existe también durmió: " + esperas.length + " esperas para 5 intentos");
    ok(Math.max(...esperas) < 9000, "la espera más larga es la del intento que se rinde: " + Math.max(...esperas));
  }

  // ── 16b. …pero el `Retry-After` del quinto SÍ se respeta ──
  //     No precede a un reintento que no existe; precede a la primera petición de la rama
  //     siguiente. Es una instrucción del servidor, y tirarla es perder funcionalidad.
  {
    const { api, esperas } = load(async () => resp(429, {}, { "retry-after": "30" }));
    await api.scrape({ keywords: "ford OR sofa" }).catch(() => {});
    ok(esperas.length >= 5, "el Retry-After del último intento se tiró: " + esperas.length + " esperas");
    ok(esperas[4] >= 30000, "el último 429 pidió 30 s y se esperó " + esperas[4]);
    ok(esperas.slice(0, 4).every((ms) => ms >= 30000), "el backoff con Retry-After cambió: " + esperas.slice(0, 4));
  }

  // ── 16c. …y con un techo, porque el número lo elige el servidor ──
  //     El backoff propio está acotado por construcción: duermen los intentos a=0..3, con
  //     `2 ** a` segundos cada uno, así que la espera acumulada son 15 s más el jitter.
  //     El `Retry-After` no lo acotaba nada, y sustituye a ese backoff. Medido con el scrape de
  //     entonces: un `Retry-After: 3600` colgaba UNA rama 300 minutos con la barra girando.
  {
    const { api, esperas } = load(async () => resp(429, {}, { "retry-after": "3600" }));
    await api.scrape({ keywords: "ford" }).catch(() => {});
    ok(Math.max(...esperas) <= 61000, "una espera pasó del minuto: " + Math.max(...esperas) + " ms");
    ok(esperas.length === 5, "el número de intentos cambió: " + esperas.length);
  }

  // ── 17. la frontera de la antigüedad: `dias > maxDays`, no `>=` ──
  //     No es solo que se cuele o se caiga un anuncio: ahí también se pone `old = true`, así que
  //     equivocar el signo TRUNCA el resto de la rama. Con `>=`, "última semana" tira el anuncio
  //     de siete días justos y todo lo que venga detrás.
  {
    const { api } = load(async () => resp(200, page([item("nuevo", { dias: 1 }), item("borde", { dias: 7 }), item("viejo", { dias: 8 })])));
    const csv = await api.scrape({ keywords: "ford", since: "semana" });
    ok(filas(csv).length === 2, "la frontera de los 7 días se movió: " + filas(csv).length + " filas");
  }

  // ── 17b. …y un anuncio sin fecha legible se salta, no trunca ──
  //     Sin el `continue`, `"" > 7` es false y el anuncio entra como si fuera reciente.
  {
    const { api } = load(async () => resp(200, page([item("nuevo", { dias: 1 }), { ...item("sinfecha"), created_at: "ayer" }])));
    const csv = await api.scrape({ keywords: "ford", since: "semana" });
    ok(filas(csv).length === 1, "un anuncio sin fecha se coló en una búsqueda con ventana: " + filas(csv).length);
  }

  // ── 18. una coordenada que no es un número deja la celda vacía, no "NaN" ──
  //     "NaN" no es "", así que la celda pasa entera a app.js: `overMax` la lee como no numérica
  //     y el tope de distancia deja pasar la fila, y la ficha de la lista pinta "a NaN km".
  {
    const raro = { ...item("raro"), location: { latitude: "37,78", longitude: "-3,78", city: "Jaen" } };
    const { api } = load(async () => resp(200, page([raro])));
    const csv = await api.scrape({ keywords: "ford" });
    ok(!csv.includes("NaN"), "una coordenada de texto se cuela como NaN: " + filas(csv)[0]);
  }

  // ── 18b. …y el 0 es una coordenada legítima, no una coordenada ausente ──
  //     `lat && lon` tiraba la distancia de todo anuncio en longitud 0, que pasa por Castellón.
  {
    const { api } = load(async () => resp(200, page([item("greenwich", { lon: 0 })])));
    const csv = await api.scrape({ keywords: "ford" });
    ok(filas(csv)[0].split(",")[6] !== "", "la longitud 0 perdió la distancia: " + filas(csv)[0]);
  }

  console.log("ok (" + n + " comprobaciones)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
