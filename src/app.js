// ── parser CSV (respeta comas, comillas y saltos dentro de campo) ──
function parseCSV(text) {
  const rows = [[]];
  let field = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      rows[rows.length - 1].push(field);
      field = "";
    } else if (c === "\r") {
    } else if (c === "\n") {
      rows[rows.length - 1].push(field);
      field = "";
      rows.push([]);
    } else field += c;
  }
  rows[rows.length - 1].push(field);
  if (rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "")
    rows.pop();
  return rows;
}
// ── estado persistente: localStorage (offline) + servidor (compartido) ──
const load = (k) => new Set(JSON.parse(localStorage.getItem(k) || "[]"));
const BUCKET_KEYS = new Set(["wp_rejected", "wp_interested", "wp_favorite"]);
const save = (k, set) => {
  localStorage.setItem(k, JSON.stringify([...set]));
  if (BUCKET_KEYS.has(k)) saveRows(); // cambió un cubo: refresca/poda el cache de filas
  pushEstado();
};
const rejected = load("wp_rejected"),
  interested = load("wp_interested"), // "interesantes": sí preliminar del swipe
  favorite = load("wp_favorite"); // "favoritos": ascendidos desde interesantes (tras la IA). 3 cubos exclusivos; "sin ver" = ninguno
const aiseen = load("wp_aiseen"); // ids ya copiados a la IA: "copiar para IA" solo manda los nuevos
// cache de filas por id (objeto {columna:valor}). Permite ver interesantes/favoritos aunque su
// CSV no esté cargado (p.ej. al abrir un enlace ?fav=): el dato vive aquí, no solo en `data`.
let rowCache = {};
try { rowCache = JSON.parse(localStorage.getItem("wp_rows") || "{}"); } catch {}
const bucketed = (id) => interested.has(id) || favorite.has(id) || rejected.has(id);
const rowToObj = (r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]));
const objToRow = (o) => headers.map((h) => o[h] ?? ""); // reconstruye fila posicional con el esquema actual
function saveRows() {
  for (const r of data) { const id = col(r, "id"); if (id && bucketed(id)) rowCache[id] = rowToObj(r); } // refresca con lo cargado
  for (const id in rowCache) if (!bucketed(id)) delete rowCache[id]; // poda lo que ya no está en ningún cubo
  localStorage.setItem("wp_rows", JSON.stringify(rowCache));
}
// filas de un cubo = las de `data` + las que solo viven en cache (de otras búsquedas)
function bucketRows(set) {
  const seen = new Set(), out = [];
  for (const r of data) { const k = key(r); if (set.has(k)) { seen.add(k); out.push(r); } }
  for (const id of set) if (!seen.has(id) && rowCache[id]) out.push(objToRow(rowCache[id]));
  return out;
}
const blockSel = load("wp_blocksel"); // vendedores bloqueados (user_id): sus anuncios van a la papelera solos, presentes y futuros
const saveBlockSel = () => {
  localStorage.setItem("wp_blocksel", JSON.stringify([...blockSel]));
  pushEstado();
};
let stamp = JSON.parse(localStorage.getItem("wp_stamp") || "{}"); // {key: epochMs}: cuándo se clasificó (para "descartado/destacado hace X"); legacy sin stamp no muestra línea
const stampNow = (k) => {
  stamp[k] = Date.now();
  localStorage.setItem("wp_stamp", JSON.stringify(stamp));
};
const unstamp = (k) => {
  if (k in stamp) {
    delete stamp[k];
    localStorage.setItem("wp_stamp", JSON.stringify(stamp));
  }
};
let exclMap = JSON.parse(localStorage.getItem("wp_excl") || "{}"); // {csv: [palabras]}: por query, cartas con la palabra en el título se auto-descartan (fuera del mazo)
const exclTerms = () => (curCsv && exclMap[curCsv]) || []; // palabras vetadas de la query activa
const saveExcl = () => {
  localStorage.setItem("wp_excl", JSON.stringify(exclMap));
  pushEstado();
};
let catExclMap = JSON.parse(localStorage.getItem("wp_catexcl") || "{}"); // {csv: [categorias]}: categorías vetadas por query (match exacto sobre la columna categoria)
const catExclTerms = () => (curCsv && catExclMap[curCsv]) || [];
const saveCatExcl = () => {
  localStorage.setItem("wp_catexcl", JSON.stringify(catExclMap));
  pushEstado();
};
let catModeMap = JSON.parse(localStorage.getItem("wp_catmode") || "{}"); // {csv: "incluir"}: si es "incluir", las categorías marcadas son las ÚNICAS que se conservan (resto a rechazados); por defecto "excluir"
const catMode = () => (curCsv && catModeMap[curCsv]) || "excluir";
const saveCatMode = () => {
  localStorage.setItem("wp_catmode", JSON.stringify(catModeMap));
  pushEstado();
};
let aliasMap = JSON.parse(localStorage.getItem("wp_alias") || "{}"); // {csv: "apodo"}: nombre legible por búsqueda; NO toca el CSV ni los keywords reales
const saveAlias = () => {
  localStorage.setItem("wp_alias", JSON.stringify(aliasMap));
  pushEstado();
};
// App 100% local: un solo usuario por navegador, sin perfiles. Estado en claves fijas.
// Migración one-shot del modelo multi-perfil: adopta el estado del perfil activo (wp_perfil)
// a las claves fijas y retira los índices de perfiles. Las claves viejas wp_*_<nombre>
// quedan inertes (no se borran: revertir la rama restauraría los perfiles con sus datos).
(function migrateFromPerfiles() {
  const old = localStorage.getItem("wp_perfil");
  if (old)
    for (const b of ["wp_estado", "wp_searches", "wp_lastcsv", "wp_lastseen"])
      if (localStorage.getItem(b) == null) {
        const v = localStorage.getItem(b + "_" + old);
        if (v != null) localStorage.setItem(b, v);
      }
  localStorage.removeItem("wp_perfil");
  localStorage.removeItem("wp_perfiles");
})();
const estadoKey = () => "wp_estado"; // estado durable (un usuario por navegador)
function pushEstado() {
  localStorage.setItem(
    estadoKey(),
    JSON.stringify({
      rejected: [...rejected],
      interested: [...interested],
      favorite: [...favorite],
      blockSel: [...blockSel],
      excl: exclMap,
      catExcl: catExclMap,
      catMode: catModeMap,
      alias: aliasMap,
      stamp,
    }),
  );
}
// carga el estado del perfil actual desde localStorage (fuente de verdad en estático)
function hydrateEstado() {
  let e = {};
  try {
    e = JSON.parse(localStorage.getItem(estadoKey()) || "{}");
  } catch {}
  {
    {
      // ponytail: doble bloque solo para conservar la indentación del cuerpo original intacta
      for (const [set, arr] of [
        [rejected, e.rejected],
        [interested, e.interested],
        [favorite, e.favorite],
      ]) {
        set.clear();
        (arr || []).forEach((x) => set.add(x));
      }
      // cubos exclusivos: limpia solapes heredados. Precedencia papelera > favoritos > interesantes.
      for (const k of favorite) if (rejected.has(k)) favorite.delete(k);
      for (const k of interested) if (rejected.has(k) || favorite.has(k)) interested.delete(k);
      blockSel.clear();
      (e.blockSel || []).forEach((x) => blockSel.add(x));
      localStorage.setItem("wp_blocksel", JSON.stringify([...blockSel]));
      exclMap =
        e.excl && typeof e.excl === "object" && !Array.isArray(e.excl)
          ? e.excl
          : {}; // {csv:[palabras]}; ignora formatos viejos
      catExclMap =
        e.catExcl && typeof e.catExcl === "object" && !Array.isArray(e.catExcl)
          ? e.catExcl
          : {}; // {csv:[categorias]}
      catModeMap =
        e.catMode && typeof e.catMode === "object" && !Array.isArray(e.catMode)
          ? e.catMode
          : {}; // {csv:"incluir"}
      aliasMap =
        e.alias && typeof e.alias === "object" && !Array.isArray(e.alias)
          ? e.alias
          : {}; // {csv:"apodo"}
      localStorage.setItem("wp_alias", JSON.stringify(aliasMap));
      stamp =
        e.stamp && typeof e.stamp === "object" && !Array.isArray(e.stamp)
          ? e.stamp
          : {}; // {key:epochMs} cuándo se clasificó
      localStorage.setItem("wp_stamp", JSON.stringify(stamp));
      localStorage.setItem("wp_rejected", JSON.stringify([...rejected])); // espejo offline
      localStorage.setItem("wp_interested", JSON.stringify([...interested]));
      localStorage.setItem("wp_favorite", JSON.stringify([...favorite]));
      localStorage.setItem("wp_excl", JSON.stringify(exclMap));
      localStorage.setItem("wp_catexcl", JSON.stringify(catExclMap));
      if (data.length) render();
    }
  }
  return Promise.resolve();
}

const HIDE = new Set(["id", "cp", "url", "vendedor", "imagen", "imagenes"]); // no se muestran como columna (url va en el boton Ver; vendedor/imagen(es) se usan en la tarjeta/dossier)
// esquema fijo del scraper (== FIELDS de scrape.js). Sirve de headers por defecto para poder
// renderizar favoritos/interesantes desde el cache aunque no se haya scrapeado nada esta sesión.
const DEFAULT_HEADERS = ["id", "titulo", "precio", "categoria", "ciudad", "cp", "km", "dias",
  "reservado", "envio", "url", "vendedor", "imagen", "imagenes", "descripcion"];
let headers = DEFAULT_HEADERS.slice(),
  data = [],
  sortKeys = [],
  view = ""; // view: '' mazo | 'rejected' papelera | 'interested' interesantes | 'favorite' favoritos
const rejectedSel = new Set(); // selección en masa de la papelera (keys); solo viva en view==='rejected'
let iId = headers.indexOf("id"),
  iUrl = headers.indexOf("url"),
  iTitulo = headers.indexOf("titulo"),
  iPrecio = headers.indexOf("precio");
const isNum = (v) => v !== "" && !isNaN(v);
// identidad GLOBAL del anuncio = id inmutable de Wallapop (rechazados/interesantes/favoritos
// son globales, no por CSV). Fallback titulo|precio solo para drag de CSV sin id.
const itemId = (r) => (iId >= 0 && r[iId]) || r[iTitulo] + "|" + r[iPrecio];
const key = (r) => itemId(r); // GLOBAL por id de Wallapop: un anuncio se clasifica igual venga de la búsqueda que venga -> la IA puede marcar favoritos con ?fav=<ids>

