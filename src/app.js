// ── red de seguridad global: ningún fallo muere en silencio ──
// El fichero está lleno de promesas fire-and-forget (idb.set, el boot, los handlers async). Sin
// esto, cada una moría en un unhandledrejection que nadie escuchaba: cero rastro en consola y
// cero aviso al usuario. Es la red que permite que el wrapper de IndexedDB no lleve un .catch
// mudo en cada llamada: lo que se escape acaba igualmente en consola y en un snack.
// ponytail: dos listeners globales en vez de un try/catch por cada await del fichero.
if (typeof addEventListener === "function") {
  const ruido = (etiqueta, err) => {
    console.error("Rebusca: " + etiqueta, err);
    // snack se define más abajo; para cuando esto dispare ya existe
    if (typeof snack === "function") snack("Fallo interno: " + ((err && err.message) || err), null);
  };
  addEventListener("unhandledrejection", (ev) => ruido("promesa sin capturar", ev.reason));
  addEventListener("error", (ev) => ruido("error no capturado", ev.error || ev.message));
}
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
// ── estado persistente: localStorage (índices pequeños) + IndexedDB (lo gordo) ──
// Escritura a prueba de cuota llena. setLS no lanza NUNCA: avisa una vez y sigue. Un setItem que
// peta suelta la excepción en mitad de fling()/reject(), y la carta se queda congelada donde la
// soltó el dedo, sin clasificar ni avanzar ("los botones no funcionan").
// ponytail: una sola red para las ~20 escrituras del fichero, en vez de try/catch en cada sitio.
const csvCacheKey = "wp_csv"; // cache de CSVs viejo (localStorage): solo se lee para migrarlo a IDB
// marca que deja una restauración: el cache de anuncios que hay en IndexedDB es del ocupante
// anterior. Vive en localStorage a propósito — el almacén que hay que vaciar puede ser justo el
// que no escribe, y la marca tiene que sobrevivir a la recarga para reintentarlo.
const cacheAjenaKey = "wp_cacheajena";
// El aviso NO puede ser una vez por sesión: el snack dura 5 s y en modo swipe lo tapa la carta.
// El usuario seguía clasificando 40 cartas con toda la UI confirmando lo que no se guardaba.
// Throttle de 30 s: vuelve a avisar mientras el fallo siga vivo, sin convertirse en un bucle.
let avisoLleno = 0; // epoch del último aviso
function setLS(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) {
    console.error("Rebusca: no se pudo escribir " + k, e);
    if (Date.now() - avisoLleno > 30000) {
      avisoLleno = Date.now();
      setTimeout(() => snack("Almacenamiento lleno: NO se está guardando. Borra búsquedas viejas en ☰"), 0);
    }
    return false;
  }
}
// Lectura simétrica: un valor corrupto se comporta como ausente. Sin esto, un solo JSON roto
// en cualquier clave tiraba una excepción al evaluar el módulo y la app quedaba inerte en TODA
// carga futura, sin forma de auto-repararse (el usuario no puede borrar lo que no puede abrir).
// `??` y no `||`: un "" guardado cae al fallback igual que antes.
// No basta con parsear: un JSON VÁLIDO de la forma equivocada (5, "texto", [] donde se
// espera {}) crashea igual al primer uso. Si el fallback dice la forma, se exige la forma.
// Con fallback null no se exige nada: ahí el llamador ya sabe distinguir formatos viejos.
// Descartar es correcto; descartar en silencio no. El dato se copia a "roto:<clave>" antes de
// ignorarlo: la app arranca limpia, queda un aviso que mirar y el original sobrevive a la
// siguiente escritura de esa clave. Nadie escribe nunca "roto:*".
// ponytail: copia y deja el original donde está, así el llamador no tiene que acordarse de
// reescribir la clave y apartar dos veces la misma no hace nada.
const apartadas = new Set(); // una vez por clave y sesión: readJSON se llama en cada render
// Claves cuya copia de seguridad NO se pudo escribir. hydrateEstado no debe machacarlas: sin
// copia, esa escritura espejo destruye el único original que queda.
const sinRespaldo = new Set();
function aparta(k, motivo) {
  if (apartadas.has(k)) return;
  apartadas.add(k);
  // `warn` y no `error`: el dato dañado es una condición del entorno que SÍ manejamos (copia +
  // aviso). El nivel `error` queda para lo que de verdad falla, y test_app.js cuenta con eso.
  console.warn(`Rebusca: ${k} tiene la forma equivocada (${motivo}); se ignora.`);
  const crudo = localStorage.getItem(k);
  // setLS y no un try/catch mudo: la copia a roto: es la ÚNICA copia, y su fallo ya no se traga.
  const ok = crudo == null || setLS("roto:" + k, crudo);
  if (!ok) sinRespaldo.add(k);
  // console.error no se ve en un móvil. El usuario tiene que enterarse de que pierde datos.
  setTimeout(() => snack(`Datos dañados en ${k}: se ignoran` + (ok ? ` (copia en roto:${k})` : " y NO se han podido respaldar"), null), 0);
}
// escritura espejo: nunca sobrescribe una clave dañada que no se pudo respaldar.
// La usan TODOS los escritores de estado, no solo las claves espejo: `pushEstado` y
// `saveBuckets` iban por `setLS` y destruían el original en el primer swipe.
// Frenar la escritura salva el original, pero deja al usuario clasificando contra nada. Sin el
// aviso, el arreglo cambia una pérdida de datos por el fallo mudo que `setLS` vino a quitar.
const bloqueadas = new Set(); // una vez por clave y sesión, como `apartadas`
const espejo = (k, v) => {
  if (!sinRespaldo.has(k)) return setLS(k, v);
  if (!bloqueadas.has(k)) {
    bloqueadas.add(k);
    console.warn(`Rebusca: no se escribe ${k}: está dañada y no se pudo respaldar.`);
    setTimeout(() => snack(`No se guarda ${k}: hay datos dañados sin copia. Libera espacio y recarga`, null), 0);
  }
  return false;
};
const readJSON = (k, fb) => {
  let v;
  try { v = JSON.parse(localStorage.getItem(k) ?? "null"); }
  catch { return aparta(k, "no es JSON"), fb; }
  if (v == null) return fb;
  if (fb !== null && (typeof v !== "object" || Array.isArray(v) !== Array.isArray(fb)))
    return aparta(k, "se esperaba " + (Array.isArray(fb) ? "una lista" : "un objeto")), fb;
  return v;
};
// ── IndexedDB: almacén clave/valor para lo que no cabe en localStorage ──
// localStorage son 5 MB DUROS por origen; IndexedDB es un % del disco libre. Aquí viven los CSVs
// (uno por búsqueda, "csv:<nombre>") y "rows" (el cache de filas): justo lo que reventaba la cuota
// y congelaba el triaje. En localStorage solo quedan índices: listas de ids, exclusiones, alias
// y marcas de tiempo. Crecen con lo clasificado, no con lo scrapeado.
// ponytail: 20 líneas de wrapper en vez de una librería.
// El arranque NO pudo leer: rowCache/csvIndex están vacíos por el fallo, no porque no haya datos.
// Escribir encima con ese vacío es la pérdida silenciosa. Se cierra el grifo hasta recargar.
// Una escritura que falla es otra cosa y tiene otra bandera: la memoria sigue buena, no hay nada
// que machacar, e IndexedDB vuelve en sí en cuanto baja la presión. Ahí se avisa y se sigue.
let lecturaRota = false;
let avisadoEscritura = false;
const idb = (() => {
  // Sin rama de memoria para cuando no hay `indexedDB`: su único usuario eran los tests, y el
  // arnés ya trae uno de mentira. Un navegador siempre lo define; si no, `open()` rechaza,
  // `hydrateStores` cierra el grifo y avisa, que es más honesto que un Map que muere al recargar.
  let db;
  // El fallo NO se cachea: `db ||= promesa` guardaba la promesa rechazada, así que un bloqueo
  // transitorio (otra pestaña con la base abierta) rompía IndexedDB para el resto de la sesión.
  const open = () => (db ||= new Promise((res, rej) => {
    const r = indexedDB.open("rebusca", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch((e) => { db = null; throw e; }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction("kv", mode);
      const q = fn(t.objectStore("kv"));
      q.onerror = () => rej(q.error);
      // Una escritura NO está guardada cuando la petición dice que sí: lo está cuando la
      // transacción completa. La cuota de IndexedDB salta justo ahí, al commitear. Con
      // `q.onsuccess` a secas, `await idb.set(...)` resolvía sobre una escritura que se perdía,
      // y el importador recargaba dejando los favoritos restaurados sin sus filas.
      if (mode === "readwrite") {
        t.oncomplete = () => res(q.result);
        t.onabort = () => rej(t.error);
      } else q.onsuccess = () => res(q.result); // leer no commitea nada
    });
  };
  // Un fallo al escribir NO relanza: los `idb.set` del triaje son fire-and-forget, y un rechazo
  // suelto llegaba al unhandledrejection global, que pintaba "Fallo interno" encima del snack de
  // «Deshacer». Se avisa una vez por sesión y se calla.
  // Tampoco cierra el grifo. Cerrarlo convierte un `QuotaExceededError` pasajero — el usuario
  // vacía la papelera y ya cabe — en una sesión entera de solo lectura. Quien necesite saber si
  // SU escritura entró mira el booleano que devuelve, que es la única respuesta que no miente.
  const fallo = (e) => {
    if (avisadoEscritura) return false;
    avisadoEscritura = true;
    console.error("Rebusca: el almacén local no aceptó una escritura", e);
    // snack ya existe cuando esto corre (la primera escritura es muy posterior al módulo), pero
    // la guarda cuesta cuatro palabras y el arranque es el único sitio donde podría no estarlo.
    if (typeof snack === "function") snack("No se pudo guardar en el almacén: puede que algo no quede guardado", null);
    return false;
  };
  // `escribe` devuelve si la transacción commiteó. Con la LECTURA rota ni se intenta: lo que hay
  // en memoria es el vacío del fallo, y volcarlo borra los datos buenos del disco.
  const escribe = (fn) => (lecturaRota ? Promise.resolve(false) : tx("readwrite", fn).then(() => true, fallo));
  return {
    // Sin .catch mudo. Un `get` que devolvía null confundía "el almacén falló" con "no hay dato".
    get: (k) => tx("readonly", (s) => s.get(k)),
    set: (k, v) => escribe((s) => s.put(v, k)),
    del: (k) => escribe((s) => s.delete(k)),
  };
})();
// ── cajón = búsqueda SIN ventana temporal ──
// "ps4--dia.csv" y "ps4--semana.csv" son la MISMA caza: comparten rechazados, interesantes,
// favoritos y exclusiones. Antes el `since` iba dentro de la clave, así que cambiar de "semana"
// a "día" abría un cajón virgen y resucitaba cientos de anuncios ya descartados.
// única fuente del vocabulario de frescura: la regex del cajón y el filtro del deep-link se
// derivan de aquí. Añadir una ventana temporal = añadir una clave a este mapa (y su <option>).
const SINCE_LABEL = {
  hora: "última hora",
  dia: "último día",
  semana: "última semana",
  mes: "último mes",
};
const SINCE_RE = new RegExp("--(" + Object.keys(SINCE_LABEL).join("|") + ")(?=\\.csv$)");
const drawerOf = (csv) => (csv || "").replace(SINCE_RE, "");
const curDrawer = () => drawerOf(curCsv);
// funde las claves de un mapa {csv:…} por cajón; `merge(a,b)` resuelve los choques.
// Idempotente: una clave ya fundida se mapea a sí misma → no hace falta flag de migración.
const foldDrawers = (obj, merge) => {
  const out = {};
  for (const k in obj || {}) { const d = drawerOf(k); out[d] = d in out ? merge(out[d], obj[k]) : obj[k]; }
  return out;
};
const uni = (a, b) => [...new Set([...a, ...b])];
console.assert(
  drawerOf("ps4--semana.csv") === "ps4.csv" && drawerOf("ps4.csv") === "ps4.csv" &&
    drawerOf("tv--mes--dia.csv") === "tv--mes.csv" && drawerOf(null) === "" &&
    JSON.stringify(foldDrawers({ "a--dia.csv": ["x"], "a--mes.csv": ["y"] }, uni)) === '{"a.csv":["x","y"]}',
  "drawerOf()/foldDrawers() roto",
);
console.assert(
  SINCE_RE.test("x--hora.csv") && SINCE_RE.test("x--mes.csv") && !SINCE_RE.test("x--ayer.csv"),
  "SINCE_RE no deriva de SINCE_LABEL",
);
const load = (k) => new Set(readJSON(k, []));
const BUCKET_NAMES = ["rejected", "favorite"]; // los "ficheros" de cada cajón (sin ver = el resto)
// cache de filas por id (objeto {columna:valor}). Permite ver favoritos aunque su
// CSV no esté cargado; guarda _csv (cajón de origen) para migrar el modelo global viejo.
// Se lee de localStorage (clave del modelo viejo) pero se escribe a IndexedDB: el arranque lo
// recarga de allí. Esta lectura es solo el puente para quien todavía traiga wp_rows en disco.
let rowCache = readJSON("wp_rows", {});
// ── cubos POR CAJÓN (búsqueda): cada csv tiene sus propios ficheros, sin fugas entre cajones.
// buckets[nombre] = {csv: Set<id>}. `rejected/favorite` apuntan al cajón activo (curCsv)
// vía pointBuckets(), así el resto del código sigue usando `.has/.add/.delete` sin cambios.
const buckets = { rejected: {}, favorite: {} };
// Array = formato global viejo → reparte por origen (rowCache._csv). {csv:[ids]} = ya por cajón.
// Las claves se funden por cajón (drawerOf) al leer: fusiona los cajones "--dia"/"--semana" viejos.
const toMap = (val, k) => {
  const map = {};
  const add = (c, id) => (map[drawerOf(c)] ||= new Set()).add(id);
  // Sin _csv no se sabe de qué búsqueda salió el id. Archivarlo bajo "" lo metía en un cajón
  // real e inalcanzable: `allQueries` se puebla solo desde wp_searches, así que nadie podía
  // volver a verlo, pero seguía contando y ocupando. Convención: nada se archiva bajo "".
  if (Array.isArray(val)) for (const id of val) { const c = rowCache[id]?._csv; if (c) add(c, id); }
  // `val[c]` tiene que ser una lista de ids: si no lo es, ese cajón se tira entero (con aviso)
  else if (val && typeof val === "object") for (const c in val) {
    if (!Array.isArray(val[c])) { aparta(k, `el cajón ${c} no es una lista de ids`); continue; }
    for (const id of val[c]) add(c, id);
  }
  // Un escalar (5, "texto", true) es JSON válido, así que readJSON con fb=null no lo filtra:
  // los dos formatos legítimos (lista vieja y {cajon:[ids]}) obligan a fb=null. Sin esta rama
  // el cubo se vaciaba en silencio y la escritura espejo lo machacaba sin copia a roto:.
  else if (val != null) aparta(k, "no es una lista ni un mapa de cajones");
  return map;
};
const fromMap = (map) => { const o = {}; for (const c in map) if (map[c].size) o[c] = [...map[c]]; return o; };
const mergeInto = (into, from) => { for (const c in from) { const s = into[c] ||= new Set(); from[c].forEach((id) => s.add(id)); } };
for (const n of BUCKET_NAMES) buckets[n] = toMap(readJSON("wp_" + n, null), "wp_" + n);
// migración: el cubo "interesantes" desaparece; sus ids ascienden a favoritos (y la clave se retira)
mergeInto(buckets.favorite, toMap(readJSON("wp_interested", null), "wp_interested"));
localStorage.removeItem("wp_interested");
let rejected = new Set(), favorite = new Set(); // apuntados a curCsv por pointBuckets()
let pointedDrawer = null; // cajón al que apuntan rejected/favorite ahora mismo
function pointBuckets(csv) { // reapunta las vars al cajón `csv` (créalo vacío si no existe)
  const c = drawerOf(csv);
  // Un "Deshacer" vivo cierra sobre `rejected`/`favorite` POR NOMBRE, así que al pulsarlo
  // opera sobre el cajón actual, no sobre el que lo generó: rechazas en A, cambias a B,
  // deshaces, y el rechazo se queda en A mientras B pierde un id que nunca clasificaste.
  // Este es el único punto por el que pasa un cambio de cajón, así que cubre los 6 sitios
  // que ofrecen deshacer (reject, restore, rejectedLejos, rejectedExcluded, bulkRestore,
  // blockSeller) con una línea. Gatea en el cambio REAL: un loadCSV del mismo csv no debe
  // matar un snack legítimo.
  if (c !== pointedDrawer) { pointedDrawer = c; hideSnack(); }
  rejected = buckets.rejected[c] ||= new Set();
  favorite = buckets.favorite[c] ||= new Set();
}
// Los dos cubos son exclusivos y se escriben siempre juntos: rechazar implica sacar de favoritos
// y al revés. Escribir uno solo es la forma de fallo que las iteraciones 20 y 21 encontraron dos
// veces, así que aquí no se puede escribir uno solo. De paso, `saveRows()` (que recorre `data` y
// `rowCache` enteros) y `pushEstado()` corren una vez por gesto y no dos.
const saveBuckets = () => {
  for (const n of BUCKET_NAMES) espejo("wp_" + n, JSON.stringify(fromMap(buckets[n])));
  saveRows();
  pushEstado();
};
// último lote copiado/exportado a la IA: {csv, ids}. Su respuesta es un enlace ?keep=<ids>:
// esos ids se conservan como favoritos y el RESTO del lote se rechaza de una vez.
// null tiene que significar "no hay lote", no "el lote se corrompió": con un catch mudo el
// veredicto de la IA se aplicaba a medias y msg() reportaba que se aplicó entero. Y un escalar
// pasaba el `if (sent)` de fromURL para reventar en `sent.ids` durante el boot.
const aisent = () => {
  const v = readJSON("wp_aisent", null);
  if (v == null) return null;
  if (typeof v !== "object" || !Array.isArray(v.ids)) return aparta("wp_aisent", "no es un lote {csv, ids}"), null;
  return v;
};
// `originCsv` se captura ANTES del await del llamador. Leer curDrawer() aquí lo leía tarde:
// entre el clic de copiar y su resolución el usuario puede cambiar de búsqueda, y el lote
// quedaba etiquetado con la búsqueda equivocada. Su ?keep= aterrizaba en el cajón que no era.
function setAisent(rows, originCsv) {
  // recuerda el lote y cachea sus filas: el veredicto puede llegar en otra sesión, sin CSV cargado
  const ids = [];
  for (const r of rows) {
    const id = col(r, "id");
    if (!id) continue;
    ids.push(id);
    rowCache[id] = { ...rowToObj(r), _csv: rowCache[id]?._csv || originCsv };
  }
  setLS("wp_aisent", JSON.stringify({ csv: originCsv, ids }));
  idb.set("rows", rowCache);
}
const bucketed = (id) => BUCKET_NAMES.some((n) => Object.values(buckets[n]).some((s) => s.has(id))); // en algún cajón
const rowToObj = (r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]));
const objToRow = (o) => headers.map((h) => o[h] ?? ""); // reconstruye fila posicional con el esquema actual
function saveRows() {
  for (const r of data) { const id = col(r, "id"); if (id && bucketed(id)) rowCache[id] = { ...rowToObj(r), _csv: rowCache[id]?._csv || curDrawer() }; } // refresca con lo cargado; recuerda de qué búsqueda salió
  const sentIds = new Set(aisent()?.ids || []); // el lote enviado a la IA se retiene hasta su veredicto
  for (const id in rowCache) if (!bucketed(id) && !sentIds.has(id)) delete rowCache[id]; // poda el resto
  idb.set("rows", rowCache); // a IndexedDB: en localStorage se comía la cuota y tumbaba el triaje
}
// filas del cubo activo = las de `data` + las que solo viven en cache (item vendido/expirado)
// Un id del cubo que no está ni en `data` ni en rowCache se caía por el borde: el contador lo
// sigue contando y la lista no lo enseña. Deja rastro una vez por id, sin ensuciar cada render.
const huerfanosVistos = new Set();
function bucketRows(set) {
  const seen = new Set(), out = [];
  for (const r of data) { const k = key(r); if (set.has(k)) { seen.add(k); out.push(r); } }
  const huerfanos = [];
  for (const id of set)
    if (!seen.has(id)) {
      if (rowCache[id]) out.push(objToRow(rowCache[id]));
      else if (!huerfanosVistos.has(id)) { huerfanosVistos.add(id); huerfanos.push(id); }
    }
  if (huerfanos.length) console.warn(`Rebusca: ${huerfanos.length} ids clasificados sin fila en cache, no se muestran:`, huerfanos);
  return out;
}
const blockSel = load("wp_blocksel"); // vendedores bloqueados (user_id): sus anuncios van a la papelera solos, presentes y futuros
// Los seis mapas de ajustes se guardan igual: su clave, su JSON, y el blob de estado detrás.
// Un molde en vez de seis copias de cuatro líneas; los nombres se quedan, que es lo que se llama.
const saver = (k, dame) => () => {
  setLS(k, JSON.stringify(dame()));
  pushEstado();
};
const saveBlockSel = saver("wp_blocksel", () => [...blockSel]);
let stamp = readJSON("wp_stamp", {}); // {key: epochMs}: cuándo se clasificó (para "descartado/destacado hace X"); legacy sin stamp no muestra línea
const stampNow = (k) => {
  stamp[k] = Date.now();
  setLS("wp_stamp", JSON.stringify(stamp));
};
const unstamp = (k) => {
  if (k in stamp) {
    delete stamp[k];
    setLS("wp_stamp", JSON.stringify(stamp));
  }
};
let exclMap = readJSON("wp_excl", {}); // {csv: [palabras]}: por query, cartas con la palabra en el título se auto-descartan (fuera del mazo)
const exclTerms = () => (curCsv && exclMap[curDrawer()]) || []; // palabras vetadas del cajón activo
const saveExcl = saver("wp_excl", () => exclMap);
// topes numéricos por cajón: lo que pase de precio/antigüedad/distancia sale del mazo solo,
// igual que una palabra vetada (y con el mismo atajo "mandar a rechazados" en el stat).
// Se guardan por búsqueda, así se re-aplican en cada re-scrape sin volver a teclearlos.
const LIMITS = [["precio", "€"], ["dias", "días"], ["km", "km"]]; // techos, uno por columna
// `precioMin` es el único suelo (de ahí overMax/underMin aparte); esta lista es además el
// orden en que salen las cajas en el cajón.
const LIM_CAMPOS = ["precioMin", ...LIMITS.map(([c]) => c)];
let limMap = readJSON("wp_lim", {}); // {cajon: {precioMin, precio, dias, km}}
const limits = () => (curCsv && limMap[curDrawer()]) || {};
const saveLimits = saver("wp_lim", () => limMap);
let catExclMap = readJSON("wp_catexcl", {}); // {csv: [categorias]}: categorías vetadas por query (match exacto sobre la columna categoria)
const catExclTerms = () => (curCsv && catExclMap[curDrawer()]) || [];
const saveCatExcl = saver("wp_catexcl", () => catExclMap);
let catModeMap = readJSON("wp_catmode", {}); // {csv: "incluir"}: si es "incluir", las categorías marcadas son las ÚNICAS que se conservan (resto a rechazados); por defecto "excluir"
const catMode = () => (curCsv && catModeMap[curDrawer()]) || "excluir";
const saveCatMode = saver("wp_catmode", () => catModeMap);
let aliasMap = readJSON("wp_alias", {}); // {csv: "apodo"}: nombre legible por búsqueda; NO toca el CSV ni los keywords reales
const saveAlias = saver("wp_alias", () => aliasMap);
// App 100% local: un solo usuario por navegador, sin perfiles. Estado en claves fijas.
// Migración one-shot del modelo multi-perfil: adopta el estado del perfil activo (wp_perfil)
// a las claves fijas y retira los índices de perfiles. Las claves viejas wp_*_<nombre>
// quedan inertes (no se borran: revertir la rama restauraría los perfiles con sus datos).
// El borrado NO puede ser incondicional. La migración duplica el estado, así que es justo el
// caso que llena la cuota. Si una copia falla y wp_perfil ya no está, la migración no vuelve a
// intentarse nunca: la app aparece vacía con los datos intactos en localStorage e inalcanzables.
(function migrateFromPerfiles() {
  const old = localStorage.getItem("wp_perfil");
  let ok = true;
  if (old)
    for (const b of ["wp_estado", "wp_searches", "wp_lastcsv", "wp_lastseen"])
      if (localStorage.getItem(b) == null) {
        const v = localStorage.getItem(b + "_" + old);
        if (v != null) ok = setLS(b, v) && ok;
      }
  if (ok) {
    localStorage.removeItem("wp_perfil");
    localStorage.removeItem("wp_perfiles");
  } else setTimeout(() => snack("No se pudo migrar tu estado: libera espacio y recarga", null), 0);
})();
// el cache de pesos reales por anuncio: la feature se quitó y esto solo ocupa cuota.
// ponytail: borrable a partir de 2027 (para entonces ya no queda ningún navegador con la clave).
localStorage.removeItem("wp_pesos");
const estadoKey = () => "wp_estado"; // estado durable (un usuario por navegador)
function pushEstado() {
  // `espejo` y no `setLS`: si el blob estaba dañado y su copia a roto: no cupo, `sinRespaldo`
  // lo marca y este `setLS` era justo quien lo machacaba. `hydrateEstado` respetaba la marca
  // en las siete claves espejo pequeñas mientras el blob que protegían se perdía al primer gesto.
  espejo(
    estadoKey(),
    JSON.stringify({
      rejected: fromMap(buckets.rejected),
      favorite: fromMap(buckets.favorite),
      blockSel: [...blockSel],
      excl: exclMap,
      catExcl: catExclMap,
      catMode: catModeMap,
      lim: limMap,
      alias: aliasMap,
      stamp,
    }),
  );
}
// carga el estado desde localStorage (un usuario por navegador: no hay más fuente de verdad)
function hydrateEstado() {
  // readJSON y no un JSON.parse suelto: wp_estado lo contiene TODO y era la única clave del
  // fichero que se corrompía en silencio. Ahora avisa, copia a roto:wp_estado y saca snack.
  let e = readJSON(estadoKey(), {});
  {
    {
      // ponytail: doble bloque solo para conservar la indentación del cuerpo original intacta
      const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}); // ignora formatos viejos
      const arr = (v) => (Array.isArray(v) ? v : []);
      e = obj(e); // el blob puede venir siendo null/5/"texto"/[]: entonces no hay blob
      // Cada campo vive en dos sitios: su clave espejo (wp_rejected, wp_excl…) y el blob
      // wp_estado, que lo duplica todo. Reasignar desde el blob machacaba la clave espejo, y
      // el blob es el que más fácil falla por cuota (es el grande, y se escribe el último).
      // Precedencia POR CAMPO: manda la espejo si existe; el blob solo rellena lo que falte
      // (instalación anterior a las claves fijas, o migración desde perfiles).
      // No se fusionan: una unión no sabe representar un borrado, así que resucitaría en cada
      // arranque un rechazo que el usuario acaba de retirar.
      const mir = (k, blobVal) => (localStorage.getItem(k) != null ? readJSON(k, null) : blobVal);
      for (const n of BUCKET_NAMES) buckets[n] = toMap(mir("wp_" + n, e[n]), "wp_" + n); // reparte por cajón (o migra el global viejo)
      mergeInto(buckets.favorite, toMap(e.interested, "wp_estado")); // migración: interesantes viejos ascienden a favoritos
      // cubos exclusivos POR CAJÓN: papelera > favoritos.
      const cajones = new Set([...Object.keys(buckets.rejected), ...Object.keys(buckets.favorite)]);
      for (const c of cajones) {
        const rej = buckets.rejected[c], fav = buckets.favorite[c];
        if (fav) for (const k of fav) if (rej?.has(k)) fav.delete(k);
      }
      pointBuckets(curCsv); // reapunta rejected/favorite al cajón activo
      blockSel.clear();
      arr(mir("wp_blocksel", e.blockSel)).forEach((x) => blockSel.add(x));
      // `espejo` y no `setLS`: si la clave estaba dañada y su copia a roto: no cupo, esta
      // escritura destruía el único original que quedaba.
      espejo("wp_blocksel", JSON.stringify([...blockSel]));
      // los tres se funden por cajón: "ps4--dia" y "ps4--semana" comparten exclusiones
      exclMap = foldDrawers(obj(mir("wp_excl", e.excl)), uni); // {cajon:[palabras]}
      catExclMap = foldDrawers(obj(mir("wp_catexcl", e.catExcl)), uni); // {cajon:[categorias]}
      catModeMap = foldDrawers(obj(mir("wp_catmode", e.catMode)), (a, b) => a || b); // {cajon:"incluir"}
      limMap = foldDrawers(obj(mir("wp_lim", e.lim)), (a, b) => ({ ...b, ...a })); // {cajon:{precioMin,precio,dias,km}}
      espejo("wp_lim", JSON.stringify(limMap));
      aliasMap = obj(mir("wp_alias", e.alias)); // {csv:"apodo"}
      espejo("wp_alias", JSON.stringify(aliasMap));
      // wp_stamp se escribe SIN pasar por pushEstado (stampNow/unstamp), así que su clave
      // espejo es estructuralmente más nueva que el blob para este campo.
      stamp = obj(mir("wp_stamp", e.stamp)); // {key:epochMs} cuándo se clasificó
      espejo("wp_stamp", JSON.stringify(stamp));
      for (const n of BUCKET_NAMES) espejo("wp_" + n, JSON.stringify(fromMap(buckets[n]))); // espejo offline (por cajón)
      espejo("wp_excl", JSON.stringify(exclMap));
      espejo("wp_catexcl", JSON.stringify(catExclMap));
      if (data.length) render();
    }
  }
  return Promise.resolve();
}

