// test_buttons.js — ¿hace cada botón lo que dice que hace?
// Reutiliza el arranque falso de test_app.js (DOM/localStorage de mentira, sin navegador):
// carga un CSV de juguete, PULSA los botones de verdad (su onclick) y comprueba el efecto
// observable (cubos en localStorage, vistas abiertas/cerradas, portapapeles, window.open…).
//
//   node src/test_buttons.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { boot } = require("./test_app.js");

const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// ── CSV de juguete: mismas columnas que produce scrape.js ──
const FIELDS = require("./scrape.js").FIELDS; // el esquema de verdad, no una copia a mano
const row = (o) => FIELDS.map((f) => (f in o ? String(o[f]) : "")).join(",");
const CSV =
  [
    FIELDS.join(","),
    row({ id: "a1", titulo: "Ford Focus", precio: "1000", categoria: "Coches", ciudad: "Jaen", km: "3", dias: "1", reservado: "False", envio: "False", url: "https://w/a1", vendedor: "Ana", descripcion: "buen estado" }),
    row({ id: "a2", titulo: "Ford Fiesta", precio: "200", categoria: "Coches", ciudad: "Ubeda", km: "25", dias: "2", reservado: "False", envio: "False", url: "https://w/a2", vendedor: "Bea", descripcion: "con arreglos" }), // lejos y sin envío

    row({ id: "a3", titulo: "Ford Ka roto", precio: "50", categoria: "Coches", ciudad: "Jaen", km: "40", dias: "9", reservado: "False", envio: "True", url: "https://w/a3", vendedor: "Ana", descripcion: "para piezas" }),
  ].join("\r\n") + "\r\n";

// variante con un 4º anuncio del mismo vendedor: para el banner de "2+ rechazos" hace falta
// que a Ana le queden anuncios frescos después de rechazarle dos
const CSV_ANA =
  CSV +
  row({ id: "a4", titulo: "Ford Puma", precio: "800", categoria: "Coches", ciudad: "Jaen", km: "4", dias: "3", reservado: "False", envio: "False", url: "https://w/a4", vendedor: "Ana", descripcion: "impecable" }) +
  "\r\n";

// variante con una republicación: Ana vuelve a subir el Ford Focus con otro id, otro acento y
// otro espaciado. Es lo que hace un vendedor para subir en la lista, y el scraper no lo ve.
const CSV_DUP =
  CSV +
  row({ id: "a6", titulo: "Fórd  Focus", precio: "990", categoria: "Coches", ciudad: "Jaen", km: "3", dias: "0", reservado: "False", envio: "False", url: "https://w/a6", vendedor: "ana", descripcion: "rebajado" }) +
  "\r\n";

// variante con una segunda categoría: con una sola, "incluir" y "sin filtro" dan el mismo mazo
const CSV_CATS =
  CSV +
  row({ id: "a5", titulo: "Vespa 125", precio: "1500", categoria: "Motos", ciudad: "Jaen", km: "5", dias: "4", reservado: "False", envio: "False", url: "https://w/a5", vendedor: "Cris", descripcion: "poco uso" }) +
  "\r\n";

// variante para el banner de vendedores: dos vendedores con rechazos, uno con más que el otro,
// y a los dos les quedan frescos. Es lo que hace falta para ver el ORDEN de la sugerencia.
// La fila sin categoría es para el chip vacío.
// Ana: a1, a3, a4, a7 — Bea: a2, a5, a6. Rechazando 3 de Ana y 2 de Bea, a cada una le queda
// uno fresco y los dos recuentos son distintos.
const CSV_VEND =
  CSV_ANA +
  [
    row({ id: "a5", titulo: "Ford Mondeo", precio: "900", categoria: "Coches", ciudad: "Jaen", km: "2", dias: "5", reservado: "False", envio: "True", url: "https://w/a5", vendedor: "Bea", descripcion: "vendido ya" }),
    row({ id: "a6", titulo: "Ford Kuga", precio: "700", categoria: "", ciudad: "Jaen", km: "2", dias: "6", reservado: "False", envio: "True", url: "https://w/a6", vendedor: "Bea", descripcion: "sin categoria" }),
    row({ id: "a7", titulo: "Ford Galaxy", precio: "600", categoria: "Coches", ciudad: "Jaen", km: "2", dias: "7", reservado: "False", envio: "True", url: "https://w/a7", vendedor: "Ana", descripcion: "familiar" }),
  ].join("\r\n") + "\r\n";

let n = 0;
const fail = (m) => {
  throw new Error("FAIL: " + m);
};
const ok = (cond, m) => {
  n++;
  if (!cond) fail(m);
};
// lee/ejecuta dentro del sandbox: `let`/`const` de app.js no son propiedades del global
const ev = (b, code) => vm.runInContext(code, b.sandbox);
const flush = () => new Promise((r) => setImmediate(r));
const tick = (ms) => new Promise((r) => setTimeout(r, ms)); // espera a los setTimeout de la app
const bucket = (b, name) => JSON.parse(b.store["wp_" + name] || "{}")["ford.csv"] || [];
// todos los descendientes con esa clase: los botones que la app crea al vuelo (filas de la
// tabla, chips, banner de vendedores) no tienen id, se buscan por su clase como en el CSS
const byClass = (el, cls, out = []) => {
  for (const c of (el && el.children) || []) {
    if (String((c && c.className) || "").split(/\s+/).includes(cls)) out.push(c);
    byClass(c, cls, out);
  }
  return out;
};

// arranca la app y deja cargada la búsqueda "ford" (pasando por el botón Buscar de verdad)
async function loaded(opts = {}) {
  const store = opts.store || {};
  const b = await boot(store, Object.assign({ csv: CSV, timers: true }, opts));
  if (b.errs.length) fail("boot lanzó: " + (b.errs[0].message || b.errs[0]));
  b.q("#kw").value = "ford";
  await b.q("#scrape").click();
  await flush();
  return b;
}