// --- precio final estimado al comprador (envío protegido de Wallapop) ---
// tarifa de envío por tramo de peso (up_to_kg), verificada contra la API: kg <= tope -> €
const SHIP = [
  [2, 3.5],
  [5, 4.5],
  [10, 6.5],
  [20, 9.5],
  [30, 14.5],
];
const porte = (kg) => (SHIP.find(([b]) => kg <= b) || SHIP[SHIP.length - 1])[1];
// ponytail: comisión de protección ~0,70€ + 5% del precio; las fuentes divergen (5–10%),
// ajústalo aquí si cambia. Un solo sitio para toda la app.
const finalPrice = (precio, kg = 5) => precio + 0.7 + 0.05 * precio + porte(kg);
// peso real (tramo up_to_kg) por id, cacheado del detalle de la API (botón "Precio exacto").
// número -> porte exacto; sin entrada -> se estima con 5 kg y un '*'.
let pesos = JSON.parse(localStorage.getItem("wp_pesos") || "{}");
console.assert(
  porte(1.5) === 3.5 &&
    porte(2) === 3.5 &&
    porte(2.1) === 4.5 &&
    porte(40) === 14.5,
  "porte() por tramo roto",
);
console.assert(
  finalPrice(50, 1.5).toFixed(2) === "56.70" &&
    finalPrice(50).toFixed(2) === "57.70",
  "finalPrice roto",
);
// número → precio con 1 decimal COMO MÁXIMO (sin ",0" sobrante), coma decimal a la española.
// 90 -> "90", 90.0 -> "90", 92.75 -> "92,8", "7990.0" -> "7990". No numérico: se muestra tal cual.
const dec1 = (n) => {
  const x = +n;
  if (!isFinite(x)) return String(n);
  const r = Math.round(x * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
};
console.assert(
  dec1(90) === "90" &&
    dec1("90.0") === "90" &&
    dec1(92.75) === "92,8" &&
    dec1("7990.0") === "7990" &&
    dec1(78.7) === "78,7",
  "dec1() roto",
);
const eur = (n) => dec1(n) + "€"; // 78.7 -> "78,7 €"

const $ = (s) => document.querySelector(s);
const thead = $("thead"),
  tbody = $("tbody");
// ── iconos: SVG inline de Lucide (MIT), heredan color con currentColor ──
const ICON = {
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  favorite: '<path d="M11.5 2.3 8.9 8.6 2.2 9.2c-.9.1-1.2 1.2-.5 1.8l5 4.4-1.5 6.5c-.2.9.7 1.6 1.5 1.1l5.8-3.5 5.8 3.5c.8.5 1.7-.2 1.5-1.1l-1.5-6.5 5-4.4c.7-.6.4-1.7-.5-1.8l-6.7-.6L13 2.3c-.3-.8-1.4-.8-1.7 0Z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  rejected:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const ic = (n) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((e) => (e.innerHTML = ic(e.dataset.icon)));

// "hace X" a partir de los días (float) del CSV: una sola unidad (min→h→día), <1 minuto por debajo
function humanAge(dias) {
  const min = Math.max(0, Math.floor(dias * 1440));
  if (min < 1) return "hace <1 minuto";
  if (min < 60) return `hace ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
console.assert(
  humanAge(16.8) === "hace 16 días" &&
    humanAge(1) === "hace 1 día" &&
    humanAge(0.05) === "hace 1 hora" &&
    humanAge(21 / 1440) === "hace 21 minutos" &&
    humanAge(0) === "hace <1 minuto",
  "humanAge() roto",
);
// edad REAL del anuncio ahora = la congelada en el CSV (dias, medida al scrapear)
// + lo transcurrido desde el scrape. curCsvScrape = Last-Modified del CSV; sin él, solo la congelada.
function adAge(dias) {
  const elapsed = curCsvScrape ? Math.max(0, (Date.now() - curCsvScrape) / 86400000) : 0;
  return humanAge(+dias + elapsed);
}

// "hace 3 min / 5 h / 2 días" desde un epochMs: cuándo se descartó/destacó (granularidad min→h→día)
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
console.assert(
  ago(Date.now() - 3 * 60000) === "hace 3 min" &&
    ago(Date.now() - 5 * 3600000) === "hace 5 h" &&
    ago(Date.now() - 2 * 86400000) === "hace 2 días" &&
    ago(Date.now()) === "hace un momento",
  "ago() roto",
);

// tarjeta compuesta (Destacados/Papelera + swipe): precio + ubicación + antigüedad + flags + descripción
function fillCard(el, r) {
  const add = (cls, txt) => {
    const e = document.createElement("div");
    e.className = cls;
    e.textContent = txt;
    el.append(e);
    return e;
  };
  const precio = col(r, "precio"),
    km = col(r, "km"),
    ciudad = col(r, "ciudad"),
    dias = col(r, "dias");

  // media: la foto a sangre con la etiqueta de precio y la frescura superpuestas
  const conEnvio = col(r, "envio") === "True";
  const media = document.createElement("div");
  media.className = "li-media";
  const img = col(r, "imagen");
  if (img) {
    const im = document.createElement("img");
    im.className = "li-img";
    im.loading = "lazy";
    im.src = img;
    im.onerror = () => im.remove(); // si falla, queda el fondo neutro del media
    media.append(im);
  }
  // etiqueta de precio: el chollo. Chip teal sobre la foto (con envío = precio final estimado)
  const price = document.createElement("span");
  price.className = "li-price";
  if (conEnvio && isNum(precio)) {
    const kg = pesos[col(r, "id")]; // peso real cacheado; si no hay, 5 kg
    const exact = typeof kg === "number";
    price.textContent = eur(finalPrice(+precio, exact ? kg : undefined));
  } else {
    price.textContent = precio !== "" ? `${dec1(precio)}€` : "—";
  }
  media.append(price);
  // frescura: chip esmerilado en la esquina superior (sin color de urgencia)
  if (isNum(dias)) {
    const a = document.createElement("span");
    a.className = "li-age";
    a.textContent = adAge(dias);
    media.append(a);
  }
  el.append(media);

  // cuándo se clasificó: línea sutil encima del título (solo papelera/destacados con marca de tiempo)
  if (view !== "" && stamp[key(r)])
    add(
      "li-when" + (view === "interested" || view === "favorite" ? " interested" : ""),
      `${view === "favorite" ? "Favorito" : view === "interested" ? "Interesante" : "Rechazado"} ${ago(stamp[key(r)])}`,
    );

  add("li-title", col(r, "titulo"));

  // envío + distancia: metadato limpio bajo el título
  let where = km !== "" ? `a ${km} km` : "";
  if (ciudad) where += (where ? " " : "") + `(${ciudad})`;
  const flags = add("li-flags", "");
  const ship = document.createElement("span");
  ship.className = "ship" + (conEnvio ? "" : " no"); // "sin envío" en naranja
  ship.textContent = conEnvio ? "Con envío" : "Sin envío";
  flags.append(ship);
  if (where) flags.append(document.createTextNode(`, ${where}`));

  const desc = col(r, "descripcion");
  if (desc) add("li-desc", desc);
}
function listBody(r) {
  const td = document.createElement("td");
  td.className = "li";
  fillCard(td, r);
  return td;
}

// orden multinivel: clic añade columna como siguiente prioridad; reclic invierte
function toggleSort(col) {
  const k = sortKeys.find((s) => s.col === col);
  if (k) k.dir = -k.dir;
  else sortKeys.push({ col, dir: 1 });
  paintSortHeaders();
  render();
}
function paintSortHeaders() {
  thead.querySelectorAll("th[data-col]").forEach((th) => {
    const idx = sortKeys.findIndex((s) => s.col === +th.dataset.col);
    if (idx < 0) {
      th.classList.remove("sorted");
      th.removeAttribute("data-dir");
    } else {
      th.classList.add("sorted");
      const s = sortKeys[idx];
      th.dataset.dir =
        (sortKeys.length > 1 ? idx + 1 + " " : "") + (s.dir > 0 ? "▲" : "▼");
    }
  });
}
function clearSort() {
  sortKeys = [];
  paintSortHeaders();
  render();
}

// barra de orden de las listas: reclic invierte; "Entrada" (data-sort="") = orden de llegada
function applyListSort(name) {
  if (name === listSort) listSortDir = -listSortDir;
  else {
    listSort = name;
    listSortDir = name ? 1 : -1;
  } // columnas asc (barato/cerca/reciente); entrada: recién añadido arriba
  render();
}
function paintListSort() {
  document.querySelectorAll("#listSort button").forEach((b) => {
    const on = b.dataset.sort === listSort;
    b.classList.toggle("on", on);
    b.dataset.dir = on ? (listSortDir > 0 ? "▲" : "▼") : "";
  });
}
document
  .querySelectorAll("#listSort button")
  .forEach((b) => (b.onclick = () => applyListSort(b.dataset.sort)));

// filas visibles con el orden actual (compartido por tabla y modo swipe)
let listQ = ""; // filtro de texto de la pantalla de lista (papelera/destacados)
let listSeller = ""; // filtro por vendedor en la papelera (desde el banner: "ver" rechazados de un vendedor)
const isExcluded = (r) => {
  // vetada por la query activa: categoría exacta o palabra en el título
  const cats = catExclTerms();
  if (cats.length) {
    const hit = cats.includes(col(r, "categoria"));
    // modo "incluir": solo se conservan las marcadas (fuera lo demás); "excluir": fuera las marcadas
    if (catMode() === "incluir" ? !hit : hit) return true;
  }
  const t = norm(r[iTitulo] || "");
  return exclTerms().some((w) => t.includes(w));
};
// "lejos sin envío": a más de N km y sin envío, difícil en la práctica. Entran al mazo como cualquiera; su línea en el stat es un atajo para rechazarlos en bloque (o auto-rechazo con el ajuste).
let lejosKm = +localStorage.getItem("wp_lejoskm") || 10; // umbral configurable (Ajustes)
const isLejos = (r) => {
  const km = col(r, "km");
  return km !== "" && +km > lejosKm && col(r, "envio") !== "True";
};
let autoExclLejos = localStorage.getItem("wp_autoexcllejos") === "1"; // si activo, los lejos-sin-envío van solos a la papelera (Ajustes)
// compara dos celdas: numérica si ambas lo son (vacío = -∞), si no alfabética con acentos
function cmpCell(x, y) {
  if ((x === "" || isNum(x)) && (y === "" || isNum(y))) {
    x = x === "" ? -Infinity : +x;
    y = y === "" ? -Infinity : +y;
    return x - y;
  }
  return x.localeCompare(y, "es", { numeric: true });
}
// orden de la lista (papelera/destacados): '' = momento de entrada (Set preserva inserción) | columna del CSV
let listSort = "",
  listSortDir = -1; // por defecto: recién añadido arriba
function sortList(rows) {
  if (!listSort) {
    const order = [...(view === "rejected" ? rejected : view === "favorite" ? favorite : interested)]; // orden de llegada a la lista
    const pos = new Map(order.map((k, i) => [k, i]));
    rows.sort(
      (a, b) =>
        ((pos.get(key(a)) ?? -1) - (pos.get(key(b)) ?? -1)) * listSortDir,
    );
    return;
  }
  const c = headers.indexOf(listSort);
  if (c < 0) return;
  rows.sort((a, b) => cmpCell(a[c], b[c]) * listSortDir);
}

function filteredRows() {
  const listView = view === "rejected" || view === "interested" || view === "favorite";
  if (listView) {
    const q = norm(listQ); // el filtro solo aplica en vista de lista
    const set = view === "rejected" ? rejected : view === "interested" ? interested : favorite;
    const rows = bucketRows(set).filter((r) => {
      // "#123" filtra por id de Wallapop; cualquier otra cosa, por título
      if (q) {
        if (q.startsWith("#")) {
          if (!String(col(r, "id") || "").includes(q.slice(1).trim())) return false;
        } else if (!norm(col(r, "titulo") || "").includes(q)) return false;
      }
      if (view === "rejected" && listSeller && col(r, "vendedor") !== listSeller) return false;
      return true; // pertenencia al cubo ya garantizada por bucketRows
    });
    sortList(rows); // las listas ordenan con su barra (#listSort)
    return rows;
  }
  const rows = data.filter((r) => {
    const k = key(r);
    return !interested.has(k) && !rejected.has(k) && !favorite.has(k) && !isExcluded(r); // mazo: sin clasificar y sin vetar (los lejos-sin-envío también entran)
  });
  if (sortKeys.length)
    rows.sort((a, b) => {
      // mazo/swipe: orden multinivel
      for (const { col, dir } of sortKeys) {
        const c = cmpCell(a[col], b[col]);
        if (c) return c * dir;
      }
      return 0;
    });
  return rows;
}

// ajuste activo: manda solos los lejos-sin-envío al grupo de excluidos (igual que el enlace "excluir", pero automático)
function enforceLejos() {
  if (!autoExclLejos) return;
  let changed = false;
  for (const r of data) {
    const k = key(r);
    if (!interested.has(k) && !rejected.has(k) && !favorite.has(k) && isLejos(r)) {
      rejected.add(k);
      stampNow(k);
      changed = true;
    }
  }
  if (changed) save("wp_rejected", rejected);
}

function render() {
  enforceBlocks(); // vendedores bloqueados a la papelera antes de filtrar
  enforceLejos(); // auto-exclusión de lejos-sin-envío si el ajuste está activo
  const rows = filteredRows();
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const k = key(r);
    const tr = document.createElement("tr");

    // celda de acciones: Ver y Quitar grandes, uno al lado del otro
    const act = document.createElement("td");
    act.className = "act";
    if (view === "rejected") {
      // checkbox de selección en masa: primero en la fila, antes de Ver/Restaurar
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "tb-check";
      cb.checked = rejectedSel.has(k);
      cb.title = "seleccionar";
      cb.onchange = () => {
        cb.checked ? rejectedSel.add(k) : rejectedSel.delete(k);
        paintRejectedBulk();
      };
      act.append(cb);
    }
    const url = iUrl >= 0 ? r[iUrl] : "";
    const ver = document.createElement("a");
    ver.className = "btn ver";
    ver.textContent = "Ver";
    if (url) {
      ver.href = url;
      ver.target = "_blank";
    } else {
      ver.setAttribute("aria-disabled", "true");
    }
    const quit = document.createElement("button");
    quit.className = "btn quitar";
    quit.textContent = view === "rejected" ? "Restaurar" : "Quitar";
    quit.onclick = () =>
      view === "rejected"
        ? restore(k)
        : view === "favorite"
          ? unfavorite(k) // favoritos → interesantes
          : reject(k, r[iTitulo]);
    if (view === "interested") {
      // en interesantes: botón para ascender a favoritos (tras el veredicto de la IA)
      const pr = document.createElement("button");
      pr.className = "btn destacar";
      pr.innerHTML = ic("favorite") + "Favorito";
      pr.title = "pasar a favoritos";
      pr.onclick = () => toFavorite(k);
      act.append(ver, pr, quit);
    } else act.append(ver, quit);
    tr.append(act);

    tr.append(listBody(r));
    frag.append(tr);
  }
  tbody.append(frag);
  const listView = view === "rejected" || view === "interested" || view === "favorite";
  $("table").hidden = !(listView && headers.length); // la tabla es la vista de lista editable (interesantes/favoritos/papelera)
  // pantalla dedicada: en modo lista se oculta TODO el header de búsqueda y sale la barra de lista
  document.querySelector("header").classList.toggle("pinned", listView); // fija la barra solo en modo lista (ver CSS)
  $(".brand").hidden = listView;
  $("#tut").hidden = true; // ponytail: tutorial oculto por ahora (se rehará bien en el futuro)
  if (listView) {
    tut.querySelector(".on")?.classList.remove("on");
    tutMsg.hidden = true;
    document.body.classList.remove("tut-on");
  }
  document
    .querySelectorAll("header .panel")
    .forEach((p) => (p.hidden = listView)); // varios paneles ahora (perfil, buscar, query activa)
  $("#listHead").hidden = !listView;
  if (!listView && listQ) {
    listQ = "";
    $("#listFilter").value = "";
  } // el filtro no sobrevive al salir de la lista
  if (!listView) listSeller = ""; // ni el filtro por vendedor
  if (listView)
    $("#listTitle").textContent =
      view === "favorite"
        ? "Favoritos"
        : view === "interested"
          ? "Interesantes"
          : listSeller
            ? "Rechazados del vendedor"
            : "Rechazados";
  // copiar para la IA + precio exacto: solo sobre interesantes (el paso previo a decidir favoritos)
  $("#exportInterested").hidden = !(view === "interested" && rows.length);
  $("#dossierFav").hidden = !(view === "favorite" && rows.length);
  const interestedConEnvio =
    view === "interested" && rows.some((r) => col(r, "envio") === "True");
  $("#priceNote").hidden = !interestedConEnvio; // la nota explica ese precio final: mismo criterio que el botón
  const hasRows = headers.length && rows.length;
  $("#swipeFab").hidden = !hasRows || listView; // en modo lista se edita en la tabla, no se hace swipe
  if (!listView && hasRows) $("#swipeFab").textContent = "REBUSCAR";
  const interestedN = data.filter((r) => interested.has(key(r))).length;
  const showCopy = !listView && headers.length && !rows.length && interestedN; // ya rebuscado todo y hay destacados: ofrece exportarlos a una IA
  $("#copyInterested").hidden = !showCopy;
  $("#empty").hidden = !!hasRows || showCopy; // el botón ocupa el hueco de REBUSCAR (mismo sitio); sin "Nada que revisar" que lo empuje abajo
  if (headers.length && !rows.length)
    $("#empty").textContent =
      listView && listQ
        ? "Nada coincide con el filtro."
        : view === "rejected"
          ? "No hay rechazados."
          : view === "interested"
            ? "Sin interesantes todavía."
            : view === "favorite"
              ? "Sin favoritos todavía."
              : "Nada que revisar.";
  paintStat();
  paintSellerBanner();
  paintListSort();
  paintRejectedBulk();
  renderExcl();
  renderCats();
  reconcileBack();
}

// chips de categorías presentes en la query (con nº de cartas); clic veta/reactiva la categoría
function renderCats() {
  const box = $("#cats");
  if (!box) return;
  const show =
    headers.length && view === "" && curCsv && headers.includes("categoria");
  box.hidden = !show;
  const chips = $("#catChips");
  chips.innerHTML = "";
  if (!show) return;
  const counts = {};
  for (const r of data) {
    const c = col(r, "categoria");
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  const excl = catExclTerms();
  const inc = catMode() === "incluir";
  for (const c of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) {
    const b = document.createElement("button");
    const inList = excl.includes(c);
    const off = inc ? !inList : inList; // "off" = queda fuera del mazo
    b.className = "chip cat-chip" + (off ? " off" : "");
    b.textContent = `${c} (${counts[c]})`; // textContent: a prueba de < & en el nombre
    b.onclick = () => {
      const cur = catExclMap[curCsv] || (catExclMap[curCsv] = []);
      const i = cur.indexOf(c);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(c);
      if (!cur.length) delete catExclMap[curCsv];
      saveCatExcl();
      render();
    };
    chips.append(b);
  }
  $("#catLabel").textContent = inc ? "Incluir solo categorías" : "Excluir por categoría";
  $("#catCount").textContent = excl.length ? ` (${excl.length})` : ""; // nº de categorías marcadas, nada si 0
  const mode = $("#catMode"); // alterna excluir/incluir para esta búsqueda
  mode.textContent = inc ? "cambiar a modo excluir" : "cambiar a modo incluir";
  mode.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inc) delete catModeMap[curCsv];
    else catModeMap[curCsv] = "incluir";
    saveCatMode();
    render();
  };
  const clr = $("#catClear"); // limpiar (en el summary): reactiva todas las categorías marcadas
  clr.hidden = !excl.length;
  clr.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    delete catExclMap[curCsv];
    saveCatExcl();
    render();
  };
}

// añade/quita una palabra de la exclusión de la query activa (compartido main + swipe)
function addExcl(raw) {
  // true si cambió; norma la palabra, evita duplicados
  const w = norm(raw);
  if (!w || !curCsv || exclTerms().includes(w)) return false;
  (exclMap[curCsv] ||= []).push(w);
  saveExcl();
  return true;
}
function delExcl(w) {
  exclMap[curCsv] = exclTerms().filter((x) => x !== w);
  if (!exclMap[curCsv].length) delete exclMap[curCsv];
  saveExcl();
}
// pinta chips de palabras vetadas en un contenedor; onChange se llama al quitar una
function fillExclChips(chips, onChange) {
  chips.innerHTML = "";
  for (const w of exclTerms()) {
    const b = document.createElement("button");
    b.className = "chip excl-chip";
    b.textContent = w + " ✕"; // textContent: sin inyección desde texto de usuario
    b.title = "quitar exclusión";
    b.onclick = () => {
      delExcl(w);
      onChange();
    };
    chips.append(b);
  }
}
// chips de palabras vetadas de la query activa (solo con CSV cargado y fuera de las vistas de lista)
function renderExcl() {
  const box = $("#excl");
  if (!box) return;
  box.hidden = !(headers.length && view === "" && curCsv);
  fillExclChips($("#exclChips"), render);
}

function paintStat() {
  if (!headers.length) {
    $("#stat").innerHTML = "";
    return;
  }
  const clasif = (r) =>
    interested.has(key(r)) || rejected.has(key(r)) || favorite.has(key(r)); // ya en algún cubo
  const interestedRows = data.filter((r) => interested.has(key(r))).length;
  const favoriteCount = data.filter((r) => favorite.has(key(r))).length;
  const disc = data.filter((r) => rejected.has(key(r))).length;
  const hasExcl = exclTerms().length || catExclTerms().length; // ad-hoc: palabra en título o categoría
  const vetados = hasExcl
    ? data.filter((r) => !clasif(r) && isExcluded(r)).length
    : 0;
  const lejos = data.filter(
    (r) => !clasif(r) && !isExcluded(r) && isLejos(r),
  ).length;
  const sinVer = data.length - interestedRows - favoriteCount - disc - vetados; // "vistos" = interestedRows + favoriteCount + disc; vetados salen aparte. Los lejos SÍ cuentan (están en el mazo); su línea es solo atajo para rechazarlos en bloque
  $("#stat").innerHTML =
    `<span><b>${sinVer}</b> sin ver</span>` +
    (vetados
      ? `<span><b>${vetados}</b> excluidos · <span class="link" id="rejectedExcl">mandar a rechazados</span></span>`
      : "") +
    (lejos
      ? `<span><b>${lejos}</b> de ellos lejos y sin envío · <span class="link" id="rejectedLejos">rechazar</span></span>`
      : "") +
    `<span><b>${disc}</b> rechazados ` +
    (disc || view === "rejected"
      ? `· <span class="link" id="toggleTrash">${view === "rejected" ? "volver" : "ver rechazados"}</span>`
      : "") +
    `</span>` +
    `<span><b>${interestedRows}</b> interesantes ` +
    (interestedRows || view === "interested"
      ? `· <span class="link" id="toggleInterested">${view === "interested" ? "volver" : "ver interesantes"}</span>`
      : "") +
    `</span>` +
    `<span><b>${favoriteCount}</b> favoritos ` +
    (favoriteCount || view === "favorite"
      ? `· <span class="link" id="toggleFavorite">${view === "favorite" ? "volver" : "ver favoritos"}</span>`
      : "") +
    `</span>` +
    (sortKeys.length
      ? `<span>orden: <b>${sortKeys.map((s) => headers[s.col]).join(" › ")}</b> · <span class="link" id="clearSort">limpiar</span></span>`
      : "");
  const toggle = (v) => () => {
    view = view === v ? "" : v;
    listSeller = "";
    sellerReturn = false;
    $("#empty").textContent = "";
    render();
  };
  const t = $("#toggleTrash");
  if (t) t.onclick = toggle("rejected");
  const f = $("#toggleInterested");
  if (f) f.onclick = toggle("interested");
  const st = $("#toggleFavorite");
  if (st) st.onclick = toggle("favorite");
  const el = $("#rejectedLejos");
  if (el) el.onclick = rejectedLejos;
  const te = $("#rejectedExcl");
  if (te) te.onclick = rejectedExcluded;
  const cs = $("#clearSort");
  if (cs) cs.onclick = clearSort;
}

// manda los "lejos y sin envío" actuales a la papelera de una vez (deshacer: los saca)
function rejectedLejos() {
  const ks = data
    .filter(
      (r) =>
        !interested.has(key(r)) && !rejected.has(key(r)) && !favorite.has(key(r)) && isLejos(r),
    )
    .map(key);
  if (!ks.length) return;
  ks.forEach((k) => {
    rejected.add(k);
    stampNow(k);
  });
  save("wp_rejected", rejected);
  render();
  snack(`${ks.length} lejos a la papelera`, () => {
    ks.forEach((k) => {
      rejected.delete(k);
      unstamp(k);
    });
    save("wp_rejected", rejected);
    render();
  });
}
// manda todos los excluidos actuales a la papelera de una vez (deshacer: los saca)
function rejectedExcluded() {
  const ks = data
    .filter(
      (r) =>
        !interested.has(key(r)) &&
        !rejected.has(key(r)) &&
        !favorite.has(key(r)) &&
        isExcluded(r),
    )
    .map(key);
  if (!ks.length) return;
  ks.forEach((k) => {
    rejected.add(k);
    stampNow(k);
  });
  save("wp_rejected", rejected);
  render();
  snack(
    `${ks.length} excluido${ks.length === 1 ? "" : "s"} a la papelera`,
    () => {
      ks.forEach((k) => {
        rejected.delete(k);
        unstamp(k);
      });
      save("wp_rejected", rejected);
      render();
    },
  );
}

// restaurar un item de vendedor bloqueado exige desbloquearlo: si no, enforceBlocks lo re-rechaza
// en el próximo render. Desbloquear no reinunda (enforceBlocks solo añade): los demás ya-rechazados
// del vendedor siguen en la papelera; solo dejan de auto-rechazarse los futuros.
function unblockFor(ks) {
  const sellers = new Set(
    ks
      .map((k) => data.find((r) => key(r) === k))
      .filter(Boolean)
      .map((r) => col(r, "vendedor"))
      .filter((s) => s && blockSel.has(s)),
  );
  sellers.forEach((s) => blockSel.delete(s));
  if (sellers.size) saveBlockSel();
  return sellers; // el deshacer los re-bloquea
}
function reblock(sellers) {
  if (!sellers.size) return;
  sellers.forEach((s) => blockSel.add(s));
  saveBlockSel();
}

// ── gestión en masa de la papelera (solo view==='rejected') ──
// restaura varias keys a "sin ver" de una vez, con deshacer que reconstruye rejected + stamps
function bulkRestore(ks, msg) {
  if (!ks.length) return;
  const snap = ks.map((k) => [k, stamp[k]]); // stamp previo para restaurar el "rechazado hace X" al deshacer
  const unblocked = unblockFor(ks);
  ks.forEach((k) => {
    rejected.delete(k);
    unstamp(k);
  });
  rejectedSel.clear();
  save("wp_rejected", rejected);
  render();
  snack(msg, () => {
    snap.forEach(([k, s]) => {
      rejected.add(k);
      if (s !== undefined) stamp[k] = s;
    });
    reblock(unblocked);
    localStorage.setItem("wp_stamp", JSON.stringify(stamp));
    save("wp_rejected", rejected);
    render();
  });
}
// barra de acciones en masa: nº seleccionado, estado del "seleccionar todo", visibilidad
function paintRejectedBulk() {
  const bar = $("#rejectedBulk");
  if (!bar) return;
  const on = view === "rejected";
  const anyRejected = on && data.some((r) => rejected.has(key(r)));
  bar.hidden = !anyRejected;
  if (!on) {
    rejectedSel.clear();
    return;
  } // salir de la papelera limpia la selección
  const visible = filteredRows().map(key); // solo lo visible ahora (respeta el filtro de texto)
  for (const k of [...rejectedSel]) if (!visible.includes(k)) rejectedSel.delete(k); // purga lo que ya no se ve
  const n = rejectedSel.size;
  const all = visible.length && visible.every((k) => rejectedSel.has(k));
  const selAll = $("#rejectedSelAll");
  selAll.checked = !!all;
  selAll.indeterminate = n > 0 && !all;
  const rs = $("#rejectedRestoreSel");
  rs.hidden = !n;
  rs.textContent = `Restaurar (${n})`;
}
$("#rejectedSelAll").onchange = (e) => {
  const visible = filteredRows().map(key);
  if (e.target.checked) visible.forEach((k) => rejectedSel.add(k));
  else rejectedSel.clear();
  render();
};
$("#rejectedRestoreSel").onclick = () => {
  const n = rejectedSel.size;
  bulkRestore([...rejectedSel], `${n} restaurado${n === 1 ? "" : "s"}`);
};
$("#rejectedEmpty").onclick = () => {
  const ks = data.filter((r) => rejected.has(key(r))).map(key); // rechazados del CSV actual (ignora el filtro)
  if (!ks.length) return;
  if (!confirm(`¿Restaurar los ${ks.length} rechazados de esta búsqueda?`))
    return;
  bulkRestore(ks, `${ks.length} rechazado${ks.length === 1 ? "" : "s"} a sin ver`);
};

// ── auto-rechazo por vendedor ──
// vendedores bloqueados: sus items del CSV actual van a la papelera solos (idempotente, sin snack)
function enforceBlocks() {
  if (!blockSel.size || !headers.includes("vendedor")) return;
  let changed = false;
  for (const r of data) {
    const s = col(r, "vendedor");
    if (!s || !blockSel.has(s)) continue;
    const k = key(r);
    if (!rejected.has(k)) {
      interested.delete(k);
      favorite.delete(k);
      rejected.add(k);
      stampNow(k);
      changed = true;
    }
  }
  if (changed) {
    save("wp_interested", interested);
    save("wp_favorite", favorite);
    save("wp_rejected", rejected);
  }
}
// candidatos a bloqueo: vendedor con ≥2 rechazados y ≥1 anuncio fresco en el CSV actual, no bloqueado aún
function sellerCandidates() {
  if (!headers.includes("vendedor")) return [];
  const rej = {},
    fresh = {};
  for (const r of data) {
    const s = col(r, "vendedor");
    if (!s) continue;
    const k = key(r);
    if (rejected.has(k)) rej[s] = (rej[s] || 0) + 1;
    else if (!interested.has(k) && !isExcluded(r) && !isLejos(r))
      (fresh[s] = fresh[s] || []).push(r);
  }
  return Object.keys(rej)
    .filter((s) => rej[s] >= 2 && fresh[s] && !blockSel.has(s))
    .map((s) => ({ s, rejected: rej[s], fresh: fresh[s] }))
    .sort((a, b) => b.rejected - a.rejected);
}
// bloquear vendedor: manda sus frescos a la papelera; deshacer = desbloquear + restaurar esos
function blockSeller(s) {
  const newly = data
    .filter((r) => col(r, "vendedor") === s && !rejected.has(key(r)))
    .map(key);
  blockSel.add(s);
  saveBlockSel();
  const wereFavorite = newly.filter((k) => favorite.has(k)); // para restaurar su cubo al deshacer
  newly.forEach((k) => {
    interested.delete(k);
    favorite.delete(k);
    rejected.add(k);
    stampNow(k);
  });
  save("wp_interested", interested);
  save("wp_favorite", favorite);
  save("wp_rejected", rejected);
  render();
  if (!swipeView.hidden) rebuildDeck(); // saca del mazo lo recién rechazado
  snack(`Vendedor bloqueado · ${newly.length} a la papelera`, () => {
    blockSel.delete(s);
    saveBlockSel();
    newly.forEach((k) => {
      rejected.delete(k);
      unstamp(k);
    });
    wereFavorite.forEach((k) => {
      favorite.add(k);
      stampNow(k);
    }); // los que eran favoritos, vuelven a favoritos
    save("wp_favorite", favorite);
    save("wp_rejected", rejected);
    render();
    if (!swipeView.hidden) rebuildDeck();
  });
}
// "ver" del banner: cierra el swipe y abre la papelera filtrada a los rechazados de ese vendedor
let sellerReturn = false; // al volver de esa lista, reabrir el swipe con los ajustes abiertos (de donde vino)
function showSellerRejected(s) {
  sellerReturn = true;
  listSeller = s;
  view = "rejected";
  closeSwipe();
}
function paintSellerBanner() {
  const box = $("#sellerBanner");
  if (!box) return;
  const cands = !swipeView.hidden && headers.length ? sellerCandidates() : [];
  const badge = $("#swipeCogBadge"); // señal en la cog para no perder el aviso al esconder el banner en el menú
  if (badge) {
    badge.hidden = !cands.length;
    badge.textContent = cands.length;
  }
  box.hidden = !cands.length;
  box.innerHTML = "";
  if (!cands.length) return;
  const head = document.createElement("div");
  head.className = "sb-head";
  const lbl = document.createElement("span");
  lbl.innerHTML = `<b>${cands.length}</b> vendedor${cands.length === 1 ? "" : "es"} con 2+ rechazos`;
  head.append(lbl);
  box.append(head);
  const list = document.createElement("div");
  list.className = "sb-list";
  for (const c of cands) {
    const row = document.createElement("div");
    row.className = "sb-row";
    const info = document.createElement("span");
    info.className = "sb-info";
    const b = document.createElement("b");
    b.textContent = c.rejected;
    const ver = document.createElement("span");
    ver.className = "link";
    ver.textContent = "ver";
    ver.onclick = () => showSellerRejected(c.s); // papelera filtrada a este vendedor
    info.append(b, " rechazados · ", ver);
    const btn = document.createElement("button");
    btn.className = "chip sb-block";
    btn.textContent = `Rechazar siguientes (${c.fresh.length})`;
    btn.onclick = () => blockSeller(c.s);
    row.append(info, btn);
    list.append(row);
  }
  box.append(list);
}

// ── descartar / restaurar con deshacer claro ──
let snackTimer;
function reject(k, titulo) {
  const wasInterested = interested.has(k); // al descartar sale de interesantes (cubos exclusivos)
  interested.delete(k);
  rejected.add(k);
  stampNow(k);
  save("wp_interested", interested);
  save("wp_rejected", rejected);
  render();
  snack(`Rechazado: ${(titulo || "").slice(0, 40)}`, () => {
    rejected.delete(k);
    if (wasInterested) {
      interested.add(k);
      stampNow(k);
    } else unstamp(k);
    save("wp_interested", interested);
    save("wp_rejected", rejected);
    render();
  });
}
function restore(k) {
  // restaurar = volver a "sin ver"
  rejected.delete(k);
  unstamp(k);
  const unblocked = unblockFor([k]); // si su vendedor estaba bloqueado, desbloquéalo o vuelve solo a la papelera
  save("wp_rejected", rejected);
  render();
  snack("Restaurado", () => {
    rejected.add(k);
    stampNow(k);
    reblock(unblocked);
    save("wp_rejected", rejected);
    render();
  });
}
// ── interesantes ⇄ favoritos ──
function toFavorite(k) {
  // interesantes → favoritos (el veredicto de la IA)
  interested.delete(k);
  favorite.add(k);
  stampNow(k);
  save("wp_interested", interested);
  save("wp_favorite", favorite);
  render();
  snack("A favoritos", () => {
    favorite.delete(k);
    interested.add(k);
    stampNow(k);
    save("wp_interested", interested);
    save("wp_favorite", favorite);
    render();
  });
}
function unfavorite(k) {
  // favoritos → interesantes (deshacer el ascenso)
  favorite.delete(k);
  interested.add(k);
  stampNow(k);
  save("wp_interested", interested);
  save("wp_favorite", favorite);
  render();
  snack("De vuelta a interesantes", () => {
    interested.delete(k);
    favorite.add(k);
    stampNow(k);
    save("wp_interested", interested);
    save("wp_favorite", favorite);
    render();
  });
}
function snack(msg, undo) {
  $("#snackmsg").textContent = msg;
  const s = $("#snack");
  s.hidden = false;
  $("#undo").hidden = !undo;
  requestAnimationFrame(() => s.classList.add("show"));
  $("#undo").onclick = () => {
    undo && undo();
    hideSnack();
  };
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, 5000);
}
function hideSnack() {
  const s = $("#snack");
  s.classList.remove("show");
  setTimeout(() => (s.hidden = true), 220);
}

// ── carga de un CSV (texto) ──
function loadCSV(text, name) {
  const rows = parseCSV(text);
  headers = rows[0];
  data = rows.slice(1);
  sortKeys = [];
  view = "";
  iId = headers.indexOf("id");
  iUrl = headers.indexOf("url");
  iTitulo = headers.indexOf("titulo");
  iPrecio = headers.indexOf("precio");
  if (iTitulo < 0) iTitulo = 0;

  thead.innerHTML = "";
  const tr = document.createElement("tr");
  tr.append(
    Object.assign(document.createElement("th"), {
      className: "act",
      textContent: "",
    }),
  );
  headers.forEach((h, i) => {
    if (HIDE.has(h)) return;
    const th = document.createElement("th");
    th.textContent = h;
    th.dataset.col = i;
    th.title = "clic: añade a la prioridad de orden · otra vez: invierte";
    th.onclick = () => toggleSort(i);
    tr.append(th);
  });
  thead.append(tr);
  saveRows(); // refresca el cache de filas con este dataset (fotos/precios al día)
  render();
}

// ── buscador de queries: combobox propio (input + lista vertical filtrable) ──
const pick = $("#pick"),
  qbox = $(".qbox"),
  qlist = $("#qlist"),
  pickSince = $("#pickSince");
let allQueries = []; // [{csv, label, kw, since}] — fuente del combobox
let curCsv = null; // csv de la query seleccionada (el input solo muestra el kw)
let curCsvScrape = 0; // epoch ms del scrape (Last-Modified del CSV): base para la edad real de los anuncios
const lastCsvKey = () => "wp_lastcsv"; // último dataset cargado
function loadQuery(csv) {
  const c = getCsvCache(csv);
  if (c) { // ya scrapeada antes: pinta lo cacheado, no re-scrapea (usa "Repetir" para refrescar)
    curCsvScrape = c.ts;
    loadCSV(c.text, csv);
    return;
  }
  // sin cache: primera vez que se abre (o cache podado) → scrape (kw+since del nombre)
  const { kw, since } = queryParts(csv);
  runScrape(kw, since, false).catch((e) => {
    if (e.name !== "AbortError") snack("No se pudo buscar: " + e.message, null);
  });
}
// "última vez que abrí esta búsqueda": ordena la vista de gestión por interacción reciente
const lastSeenKey = () => "wp_lastseen";
function stampSeen(csv) {
  if (!csv) return;
  const m = JSON.parse(localStorage.getItem(lastSeenKey()) || "{}");
  m[csv] = Date.now();
  localStorage.setItem(lastSeenKey(), JSON.stringify(m));
}
// muestra/oculta el badge "desde" y reserva a su medida: el texto (y su marquee) scrollea
// justo hasta donde empieza el badge, sea "última hora" o "última semana" o lo que sea.
function setSince(since) {
  pickSince.textContent = since ? SINCE_LABEL[since] : "";
  pickSince.hidden = !since;
  qbox.classList.toggle("has-since", !!since);
  pick.style.paddingRight = since ? pickSince.offsetWidth + 6 + "px" : ""; // justo el ancho del badge + un pelín; el fade del badge tapa lo que roce
}
function selectQueryUI(csv) {
  // sincroniza el combobox con la query SIN cargar datos: input = kw, badge = "desde"
  const { kw, since } = queryParts(csv);
  pick.value = kw;
  curCsv = csv;
  setSince(since);
  localStorage.setItem(lastCsvKey(), csv); // último dataset cargado
  stampSeen(csv);
}
function selectQuery(csv) {
  selectQueryUI(csv);
  loadQuery(csv); // combobox / restaurar interactivo: sí carga datos → re-scrape
}
function chooseQuery(csv) {
  selectQuery(csv);
  closeQlist();
  pick.blur();
}
// pinta la lista filtrada por el texto tecleado (substring, sin acentos/mayúsculas)
function renderQlist(term) {
  const t = norm(term);
  const seen = JSON.parse(localStorage.getItem(lastSeenKey()) || "{}"); // última interacción por perfil
  const hits = allQueries
    .filter((q) => norm(q.label).includes(t))
    .sort(
      (a, b) =>
        (seen[b.csv] || 0) - (seen[a.csv] || 0) ||
        a.label.localeCompare(b.label, "es"),
    ); // reciente primero; alfabético las nunca abiertas
  qlist.innerHTML = "";
  if (!hits.length) {
    qlist.innerHTML = '<div class="qempty">sin coincidencias</div>';
    qlist.hidden = false;
    return;
  }
  for (const q of hits) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "qrow" + (q.csv === curCsv ? " cur" : "");
    row.title = q.kw; // la fila trunca con … si es larga; el title deja leerla entera
    row.innerHTML = `<span class="qrow-kw"></span><span class="qrow-since">${SINCE_SHORT[q.since]}</span>`;
    const kwSpan = row.querySelector(".qrow-kw");
    kwSpan.textContent = q.kw; // textContent: a prueba de < & en el término
    marquee(kwSpan); // filas que difieren solo al final: el scroll deja leer el término entero
    row.onclick = () => chooseQuery(q.csv);
    qlist.appendChild(row);
  }
  qlist.hidden = false;
}
const norm = (s) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
function openQlist() {
  renderQlist(pick.value);
}
function closeQlist() {
  qlist.hidden = true;
}
pick.onfocus = () => {
  pick.select();
  renderQlist("");
}; // al enfocar: abre la lista COMPLETA (aún no se ha tocado); filtra solo tras teclear
pick.oninput = () => {
  setSince("");
  openQlist();
}; // al teclear para filtrar, oculta el badge
document.addEventListener("pointerdown", (e) => {
  if (!qbox.contains(e.target)) closeQlist();
});
pick.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeQlist();
    pick.blur();
  }
});
// al arrancar deja la última búsqueda puesta en el combobox (NO re-scrapea al arrancar:
// evita golpe de red/403 automático; el usuario toca Buscar o la elige para cargar datos)
function restoreLastCsv() {
  const last = localStorage.getItem(lastCsvKey());
  if (!last) return;
  refreshCsvs().then(() => {
    if (allQueries.some((q) => q.csv === last)) selectQueryUI(last);
  });
}

// nombre de CSV → partes de la query: "ps4--semana.csv" → {kw:"ps4", since:"semana"}
const SINCE_LABEL = {
  hora: "última hora",
  dia: "último día",
  semana: "última semana",
  mes: "último mes",
};
const SINCE_SHORT = {
  "": "TODO",
  hora: "HORA",
  dia: "DÍA",
  semana: "SEMANA",
  mes: "MES",
}; // chip compacto de la lista
function queryParts(csv) {
  const base = csv.replace(/\.csv$/, "");
  const i = base.lastIndexOf("--");
  const since =
    i >= 0 && SINCE_LABEL[base.slice(i + 2)] ? base.slice(i + 2) : "";
  return { kw: (since ? base.slice(0, i) : base).replace(/-/g, " "), since };
}
function queryLabel(csv) {
  // etiqueta legible: "ps4 (última semana)"
  const { kw, since } = queryParts(csv);
  return since ? `${kw} (${SINCE_LABEL[since]})` : kw;
}
console.assert(
  queryLabel("ps4--semana.csv") === "ps4 (última semana)" &&
    queryLabel("tv-led.csv") === "tv led" &&
    queryLabel("deshumidificador--dia.csv") === "deshumidificador (último día)",
  "queryLabel() roto",
);

// ── búsquedas guardadas: definiciones (kw+since) en localStorage ──
// No se guardan result sets: abrir una búsqueda = re-scrapear. {csv, rows, mtime(s)} por entrada.
const searchesKey = () => "wp_searches";
const loadSearches = () => {
  try {
    return JSON.parse(localStorage.getItem(searchesKey()) || "[]");
  } catch {
    return [];
  }
};
const writeSearches = (list) =>
  localStorage.setItem(searchesKey(), JSON.stringify(list));
function saveSearch(csv, rows) {
  const list = loadSearches().filter((s) => s.csv !== csv); // upsert: la última corrida manda
  list.push({ csv, rows, mtime: Math.floor(Date.now() / 1000) });
  writeSearches(list);
}
const removeSearch = (csv) => {
  writeSearches(loadSearches().filter((s) => s.csv !== csv));
  dropCsvCache(csv);
};

// cache del CSV scrapeado por búsqueda: seleccionar una búsqueda pinta esto (sin re-scrapear);
// "Repetir"/Buscar sí re-scrapea y refresca el cache. {text, ts(ms scrape)} por csv.
const csvCacheKey = "wp_csv";
const readCsvCache = () => {
  try { return JSON.parse(localStorage.getItem(csvCacheKey) || "{}"); } catch { return {}; }
};
const getCsvCache = (csv) => readCsvCache()[csv] || null;
function cacheCsv(csv, text, ts) {
  const m = readCsvCache();
  m[csv] = { text, ts };
  const saved = new Set(loadSearches().map((s) => s.csv)); // poda: solo búsquedas vivas...
  for (const k in m) if (!saved.has(k) && k !== csv) delete m[k];
  for (const k of Object.keys(m).sort((a, b) => m[b].ts - m[a].ts).slice(12)) // ...y las 12 más recientes
    delete m[k];
  // persiste; si peta por quota, desaloja la más vieja (nunca la actual) y reintenta, sin tirar el cache entero
  while (true) {
    try { localStorage.setItem(csvCacheKey, JSON.stringify(m)); return; }
    catch {
      const old = Object.keys(m).filter((k) => k !== csv).sort((a, b) => m[a].ts - m[b].ts)[0];
      if (!old) return; // solo queda la actual y aun así no cabe: se queda sin cachear (CSV demasiado grande)
      delete m[old];
    }
  }
}
function dropCsvCache(csv) {
  const m = readCsvCache();
  if (csv in m) { delete m[csv]; localStorage.setItem(csvCacheKey, JSON.stringify(m)); }
}

// búsquedas guardadas → items del combobox (kw + ventana temporal, filtrable al escribir)
function refreshCsvs() {
  const have = new Set(allQueries.map((q) => q.csv));
  for (const s of loadSearches())
    if (!have.has(s.csv)) {
      const { kw, since } = queryParts(s.csv);
      allQueries.push({ csv: s.csv, label: queryLabel(s.csv), kw, since });
    }
  allQueries.sort((a, b) => a.label.localeCompare(b.label, "es"));
  return Promise.resolve(); // los llamantes usan .then()
}
refreshCsvs();

// dispara el scraper y carga el resultado (el servidor cachea: no re-scrapea si es fresco)
// mismo slug que el server (servidor.py slug/csv_name) para sondear el progreso antes de saber el nombre
const csvNameOf = (kw, since) =>
  kw.toLowerCase().split(/\s+/).filter(Boolean).join("-") +
  (since ? "--" + since : "") +
  ".csv";
// ubicación del scrape: ciudad manual (Fase 6, aún sin UI) o Jaén por defecto
const JAEN_LOC = { lat: 37.7796, lon: -3.7849 };
const getLoc = () => {
  try {
    return { ...JAEN_LOC, ...JSON.parse(localStorage.getItem("wp_loc") || "{}") };
  } catch {
    return JAEN_LOC;
  }
};
// pinta el overlay: n = contador de encontrados (o null al arrancar, sin dato aun)
function setLoading(on, n) {
  const box = $("#loading");
  $("#stat").hidden = on; // los stats son de la query vieja: ocúltalos mientras se busca
  $(".panel.picker").hidden = on; // búsqueda activa + exclusiones son de la query vieja: fuera mientras se busca
  if (!on) {
    box.hidden = true;
    return;
  } // render() recoloca #empty/botón al cargar el CSV
  $("#empty").hidden = true;
  $("#swipeFab").hidden = true;
  $("#copyInterested").hidden = true;
  box.hidden = false;
  $("#loadingCount").textContent = n ? `${n} encontrados` : "Buscando…";
}
let _timer;
function startTimer() {
  // cronómetro de la búsqueda: puede tardar mucho si hay miles de resultados
  const t0 = Date.now();
  const paint = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    $("#loadingTime").textContent =
      s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
  };
  paint();
  clearInterval(_timer);
  _timer = setInterval(paint, 1000);
}
// corre el scraper EN EL BROWSER (scrape.js): pinta el overlay, cablea el botón de parar
// (AbortController) y carga el CSV resultante. Devuelve el nombre de CSV.
async function runScrape(kw, since, titleOnly) {
  const csv = csvNameOf(kw, since);
  const ctrl = new AbortController();
  const stop = $("#stopScrape");
  stop.hidden = false;
  stop.textContent = "parar búsqueda";
  stop.classList.add("link");
  stop.onclick = () => {
    stop.onclick = null;
    stop.classList.remove("link");
    stop.textContent = "parando…";
    ctrl.abort(); // scrape.js devuelve el CSV parcial ya recogido
  };
  setLoading(true, null);
  startTimer();
  let live = true; // un onProgress tardío no debe resucitar el overlay tras terminar/parar
  try {
    const { lat, lon } = getLoc();
    const text = await Rebusca.scrape({
      keywords: kw,
      since: since || null,
      titleOnly,
      lat,
      lon,
      onProgress: (n) => {
        if (live) setLoading(true, n);
      },
      signal: ctrl.signal,
    });
    curCsvScrape = Date.now(); // CSV recién generado: base para la edad real de cada anuncio
    loadCSV(text, csv);
    cacheCsv(csv, text, curCsvScrape); // guarda resultados: seleccionar esta búsqueda no re-scrapea
    saveSearch(csv, data.length); // recuerda la búsqueda (kw+since) para el combobox y el gestor
    return csv;
  } finally {
    live = false;
    clearInterval(_timer);
    setLoading(false);
  }
}
$("#scrape").onclick = async () => {
  const kw = $("#kw").value.trim();
  if (!kw) return;
  const since = $("#since").value || "";
  const btn = $("#scrape"),
    txt = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando…";
  try {
    const csv = await runScrape(kw, since, $("#titleOnly").checked);
    await refreshCsvs();
    selectQueryUI(csv); // el CSV ya está cargado: solo sincroniza el combobox, sin re-scrapear
    render(); // curCsv ya fijado: re-render para aplicar/pintar lo que depende de él (exclusiones del deep-link)
  } catch (e) {
    if (e.name !== "AbortError") snack("No se pudo buscar: " + e.message, null);
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
};
$("#kw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#scrape").click();
});
// auto-scroll horizontal del texto que desborda: ping-pong para poder leerlo entero.
// Se autodetiene si el elemento sale del DOM (las filas del dropdown se recrean al filtrar).
const MQ_HOLD = 3500; // ms parado en cada extremo (por tiempo real, no por frames: igual a 60 y 120Hz)
const MQ_SPEED = 0.036; // px/ms (~36px/s) POR TIEMPO REAL, no por frame: igual a cualquier fps del móvil
function marquee(kw) {
  let pos = 0, // acumulador propio: el ping-pong NO depende de leer kw.scrollLeft
    dir = 1,
    resume = 0, // timestamp (rAF/performance.now) a partir del cual se reanuda el scroll
    last = 0; // timestamp del frame anterior, para el delta de tiempo
  const tick = (t) => {
    if (!kw.isConnected) return; // fila eliminada -> corta el rAF (no fugar loops)
    if (!resume) resume = t + MQ_HOLD; // primer frame: pausa inicial para leer antes de arrancar
    const dt = last ? Math.min(t - last, 50) : 16; // cap: tras pestaña inactiva no pega un salto
    last = t;
    const over = kw.scrollWidth - kw.clientWidth;
    if (kw.scrollLeft <= 0 && pos > 2) { pos = 0; dir = 1; resume = t + MQ_HOLD; } // el navegador reseteó el scroll (cambió el value): reinicia por la izquierda
    if (document.activeElement !== kw && over > 4 && t >= resume) {
      // clamp sobre nuestro pos, no sobre scrollLeft: en inputs (Firefox/móvil) el readback
      // de scrollLeft se queda por debajo de `over` y `>= over` no dispara -> se pegaba al final.
      pos = Math.min(Math.max(pos + dir * MQ_SPEED * dt, 0), over); // velocidad por tiempo, no por frame
      kw.scrollLeft = pos;
      if (pos >= over) { dir = -1; resume = t + MQ_HOLD; } // 1s de pausa en los extremos
      else if (pos <= 0) { dir = 1; resume = t + MQ_HOLD; }
    }
    requestAnimationFrame(tick);
  };
  kw.addEventListener("focus", () => {
    pos = 0;
    kw.scrollLeft = 0;
    dir = 1;
    resume = performance.now() + MQ_HOLD; // mismo origen de tiempo que el timestamp de rAF
  });
  requestAnimationFrame(tick);
}
["#kw", "#pick"].forEach((sel) => { const el = $(sel); if (el) marquee(el); }); // barra de arriba + "Búsqueda activa"

// ── gestor de búsquedas: vista CRUD sobre los CSV del servidor ──
const searchesView = $("#searchesView"),
  searchesList = $("#searchesList");
let allSearches = [],
  searchesQ = ""; // fuente + filtro de texto del gestor
function openManager() {
  searchesView.hidden = false;
  document.body.style.overflow = "hidden";
  enterOverlay($("#searchesX"));
  searchesQ = "";
  $("#searchesFilter").value = "";
  renderSearches();
  reconcileBack();
}
function closeManager() {
  searchesView.hidden = true;
  document.body.style.overflow = "";
  exitOverlay();
  reconcileBack();
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s); // "última semana" → "Última semana"
function renderSearches() {
  // relee de localStorage y repinta con el filtro actual
  allSearches = loadSearches();
  paintSearches();
}
function paintSearches() {
  const q = norm(searchesQ);
  const hits = allSearches.filter((s) =>
    norm((aliasMap[s.csv] || "") + " " + queryParts(s.csv).kw).includes(q),
  );
  const seen = JSON.parse(localStorage.getItem(lastSeenKey()) || "{}");
  const touched = (s) => Math.max(seen[s.csv] || 0, s.mtime * 1000); // abierta o rescrapeada: lo más reciente manda
  hits.sort((a, b) => touched(b) - touched(a)); // última interacción primero
  searchesList.innerHTML = "";
  if (!allSearches.length) {
    searchesList.innerHTML =
      '<div class="qempty">no hay búsquedas guardadas</div>';
    return;
  }
  if (!hits.length) {
    searchesList.innerHTML =
      '<div class="qempty">nada coincide con el filtro</div>';
    return;
  }
  const nowDays = Date.now() / 86400000; // para "hace X" a partir del mtime
  for (const s of hits) {
    const { kw, since } = queryParts(s.csv);
    const alias = aliasMap[s.csv]; // apodo opcional; si existe manda como título y el kw real va debajo
    const card = document.createElement("div");
    card.className = "search-card";
    const age = humanAge(Math.max(0, nowDays - s.mtime / 86400));
    card.innerHTML =
      `<div class="sc-top"><span class="sc-kw"></span>` +
      (since
        ? `<span class="sc-since">${cap(SINCE_LABEL[since])}</span>`
        : "") +
      `</div>` +
      (alias ? `<div class="sc-realkw"></div>` : "") +
      `<div class="sc-meta">${s.rows} resultado${s.rows === 1 ? "" : "s"} · ${age}</div>` +
      `<div class="sc-btns">` +
      `<button class="ghost sc-run">${ic("search")} Repetir</button>` +
      `<button class="ghost sc-ren">${ic("pencil")} Renombrar</button>` +
      `<button class="primary sc-pick">${ic("check")} Seleccionar</button>` +
      `<button class="danger sc-del">${ic("rejected")} Borrar</button></div>`;
    card.querySelector(".sc-kw").textContent = alias || kw; // textContent: a prueba de < & en el término
    if (alias) card.querySelector(".sc-realkw").textContent = kw;
    card.querySelector(".sc-pick").onclick = () => {
      selectQuery(s.csv);
      closeManager();
    }; // carga el CSV ya guardado, sin re-scrapear
    card.querySelector(".sc-ren").onclick = () =>
      renameSearch(s.csv, alias || "");
    card.querySelector(".sc-run").onclick = () => relaunch(kw, since);
    card.querySelector(".sc-del").onclick = () => deleteSearch(s.csv, kw);
    searchesList.appendChild(card);
  }
}
function relaunch(kw, since) {
  // rellena el buscador principal; el usuario decide cuándo lanzar
  $("#kw").value = kw;
  $("#since").value = since || "";
  closeManager();
  $("#kw").focus();
}
function renameSearch(csv, actual) {
  // apodo local; no toca el CSV ni los keywords. Vacío = quitar el apodo
  const nombre = prompt(
    "Nombre para esta búsqueda (no cambia lo que se busca):",
    actual,
  );
  if (nombre === null) return; // canceló
  const t = nombre.trim();
  if (t) aliasMap[csv] = t;
  else delete aliasMap[csv];
  saveAlias();
  paintSearches();
}
function deleteSearch(csv, kw) {
  if (
    !confirm(
      `¿Borrar la búsqueda "${kw}"? Se pierde el CSV (el estado se conserva).`,
    )
  )
    return;
  removeSearch(csv);
  afterCsvChange(csv, null);
  renderSearches();
}
// sincroniza el combobox y el dataset abierto tras borrar/renombrar
function afterCsvChange(oldCsv, newCsv) {
  allQueries = [];
  refreshCsvs(); // el combobox se reconstruye entero (dedup no quita los que ya no están)
  if (curCsv === oldCsv) {
    if (newCsv) {
      selectQuery(newCsv);
      localStorage.setItem(lastCsvKey(), newCsv);
    } else {
      curCsv = null;
      pick.value = "";
      setSince("");
      localStorage.removeItem(lastCsvKey());
      headers = [];
      data = [];
      sortKeys = [];
      view = "";
      thead.innerHTML = ""; // sin query activa: nada de stats/rebuscar stale
      $("#empty").textContent = "Bienvenid@ a Rebusca — escribe una búsqueda y pulsa Buscar";
      render();
    }
  }
}
$("#manageSearches").onclick = openManager;
$("#searchesX").onclick = closeManager;
$("#searchesFilter").oninput = (e) => {
  searchesQ = e.target.value;
  paintSearches();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !searchesView.hidden) closeManager();
});

const opts = $("#perfilOpts"); // menú de ajustes (engranaje del header)
// ── ajustes: auto-exclusión y umbral "lejos" (por dispositivo, en localStorage) ──
const autoExclEl = $("#autoExclLejos"),
  lejosKmEl = $("#lejosKm");
autoExclEl.checked = autoExclLejos;
lejosKmEl.value = lejosKm;
autoExclEl.onchange = () => {
  autoExclLejos = autoExclEl.checked;
  localStorage.setItem("wp_autoexcllejos", autoExclLejos ? "1" : "0");
  render();
};
lejosKmEl.onchange = () => {
  lejosKm = +lejosKmEl.value || 10;
  lejosKmEl.value = lejosKm;
  localStorage.setItem("wp_lejoskm", lejosKm);
  render();
};
// deep-link: ?q=<búsqueda>&since=<hora|dia|semana|mes>&excl=palabra,otra&title=1&fav=<id,id>
// deja que una IA (o un enlace guardado) abra Rebusca con una búsqueda ya montada:
// booleana (OR/grupos/comillas van tal cual en q) + exclusiones. Devuelve true si disparó.
// ?fav=<ids> marca esos anuncios como FAVORITOS por id (global; los saca de interesados/rechazados):
// así la IA, tras comparar la lista, devuelve un enlace que asciende sus elegidos de un toque.
function fromURL() {
  const p = new URLSearchParams(location.search);
  const favIds = [...new Set((p.get("fav") || "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (favIds.length) {
    for (const id of favIds) { interested.delete(id); rejected.delete(id); favorite.add(id); stampNow(id); }
    save("wp_interested", interested); save("wp_rejected", rejected); save("wp_favorite", favorite);
  }
  const q = (p.get("q") || "").trim();
  if (!q) {
    if (favIds.length) {
      history.replaceState(null, "", location.pathname); // enlace de un solo uso
      view = "favorite"; // muéstralos ya: se pintan desde el cache, sin re-scrapear
      render();
      snack(`${favIds.length} añadidos a favoritos`, null);
      return true; // ya hay algo en pantalla; no dispares restoreLastCsv()
    }
    return false; // sin fav ni q: deja que restoreLastCsv() cargue la última vista
  }
  const since = ["hora", "dia", "semana", "mes"].includes(p.get("since")) ? p.get("since") : "";
  const words = [...new Set((p.get("excl") || "").split(",").map(norm).filter(Boolean))];
  if (words.length) { exclMap[csvNameOf(q, since)] = words; saveExcl(); } // se aplican al renderizar
  $("#kw").value = q;
  $("#since").value = since;
  $("#titleOnly").checked = p.get("title") === "1";
  history.replaceState(null, "", location.pathname); // enlace de un solo uso: refrescar no re-dispara
  $("#scrape").click();
  return true;
}

// arranque: sin perfiles, un usuario por navegador. Hidrata estado y restaura la última búsqueda.
// queueMicrotask difiere el boot a tras evaluar el módulo -> render() no toca consts en TDZ (p.ej. `col`).
queueMicrotask(() => {
  $("#empty").textContent = "Bienvenid@ a Rebusca — escribe una búsqueda y pulsa Buscar";
  hydrateEstado();
  render();
  if (!fromURL()) restoreLastCsv(); // ?q=… dispara su búsqueda; si no, la última vista
});

// ── modo swipe (tinder): una tarjeta a la vez; arrastra ← descartar / → interesa ──
const swipeView = $("#swipeView"),
  swipeStage = $("#swipeStage"),
  swipeCount = $("#swipeCount");
const likeStamp = $("#swLikeStamp"),
  nopeStamp = $("#swNopeStamp"); // sellos fijos detrás de la tarjeta
let deck = [],
  di = 0,
  card = null,
  undoStack = [];
const col = (r, name) => {
  const i = headers.indexOf(name);
  return i >= 0 ? r[i] : "";
};

// a11y overlays modales: al abrir, el fondo (header + main) se marca `inert` — sale del árbol de
// accesibilidad y del tab, así el foco queda atrapado en el overlay; y se lleva el foco dentro.
const overlayBg = () => [document.querySelector("header"), document.querySelector("main")];
function enterOverlay(focusEl) {
  overlayBg().forEach((el) => el && (el.inert = true));
  focusEl?.focus();
}
function exitOverlay() {
  overlayBg().forEach((el) => el && (el.inert = false));
}

function openSwipe() {
  deck = filteredRows();
  di = 0;
  undoStack = [];
  if (!deck.length)
    return snack("No hay nada que revisar con estos filtros.", null);
  swipeView.hidden = false;
  document.body.style.overflow = "hidden";
  enterOverlay($("#swipeX")); // a11y: oculta el fondo a AT + foco al overlay
  renderSwExcl();
  nextCard();
  reconcileBack();
}
function rebuildDeck() {
  deck = filteredRows();
  di = 0;
  undoStack = [];
  nextCard();
} // re-baraja desde el principio (ya excluye clasificados/vetados); el historial de deshacer deja de ser válido
// chips sutiles de palabras vetadas dentro del swipe; añadir/quitar re-baraja el mazo en vivo
function renderSwExcl() {
  fillExclChips($("#swExclChips"), () => {
    rebuildDeck();
    renderSwExcl();
  });
}
function closeSwipe() {
  swipeView.hidden = true;
  $("#swipeMenu").hidden = true;
  document.body.style.overflow = "";
  exitOverlay();
  render();
}

function nextCard() {
  refreshUndo();
  swipeStage
    .querySelectorAll(".swipe-card, .swipe-done")
    .forEach((e) => e.remove()); // conserva los sellos
  likeStamp.style.opacity = nopeStamp.style.opacity = 0;
  card = null;
  paintSellerBanner(); // candidatos cambian al rechazar cartas dentro del swipe
  const done = di >= deck.length; // mazo agotado: no hay tarjeta a la que copiar/abrir
  $("#swVer").disabled = $("#swCopy").disabled = done;
  if (done) {
    swipeCount.textContent = "";
    const el = document.createElement("div");
    el.className = "swipe-done";
    el.textContent = "✓ Has rebuscado todo";
    swipeStage.appendChild(el);
    return;
  }
  swipeCount.textContent = di + 1 + " / " + deck.length;
  card = buildCard(deck[di]);
  swipeStage.appendChild(card);
}
function refreshUndo() {
  $("#swUndo").disabled = !undoStack.length;
}

function buildCard(r) {
  const c = document.createElement("div");
  c.className = "swipe-card";
  fillCard(c, r); // mismo cuerpo que los items de papelera/favoritos
  return c;
}

// commit por distancia O por velocidad: un flick corto y rápido cuenta igual que un arrastre largo
function decide(dx, v) {
  if (dx > 60 || v > 0.5) return 1;
  if (dx < -60 || v < -0.5) return -1;
  return 0;
}
// se arma UNA vez sobre toda la vista: arrastra desde cualquier hueco, mueve la tarjeta actual
function dragify(root) {
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0,
    on = false,
    axis = 0,
    t0 = 0;
  root.onpointerdown = (e) => {
    if (!card || e.target.closest("a,button,input,.seller-banner")) return; // sin tarjeta o sobre botón/input/banner: nada
    on = true;
    dx = dy = axis = 0;
    sx = e.clientX;
    sy = e.clientY;
    t0 = e.timeStamp;
    root.setPointerCapture(e.pointerId);
  };
  root.onpointermove = (e) => {
    if (!on || !card) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
    if (!axis) {
      // eje aún sin decidir: espera intención clara (8px)
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dy) > Math.abs(dx) * 1.4 ? "y" : "x"; // ponytail: el swipe manda; solo bloquea a scroll un arrastre claramente vertical

      if (axis === "x") card.classList.add("grab");
    }
    if (axis !== "x") return; // vertical: deja scrollear la descripción
    e.preventDefault();
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    const t = Math.min(1, Math.abs(dx) / 120);
    likeStamp.style.opacity = dx > 0 ? t : 0;
    nopeStamp.style.opacity = dx < 0 ? t : 0;
  };
  root.onpointerup = root.onpointercancel = (e) => {
    if (!on) return;
    on = false;
    if (axis === "x" && card) {
      card.classList.remove("grab");
      const d = decide(dx, dx / Math.max(1, e.timeStamp - t0)); // v en px/ms sobre el gesto
      if (d) return fling(d);
      card.style.transform = ""; // no cuajó: vuelve al centro
    }
    likeStamp.style.opacity = nopeStamp.style.opacity = 0;
  };
}

function fling(dir) {
  const r = deck[di],
    k = key(r);
  undoStack.push({
    di,
    k,
    wasInterested: interested.has(k),
    wasRejected: rejected.has(k),
    wasStamp: stamp[k],
  }); // estado previo para deshacer
  if (dir > 0) {
    interested.add(k);
    rejected.delete(k);
    likeStamp.style.opacity = 1;
  } else {
    rejected.add(k);
    interested.delete(k);
    nopeStamp.style.opacity = 1;
  } // clasifica en un cubo exclusivo; sello a tope
  stampNow(k);
  save("wp_interested", interested);
  save("wp_rejected", rejected);
  card.style.transition = "transform .25s ease, opacity .25s ease";
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 20}deg)`;
  card.style.opacity = 0;
  card = null; // bloquea doble-decisión mientras vuela
  setTimeout(() => {
    di++;
    nextCard();
  }, 200);
}
// deshacer el último swipe: restaura el cubo/sello previo del item y vuelve a mostrar su tarjeta
function swUndo() {
  const h = undoStack.pop();
  if (!h) return;
  if (h.wasInterested) interested.add(h.k);
  else interested.delete(h.k);
  if (h.wasRejected) rejected.add(h.k);
  else rejected.delete(h.k);
  if (h.wasStamp === undefined) unstamp(h.k);
  else {
    stamp[h.k] = h.wasStamp;
    localStorage.setItem("wp_stamp", JSON.stringify(stamp));
  }
  save("wp_interested", interested);
  save("wp_rejected", rejected);
  di = h.di;
  nextCard(); // vuelve a la tarjeta que se había swipeado
}

dragify(swipeView); // toda la vista es zona de arrastre (no solo la tarjeta)
$("#listFilter").oninput = (e) => {
  listQ = e.target.value;
  render();
};
$("#exclAdd").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  if (addExcl(e.target.value)) render();
  e.target.value = "";
};
$("#swExclAdd").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  if (addExcl(e.target.value)) rebuildDeck();
  e.target.value = "";
  renderSwExcl();
};
$("#listBack").onclick = (e) => {
  view = "";
  $("#empty").textContent = "";
  if (sellerReturn) {
    sellerReturn = false;
    listSeller = "";
    openSwipe();
    swipeMenu.hidden = false;
    e.stopPropagation();
    return;
  } // volver justo a donde vino: swipe + ajustes abiertos (frena el "cerrar al tocar fuera")
  render();
};
$("#exportInterested").onclick = (e) => copyInterested(e.currentTarget); // misma ficha para la IA que el botón del mazo vacío
// precio a copiar/mostrar: final estimado al comprador si lleva envío (con '(aprox)' si no hay peso real), si no el del anuncio
function priceLabel(r) {
  const precio = col(r, "precio");
  if (col(r, "envio") === "True" && isNum(precio)) {
    const kg = pesos[col(r, "id")],
      exact = typeof kg === "number";
    return (
      eur(finalPrice(+precio, exact ? kg : undefined)) +
      (exact ? " (con envío)" : " (con envío, aprox)")
    );
  }
  return precio !== "" ? `${dec1(precio)}€` : "—";
}
// par de precios para el prompt: el estimado final al comprador y el que pone el vendedor
function pricePair(r) {
  const precio = col(r, "precio");
  const anunciado = precio !== "" ? `${dec1(precio)}€` : "—";
  return `precio para mí: ${priceLabel(r)}, precio anunciado: ${anunciado}`;
}
// frase que explica a la IA de dónde sale "precio para mí" (envío + comisión estimados)
const PRICE_NOTE =
  "El «precio para mí» es una estimación del coste final para el comprador " +
  "(incluye el envío y la comisión de protección de Wallapop); el «precio anunciado» es el que pide el vendedor. ";