const HIDE = new Set(["id", "cp", "url", "vendedor", "imagen", "imagenes"]); // no se muestran como columna (url va en el boton Ver; vendedor/imagen(es) se usan en la tarjeta/dossier)
// esquema fijo del scraper (== FIELDS de scrape.js). Sirve de headers por defecto para poder
// renderizar favoritos desde el cache aunque no se haya scrapeado nada esta sesión.
const DEFAULT_HEADERS = ["id", "titulo", "precio", "categoria", "ciudad", "cp", "km", "dias",
  "reservado", "top", "garantia", "reacond",
  "envio", "url", "vendedor", "imagen", "imagenes", "descripcion"];
let headers = DEFAULT_HEADERS.slice(),
  data = [],
  sortKeys = [],
  view = ""; // view: '' mazo | 'rejected' papelera | 'favorite' favoritos
// ¿hay un CSV cargado de verdad? OJO: `headers` arranca poblado con DEFAULT_HEADERS, así que
// `headers.length` es truthy desde el primer render y NO sirve de señal: por eso un usuario nuevo
// veía "Nada que revisar." y cuatro contadores a 0 en vez de la bienvenida.
let loadedCsv = null;
const WELCOME =
  "Bienvenid@ a Rebusca. Escribe arriba qué quieres cazar y pulsa Buscar.\n" +
  '¿No sabes qué modelos buscar? Dale a "✦ pídeselo a la IA".';
let fabAction = () => openSwipe(); // el botón grande cambia de destino según el paso del embudo
const rejectedSel = new Set(); // selección en masa de la papelera (keys); solo viva en view==='rejected'
let iId = headers.indexOf("id"),
  iUrl = headers.indexOf("url"),
  iTitulo = headers.indexOf("titulo"),
  iPrecio = headers.indexOf("precio");
const isNum = (v) => v !== "" && !isNaN(v);
// identidad del anuncio DENTRO de su cajón = id inmutable de Wallapop. La clasificación es
// por cajón (curCsv): el mismo id en otra búsqueda se clasifica aparte. Fallback titulo|precio
// para un CSV sin columna `id`; el arrastre de CSV que lo justificaba ya no existe, pero el
// scraper puede devolver un anuncio sin id y sin el fallback ese anuncio no se puede clasificar.
const itemId = (r) => (iId >= 0 && r[iId]) || r[iTitulo] + "|" + r[iPrecio];
const key = (r) => itemId(r); // id de Wallapop; el cajón lo pone curCsv (buckets[…][curCsv])

// --- precio final estimado al comprador (envío protegido de Wallapop) ---
// La tarifa de envío va por tramo de peso (kg <= tope -> €), verificada contra la API:
// 2 -> 3,50 | 5 -> 4,50 | 10 -> 6,50 | 20 -> 9,50 | 30 -> 14,50.
// El anuncio NO trae el peso: había que pedir cada item a la API (1 request por anuncio) y el
// dato salía mal a menudo. Se estima el tramo de 5 kg para todos, que cubre la mayoría.
const PORTE = 4.5;
// ponytail: comisión de protección ~0,70€ + 5% del precio; las fuentes divergen (5–10%),
// ajústalo aquí si cambia. Un solo sitio para toda la app.
const finalPrice = (precio) => precio + 0.7 + 0.05 * precio + PORTE;
console.assert(finalPrice(50).toFixed(2) === "57.70", "finalPrice roto");
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
  const min = Math.floor(dias * 1440); // negativo cae en la rama de abajo: no hay Math.max que valga
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
// + lo transcurrido desde el scrape. Sin curCsvScrape, solo la congelada.
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

// ── señal de precio: ¿este anuncio es un chollo DENTRO de su propio lote? ──
// La app tenía todos los precios en memoria y no comparaba nada; el usuario lo hacía de cabeza.
// La mediana (no la media) porque un solo anuncio de 12.000€ no la mueve.
// Aviso: una búsqueda con OR mezcla productos distintos y ahí la mediana engaña. Por eso el chip
// pide DOS cosas: muestra suficiente (8 precios) y una desviación grande (30%). Con menos, calla.
let medianPrice = null; // mediana del lote cargado; la recalcula loadCSV
const DEAL_MIN = 30; // % por debajo de la mediana a partir del cual sale el chip
// null con menos de 8 precios: con cuatro anuncios la mediana no es una referencia, es una anécdota
function median(nums) {
  const p = nums.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const n = p.length;
  return n < 8 ? null : n % 2 ? p[(n - 1) / 2] : (p[n / 2 - 1] + p[n / 2]) / 2;
}
console.assert(
  median([1, 2, 3]) === null &&
    median([9, 1, 2, 3, 4, 5, 6, 7, 8]) === 5 &&
    median([8, 1, 2, 3, 4, 5, 6, 7]) === 4.5 &&
    median([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -3, NaN]) === 5, // 0, negativos y basura fuera
  "median() roto",
);
// % por debajo de la mediana, o 0 si no hay chollo que anunciar
const dealOff = (precio) => {
  if (!medianPrice || !isNum(precio) || +precio <= 0) return 0;
  const off = Math.round((1 - +precio / medianPrice) * 100);
  return off >= DEAL_MIN ? off : 0;
};

