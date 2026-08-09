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
const FIELDS = "id,titulo,precio,categoria,ciudad,cp,km,dias,reservado,envio,url,vendedor,imagen,imagenes,descripcion".split(",");
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
    ev(b, 'rejected.add("a2"); save("wp_rejected", rejected)'); // a2 ya clasificado: no debe ir
    await b.q("#copyDeck").click();
    await flush();
    ok(b.spy.copied.length === 1, "#copyDeck no copió nada");
    const t = b.spy.copied[0];
    ok(t.includes("a1") && t.includes("a3") && !t.includes("a2"),
      "#copyDeck copió los anuncios equivocados");
    ok(JSON.parse(b.store.wp_aisent || "{}").ids.join() === "a1,a3",
      "#copyDeck no dejó anotado el lote enviado (wp_aisent), sin él el ?keep= no sabe qué rechazar");
  }

  // ── 6. copiar favoritos (#copyFav / #exportFav): sin favoritos avisa y no copia ──
  {
    const b = await loaded();
    await b.q("#copyFav").click();
    await flush();
    ok(b.spy.copied.length === 0, "#copyFav copió sin haber favoritos");
    ok(String(b.q("#snackmsg").textContent).includes("favoritos"), "#copyFav no avisó de que no hay favoritos");
    ev(b, 'favorite.add("a1"); save("wp_favorite", favorite)');
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
    ev(b, 'favorite.add("a1"); save("wp_favorite", favorite)');
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
    ev(b, 'rejected.add("a1"); rejected.add("a2"); save("wp_rejected", rejected); render()');
    b.q("#toggleTrash").click();
    ok(ev(b, "view") === "rejected", "#toggleTrash no abrió la papelera");
    // seleccionar todo + restaurar la selección
    b.q("#rejectedSelAll").dispatch("change", { target: { checked: true } });
    ok(ev(b, "rejectedSel.size") === 2, "#rejectedSelAll no seleccionó los rechazados visibles");
    b.q("#rejectedRestoreSel").click();
    ok(bucket(b, "rejected").length === 0, "#rejectedRestoreSel no restauró los seleccionados");
    // vaciar papelera: con confirm en "no" no toca nada
    ev(b, 'rejected.add("a1"); save("wp_rejected", rejected); render()');
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
    ev(b, 'favorite.add("a1"); save("wp_favorite", favorite); render()');
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
    ev(b, 'favorite.add("a1"); favorite.add("a3"); save("wp_favorite", favorite); view = "favorite"; render()');
    const lb = ev(b, 'document.querySelectorAll("#listSort button")').find((x) => x.dataset.sort === "precio");
    lb.click();
    ok(ev(b, 'filteredRows().map((r) => col(r, "precio")).join()') === "50,1000",
      "#listSort precio no ordenó la lista de favoritos");
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
    b.q("#rejectedExcl").click();
    ok(bucket(b, "rejected").join() === "a3", "#rejectedExcl no mandó a la papelera lo vetado");
  }

  // ── 21. gestor de búsquedas: los 4 botones de cada tarjeta ──
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
    ev(b, 'favorite.add("a1"); favorite.add("a2"); save("wp_favorite", favorite); view = "favorite"; render()');
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
    ev(b, 'favorite.add("a1"); save("wp_favorite", favorite); view = "favorite"; render()');
    const quitar = byClass(b.q("tbody"), "quitar");
    ok(quitar.length === 1 && String(quitar[0].textContent) === "Quitar",
      "la fila de favoritos no pintó su botón Quitar");
    quitar[0].click();
    ok(!bucket(b, "favorite").includes("a1"), "'Quitar' no sacó el anuncio de favoritos");
    ok(bucket(b, "rejected").includes("a1"), "'Quitar' desde favoritos debería rechazar el anuncio");
    ev(b, 'view = "rejected"; render()');
    const restaurar = byClass(b.q("tbody"), "quitar");
    ok(String(restaurar[0].textContent) === "Restaurar", "en la papelera el botón debería decir Restaurar");
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

  // ── 26. banner de vendedores del mazo: "Rechazar siguientes" bloquea al vendedor ──
  {
    const b = await loaded({ csv: CSV_ANA });
    ev(b, 'rejected.add("a1"); rejected.add("a3"); save("wp_rejected", rejected); render()');
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

  console.log("ok (" + n + " comprobaciones)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