async function main() {
  // ── 1. inventario: TODO <button id> del HTML acaba con un onclick cableado ──
  // Pilla el renombrado de un id (el botón queda mudo y nadie se entera hasta producción).
  {
    const ids = [...HTML.matchAll(/<button\b[^>]*?\bid="([^"]+)"/gs)].map((m) => m[1]);
    ok(ids.length >= 20, "el HTML debería tener ~21 botones con id, encontré " + ids.length);
    const b = await boot({});
    if (b.errs.length) fail("boot lanzó: " + (b.errs[0].message || b.errs[0]));
    // #undo se cablea dentro de snack() (solo existe cuando hay algo que deshacer)
    const mudos = ids.filter((id) => id !== "undo" && typeof b.q("#" + id).onclick !== "function");
    ok(!mudos.length, "botones sin onclick tras el boot: " + mudos.join(", "));
    ok(typeof b.q("#undo").onclick !== "function", "#undo no debería estar cableado sin snack");
    ev(b, 'snack("hecho", () => { window.__undone = 1 })');
    b.q("#undo").click();
    ok(b.sandbox.__undone === 1, "#undo no ejecutó la acción de deshacer del snack");
  }

  // ── 2. Buscar (#scrape) ──
  {
    const b = await boot({}, { csv: CSV });
    const calls = [];
    b.sandbox.Rebusca.scrape = async (o) => (calls.push(o), CSV);
    b.q("#kw").value = "   "; // vacío: no se busca nada
    await b.q("#scrape").click();
    ok(calls.length === 0, "#scrape buscó con el término vacío");
    b.q("#kw").value = "ford";
    b.q("#titleOnly").checked = true;
    b.q("#since").value = "semana";
    await b.q("#scrape").click();
    await flush();
    ok(calls.length === 1, "#scrape no llamó al scraper");
    ok(calls[0].keywords === "ford" && calls[0].since === "semana" && calls[0].titleOnly === true,
      "#scrape no pasó kw/since/titleOnly al scraper: " + JSON.stringify(calls[0]));
    ok(ev(b, "data.length") === 3, "#scrape no cargó el CSV en la tabla");
    ok((b.store.wp_searches || "").includes("ford--semana.csv"), "#scrape no guardó la búsqueda");
  }

  // ── 3. parar búsqueda (#stopScrape): aborta la señal que se le pasó al scraper ──
  {
    const b = await boot({}, { csv: CSV });
    let sig = null;
    b.sandbox.Rebusca.scrape = (o) => ((sig = o.signal), new Promise(() => {})); // no resuelve
    b.q("#kw").value = "ford";
    b.q("#scrape").click();
    await flush();
    ok(sig && !sig.aborted, "el scraper no recibió señal");
    b.q("#stopScrape").click();
    ok(sig.aborted, "#stopScrape no abortó la búsqueda");
  }

  // ── 3b. dos scrapes a la vez: gana el ÚLTIMO que pidió el usuario ──
  //     Antes los dos repintaban y ganaba el que acabase, que podía no ser el que pediste.
  //     Abortar no basta: scrape.js resuelve con el CSV parcial, así que el perdedor llegaba
  //     igual a loadCSV/cacheCsv/saveSearch.
  {
    const slow = CSV.replace(/Ford Focus/, "Lento");
    const b = await boot({}, {
      timers: true,
      scrape: async (o) => (await tick(o.keywords === "lento" ? 40 : 0), o.keywords === "lento" ? slow : CSV),
    });
    b.q("#kw").value = "lento";
    b.q("#scrape").click(); // sin await: se queda en vuelo
    await flush();
    b.q("#kw").value = "rapido";
    b.q("#scrape").click();
    await tick(80);
    ok(ev(b, "curCsv") === "rapido.csv", "el scrape perdedor repintó la tabla: " + ev(b, "curCsv"));
    ok(!(b.store.wp_searches || "").includes("lento"), "el scrape perdedor guardó su búsqueda");
    ok(b.q("#loading").hidden === true, "el perdedor dejó colgado el overlay del ganador");
    ok(b.q("#scrape").textContent === "Buscar",
      'el botón se quedó etiquetado "' + b.q("#scrape").textContent + '"');
  }

  // ── 4. copiar el prompt de entrada (#copyAskPrompt): al portapapeles, con lo tecleado ──
  {
    const b = await boot({});
    b.q("#kw").value = "teclado mecánico";
    await b.q("#copyAskPrompt").click();
    await flush();
    ok(b.spy.copied.length === 1, "#copyAskPrompt no copió nada");
    ok(b.spy.copied[0].includes("llms.txt"), "#copyAskPrompt copió algo que no es el prompt");
    ok(b.spy.copied[0].endsWith("teclado mecánico"), "#copyAskPrompt no metió la intención tecleada");
  }

  // ── 5. COPIAR PARA IA (#copyDeck): manda el mazo sin clasificar y deja el lote pendiente ──
  {
    const b = await loaded();
    ev(b, 'rejected.add("a2"); saveBuckets()'); // a2 ya clasificado: no debe ir
    await b.q("#copyDeck").click();
    await flush();
    ok(b.spy.copied.length === 1, "#copyDeck no copió nada");
    const t = b.spy.copied[0];
    ok(t.includes("a1") && t.includes("a3") && !t.includes("a2"),
      "#copyDeck copió los anuncios equivocados");
    ok(JSON.parse(b.store.wp_aisent || "{}").ids.join() === "a1,a3",
      "#copyDeck no dejó anotado el lote enviado (wp_aisent), sin él el ?keep= no sabe qué rechazar");
  }

  // ── 5b. el lote anotado es el que se copió, y lleva el cajón de cuando se pulsó ──
  // `?keep=` conserva los ids del enlace y RECHAZA el resto del lote anotado. Anotar de más
  // manda a la papelera anuncios que la IA no llegó a ver.
  {
    const muchos =
      [FIELDS.join(",")]
        .concat(
          Array.from({ length: 70 }, (_, i) =>
            row({ id: "m" + i, titulo: "Ford " + i, precio: "100", categoria: "Coches",
              ciudad: "Jaen", km: "1", dias: "1", reservado: "False", envio: "False",
              url: "https://w/m" + i, vendedor: "Ana", descripcion: "uno más" }),
          ),
        )
        .join("\r\n") + "\r\n";
    const b = await loaded({ csv: muchos });
    b.q("#copyDeck").click();
    ev(b, 'selectQueryUI("otra.csv")'); // el usuario cambia de búsqueda mientras se copia
    await flush();
    // y el texto lo dice: la IA tiene que saber que ve un tope, no el mazo entero
    ok(/60 anuncios de 70 sin clasificar/.test(b.spy.copied[0]),
      "el prompt no avisa de que solo van 60 de 70: " + b.spy.copied[0].slice(0, 300));
    const lote = JSON.parse(b.store.wp_aisent || "{}");
    ok(lote.ids.length === 60,
      "el lote anotado no es el copiado (tope UNSEEN_CAP): " + lote.ids.length + " ids");
    ok(lote.ids[59] === "m59" && !lote.ids.includes("m60"),
      "el lote anotado no son los primeros 60 del mazo: acaba en " + lote.ids[59]);
    ok(lote.csv === "ford.csv",
      "el lote quedó etiquetado con la búsqueda a la que se cambió, no con la de origen: " + lote.csv);
    // el veredicto puede llegar en otra sesión, sin CSV cargado: la ficha tiene que estar cacheada
    ok(ev(b, 'rowCache["m0"] && rowCache["m0"].titulo') === "Ford 0",
      "el lote enviado no dejó su ficha en rowCache: sin ella el ?keep= no encuentra las filas");
  }

  // ── 5bis. el viaje de ida y vuelta: los ids que salen en las fichas vuelven en el ?keep= ──
  // El texto copiado y el enlace de respuesta están atados por el formato "[#id]". Si la ficha
  // cambia de formato, la IA copia otra cosa y el veredicto aterriza en el vacío. Aquí se leen
  // los ids del texto de verdad, con la misma regla que el prompt le da a la IA, y se le devuelven.
  {
    const b = await loaded();
    b.q("#copyDeck").click();
    await flush();
    const texto = b.spy.copied[0];
    // "N. [#id] título — precio": el "[#...]" literal de las instrucciones no cuenta como ficha
    const ids = [...texto.matchAll(/^\d+\. \[#([^\]]+)\]/gm)].map((m) => m[1]);
    ok(ids.join() === "a1,a2,a3", "las fichas no llevan los ids del mazo en [#id]: " + ids.join());
    ok(ids.join() === JSON.parse(b.store.wp_aisent).ids.join(),
      "los ids del texto y los del lote anotado no son los mismos: " + ids + " vs " + b.store.wp_aisent);
    // la IA responde conservando el primero: el resto del lote se descarta
    b.sandbox.location.search = "?keep=" + ids[0];
    ev(b, "fromURL()");
    ok(bucket(b, "favorite").join() === "a1", "el ?keep= del texto copiado no dejó el favorito: " + bucket(b, "favorite"));
    ok(bucket(b, "rejected").join() === "a2,a3", "el resto del lote no se descartó: " + bucket(b, "rejected"));
  }

  // ── 5c. si la copia falla, el aviso lo dice, no se anota lote y el botón vuelve ──
  {
    const b = await loaded();
    b.sandbox.navigator.clipboard.writeText = () => Promise.reject(new Error("sin permiso"));
    const btn = b.q("#copyDeck");
    const antes = String(btn.textContent);
    btn.click();
    await flush();
    await flush();
    ok(String(b.q("#snackmsg").textContent).includes("No se pudo copiar"),
      "una copia fallida no avisa: " + b.q("#snackmsg").textContent);
    ok(!b.store.wp_aisent, "una copia fallida anotó lote igual: " + b.store.wp_aisent);
    ok(!btn.disabled && String(btn.textContent) === antes,
      "el botón se queda muerto en 'Preparando…' tras un fallo de copia: " + btn.textContent);
  }

  // ── 6. copiar favoritos (#copyFav / #exportFav): sin favoritos avisa y no copia ──
  {
    const b = await loaded();
    await b.q("#copyFav").click();
    await flush();
    ok(b.spy.copied.length === 0, "#copyFav copió sin haber favoritos");
    ok(String(b.q("#snackmsg").textContent).includes("favoritos"), "#copyFav no avisó de que no hay favoritos");
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await b.q("#copyFav").click();
    await flush();
    ok(b.spy.copied.length === 1 && b.spy.copied[0].includes("a1"), "#copyFav no copió el favorito");
    await b.q("#exportFav").click();
    await flush();
    ok(b.spy.copied.length === 2 && b.spy.copied[1].includes("a1"), "#exportFav no copió el favorito");
  }

  // ── 7. dossier PDF (#dossierFav): imprime y cuenta como lote enviado ──
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await b.q("#dossierFav").click();
    await flush();
    await flush();
    ok(b.spy.printed === 1, "#dossierFav no abrió el diálogo de impresión");
    ok((b.store.wp_aisent || "").includes("a1"), "#dossierFav no anotó el lote (wp_aisent)");
  }

  // ── 8. FAB (#swipeFab): abre el mazo; #swipeX lo cierra ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    ok(b.q("#swipeView").hidden === false, "#swipeFab no abrió el mazo");
    ok(ev(b, "deck.length") === 3, "#swipeFab abrió el mazo sin cartas");
    b.q("#swipeX").click();
    ok(b.q("#swipeView").hidden === true, "#swipeX no cerró el mazo");
  }

  // ── 9. ✓ / ✕ del mazo (#swYes / #swNo) y deshacer (#swUndo) ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    const primera = ev(b, "key(deck[0])");
    b.q("#swYes").click();
    ok(bucket(b, "favorite").includes(primera), "#swYes no mandó la carta a favoritos");
    await tick(300); // la carta vuela y entra la siguiente
    ok(ev(b, "di") === 1, "#swYes no avanzó a la carta siguiente");
    ok(b.q("#swUndo").disabled === false, "#swUndo sigue deshabilitado tras clasificar");
    b.q("#swUndo").click();
    ok(!bucket(b, "favorite").includes(primera), "#swUndo no sacó la carta de favoritos");
    ok(ev(b, "di") === 0, "#swUndo no volvió a la carta deshecha");
    b.q("#swNo").click();
    ok(bucket(b, "rejected").includes(primera), "#swNo no mandó la carta a la papelera");
    ok(!bucket(b, "favorite").includes(primera), "una carta no puede estar en los dos cubos");
  }

  // ── 9c. el escenario del mazo no acumula tarjetas ──
  // `nextCard()` quita las tarjetas viejas antes de montar la siguiente. Era código inalcanzable:
  // el arnés devolvía [] a `swipeStage.querySelectorAll(...)`, así que borrar esa limpieza dejaba
  // las siete suites en verde. En el móvil, una sesión larga apila una tarjeta con su foto por
  // cada anuncio clasificado y el swipe se atasca.
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    const cartas = () => ev(b, 'swipeStage.querySelectorAll(".swipe-card, .swipe-done").length');
    ok(cartas() === 1, "el mazo abrió con " + cartas() + " tarjetas en el escenario, no 1");
    b.q("#swNo").click();
    await tick(300);
    b.q("#swNo").click();
    await tick(300);
    ok(cartas() === 1, "tras dos clasificaciones el escenario tiene " + cartas() + " tarjetas");
    ev(b, "di = deck.length; nextCard()");
    ok(cartas() === 1, "con el mazo agotado el escenario tiene " + cartas() + " nodos, no solo el «✓ Has rebuscado todo»");
  }

  // ── 9b. el hueco de 200ms entre carta y carta, y el mazo agotado ──
  // La carta vuela 200ms. Durante ese vuelo `card` es null y ✓/✕ no hacen nada. Antes seguían
  // encendidos: el segundo toque de un doble-toque se perdía en silencio (síntoma nº1 reportado).
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    b.q("#swNo").click();
    ok(b.q("#swNo").disabled === true && b.q("#swYes").disabled === true,
      "✓/✕ siguen encendidos mientras la carta vuela");
    const antes = ev(b, "di");
    b.q("#swNo").click(); // el toque perdido de un doble-toque
    ok(ev(b, "di") === antes && bucket(b, "rejected").length === 1,
      "un toque en el hueco de 200ms clasificó de más");
    await tick(300);
    ok(b.q("#swNo").disabled === false, "✓/✕ no se reactivaron con la carta siguiente");

    // carrera: el mazo se reconstruye mientras la carta vuela
    b.q("#swNo").click();
    ev(b, "rebuildDeck()"); // deja di = 0 sobre un mazo nuevo
    await tick(300);
    ok(ev(b, "di") === 0, "el setTimeout del fling viejo avanzó sobre el mazo reconstruido");

    // mazo agotado: no hay carta a la que decir sí o no
    ev(b, "di = deck.length; nextCard()");
    ok(b.q("#swNo").disabled === true && b.q("#swYes").disabled === true,
      "✓/✕ siguen encendidos con el mazo agotado");
  }

  // ── 9c. un "Deshacer" pendiente no puede aplicarse a otro cajón ──
  // Los 6 sitios que ofrecen deshacer cierran sobre `rejected`/`favorite` POR NOMBRE, y
  // pointBuckets() las reapunta al cambiar de búsqueda. Sin invalidar el snack, el botón
  // seguía vivo 5s y operaba sobre el cajón equivocado.
  {
    const b = await loaded();
    ev(b, 'reject("a1", "Ford Focus")');
    ok(typeof b.q("#undo").onclick === "function", "reject() no ofreció deshacer");
    ev(b, 'selectQueryUI("motos.csv")');
    ok(b.q("#undo").onclick === null, "el Deshacer de otra búsqueda sigue armado tras cambiar de cajón");
    ok(bucket(b, "rejected").includes("a1"), "el rechazo de ford se perdió al cambiar de cajón");
  }

  // ── 9d. el lote copiado para la IA conserva SU búsqueda de origen ──
  // #copyDeck es asíncrono (espera al portapapeles). setAisent() leía curDrawer() al resolver,
  // así que cambiar de búsqueda mientras tanto etiquetaba el lote con la búsqueda equivocada y
  // su ?keep= aterrizaba en el cajón que no era.
  {
    const b = await loaded();
    b.q("#copyDeck").click();
    ev(b, 'selectQueryUI("motos.csv")'); // el usuario cambia de búsqueda antes de que resuelva
    await flush();
    const sent = JSON.parse(b.store.wp_aisent || "{}");
    ok(sent.csv === "ford.csv", "el lote copiado se etiquetó con la búsqueda equivocada: " + sent.csv);
  }

  // ── 10. ver (#swVer) y copiar (#swCopy) la carta actual ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    b.q("#swVer").click();
    ok(b.spy.opened[0] === ev(b, 'col(deck[di], "url")'), "#swVer no abrió el anuncio de la carta");
    b.q("#swCopy").click();
    await flush();
    ok(b.spy.copied.length === 1 && b.spy.copied[0].includes(ev(b, 'col(deck[di], "titulo")')),
      "#swCopy no copió la ficha de la carta");
  }

  // ── 11. engranaje del mazo (#swipeCog): abre y cierra el menú ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    ok(b.q("#swipeMenu").hidden === true, "el menú del mazo debería arrancar cerrado");
    b.q("#swipeCog").click();
    ok(b.q("#swipeMenu").hidden === false, "#swipeCog no abrió el menú");
    b.q("#swipeCog").click();
    ok(b.q("#swipeMenu").hidden === true, "#swipeCog no cerró el menú");
  }

  // ── 12. excluir palabra: Enter en #exclAdd veta el término (y en #swExclAdd re-baraja) ──
  {
    const b = await loaded();
    b.q("#exclAdd").dispatch("keydown", { key: "Enter", target: { value: "roto" } });
    ok(bucket(b, "excl").includes("roto"), "#exclAdd no guardó la palabra vetada");
    ok(ev(b, "deckRows().length") === 2, "#exclAdd no sacó del mazo el anuncio con la palabra vetada");
    b.q("#swipeFab").click();
    b.q("#swExclAdd").dispatch("keydown", { key: "Enter", target: { value: "fiesta" } });
    ok(bucket(b, "excl").join() === "roto,fiesta", "#swExclAdd no guardó la palabra vetada");
    ok(ev(b, "deck.length") === 1, "#swExclAdd no re-barajó el mazo tras vetar");
  }

  // ── 13. papelera: ver rechazados (#toggleTrash), vaciar (#rejectedEmpty), restaurar selección ──
  {
    const b = await loaded();
    ev(b, 'rejected.add("a1"); rejected.add("a2"); saveBuckets(); render()');
    b.q("#toggleTrash").click();
    ok(ev(b, "view") === "rejected", "#toggleTrash no abrió la papelera");
    // seleccionar todo + restaurar la selección
    b.q("#rejectedSelAll").dispatch("change", { target: { checked: true } });
    ok(ev(b, "rejectedSel.size") === 2, "#rejectedSelAll no seleccionó los rechazados visibles");
    b.q("#rejectedRestoreSel").click();
    ok(bucket(b, "rejected").length === 0, "#rejectedRestoreSel no restauró los seleccionados");
    // vaciar papelera: con confirm en "no" no toca nada
    ev(b, 'rejected.add("a1"); saveBuckets(); render()');
    const no = await loaded({ store: JSON.parse(JSON.stringify(b.store)), confirm: false });
    no.q("#toggleTrash").click();
    no.q("#rejectedEmpty").click();
    ok(bucket(no, "rejected").length === 1, "#rejectedEmpty vació la papelera pese a cancelar el confirm");
    b.q("#rejectedEmpty").click();
    ok(bucket(b, "rejected").length === 0, "#rejectedEmpty no vació la papelera");
    b.q("#toggleTrash").click();
    ok(ev(b, "view") === "", "#toggleTrash no volvió a la vista normal");
  }

  // ── 14. favoritos: #toggleFavorite abre la lista y #listBack vuelve ──
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets(); render()');
    b.q("#toggleFavorite").click();
    ok(ev(b, "view") === "favorite", "#toggleFavorite no abrió los favoritos");
    b.q("#listBack").click();
    ok(ev(b, "view") === "", "#listBack no volvió de la lista");
  }

  // ── 15. gestor de búsquedas: #manageSearches abre, #searchesX cierra ──
  {
    const b = await loaded();
    ok(b.q("#searchesView").hidden === true, "el gestor debería arrancar cerrado");
    b.q("#manageSearches").click();
    ok(b.q("#searchesView").hidden === false, "#manageSearches no abrió el gestor");
    b.q("#searchesX").click();
    ok(b.q("#searchesView").hidden === true, "#searchesX no cerró el gestor");
  }

  // ── 16. refrescar (#refreshSearch): re-scrapea la búsqueda activa, no otra ──
  {
    const b = await loaded();
    const calls = [];
    b.sandbox.Rebusca.scrape = async (o) => (calls.push(o), CSV);
    b.q("#refreshSearch").click();
    await flush();
    ok(calls.length === 1 && calls[0].keywords === "ford",
      "#refreshSearch no relanzó la búsqueda activa: " + JSON.stringify(calls));
  }

  // ── 17. ordenar el mazo (#swipeSort) y la lista (#listSort): reclic invierte ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    const btns = ev(b, 'document.querySelectorAll("#swipeSort button")');
    const precio = btns.find((x) => x.dataset.sort === "precio");
    precio.click();
    ok(ev(b, 'deck.map((r) => col(r, "precio")).join()') === "50,200,1000",
      "#swipeSort precio no ordenó el mazo de más barato a más caro");
    precio.click();
    ok(ev(b, 'deck.map((r) => col(r, "precio")).join()') === "1000,200,50",
      "el segundo clic en #swipeSort precio no invirtió el orden");
    b.q("#swipeX").click();
    ev(b, 'favorite.add("a1"); favorite.add("a3"); saveBuckets(); view = "favorite"; render()');
    const lb = ev(b, 'document.querySelectorAll("#listSort button")').find((x) => x.dataset.sort === "precio");
    lb.click();
    ok(ev(b, 'filteredRows().map((r) => col(r, "precio")).join()') === "50,1000",
      "#listSort precio no ordenó la lista de favoritos");
    // el orden se elige una vez y se quiere para siempre: otra sesión con el mismo almacén lo mantiene
    ok(b.store.wp_listsort === "precio|1", "el orden de la lista no se guardó: " + b.store.wp_listsort);
    const b2 = await loaded({ store: b.store });
    ev(b2, 'view = "favorite"; render()');
    ok(ev(b2, 'filteredRows().map((r) => col(r, "precio")).join()') === "50,1000",
      "al recargar, la lista volvió al orden de entrada");
    const on = ev(b2, 'document.querySelectorAll("#listSort button")').find((x) => x.dataset.sort === "precio");
    ok(on.classList.contains("on") && on.dataset.dir === "▲",
      "la barra de orden no marca el botón recordado: " + on.dataset.dir);
  }

  // ── 18. topes del cajón (#lim_precio): filtran el mazo y quedan guardados ──
  {
    const b = await loaded();
    b.q("#lim_precio").dispatch("change", { target: { value: "300" } });
    ok(JSON.parse(b.store.wp_lim || "{}")["ford.csv"].precio === 300, "#lim_precio no guardó el tope");
    ok(ev(b, "deckRows().length") === 2, "#lim_precio no sacó del mazo lo que pasa del tope");
    b.q("#lim_precio").dispatch("change", { target: { value: "" } }); // vacío = sin tope
    ok(!b.store.wp_lim.includes("precio"), "#lim_precio no quitó el tope al vaciarlo");
    ok(ev(b, "deckRows().length") === 3, "#lim_precio dejó el mazo filtrado tras quitar el tope");
    ok(b.store.wp_lim === "{}",
      "quitar el último tope deja el cajón vacío en el almacén: " + b.store.wp_lim);
  }

  // ── 18b. el input del tope muestra el del cajón que se está viendo ──
  // Los topes se guardan por cajón; el input es uno solo para todas las búsquedas. Si no se
  // repinta, el número que se lee y el filtro que se aplica dejan de ser el mismo.
  {
    const b = await loaded();
    b.q("#lim_precio").dispatch("change", { target: { value: "300" } });
    ev(b, 'selectQueryUI("otra.csv"); render()'); // cambiar de búsqueda sin re-scrapear
    ok(b.q("#lim_precio").value === "",
      "el tope del cajón anterior sigue en pantalla en la búsqueda nueva: " + b.q("#lim_precio").value);
    ev(b, 'selectQueryUI("ford.csv"); render()');
    ok(String(b.q("#lim_precio").value) === "300",
      "al volver al cajón con tope el input no lo muestra: " + b.q("#lim_precio").value);
  }

  // ── 19. ajustes (⚙): excluir lejos sin envío + umbral de km ──
  {
    const b = await loaded();
    b.q("#autoExclLejos").checked = true;
    b.q("#autoExclLejos").dispatch("change");
    ok(b.store.wp_autoexcllejos === "1", "#autoExclLejos no guardó el ajuste");
    ok(ev(b, "deckRows().length") === 2, "#autoExclLejos no sacó del mazo el lejos-sin-envío");
    b.q("#lejosKm").value = "50"; // con el listón a 50 km ya no hay nada lejos
    b.q("#lejosKm").dispatch("change");
    ok(b.store.wp_lejoskm === "50", "#lejosKm no guardó el umbral");
    ok(ev(b, "deckRows().length") === 3, "#lejosKm no recalculó qué está lejos");
  }

  // ── 20. atajos de la barra de stats: rechazar los lejos y los excluidos ──
  {
    const b = await loaded();
    b.q("#rejectedLejos").click();
    ok(bucket(b, "rejected").join() === "a2", "#rejectedLejos no mandó a la papelera el lejos-sin-envío");
    b.q("#undo").click(); // el snack ofrece deshacer: debe devolverlo al mazo
    ok(bucket(b, "rejected").length === 0, "deshacer no sacó de la papelera lo que rechazó #rejectedLejos");
    b.q("#exclAdd").dispatch("keydown", { key: "Enter", target: { value: "roto" } });
    // el desglose: un número solo no dice qué filtro te quitó qué
    ok(/<b>1<\/b> excluidos por palabra o categoría/.test(b.q("#stat").innerHTML),
      "el contador no dice que el veto fue por palabra: " + b.q("#stat").innerHTML);
    b.q("#lim_precio").dispatch("change", { target: { value: "300" } }); // a1 (1000 €) cae por tope
    ok(/<b>2<\/b> excluidos ·/.test(b.q("#stat").innerHTML) &&
      /<b>1<\/b> por palabra o categoría, 1 por tope/.test(b.q("#stat").innerHTML),
      "con dos motivos el contador no los separa: " + b.q("#stat").innerHTML);
    b.q("#lim_precio").dispatch("change", { target: { value: "" } }); // sin tope: vuelve a un motivo
    ok(/<b>1<\/b> excluidos por palabra o categoría/.test(b.q("#stat").innerHTML),
      "al quitar el tope el contador no vuelve a un motivo: " + b.q("#stat").innerHTML);
    b.q("#rejectedExcl").click();
    ok(bucket(b, "rejected").join() === "a3", "#rejectedExcl no mandó a la papelera lo vetado");
  }

  // ── 20b. una fila ya rechazada no se cuenta también como vetada ──
  // "sin ver" se calcula restando: una fila contada dos veces lo baja de lo real, y con
  // bastantes filas rechazadas y vetadas a la vez sale un "sin ver" negativo.
  {
    const b = await loaded();
    b.q("#exclAdd").dispatch("keydown", { key: "Enter", target: { value: "roto" } }); // veta a3
    const stat = () => String(b.q("#stat").innerHTML);
    ok(/<b>1<\/b> excluidos/.test(stat()), "vetar 'roto' no contó el anuncio: " + stat());
    ok(/<b>2<\/b> sin ver/.test(stat()), "el vetado sigue contando como sin ver: " + stat());
    ev(b, 'reject("a3", "Ford Ka roto")'); // ahora está en un cubo Y vetado
    ok(!/excluidos/.test(stat()), "el rechazado se sigue contando como vetado: " + stat());
    ok(/<b>2<\/b> sin ver/.test(stat()), "el rechazado se descontó dos veces del sin ver: " + stat());
    ok(/<b>1<\/b> rechazados/.test(stat()), "el rechazado no aparece en su propia línea: " + stat());
    // y el desglose por motivo cuenta lo mismo: a1 pasa del tope pero ya está rechazado, así que
    // el único veto vivo es el de la palabra. Si el desglose cuenta a1, la línea miente el motivo.
    ev(b, 'reject("a1", "Ford Focus"); restore("a3")');
    b.q("#lim_precio").dispatch("change", { target: { value: "300" } });
    ok(/<b>1<\/b> excluidos por palabra o categoría/.test(stat()),
      "el desglose cuenta como tope un anuncio ya rechazado: " + stat());
  }

  // ── 21. gestor de búsquedas: los 5 botones de cada tarjeta ──
  {
    const b = await loaded({ prompt: "Mi coche" });
    const calls = [];
    b.sandbox.Rebusca.scrape = async (o) => (calls.push(o), CSV);
    b.q("#manageSearches").click();
    const card = () => b.q("#searchesList").children[0];
    ok(card(), "el gestor no pintó la búsqueda guardada");
    // el badge no promete una cifra: unseenCount() no aplica exclusiones ni topes, así que el
    // número era mayor que el mazo real ("12 sin ver" y dentro no había nada)
    const badge = /<b class="sc-new">([^<]*)<\/b>/.exec(String(card().innerHTML));
    ok(badge, 'el gestor no pintó el badge "sin ver"');
    ok(!/\d/.test(badge[1]), 'el badge "sin ver" volvió a prometer una cifra: ' + badge[1]);
    card().querySelector(".sc-ren").click(); // Renombrar: apodo local, no toca lo que se busca
    ok(JSON.parse(b.store.wp_alias || "{}")["ford.csv"] === "Mi coche", ".sc-ren no guardó el apodo");
    ok((b.store.wp_searches || "").includes("ford.csv"), ".sc-ren tocó la búsqueda, no solo el apodo");
    // Enlace: la app parsea ocho parámetros de URL y no construía ninguno
    card().querySelector(".sc-link").click();
    await flush();
    ok(b.spy.copied.at(-1) === "https://rebusca.dibogomez.com/?q=ford",
      "el enlace copiado no reproduce la búsqueda: " + b.spy.copied.at(-1));
    ok(/Enlace copiado/.test(b.q("#snackmsg").textContent), "copiar el enlace no avisa al usuario");
    card().querySelector(".sc-run").click(); // Repetir: re-scrapea y cierra el gestor
    await flush();
    ok(calls.length === 1 && calls[0].keywords === "ford", ".sc-run no relanzó la búsqueda");
    ok(b.q("#searchesView").hidden === true, ".sc-run no cerró el gestor");
    b.q("#manageSearches").click();
    card().querySelector(".sc-pick").click(); // Seleccionar: carga sin re-scrapear
    await flush();
    ok(calls.length === 1, ".sc-pick re-scrapeó en vez de cargar lo guardado");
    ok(b.q("#searchesView").hidden === true, ".sc-pick no cerró el gestor");
    b.q("#manageSearches").click();
    card().querySelector(".sc-del").click(); // Borrar (confirm en "sí")
    ok(!(b.store.wp_searches || "").includes("ford.csv"), ".sc-del no borró la búsqueda");
  }

  // ── 22. filtros de texto: lista (#listFilter) y gestor (#searchesFilter) ──
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); favorite.add("a2"); saveBuckets(); view = "favorite"; render()');
    b.q("#listFilter").dispatch("input", { target: { value: "fiesta" } });
    ok(ev(b, "filteredRows().length") === 1, "#listFilter no filtró la lista por título");
    b.q("#listFilter").dispatch("input", { target: { value: "" } });
    ok(ev(b, "filteredRows().length") === 2, "#listFilter no restauró la lista al vaciarse");
    b.q("#manageSearches").click();
    b.q("#searchesFilter").dispatch("input", { target: { value: "zzz" } });
    ok(!b.q("#searchesList").children.length, "#searchesFilter no filtró el gestor");
    b.q("#searchesFilter").dispatch("input", { target: { value: "ford" } });
    ok(b.q("#searchesList").children.length === 1, "#searchesFilter no restauró el gestor");
  }

  // ── 23. botones de cada fila de la lista: Quitar (favoritos) y Restaurar (papelera) ──
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets(); view = "favorite"; render()');
    const quitar = byClass(b.q("tbody"), "quitar");
    ok(quitar.length === 1 && String(quitar[0].textContent) === "Quitar",
      "la fila de favoritos no pintó su botón Quitar");
    // el rojo de reposo (app.css) lo lleva el botón que destruye, no el que restaura
    ok(!String(quitar[0].className).includes("restaura"),
      "el botón que destruye salió con la pinta neutra de Restaurar: " + quitar[0].className);
    quitar[0].click();
    ok(!bucket(b, "favorite").includes("a1"), "'Quitar' no sacó el anuncio de favoritos");
    ok(bucket(b, "rejected").includes("a1"), "'Quitar' desde favoritos debería rechazar el anuncio");
    ev(b, 'view = "rejected"; render()');
    const restaurar = byClass(b.q("tbody"), "quitar");
    ok(String(restaurar[0].textContent) === "Restaurar", "en la papelera el botón debería decir Restaurar");
    ok(String(restaurar[0].className).includes("restaura"),
      "Restaurar salió con el rojo del botón que destruye: " + restaurar[0].className);
    restaurar[0].click();
    ok(bucket(b, "rejected").length === 0, "'Restaurar' no sacó el anuncio de la papelera");
  }

  // ── 24. chips de palabras vetadas (#exclChips): un clic quita el veto ──
  {
    const b = await loaded();
    b.q("#exclAdd").dispatch("keydown", { key: "Enter", target: { value: "roto" } });
    const chips = b.q("#exclChips").children;
    ok(chips.length === 1, "#exclChips no pintó la palabra vetada");
    chips[0].click();
    ok(bucket(b, "excl").length === 0, "el chip no quitó el veto al pulsarlo");
    ok(ev(b, "deckRows().length") === 3, "quitar el veto no devolvió el anuncio al mazo");
  }

  // ── 25. categorías: chip veta, #catMode alterna incluir/excluir, #catClear limpia ──
  {
    const b = await loaded();
    const chip = b.q("#catChips").children[0];
    ok(chip && String(chip.textContent).startsWith("Coches"), "#catChips no pintó la categoría");
    chip.click();
    ok(JSON.parse(b.store.wp_catexcl || "{}")["ford.csv"].join() === "Coches",
      "el chip de categoría no vetó la categoría");
    ok(ev(b, "deckRows().length") === 0, "vetar la categoría no vació el mazo");
    b.q("#catChips").children[0].click(); // segundo clic: desmarca (los chips se repintan en cada render)
    ok(!(b.store.wp_catexcl || "").includes("Coches"), "el segundo clic en el chip no desmarcó la categoría");
    ok(ev(b, "deckRows().length") === 3, "desmarcar la categoría no devolvió los anuncios al mazo");
    b.q("#catChips").children[0].click();
    b.q("#catMode").click(); // modo incluir: lo marcado es lo ÚNICO que se conserva
    ok(JSON.parse(b.store.wp_catmode || "{}")["ford.csv"] === "incluir", "#catMode no cambió de modo");
    ok(ev(b, "deckRows().length") === 3, "en modo incluir la categoría marcada debería ser la que se queda");
    b.q("#catMode").click(); // y vuelta a excluir
    ok(!JSON.parse(b.store.wp_catmode || "{}")["ford.csv"], "#catMode no volvió a modo excluir");
    ok(ev(b, "deckRows().length") === 0, "volver a modo excluir no volvió a vetar la categoría");
    b.q("#catClear").click();
    ok(!(b.store.wp_catexcl || "").includes("Coches"), "#catClear no limpió las categorías marcadas");
  }

  // ── 25b. con DOS categorías el modo incluir se distingue de "no filtrar" ──
  // Con una sola categoría en el CSV, "incluir Coches" y "sin filtro" dejan el mismo mazo:
  // el test de arriba pasaría igual aunque el modo incluir no hiciera nada.
  {
    const b = await loaded({ csv: CSV_CATS });
    const chip = (nombre) =>
      b.q("#catChips").children.find((c) => String(c.textContent).startsWith(nombre));
    ok(ev(b, "deckRows().length") === 4, "el mazo de dos categorías no salió entero");
    ok(chip("Motos") && chip("Coches"), "#catChips no pintó las dos categorías");

    chip("Motos").click(); // modo excluir: fuera las motos
    ok(ev(b, "deckRows().length") === 3, "vetar Motos no quitó la moto del mazo");
    b.q("#catMode").click(); // modo incluir: lo marcado es lo ÚNICO que se queda
    ok(ev(b, "deckRows().length") === 1, "en modo incluir debería quedar solo la moto");
    ok(ev(b, 'col(deckRows()[0], "categoria")') === "Motos", "en modo incluir quedó la categoría equivocada");
  }

  // ── 26. banner de vendedores del mazo: "Rechazar siguientes" bloquea al vendedor ──
  {
    const b = await loaded({ csv: CSV_ANA });
    ev(b, 'rejected.add("a1"); rejected.add("a3"); saveBuckets(); render()');
    b.q("#swipeFab").click();
    const bloquear = byClass(b.q("#sellerBanner"), "sb-block");
    ok(bloquear.length === 1, "el banner no ofreció bloquear al vendedor con 2+ rechazos");
    bloquear[0].click();
    ok((b.store.wp_blocksel || "").includes("Ana"), "'Rechazar siguientes' no bloqueó al vendedor");
    ok(bucket(b, "rejected").includes("a4"), "'Rechazar siguientes' no mandó a la papelera lo que le quedaba");
  }

  // ── 27. combobox de búsquedas (#pick): la fila carga esa búsqueda sin re-scrapear ──
  {
    const b = await loaded();
    const calls = [];
    b.sandbox.Rebusca.scrape = async (o) => (calls.push(o), CSV);
    ev(b, 'curCsv = null; renderQlist("")');
    const filas = b.q("#qlist").children;
    ok(filas.length === 1, "#qlist no listó la búsqueda guardada");
    filas[0].click();
    await flush();
    ok(ev(b, "curCsv") === "ford.csv", "la fila del combobox no seleccionó la búsqueda");
    ok(calls.length === 0, "la fila del combobox re-scrapeó en vez de cargar lo guardado");
  }

  // ── 28. botón atrás del móvil: cierra la capa abierta en vez de salir de la página ──
  // Es la única superficie que no tiene botón propio: si se rompe, el usuario sale de la app.
  {
    const b = await loaded();
    const pop = () => b.sandbox.history.back(); // el atrás del móvil: retrocede Y dispara popstate
    ok(b.hist.length === 0, "sin nada abierto no debería haber entrada de historial");

    b.q("#manageSearches").click();
    ok(b.q("#searchesView").hidden === false, "#manageSearches no abrió el gestor");
    ok(b.hist.length === 1, "abrir el gestor no armó la entrada sintética de historial");
    pop();
    ok(b.q("#searchesView").hidden === true, "el botón atrás no cerró el gestor");

    // cerrar por UI retira la entrada: si no, hace falta pulsar atrás dos veces para salir
    b.q("#manageSearches").click();
    ok(b.hist.length === 1, "reabrir el gestor no volvió a armar el historial");
    b.q("#searchesX").click();
    ok(b.hist.length === 0, "cerrar por UI dejó la entrada sintética colgando");

    // el atrás con nada abierto NO puede cerrar nada (deja salir de la página)
    pop();
    ok(b.q("#searchesView").hidden === true, "un atrás de más reabrió algo");
  }

  // ── 29. clic fuera del menú del engranaje: lo cierra; dentro, no ──
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    b.q("#swipeCog").click();
    ok(b.q("#swipeMenu").hidden === false, "#swipeCog no abrió el menú");
    b.fireDoc("click", { target: b.q("#swipeMenu") });
    ok(b.q("#swipeMenu").hidden === false, "un clic DENTRO del menú lo cerró");
    b.fireDoc("click", { target: b.q("#kw") });
    ok(b.q("#swipeMenu").hidden === true, "un clic fuera no cerró el menú del engranaje");
  }

  // ── 30. a11y: los <span class="link"> hacen de botón, así que Enter y espacio los pulsan ──
  {
    const b = await loaded();
    const link = b.q("#toggleTrash"); // "ver rechazados" es uno de esos spans
    link.className = "link";
    let pulsado = 0;
    link.onclick = () => pulsado++;
    b.fireDoc("keydown", { target: link, key: "Enter" });
    b.fireDoc("keydown", { target: link, key: " " });
    ok(pulsado === 2, "Enter/espacio sobre un .link no lo pulsaron: " + pulsado);
    link.className = "";
    b.fireDoc("keydown", { target: link, key: "Enter" });
    ok(pulsado === 2, "Enter pulsó algo que ya no es un .link");
  }

  // ── 31. la búsqueda falla (Wallapop caído, sin red): avisa y deja la app usable ──
  // Todos los demás tests le dan a Rebusca.scrape un CSV bueno, así que el camino de error
  // (avisar + soltar el botón + quitar el overlay) no lo recorría ninguno.
  {
    const b = await boot({}, { timers: true, scrape: async () => { throw new Error("boom"); } });
    ok(b.errs.length === 0, "boot lanzó: " + (b.errs[0] && (b.errs[0].message || b.errs[0])));
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ok(b.q("#scrape").disabled === false, "el botón Buscar se quedó bloqueado tras el fallo");
    ok(b.q("#scrape").textContent === "Buscar", "el botón se quedó en 'Buscando…'");
    ok(/No se pudo buscar/.test(b.q("#snackmsg").textContent), "el fallo no avisó: " + b.q("#snackmsg").textContent);
    ok(b.q("#loading").hidden === true, "el overlay de carga se quedó puesto (#stopScrape vive dentro)");
    ok(ev(b, "scrapeCtrl") === null, "el AbortController de la búsqueda caída no se soltó");
    // y la app sigue usable: el intento siguiente carga
    b.sandbox.Rebusca.scrape = async () => CSV;
    await b.q("#scrape").click();
    await flush();
    ok(ev(b, "data.length") === 3, "tras un fallo, la búsqueda siguiente no cargó");

    // parar la búsqueda a mano NO es un fallo: no debe salir el aviso rojo
    const b2 = await boot({}, { timers: true, scrape: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } });
    b2.q("#kw").value = "ford";
    await b2.q("#scrape").click();
    await flush();
    ok(b2.q("#snackmsg").textContent === "", "parar la búsqueda sacó un aviso de error");
    ok(b2.q("#scrape").disabled === false, "tras parar, el botón Buscar se quedó bloqueado");
  }

  // ── 31b. un resultado PARCIAL no se cachea ni se da por bueno ──
  // scrape() resuelve con lo que haya recogido aunque una rama OR se caiga (403 de DataDome) o
  // aunque el usuario pare. Se cacheaba igual, así que reabrir esa búsqueda servía el recorte
  // desde cache y no volvía a scrapear nunca: los anuncios que faltaban se perdían para siempre.
  {
    const b = await boot({}, { timers: true, scrape: async () => CSV });
    b.sandbox.Rebusca.lastScrape = { ramas: 2, ramasRotas: 1, sinId: 0, abortado: false, parcial: true };
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ok(ev(b, "data.length") === 3, "el resultado parcial ni se pintó");
    ok(!ev(b, 'csvIndex["ford.csv"]'), "un resultado parcial se guardó en cache como definitivo");
    ok(/incompleto/i.test(b.q("#snackmsg").textContent), "no avisó de que el resultado es parcial: " + b.q("#snackmsg").textContent);
    // el completo sí se cachea: el aviso no puede costar el cache de una búsqueda buena
    b.sandbox.Rebusca.lastScrape = { ramas: 1, ramasRotas: 0, sinId: 0, abortado: false, parcial: false };
    await b.q("#scrape").click();
    await flush();
    ok(!!ev(b, 'csvIndex["ford.csv"]'), "un resultado completo no se guardó en cache");

    // Un corte por no avanzar SÍ se cachea, y aun así se avisa. Los otros motivos son transitorios
    // —un 403, una rama caída, el botón parar—: re-scrapear puede traer más. Este es determinista:
    // la rama dio 30 páginas seguidas sin una fila nueva y volverá a darlas. Negarle el cache no
    // gana un anuncio y cuesta un scrape entero por apertura (medido: 210 páginas frente a 70).
    const b3 = await boot({}, { timers: true, scrape: async () => CSV });
    b3.sandbox.Rebusca.lastScrape = { ramas: 2, ramasRotas: 0, ramasSecas: 1, sinId: 0, abortado: false, parcial: false };
    b3.q("#kw").value = "ford";
    await b3.q("#scrape").click();
    await flush();
    ok(!!ev(b3, 'csvIndex["ford.csv"]'), "un recorte por no avanzar no se cacheó: se re-scrapea entero en cada apertura");
    ok(/dejaron de traer/i.test(b3.q("#snackmsg").textContent),
      "no avisó de que una rama se cerró sola: " + b3.q("#snackmsg").textContent);

    // El cache no caduca (`loadQuery`), así que cachear el vacío lo deja vacío para siempre. Una
    // API que responde 200 con páginas vacías —un bloqueo silencioso, sin 403 que lo delate— da
    // cero filas sin marcar nada, y esa búsqueda se quedaría a cero aunque tenga miles de anuncios.
    const b4 = await boot({}, { timers: true, scrape: async () => CSV.split("\n")[0] + "\n" });
    b4.sandbox.Rebusca.lastScrape = { ramas: 1, ramasRotas: 0, sinId: 0, abortado: false, parcial: false };
    b4.q("#kw").value = "ford";
    await b4.q("#scrape").click();
    await flush();
    ok(ev(b4, "data.length") === 0, "el CSV vacío del check trajo filas: " + ev(b4, "data.length"));
    ok(!ev(b4, 'csvIndex["ford.csv"]'), "un resultado vacío se cacheó: la búsqueda se queda a cero para siempre");
  }

  // ── 31c. el precio con envío es el precio FINAL, no el del anuncio ──
  // Es la cifra por la que el usuario decide comprar. La fórmula (0,70€ + 5% + porte de 5 kg)
  // solo tenía un console.assert, y el proxy de consola de los tests lo traga.
  {
    const b = await loaded();
    ok(ev(b, "priceLabel(data.find((r) => col(r, 'id') === 'a3'))") === "57,7€ (con envío, aprox)",
       "el precio con envío no sale: " + ev(b, "priceLabel(data.find((r) => col(r, 'id') === 'a3'))"));
    ok(ev(b, "priceLabel(data.find((r) => col(r, 'id') === 'a1'))") === "1000€",
       "un anuncio sin envío no muestra su precio tal cual: " + ev(b, "priceLabel(data.find((r) => col(r, 'id') === 'a1'))"));
  }

  // ── 32. gesto de arrastre del mazo: los umbrales de decide() y el eje del arrastre ──
  // Los botones del mazo (#swYes/#swNo) sí se probaban; el dedo, que es como se usa de verdad, no.
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    // un gesto completo: pulsar en (0,0), mover a (dx,dy) y soltar `ms` milisegundos después
    const drag = async (dx, dy, ms) => {
      const v = b.q("#swipeView");
      const p = (t, x, y, ts) => v.dispatch(t, { clientX: x, clientY: y, timeStamp: ts, pointerId: 1 });
      p("pointerdown", 0, 0, 0);
      p("pointermove", dx, dy, ms);
      p("pointerup", dx, dy, ms);
      await tick(260); // el vuelo de la tarjeta + el nextCard() diferido
    };
    const primera = ev(b, "deck[di] && key(deck[di])");
    await drag(-100, 0, 300); // arrastre largo a la izquierda = rechazar
    ok(ev(b, "rejected.has(" + JSON.stringify(primera) + ")"), "arrastrar a la izquierda no rechazó la tarjeta");

    const segunda = ev(b, "deck[di] && key(deck[di])");
    ok(segunda !== primera, "tras el arrastre no pasó a la tarjeta siguiente");
    await drag(100, 0, 300); // arrastre largo a la derecha = guardar
    ok(ev(b, "favorite.has(" + JSON.stringify(segunda) + ")"), "arrastrar a la derecha no guardó la tarjeta");

    // arrastre corto y lento: no cuaja, la tarjeta se queda
    const tercera = ev(b, "deck[di] && key(deck[di])");
    await drag(30, 0, 1000);
    ok(ev(b, "deck[di] && key(deck[di])") === tercera, "un arrastre de 30px lento clasificó la tarjeta");
    ok(!ev(b, "favorite.has(" + JSON.stringify(tercera) + ")"), "un arrastre corto y lento guardó la tarjeta");

    // ...pero corto y RÁPIDO sí: un flick de 30px en 50ms son 0.6 px/ms
    await drag(30, 0, 50);
    ok(ev(b, "favorite.has(" + JSON.stringify(tercera) + ")"), "un flick rápido no clasificó la tarjeta");

    // vertical: es scroll de la descripción, no un swipe
    const b2 = await loaded();
    b2.q("#swipeFab").click();
    const cuarta = ev(b2, "deck[di] && key(deck[di])");
    const v2 = b2.q("#swipeView");
    v2.dispatch("pointerdown", { clientX: 0, clientY: 0, timeStamp: 0, pointerId: 1 });
    v2.dispatch("pointermove", { clientX: 5, clientY: 80, timeStamp: 100, pointerId: 1 });
    v2.dispatch("pointerup", { clientX: 5, clientY: 80, timeStamp: 100, pointerId: 1 });
    await tick(260);
    ok(ev(b2, "deck[di] && key(deck[di])") === cuarta, "un arrastre vertical clasificó la tarjeta");

    // pulsar un botón de dentro del mazo no arma el arrastre. El pointerdown burbujea hasta
    // #swipeView, que es toda la zona de arrastre, así que sin la guarda un dedo que se mueve
    // un poco al pulsar "Ver" clasificaría la tarjeta sin querer.
    const b3 = await loaded();
    b3.q("#swipeFab").click();
    const quinta = ev(b3, "deck[di] && key(deck[di])");
    const v3 = b3.q("#swipeView");
    const sobreVer = (t, x, ts) =>
      v3.dispatch(t, { clientX: x, clientY: 0, timeStamp: ts, pointerId: 1, target: b3.q("#swVer") });
    sobreVer("pointerdown", 0, 0);
    sobreVer("pointermove", -100, 300);
    sobreVer("pointerup", -100, 300);
    await tick(260);
    ok(ev(b3, "deck[di] && key(deck[di])") === quinta, "arrastrar desde #swVer pasó a la tarjeta siguiente");
    ok(!ev(b3, "rejected.has(" + JSON.stringify(quinta) + ")"), "arrastrar desde #swVer rechazó la tarjeta");
  }

  // ── 33. combobox de búsquedas (#pick): es un <input>, así que el inventario de botones
  //        no lo mira. Enfocar abre la lista entera, teclear filtra, Escape y el clic fuera cierran.
  {
    const b = await loaded();
    b.q("#kw").value = "bici";
    await b.q("#scrape").click();
    await flush();
    const filas = () => b.q("#qlist").children.length;

    b.q("#pick").dispatch("focus");
    ok(b.q("#qlist").hidden === false, "enfocar el combobox no abrió la lista");
    ok(filas() === 2, "la lista no salió entera al enfocar: " + filas() + " filas");

    b.q("#pick").value = "bic";
    b.q("#pick").dispatch("input");
    ok(filas() === 1, "teclear no filtró la lista: " + filas() + " filas");
    ok(b.q("#pickSince").hidden === true, "al teclear, el badge de la ventana temporal se quedó");

    // el DOM falso no tiene la anidación del HTML: se declara la que dice index.html
    // (<div class="qbox"> envuelve a #pick, #pickSince y #qlist), que es lo que mira contains()
    b.q(".qbox").append(b.q("#pick"), b.q("#pickSince"), b.q("#qlist"));
    b.fireDoc("pointerdown", { target: b.q("#qlist") }); // dentro del combobox: no cierra
    ok(b.q("#qlist").hidden === false, "un clic DENTRO del combobox cerró la lista");
    b.fireDoc("pointerdown", { target: b.q("#kw") });
    ok(b.q("#qlist").hidden === true, "un clic fuera no cerró la lista");

    b.q("#pick").dispatch("focus");
    b.q("#pick").dispatch("keydown", { key: "Escape" });
    ok(b.q("#qlist").hidden === true, "Escape no cerró la lista");

    // sin coincidencias: avisa en vez de dejar el hueco vacío
    b.q("#pick").value = "zzz";
    b.q("#pick").dispatch("input");
    ok(/sin coincidencias/.test(b.q("#qlist").innerHTML), "un filtro sin resultados no avisa");
  }

  // ── 34. ubicación (#locBtn / #locReset): getLoc() leía wp_loc desde siempre y nadie lo
  //        escribía, así que TODO el mundo buscaba desde Jaén ──
  {
    const b = await loaded();
    ok(b.q("#locReset").hidden === true, "el botón de volver a Jaén sale sin ubicación propia");
    ok(ev(b, "getLoc().lat") === 37.7796, "sin wp_loc la ubicación de partida no es Jaén");

    // navegador sin geolocation (o contexto no seguro): avisa, no revienta
    b.q("#locBtn").click();
    ok(/no da la ubicación/.test(b.q("#snackmsg").textContent), "sin geolocation el botón no avisa");
    ok(!b.store.wp_loc, "sin geolocation se escribió wp_loc igual");

    // permiso denegado: avisa con el motivo y no guarda nada
    b.sandbox.navigator.geolocation = { getCurrentPosition: (_ok, err) => err({ message: "denegado" }) };
    b.q("#locBtn").click();
    ok(/denegado/.test(b.q("#snackmsg").textContent), "el error de geolocation no llega al usuario");
    ok(!b.store.wp_loc, "un permiso denegado escribió wp_loc");
    ok(b.q("#locBtn").disabled === false, "el botón se quedó deshabilitado tras el error");

    // permiso concedido: guarda, repinta y re-scrapea (los km del CSV son de la ubicación vieja)
    const calls = [];
    b.sandbox.Rebusca.scrape = async (o) => (calls.push(o), CSV);
    b.sandbox.navigator.geolocation = {
      getCurrentPosition: (_ok) => _ok({ coords: { latitude: 40.4168, longitude: -3.7038 } }),
    };
    b.q("#locBtn").click();
    await flush();
    ok(JSON.parse(b.store.wp_loc || "{}").lat === 40.4168, "no se guardó la ubicación: " + b.store.wp_loc);
    ok(ev(b, "getLoc().lon") === -3.7038, "getLoc() sigue devolviendo Jaén tras guardar");
    ok(/40\.417/.test(b.q("#locLabel").textContent), "la etiqueta no muestra la ubicación: " + b.q("#locLabel").textContent);
    ok(b.q("#locReset").hidden === false, "el botón de volver a Jaén sigue oculto");
    ok(calls.length === 1, "guardar la ubicación no relanzó la búsqueda (los km eran de la vieja)");
    ok(calls[0].lat === 40.4168, "el re-scrape fue con la ubicación vieja: " + JSON.stringify(calls[0]));

    // volver a Jaén: borra la clave, repinta y relanza otra vez
    b.q("#locReset").click();
    await flush();
    ok(!b.store.wp_loc, "volver a Jaén no borró wp_loc");
    ok(b.q("#locReset").hidden === true, "el botón de volver a Jaén se quedó visible");
    ok(calls.length === 2, "volver a Jaén no relanzó la búsqueda");
  }

  // ── 35. el contador de la búsqueda dice por qué rama OR va (las ramas se piden en serie) ──
  {
    const b = await boot({}, { csv: CSV });
    const visto = [];
    b.sandbox.Rebusca.scrape = async (o) => {
      o.onProgress(0, 1, 12);
      visto.push(b.q("#loadingCount").textContent);
      o.onProgress(7, 2, 12);
      visto.push(b.q("#loadingCount").textContent);
      o.onProgress(9, 1, 1); // una sola rama: el sufijo sobra
      visto.push(b.q("#loadingCount").textContent);
      return CSV;
    };
    b.q("#kw").value = "ford OR focus";
    await b.q("#scrape").click();
    await flush();
    ok(visto[0] === "Buscando… · rama 1/12", "el contador no dice la rama al empezar: " + visto[0]);
    ok(visto[1] === "7 encontrados · rama 2/12", "el contador no avanza de rama: " + visto[1]);
    ok(visto[2] === "9 encontrados", "con una sola rama el sufijo sobra: " + visto[2]);
  }

  // ── 36. la hoja de compartir del móvil va antes que el portapapeles; si se cierra, se copia ──
  {
    const b = await loaded();
    const enviados = [];
    b.sandbox.navigator.share = async (d) => void enviados.push(d.text);
    b.q("#kw").value = "teclado";
    const copiadosAntes = b.spy.copied.length;
    b.q("#copyAskPrompt").click();
    await flush();
    ok(enviados.length === 1 && /teclado/.test(enviados[0]),
      "el prompt no salió por la hoja de compartir: " + JSON.stringify(enviados));
    ok(b.spy.copied.length === copiadosAntes, "compartió y además copió: el portapapeles sobra");
    ok(/Prompt enviado/.test(b.q("#snackmsg").textContent),
      "el aviso no dice que se compartió: " + b.q("#snackmsg").textContent);
    // el usuario cierra la hoja de compartir: el texto tiene que acabar en el portapapeles igual
    b.sandbox.navigator.share = async () => { throw new Error("AbortError"); };
    b.q("#copyAskPrompt").click();
    await flush();
    ok(/teclado/.test(b.spy.copied.at(-1) || ""), "al cerrar la hoja el prompt se perdió");
    ok(/Prompt copiado/.test(b.q("#snackmsg").textContent),
      "tras copiar, el aviso sigue diciendo que compartió: " + b.q("#snackmsg").textContent);
  }

  // ── 37. la foto de la tarjeta se decodifica fuera del hilo de la interfaz ──
  {
    const b = await loaded();
    const card = ev(b, `
      const el = document.createElement("div");
      fillCard(el, headers.map((h) => (h === "imagen" ? "https://w/foto.jpg" : h === "id" ? "z1" : "")));
      el`);
    const img = byClass(card, "li-img")[0];
    ok(img, "la tarjeta no montó la foto");
    ok(img.loading === "lazy" && img.decoding === "async",
      "la foto bloquea el hilo de la interfaz: loading=" + img.loading + " decoding=" + img.decoding);
  }

  // ── 38. copia de seguridad: guardar, perderlo todo, restaurar ──
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets(); rejected.add("a3"); saveBuckets()');
    b.q("#exportState").click();
    const copia = b.spy.blobs[0].partes.join("");
    ok(/"app":"rebusca"/.test(copia), "la copia no se identifica: " + copia.slice(0, 60));
    const datos = JSON.parse(copia).datos;
    ok(datos.wp_favorite && datos.wp_rejected && datos.wp_searches,
      "la copia no lleva el triaje ni las búsquedas: " + Object.keys(datos).join());
    ok(!("wp_rows" in datos) && !("wp_csv" in datos), "la copia se lleva los caches de resultados");

    // el botón visible solo abre el selector de fichero, que va oculto
    let abierto = 0;
    b.q("#importState").onclick = () => abierto++;
    b.q("#importBtn").click();
    ok(abierto === 1, "el botón de restaurar no abre el selector de fichero: " + abierto);

    // otro navegador, vacío: el fichero lo devuelve todo
    const b2 = await boot({}, { csv: CSV });
    ok(!Object.keys(JSON.parse(b2.store.wp_favorite || "{}")).length,
      "el almacén de partida ya traía favoritos: " + b2.store.wp_favorite);
    b2.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    ok(JSON.parse(b2.store.wp_favorite || "{}")["ford.csv"].join() === "a1",
      "restaurar no devolvió los favoritos: " + b2.store.wp_favorite);
    ok(b2.spy.reloads === 1, "restaurar no recargó la página: " + b2.spy.reloads);

    // un fichero que no es una copia: avisa y no toca nada
    const b3 = await boot({}, { csv: CSV });
    b3.q("#importState").dispatch("change", { target: { files: [{ text: async () => "{}" }] } });
    await flush();
    ok(/Copia no válida/.test(b3.q("#snackmsg").textContent),
      "un fichero cualquiera pasó por copia: " + b3.q("#snackmsg").textContent);
  }

  // ── 39. el aviso de novedades se ve con el menú cerrado ──
  {
    const b = await loaded();
    ok(b.q("#cogBadge").hidden === false && +b.q("#cogBadge").textContent === 3,
      "el cog no avisa de los anuncios sin ver: " + b.q("#cogBadge").textContent);
    // clasificar los tres lo apaga: ya no hay nada nuevo que mirar
    ev(b, 'for (const id of csvIndex["ford.csv"].ids) favorite.add(id); pushEstado(); render()');
    ok(b.q("#cogBadge").hidden === true,
      "el aviso sigue puesto sin nada sin ver: " + b.q("#cogBadge").textContent);
  }

  // ── 40. la cabecera no se come la pantalla: "Afinar" empieza plegado ──
  {
    const b = await loaded();
    ok(!b.q("#excl").open, "el bloque de afinar tapa los resultados nada más buscar");
    ok(!b.q("#exclCount").textContent, "el resumen cuenta filtros que no hay: " + b.q("#exclCount").textContent);
    // con un filtro puesto se abre solo: un tope invisible parece una búsqueda sin resultados
    ev(b, 'exclMap[curDrawer()] = ["averiado"]; limMap[curDrawer()] = { precio: 1000 }; render()');
    ok(b.q("#excl").open === true, "un filtro activo se queda escondido");
    ok(/2/.test(b.q("#exclCount").textContent), "el resumen no dice cuántos filtros hay: " + b.q("#exclCount").textContent);
  }

  // ── 41. la tarjeta avisa de la republicación (item 24) ──
  //     El scraper deduplica por id, así que el mismo coche con otro id vuelve a la cola de
  //     "sin ver" y el usuario lo tría dos veces. Aquí Ana tiene el Focus repetido (a1 y a6)
  //     y el Ka suelto (a3): el aviso sale en los dos primeros y NO en el tercero.
  {
    const b = await loaded({ csv: CSV_DUP });
    ev(b, 'favorite.add("a1"); favorite.add("a3"); favorite.add("a6"); saveBuckets(); view = "favorite"; render()');
    const textos = byClass(ev(b, "tbody"), "li-extra").map((e) => e.textContent);
    const avisos = textos.filter((t) => /2 anuncios iguales/.test(t));
    ok(avisos.length === 2, "el aviso de republicación no sale en las dos copias: " + JSON.stringify(textos));
    ok(
      !textos.some((t) => /iguales/.test(t) && /piezas|Ka/.test(t)),
      "el aviso de republicación marca un anuncio que no se repite: " + JSON.stringify(textos),
    );
    // el recuento se rehace en cada carga: si se quedara pegado, la búsqueda siguiente heredaría
    // los duplicados de la anterior
    ev(b, "loadCSV(" + JSON.stringify(CSV) + ', "otra.csv"); favorite.add("a1"); favorite.add("a3"); view = "favorite"; render()');
    const tras = byClass(ev(b, "tbody"), "li-extra").map((e) => e.textContent);
    ok(!tras.some((t) => /iguales/.test(t)), "el recuento de duplicados no se rehace al cargar otro CSV: " + JSON.stringify(tras));
  }

  // ── 42. una restauración que no cabe no te puede dejar sin nada ──
  //     El importador borraba todas las claves y solo después escribía las de la copia, con un
  //     `setItem` crudo. Si la cuota reventaba a media escritura, el triaje del usuario se
  //     quedaba en el borrado y el aviso echaba la culpa al fichero.
  {
    const opts = { csv: CSV, timers: true };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    ok(b.store.wp_estado, "el arranque no dejó estado que perder: " + Object.keys(b.store).join());

    // una copia sana, pero que ya no cabe en este navegador: revienta en la segunda clave
    const copia = JSON.stringify({
      app: "rebusca", v: 1,
      datos: { wp_favorite: '{"x.csv":["z9"]}', wp_searches: JSON.stringify(["x".repeat(400)]) },
    });
    opts.limit = 300; // el almacén de partida ocupa ~242 bytes: la primera clave entra, la segunda no
    b.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    ok(b.store.wp_estado, "una restauración a medias se llevó el estado por delante");
    ok(b.spy.reloads === 0, "la app recargó con la restauración a medias: " + b.spy.reloads);
    // No basta con que `wp_estado` sobreviva: `hydrateEstado` da precedencia POR CAMPO a la
    // clave espejo sobre el blob, así que un `wp_favorite` machacado a medias manda sobre los
    // favoritos buenos que `wp_estado` conserva. Y no se ve hasta la siguiente recarga.
    ok(b.store.wp_favorite === '{"ford.csv":["a1"]}',
      "la restauración a medias dejó wp_favorite machacado: " + b.store.wp_favorite);
    ok(/no cabe|espacio/i.test(b.q("#snackmsg").textContent),
      "el aviso culpa al fichero de un problema de espacio: " + b.q("#snackmsg").textContent);

    // …y la vuelta atrás tampoco puede reventar ella misma. Si una clave de la copia ENCOGE y
    // otra CRECE, reponer la primera con la segunda ya escrita sube la ocupación por encima de
    // la de partida: la cuota vuelve a saltar y la reposición se corta a medias.
    const opts3 = { csv: CSV, timers: true };
    const b3 = await boot({}, opts3);
    b3.q("#kw").value = "ford";
    await b3.q("#scrape").click();
    await flush();
    ev(b3, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    const favBueno = b3.store.wp_favorite;
    const bytes = (s) => Object.values(s).reduce((n, v) => n + v.length, 0);
    const holgura = 300;
    opts3.limit = bytes(b3.store) + holgura;
    // wp_searches crece lo justo: cabe al escribirse, pero deja al almacén sin sitio para que la
    // reposición devuelva wp_favorite a su tamaño. El punto medio del margen que da esa cuenta.
    const crece = holgura + Math.round((favBueno.length - 2) / 2);
    const copia3 = JSON.stringify({
      app: "rebusca", v: 1,
      datos: {
        wp_favorite: "{}", // encoge
        wp_searches: "z".repeat((b3.store.wp_searches || "").length + crece), // crece, y cabe
        wp_lastcsv: "z".repeat(opts3.limit), // no cabe: la cuota revienta aquí
      },
    });
    b3.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia3 }] } });
    await flush();
    ok(b3.store.wp_favorite === favBueno,
      "la vuelta atrás reventó por cuota y dejó wp_favorite machacado: " + b3.store.wp_favorite);
    ok(b3.spy.reloads === 0, "la app recargó con la restauración deshecha: " + b3.spy.reloads);

    // el fallo de IndexedDB llega cuando ya se escribió todo Y se borraron las claves sobrantes.
    // Sin vuelta atrás la copia ajena se queda puesta, y el aviso sigue diciendo que no pasó nada.
    const b4 = await boot({}, { csv: CSV, timers: true });
    b4.q("#kw").value = "ford";
    await b4.q("#scrape").click();
    await flush();
    ev(b4, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    const foto = (s) => JSON.stringify(Object.entries(s).sort());
    const antes = foto(b4.store);
    ev(b4, 'idb.set = async () => { throw new Error("IndexedDB llena") }');
    const copia4 = JSON.stringify({
      app: "rebusca", v: 1,
      datos: { wp_favorite: '{"x.csv":["z9"]}' },
      filas: { z9: { id: "z9", titulo: "ajeno" } },
    });
    b4.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia4 }] } });
    await flush();
    await flush();
    ok(foto(b4.store) === antes, "el fallo de IndexedDB dejó puesta la copia ajena: " + foto(b4.store));
    ok(b4.spy.reloads === 0, "la app recargó tras fallar IndexedDB: " + b4.spy.reloads);
    // …y el aviso no puede culpar al fichero. La copia es buena y el triaje quedó entero: quien
    // falló es este navegador. Si el usuario lee "Copia no válida" tira su única copia.
    ok(!/no válida/i.test(b4.q("#snackmsg").textContent),
      "el aviso culpa al fichero de un fallo del almacén: " + b4.q("#snackmsg").textContent);

    // el fallo de IndexedDB de verdad no es un `set` que lanza: es la transacción que ABORTA al
    // commitear, después de que la petición haya dicho que sí. Así revienta la cuota real.
    const opts5 = { csv: CSV, timers: true };
    const b5 = await boot({}, opts5);
    b5.q("#kw").value = "ford";
    await b5.q("#scrape").click();
    await flush();
    ev(b5, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    const antes5 = foto(b5.store);
    opts5.idbFalla = "commit";
    b5.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia4 }] } });
    await flush();
    await flush();
    ok(foto(b5.store) === antes5, "el commit abortado dejó puesta la copia ajena: " + foto(b5.store));
    ok(b5.spy.reloads === 0, "la app recargó con el commit de IndexedDB abortado: " + b5.spy.reloads);

    // con la LECTURA rota (el arranque no pudo leer), `idb.set` resuelve sin escribir. El
    // importador no puede dar por buena una restauración que deja las filas sin poner.
    const b6 = await boot({}, { csv: CSV, timers: true });
    b6.q("#kw").value = "ford";
    await b6.q("#scrape").click();
    await flush();
    ev(b6, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    const antes6 = foto(b6.store);
    ev(b6, "lecturaRota = true");
    b6.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia4 }] } });
    await flush();
    await flush();
    ok(foto(b6.store) === antes6, "el almacén roto dejó puesta la copia ajena: " + foto(b6.store));
    ok(b6.spy.reloads === 0, "la app recargó con el almacén roto: " + b6.spy.reloads);

    // una copia que no trae una clave que sí está en el almacén la borra. Sin esta línea el
    // triaje viejo se mezcla con el importado, y hasta hoy ningún check lo miraba.
    const b7 = await boot({}, { csv: CSV, timers: true });
    b7.q("#kw").value = "ford";
    await b7.q("#scrape").click();
    await flush();
    ev(b7, 'favorite.add("a1"); saveBuckets(); pushEstado()');
    ok(b7.store.wp_favorite, "el arranque no dejó una clave sobrante que borrar");
    const copia7 = JSON.stringify({ app: "rebusca", v: 1, datos: { wp_estado: "{}" } });
    b7.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia7 }] } });
    await flush();
    await flush();
    ok(!("wp_favorite" in b7.store),
      "la restauración dejó una clave que la copia no traía: " + Object.keys(b7.store).join());

    // una copia manipulada no escribe claves ajenas a la app
    const b2 = await boot({}, { csv: CSV });
    const sucia = JSON.stringify({ app: "rebusca", v: 1, datos: { wp_favorite: "{}", token: "robado" } });
    b2.q("#importState").dispatch("change", { target: { files: [{ text: async () => sucia }] } });
    await flush();
    ok(!("token" in b2.store), "la copia escribió una clave que no es de la app: " + Object.keys(b2.store).join());
  }

  // ── 43. la copia se lleva también las filas cacheadas (defecto 3) ──
  //     Los ids del triaje viven en localStorage, pero el título/precio/foto de cada anuncio
  //     están en IndexedDB. Sin las filas, un favorito que Wallapop ya retiró se cae por el
  //     borde al restaurar: el id sigue ahí y la lista no enseña nada.
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    b.q("#exportState").click();
    const copia = b.spy.blobs.at(-1).partes.join("");
    ok(/Ford Focus/.test(copia), "la copia no lleva la fila del favorito, solo su id");

    // restaurar en otro navegador deja la fila lista antes de recargar
    const b2 = await boot({}, { csv: CSV });
    b2.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    await flush();
    const fila = await ev(b2, 'idb.get("rows")');
    ok(fila && fila.a1 && /Ford Focus/.test(fila.a1.titulo),
      "restaurar no repuso la fila del favorito: " + JSON.stringify(fila));
    ok(b2.spy.reloads === 1, "restaurar no recargó la página: " + b2.spy.reloads);
  }

  // ── 44. "Afinar" se deja cerrar (defecto 4) ──
  //     `renderExcl()` corre en cada `render()`, y con un filtro puesto volvía a abrir el
  //     desplegable. Marcar un favorito, hacer swipe o un `storage` de otra pestaña lo
  //     reabrían: la cabecera se quedaba desplegada para siempre.
  {
    const b = await loaded();
    ev(b, 'exclMap[curDrawer()] = ["averiado"]; render()');
    ok(b.q("#excl").open === true, "un filtro nuevo no abre el desplegable");
    b.q("#excl").open = false; // el usuario lo cierra
    ev(b, 'favorite.add("a2"); saveBuckets(); render()');
    ok(b.q("#excl").open === false, "el desplegable se reabrió solo con un render ajeno");
    // …pero un filtro más sí vuelve a abrirlo: un tope invisible parece una búsqueda vacía
    ev(b, 'limMap[curDrawer()] = { precio: 1000 }; render()');
    ok(b.q("#excl").open === true, "un filtro nuevo no avisa si el desplegable está cerrado");
  }

  // ── 45. una rama que llena su cupo se dice tal cual ──
  //     Con el tope repartido, una rama puede quedarse corta sin que el total llegue al tope
  //     global. El aviso caía en el mensaje de ramas caídas y anunciaba "0 de 3 ramas fallaron".
  {
    const b = await boot({}, { csv: CSV, timers: true });
    ev(b, "Rebusca.lastScrape = { ramas: 3, ramasRotas: 0, ramasTope: 2, sinId: 0, abortado: false, tope: 0, parcial: true }");
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    const msg = b.q("#snackmsg").textContent;
    ok(!/0 de 3/.test(msg), "el aviso inventa ramas caídas que no hubo: " + msg);
    ok(/2 de 3/.test(msg) && /cupo/.test(msg), "el aviso no dice que las ramas llenaron su cupo: " + msg);
  }

  // ── 46. una escritura que aborta avisa UNA vez, no pisa los «Deshacer» y se reintenta ──
  //     El triaje escribe fire-and-forget (`saveRows` en `src/app.js:251`). Un rechazo suelto por
  //     carta llegaba al `unhandledrejection` global, que pintaba "Fallo interno" encima del
  //     «Deshacer». Pero cerrar el grifo era pasarse: los CSVs (cientos de KB) y el triaje (unos
  //     KB) lo comparten, así que una cuota llena al commitear un texto grande dejaba la sesión
  //     entera sin guardar, aunque el almacén se recuperase un segundo después.
  {
    const opts = { csv: CSV, timers: true, idbFalla: "commit" };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    ok(/No se pudo guardar/i.test(b.q("#snackmsg").textContent),
      "el fallo de escritura no avisa: " + b.q("#snackmsg").textContent);
    ok(!/NO guardará cambios/.test(b.q("#snackmsg").textContent),
      "el aviso da por muerta la sesión entera por un fallo de escritura: " + b.q("#snackmsg").textContent);
    ok(ev(b, "lecturaRota") === false, "un fallo de ESCRIBIR encendió la bandera de LEER");

    // …y una vez avisado, se calla: las cartas siguientes conservan su «Deshacer».
    ev(b, 'reject("a1", "Ford Focus")');
    await flush();
    await flush();
    ok(/Rechazado/.test(b.q("#snackmsg").textContent),
      "el fallo de escritura volvió a pisar el aviso del rechazo: " + b.q("#snackmsg").textContent);
    ok(typeof b.q("#undo").onclick === "function", "el aviso del almacén se llevó por delante el Deshacer");
    ok(bucket(b, "rejected").length === 1, "el rechazo se perdió con el almacén sin commitear");

    // el almacén se recupera y la escritura siguiente ENTRA. Un fallo pasajero no puede dejar la
    // sesión en solo lectura: IndexedDB vuelve en sí en cuanto baja la presión sobre la cuota.
    opts.idbFalla = undefined;
    ok((await ev(b, 'idb.set("rows", { a1: { titulo: "Ford Focus" } })')) === true,
      "el almacén sano sigue sin aceptar escrituras tras un fallo pasajero");
    ok((await ev(b, 'idb.get("rows")')).a1, "la escritura de después del fallo no entró");
  }

  // ── 46b. el aviso de una escritura fallida sale UNA vez, también con varias en vuelo ──
  //     `loadCSV` dispara `saveRows` y `cacheCsv` a la vez (`src/app.js:1600`), así que la guarda
  //     tiene que aguantar el camino concurrente, no solo el secuencial.
  {
    const b = await boot({}, { csv: CSV, timers: true, idbFalla: "commit" });
    let avisos = 0;
    ev(b, "window.__snackReal = snack; snack = (m, u) => { window.__cuenta(m); return window.__snackReal(m, u) }");
    b.sandbox.__cuenta = (m) => { if (/No se pudo guardar/i.test(m)) avisos++; };
    await Promise.all([
      ev(b, 'idb.set("rows", {})'), ev(b, 'idb.set("csv:a", "x")'), ev(b, 'idb.set("csvIndex", {})'),
    ]);
    ok(avisos === 1, "tres escrituras fallidas en vuelo dieron " + avisos + " avisos, no 1");
  }

  // ── 46c. con la LECTURA rota, el triaje no machaca las filas buenas ──
  //     Es la razón de ser del grifo: si el arranque no pudo leer, `rowCache` está vacío por el
  //     fallo y no porque no haya fichas. `saveRows` repuebla solo con lo que hay en `data`
  //     (`src/app.js:283-288`), así que al abrir otra búsqueda escribiría ese vacío encima.
  {
    const b = await boot({}, { csv: CSV, timers: true });
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await flush();
    ok((await ev(b, 'idb.get("rows")')).a1, "el escenario no dejó una ficha buena que perder");

    ev(b, "lecturaRota = true; rowCache = {}"); // como queda un arranque que no pudo leer
    ev(b, 'favorite.add("a2"); saveBuckets()');
    await flush();
    await flush();
    ok((await ev(b, 'idb.get("rows")')).a1,
      "con la lectura rota, el triaje machacó la ficha buena: " + JSON.stringify(await ev(b, 'idb.get("rows")')));
  }

  // ── 46d. borrar una búsqueda con el almacén sin commitear no deja un rechazo suelto ──
  //     `removeSearch` → `dropCsvCache` (`src/app.js:1797-1801`) es el único camino que emite un
  //     `idb.del`. Sin `.catch`, ese rechazo llega al `unhandledrejection` de `src/app.js:7-15` y
  //     pinta "Fallo interno" encima del aviso honesto. Ningún check hacía fallar nunca un `del`.
  {
    const opts = { csv: CSV, timers: true };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    ok(Object.keys(await ev(b, 'idb.get("csvIndex")')).length === 1, "no hay cache que borrar");
    opts.idbFalla = "commit";
    ok((await ev(b, 'idb.del("csv:ford.csv")')) === false, "un `del` que aborta dijo que sí entró");
    await flush();
    ok(/No se pudo guardar/i.test(b.q("#snackmsg").textContent),
      "el `del` que aborta no avisa: " + b.q("#snackmsg").textContent);
  }

  // ── 47. el aviso de una restauración que falla reparte bien la culpa ──
  //     Decirle al usuario "Copia no válida" cuando quien falla es su navegador le hace tirar la
  //     única copia que tiene. Y al revés: un fichero que no es una copia tiene que decirlo.
  {
    const b = await boot({}, { csv: CSV, timers: true });
    b.q("#importState").dispatch("change", { target: { files: [{ text: async () => "esto no es json" }] } });
    await flush();
    await flush();
    // `err instanceof SyntaxError` era falso aquí y verdadero en el navegador: `makeContext`
    // inyecta el `JSON` del host, así que el error viene de otro realm. `err.name` sí cruza.
    ok(/Copia no válida/.test(b.q("#snackmsg").textContent),
      "un fichero que no es JSON no se dice culpa del fichero: " + b.q("#snackmsg").textContent);

    // una transacción anulada propaga `error === null` (así lo deja `abort()` en la spec). El
    // aviso no puede reventar al mirarlo: el usuario pulsa importar y se queda sin nada.
    const opts = { csv: CSV, timers: true };
    const b2 = await boot({}, opts);
    const copia = JSON.stringify({
      app: "rebusca", v: 1, datos: { wp_favorite: '{"x.csv":["z9"]}' }, filas: { z9: { titulo: "X" } },
    });
    opts.idbFalla = "anular";
    b2.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    await flush();
    ok(b2.q("#snackmsg").textContent === "Este navegador no pudo guardar la copia: no se ha restaurado nada, tu triaje sigue intacto",
      "el aviso del fallo del almacén no dice lo que dice: " + b2.q("#snackmsg").textContent);
    ok(b2.spy.reloads === 0, "la app recargó con la transacción anulada: " + b2.spy.reloads);
  }

  // ── 48. un commit abortado no deja escrito lo que la petición ya había aceptado ──
  //     Una transacción de IndexedDB es atómica. El importador se apoya en eso para no reponer
  //     las filas al deshacer, así que el arnés tiene que modelarlo o la premisa no está probada.
  {
    const opts = { csv: CSV, timers: true };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'favorite.add("a1"); saveBuckets()'); // solo se cachea lo que está en un cajón
    await flush();
    const antes = JSON.stringify(await ev(b, 'idb.get("rows")'));
    ok(/Ford Focus/.test(antes), "el scrape no dejó filas que perder: " + antes);
    opts.idbFalla = "commit";
    await ev(b, 'idb.set("rows", { z9: { titulo: "MUTANTE" } })');
    opts.idbFalla = undefined;
    ok(JSON.stringify(await ev(b, 'idb.get("rows")')) === antes,
      "el commit abortado dejó escrita la fila: " + JSON.stringify(await ev(b, 'idb.get("rows")')));
  }

  // ── 49. la copia sale sin filas cuando no las hay, y CON ellas cuando las hay ──
  //     Con la LECTURA rota `rowCache` está vacío por el fallo, no porque no haya fichas. Meter
  //     ese vacío en `filas` hace que restaurar la copia en un móvil sano borre las fichas buenas:
  //     `{}` es truthy y pasa el `if (copia.filas)`. Pero un fallo al ESCRIBIR no vacía nada, y
  //     ahí quitar las fichas es tirar lo único que el usuario venía a salvar.
  {
    // primero el caso que importa: falló una escritura, `rowCache` está entero, la copia lo lleva.
    const bw = await loaded();
    ev(bw, 'favorite.add("a1"); saveBuckets()');
    await flush();
    ev(bw, 'idb.set("rows", rowCache)'); // el usuario ya vio el aviso de que una escritura falló
    ev(bw, "avisadoEscritura = true");
    bw.q("#exportState").click();
    const copiaw = JSON.parse(bw.spy.blobs.at(-1).partes.join(""));
    ok(copiaw.filas && copiaw.filas.a1,
      "un fallo al ESCRIBIR dejó la copia sin las fichas que están enteras en memoria: " + JSON.stringify(copiaw.filas));
    ok(bw.q("#snackmsg").textContent === "Copia guardada",
      "el aviso del export culpa a la lectura de un fallo de escritura: " + bw.q("#snackmsg").textContent);

    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await flush();
    ev(b, "lecturaRota = true; rowCache = {}");
    b.q("#exportState").click();
    const copia = JSON.parse(b.spy.blobs.at(-1).partes.join(""));
    ok(!("filas" in copia), "la copia se lleva unas filas vacías que borrarán las buenas al restaurar");
    ok(copia.datos.wp_favorite, "la copia del triaje se perdió: el almacén roto no impide guardarlo");
    ok(/sin las fichas/.test(b.q("#snackmsg").textContent),
      "el aviso no dice que la copia va sin las fichas: " + b.q("#snackmsg").textContent);

    // y esa copia sin `filas` la sigue aceptando el importador (las copias viejas tampoco la traen)
    const b2 = await boot({}, { csv: CSV, timers: true });
    b2.q("#importState").dispatch("change", {
      target: { files: [{ text: async () => JSON.stringify(copia) }] },
    });
    await flush();
    await flush();
    ok(b2.spy.reloads === 1, "una copia sin filas ya no se restaura: " + b2.spy.reloads);
  }

  // ── 50. el almacén que no responde se dice al arrancar, y no se lleva por delante las filas ──
  //     Sin `q.onerror` en el wrapper, un fallo de lectura deja la promesa colgada para siempre:
  //     `hydrateStores` no termina, el grifo no se cierra y el usuario no ve nada. Y la migración
  //     de `wp_rows` a IndexedDB borra la copia de localStorage DESPUÉS de escribir: si la
  //     escritura no entró, ese borrado es la pérdida de todas las fichas del triaje.
  {
    const filas = JSON.stringify({ a1: { titulo: "Ford Focus", id: "a1" } });
    const b = await boot({ wp_rows: filas }, { csv: CSV, timers: true, idbFalla: "peticion" });
    await flush();
    await flush();
    ok(ev(b, "lecturaRota") === true, "el almacén que no responde no cerró el grifo");
    ok(/NO guardará cambios/.test(b.q("#snackmsg").textContent),
      "el almacén que no responde no avisa: " + b.q("#snackmsg").textContent);
    ok(b.store.wp_rows === filas,
      "la migración borró las filas de localStorage sin haberlas escrito: " + b.store.wp_rows);
  }

  // ── 50b. la migración de los CSVs viejos tampoco se da por buena sin mirar ──
  //     Es la hermana de la de `wp_rows`. `localStorage.removeItem("wp_csv")` ya corrió, así que
  //     si los textos no entran en IndexedDB se han perdido. Devolver OK deja `csvIndex` lleno de
  //     entradas cuyo texto no existe, y el badge de «sin ver» cuenta anuncios que no se abren.
  {
    const viejo = JSON.stringify({ "ford.csv": { ts: 1, text: CSV } });
    const b = await boot({ wp_csv: viejo }, { csv: CSV, timers: true, idbFalla: "commit" });
    await flush();
    await flush();
    ok(ev(b, "lecturaRota") === true, "la migración de los CSVs se dio por buena sin entrar");
    ok(/NO guardará cambios/.test(b.q("#snackmsg").textContent),
      "la migración perdida no avisa: " + b.q("#snackmsg").textContent);
  }

  // ── 50c. y mira CADA texto, no solo el último apunte ──
  //     Aquí el almacén solo rechaza las claves `csv:`: los textos no entran, pero el apunte
  //     `csvIndex` sí. Sin acumular el booleano de cada vuelta del bucle, la migración mira solo
  //     la última escritura, la ve buena y da OK con los textos perdidos.
  //     DOS búsquedas, y solo la primera falla: con una sola vuelta del bucle `ok = X` y
  //     `ok = X && ok` son la misma cosa, y el check pasaba por construcción.
  {
    const viejo = JSON.stringify({ "ford.csv": { ts: 1, text: CSV }, "vespa.csv": { ts: 1, text: CSV } });
    const b = await boot({ wp_csv: viejo },
      { csv: CSV, timers: true, idbFalla: "commit", idbFallaClave: "csv:ford" });
    await flush();
    await flush();
    ok(ev(b, "lecturaRota") === true, "un texto perdido en el bucle no cerró el grifo");
    ok(await ev(b, 'idb.get("csv:vespa.csv")'),
      "el texto que no falla tampoco entró: el fallo no es parcial y el check no prueba lo suyo");
  }

  // ── 51. el sufijo de frescura de un nombre de búsqueda no mira la cadena de prototipos ──
  //     `SINCE_LABEL[x]` sin `Object.hasOwn` acepta "constructor" o "toString" como frescura.
  //     La etiqueta salía como `ps4 (function Object() { [native code] })`, y ese `since` se va
  //     al scraper, que compone `SINCE_TF["constructor"]` en la petición a la API.
  //     `src/app.js:2411` ya se guarda de esto, con un comentario que nombra el peligro.
  {
    const b = await loaded();
    const parts = ev(b, 'queryParts("ps4--constructor.csv")');
    ok(parts.since === "", "un nombre heredado del prototipo pasa por frescura: " + parts.since);
    ok(parts.kw === "ps4  constructor", "la palabra clave se comió el sufijo falso: " + parts.kw);
    ok(!/native code/.test(ev(b, 'queryLabel("ps4--constructor.csv")')),
      "la etiqueta enseña una función del prototipo: " + ev(b, 'queryLabel("ps4--constructor.csv")'));
    ok(ev(b, 'queryParts("ps4--semana.csv")').since === "semana", "una frescura de verdad dejó de valer");
  }

  // ── 52. restaurar una copia no deja el cache de anuncios del ocupante anterior ──
  //     El importador reponía `rows` pero no tocaba `csvIndex` ni las claves `csv:<nombre>`. Tras
  //     restaurar la copia de otro móvil, abrir esa búsqueda pintaba los anuncios cacheados de
  //     antes en vez de scrapear, con los precios y las fotos de otra persona.
  //     El vaciado no lo hace el importador: deja una marca y lo hace el arranque de después de la
  //     recarga, que es lo que corre de verdad en el navegador. Así que este check arranca dos
  //     veces sobre el mismo almacén, como haría el móvil.
  {
    const mem = new Map();
    const b = await boot({}, { csv: CSV, timers: true, idbMem: mem });
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    ok(Object.keys(await ev(b, 'idb.get("csvIndex")')).length > 0, "el scrape no dejó cache que heredar");

    const copia = JSON.stringify({ app: "rebusca", v: 1, datos: { wp_estado: "{}" }, filas: {} });
    b.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    await flush();
    ok(b.spy.reloads === 1, "la restauración no llegó a recargar: " + b.spy.reloads);
    ok(b.store.wp_cacheajena === "1", "la restauración no marcó el cache como ajeno: " + b.store.wp_cacheajena);

    const b2 = await boot({ ...b.store }, { csv: CSV, timers: true, idbMem: mem }); // la recarga
    await flush();
    await flush();
    const idx = await ev(b2, 'idb.get("csvIndex")');
    ok(!idx || Object.keys(idx).length === 0,
      "el arranque dejó el índice de anuncios del ocupante anterior: " + JSON.stringify(idx));
    // La clave que el scrape crea de verdad. `ford--semana.csv` no existe nunca en este bloque
    // (el scrape va sin sufijo de frescura), así que la aserción pasaba por construcción.
    ok((await ev(b2, 'idb.get("csv:ford.csv")')) === undefined,
      "el arranque dejó cacheado el texto de una búsqueda ajena");
    ok(b2.store.wp_cacheajena === undefined, "la marca se quedó puesta con el cache ya vaciado");
  }

  // ── 52b. con el almacén mudo, una copia sin filas se restaura ENTERA igual ──
  //     Los favoritos, los rechazados, las búsquedas, los alias y las exclusiones viven en
  //     localStorage: se restauran sin tocar IndexedDB. Lanzar porque el almacén no acepta el
  //     vaciado del cache los deshace todos, y eso es perder funcionalidad por un cache.
  //     El cache ajeno no se queda sin vaciar: la marca lo reintenta en cada arranque.
  {
    const opts = { csv: CSV, timers: true };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();

    opts.idbFalla = "commit";
    const copia = JSON.stringify({
      app: "rebusca", v: 1,
      datos: { wp_favorite: '{"moto.csv":["z9"]}', wp_alias: '{"moto.csv":"mi vespa"}' },
    });
    b.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    await flush();
    ok(b.spy.reloads === 1, "una copia sin filas no se restauró por un cache que no se pudo vaciar: " + b.spy.reloads);
    ok(b.store.wp_favorite === '{"moto.csv":["z9"]}', "el triaje restaurado se deshizo: " + b.store.wp_favorite);
    ok(b.store.wp_alias === '{"moto.csv":"mi vespa"}', "los alias restaurados se deshicieron: " + b.store.wp_alias);
    ok(b.store.wp_cacheajena === "1", "el cache ajeno se quedó sin marcar: " + b.store.wp_cacheajena);
  }

  // ── 52c. la marca del cache ajeno sobrevive a un arranque que no puede vaciarlo ──
  //     Si el almacén sigue sin escribir, el índice se vacía en memoria igual — sin índice nadie
  //     pinta un texto suelto — y la marca se queda para que el arranque siguiente lo reintente.
  {
    const mem = new Map();
    const opts = { csv: CSV, timers: true, idbMem: mem };
    const b = await boot({}, opts);
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    const store = { ...b.store, wp_cacheajena: "1" };

    const b2 = await boot({ ...store }, { csv: CSV, timers: true, idbMem: mem, idbFalla: "commit" });
    await flush();
    await flush();
    ok(Object.keys(ev(b2, "csvIndex")).length === 0,
      "el índice ajeno sigue en memoria con el almacén mudo: " + JSON.stringify(ev(b2, "csvIndex")));
    ok(b2.store.wp_cacheajena === "1", "la marca se borró sin haber vaciado nada: " + b2.store.wp_cacheajena);

    const b3 = await boot({ ...store }, { csv: CSV, timers: true, idbMem: mem }); // el almacén se cura
    await flush();
    await flush();
    ok(Object.keys((await ev(b3, 'idb.get("csvIndex")')) || {}).length === 0,
      "el almacén ya sano no vació el cache ajeno que la marca reclamaba");
    ok(b3.store.wp_cacheajena === undefined, "la marca se quedó puesta con el cache ya vaciado");
  }

  // ── 52d. el vaciado del cache ajeno no depende de que la lectura fuera bien ──
  //     Con la llamada DENTRO del `try` de hydrateStores, un `throw` de la migración se la saltaba
  //     entera, y el arranque de después de restaurar pintaba los anuncios del ocupante anterior con
  //     el badge ⚙ contándolos como novedades del usuario. El disparador es un fallo PARCIAL: uno de
  //     los textos del ocupante anterior no cabe, la migración lanza y `csvIndex` ya está poblado.
  {
    const viejo = JSON.stringify({ "grande.csv": { ts: 1, text: CSV }, "ps5.csv": { ts: 1, text: CSV } });
    const b = await boot({ wp_csv: viejo, wp_cacheajena: "1" },
      { csv: CSV, timers: true, idbFalla: "commit", idbFallaClave: "csv:grande" });
    await flush();
    await flush();
    ok(ev(b, "lecturaRota") === true, "el escenario no reproduce: la migración no lanzó");
    ok(Object.keys(ev(b, "csvIndex")).length === 0,
      "el cache del ocupante anterior sigue en el índice: " + JSON.stringify(Object.keys(ev(b, "csvIndex"))));
  }

  // ── 52e. la marca caduca en cuanto una escritura del índice entra ──
  //     La marca decía «el índice del disco puede ser del ocupante anterior». Guardar el índice es la
  //     prueba de que ya no lo es. Sin esto, una marca que no se pudo consumir no caduca nunca y el
  //     arranque de dentro de dos días borra el cache que el usuario construyó DESPUÉS de restaurar.
  {
    const mem = new Map();
    const opts = { csv: CSV, timers: true, idbMem: mem, idbFalla: "commit" };
    const b = await boot({ wp_cacheajena: "1" }, opts);
    await flush();
    await flush();
    ok(b.store.wp_cacheajena === "1", "el escenario no reproduce: la marca se consumió con el almacén mudo");

    opts.idbFalla = undefined; // el almacén se cura y el usuario scrapea lo suyo
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    ok(b.store.wp_cacheajena === undefined,
      "la marca sigue puesta con el índice del usuario ya escrito: " + b.store.wp_cacheajena);

    const b2 = await boot({ ...b.store }, { csv: CSV, timers: true, idbMem: mem });
    await flush();
    await flush();
    ok(ev(b2, "csvIndex")["ford.csv"], "el arranque siguiente se comió el cache propio del usuario");
  }

  // ── 52f. …pero NO caduca si el almacén se cura solo A MEDIAS ──
  //     El apunte del índice son unos KB y entra; el texto del CSV son cientos y no cabe. Con la
  //     marca retirada ahí, el nombre del índice del usuario apunta al texto que dejó el ocupante
  //     anterior, y ningún arranque futuro lo reintenta: sus anuncios salen como resultados del
  //     usuario. Guardar el índice prueba lo que hay en MEMORIA, no que el cache ajeno se fuera.
  {
    const mem = new Map();  // el disco tal como lo dejó el ocupante anterior
    mem.set("csv:ford.csv", "id,titulo,precio\r\nz1,Ford del ocupante anterior,300\r\n");
    mem.set("csvIndex", { "ford.csv": { ts: 1, ids: ["z1"] } });
    const opts = { csv: CSV, timers: true, idbMem: mem, idbFalla: "commit" };
    const b = await boot({ wp_cacheajena: "1" }, opts);
    await flush();
    await flush();
    ok(b.store.wp_cacheajena === "1", "el escenario no reproduce: la marca se consumió con el almacén mudo");

    opts.idbFalla = "commit";
    opts.idbFallaClave = "csv:";   // el almacén se cura a medias: el índice sí, los textos no
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    await flush();
    ok(b.store.wp_cacheajena === "1",
      "la marca se retiró con el texto del ocupante todavía en el disco: " + b.store.wp_cacheajena);
    ok((await ev(b, 'idb.get("csv:ford.csv")')).includes("del ocupante anterior"),
      "el escenario no reproduce: el texto del ocupante no sobrevivió");
  }

  // ── 53. una copia sin ninguna ficha no borra las del móvil de destino ──
  //     `if (copia.filas)` da por bueno un `{}`, que es lo que exporta quien aún no ha clasificado
  //     nada. Escribirlo reemplaza el registro entero: `put` no fusiona.
  {
    const b = await boot({}, { csv: CSV, timers: true });
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await flush();
    ok((await ev(b, 'idb.get("rows")')).a1, "el escenario no dejó una ficha que perder");

    const copia = JSON.stringify({ app: "rebusca", v: 1, datos: { wp_estado: "{}" }, filas: {} });
    b.q("#importState").dispatch("change", { target: { files: [{ text: async () => copia }] } });
    await flush();
    await flush();
    ok((await ev(b, 'idb.get("rows")')).a1,
      "una copia sin fichas borró las del destino: " + JSON.stringify(await ev(b, 'idb.get("rows")')));
  }

  // ── 54. entre dos pestañas, una no machaca las fichas que la otra acaba de escribir ──
  //     El evento `storage` trae los cubos, que viven en localStorage, pero no las fichas, que
  //     viven en IndexedDB. Sin re-leerlas, la pestaña vieja escribe su `rowCache` de antes encima
  //     y el favorito de la otra se queda sin ficha para siempre.
  {
    const b = await boot({}, { csv: CSV, timers: true });
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'favorite.add("a1"); saveBuckets()');
    await flush();

    // la otra pestaña clasifica un anuncio de una búsqueda que esta no tiene cargada
    ev(b, 'idb.set("rows", { ...rowCache, a9: { id: "a9", titulo: "De la otra pestaña", _csv: "moto.csv" } })');
    await flush();
    b.store.wp_favorite = '{"ford.csv":["a1"],"moto.csv":["a9"]}';
    b.fireWin("storage", { key: "wp_favorite" });
    await flush();
    await flush();
    ok(ev(b, 'bucketed("a9")'), "el evento storage no trajo el favorito de la otra pestaña");

    ev(b, 'reject("a2", "Otro")'); // esta pestaña clasifica lo suyo: saveRows escribe rowCache entero
    await flush();
    await flush();
    const filas = await ev(b, 'idb.get("rows")');
    ok(filas.a9, "esta pestaña machacó la ficha de la otra: " + JSON.stringify(Object.keys(filas)));
    ok(filas.a1, "esta pestaña perdió su propia ficha al fusionar: " + JSON.stringify(Object.keys(filas)));
  }

  // ── 54b. …y al fusionar manda la memoria, no el disco ──
  //     La fusión trae las fichas de la otra pestaña, pero esta pestaña puede tener cambios propios
  //     que aún no ha volcado. Si el disco pisa la memoria, el trabajo sin guardar de esta pestaña
  //     desaparece de la pantalla en cuanto la otra toca cualquier cubo.
  {
    const b = await boot({}, { csv: CSV, timers: true });
    b.q("#kw").value = "ford";
    await b.q("#scrape").click();
    await flush();
    ev(b, 'reject("a1", "Otro")'); // solo lo clasificado tiene ficha en `rowCache`
    await flush();
    await flush();
    const titulo = ev(b, "rowCache.a1.titulo");

    ev(b, 'idb.set("rows", { a1: { id: "a1", titulo: "Versión vieja del disco" } })');
    await flush();
    b.fireWin("storage", { key: "wp_favorite" });
    await flush();
    await flush();
    ok(ev(b, "rowCache.a1.titulo") === titulo,
      "el disco pisó la ficha que esta pestaña tenía en memoria: " + ev(b, "rowCache.a1.titulo"));
  }

  // ── 54c. el evento de la otra pestaña no pinta "Fallo interno" encima del aviso honesto ──
  //     `idb.get` SÍ relanza — a diferencia de `set` y `del`, que se tragan el rechazo a propósito
  //     para el triaje —, así que el handler de `storage` necesita su propio `.catch`. Sin él, cada
  //     evento de la otra pestaña con el almacén parado llega al `unhandledrejection` de
  //     `src/app.js:7-15`, pinta "Fallo interno: …" y se lleva por delante el botón «Deshacer».
  //     Node no enruta sus rechazos al `window` de mentira: hay que pasárselos a mano.
  {
    const sueltos = [];
    const recoge = (razon) => sueltos.push(razon);
    process.on("unhandledRejection", recoge);
    try {
      // (a) el almacén se cae A MITAD de sesión: `lecturaRota` sigue false y solo salva el `.catch`
      const opts = { csv: CSV, timers: true };
      const b = await boot({}, opts);
      b.q("#kw").value = "ford";
      await b.q("#scrape").click();
      await flush();
      ev(b, 'reject("a1", "Otro")');
      await flush();
      await flush();
      ok(/Rechazado/.test(b.q("#snackmsg").textContent), "el escenario no reproduce: no hay aviso que pisar");
      opts.idbFalla = "peticion";
      b.fireWin("storage", { key: "wp_favorite" });
      await flush();
      await flush();
      for (const r of sueltos.splice(0)) b.fireWin("unhandledrejection", { reason: r });
      await flush();
      ok(/Rechazado/.test(b.q("#snackmsg").textContent),
        "el evento de la otra pestaña pisó el aviso honesto: " + b.q("#snackmsg").textContent);
      ok(!b.q("#snackundo").hidden === true, "el evento de la otra pestaña escondió el botón «Deshacer»");

      // (b) con la lectura rota ni se pide: no hay nada que fusionar, y el aviso del arranque manda
      const b2 = await boot({}, { csv: CSV, timers: true, idbFalla: "peticion" });
      await flush();
      await flush();
      ok(ev(b2, "lecturaRota") === true, "el escenario no reproduce: la lectura no está rota");
      b2.fireWin("storage", { key: "wp_favorite" });
      await flush();
      await flush();
      for (const r of sueltos.splice(0)) b2.fireWin("unhandledrejection", { reason: r });
      await flush();
      ok(/NO guardará cambios/.test(b2.q("#snackmsg").textContent),
        "con la lectura rota, el evento pisó el aviso del arranque: " + b2.q("#snackmsg").textContent);
    } finally {
      process.off("unhandledRejection", recoge);
    }
  }

  // ── 55. el mazo no vuelve a enseñar lo que ya está triado ──
  //     `deckRows` esconde rechazados, favoritos y excluidos. Los rechazados y las exclusiones
  //     tenían check; los favoritos no. Sin él, quitar `!favorite.has(k)` pasa los siete en verde,
  //     y el usuario se encuentra en el mazo el anuncio que acaba de guardar: lo vuelve a triar
  //     cada vez que abre la búsqueda, y el cubo de favoritos deja de significar nada.
  {
    const b = await loaded();
    ok(ev(b, "deckRows().length") === 3, "el mazo no arrancó con los tres anuncios");
    ev(b, 'favorite.add("a1"); pushEstado(); render()');
    const ids = ev(b, "deckRows().map((r) => key(r))");
    ok(!ids.includes("a1"), "el mazo sigue enseñando un anuncio ya guardado en favoritos: " + ids);
    ok(ids.length === 2, "el mazo escondió de más: " + ids);
  }

  // ── 56. el filtro de las listas busca por id, y una lista de ids casa con CUALQUIERA ──
  //     Las dos cosas están en el código y en su comentario, y ninguna tenía check. Buscar por id
  //     sin `#` es lo que se hace al pegar un id suelto; la lista con `#` es para pegar de una vez
  //     los ids que te haya dado la IA. Con `some` cambiado por `every` la lista no casa nunca
  //     —ningún anuncio tiene dos ids—, así que la pantalla sale vacía y parece que no hay nada.
  {
    const b = await loaded();
    ev(b, 'rejected.add("a1"); rejected.add("a2"); rejected.add("a3"); pushEstado(); view = "rejected"; render()');
    ok(ev(b, "filteredRows().length") === 3, "la papelera no arrancó con los tres anuncios");

    ev(b, 'listQ = "a2"; render()');   // id suelto, sin `#`
    ok(ev(b, 'filteredRows().map((r) => key(r)).join()') === "a2",
      "el filtro de texto no encuentra por id: " + ev(b, 'filteredRows().map((r) => key(r)).join()'));

    ev(b, 'listQ = "#a1, a3"; render()');   // lista de ids pegada tal cual
    ok(ev(b, 'filteredRows().map((r) => key(r)).sort().join()') === "a1,a3",
      "una lista de ids no casa con cualquiera de ellos: " + ev(b, 'filteredRows().map((r) => key(r)).join()'));

    // y el filtro por vendedor de la papelera, que sale al pulsar el nombre en una fila
    ev(b, 'listQ = ""; listSeller = "Ana"; render()');
    ok(ev(b, 'filteredRows().map((r) => key(r)).sort().join()') === "a1,a3",
      "el filtro por vendedor de la papelera no filtra: " + ev(b, 'filteredRows().map((r) => key(r)).join()'));
  }

  // ── 57. deshacer un rechazo devuelve el favorito A FAVORITOS ──
  //     Los cubos son exclusivos: rechazar saca de favoritos. `reject` se guarda `wasFavorite`
  //     antes justo para reponerlo. Sin esa línea, deshacer deja el anuncio en "sin ver": el
  //     usuario recupera el anuncio y pierde que lo tenía guardado, y no hay un segundo deshacer.
  {
    const b = await loaded();
    ev(b, 'favorite.add("a1"); saveBuckets(); render()');
    ev(b, 'reject("a1", "Ford Focus")');
    ok(bucket(b, "rejected").includes("a1"), "reject() no rechazó");
    ok(!bucket(b, "favorite").includes("a1"), "rechazar no sacó el anuncio de favoritos");
    b.q("#undo").click();
    ok(!bucket(b, "rejected").includes("a1"), "deshacer no sacó el anuncio de la papelera");
    ok(bucket(b, "favorite").includes("a1"),
      "deshacer el rechazo de un favorito no lo devuelve a favoritos: " + JSON.stringify(bucket(b, "favorite")));
  }

  // ── 58. restaurar desbloquea al vendedor, y deshacer lo vuelve a bloquear ──
  //     `enforceBlocks` re-rechaza en cada render lo que sea de un vendedor bloqueado. Restaurar
  //     sin desbloquear es un botón que no hace nada visible: el anuncio sale de la papelera y
  //     vuelve sola en el render siguiente.
  {
    const b = await loaded();
    const bloqueados = () => JSON.parse(b.store.wp_blocksel || "[]");
    ev(b, 'rejected.add("a1"); saveBuckets(); blockSel.add("Ana"); saveBlockSel(); render()');
    ok(bloqueados().includes("Ana"), "el vendedor no quedó bloqueado");
    ev(b, 'restore("a1")');
    ok(!bloqueados().includes("Ana"),
      "restaurar no desbloqueó al vendedor: enforceBlocks lo devuelve a la papelera solo");
    ok(!bucket(b, "rejected").includes("a1"), "el anuncio restaurado volvió a la papelera");
    b.q("#undo").click();
    ok(bloqueados().includes("Ana"), "deshacer la restauración no volvió a bloquear al vendedor");
  }

  // ── 59. deshacer un swipe repone el sello PREVIO, no uno nuevo ──
  //     `stamp[k]` es cuándo se clasificó ("descartado hace 3 días"). `fling` se lo guarda y
  //     `swUndo` lo repone; dos líneas en dos extremos, ninguna con check. Rotas, deshacer deja
  //     un sello de hoy sobre uno viejo, o deja sello en un anuncio que vuelve a "sin ver".
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    const k = ev(b, "key(deck[0])");
    const sello = () => ev(b, "stamp[" + JSON.stringify(k) + "]");

    // (a) la carta ya tenía sello viejo: vuelve ese, no el de ahora
    ev(b, "stamp[" + JSON.stringify(k) + '] = 111; setLS("wp_stamp", JSON.stringify(stamp))');
    b.q("#swYes").click();
    ok(sello() !== 111, "clasificar no refrescó el sello");
    await tick(300);
    b.q("#swUndo").click();
    ok(sello() === 111, "deshacer el swipe no repuso el sello previo: " + sello());
  }
  {
    const b = await loaded();
    b.q("#swipeFab").click();
    const k = ev(b, "key(deck[0])");
    const sello = () => ev(b, "stamp[" + JSON.stringify(k) + "]");

    // (b) la carta no tenía sello: no puede quedarse uno
    ok(sello() === undefined, "la carta arrancó con sello");
    b.q("#swNo").click();
    ok(sello() !== undefined, "clasificar no dejó sello");
    await tick(300);
    b.q("#swUndo").click();
    ok(sello() === undefined, "deshacer dejó un sello en un anuncio que vuelve a 'sin ver': " + sello());
  }

  // ── 60. la papelera enseña lo que ya no está en la búsqueda ──
  //     `data` son las filas del scrape de ahora. Un anuncio guardado hace un mes y ya vendido no
  //     sale ahí: sale de `rowCache`. Sin esa rama, el cubo lo cuenta y la pantalla no lo enseña,
  //     y el usuario no tiene forma de sacarlo de la papelera porque no puede verlo.
  {
    const b = await loaded();
    ev(b, 'rowCache["z9"] = { id: "z9", titulo: "Ford viejo", precio: "300", vendedor: "Zoe" }');
    ev(b, 'rejected.add("a1"); rejected.add("z9"); saveBuckets(); view = "rejected"; render()');
    const ids = ev(b, "filteredRows().map((r) => key(r))");
    ok(ids.includes("z9"),
      "la papelera esconde el anuncio que solo vive en cache (vendido/caducado): " + ids);
    ok(ev(b, 'col(filteredRows().find((r) => key(r) === "z9"), "titulo")') === "Ford viejo",
      "la fila del cache se reconstruyó con las columnas cambiadas");
  }

  // ── 61. ordenar por precio ordena por NÚMERO ──
  //     Como texto "1000" va antes que "200". Ordenar por precio es para lo que se ordena una
  //     lista de chollos, así que el orden equivocado se lleva por delante el uso principal.
  //     De paso: la flecha invierte, y la celda vacía tiene un sitio fijo (primera al ascender).
  {
    const b = await loaded();
    ev(b, 'rejected.add("a1"); rejected.add("a2"); rejected.add("a3"); saveBuckets(); view = "rejected"');
    const orden = () => ev(b, 'filteredRows().map((r) => col(r, "precio")).join()');

    ev(b, 'listSort = "precio"; listSortDir = 1; render()');
    ok(orden() === "50,200,1000", "por precio ascendente no salió en orden numérico: " + orden());
    ev(b, "listSortDir = -1; render()");
    ok(orden() === "1000,200,50", "la flecha no invierte el orden: " + orden());

    // celda vacía: vale -Infinity, o sea la primera al ascender
    ev(b, 'data.find((r) => key(r) === "a2")[headers.indexOf("precio")] = ""; listSortDir = 1; render()');
    ok(orden() === ",50,1000", "el precio vacío no va el primero al ascender: " + orden());

    // decimales: es lo que devuelve la API (`amount` es un float). Comparados como texto con
    // `numeric: true`, "1.5" y "1.25" se parten por el punto y se compara 5 contra 25, así que
    // 1,50 € sale por debajo de 1,25 €. Solo la rama numérica de cmpCell acierta aquí.
    ev(b, 'const iP = headers.indexOf("precio");' +
      'data.find((r) => key(r) === "a1")[iP] = "1.5";' +
      'data.find((r) => key(r) === "a2")[iP] = "1.25";' +
      'data.find((r) => key(r) === "a3")[iP] = "50"; render()');
    ok(orden() === "1.25,1.5,50", "los precios con decimales no se ordenan como números: " + orden());
  }

  // ── 62. sin columna, la lista sale en el orden de entrada al cubo ──
  //     Es el orden por defecto, el que ve quien no ha tocado la barra. `Set` preserva inserción.
  {
    const b = await loaded();
    ev(b, 'rejected.add("a3"); rejected.add("a1"); rejected.add("a2"); saveBuckets(); view = "rejected"; listSort = ""');
    const orden = () => ev(b, "filteredRows().map((r) => key(r)).join()");
    ev(b, "listSortDir = 1; render()");
    ok(orden() === "a3,a1,a2", "sin columna no salió en orden de llegada al cubo: " + orden());
    ev(b, "listSortDir = -1; render()");
    ok(orden() === "a2,a1,a3", "la flecha no invierte el orden de llegada: " + orden());
  }

  // ── 63. un wp_listsort con una columna que ya no existe no tumba el render ──
  //     Esa clave sobrevive a los despliegues. Si el CSV cambia un nombre de columna, `indexOf`
  //     da -1 y sin la guarda se llama a localeCompare sobre undefined: excepción dentro del
  //     render, lista en blanco, y el usuario no puede borrar la clave que no le deja abrir nada.
  {
    const b = await loaded();
    ev(b, 'rejected.add("a1"); rejected.add("a2"); saveBuckets(); view = "rejected"; listSort = "columna_de_otra_version"');
    let tiro = null;
    try { ev(b, "render()"); } catch (e) { tiro = e; }
    ok(!tiro, "un orden guardado por una columna que ya no existe tumba el render: " + (tiro && (tiro.message || tiro)));
    ok(ev(b, "filteredRows().length") === 2, "la lista se quedó vacía con la columna desconocida");
  }

  // ── 64. el mazo desempata con el segundo criterio ──
  //     `sortKeys` es una lista: "por categoría, y a igualdad por precio". Sin el desempate el
  //     segundo criterio no se aplica nunca y la barra de orden multinivel es decorativa.
  {
    const b = await loaded();
    const iCat = ev(b, 'headers.indexOf("categoria")'), iPre = ev(b, 'headers.indexOf("precio")');
    ev(b, `sortKeys = [{ col: ${iCat}, dir: 1 }, { col: ${iPre}, dir: 1 }]; view = "deck"; render()`);
    const orden = () => ev(b, 'filteredRows().map((r) => col(r, "precio")).join()');
    ok(orden() === "50,200,1000", "el mazo no desempató por el segundo criterio: " + orden());
    ev(b, `sortKeys = [{ col: ${iCat}, dir: 1 }, { col: ${iPre}, dir: -1 }]; render()`);
    ok(orden() === "1000,200,50", "el sentido del segundo criterio se ignora: " + orden());
  }

  // ── 65. la poda de saveRows respeta el lote enviado a la IA ──
  //     El lote copiado para la IA se cachea aunque no esté en ningún cubo: el veredicto (?keep=)
  //     puede llegar en otra sesión y sin CSV cargado. La poda del cache se lo llevaría por
  //     delante, y el usuario pegaría un veredicto sobre filas que ya no existen.
  {
    const b = await loaded();
    ev(b, 'setLS("wp_aisent", JSON.stringify({ csv: "ford.csv", ids: ["enviado"] }))');
    ev(b, 'rowCache["enviado"] = { id: "enviado", titulo: "En manos de la IA" };' +
      'rowCache["suelto"] = { id: "suelto", titulo: "Ni en cubo ni en lote" }; saveRows()');
    ok(ev(b, 'rowCache["enviado"] !== undefined'),
      "la poda se llevó el lote que espera el veredicto de la IA");
    // la otra mitad: sin esto el check pasaría igual con la poda entera desactivada
    ok(ev(b, 'rowCache["suelto"] === undefined'),
      "la poda no limpió lo que no está ni en un cubo ni en el lote");
  }

  // ── 66. cachear una búsqueda no toca el cache de otra búsqueda guardada ──
  //     La poda del índice quita las búsquedas que ya no están guardadas. Sin la mitad que
  //     pregunta si sigue guardada, cachear una borra el cache de TODAS las demás, y abrir
  //     cualquier otra búsqueda vuelve a scrapear desde cero. El cache es justo lo que hace que
  //     abrir una guardada sea instantáneo.
  {
    const guardadas = JSON.stringify([
      { csv: "ford.csv", rows: 3, mtime: 1 },
      { csv: "vespa.csv", rows: 2, mtime: 2 },
    ]);
    const b = await loaded({ store: { wp_searches: guardadas } });
    ev(b, 'csvIndex["vespa.csv"] = { ts: 1, ids: ["v1"] }');
    await ev(b, 'idb.set("csv:vespa.csv", "texto de vespa")');

    await ev(b, 'cacheCsv("ford.csv", "texto de ford", 2)');
    await flush();
    ok(ev(b, 'csvIndex["vespa.csv"] !== undefined'),
      "cachear una búsqueda borró del índice otra búsqueda guardada");
    ok((await ev(b, 'idb.get("csv:vespa.csv")')) === "texto de vespa",
      "cachear una búsqueda borró el texto cacheado de otra búsqueda guardada");
    ok(ev(b, 'csvIndex["ford.csv"] !== undefined'), "la búsqueda cacheada no entró en el índice");
  }

  // ── 67. dropCsvCache se lleva el texto, no solo el nombre ──
  //     Sin el borrado del texto quedan cientos de KB en IndexedDB que ya nadie puede nombrar:
  //     el índice es la única forma de llegar a ellos.
  {
    const b = await loaded();
    ev(b, 'csvIndex["vespa.csv"] = { ts: 1, ids: ["v1"] }');
    await ev(b, 'idb.set("csv:vespa.csv", "texto de vespa")');
    ev(b, 'dropCsvCache("vespa.csv")');
    await flush();
    ok(ev(b, 'csvIndex["vespa.csv"] === undefined'), "dropCsvCache no quitó el nombre del índice");
    ok((await ev(b, 'idb.get("csv:vespa.csv")')) === undefined,
      "dropCsvCache dejó el texto huérfano en IndexedDB: " + (await ev(b, 'idb.get("csv:vespa.csv")')));
  }

  // ── 68. bloquear a un vendedor rechaza sus anuncios, los saca de favoritos, y se guarda ──
  //     Sin sacarlos de favoritos el anuncio queda en los dos cubos a la vez, y los dos
  //     contadores mienten. Sin guardar, el bloqueo dura hasta que cierras la pestaña.
  {
    const b = await loaded();
    const suyos = ev(b, 'data.filter((r) => col(r, "vendedor") === "Ana").map((r) => key(r))');
    ok(suyos.length > 0, "el CSV de prueba no trae anuncios de Ana");
    ev(b, "favorite.add(" + JSON.stringify(suyos[0]) + '); saveBuckets()');
    ev(b, 'blockSel.add("Ana"); saveBlockSel(); render()');
    for (const k of suyos) ok(bucket(b, "rejected").includes(k), "bloquear no rechazó " + k);
    ok(!bucket(b, "favorite").includes(suyos[0]),
      "bloquear no sacó de favoritos: el anuncio está en los dos cubos, " + JSON.stringify(bucket(b, "favorite")));
  }

  // ── 69. el bloqueo no vuelve a sellar lo que ya estaba rechazado ──
  //     enforceBlocks corre en CADA render. Sin la guarda, "descartado hace 3 días" vuelve a
  //     ser "hace un momento" cada vez que se pinta la pantalla.
  {
    const b = await loaded();
    const k = ev(b, 'data.filter((r) => col(r, "vendedor") === "Ana").map((r) => key(r))')[0];
    ev(b, 'blockSel.add("Ana"); saveBlockSel(); render()');
    ok(bucket(b, "rejected").includes(k), "el bloqueo no rechazó el anuncio");
    ev(b, "stamp[" + JSON.stringify(k) + '] = 111; setLS("wp_stamp", JSON.stringify(stamp)); render()');
    ok(ev(b, "stamp[" + JSON.stringify(k) + "]") === 111,
      "el bloqueo re-sella en cada render lo ya rechazado: la antigüedad del descarte se reinicia sola");
  }

  // ── 70. a quién propone bloquear el mazo ──
  //     "Rechazar siguientes" es destructivo de un solo clic: manda a la papelera TODO lo fresco
  //     del vendedor. Quién sale ahí, y en qué orden, decide qué se borra.
  {
    const b = await loaded({ csv: CSV_VEND });
    const cands = () => ev(b, "sellerCandidates().map((c) => c.s)");
    const rechaza = (...ids) =>
      ev(b, ids.map((i) => `rejected.add(${JSON.stringify(i)});`).join("") + 'saveBuckets()');

    rechaza("a1");
    ok(cands().length === 0, "propone bloquear por UN solo rechazo: " + cands());

    rechaza("a3");
    ok(cands().join() === "Ana", "con 2 rechazos y frescos pendientes no propuso a Ana: " + cands());

    rechaza("a2", "a5"); // Bea llega a 2; Ana va por 2 también, pero le sumamos uno más
    rechaza("a4");
    ok(cands().join() === "Ana,Bea",
      "no propone primero al vendedor con más rechazos: " + cands());

    rechaza("a7"); // a Ana no le queda nada fresco
    ok(cands().join() === "Bea",
      "sigue proponiendo a un vendedor sin anuncios frescos: no hay 'siguientes' que rechazar, " + cands());

    ev(b, 'blockSel.add("Bea"); saveBlockSel()');
    ok(cands().length === 0, "propone bloquear a un vendedor ya bloqueado: " + cands());
  }

  // ── 71. lo que ya está fuera del mazo no cuenta como "siguiente" ──
  //     Un anuncio vetado por una palabra no se ve. Contarlo como fresco hace que el mazo
  //     proponga bloquear por anuncios invisibles, y el bloqueo sí se los lleva a la papelera.
  {
    const b = await loaded({ csv: CSV_ANA });
    ev(b, 'rejected.add("a1"); rejected.add("a3"); saveBuckets()');
    ok(ev(b, "sellerCandidates().length") === 1, "el escenario no partió con la sugerencia puesta");
    ev(b, 'addExcl("puma"); render()'); // a4 "Ford Puma" es lo único fresco que le queda a Ana
    ok(ev(b, "sellerCandidates().length") === 0,
      "cuenta como fresco un anuncio excluido del mazo: " + ev(b, "JSON.stringify(sellerCandidates().map((c) => c.s))"));
  }

  // ── 72. los chips de categoría: el vacío, el pintado del modo incluir y "limpiar" ──
  {
    const b = await loaded({ csv: CSV_VEND });
    const chips = () => b.q("#catChips").children;
    const chip = (nombre) => chips().find((c) => String(c.textContent).startsWith(nombre));
    ok(chip("Coches"), "#catChips no pintó la categoría que sí existe");
    ok(chips().every((c) => String(c.textContent).trim() !== "(1)"),
      "la fila sin categoría pintó un chip sin nombre: " +
        JSON.stringify(chips().map((c) => String(c.textContent))));

    ok(b.q("#catClear").hidden, "'limpiar' se ve sin ninguna categoría marcada");
    chip("Coches").click();
    ok(!b.q("#catClear").hidden, "'limpiar' sigue oculto con una categoría marcada");
    ok(String(chip("Coches").className).includes("off"),
      "en modo excluir la categoría marcada no se pinta apagada");

    b.q("#catMode").click(); // modo incluir: lo marcado es lo ÚNICO que se queda
    ok(!String(chip("Coches").className).includes("off"),
      "en modo incluir la categoría marcada se pinta apagada, que es lo contrario de lo que hace");

    b.q("#catMode").click(); // vuelta a excluir
    chip("Coches").click(); // destildar la última
    ok(!(b.store.wp_catexcl || "{}").includes("ford.csv"),
      "destildar la última categoría deja el cajón vacío en el almacén: " + b.store.wp_catexcl);
  }

  // ── 73. renombrar una búsqueda: recortar, cancelar y quitar ──
  //     El check 21 mide que renombrar guarda algo. Aquí se mide QUÉ guarda en los tres casos
  //     que no son "el usuario escribe un nombre bueno".
  {
    const b = await loaded({ prompt: "  Mi coche  " });
    b.q("#manageSearches").click();
    const card = () => b.q("#searchesList").children[0];
    const apodo = () => JSON.parse(b.store.wp_alias || "{}")["ford.csv"];

    card().querySelector(".sc-ren").click();
    ok(apodo() === "Mi coche", "el apodo no se guardó recortado: " + JSON.stringify(apodo()));
    ok(String(card().querySelector(".sc-kw").textContent) === "Mi coche",
      "el apodo no manda como título de la tarjeta: " + card().querySelector(".sc-kw").textContent);
    ok(String(card().querySelector(".sc-realkw").textContent) === "ford",
      "la tarjeta con apodo no enseña el término real, y ya no hay forma de saber qué se busca");

    b.sandbox.prompt = () => null; // canceló
    card().querySelector(".sc-ren").click();
    ok(apodo() === "Mi coche", "cancelar el renombrado cambió el apodo: " + JSON.stringify(apodo()));

    b.sandbox.prompt = () => "   "; // en blanco = quitar el apodo
    card().querySelector(".sc-ren").click();
    ok(apodo() === undefined, "un nombre en blanco no quita el apodo, lo deja vacío: " + JSON.stringify(apodo()));
    ok(String(card().querySelector(".sc-kw").textContent) === "ford",
      "quitado el apodo, la tarjeta no vuelve al término real: " + card().querySelector(".sc-kw").textContent);
  }

  // ── 74. el filtro del gestor: por apodo, por término real, y sin depender del acento ──
  {
    const b = await loaded({ prompt: "Mi Bañera" });
    b.q("#manageSearches").click();
    b.q("#searchesList").children[0].querySelector(".sc-ren").click();
    const filtrar = (v) => {
      b.q("#searchesFilter").dispatch("input", { target: { value: v } });
      return b.q("#searchesList").children.length;
    };
    ok(filtrar("bañera") === 1, "el filtro del gestor no encuentra por apodo");
    ok(filtrar("ford") === 1, "el filtro del gestor no encuentra por el término real cuando hay apodo");
    ok(filtrar("BAÑERA") === 1, "el filtro del gestor distingue mayúsculas");
    ok(filtrar("banera") === 1, "el filtro del gestor distingue acentos: escribir sin tilde no encuentra nada");
    ok(filtrar("zzz") === 0, "el filtro del gestor encuentra lo que no hay");
  }

  // ── 75. el orden del gestor: sin ver arriba, y luego lo tocado más recientemente ──
  //     Es lo primero que se ve al abrir el gestor y no lo medía nadie.
  {
    const b = await loaded();
    const guardadas = JSON.stringify([
      { csv: "ford.csv", rows: 3, mtime: 100 },
      { csv: "vespa.csv", rows: 2, mtime: 200 },
    ]);
    const orden = () => {
      ev(b, "renderSearches()");
      return b.q("#searchesList").children.map((c) => String(c.querySelector(".sc-kw").textContent)).join();
    };
    // el scrape del arranque deja su propia huella (wp_lastseen y csvIndex de ford): se limpia
    // para que el escenario sea el del contrato y no el residuo del boot
    ev(b, 'setLS("wp_searches", ' + JSON.stringify(guardadas) + ');setLS("wp_lastseen", "{}");csvIndex = {}');
    b.q("#manageSearches").click();
    ok(orden() === "vespa,ford", "la búsqueda scrapeada más recientemente no sale la primera: " + orden());

    // abrir una búsqueda cuenta como tocarla: wp_lastseen manda sobre el mtime del scrape
    ev(b, 'setLS("wp_lastseen", JSON.stringify({ "ford.csv": 999000 }))');
    ok(orden() === "ford,vespa", "abrir una búsqueda no la sube: solo cuenta la fecha del scrape, " + orden());

    // y las que tienen anuncios sin ver van por delante de todo lo demás
    ev(b, 'csvIndex["vespa.csv"] = { ts: 1, ids: ["nuevo"] }');
    ok(orden() === "vespa,ford", "la búsqueda con anuncios sin ver no sube al principio: " + orden());
  }

  // ── 76. rechazar también actualiza el blob de estado, no solo la clave espejo ──
  // `wp_estado` es lo que `hydrateEstado()` lee al arrancar. Si un gesto escribe `wp_rejected`
  // y se olvida del blob, el arranque siguiente repone la versión vieja y el rechazo se pierde.
  {
    const b = await loaded();
    const k = ev(b, "key(data[0])");
    ev(b, "reject(" + JSON.stringify(k) + ', "Ford Focus")');
    const blob = JSON.parse(b.store.wp_estado || "{}");
    ok(
      ((blob.rejected || {})["ford.csv"] || []).includes(k),
      "rechazar no llega al blob de estado: al recargar vuelve el anuncio, " + b.store.wp_estado,
    );
    // y lo mismo con los ajustes del cajón: los seis salen del mismo molde `saver()`
    b.q("#exclAdd").dispatch("keydown", { key: "Enter", target: { value: "roto" } });
    const conVeto = JSON.parse(b.store.wp_estado || "{}");
    ok(((conVeto.excl || {})["ford.csv"] || []).includes("roto"),
      "vetar una palabra no llega al blob de estado: al recargar vuelve el veto, " + b.store.wp_estado);
  }

  console.log("ok (" + n + " comprobaciones)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