const norm = (s) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ── posibles duplicados: el mismo vendedor republica el mismo producto con otro id ──
// El scraper solo deduplica por id exacto, así que una republicación entra como anuncio nuevo y
// vuelve a la cola de "sin ver". Aquí se agrupa por vendedor + título normalizado, una vez por
// carga, igual que la mediana.
// ponytail: heurística, no verdad. Un vendedor con dos unidades del mismo modelo cae en el mismo
// grupo y se marca igual. Por eso el chip solo informa: no filtra, no oculta y no rechaza nada.
// Si algún día molesta el falso positivo, compara también el precio dentro del grupo.
let dupCount = new Map(); // "vendedor|titulo" -> cuántos anuncios del lote comparten esa clave
// sin vendedor o sin título no se agrupa: la clave vacía juntaría anuncios que no tienen que ver.
// Los espacios de más se colapsan aquí y no en norm(), que lo comparte el filtro de búsqueda:
// al republicar, el mismo título vuelve con otro espaciado y si no, el grupo se parte en dos.
const dupKey = (v, t) => (v && t ? norm(v) + "|" + norm(t).replace(/\s+/g, " ") : "");
function countDups(rows, iVend, iTit) {
  const m = new Map();
  if (iVend < 0 || iTit < 0) return m;
  for (const r of rows) {
    const k = dupKey(r[iVend], r[iTit]);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
console.assert(
  (() => {
    const m = countDups(
      [["Ana", "Ford Focus"], ["ana", " ford  focus"], ["Ana", "Fórd Focus"], ["Luis", "Ford Focus"], ["", "Ford Focus"]],
      0,
      1,
    );
    // los espacios de más y los acentos no parten el grupo; el vendedor vacío no entra
    return m.get("ana|ford focus") === 3 && m.get("luis|ford focus") === 1 && m.size === 2;
  })(),
  "countDups() roto",
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
    // decodifica fuera del hilo de la interfaz: en el móvil, una foto grande decodificada en el
    // hilo principal congela el swipe justo cuando el dedo está encima de la tarjeta
    im.decoding = "async";
    im.src = img;
    im.onerror = () => im.remove(); // si falla, queda el fondo neutro del media
    media.append(im);
  }
  // tocar la foto abre la galería con TODAS las del anuncio (`imagenes` viene en mejor
  // resolución que la miniatura `imagen`; si no hay lista, al menos la portada)
  const fotos = (col(r, "imagenes") || "").split(" ").filter(Boolean);
  const shots = fotos.length ? fotos : img ? [img] : [];
  if (shots.length) {
    media.className = "li-media tap";
    media.setAttribute("role", "button");
    media.tabIndex = 0;
    media.title = "ver las fotos";
    media.setAttribute("aria-label", `ver las ${shots.length} fotos`);
    media.onclick = () => !swDragged && openGal(shots);
    media.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openGal(shots);
    };
  }
  // etiqueta de precio: el chollo. Chip teal sobre la foto (con envío = precio final estimado)
  const price = document.createElement("span");
  price.className = "li-price";
  if (conEnvio && isNum(precio)) {
    price.textContent = eur(finalPrice(+precio));
  } else {
    price.textContent = precio !== "" ? `${dec1(precio)}€` : "—";
  }
  media.append(price);
  // chollo: cuánto por debajo de la mediana del lote está este precio (solo si es mucho)
  const off = dealOff(precio);
  if (off) {
    const d = document.createElement("span");
    d.className = "li-deal";
    d.textContent = "−" + off + " %";
    d.title = `${off} % por debajo de la mediana del lote (${eur(medianPrice)})`;
    media.append(d);
  }
  // reservado: el CSV lo traía desde el principio y solo lo leía el texto para la IA. Va encima
  // de la foto porque cambia la decisión ANTES de salir a Wallapop.
  if (col(r, "reservado") === "True") {
    const res = document.createElement("span");
    res.className = "li-res";
    res.textContent = "Reservado";
    media.append(res);
  }
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
      "li-when" + (view === "favorite" ? " interested" : ""),
      `${view === "favorite" ? "Favorito" : "Rechazado"} ${ago(stamp[key(r)])}`,
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
  // señales que ya estaban en el CSV y no pintaba nadie: cuántas fotos trae el anuncio (una foto
  // borrosa o siete claras es una señal barata) y las tres banderas del vendedor/artículo
  const nFotos = fotos.length;
  const extra = [];
  if (nFotos) extra.push(`${nFotos} ${nFotos === 1 ? "foto" : "fotos"}`);
  if (col(r, "garantia") === "True") extra.push("garantía");
  if (col(r, "reacond") === "True") extra.push("reacondicionado");
  if (col(r, "top") === "True") extra.push("perfil top");
  const nDup = dupCount.get(dupKey(col(r, "vendedor"), col(r, "titulo"))) || 0;
  if (nDup > 1) extra.push(`${nDup} anuncios iguales`);
  if (extra.length) {
    const ex = document.createElement("span");
    ex.className = "li-extra"; // span y no un nodo de texto suelto: así hay algo que mirar
    ex.textContent = " · " + extra.join(" · ");
    flags.append(ex);
  }
  // id de Wallapop: el mismo [#...] que la IA maneja. Visible solo en las listas (donde se cotejan
  // sus veredictos); un toque lo copia, y pegándolo en el filtro (#id) se localiza el anuncio.
  const id = col(r, "id");
  if (view !== "" && id) {
    const chip = document.createElement("span");
    chip.className = "li-id";
    chip.textContent = "#" + id;
    chip.title = "copiar el id";
    chip.onclick = () =>
      // los otros tres puntos de copia del fichero ya avisan; este era el único mudo
      navigator.clipboard.writeText(id).then(() => snack("Id copiado", null)).catch(() => snack("No se pudo copiar el id", null));
    flags.append(document.createTextNode(" · "), chip);
  }

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
  setLS("wp_listsort", listSort + "|" + listSortDir);
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
// ponytail: compara el precio del anuncio, no el "precio para mí" (comisión+envío); es el número
// que el usuario ve al poner el tope. Vacío o no numérico nunca cae por un tope.
const overMax = (v, max) => max != null && isNum(v) && +v > max;
console.assert(
  overMax("120", 100) && !overMax("100", 100) && !overMax("", 100) && !overMax("x", 100) &&
    !overMax("120", undefined),
  "overMax() roto",
);
// el suelo de precio va aparte de los techos, pero con el mismo criterio: un precio vacío o no
// numérico no cae por él (si no, un anuncio sin precio desaparecía al poner un mínimo cualquiera)
const underMin = (v, min) => min != null && isNum(v) && +v < min;
console.assert(
  underMin("80", 100) && !underMin("100", 100) && !underMin("", 100) && !underMin("x", 100) &&
    !underMin("80", undefined),
  "underMin() roto",
);
const overLimit = (r) =>
  LIMITS.some(([c]) => overMax(col(r, c), limits()[c])) ||
  underMin(col(r, "precio"), limits().precioMin);
// "lejos sin envío": a más de N km y sin envío, difícil en la práctica. Entran al mazo como cualquiera; su línea en el stat es un atajo para rechazarlos en bloque (o quedan excluidos solos con el ajuste).
let lejosKm = +localStorage.getItem("wp_lejoskm") || 10; // umbral configurable (Ajustes)
const isLejos = (r) => {
  const km = col(r, "km");
  return km !== "" && +km > lejosKm && col(r, "envio") !== "True";
};
let autoExclLejos = localStorage.getItem("wp_autoexcllejos") === "1"; // si activo, los lejos-sin-envío quedan excluidos del mazo (Ajustes)
// fuera del mazo por algún filtro de AFINAR: el contador los cuenta juntos, así que el motivo
// exacto no hace falta aquí (desglosarlo pedía una línea por motivo y en 320 px no la valía)
const isExcluded = (r) => {
  if (autoExclLejos && isLejos(r)) return true; // ajuste "excluir lejos sin envío": fuera del mazo, no a la papelera
  if (overLimit(r)) return true; // pasa de precio/antigüedad/distancia máximos del cajón
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
// Se recuerda: quien ordena su papelera por precio la quiere así mañana también. Todo lo demás de
// la pantalla (filtros, umbrales, ajustes) ya sobrevive a la recarga; esto era lo único que no.
const [sort0, dir0] = (localStorage.getItem("wp_listsort") || "|-1").split("|");
let listSort = sort0,
  listSortDir = +dir0 || -1; // por defecto: recién añadido arriba
function sortList(rows) {
  if (!listSort) {
    const order = [...(view === "rejected" ? rejected : favorite)]; // orden de llegada a la lista
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

// cartas del mazo: sin clasificar y sin vetar (base de swipe, copiar-todo y rechazo por criterio; los lejos-sin-envío también entran)
function deckRows() {
  return data.filter((r) => {
    const k = key(r);
    return !rejected.has(k) && !favorite.has(k) && !isExcluded(r);
  });
}
function filteredRows() {
  const listView = view === "rejected" || view === "favorite";
  if (listView) {
    const q = norm(listQ); // el filtro solo aplica en vista de lista
    const set = view === "rejected" ? rejected : favorite;
    const rows = bucketRows(set).filter((r) => {
      // "#id" fuerza id (varios separados por comas/espacios: pega tal cual la lista que te haya
      // dado la IA); cualquier otra cosa casa título O id (id sin # también vale)
      if (q) {
        const id = norm(col(r, "id") || "");
        if (q.startsWith("#")) {
          const want = q.slice(1).split(/[,\s]+/).filter(Boolean);
          if (!want.some((w) => id.includes(w))) return false;
        } else if (!norm(col(r, "titulo") || "").includes(q) && !id.includes(q)) return false;
      }
      if (view === "rejected" && listSeller && col(r, "vendedor") !== listSeller) return false;
      return true; // pertenencia al cubo ya garantizada por bucketRows
    });
    sortList(rows); // las listas ordenan con su barra (#listSort)
    return rows;
  }
  const rows = deckRows();
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

function render() {
  enforceBlocks(); // vendedores bloqueados a la papelera antes de filtrar
  const rows = filteredRows();
  const listView = view === "rejected" || view === "favorite";
  tbody.innerHTML = "";
  // la tabla SOLO se ve en modo lista (favoritos/papelera). En el mazo el swipe monta su propia
  // tarjeta, así que estos <tr> se construían para nadie, justo cuando el usuario espera resultados.
  if (listView) {
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(rowTr(r)); // lista = ficheros del cajón activo (curCsv), sin agrupar
    tbody.append(frag);
  }
  return finishRender(rows, listView);
}
function rowTr(r) {
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
    // el rojo de reposo lo lleva el botón que destruye; en la papelera el mismo botón restaura
    quit.className = "btn quitar" + (view === "rejected" ? " restaura" : "");
    quit.textContent = view === "rejected" ? "Restaurar" : "Quitar";
    quit.onclick = () =>
      view === "rejected"
        ? restore(k)
        : reject(k, r[iTitulo]); // en favoritos, quitar = rechazar (los cubos son sin ver / rechazados / favoritos)
    act.append(ver, quit);
    tr.append(act);

    tr.append(listBody(r));
    return tr;
}
function finishRender(rows, listView) {
  $("table").hidden = !(listView && loadedCsv); // la tabla es la vista de lista editable (favoritos/papelera)
  // pantalla dedicada: en modo lista se oculta TODO el header de búsqueda y sale la barra de lista
  document.querySelector("header").classList.toggle("pinned", listView); // fija la barra solo en modo lista (ver CSS)
  $(".brand").hidden = listView;
  document
    .querySelectorAll("header .panel")
    .forEach((p) => (p.hidden = listView)); // los dos: el de buscar y el de "Búsqueda activa"
  // primer arranque: sin búsquedas guardadas ni CSV cargado, "Búsqueda activa" es un selector
  // vacío que solo estorba encima de la bienvenida. Vuelve en cuanto hay algo que elegir.
  $(".picker").hidden = listView || !(loadedCsv || allQueries.length);
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
        : listSeller
          ? "Rechazados del vendedor"
          : "Rechazados";
  // copiar/PDF para la IA: sobre los favoritos (su veredicto vuelve como enlace ?keep=…)
  $("#exportFav").hidden = !(view === "favorite" && rows.length);
  $("#dossierFav").hidden = !(view === "favorite" && rows.length);
  const favConEnvio =
    view === "favorite" && rows.some((r) => col(r, "envio") === "True");
  $("#priceNote").hidden = !favConEnvio; // la nota explica ese precio final: mismo criterio que el botón
  const hasRows = loadedCsv && rows.length;
  // en el mazo mandan dos botones: copiar el mazo a la IA (primario) y el swipe manual (secundario)
  $("#copyDeck").hidden = !hasRows || listView;
  const favN = data.filter((r) => favorite.has(key(r))).length;
  const showCopy = !listView && loadedCsv && !rows.length && favN; // mazo agotado y hay favoritos: ofrece mandarlos a la IA
  $("#copyFav").hidden = !showCopy;
  // El FAB dice a dónde lleva: "REBUSCAR" se leía como "buscar otra vez" (justo lo contrario) y
  // dejaba al recién llegado sin ver ni un anuncio. Con el mazo agotado lleva a la cosecha
  // (el texto para la IA vive dentro de esa lista, #exportFav, y en #copyFav aquí mismo).
  const toFav = !listView && loadedCsv && !rows.length && favN && view === "";
  const fab = $("#swipeFab");
  fab.hidden = listView || !(hasRows || toFav); // en modo lista se edita en la tabla, no se hace swipe
  if (!fab.hidden) {
    fabAction = toFav ? () => { view = "favorite"; render(); } : openSwipe;
    fab.textContent = toFav
      ? `Ver mis ${favN} favorito${favN === 1 ? "" : "s"}`
      : rows.length === 1
        ? "Ver el anuncio"
        : `Ver los ${rows.length} anuncios uno a uno`;
  }
  $("#empty").hidden = !!hasRows || !!showCopy; // el botón ocupa el hueco (mismo sitio), sin texto que lo empuje abajo
  if (!loadedCsv) $("#empty").textContent = WELCOME; // usuario nuevo: bienvenida, no "Nada que revisar."
  else if (!rows.length)
    $("#empty").textContent =
      listView && listQ
        ? "Nada coincide con el filtro."
        : view === "rejected"
          ? "No hay rechazados."
          : view === "favorite"
            ? "Sin favoritos todavía."
            : !data.length
              ? "Esta búsqueda no ha devuelto ningún anuncio. Prueba con menos palabras o amplía la ventana de tiempo."
              : "Ya has revisado todos los anuncios de esta búsqueda. Vuelve a buscar para ver los nuevos.";
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
    loadedCsv && view === "" && curCsv && headers.includes("categoria");
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
      const cur = catExclMap[curDrawer()] || (catExclMap[curDrawer()] = []);
      const i = cur.indexOf(c);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(c);
      if (!cur.length) delete catExclMap[curDrawer()];
      saveCatExcl();
      render();
    };
    chips.append(b);
  }
  $("#catLabel").textContent = inc ? "Incluir categorías" : "Excluir categorías";
  cuentaFiltros($("#catCount"), excl.length); // nº de categorías marcadas, nada si 0
  const mode = $("#catMode"); // alterna excluir/incluir para esta búsqueda
  mode.textContent = inc ? "modo excluir" : "modo incluir";
  mode.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inc) delete catModeMap[curDrawer()];
    else catModeMap[curDrawer()] = "incluir";
    saveCatMode();
    render();
  };
  const clr = $("#catClear"); // limpiar (en el summary): reactiva todas las categorías marcadas
  clr.hidden = !excl.length;
  clr.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    delete catExclMap[curDrawer()];
    saveCatExcl();
    render();
  };
}