// quita emojis (y sus modificadores/uniones) del texto a copiar: fichas limpias para la IA y notas
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]/gu;
const stripEmoji = (s) =>
  (s || "")
    .replace(EMOJI_RE, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +$/gm, "")
    .trim();
console.assert(
  stripEmoji("PS4 🎮 slim ✅") === "PS4 slim" &&
    stripEmoji("👍🏽 gama alta 🇪🇸") === "gama alta",
  "stripEmoji roto",
);

// instrucción de cabecera para la IA (la misma para el texto de "copiar" y para el PDF dossier)
const promptIntro = () =>
  "Estos son artículos de segunda mano de Wallapop que quiero comparar antes de comprar. " +
  PRICE_NOTE +
  "Investiga cada uno a fondo (modelo o versión exacta, especificaciones, estado, y su precio típico nuevo y de segunda mano) " +
  "y clasifícalos en tres listas:\n" +
  "a) TOP 3: los tres mejores calidad/precio, ordenados del mejor al tercero, cada uno con el porqué en detalle.\n" +
  "b) MENCIONES: los que no llegan al top 3 pero siguen mereciendo la pena, con una línea de por qué destacan.\n" +
  "c) DESCARTES: los que descartarías, con el motivo breve.\n" +
  "Para los del TOP 3 y las MENCIONES, dime además si debería intentar regatear el precio y, si es así, a qué precio propondrías, " +
  "y si lo ves necesario dime qué preguntar al vendedor.\n" +
  "Al final, dame un enlace https://rebusca.dibogomez.com/?fav=<ids> con los ids ([#...]) de los que ascenderías a favoritos " +
  "(TOP 3 y menciones que valgan la pena), separados por comas; al abrirlo los marco como favoritos de un toque:";