// añade una palabra a la exclusión del cajón activo (compartido main + swipe). Devuelve
// false y no toca nada si la palabra se queda vacía al normalizar, si no hay cajón, o si ya está.
function addExcl(raw) {
  const w = norm(raw);
  if (!w || !curCsv || exclTerms().includes(w)) return false;
  (exclMap[curDrawer()] ||= []).push(w);
  saveExcl();
  return true;
}
function delExcl(w) {
  exclMap[curDrawer()] = exclTerms().filter((x) => x !== w);
  if (!exclMap[curDrawer()].length) delete exclMap[curDrawer()];
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
// El (n) del rótulo dice cuántos filtros hay puestos ahí dentro: es lo único que avisa de un
// veto activo con el desplegable cerrado. Ninguno se abre solo — abrirlos por su cuenta dejaba
// la cabecera desplegada para siempre (`render()` corre por cualquier cosa) y tapaba las cartas.
// `function` y no `const`: renderCats la llama y vive más arriba en el fichero.
function cuentaFiltros(span, n) {
  span.textContent = n ? " (" + n + ")" : "";
}
// palabras vetadas + topes numéricos (las categorías van aparte, en renderCats).
// Solo con CSV cargado y fuera de las vistas de lista.
function renderExcl() {
  const box = $("#excl"),
    lims = $("#lims");
  if (!box) return;
  box.hidden = lims.hidden = !(loadedCsv && view === "" && curCsv);
  fillExclChips($("#exclChips"), render);
  for (const c of LIM_CAMPOS) $("#lim_" + c).value = limits()[c] ?? "";
  cuentaFiltros($("#exclCount"), exclTerms().length);
  cuentaFiltros($("#limCount"), Object.keys(limits()).length);
}
// topes del cajón: vacío o 0 = sin tope
for (const c of LIM_CAMPOS)
  $("#lim_" + c).onchange = (e) => {
    if (!curCsv) return;
    const v = +e.target.value,
      m = (limMap[curDrawer()] ||= {});
    if (v > 0) m[c] = v;
    else delete m[c];
    if (!Object.keys(m).length) delete limMap[curDrawer()];
    saveLimits();
    render();
  };
// la ✕ de vaciar (`#clr_<campo>`, ver app.css). Vaciar el valor no basta: el campo solo reacciona
// a su `onchange`, así que sin llamarlo el tope se borraba de la caja pero seguía filtrando el mazo.
for (const id of ["kw", "exclAdd", ...LIM_CAMPOS.map((c) => "lim_" + c)]) {
  const inp = $("#" + id);
  $("#clr_" + id).onclick = () => {
    inp.value = "";
    inp.onchange?.({ target: inp });
    inp.focus?.(); // el teclado sigue abierto: lo normal tras vaciar es escribir otra cosa
  };
}

function paintStat() {
  if (!loadedCsv) {
    $("#stat").innerHTML = "";
    $("#deckSort").hidden = true;
    return;
  }
  const clasif = (r) => rejected.has(key(r)) || favorite.has(key(r)); // ya en algún cubo
  const favoriteCount = data.filter((r) => favorite.has(key(r))).length;
  const disc = data.filter((r) => rejected.has(key(r))).length;
  const hasExcl = exclTerms().length || catExclTerms().length || Object.keys(limits()).length || autoExclLejos; // ad-hoc: palabra en título, categoría, tope numérico o lejos-sin-envío
  const vetados = hasExcl
    ? data.filter((r) => !clasif(r) && isExcluded(r)).length
    : 0;
  const lejos = data.filter(
    (r) => !clasif(r) && !isExcluded(r) && isLejos(r),
  ).length;
  const sinVer = data.length - favoriteCount - disc - vetados; // "vistos" = favoriteCount + disc; vetados salen aparte. Los lejos SÍ cuentan (están en el mazo); su línea es solo atajo para rechazarlos en bloque
  // Tres semánticas: el mazo (sin ver), los descartes y los guardados. Los descartes van en su
  // propio bloque con la papelera a la cabeza, porque excluidos y lejos no son cubos aparte: son
  // los dos atajos que mandan ahí. Colgados de ella, el enlace no tiene que repetir el destino.
  $("#stat").innerHTML =
    // el aviso vive AQUÍ y no solo en el snack del scrape: sin él, abrir esta búsqueda dentro de
    // una semana enseña un recorte con cara de lista completa, y las cifras de debajo lo respaldan.
    (curCsvParcial
      ? `<span class="parcial">Resultado parcial: ${curCsvParcial}&nbsp;· <span class="link" id="statRepetir">Repetir</span></span>`
      : "") +
    `<span><b>${sinVer}</b> sin ver</span>` +
    `<div class="grp rej">` +
    `<span><b>${disc}</b> rechazados` +
    (disc || view === "rejected"
      ? `&nbsp;· <span class="link" id="toggleTrash">${view === "rejected" ? "volver" : "ver rechazados"}</span>`
      : "") +
    `</span>` +
    (vetados
      ? `<span class="sub"><b>${vetados}</b> excluidos por filtros&nbsp;· <span class="link" id="rejectedExcl">rechazar</span></span>`
      : "") +
    (lejos
      ? `<span class="sub"><b>${lejos}</b> lejos y sin envío&nbsp;· <span class="link" id="rejectedLejos">rechazar</span></span>`
      : "") +
    `</div>` +
    `<span class="g-fav"><b>${favoriteCount}</b> favoritos` +
    (favoriteCount || view === "favorite"
      ? `&nbsp;· <span class="link" id="toggleFavorite">${view === "favorite" ? "volver" : "ver favoritos"}</span>`
      : "") +
    `</span>`;
  // el orden no es un contador: vive encima del mazo, que es lo que ordena
  const ds = $("#deckSort");
  ds.hidden = !sortKeys.length;
  if (sortKeys.length)
    ds.innerHTML =
      `Ordenado por <b>${sortKeys.map((s) => headers[s.col] + (s.dir > 0 ? " ▲" : " ▼")).join(" › ")}</b>` +
      `<span class="link" id="clearSort">quitar orden</span>`;
  const toggle = (v) => () => {
    view = view === v ? "" : v;
    listSeller = "";
    sellerReturn = false;
    $("#empty").textContent = "";
    render();
  };
  const t = $("#toggleTrash");
  if (t) t.onclick = toggle("rejected");
  const st = $("#toggleFavorite");
  if (st) st.onclick = toggle("favorite");
  const el = $("#rejectedLejos");
  if (el) el.onclick = rejectedLejos;
  const te = $("#rejectedExcl");
  if (te) te.onclick = rejectedExcluded;
  const cs = $("#clearSort");
  if (cs) cs.onclick = clearSort;
  const rp = $("#statRepetir");
  if (rp) rp.onclick = () => { const { kw, since } = queryParts(loadedCsv); relaunch(kw, since); };
}

// los dos "rechazar en bloque" de la barra de estado eran la misma función con otro filtro y otro
// mensaje: elige los que no están clasificados, sella, guarda y ofrece deshacer. El deshacer es lo
// que no conviene tener escrito dos veces: olvidar el `unstamp` en una de las copias no lo nota
// nadie, y la fecha de "rechazado hace X" se queda mintiendo para siempre.
const bulkReject = (pred, msg) => () => {
  const ks = data
    .filter((r) => !rejected.has(key(r)) && !favorite.has(key(r)) && pred(r))
    .map(key);
  if (!ks.length) return;
  ks.forEach((k) => {
    rejected.add(k);
    stampNow(k);
  });
  saveBuckets();
  render();
  snack(msg(ks.length), () => {
    ks.forEach((k) => {
      rejected.delete(k);
      unstamp(k);
    });
    saveBuckets();
    render();
  });
};
// manda los "lejos y sin envío" actuales a la papelera de una vez (deshacer: los saca)
const rejectedLejos = bulkReject(isLejos, (n) => `${n} lejos a la papelera`);
// manda todos los excluidos actuales a la papelera de una vez (deshacer: los saca)
const rejectedExcluded = bulkReject(
  isExcluded,
  (n) => `${n} excluido${n === 1 ? "" : "s"} a la papelera`,
);

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
  saveBuckets();
  render();
  snack(msg, () => {
    snap.forEach(([k, s]) => {
      rejected.add(k);
      if (s !== undefined) stamp[k] = s;
    });
    reblock(unblocked);
    setLS("wp_stamp", JSON.stringify(stamp));
    saveBuckets();
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
      favorite.delete(k);
      rejected.add(k);
      stampNow(k);
      changed = true;
    }
  }
  if (changed) {
    saveBuckets();
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
    else if (!favorite.has(k) && !isExcluded(r) && !isLejos(r))
      (fresh[s] = fresh[s] || []).push(r);
  }
  return Object.keys(rej)
    .filter((s) => rej[s] >= 2 && fresh[s] && !blockSel.has(s))
    .map((s) => ({ s, rejected: rej[s], fresh: fresh[s] }))
    .sort((a, b) => b.rejected - a.rejected);
}
// bloquear vendedor: TODO lo suyo que no estuviera ya rechazado se va a la papelera, favoritos
// incluidos. Deshacer desbloquea, saca esos de la papelera y devuelve a favoritos los que lo eran.
function blockSeller(s) {
  const newly = data
    .filter((r) => col(r, "vendedor") === s && !rejected.has(key(r)))
    .map(key);
  blockSel.add(s);
  saveBlockSel();
  const wereFavorite = newly.filter((k) => favorite.has(k)); // para restaurar su cubo al deshacer
  newly.forEach((k) => {
    favorite.delete(k);
    rejected.add(k);
    stampNow(k);
  });
  saveBuckets();
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
    saveBuckets();
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
  const cands = !swipeView.hidden && loadedCsv ? sellerCandidates() : [];
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
  const wasFavorite = favorite.has(k); // al rechazar sale de favoritos (cubos exclusivos)
  favorite.delete(k);
  rejected.add(k);
  stampNow(k);
  saveBuckets();
  render();
  snack(`Rechazado: ${(titulo || "").slice(0, 40)}`, () => {
    rejected.delete(k);
    if (wasFavorite) {
      favorite.add(k);
      stampNow(k);
    } else unstamp(k);
    saveBuckets();
    render();
  });
}
// saca de la papelera. Solo toca `rejected` y la marca de tiempo: si además era favorito, sigue
// siéndolo (un favorito llega aquí por un bloqueo de vendedor, y deshacerlo lo devuelve entero).
function restore(k) {
  rejected.delete(k);
  unstamp(k);
  const unblocked = unblockFor([k]); // si su vendedor estaba bloqueado, desbloquéalo o vuelve solo a la papelera
  saveBuckets();
  render();
  snack("Restaurado", () => {
    rejected.add(k);
    stampNow(k);
    reblock(unblocked);
    saveBuckets();
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
  $("#undo").onclick = null; // los 220ms de salida ya no son clicables
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (s.hidden = true), 220); // en snackTimer, no suelto: un snack nuevo lo cancela
}

// ── carga de un CSV (texto) ──
function loadCSV(text, name) {
  loadedCsv = name; // a partir de aquí hay dataset real: se acabó la pantalla de bienvenida
  pointBuckets(name); // apunta al cajón de este CSV antes de render (runScrape carga antes de selectQueryUI)
  const rows = parseCSV(text);
  // Un CSV vacío (scrape abortado, cache truncado) no puede tumbar la carga: sin cabecera se
  // usa el esquema del scraper. Y las filas se rellenan hasta la cabecera, porque una celda
  // `undefined` se pinta literal ("undefined€") y revienta cmpCell al ordenar por esa columna.
  headers = rows[0] || DEFAULT_HEADERS.slice();
  data = rows.slice(1).map((r) => (r.length === headers.length ? r : Array.from(headers, (_, i) => r[i] ?? "")));
  sortKeys = [];
  view = "";
  iId = headers.indexOf("id");
  iUrl = headers.indexOf("url");
  iTitulo = headers.indexOf("titulo");
  iPrecio = headers.indexOf("precio");
  if (iTitulo < 0) iTitulo = 0;
  // referencia de precio del lote: una vez por carga, no por tarjeta
  medianPrice = iPrecio < 0 ? null : median(data.map((r) => +r[iPrecio]));
  dupCount = countDups(data, headers.indexOf("vendedor"), iTitulo);

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
let curCsvScrape = 0; // epoch ms del scrape (el `ts` que guardó el cache): base para la edad real
let curCsvParcial = ""; // por qué el CSV cargado va recortado ("" = completo); lo dice la barra de estado
const lastCsvKey = () => "wp_lastcsv"; // último dataset cargado
async function loadQuery(csv) {
  const c = await getCsvCache(csv);
  if (c) { // ya scrapeada antes: pinta lo cacheado, no re-scrapea (usa "Repetir" para refrescar)
    curCsvScrape = c.ts;
    curCsvParcial = c.parcial || "";
    loadCSV(c.text, csv);
    return;
  }
  // sin cache: primera vez que se abre (o cache podado) → scrape (kw+since del nombre)
  const { kw, since } = queryParts(csv);
  return runScrape(kw, since, false).catch((e) => {
    if (e.name !== "AbortError") snack("No se pudo buscar: " + e.message, null);
  });
}
// "última vez que abrí esta búsqueda": ordena la vista de gestión por interacción reciente
const lastSeenKey = () => "wp_lastseen";
function stampSeen(csv) {
  if (!csv) return;
  const m = readJSON(lastSeenKey(), {});
  m[csv] = Date.now();
  setLS(lastSeenKey(), JSON.stringify(m));
}
// muestra/oculta la línea del "desde". La clase has-since es lo que parte la caja en dos pisos:
// sin ella el input vuelve a llevar su propio marco y ocupa la caja entero.
function setSince(since) {
  pickSince.textContent = since ? SINCE_LABEL[since] : "";
  pickSince.hidden = !since;
  qbox.classList.toggle("has-since", !!since);
}
function selectQueryUI(csv) {
  // sincroniza el combobox con la query SIN cargar datos: input = kw, badge = "desde"
  const { kw, since } = queryParts(csv);
  pick.value = kw;
  curCsv = csv;
  pointBuckets(csv); // ficheros del cajón de esta búsqueda
  setSince(since);
  setLS(lastCsvKey(), csv); // último dataset cargado
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
  const seen = readJSON(lastSeenKey(), {}); // {csv: epochMs} última vez que se abrió cada búsqueda
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
// al arrancar restaura la última búsqueda. Si está cacheada, la PINTA (desde IndexedDB, sin red):
// antes solo sincronizaba el combobox y la app abría vacía teniendo los resultados a mano.
// Sin cache solo sincroniza: nada de golpes de red/403 automáticos al abrir.
function restoreLastCsv() {
  const last = localStorage.getItem(lastCsvKey());
  if (!last) return;
  refreshCsvs().then(() => {
    if (!allQueries.some((q) => q.csv === last)) return;
    if (csvIndex[last]) selectQuery(last);
    else selectQueryUI(last);
  });
}

// nombre de CSV → partes de la query: "ps4--semana.csv" → {kw:"ps4", since:"semana"}
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
  // hasOwn y no la indexación a secas: el nombre viene del usuario y `SINCE_LABEL["constructor"]`
  // devuelve una función, así que "ps4--constructor" pasaba por frescura y llegaba al scraper.
  const since = i >= 0 && Object.hasOwn(SINCE_LABEL, base.slice(i + 2)) ? base.slice(i + 2) : "";
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
// Aquí NO viven los resultados: la entrada es {csv, rows, mtime(s)}. El texto CSV va aparte, a
// IndexedDB. Abrir una guardada sirve ese cache si existe; re-scrapea solo si no hay o das "Repetir".
const searchesKey = () => "wp_searches";
// filtra las entradas sin csv: una sola envenenada rompía el arranque entero. Las sanas de
// esa misma lista se quedan, y el original entero se aparta para poder rescatarlo.
const loadSearches = () => {
  const l = readJSON(searchesKey(), []);
  const sanas = l.filter((s) => s && typeof s.csv === "string");
  if (sanas.length !== l.length) aparta(searchesKey(), "hay entradas sin csv");
  return sanas;
};
const writeSearches = (list) =>
  setLS(searchesKey(), JSON.stringify(list));
function saveSearch(csv, rows) {
  const list = loadSearches().filter((s) => s.csv !== csv); // upsert: la última corrida manda
  list.push({ csv, rows, mtime: Math.floor(Date.now() / 1000) });
  writeSearches(list);
}
const removeSearch = (csv) => {
  writeSearches(loadSearches().filter((s) => s.csv !== csv));
  dropCsvCache(csv);
};

// por qué un scrape salió recortado, en una frase que se le puede enseñar al usuario tal cual
// ("" = completo). Va al cache y de ahí a la barra de estado, así que sigue explicándose semanas
// después: el snack de la búsqueda se lo lleva el viento en tres segundos.
const motivoParcial = (d) =>
  !d.parcial ? ""
  : d.abortado ? "búsqueda parada a medias"
  : d.bloqueado ? "Wallapop bloqueó esta red"
  : d.tope ? `tope de ${d.tope} anuncios`
  : d.ramasRotas ? `${d.ramasRotas} de ${d.ramas} ramas fallaron`
  // el tope se reparte entre ramas: una rama puede quedarse corta sin que el total llegue
  : `${d.ramasTope} de ${d.ramas} ramas llenaron su cupo`;
console.assert(
  motivoParcial({ parcial: false, tope: 200 }) === "" &&
    motivoParcial({ parcial: true, abortado: true }) === "búsqueda parada a medias" &&
    motivoParcial({ parcial: true, tope: 200 }) === "tope de 200 anuncios" &&
    motivoParcial({ parcial: true, ramasTope: 2, ramas: 3 }) === "2 de 3 ramas llenaron su cupo",
  "motivoParcial roto",
);

// cache del CSV scrapeado por búsqueda: seleccionar una búsqueda pinta esto (sin re-scrapear);
// "Repetir"/Buscar sí re-scrapea y refresca el cache. El TEXTO va a IndexedDB (uno por búsqueda,
// sin tope: ahí sobra sitio); en memoria solo queda el índice {csv:{ts, ids, parcial?}}, unos KB,
// que es lo que permite contar "sin ver" por búsqueda sin abrirlas ni re-scrapear.
// Una entrada NO significa "esto es todo lo que hay": significa "esto es lo que se recogió, y esto
// es lo que pasó". `parcial` (frase, "" = completo) es lo que distingue las dos cosas. Antes no
// existía el campo, así que un recorte solo se podía marcar NO guardándolo: el usuario perdía sus
// anuncios reales y volvía a abrir la búsqueda en blanco. Las entradas viejas no lo llevan, y eso
// las lee bien: solo se cacheaban las completas.
let csvIndex = {};
const getCsvCache = async (csv) => {
  const e = csvIndex[csv];
  if (!e) return null;
  const text = await idb.get("csv:" + csv);
  return text ? { text, ts: e.ts, parcial: e.parcial || "" } : null;
};
// Retira la marca cuando el índice entra. Sin esto, la marca que se queda puesta porque el almacén
// no commiteó no caduca nunca, y el arranque de dentro de dos días se lleva por delante el cache
// que el usuario construyó DESPUÉS de restaurar. OJO con la premisa: el índice que entra prueba
// que el disco tiene lo que hay en MEMORIA, no que el texto del ocupante anterior se haya ido. Por
// eso solo lo llama quien acaba de pisar ese texto; ver `cacheCsv`.
const guardaIndice = async () => {
  if (await idb.set("csvIndex", csvIndex)) localStorage.removeItem(cacheAjenaKey);
};
async function cacheCsv(csv, text, ts, parcial) {
  // el campo solo se escribe cuando lo hay: una entrada completa es byte a byte la de siempre
  csvIndex[csv] = { ts, ids: data.map((r) => col(r, "id")).filter(Boolean), ...(parcial && { parcial }) }; // `data` = este CSV recién cargado
  const saved = new Set(loadSearches().map((s) => s.csv)); // poda: solo búsquedas vivas
  for (const k in csvIndex) if (!saved.has(k) && k !== csv) { delete csvIndex[k]; idb.del("csv:" + k); }
  // El texto se espera: si entra, pisa al homónimo que dejara el ocupante anterior y la marca ya
  // se puede retirar. Si no entra —el índice son unos KB y cabe, el CSV son cientos y no—, el
  // nombre del índice apuntaría al texto del ocupante y sus anuncios saldrían como del usuario.
  const okTexto = await idb.set("csv:" + csv, text);
  if (okTexto) guardaIndice(); else idb.set("csvIndex", csvIndex);
}
function dropCsvCache(csv) {
  if (!(csv in csvIndex)) return;
  delete csvIndex[csv];
  idb.del("csv:" + csv);
  idb.set("csvIndex", csvIndex); // borrar UN nombre no prueba nada sobre los demás textos del ocupante
}
// anuncios cacheados de esa búsqueda que aún no están en ningún cubo de su cajón. null = sin cache
// (no se puede saber sin re-scrapear). Es lo que responde "¿qué búsqueda tiene algo nuevo?".
// Un cache PARCIAL también responde null: contar sin-ver contra un recorte es contar contra un
// denominador inventado, y esa cifra es la que ordena el gestor.
function unseenCount(csv) {
  const e = csvIndex[csv];
  if (!e || e.parcial) return null;
  const d = drawerOf(csv);
  const done = new Set();
  for (const n of BUCKET_NAMES) for (const id of buckets[n][d] || []) done.add(id);
  return e.ids.filter((id) => !done.has(id)).length;
}
// La rueda es el menú de opciones y nada más: llevaba un badge con la suma de anuncios sin
// clasificar de TODAS las búsquedas guardadas (la activa incluida), y con volúmenes reales vivía
// clavado en "99+". El recuento sigue donde sirve, por búsqueda, en el gestor.
// migración one-shot: saca de localStorage lo gordo (CSVs + cache de filas) y lo mete en IndexedDB.
// Hasta ahora compartían los 5 MB con el triaje; al llenarse, clasificar una carta lanzaba y el
// mazo se congelaba. Tras esto, localStorage solo guarda ids.
// Una restauración dejó el cache de anuncios del ocupante anterior, y lo dijo con una marca en
// localStorage. Se vacía aquí y no en el importador: allí, un almacén que no escribiese obligaba a
// lanzar, y ese `throw` deshacía la restauración entera — los cubos, las búsquedas y los alias
// viven en localStorage y se restauran sin tocar IndexedDB. `csvIndex` se vacía en memoria pase lo
// que pase: sin índice, un texto suelto no lo pinta nadie, y por eso la llamada va FUERA del `try`
// —dentro, un `throw` de la migración se la saltaba entera y el arranque pintaba los anuncios del
// ocupante anterior—. La marca se queda hasta que una escritura del índice entre.
async function dropCacheAjena() {
  if (localStorage.getItem(cacheAjenaKey) === null) return;
  for (const k in csvIndex) idb.del("csv:" + k);
  csvIndex = {};
  await guardaIndice();
}
async function hydrateStores() {
  try {
    await hydrateStoresRaw();
  } catch (e) {
    // Cierra el grifo: idb.set/del ya no escriben, así que el primer swipe no machaca el
    // cache bueno con el vacío que dejó el fallo de lectura.
    lecturaRota = true;
    console.error("Rebusca: no se pudo leer el almacén local", e);
    // Sin `setTimeout`: `snack` es una declaración de función, así que está izada, y esto corre
    // después de un `await`, con el módulo ya evaluado y el DOM en pie. El retraso solo servía
    // para que el aviso genérico de la escritura fallida se quedase encima de este, que es el
    // honesto: aquí no hay «puede que algo no quede guardado», aquí no se guarda nada.
    snack("No se pudo abrir el almacén: esta sesión NO guardará cambios", null);
  }
  await dropCacheAjena(); // fuera del `try`: el vaciado del cache ajeno no depende de que la lectura fuera bien
}
async function hydrateStoresRaw() {
  if (localStorage.getItem("wp_rows") !== null) {
    // El wrapper se traga el fallo de escritura para no dejar rechazos sueltos por el triaje, así
    // que el `await` no corta el borrado: hay que mirar lo que devuelve, o este borrado tira la
    // única copia de las fichas que quedaba.
    if (!(await idb.set("rows", rowCache))) // rowCache se leyó de localStorage al evaluar el módulo
      throw new Error("el almacén no aceptó las filas migradas");
    localStorage.removeItem("wp_rows");
  } else rowCache = (await idb.get("rows")) || {};
  const viejo = localStorage.getItem(csvCacheKey);
  if (viejo === null) { csvIndex = (await idb.get("csvIndex")) || {}; return; }
  // readJSON avisa y copia a roto:wp_csv; el catch mudo tiraba TODOS los CSVs cacheados sin rastro
  const m = readJSON(csvCacheKey, {});
  localStorage.removeItem(csvCacheKey); // ya leído (o ya apartado): libera la cuota
  let ok = true;
  for (const k in m) {
    const rows = parseCSV(m[k].text || ""), i = (rows[0] || []).indexOf("id");
    if (i < 0) continue;
    csvIndex[k] = { ts: m[k].ts, ids: rows.slice(1).map((r) => r[i]).filter(Boolean) };
    ok = (await idb.set("csv:" + k, m[k].text)) && ok;
  }
  // Igual que su hermana de arriba: `wp_csv` ya se borró, así que si el texto no entró el CSV se
  // perdió. Devolver OK deja `csvIndex` lleno de entradas cuyo texto no existe, y el badge de
  // «sin ver» cuenta anuncios que no se pueden abrir. Lanzar cierra el grifo y avisa.
  if (!((await idb.set("csvIndex", csvIndex)) && ok))
    throw new Error("el almacén no aceptó los CSVs migrados");
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

// nombre de cajón de una búsqueda: es la CLAVE de todo el estado (cubos, exclusiones, alias,
// cache en IndexedDB), no un fichero. Nadie lo escribe en disco: el scrape corre en el browser.
// Mismo slug que wallapop.py para que un CSV bajado a mano case con su cajón.
const csvNameOf = (kw, since) =>
  kw.toLowerCase().split(/\s+/).filter(Boolean).join("-") +
  (since ? "--" + since : "") +
  ".csv";
// ubicación del scrape: la que guardó el botón de ubicación en wp_loc, o Jaén por defecto
const JAEN_LOC = { lat: 37.7796, lon: -3.7849 };
// El spread metía lat/lon no numéricos tal cual en la petición a la API: JSON válido con la
// forma equivocada no lo filtraba ningún catch. readJSON cubre el JSON roto; la comprobación
// de finitud cubre el JSON válido con basura dentro.
const getLoc = () => {
  const v = readJSON("wp_loc", {});
  const num = (x) => typeof x === "number" && Number.isFinite(x);
  if (v.lat === undefined && v.lon === undefined) return JAEN_LOC;
  if (!num(v.lat) || !num(v.lon)) return aparta("wp_loc", "lat/lon no son números"), JAEN_LOC;
  return { lat: v.lat, lon: v.lon };
};
// pinta el overlay: n = contador de encontrados (o null al arrancar, sin dato aun)
function setLoading(on, n, hechas, ramas) {
  const box = $("#loading");
  $("#stat").hidden = on; // los stats son de la query vieja: ocúltalos mientras se busca
  $(".panel.picker").hidden = on; // búsqueda activa + exclusiones son de la query vieja: fuera mientras se busca
  if (!on) {
    box.hidden = true;
    return;
  } // render() recoloca #empty/botón al cargar el CSV
  $("#empty").hidden = true;
  $("#swipeFab").hidden = true;
  $("#copyDeck").hidden = true;
  $("#copyFav").hidden = true;
  box.hidden = false;
  // Las ramas OR van de cuatro en cuatro, así que no hay "la que va": lo que se cuenta son las
  // terminadas. Con una sola rama el sufijo sobra y no sale.
  const deRama = ramas > 1 ? ` · ${hechas}/${ramas} ramas` : "";
  $("#loadingCount").textContent = (n ? `${n} encontrados` : "Buscando…") + deRama;
}
let _timer;
let scrapeCtrl = null; // scrape en vuelo: pulsar Buscar otra vez cancela el anterior
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
  scrapeCtrl?.abort(); // el anterior deja de pedir páginas; el usuario quiere ESTA búsqueda
  const ctrl = (scrapeCtrl = new AbortController());
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
      onProgress: (n, hechas, ramas) => {
        if (live) setLoading(true, n, hechas, ramas);
      },
      signal: ctrl.signal,
    });
    // el chequeo va DESPUÉS del await: scrape.js resuelve con el CSV parcial al abortar, así que
    // sin esto el perdedor seguiría hasta loadCSV/cacheCsv/saveSearch. AbortError y no return:
    // un return dejaría queryParts(undefined) -> TypeError en el onclick de Buscar.
    if (ctrl !== scrapeCtrl) { const e = new Error("scrape superado"); e.name = "AbortError"; throw e; }
    curCsvScrape = Date.now(); // CSV recién generado: base para la edad real de cada anuncio
    const diag = Rebusca.lastScrape || {};
    // se lee ANTES de loadCSV: la barra de estado lo pinta en el render que hace loadCSV
    curCsvParcial = motivoParcial(diag);
    loadCSV(text, csv);
    const aviso = curCsvParcial
      ? `Resultado parcial (${curCsvParcial}): se guarda marcado, dale a Repetir para completarlo`
      : diag.ramasSecas
      ? `${diag.ramasSecas} de ${diag.ramas} ramas dejaron de traer anuncios nuevos y se cerraron ahí.`
      : "";
    if (aviso) snack(aviso, null);
    // guarda resultados: seleccionar esta búsqueda no re-scrapea. El cache no caduca, así que el
    // vacío se queda vacío para siempre: una API que responde 200 sin anuncios dejaría la búsqueda
    // a cero aunque tenga miles. Re-scrapear una búsqueda sin resultados cuesta una página.
    // Un recorte SÍ se guarda, marcado: sus anuncios son reales y tirarlos dejaba la búsqueda en
    // blanco al reabrirla. Lo que no puede pasar es que se lea como completo, y de eso va el campo.
    if (data.length) cacheCsv(csv, text, curCsvScrape, curCsvParcial);
    saveSearch(csv, data.length); // recuerda la búsqueda (kw+since) para el combobox y el gestor
    return csv;
  } finally {
    live = false;
    // gateado: el perdedor no puede matar el cronómetro ni el overlay del ganador
    if (ctrl === scrapeCtrl) {
      clearInterval(_timer);
      setLoading(false);
      scrapeCtrl = null;
    }
  }
}
$("#scrape").onclick = async () => {
  const kw = $("#kw").value.trim();
  if (!kw) return;
  const since = $("#since").value || "";
  const btn = $("#scrape");
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
    // etiqueta fija, no la que había: con dos scrapes a la vez el segundo capturaba "Buscando…"
    // como texto "original" y el botón se quedaba así para siempre
    btn.textContent = "Buscar";
  }
};
$("#kw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#scrape").click();
});
// El campo vacío no dice qué cabe pedirle, y un ejemplo fijo con OR deja pensando que esto va de
// fuentes de alimentación. Cosas de andar por casa: la sintaxis la explica la "i" de al lado.
// Los 50 son lo que se mueve en Wallapop de segunda mano (electrónica, hogar, bebé, deporte,
// motor...), a ojo y no de ningún ranking oficial; cambiarlos no rompe nada. En minúscula y
// cortos: el campo mide 320 px menos los márgenes y no hay ellipsis que valga.
const EJEMPLOS = [
  "iphone", "ps5", "nintendo switch", "xbox series", "airpods", "macbook", "portátil gaming",
  "monitor 27", "teclado mecánico", "silla gaming", "tv 55", "barra de sonido", "altavoz jbl",
  "disco duro", "impresora", "router wifi", "drone", "cámara réflex", "objetivo canon", "gopro",
  "microondas", "lavadora", "nevera", "aire acondicionado", "deshumidificador", "thermomix",
  "freidora de aire", "cafetera nespresso", "aspiradora", "sofá", "mesa de comedor", "armario",
  "colchón", "estantería", "espejo", "bicicleta", "bici de montaña", "patinete eléctrico",
  "cinta de correr", "mancuernas", "tabla de surf", "esquís", "carrito de bebé", "trona",
  "silla de coche", "lego", "guitarra", "vinilos", "moto 125", "taladro",
];
let iEjemplo = Math.floor(Math.random() * EJEMPLOS.length);
// nunca dos veces el mismo seguido: salta entre 1 y n-1 posiciones hacia delante
const otroEjemplo = (i) => (i + 1 + Math.floor(Math.random() * (EJEMPLOS.length - 1))) % EJEMPLOS.length;
const frase = () => `Prueba con "${EJEMPLOS[iEjemplo]}"`;
$("#kwph").textContent = frase(); // el del HTML es solo el que se ve mientras carga el JS
$("#kwph").addEventListener("animationend", (e) => e.target.classList.remove("rota"));
function rotaPlaceholder() {
  const kw = $("#kw"),
    ph = $("#kwph");
  // escribiendo o con algo escrito, el ejemplo no se ve o salta bajo el cursor: mejor quieto
  if (document.activeElement === kw || kw.value) return;
  iEjemplo = otroEjemplo(iEjemplo);
  ph.classList.add("rota"); // el viejo sube y sale; el nuevo entra por abajo
  setTimeout(() => (ph.textContent = frase()), 225); // a mitad, con el hueco vacío
}
// La rotación es una bienvenida, no un tic para toda la sesión: las esperas crecen en Fibonacci
// (x, x, 2x, 3x…) y se corta en la de 22,4 s — seis rotaciones, algo menos de un minuto. Al
// principio enseña la variedad; luego se queda quieto y no se mueve nada al lado del cursor.
const ritmoFib = (x, n) => {
  const r = [];
  for (let a = 1, b = 1; r.length < n; [a, b] = [b, a + b]) r.push(a * x);
  return r;
};
if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
  ritmoFib(2800, 6).reduce((t, ms) => (setTimeout(rotaPlaceholder, t + ms), t + ms), 0);
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

// ── gestor de búsquedas: vista CRUD sobre las definiciones de wp_searches ──
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
  allSearches = loadSearches();
  paintSearches();
}
function paintSearches() {
  const q = norm(searchesQ);
  const hits = allSearches.filter((s) =>
    norm((aliasMap[s.csv] || "") + " " + queryParts(s.csv).kw).includes(q),
  );
  const seen = readJSON(lastSeenKey(), {});
  const touched = (s) => Math.max(seen[s.csv] || 0, s.mtime * 1000); // abierta o rescrapeada: lo más reciente manda
  // "¿qué búsqueda tiene carne?": se cuenta contra el CSV cacheado, sin red y sin abrirla. Las que
  // tienen algo sin ver suben arriba: era lo único que no podías saber sin re-scrapear una a una.
  const sinVer = {};
  for (const s of hits) sinVer[s.csv] = unseenCount(s.csv);
  hits.sort((a, b) => (sinVer[b.csv] > 0) - (sinVer[a.csv] > 0) || touched(b) - touched(a));
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
    const age = humanAge(nowDays - s.mtime / 86400); // humanAge ya corta las edades negativas
    card.innerHTML =
      `<div class="sc-top"><span class="sc-kw"></span>` +
      (since
        ? `<span class="sc-since">${cap(SINCE_LABEL[since])}</span>`
        : "") +
      `</div>` +
      (alias ? `<div class="sc-realkw"></div>` : "") +
      `<div class="sc-meta">${s.rows} resultado${s.rows === 1 ? "" : "s"} · ${age}` +
      // sin cifra: unseenCount() resta solo lo ya clasificado, no aplica las exclusiones ni los
      // topes, así que el número era mayor que el mazo real. Deuda conocida: el badge sigue
      // apareciendo aunque TODOS los sin-ver estén excluidos y el mazo salga vacío.
      (sinVer[s.csv] ? ` · <b class="sc-new">sin ver</b>` : "") +
      // el gestor es donde se compara una búsqueda con otra: sin la marca, la que trae 20 de 200
      // se lee igual que la completa de al lado, y "Repetir" parece un capricho en vez de la cura
      (csvIndex[s.csv]?.parcial ? ` · <b class="sc-parcial" title="${esc(csvIndex[s.csv].parcial)}">parcial</b>` : "") +
      `</div>` +
      `<div class="sc-btns">` +
      `<button class="ghost sc-run">${ic("search")} Repetir</button>` +
      `<button class="ghost sc-ren">${ic("pencil")} Renombrar</button>` +
      `<button class="ghost sc-link">${ic("copy")} Enlace</button>` +
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
    card.querySelector(".sc-link").onclick = () => shareSearch(kw, since);
    card.querySelector(".sc-del").onclick = () => deleteSearch(s.csv, kw);
    searchesList.appendChild(card);
  }
}
// ── enlace de una búsqueda ──
// La app parsea ocho parámetros de URL y no construía ninguno. Con el enlace se le pasa una
// búsqueda a otra persona, o te la llevas a otro móvil (no hay cuentas ni sincronización).
// Al abrirlo, fromURL() rellena el buscador y pulsa Buscar solo.
const searchURL = (kw, since) =>
  location.origin + location.pathname + "?" + new URLSearchParams(since ? { q: kw, since } : { q: kw });
console.assert(
  searchURL("tv led", "semana").endsWith("?q=tv+led&since=semana") &&
    searchURL("tv led", "").endsWith("?q=tv+led"), // sin since no se ensucia la URL
  "searchURL() roto",
);
function shareSearch(kw, since) {
  copyAsync(() => searchURL(kw, since))
    .then((compartido) => snack(compartido ? "Enlace compartido" : "Enlace copiado", null))
    .catch(() => snack("No se pudo copiar el enlace", null));
}
function relaunch(kw, since) {
  // "Repetir" repite: antes solo rellenaba el buscador y te dejaba pulsar Buscar tú, así que la app
  // no tenía NINGÚN camino de "refresca esto y enséñame lo nuevo", que es el gesto del día a día.
  $("#kw").value = kw;
  $("#since").value = since || "";
  closeManager();
  $("#scrape").click();
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
      setLS(lastCsvKey(), newCsv);
    } else {
      curCsv = null;
      loadedCsv = null;
      pointBuckets(null);
      pick.value = "";
      setSince("");
      localStorage.removeItem(lastCsvKey());
      headers = [];
      data = [];
      sortKeys = [];
      view = "";
      thead.innerHTML = ""; // sin query activa: nada de stats/rebuscar stale
      $("#empty").textContent = WELCOME;
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

// ── ajustes: auto-exclusión y umbral "lejos" (por dispositivo, en localStorage) ──
const autoExclEl = $("#autoExclLejos"),
  lejosKmEl = $("#lejosKm");
autoExclEl.checked = autoExclLejos;
lejosKmEl.value = lejosKm;
autoExclEl.onchange = () => {
  autoExclLejos = autoExclEl.checked;
  setLS("wp_autoexcllejos", autoExclLejos ? "1" : "0");
  render();
};
lejosKmEl.onchange = () => {
  lejosKm = +lejosKmEl.value || 10;
  lejosKmEl.value = lejosKm;
  setLS("wp_lejoskm", lejosKm);
  render();
};
// ── ubicación: km y "lejos" se miden desde aquí ──
// wp_loc lo leía getLoc() desde siempre, pero nadie lo escribía: todo el mundo buscaba desde Jaén.
// El navegador solo suelta la ubicación real con permiso y sobre HTTPS (producción lo es).
const locLabel = $("#locLabel"),
  locBtn = $("#locBtn"),
  locReset = $("#locReset");
function paintLoc() {
  const l = getLoc();
  const propia = l !== JAEN_LOC; // getLoc devuelve JAEN_LOC (la constante) si no hay wp_loc válido
  locLabel.textContent = propia
    ? `Ubicación: ${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}`
    : "Ubicación: Jaén";
  locReset.hidden = !propia;
}
paintLoc();
// los km del CSV cargado son de la ubicación vieja: re-scrapea para recalcularlos
const relanzaPorLoc = () => {
  if (!curCsv) return;
  const { kw, since } = queryParts(curCsv);
  relaunch(kw, since);
};
locBtn.onclick = () => {
  if (!navigator.geolocation) return snack("Este navegador no da la ubicación.");
  locBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      locBtn.disabled = false;
      setLS("wp_loc", JSON.stringify({ lat: p.coords.latitude, lon: p.coords.longitude }));
      paintLoc();
      relanzaPorLoc();
    },
    (e) => {
      locBtn.disabled = false;
      snack("No se pudo leer tu ubicación: " + ((e && e.message) || "permiso denegado"));
    },
    { timeout: 10000, maximumAge: 600000 },
  );
};
locReset.onclick = () => {
  localStorage.removeItem("wp_loc");
  paintLoc();
  relanzaPorLoc();
};