// mensaje listo para pegar en Claude/Gemini: cabecera + ficha numerada de cada destacado (precio final estimado)
function interestedPrompt(rows) {
  const items = rows
    .map((r, i) => {
      const lines = [
        `${i + 1}. [#${col(r, "id")}] ${stripEmoji(col(r, "titulo"))} — ${pricePair(r)}`,
      ];
      const desc = col(r, "descripcion");
      if (desc) lines.push("   " + stripEmoji(desc.replace(/\s*\n\s*/g, " ")));
      return lines.join("\n");
    })
    .join("\n\n");
  return promptIntro() + "\n\n" + items;
}
// copia texto al portapapeles admitiendo trabajo asíncrono (calcular precios) sin perder el gesto en Safari/iOS
function copyAsync(makeText) {
  if (window.ClipboardItem && navigator.clipboard.write) {
    const blob = Promise.resolve()
      .then(makeText)
      .then((t) => new Blob([t], { type: "text/plain" }));
    return navigator.clipboard.write([
      new ClipboardItem({ "text/plain": blob }),
    ]);
  }
  return Promise.resolve()
    .then(makeText)
    .then((t) => navigator.clipboard.writeText(t)); // fallback sin ClipboardItem
}
// copiar interesantes para una IA (precio exacto por peso real). Por defecto copia SOLO los NUEVOS
// (no enviados aún): tras la criba de la IA, los ya revisados que quedan en interesantes son ruido.
// all=true copia todos (fallback desde el menú ⚙).
function copyInterested(btn, all) {
  let rows = bucketRows(interested);
  if (!all) rows = rows.filter((r) => !aiseen.has(col(r, "id")));
  if (!rows.length)
    return snack(
      all ? "No tienes interesantes que copiar" : "No hay interesantes nuevos (usa ⚙ para copiar todos)",
      null,
    );
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparando…";
  copyAsync(async () => {
    await fetchPesos(rows).catch(() => {});
    return interestedPrompt(rows);
  }) // si falla el peso, se copia con el estimado
    .then(() => {
      rows.forEach((r) => { const id = col(r, "id"); if (id) aiseen.add(id); }); // márcalos como enviados
      localStorage.setItem("wp_aiseen", JSON.stringify([...aiseen]));
      snack(`Copiados ${rows.length} ${all ? "interesantes" : "nuevos"} para la IA`, null);
    })
    .catch(() => snack("No se pudo copiar", null))
    .finally(() => {
      btn.disabled = false;
      btn.textContent = prev;
    });
}
$("#copyInterested").onclick = (e) => copyInterested(e.currentTarget);
$("#copyInterestedOpt").onclick = (e) => {
  opts.open = false;
  copyInterested(e.currentTarget, true); // menú ⚙: copia TODOS (aunque ya se enviaran)
}; // cierra el menú para que se vea el snack