// ── copia de seguridad del estado ──
// No hay cuentas ni backend: meses de triaje viven solo en el almacén de este navegador, y Safari
// en iOS lo limpia tras unos días sin visitas. Se copian TODAS las claves wp_*, no una lista
// escrita a mano, para que una clave nueva entre sola en la copia. Los CSVs no entran porque no
// están aquí: viven en IndexedDB, y una copia son solo claves de localStorage.
// OJO: por eso una restauración deja el cache de IndexedDB del ocupante ANTERIOR bajo los nombres
// de cajón que acaban de entrar. Eso es lo que marca cacheAjenaKey, y por eso esa marca se salta
// la copia: tiene que quedarse en el navegador de destino. No la quites de esta lista.
const BACKUP_SKIP = ["wp_rows", "wp_csv", cacheAjenaKey]; // caches del modelo viejo + marca local
const backupKeys = () => {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("wp_") && !BACKUP_SKIP.includes(k)) out.push(k);
  }
  return out;
};
// `filas` = el cache de filas de IndexedDB. En localStorage solo hay ids: sin las filas, un
// favorito que Wallapop ya retiró se restaura sin título, sin precio y sin foto, y `bucketRows`
// lo tira por el borde. `rowCache` ya viene podado a los ids clasificados, así que no engorda.
const backupJSON = () =>
  JSON.stringify({
    app: "rebusca",
    v: 1,
    fecha: new Date().toISOString(),
    datos: Object.fromEntries(backupKeys().map((k) => [k, localStorage.getItem(k)])),
    // Con la LECTURA rota `rowCache` está vacío por el fallo, no porque no haya filas. Llevárselo
    // como `filas: {}` hace que restaurar esta copia en un móvil sano borre las filas buenas,
    // porque `{}` es truthy. Una copia SIN el campo es un formato que el importador ya acepta —
    // las copias viejas tampoco lo traen — y el triaje se sigue guardando entero.
    // Un fallo al ESCRIBIR no mira aquí: la memoria está entera, y es justo lo que hay que salvar.
    ...(lecturaRota ? {} : { filas: rowCache }),
  });
$("#exportState").onclick = () => {
  const url = URL.createObjectURL(new Blob([backupJSON()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "rebusca-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(url);
  snack(lecturaRota ? "Copia guardada, pero sin las fichas de los anuncios: este navegador no las lee" : "Copia guardada", null);
};
$("#importBtn").onclick = () => $("#importState").click();
$("#importState").onchange = (e) => {
  const f = (e.target.files || [])[0];
  if (!f) return;
  f.text()
    .then(async (t) => {
      const copia = JSON.parse(t) || {};
      const datos = copia.datos;
      if (!datos || typeof datos !== "object")
        throw Object.assign(new Error("no es una copia de Rebusca"), { culpaDelFichero: true });
      // Escribe antes de borrar. Al revés, una cuota reventada a media escritura dejaba al
      // usuario sin nada: el borrado ya había pasado y el `setItem` es crudo, sin `setLS`.
      // Así lo viejo sobrevive al fallo. Solo claves `wp_`: una copia manipulada no escribe
      // en el almacén de nadie más. Las sobrantes se borran después, con la lista ya leída.
      const nuevas = Object.keys(datos).filter((k) => k.startsWith("wp_"));
      // El bucle no es atómico: si la cuota revienta en la tercera clave, las dos primeras ya
      // están escritas y el aviso de abajo miente. Peor: `hydrateEstado` da precedencia por
      // campo a la clave espejo sobre el blob, así que un `wp_favorite` a medias manda sobre
      // los favoritos buenos que `wp_estado` conserva. Se deshace lo escrito y el aviso vuelve
      // a ser verdad. La vuelta atrás vacía antes de reponer: reponer sin más puede reventar
      // también, porque una clave que encogió se repone con otra que creció ya escrita, y el
      // pico se sale de la cuota. Vaciando primero, el pico nunca pasa de lo que ya cabía.
      // La foto cubre TODO lo que se toca, no solo lo que se escribe: el borrado de las
      // sobrantes y las filas de IndexedDB también se deshacen. `rowCache` ya es lo que hay
      // guardado, así que las filas se reponen de memoria sin volver a leer el almacén.
      const viejas = backupKeys();
      const tocadas = [...new Set([...nuevas, ...viejas])];
      const previo = new Map(tocadas.map((k) => [k, localStorage.getItem(k)]));
      try {
        for (const k of nuevas) localStorage.setItem(k, datos[k]);
        for (const k of viejas) if (!nuevas.includes(k)) localStorage.removeItem(k);
        // Se espera a IndexedDB: `location.reload()` mata la transacción a medias y el favorito
        // restaurado se quedaría sin fila. El wrapper no relanza — cerrar un rechazo suelto es lo
        // correcto para el triaje, que escribe fire-and-forget — así que un commit abortado se ve
        // por el booleano. Recargar sin mirarlo es dar por buena una restauración a medias.
        // `Object.keys` y no `if (copia.filas)`: una copia de una sesión sin clasificar trae
        // `filas: {}`, que es truthy, y escribirla borra las fichas del móvil de destino.
        if (Object.keys(copia.filas || {}).length && !(await idb.set("rows", copia.filas)))
          throw new Error("el almacén de filas de este navegador no responde");
        // El cache de anuncios es del ocupante anterior: abrir una búsqueda restaurada pintaría
        // sus precios y sus fotos en vez de scrapear. Se tira, pero NO aquí: la marca la recoge
        // el arranque de después de la recarga (`hydrateStores`), que vacía `csvIndex` en memoria
        // aunque el almacén no acepte la escritura, y se queda con la marca puesta hasta que la
        // acepte. Tirarlo aquí obligaba a lanzar cuando el almacén no escribía, y ese `throw`
        // deshacía TODA la restauración: los favoritos, los rechazados, las búsquedas, los alias
        // y las exclusiones viven en localStorage y se restauran perfectamente sin IndexedDB.
        localStorage.setItem(cacheAjenaKey, "1");
      } catch (err) {
        // Las filas sí pueden haberse escrito, y no se reponen: `rowCache` en memoria sigue siendo
        // el bueno, así que la primera clasificación lo vuelca encima. Lo que se deshace es
        // localStorage, que es lo que decide qué es un favorito.
        for (const k of tocadas) localStorage.removeItem(k);
        for (const [k, v] of previo) if (v !== null) localStorage.setItem(k, v);
        throw err;
      }
      location.reload(); // el estado vive en variables ya leídas: recargar es lo único honesto
    })
    .catch((err) =>
      snack(
        // Solo el fichero mal formado es culpa del fichero. Todo lo demás que puede fallar aquí
        // (la cuota, un commit abortado de IndexedDB, un error de disco) es de este navegador, y
        // decirle al usuario que su copia no vale hace que tire la única que tiene.
        // `err.name` y no `instanceof`: el `JSON` del arnés viene de otro realm, así que el
        // `SyntaxError` de `JSON.parse` no es el SyntaxError de aquí. El nombre sí cruza.
        err.culpaDelFichero || err.name === "SyntaxError"
          ? "Copia no válida: " + (err.message || err)
          : err.name === "QuotaExceededError"
            ? "La copia no cabe en este navegador: no se ha restaurado nada, tu triaje sigue intacto"
            : "Este navegador no pudo guardar la copia: no se ha restaurado nada, tu triaje sigue intacto",
        null,
      ),
    );
};
// deep-link: ?q=<búsqueda>&since=<hora|dia|semana|mes>&excl=palabra,otra&title=1
//            &maxp=<€>&maxd=<días>&keep=<ids>&fav=<ids>&no=<ids>
// deja que una IA (o un enlace guardado) abra Rebusca con una búsqueda ya montada:
// booleana (OR/grupos/comillas van tal cual en q) + exclusiones. Devuelve true si disparó.
// ?keep=<ids> es el VEREDICTO de la IA sobre el último lote copiado (wp_aisent): esos ids quedan
// como favoritos y el RESTO del lote se rechaza de una vez. ?fav=/?no= reparten ids sueltos en los
// cubos (alias legado de ?keep: solo ascienden, no rechazan el resto del lote). Los ids llegan
// recortados como en las fichas (ver shortIds); el id entero también vale.
const TRIAGE = [["no", "rejected"], ["fav", "favorite"]]; // orden = prioridad ascendente
// Las fichas que se le pegan a la IA llevan el id de Wallapop RECORTADO a su cola: el id entero
// son 12 caracteres opacos (~6 tokens) por ficha. Sigue siendo el id, no una posición: un enlace
// viejo no se puede resolver contra otro lote.
// La cola no es aleatoria y 3 caracteres NO bastan: medido sobre 472 ids reales, la cola de 3
// solo da 131 valores distintos (la penúltima letra sale 6, z o j y poco más). Por eso esto
// empieza en 3 y crece hasta que los del lote son únicos: en un lote de 50 sale 4 el 67 % de las
// veces y 5 el 30 %. La CABEZA es mucho peor (472 ids dan 24 cabezas de 3): no la uses.
const shortIds = (ids) => {
  for (let n = 3; n < 12; n++) {
    const c = ids.map((id) => id.slice(-n));
    if (new Set(c).size === c.length) return c;
  }
  return ids;
};
// del recorte al id entero: el único del lote (o del cache) que acaba así. Un id entero acaba en
// sí mismo, así que los enlaces viejos y los ?fav=/?no= escritos a mano siguen valiendo. Si no
// casa nada, o casan dos, pasa tal cual: mejor un id ignorado y dicho que una criba en el vecino.
function fullId(t, lote) {
  if (!t || rowCache[t]) return t;
  const cola = t.toLowerCase();
  for (const pool of [(lote && lote.ids) || [], Object.keys(rowCache)]) {
    const m = pool.filter((id) => id.toLowerCase().endsWith(cola));
    if (m.length) return m.length === 1 ? m[0] : t;
  }
  return t;
}
console.assert(
  (() => {
    const lote = { ids: ["m9zw5jkvxdpv", "k3pq7x0zab3"] };
    return (
      shortIds(["m9zw5jkvxdpv", "k3pq7x0zab3", "x7abzz9wq0f"]).join() === "dpv,ab3,q0f" &&
      shortIds(["aaa111", "bbb111"]).join() === "a111,b111" && // colas repetidas: crecen todas
      fullId("dpv", lote) === "m9zw5jkvxdpv" &&
      fullId("DPV", lote) === "m9zw5jkvxdpv" && // la IA a veces cambia la caja
      fullId("m9zw5jkvxdpv", { ids: [] }) === "m9zw5jkvxdpv" && // id entero: intacto
      fullId("111", { ids: ["aaa111", "bbb111"] }) === "111" && // ambiguo: no se resuelve
      fullId("zzz", null) === "zzz" // sin lote y sin cache: tal cual
    );
  })(),
  "shortIds/fullId roto",
);
const BUCKET_LABEL = { rejected: "rechazados", favorite: "favoritos" };
// "3 a favoritos y 40 a rechazados" — resumen de lo que aplicó el enlace de la IA
const triageMsg = (picks) => {
  const parts = [...picks].reverse().map(([b, ids]) => `${ids.length} a ${BUCKET_LABEL[b]}`);
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " y " + parts.at(-1) : parts[0];
};
console.assert(
  triageMsg([["rejected", ["a"]], ["favorite", ["b", "c"]]]) === "2 a favoritos y 1 a rechazados" &&
    triageMsg([["favorite", ["b"]]]) === "1 a favoritos",
  "triageMsg roto",
);
function fromURL() {
  const p = new URLSearchParams(location.search);
  const lote = aisent(); // hace falta ANTES de leer los ids: resuelve los recortes de las fichas
  const idsOf = (k) =>
    [...new Set((p.get(k) || "").split(",").map((s) => fullId(s.trim().replace(/^#/, ""), lote)).filter(Boolean))];
  const isKeep = p.has("keep");
  const keepIds = uni(idsOf("keep"), idsOf("fav")); // ambos ascienden a favoritos; solo ?keep juzga el lote
  const picks = [["rejected", idsOf("no")], ["favorite", keepIds]].filter(([, ids]) => ids.length);
  const nPicks = picks.reduce((n, [, ids]) => n + ids.length, 0);
  const q = (p.get("q") || "").trim();
  // hasOwn y no `in`: la URL es entrada de usuario y `"constructor" in SINCE_LABEL` es true
  const since = Object.hasOwn(SINCE_LABEL, p.get("since") ?? "") ? p.get("since") : "";
  let sentCsv = "", outN = 0, orphanN = 0;
  const touched = new Set(); // cajones donde ha caído algo: el enlace puede repartir en varios
  const landed = { rejected: [], favorite: [] }; // lo que se clasificó DE VERDAD, para el mensaje
  if (nPicks || isKeep) {
    const sent = isKeep ? lote : null; // ?keep = veredicto sobre el último lote enviado
    sentCsv = sent?.csv || ""; // se resuelve ANTES del bucle: es el mejor origen para un id del lote
    // cubos POR CAJÓN: cada id va al cajón de ?q= o, sin q, al de ORIGEN del propio anuncio
    // (rowCache._csv). OJO: al boot `curCsv` aún es null (fromURL corre ANTES de restoreLastCsv),
    // así que meterlos en el activo los tiraba a un cajón fantasma invisible.
    for (const [bucket, ids] of picks)
      for (const id of ids) {
        const dest = q ? csvNameOf(q, since)
          : rowCache[id]?._csv || (isKeep && sentCsv) || curCsv || localStorage.getItem(lastCsvKey()) || "";
        if (!dest) { orphanN++; continue; } // sin cajón conocido: no se archiva bajo "" y se dice
        touched.add(dest);
        pointBuckets(dest);
        const sets = { rejected, favorite };
        for (const n of BUCKET_NAMES) sets[n].delete(id); // cubos exclusivos: sale del otro
        sets[bucket].add(id);
        landed[bucket].push(id);
        stampNow(id);
      }
    if (sent) {
      const keep = new Set(keepIds);
      pointBuckets(sentCsv);
      for (const id of sent.ids)
        if (!keep.has(id)) { favorite.delete(id); rejected.add(id); stampNow(id); outN++; }
      if (outN) touched.add(sentCsv);
      localStorage.removeItem("wp_aisent"); // veredicto consumido: el lote queda resuelto
    }
    saveBuckets();
  }
  // "3 a favoritos y 40 a rechazados · 12 más del lote a rechazados · repartido en 2 búsquedas"
  // Cuenta lo que aterrizó, no lo que pedía el enlace: si no, un id ignorado salía a la vez
  // como clasificado y como ignorado en el mismo mensaje.
  const landedPicks = TRIAGE.map(([, b]) => [b, landed[b]]).filter(([, ids]) => ids.length);
  const msg = () => [landedPicks.length && triageMsg(landedPicks), outN && `${outN} más del lote a rechazados`,
    touched.size > 1 && `repartido en ${touched.size} búsquedas`,
    orphanN && `${orphanN} sin búsqueda conocida (ignorados)`].filter(Boolean).join(" · ");
  if (!q) {
    if (nPicks || isKeep) {
      const dest = [...touched].at(-1) || sentCsv || curCsv || ""; // cajón que se abre al terminar
      history.replaceState(null, "", location.pathname); // enlace de un solo uso
      // muestra el cubo más alto que haya tocado: se pinta desde el cache, sin re-scrapear
      view = picks.length && picks.at(-1)[0] !== "rejected" ? picks.at(-1)[0] : "";
      if (dest) {
        selectQueryUI(dest); // fija curCsv al cajón: sin esto la vista sale vacía
        // ...pero selectQueryUI NO carga filas: `loadedCsv` seguía null y la vista salía con la
        // bienvenida, obligando a volver atrás y re-seleccionar la búsqueda a mano para ver el
        // veredicto. Con cache se pinta aquí (sin red); loadCSV resetea `view`, de ahí el re-render.
        if (csvIndex[dest]) { const v = view; loadQuery(dest).then(() => { view = v; render(); }); }
      }
      render();
      snack(msg() || "Nada que aplicar: el lote ya estaba resuelto", null);
      return true; // ya hay algo en pantalla; no dispares restoreLastCsv()
    }
    return false; // sin criba ni q: deja que restoreLastCsv() cargue la última vista
  }
  const words = [...new Set((p.get("excl") || "").split(",").map(norm).filter(Boolean))];
  // fusiona, no sustituye: el deep-link añadía sus palabras BORRANDO las que el usuario había
  // vetado a mano en ese cajón. Mismo patrón que limMap 9 líneas más abajo.
  if (words.length) { const d = drawerOf(csvNameOf(q, since)); exclMap[d] = uni(exclMap[d] || [], words); saveExcl(); } // se aplican al renderizar
  // ?maxp=/&maxd= (precio/antigüedad máximos) = los topes del cajón: se aplican al renderizar,
  // igual que si los hubieras tecleado en el menú ⚙ (y quedan guardados para la próxima).
  // `NaN > 0` es false, así que un ?maxp=barato se descartaba sin decir nada y el usuario veía
  // resultados por encima de su tope creyendo que el enlace lo aplicaba.
  const lim = {}, malos = [];
  for (const [k, c] of [["maxp", "precio"], ["maxd", "dias"]]) {
    const crudo = p.get(k);
    if (crudo == null) continue;
    const v = parseFloat(crudo);
    if (v > 0) lim[c] = v;
    else malos.push(`${k}=${crudo}`);
  }
  if (malos.length) setTimeout(() => snack(`Tope del enlace ignorado: ${malos.join(", ")}`, null), 0);
  if (Object.keys(lim).length) {
    Object.assign((limMap[drawerOf(csvNameOf(q, since))] ||= {}), lim);
    saveLimits();
  }
  $("#kw").value = q;
  $("#since").value = since;
  $("#titleOnly").checked = p.get("title") === "1";
  history.replaceState(null, "", location.pathname); // enlace de un solo uso: refrescar no re-dispara
  $("#scrape").click();
  if (nPicks || outN) snack(msg(), null); // con ?q= la criba se aplica igual, pero se re-scrapea
  return true;
}

// arranque: sin perfiles, un usuario por navegador. Hidrata estado y restaura la última búsqueda.
// queueMicrotask difiere el boot a tras evaluar el módulo -> render() no toca consts en TDZ (p.ej. `col`).
// El boot era una promesa sin catch: cualquier fallo dentro moría en un unhandledrejection y
// la app se quedaba a medio arrancar, en blanco y sin una línea en consola. Ahora el fallo se
// ve, y se intenta render() igual: llegar a los favoritos importa más que arrancar entero.
queueMicrotask(async () => {
  try {
    await hydrateStores(); // CSVs y cache de filas desde IndexedDB (y migra los que quedaran en localStorage)
    hydrateEstado();
    render();
    if (!fromURL()) restoreLastCsv(); // ?q=… dispara su búsqueda; si no, la última vista
  } catch (e) {
    console.error("Rebusca: el arranque falló", e);
    snack("El arranque falló: " + (e.message || e), null);
    try { render(); } catch (e2) { console.error("Rebusca: render() tampoco arrancó", e2); }
  }
});

// Dos pestañas de la app abiertas a la vez: el navegador manda `storage` a las OTRAS pestañas
// (nunca a la que escribe, así que no hay bucle). hydrateEstado() ya es repetible y repinta al
// final, así que re-hidratar es todo lo que hace falta. Sin esto, la pestaña vieja seguía con su
// copia en memoria y el siguiente pushEstado() borraba lo que la otra acababa de clasificar.
// `e.key` es null cuando alguien llama a localStorage.clear().
// Las fichas no viven en localStorage, así que no llegan en el evento: hay que ir a por ellas.
// Sin esto, la otra pestaña clasifica un anuncio que esta no tiene cargado, esta se queda con su
// `rowCache` de antes y el siguiente saveRows() lo escribe encima — `put` reemplaza el registro
// entero, no fusiona — y ese favorito se queda sin ficha para siempre. Lo de esta pestaña manda
// sobre lo del almacén: es más nuevo. Los cubos ya vienen re-hidratados, así que la poda de
// saveRows() respeta lo fusionado.
window.addEventListener("storage", (e) => {
  if (e.key != null && !e.key.startsWith("wp_")) return;
  hydrateEstado();
  // El `.catch` no es decorativo: `get` sí relanza — a diferencia de `set`/`del`, que se tragan el
  // rechazo a propósito para el triaje —, y un rechazo suelto aquí llega al `unhandledrejection` de
  // arriba, que pinta «Fallo interno» encima del aviso honesto y esconde el botón «Deshacer».
  // La fusión es oportunista: si el almacén no lee, esta pestaña se queda con lo suyo. Aquí había
  // además un guardián `if (!lecturaRota)`, y se fue: con el `.catch` puesto, quitarlo no cambia
  // nada que el usuario vea, y lo que ningún mutante mata no es código, es adorno.
  idb.get("rows").then((filas) => { if (filas) rowCache = { ...filas, ...rowCache }; }, () => {});
});

// ── modo swipe (tinder): una tarjeta a la vez; arrastra ← rechazar / → favorito ──
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

// ── galería de fotos: tocar la portada de una tarjeta abre TODAS las del anuncio ──
// El carrusel es un scroller con scroll-snap (app.css): el swipe lo hace el navegador.
// ponytail: cero JS de arrastre, cero librería; solo pintar los <img> y contar en qué va.
const galView = $("#galView"),
  galTrack = $("#galTrack"),
  galCount = $("#galCount");
let galUnder = null, // capa de debajo a la que devolver el `inert` (mazo/gestor), si la hay
  galReturn = null; // elemento al que devolver el foco al cerrar
function openGal(urls, i = 0) {
  // ya abierta: en el mazo el mismo toque llega dos veces (pointerup + click), y re-pintar
  // aquí recargaría las fotos y perdería la posición del carrusel
  if (!urls.length || !galView.hidden) return;
  galTrack.replaceChildren();
  for (const u of urls) {
    const im = document.createElement("img");
    im.src = u;
    im.alt = "";
    im.decoding = "async";
    galTrack.append(im);
  }
  galView.hidden = false;
  galReturn = document.activeElement;
  galUnder = !swipeView.hidden ? swipeView : !searchesView.hidden ? searchesView : null;
  if (galUnder) galUnder.inert = true; // el fondo ya lo sacó del tab quien abrió esa capa
  else enterOverlay();
  document.body.style.overflow = "hidden";
  galTrack.scrollLeft = i * galTrack.clientWidth;
  galSlide();
  $("#galX").focus();
  reconcileBack();
}
function closeGal() {
  galView.hidden = true;
  galTrack.replaceChildren(); // suelta las fotos a tamaño completo
  galCount.textContent = "";
  if (galUnder) galUnder.inert = false;
  else {
    exitOverlay();
    document.body.style.overflow = ""; // con el mazo detrás lo restaura `closeSwipe`
  }
  galUnder = null;
  galZoomReset();
  galReturn?.focus?.();
  galReturn = null;
}
// contador "3 / 7": la posición la manda el scroll, que es quien lleva el carrusel
function galSlide() {
  const n = galTrack.children.length;
  galCount.textContent =
    n > 1 ? `${Math.round(galTrack.scrollLeft / (galTrack.clientWidth || 1)) + 1} / ${n}` : "";
}
galTrack.onscroll = galSlide;
$("#galX").onclick = closeGal;

// ── pinch: dos dedos acercan la foto de en medio; con zoom, un dedo la arrastra ──
// El carrusel sigue siendo scroll nativo: mientras se hace pinch (o queda zoom) se bloquea con
// `overflow-x: hidden`. Cambiarlo a media caricia SÍ frena el scroll que el navegador ya había
// empezado, que es lo único que se puede hacer cuando el gesto está en marcha.
const galPts = new Map(); // dedos vivos sobre el carrusel, por pointerId
let galZ = 1, // zoom de la foto actual
  galX = 0, // ...y su desplazamiento, en px de pantalla
  galY = 0,
  galD0 = 0, // separación de los dedos al empezar el pinch
  galPX = 0, // último punto del dedo que arrastra
  galPY = 0,
  galTapT = 0, // instante y sitio del toque anterior, para cazar el doble toque
  galTapX = 0,
  galTapY = 0,
  galDX = 0, // dónde y cuándo bajó el dedo: un toque es bajar y subir en el mismo sitio
  galDY = 0,
  galDT = 0;
const galImg = () => galTrack.children[Math.round(galTrack.scrollLeft / (galTrack.clientWidth || 1))];
const galSpread = () => {
  const [a, b] = [...galPts.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
function galApply() {
  // tope del arrastre: la mitad de lo que sobresale. Se mide sobre el hueco entero y no sobre la
  // foto (que con `contain` deja bandas), así que en una foto apaisada sobra algo de margen.
  // ponytail: medir la caja real pide `getBoundingClientRect` por frame para ganar poco.
  const lim = (v, max) => Math.min(max, Math.max(-max, v)); // con zoom 1 el tope es 0: se recentra sola
  galX = lim(galX, ((galZ - 1) * galTrack.clientWidth) / 2);
  galY = lim(galY, ((galZ - 1) * galTrack.clientHeight) / 2);
  const im = galImg();
  if (im) im.style.transform = galZ === 1 ? "" : `translate(${galX}px, ${galY}px) scale(${galZ})`;
  galTrack.style.overflowX = galZ === 1 && galPts.size < 2 ? "" : "hidden";
}
function galZoomReset() {
  galPts.clear();
  galZ = 1;
  galX = galY = 0;
  galApply();
}
// escala a `z2` dejando quieto el punto que hay entre los dedos (si no, la foto se escapa del
// dedo en cuanto te acercas a una esquina). Coordenadas relativas al centro del hueco, que es
// el origen del `transform`; el carrusel ocupa la pantalla entera, así que clientX ya vale.
function galPinch(z2, mx, my) {
  const sx = mx - galTrack.clientWidth / 2,
    sy = my - galTrack.clientHeight / 2;
  const zn = Math.min(6, Math.max(1, z2));
  galX = sx - (zn / galZ) * (sx - galX);
  galY = sy - (zn / galZ) * (sy - galY);
  galZ = zn;
  galApply();
}
galTrack.onpointerdown = (e) => {
  if (e.pointerType === "mouse") return; // el pinch es de dedos; con ratón manda el scroll de siempre
  galPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  galPX = galDX = e.clientX;
  galPY = galDY = e.clientY;
  galDT = e.timeStamp;
  if (galPts.size === 2) galD0 = galSpread();
  galApply(); // dos dedos abajo: corta ya el scroll del carrusel
};
galTrack.onpointermove = (e) => {
  if (!galPts.has(e.pointerId)) return;
  galPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const dedos = [...galPts.values()];
  if (dedos.length >= 2) {
    e.preventDefault();
    galPinch((galZ * galSpread()) / (galD0 || 1), (dedos[0].x + dedos[1].x) / 2, (dedos[0].y + dedos[1].y) / 2);
    galD0 = galSpread(); // relativo al frame anterior: así el zoom no salta si un dedo se levanta y vuelve
  } else if (galZ > 1) {
    e.preventDefault(); // con zoom no hay carrusel que pasar: el dedo arrastra la foto
    galX += e.clientX - galPX;
    galY += e.clientY - galPY;
    galPX = e.clientX;
    galPY = e.clientY;
    galApply();
  }
};
galTrack.onpointerup = galTrack.onpointercancel = (e) => {
  if (!galPts.delete(e.pointerId)) return;
  const queda = [...galPts.values()][0];
  if (queda) {
    galPX = queda.x; // se levanta un dedo: el que sigue arrastra desde donde está, sin salto
    galPY = queda.y;
  }
  galApply(); // sin zoom y sin dedos, devuelve el carrusel al navegador
  if (e.type === "pointerup" && !galPts.size) galDobleTap(e);
};
// doble toque: acerca a ×2.5 en el punto tocado, y otro doble toque devuelve al tamaño normal.
// Es lo que hace todo el mundo (Fotos, Instagram) y no pisa al pinch: un pinch mueve el dedo.
function galDobleTap(e) {
  const cerca = (ax, ay, bx, by, r) => Math.hypot(ax - bx, ay - by) < r;
  // un toque es rápido y quieto; si el dedo se fue de paseo, era swipe o arrastre de la foto
  if (e.timeStamp - galDT > 400 || !cerca(e.clientX, e.clientY, galDX, galDY, 10)) return;
  const doble = e.timeStamp - galTapT < 300 && cerca(e.clientX, e.clientY, galTapX, galTapY, 40);
  galTapT = doble ? 0 : e.timeStamp; // consumido: tres toques seguidos no encadenan dos zooms
  galTapX = e.clientX;
  galTapY = e.clientY;
  if (!doble) return;
  const im = galImg();
  if (im) {
    im.style.transition = "transform .18s ease"; // solo aquí: en el pinch el dedo iría por delante
    setTimeout(() => (im.style.transition = ""), 200);
  }
  if (galZ > 1) galZoomReset();
  else galPinch(2.5, e.clientX, e.clientY);
}
// teclado de la galería. Lo llama el `keydown` del mazo, que es UN listener para las dos capas:
// dos listeners sueltos se ejecutan los dos (`stopPropagation` no frena a los hermanos del
// mismo nodo), así que un Escape cerraba la galería Y el mazo de debajo de una sola tecla.
function galKey(e) {
  if (e.key === "Escape") return closeGal();
  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!d) return; // sin dedo no hay swipe: las flechas pasan de foto
  e.preventDefault();
  galTrack.scrollBy({ left: d * galTrack.clientWidth, behavior: "smooth" });
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
  $("#swYes").disabled = $("#swNo").disabled = done; // sin esto seguían encendidos y no hacían nada
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
// ¿el gesto en curso fue arrastre? Lo lee la foto de la tarjeta para no abrir la galería
// cuando el dedo venía de un swipe que no cuajó y volvió al centro.
let swDragged = false;
// se arma UNA vez sobre toda la vista: arrastra desde cualquier hueco, mueve la tarjeta actual
function dragify(root) {
  let sx = 0,
    sy = 0,
    dx = 0,
    dy = 0,
    on = false,
    axis = 0,
    t0 = 0,
    downEl = null; // dónde empezó el dedo: con captura de puntero el `up` ya no lo dice
  root.onpointerdown = (e) => {
    if (!card || e.target.closest("a,button,input,.seller-banner")) return; // sin tarjeta o sobre botón/input/banner: nada
    on = true;
    dx = dy = axis = 0;
    swDragged = false;
    downEl = e.target;
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
      swDragged = true; // hubo arrastre: el click que venga detrás no es un toque
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
    // toque limpio sobre la foto: abre la galería. Se resuelve aquí y no en el `onclick` de la
    // media porque con captura de puntero el navegador manda el click a la vista, no a la imagen.
    if (!swDragged && e.type === "pointerup") downEl?.closest?.(".li-media")?.onclick?.();
    setTimeout(() => (swDragged = false)); // el click llega antes que este timeout: la guarda aguanta
    if (axis === "x" && card) {
      card.classList.remove("grab");
      // `pointercancel` NO es soltar: el sistema se llevó el dedo (entra una llamada, el
      // navegador se queda el gesto, salta un gesto del móvil). Decidir ahí es clasificar sin
      // que el usuario suelte, y con la regla del flick basta un movimiento corto y rápido.
      // En el mazo cada anuncio pasa una sola vez, así que un rechazo así lo esconde.
      const d = e.type === "pointercancel" ? 0 : decide(dx, dx / Math.max(1, e.timeStamp - t0)); // v en px/ms
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
    wasFavorite: favorite.has(k),
    wasRejected: rejected.has(k),
    wasStamp: stamp[k],
  }); // estado previo para deshacer
  if (dir > 0) {
    favorite.add(k);
    rejected.delete(k);
    likeStamp.style.opacity = 1;
  } else {
    rejected.add(k);
    favorite.delete(k);
    nopeStamp.style.opacity = 1;
  } // clasifica en un cubo exclusivo; sello a tope
  stampNow(k);
  saveBuckets();
  card.style.transition = "transform .25s ease, opacity .25s ease";
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 20}deg)`;
  card.style.opacity = 0;
  card = null; // bloquea doble-decisión mientras vuela
  $("#swYes").disabled = $("#swNo").disabled = true; // ...y se VE bloqueada: sin esto el toque se tragaba en silencio
  // El mazo se puede reconstruir durante el vuelo (un chip de palabra vetada, un tope nuevo).
  // `rebuildDeck()` reasigna `deck` entero y pone `di = 0`, así que este `di++` avanzaría sobre
  // un mazo que ya no es el suyo y se saltaría la primera tarjeta del nuevo.
  const deckAtFling = deck;
  setTimeout(() => {
    if (deck !== deckAtFling) return;
    di++;
    nextCard();
  }, 200);
}
// deshacer el último swipe: restaura el cubo/sello previo del item y vuelve a mostrar su tarjeta
function swUndo() {
  const h = undoStack.pop();
  if (!h) return;
  if (h.wasFavorite) favorite.add(h.k);
  else favorite.delete(h.k);
  if (h.wasRejected) rejected.add(h.k);
  else rejected.delete(h.k);
  if (h.wasStamp === undefined) unstamp(h.k);
  else {
    stamp[h.k] = h.wasStamp;
    setLS("wp_stamp", JSON.stringify(stamp));
  }
  saveBuckets();
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
// precio a copiar/mostrar: final estimado al comprador si lleva envío, si no el del anuncio.
// Siempre "aprox": el porte sale del tramo estimado de 5 kg, no del peso real del anuncio.
function priceLabel(r) {
  const precio = col(r, "precio");
  if (col(r, "envio") === "True" && isNum(precio)) return eur(finalPrice(+precio)) + " (con envío, aprox)";
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
  "El «precio para mí» estima lo que acabaría pagando (artículo + envío + comisión de Wallapop); " +
  "el «precio anunciado» es lo que pide el vendedor. ";
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

// Reglas del enlace de vuelta: lo único que la IA hace mal por defecto (ids inventados, cubos a
// medias, enlace olvidado). Van inline en los dos prompts porque llms.txt puede no leerse.
const LINK_RULES = (n) =>
  "EMPIEZA la respuesta, antes de cualquier análisis, con esta línea y nada más:\n\n" +
  "**[Aplicar tu criba en Rebusca](https://rebusca.dibogomez.com/?keep=<ids que conservarías>)** " +
  "— más una frase de qué hace al pulsarlo.\n\n" +
  "Los ids son los [#...] de las fichas de abajo, copiados literales, separados por comas, sin espacios y " +
  `sin la almohadilla. Ninguno que no esté abajo y ninguno inventado. Al abrirlo esos anuncios pasan a ` +
  `favoritos y el resto de los ${n} se descarta, así que incluye solo los que de verdad recomendarías ` +
  "comprar. A ese enlace no le añadas ?q=.\n\n" +
  "Cada anuncio que nombres va como enlace markdown pulsable a su URL, con título y precio dentro del texto: " +
  "[Roomba 981 — 195€ (215€ para mí)](https://es.wallapop.com/item/...). Nunca una URL suelta, nunca un id " +
  "en la prosa, nunca un enlace dentro de un bloque de código: estoy en el móvil y ahí no se puede pulsar.";
console.assert(
  LINK_RULES(7).includes("?keep=<ids que conservarías>") && LINK_RULES(7).includes("resto de los 7"),
  "LINK_RULES roto",
);
// instrucción de cabecera para la IA (la misma para el texto de "copiar" y para el PDF dossier)
// `total` > n avisa de que solo va un tope del mazo (UNSEEN_CAP), no todo.
// La búsqueda EXACTA que estoy viendo, como URL. Sin ella la IA solo sabía la `q` y la frescura:
// para afinar tenía que adivinar el resto del filtro, y su enlace nuevo llegaba sin las palabras
// que yo ya había excluido. Las categorías vetadas no caben en la URL y van aparte, en texto.
function queryURL() {
  const { kw, since } = queryParts(loadedCsv || "");
  if (!kw) return "";
  const p = new URLSearchParams({ q: kw });
  if (since) p.set("since", since);
  if ($("#titleOnly").checked) p.set("title", "1");
  const ex = exclTerms();
  if (ex.length) p.set("excl", ex.join(","));
  const lim = limits();
  if (lim.precio) p.set("maxp", lim.precio);
  if (lim.dias) p.set("maxd", lim.dias);
  return location.origin + location.pathname + "?" + p;
}
// Segunda vuelta del bucle: la criba de arriba arregla ESTE lote, esto arregla la BÚSQUEDA. El
// ruido que la IA acaba de descartar es justo la prueba de qué sobra en la query.
const REFINE_RULES = (url, cats) =>
  "\n\nAl final del todo, mira el ruido en conjunto: si lo que sobra se repite por un motivo (otra familia " +
  "de productos, accesorios, recambios), la búsqueda está mal y quiero arreglarla, no volver a cribarla a mano.\n\n" +
  `Búsqueda que ha traído estos anuncios: ${url}\n` +
  (cats.length ? `Categorías vetadas en la app: ${cats.join(", ")}.\n` : "") +
  "Devuélvemela corregida como segundo enlace markdown pulsable, **[Afinar la búsqueda](...)**, misma dirección " +
  "y mismos parámetros, cambiando lo que haga falta: `q` si faltan modelos o sinónimos, `title=1` si la palabra " +
  "ensucia en las descripciones, `maxp`/`maxd` si procede, y `excl` con la lista COMPLETA (repite las palabras " +
  "que ya lleva y añade las nuevas: al cambiar la `q` es otra búsqueda y no hereda nada). Una línea de qué has " +
  "quitado y por qué. Si ya está limpia y el ruido es cosa suelta, dímelo en una línea y no me des enlace.";
console.assert(
  REFINE_RULES("https://r/?q=a&excl=roto", []).includes("https://r/?q=a&excl=roto") &&
    !REFINE_RULES("https://r/?q=a", []).includes("categorías") &&
    REFINE_RULES("https://r/?q=a", ["Coches", "Motos"]).includes("Coches, Motos"),
  "REFINE_RULES roto",
);
// Regateo con cifra en vez de "intenta negociar". Va inline en los dos prompts (llms.txt puede
// no leerse) porque sin la escala la IA suelta rangos que suben por encima del tope del comprador.
// Los porcentajes salen de GUIA-REGATEO.md (óptimo empírico ~80 % del pedido; <70 % rompe la venta).
const HAGGLE_RULES =
  "\n\nEl regateo, con cifra. La oferta se hace sobre el PRECIO ANUNCIADO (Wallapop suma comisión y envío " +
  "aparte), pero el ahorro razónalo sobre el «precio para mí».\n" +
  "- Si ya está por debajo de mercado NO se regatea: que lo compre o lo reserve ya. Con RESERVADO, igual: " +
  "acelerar, no negociar. Si el anuncio dice \"no regateo/precio fijo\", una sola oferta suave o ninguna.\n" +
  "- Si no, parte de este % del precio anunciado: 90–95 % si el anuncio es fresco y el precio es de mercado; " +
  "85–90 % si está algo alto o lleva semanas; 78–85 % si lleva más de un mes, tiene defectos o le faltan " +
  "accesorios; 70–80 % si es revendedor con precio inflado o el texto dice \"urge/mudanza/acepto ofertas\". " +
  "Nunca por debajo del 70 %: una oferta así rompe la venta. Por debajo de 40 € casi no compensa regatear.\n" +
  "- Una cifra puntual, nunca un rango que suba por encima de mi tope (\"730–750\" acaba costando 750). " +
  "Imita la precisión del vendedor: si pide 800 €, oferta redonda; si pide 847 €, oferta precisa.\n" +
  "- Siempre con un porqué: un comparable de mercado o un defecto concreto.\n" +
  "- Si es sin envío (en mano), esa es la palanca: pagar en efectivo hoy le ahorra la comisión y el porte. " +
  "El pago, dentro de la app o en mano; nunca por Bizum, enlaces ni WhatsApp.";
const promptIntro = (n, total) => {
  const { kw, since } = queryParts(loadedCsv || "");
  return (
    "Lee https://rebusca.dibogomez.com/llms.txt antes de responder: es la guía de Rebusca (gramática de " +
    "búsqueda y formato de los enlaces con los que me contestas).\n\n" +
    (kw ? `He buscado "${kw}" en Wallapop con Rebusca (frescura: ${SINCE_LABEL[since] || "cualquiera"}). ` : "") +
    `Abajo van ${n} anuncios${total > n ? ` (muestra al azar de ${total} sin clasificar)` : ""}, ordenados por ${ordenLabel()}. ` +
    "No sé de marcas, ni de modelos, ni de qué precio es justo aquí: la criba la haces tú.\n\n" +
    "Saca el modelo o versión exacta de cada uno por título + descripción, no opines solo por el título, y " +
    "compáralo con su precio típico nuevo y de segunda mano. Compara siempre contra el «precio para mí». " +
    PRICE_NOTE +
    "\n\n" +
    LINK_RULES(n) +
    "\n\nDespués del enlace, razona la criba:\n" +
    "- CONSERVADOS (máximo 3, de mejor a peor): qué es exactamente (modelo y versión), por qué compensa a ese " +
    "precio, qué riesgo tiene (reservado, anuncio viejo, sin envío y lejos), y una línea de regateo: " +
    "«Ofrécele X € (Y % del pedido) porque <razón>; pregúntale <1–2 cosas>». Si no hay ninguno decente, " +
    "dímelo y ya.\n" +
    "- DESCARTADOS: el motivo, en una línea o agrupados por motivo. No los listes uno a uno." +
    HAGGLE_RULES +
    (queryURL() ? REFINE_RULES(queryURL(), catExclTerms()) : "")
  );
};
// ficha de un anuncio para la IA: id corto + título + precios + señales de decisión + enlace + descripción.
// El enlace es lo que la IA convierte en link pulsable para el usuario; el [#id] es solo de máquina
// (vuelve en ?keep=) y va recortado a la cola del id de Wallapop (ver shortIds).
function ficha(r, i, id) {
  const km = col(r, "km"),
    dias = col(r, "dias");
  const meta = [];
  if (isNum(km)) meta.push(`a ${Math.round(+km)} km`);
  meta.push(col(r, "envio") === "True" ? "con envío" : "sin envío");
  if (isNum(dias)) meta.push(`hace ${Math.round(+dias)} d`);
  if (col(r, "reservado") === "True") meta.push("RESERVADO");
  const url = col(r, "url");
  if (url) meta.push(url);
  const lines = [
    `${i + 1}. [#${id}] ${stripEmoji(col(r, "titulo"))} — ${pricePair(r)}`,
    "   " + meta.join(" · "),
  ];
  const desc = stripEmoji((col(r, "descripcion") || "").replace(/\s*\n\s*/g, " "));
  if (desc) lines.push("   " + desc);
  return lines.join("\n");
}
const fichas = (rows) => {
  const cortos = shortIds(rows.map((r) => col(r, "id")));
  return rows.map((r, i) => ficha(r, i, cortos[i])).join("\n\n");
};
// mensaje listo para pegar en Claude/Gemini: cabecera + ficha de cada anuncio (precio final estimado)
const aiPrompt = (rows, total) => promptIntro(rows.length, total) + "\n\n" + fichas(rows);
// Manda el texto adonde el usuario lo quiere. En el móvil, "copiado" obliga a cambiar de app a
// mano y a buscar dónde pegar: si hay hoja de compartir, se usa. Si no la hay, o si el usuario la
// cierra, el texto va al portapapeles igual. Resuelve con true cuando compartió, porque el aviso
// tiene que decir lo que de verdad pasó.
function copyAsync(makeText) {
  let t;
  try { t = makeText(); } catch (e) { return Promise.reject(e); }
  // navigator.share necesita el texto YA: no acepta una promesa. Con texto asíncrono se va por el
  // portapapeles, que sí sabe esperar sin perder el gesto del usuario.
  if (typeof t === "string" && navigator.share)
    return navigator.share({ text: t }).then(() => true, () => toClipboard(t).then(() => false));
  return toClipboard(t).then(() => false);
}
// copia al portapapeles admitiendo un trabajo asíncrono (calcular precios) como `t`. Solo la rama
// de ClipboardItem conserva el gesto en Safari/iOS: se le pasa la promesa y el navegador espera.
// El fallback resuelve primero y llama a writeText después, así que ahí el gesto ya se perdió.
function toClipboard(t) {
  if (typeof t !== "string" && window.ClipboardItem && navigator.clipboard.write) {
    const blob = Promise.resolve(t).then((s) => new Blob([s], { type: "text/plain" }));
    return navigator.clipboard.write([
      new ClipboardItem({ "text/plain": blob }),
    ]);
  }
  return Promise.resolve(t).then((s) => navigator.clipboard.writeText(s)); // fallback sin ClipboardItem
}
// copia un lote de filas como prompt para la IA y lo registra (wp_aisent): su veredicto
// vuelve como enlace ?keep=<ids> que conserva esos como favoritos y rechaza el resto del lote.
// muestra al azar cuando el mazo no cabe en el pegado. La cabeza del orden activo (por precio,
// por fecha) no representa lo que hay: con el mazo ordenado por precio la IA solo veía lo barato
// y no se enteraba de que media búsqueda eran bujías, así que no podía afinar la query.
// Conserva el orden del mazo (filter), para que el "ordenados por ..." del prompt siga siendo cierto.
function sample(rows, n) {
  if (rows.length <= n) return rows;
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const keep = new Set(idx.slice(0, n));
  return rows.filter((_, i) => keep.has(i));
}
console.assert(
  (() => {
    const all = Array.from({ length: 40 }, (_, i) => i);
    const s = sample(all, 10);
    return sample(all, 40) === all && sample(all, 99) === all && s.length === 10 &&
      new Set(s).size === 10 && s.every((v) => all.includes(v)) &&
      s.every((v, i) => i === 0 || s[i - 1] < v); // orden del mazo intacto
  })(),
  "sample roto",
);
function copyForAI(btn, all, vacio) {
  // sin id no hay nada que devolver en el ?keep=: fuera antes de muestrear (setAisent ya lo salta,
  // así que iría a la IA una ficha que su veredicto no puede nombrar)
  const rows = sample(all.filter((r) => col(r, "id")), UNSEEN_CAP);
  if (!rows.length) return snack(vacio, null);
  const prev = btn.textContent;
  const originCsv = curDrawer(); // el cajón de AHORA: la copia es asíncrona y curCsv puede cambiar
  btn.disabled = true;
  btn.textContent = "Preparando…";
  copyAsync(() => aiPrompt(rows, all.length))
    .then((compartido) => {
      setAisent(rows, originCsv);
      snack(compartido
        ? `${rows.length} anuncios enviados a tu IA`
        : `${rows.length} anuncios copiados — pégaselos a tu IA`, null);
    })
    .catch(() => snack("No se pudo copiar", null))
    .finally(() => {
      btn.disabled = false;
      btn.textContent = prev;
    });
}
$("#copyDeck").onclick = (e) => copyForAI(e.currentTarget, deckRows(), "El mazo está vacío");
$("#copyFav").onclick = (e) => copyForAI(e.currentTarget, bucketRows(favorite), "No tienes favoritos que copiar");
$("#exportFav").onclick = (e) => copyForAI(e.currentTarget, bucketRows(favorite), "No tienes favoritos que copiar");
// ── prompt de entrada: que la IA monte la QUERY ─────────────────────────────────
// Primer paso del flujo y el que más valor aporta: quien no conoce el producto no sabe qué
// marcas/modelos meter, y lo que no entre en la `q` no lo verá nunca.
// La intención del usuario va SIEMPRE al final, tras una línea en blanco: pega y sigue escribiendo
// ahí mismo sin tener que colarse en medio del texto.
const askPrompt = (intent) =>
  "Lee https://rebusca.dibogomez.com/llms.txt antes de responder: es la guía de Rebusca, un cazador de " +
  "chollos de Wallapop. Ahí tienes la gramática de búsqueda (OR, paréntesis, comillas) y el formato de los " +
  "enlaces con los que me tienes que contestar.\n\n" +
  "Quiero comprar algo de segunda mano y te lo describo al final. No sé qué marcas ni qué modelos son " +
  "buenos, ni qué precio es normal aquí: eso lo pones tú. Piensa los modelos de referencia, sus variantes " +
  "de nombre y los sinónimos, y métemelos en la búsqueda con OR. Esa query es lo más importante de todo el " +
  "proceso: lo que no entre en ella no lo veré.\n\n" +
  "Contéstame así:\n" +
  "1. Un enlace pulsable https://rebusca.dibogomez.com/?q=... con tu mejor búsqueda: OR para modelos y " +
  "sinónimos, ( ) para agrupar, excl con el ruido típico (funda, roto, piezas...), title=1 si la palabra " +
  "ensucia en las descripciones y since si merece la pena vigilar solo lo nuevo. URL-encodea la q y " +
  "mantenla compacta.\n" +
  "2. Una línea de por qué: qué cubre el OR y qué excluye.\n" +
  "3. Una o dos variantes pulsables si aportan (una más amplia, otra más fina).\n" +
  "4. Si te falta un dato para afinar (presupuesto, tamaño, uso), pregúntamelo en una línea, pero dame " +
  "igualmente el enlace por defecto.\n\n" +
  "Nunca me pongas la búsqueda en un bloque de código ni una URL suelta: estoy en el móvil y necesito " +
  "pulsar el enlace. Cuando lo abra, Rebusca lanza la búsqueda sola; luego le doy a \"Copiar sin ver para " +
  "la IA\" y te pego los anuncios para que los cribes tú.\n\n" +
  "Esto es lo que busco:\n\n" +
  intent;
console.assert(
  askPrompt("teclado para principiantes").endsWith("Esto es lo que busco:\n\nteclado para principiantes") &&
    askPrompt("").endsWith("Esto es lo que busco:\n\n"),
  "askPrompt roto",
);
$("#copyAskPrompt").onclick = (e) => {
  const btn = e.currentTarget;
  const intent = $("#kw").value.trim(); // lo ya tecleado va como intención; si está vacío, el usuario escribe al final
  btn.disabled = true;
  copyAsync(() => askPrompt(intent))
    .then((compartido) =>
      snack(
        compartido
          ? `Prompt enviado${intent ? ` con \"${intent}\"` : ""}.`
          : intent
            ? `Prompt copiado con \"${intent}\". Pégalo en tu IA.`
            : "Prompt copiado. Pégalo en tu IA y describe qué buscas.",
        null,
      ),
    )
    .catch(() => snack("No se pudo copiar", null))
    .finally(() => (btn.disabled = false));
};

// ── "copiar sin ver": el mazo entero a la IA, sin triar ─────────────────────────
// Flujo principal para quien no conoce el mercado del producto: en vez de triar a ciegas,
// le pasa a la IA todo lo que no ha clasificado y esta le devuelve la criba en un enlace.
// ponytail: precios "aprox" (porte estimado a 5 kg); el peso real costaba 1 request por anuncio.
// 50 fichas con la descripción ENTERA: más anuncios no mejoran la criba (y la respuesta se hace
// ilegible en móvil), y la descripción recortada a 200 se comía justo lo que decide el modelo
// y el estado. Menos anuncios y mejor mirados antes que más a medias.
const UNSEEN_CAP = 50;
// orden activo del mazo, en cristiano: la IA se lo cita al usuario ("ordenados por …")
function ordenLabel() {
  if (!sortKeys.length) return "el orden en que los devuelve Wallapop";
  const { col: c, dir } = sortKeys[0];
  const n = headers[c] || "";
  const base = { precio: "precio", km: "distancia", dias: "antigüedad" }[n] || n;
  return `${base} ${dir > 0 ? "ascendente" : "descendente"}`;
}

// ── PDF dossier de favoritos: fotos + fichas en un archivo para arrastrar a la IA ──
// Truco CORS: cdn.wallapop.com NO da Access-Control-Allow-Origin, así que fetch/canvas de
// la imagen fallan; pero un <img> cross-origin SÍ se muestra e imprime (solo se bloquea leer
// sus píxeles). window.print() -> "Guardar como PDF" mete texto+fotos en un único archivo.
const esc = (s) =>
  (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function dossierHTML(rows) {
  const cortos = shortIds(rows.map((r) => col(r, "id"))); // mismos ids recortados que en el texto
  const cards = rows
    .map((r, i) => {
      // todas las fotos del anuncio (col "imagenes", separadas por espacio); si no hay, la única "imagen"
      const imgs = (col(r, "imagenes") || col(r, "imagen") || "").split(" ").filter(Boolean);
      const url = col(r, "url"),
        desc = stripEmoji((col(r, "descripcion") || "").replace(/\s*\n\s*/g, " "));
      const photos = imgs.map((u) => `<img src="${esc(u)}" alt="">`).join("");
      return `<div class="dsr-card"><div class="dsr-body">` +
        `<div class="dsr-t">${i + 1}. [#${esc(cortos[i])}] ${esc(stripEmoji(col(r, "titulo")))}</div>` +
        `<div class="dsr-p">${esc(pricePair(r))}</div>` +
        (desc ? `<div class="dsr-d">${esc(desc)}</div>` : "") +
        (url ? `<a class="dsr-u" href="${esc(url)}">${esc(url)}</a>` : "") +
        (photos ? `<div class="dsr-photos">${photos}</div>` : "") +
        `</div></div>`;
    })
    .join("");
  return `<pre class="dsr-intro">${esc(promptIntro(rows.length))}</pre>${cards}`;
}
async function dossierFav(btn) {
  const rows = bucketRows(favorite).filter((r) => col(r, "id")); // igual que copyForAI: sin id no hay ?keep= posible
  if (!rows.length) return snack("No tienes favoritos", null);
  const prev = btn.textContent;
  const originCsv = curDrawer(); // igual que en copyForAI: se espera a las fotos antes de registrar
  btn.disabled = true;
  btn.textContent = "Preparando…";
  try {
    const box = $("#dossier");
    box.innerHTML = dossierHTML(rows);
    // espera a que carguen las fotos (o fallen) antes de imprimir, si no salen en blanco
    await Promise.all(
      [...box.querySelectorAll("img")].map((im) =>
        im.complete ? null : new Promise((res) => (im.onload = im.onerror = res)),
      ),
    );
    setAisent(rows, originCsv); // el PDF también es un lote enviado: su ?keep resuelve el resto
    window.print();
  } catch (e) {
    // Solo había `finally`: el throw se perdía en un unhandledrejection, el botón volvía a su
    // sitio y el usuario veía un botón que no hace nada. Y setAisent ya había marcado el lote.
    console.error("Rebusca: el dossier falló", e);
    snack("No se pudo preparar el dossier: " + (e.message || e), null);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}
$("#dossierFav").onclick = (e) => dossierFav(e.currentTarget);
$("#swYes").onclick = () => card && fling(1); // los hints ✓→ / ←✕ también clasifican, no solo el swipe
$("#swNo").onclick = () => card && fling(-1);
$("#swipeFab").onclick = () => fabAction();
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
    "Estoy valorando comprar este artículo de segunda mano en Wallapop y me gustaría una segunda opinión. " +
    PRICE_NOTE +
    "\n\nIdentifica el modelo o versión exacta, revisa sus especificaciones y su estado, compáralo con su precio " +
    "típico nuevo y de segunda mano, y dime en la primera línea si a este precio es buena compra: sí, no, o de qué " +
    "depende. Luego, corto: el porqué y una línea de regateo: «Ofrécele X € (Y % del pedido) porque <razón>; " +
    "pregúntale <1–2 cosas>»." +
    HAGGLE_RULES +
    "\n\nSi de lo que averigües sale una búsqueda mejor (otro modelo, otras marcas), dámela como enlace pulsable " +
    "a Rebusca siguiendo https://rebusca.dibogomez.com/llms.txt:\n\n" +
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
  if (!galView.hidden) return galKey(e); // la galería es la capa de arriba: las teclas son suyas
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
  return view !== "" || !searchesView.hidden || !swipeView.hidden || !galView.hidden;
}
function closeTop() {
  // cierra la superficie superior; true si cerró algo
  if (!galView.hidden) {
    closeGal();
    return true;
  }
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