// ── PDF dossier de favoritos: fotos + fichas en un archivo para arrastrar a la IA ──
// Truco CORS: cdn.wallapop.com NO da Access-Control-Allow-Origin, así que fetch/canvas de
// la imagen fallan; pero un <img> cross-origin SÍ se muestra e imprime (solo se bloquea leer
// sus píxeles). window.print() -> "Guardar como PDF" mete texto+fotos en un único archivo.
const esc = (s) =>
  (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function dossierHTML(rows) {
  const cards = rows
    .map((r, i) => {
      // todas las fotos del anuncio (col "imagenes", separadas por espacio); si no hay, la única "imagen"
      const imgs = (col(r, "imagenes") || col(r, "imagen") || "").split(" ").filter(Boolean);
      const url = col(r, "url"),
        desc = stripEmoji((col(r, "descripcion") || "").replace(/\s*\n\s*/g, " "));
      const photos = imgs.map((u) => `<img src="${esc(u)}" alt="">`).join("");
      return `<div class="dsr-card"><div class="dsr-body">` +
        `<div class="dsr-t">${i + 1}. [#${esc(col(r, "id"))}] ${esc(stripEmoji(col(r, "titulo")))}</div>` +
        `<div class="dsr-p">${esc(pricePair(r))}</div>` +
        (desc ? `<div class="dsr-d">${esc(desc)}</div>` : "") +
        (url ? `<a class="dsr-u" href="${esc(url)}">${esc(url)}</a>` : "") +
        (photos ? `<div class="dsr-photos">${photos}</div>` : "") +
        `</div></div>`;
    })
    .join("");
  return `<pre class="dsr-intro">${esc(promptIntro())}</pre>${cards}`;
}
async function dossierFav(btn) {
  const rows = bucketRows(favorite);
  if (!rows.length) return snack("No tienes favoritos", null);
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparando…";
  try {
    await fetchPesos(rows).catch(() => {}); // precio exacto si se puede
    const box = $("#dossier");
    box.innerHTML = dossierHTML(rows);
    // espera a que carguen las fotos (o fallen) antes de imprimir, si no salen en blanco
    await Promise.all(
      [...box.querySelectorAll("img")].map((im) =>
        im.complete ? null : new Promise((res) => (im.onload = im.onerror = res)),
      ),
    );
    window.print();
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}
$("#dossierFav").onclick = (e) => dossierFav(e.currentTarget);
// precio exacto: pide a la API el peso real (tramo up_to_kg) de los items con envío que aún no conocemos.
// cachea, repinta y devuelve cuántos pesos numéricos llegaron. -1 si no había nada que pedir.
async function fetchPesos(rows) {
  const ids = rows
    .filter((r) => col(r, "envio") === "True")
    .map((r) => col(r, "id"))
    .filter((id) => id && !(id in pesos)); // sin recalcular lo ya conocido (incluye nulos: ítems sin peso)
  if (!ids.length) return -1;
  let got = 0;
  for (const id of ids.slice(0, 200)) {
    // ponytail: tope 200; una lista de favoritos nunca llega ahí. Sin AbortController (listas cortas).
    const w = await itemWeight(id);
    pesos[id] = w; // cachea también los nulos (ítem borrado / sin peso) para no re-pedirlos
    if (typeof w === "number") got++;
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 250)); // jitter anti-DataDome
  }
  localStorage.setItem("wp_pesos", JSON.stringify(pesos));
  render();
  return got;
}
// peso real (tramo up_to_kg) de un item vía el detalle de la API; null si borrado/sin peso/bloqueo
async function itemWeight(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null; // id opaco de Wallapop; evita meter basura en la URL
  try {
    const r = await fetch("https://api.wallapop.com/api/v3/items/" + id, {
      headers: { "X-DeviceOS": "0", Accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = ((d.type_attributes || {}).up_to_kg || {}).value;
    return v ? parseFloat(v) : null;
  } catch {
    return null;
  }
}
$("#swYes").onclick = () => card && fling(1); // los hints ✓→ / ←✕ también clasifican, no solo el swipe
$("#swNo").onclick = () => card && fling(-1);
$("#swipeFab").onclick = openSwipe;
$("#swipeX").onclick = closeSwipe;
$("#swUndo").onclick = swUndo;
// cog: menú flotante con orden + gestión de vendedores; se cierra al tocar fuera
const swipeMenu = $("#swipeMenu");
$("#swipeCog").onclick = (e) => {
  e.stopPropagation();
  swipeMenu.hidden = !swipeMenu.hidden;
};
document.addEventListener("click", (e) => {
  if (swipeMenu.hidden) return;
  if (!swipeMenu.contains(e.target) && !$("#swipeCog").contains(e.target))
    swipeMenu.hidden = true;
});
$("#swVer").onclick = () => {
  if (di >= deck.length) return;
  const r = deck[di],
    url = col(r, "url");
  if (!url) return;
  window.open(url, "_blank");
};
// prompt de IA para la tarjeta actual (título, precio, descripción).
// Sin antigüedad, sin link ni línea de envío; el "(con envío[, aprox])" ya va dentro del precio.
function cardText(r) {
  const lines = [stripEmoji(col(r, "titulo"))];
  lines.push(pricePair(r));
  const desc = col(r, "descripcion");
  if (desc) lines.push("", stripEmoji(desc));
  return (
    "Este es un artículo de segunda mano de Wallapop que estoy pensando en comprar. " +
    PRICE_NOTE +
    "Investígalo a fondo (modelo o versión exacta, especificaciones, estado, y su precio típico nuevo y de segunda mano) " +
    "y dime si es buena compra por ese precio. " +
    "Además dime si debería intentar regatear el precio y, si es así, a qué precio propondrías, " +
    "y si lo ves necesario dime qué preguntar al vendedor:\n\n" +
    lines.join("\n")
  );
}
$("#swCopy").onclick = () => {
  if (di >= deck.length) return;
  navigator.clipboard
    .writeText(cardText(deck[di]))
    .then(() => snack("Datos copiados al portapapeles", null))
    .catch(() => snack("No se pudo copiar", null));
};
// ── ordenar el mazo en vivo (precio ↑ · distancia ↑ · más reciente); reclic invierte ──
let swSortCol = null,
  swSortDir = 1;
function applySwipeSort(name) {
  const c = headers.indexOf(name);
  if (c < 0) return;
  if (swSortCol === name) swSortDir = -swSortDir;
  else {
    swSortCol = name;
    swSortDir = 1;
  }
  sortKeys = [{ col: c, dir: swSortDir }];
  paintSortHeaders();
  paintSwipeSort();
  rebuildDeck(); // re-baraja desde el principio con el nuevo orden
}
function paintSwipeSort() {
  document.querySelectorAll("#swipeSort button").forEach((b) => {
    const on = b.dataset.sort === swSortCol;
    b.classList.toggle("on", on);
    b.dataset.dir = on ? (swSortDir > 0 ? "▲" : "▼") : "";
  });
}
document
  .querySelectorAll("#swipeSort button")
  .forEach((b) => (b.onclick = () => applySwipeSort(b.dataset.sort)));
document.addEventListener("keydown", (e) => {
  if (swipeView.hidden) return;
  if (e.key === "Escape") closeSwipe();
  else if (e.key === "ArrowLeft") card && fling(-1);
  else if (e.key === "ArrowRight") card && fling(1);
});

// ── botón atrás del móvil: cierra la superficie abierta (lista/gestor/swipe) en vez de salir de la página ──
// 1 sola entrada de historial sintética "hay algo abierto"; se arma al abrir y se retira al cerrar por UI.
// ponytail: no es una pila; con superficies anidadas hace falta una pulsación de atrás por capa (basta para los flujos de un nivel).
let rbArmed = false;
function anyOpen() {
  return view !== "" || !searchesView.hidden || !swipeView.hidden;
}
function closeTop() {
  // cierra la superficie superior; true si cerró algo
  if (!searchesView.hidden) {
    closeManager();
    return true;
  }
  if (!swipeView.hidden) {
    closeSwipe();
    return true;
  }
  if (view !== "") {
    $("#listBack").click();
    return true;
  } // reusa "volver" (incluye el retorno a swipe del vendedor)
  return false;
}
function reconcileBack() {
  // sincroniza la entrada sintética con "hay algo abierto"
  const open = anyOpen();
  if (open === rbArmed) return;
  if (open) {
    rbArmed = true;
    history.pushState({ rb: 1 }, "");
  } else {
    rbArmed = false;
    history.back();
  } // retira la entrada al cerrar por UI (dispara popstate, que ya no cierra nada)
}
// tutorial: clic en un paso → tarjeta con su número y mensaje bajo el stepper
const tut = document.getElementById("tut");
const tutMsg = document.getElementById("tutMsg");
const tutNum = document.getElementById("tutNum");
const tutTxt = document.getElementById("tutTxt");
[...tut.children].forEach((li, i) => {
  li.addEventListener("click", () => {
    if (li.classList.contains("on")) { // reclic en el activo → cierra
      li.classList.remove("on");
      tutMsg.hidden = true;
      document.body.classList.remove("tut-on");
      return;
    }
    [...tut.children].forEach((o) => o.classList.remove("on"));
    li.classList.add("on");
    tutNum.textContent = i + 1;
    tutTxt.textContent = li.title || "Próximamente…";
    tutMsg.hidden = false;
    document.body.classList.add("tut-on");
    const host = tutMsg.offsetParent.getBoundingClientRect();
    const panel = document.querySelector(".panel"); // el mensaje se posa justo encima del panel de búsqueda
    tutMsg.style.top = panel.getBoundingClientRect().top - host.top - tutMsg.offsetHeight - 10 + "px";
  });
});
// con el tutorial abierto: clic dentro del stepper, del mensaje o de la barra de búsqueda → no cierra;
// clic fuera (velo/atenuado) → cierra y se traga el clic para no tocar nada debajo.
document.addEventListener("click", (e) => {
  if (tutMsg.hidden) return;
  const t = e.target;
  if (tut.contains(t) || tutMsg.contains(t) || t.closest?.(".panel:not(.picker)")) return;
  e.preventDefault();
  e.stopPropagation();
  tut.querySelector(".on")?.classList.remove("on");
  tutMsg.hidden = true;
  document.body.classList.remove("tut-on");
}, true); // fase de captura: intercepta antes de que llegue al objetivo

window.addEventListener("popstate", () => {
  const wasArmed = rbArmed;
  rbArmed = false;
  if (wasArmed && closeTop()) reconcileBack(); // cierra una capa; re-arma si aún queda otra
});

// a11y: los <span class="link"> hacen de botón (ver rechazados, limpiar, parar búsqueda…).
// Dales rol y foco de teclado. ponytail: MutationObserver global; el DOM es diminuto, el
// coste por mutación es despreciable. Sube a armLinks() puntual si algún día pesa.
new MutationObserver(() => {
  for (const el of document.querySelectorAll(".link:not([role])")) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
  }
}).observe(document.body, { childList: true, subtree: true });
document.addEventListener("keydown", (e) => {
  if (e.target.classList?.contains("link") && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    e.target.click();
  }
});
