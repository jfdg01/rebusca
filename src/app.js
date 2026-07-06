// ── parser CSV (respeta comas, comillas y saltos dentro de campo) ──
function parseCSV(text) {
  const rows = [[]]; let field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rows[rows.length-1].push(field); field = ''; }
    else if (c === '\r') {}
    else if (c === '\n') { rows[rows.length-1].push(field); field = ''; rows.push([]); }
    else field += c;
  }
  rows[rows.length-1].push(field);
  if (rows[rows.length-1].length === 1 && rows[rows.length-1][0] === '') rows.pop();
  return rows;
}
// ── estado persistente: localStorage (offline) + servidor (compartido) ──
const load = k => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
const save = (k, set) => { localStorage.setItem(k, JSON.stringify([...set])); pushEstado(); };
const trash = load('wp_discarded'), fav = load('wp_fav');   // 2 cubos exclusivos; "sin ver" = ni fav ni trash
const blockSel = load('wp_blocksel');   // vendedores bloqueados (user_id): sus anuncios van a la papelera solos, presentes y futuros
const saveBlockSel = () => { localStorage.setItem('wp_blocksel', JSON.stringify([...blockSel])); pushEstado(); };
let stamp = JSON.parse(localStorage.getItem('wp_stamp') || '{}');   // {key: epochMs}: cuándo se clasificó (para "descartado/destacado hace X"); legacy sin stamp no muestra línea
const stampNow = k => { stamp[k] = Date.now(); localStorage.setItem('wp_stamp', JSON.stringify(stamp)); };
const unstamp = k => { if (k in stamp) { delete stamp[k]; localStorage.setItem('wp_stamp', JSON.stringify(stamp)); } };
let exclMap = JSON.parse(localStorage.getItem('wp_excl') || '{}');   // {csv: [palabras]}: por query, cartas con la palabra en el título se auto-descartan (fuera del mazo)
const exclTerms = () => (curCsv && exclMap[curCsv]) || [];   // palabras vetadas de la query activa
const saveExcl = () => { localStorage.setItem('wp_excl', JSON.stringify(exclMap)); pushEstado(); };
let catExclMap = JSON.parse(localStorage.getItem('wp_catexcl') || '{}');   // {csv: [categorias]}: categorías vetadas por query (match exacto sobre la columna categoria)
const catExclTerms = () => (curCsv && catExclMap[curCsv]) || [];
const saveCatExcl = () => { localStorage.setItem('wp_catexcl', JSON.stringify(catExclMap)); pushEstado(); };
let perfil = localStorage.getItem('wp_perfil') || '';   // quién soy (por dispositivo)
let perfilColor = '';   // color elegido; se guarda en el JSON para el selector
const qsPerfil = () => '?perfil=' + encodeURIComponent(perfil || 'casa');
let _push;   // POST del estado del perfil actual, con debounce
function pushEstado() {
  if (!perfil) return;
  clearTimeout(_push);
  _push = setTimeout(() => fetch('/estado' + qsPerfil(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trash: [...trash], fav: [...fav], blockSel: [...blockSel], excl: exclMap, catExcl: catExclMap, color: perfilColor, stamp }) }).catch(() => {}), 400);
}
// carga el estado del perfil actual desde el servidor (fuente de verdad, last-writer-wins)
function hydrateEstado() {
  return fetch('/estado' + qsPerfil()).then(r => r.json()).then(e => {
    for (const [set, arr] of [[trash, e.trash], [fav, e.fav]]) {
      set.clear(); (arr || []).forEach(x => set.add(x));
    }
    for (const k of fav) if (trash.has(k)) fav.delete(k);   // cubos exclusivos: limpia solapes heredados (gana papelera)
    blockSel.clear(); (e.blockSel || []).forEach(x => blockSel.add(x));
    localStorage.setItem('wp_blocksel', JSON.stringify([...blockSel]));
    exclMap = (e.excl && typeof e.excl === 'object' && !Array.isArray(e.excl)) ? e.excl : {};   // {csv:[palabras]}; ignora formatos viejos
    catExclMap = (e.catExcl && typeof e.catExcl === 'object' && !Array.isArray(e.catExcl)) ? e.catExcl : {};   // {csv:[categorias]}
    stamp = (e.stamp && typeof e.stamp === 'object' && !Array.isArray(e.stamp)) ? e.stamp : {};   // {key:epochMs} cuándo se clasificó
    localStorage.setItem('wp_stamp', JSON.stringify(stamp));
    localStorage.setItem('wp_discarded', JSON.stringify([...trash]));   // espejo offline
    localStorage.setItem('wp_fav', JSON.stringify([...fav]));
    localStorage.setItem('wp_excl', JSON.stringify(exclMap));
    localStorage.setItem('wp_catexcl', JSON.stringify(catExclMap));
    if (data.length) render();
  }).catch(() => {});   // offline: nos quedamos con lo de localStorage
}

const HIDE = new Set(['id', 'cp', 'url', 'vendedor', 'imagen']);   // no se muestran como columna (url va en el boton Ver; vendedor/imagen se usan en la tarjeta)
let headers = [], data = [], sortKeys = [], view = '';  // view: '' mazo | 'trash' papelera | 'fav' interesantes
let iId = -1, iUrl = -1, iTitulo = -1, iPrecio = -1;
const isNum = v => v !== '' && !isNaN(v);
// identidad inmutable: id de Wallapop. Fallback titulo|precio solo para drag de CSV sin id.
const key = r => (iId >= 0 && r[iId]) || (r[iTitulo] + '|' + r[iPrecio]);

// --- precio final estimado al comprador (envío protegido de Wallapop) ---
// tarifa de envío por tramo de peso (up_to_kg), verificada contra la API: kg <= tope -> €
const SHIP = [[2, 3.5], [5, 4.5], [10, 6.5], [20, 9.5], [30, 14.5]];
const porte = kg => (SHIP.find(([b]) => kg <= b) || SHIP[SHIP.length - 1])[1];
// ponytail: comisión de protección ~0,70€ + 5% del precio; las fuentes divergen (5–10%),
// ajústalo aquí si cambia. Un solo sitio para toda la app.
const finalPrice = (precio, kg = 5) => precio + 0.70 + 0.05 * precio + porte(kg);
// peso real (tramo up_to_kg) por id, cacheado del detalle de la API (botón "Precio exacto").
// número -> porte exacto; sin entrada -> se estima con 5 kg y un '*'.
let pesos = JSON.parse(localStorage.getItem('wp_pesos') || '{}');
console.assert(porte(1.5) === 3.5 && porte(2) === 3.5 && porte(2.1) === 4.5 && porte(40) === 14.5, 'porte() por tramo roto');
console.assert(finalPrice(50, 1.5).toFixed(2) === '56.70' && finalPrice(50).toFixed(2) === '57.70', 'finalPrice roto');
const eur = n => n.toFixed(2).replace('.', ',') + '€';   // 78.7 -> "78,70€"

const $ = s => document.querySelector(s);
const thead = $('thead'), tbody = $('tbody');
// ── iconos: SVG inline de Lucide (MIT), heredan color con currentColor ──
const ICON = {
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  star: '<path d="M11.5 2.3 8.9 8.6 2.2 9.2c-.9.1-1.2 1.2-.5 1.8l5 4.4-1.5 6.5c-.2.9.7 1.6 1.5 1.1l5.8-3.5 5.8 3.5c.8.5 1.7-.2 1.5-1.1l-1.5-6.5 5-4.4c.7-.6.4-1.7-.5-1.8l-6.7-.6L13 2.3c-.3-.8-1.4-.8-1.7 0Z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const ic = n => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = ic(e.dataset.icon));

// "hace 16 días y 19 horas" a partir de los días (float) del CSV
function humanAge(dias) {
  const total = Math.max(0, Math.round(dias * 24));   // horas totales
  const d = Math.floor(total / 24), h = total % 24;
  if (!d && !h) return 'recién puesto';
  const parts = [];
  if (d) parts.push(d + (d === 1 ? ' día' : ' días'));
  if (h) parts.push(h + (h === 1 ? ' hora' : ' horas'));
  return 'hace ' + parts.join(' y ');
}
console.assert(humanAge(16.8) === 'hace 16 días y 19 horas' && humanAge(1) === 'hace 1 día'
  && humanAge(0.05) === 'hace 1 hora' && humanAge(0) === 'recién puesto', 'humanAge() roto');

// "hace 3 min / 5 h / 2 días" desde un epochMs: cuándo se descartó/destacó (granularidad min→h→día)
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
console.assert(ago(Date.now() - 3 * 60000) === 'hace 3 min' && ago(Date.now() - 5 * 3600000) === 'hace 5 h'
  && ago(Date.now() - 2 * 86400000) === 'hace 2 días' && ago(Date.now()) === 'hace un momento', 'ago() roto');

// tarjeta compuesta (Destacados/Papelera + swipe): precio + ubicación + antigüedad + flags + descripción
function fillCard(el, r) {
  const add = (cls, txt) => { const e = document.createElement('div'); e.className = cls; e.textContent = txt; el.append(e); return e; };
  const precio = col(r, 'precio'), km = col(r, 'km'), ciudad = col(r, 'ciudad'), dias = col(r, 'dias');

  const img = col(r, 'imagen');
  if (img) { const im = document.createElement('img'); im.className = 'li-img'; im.loading = 'lazy'; im.src = img; im.onerror = () => im.remove(); el.append(im); }

  add('li-title', col(r, 'titulo'));

  // precio a la izquierda; antigüedad (sin color de frescura) a la derecha
  const conEnvio = col(r, 'envio') === 'True';
  const head = document.createElement('div'); head.className = 'li-head';
  const price = document.createElement('span'); price.className = 'li-price';
  // con envío: el precio mostrado ES el final estimado al comprador (comisión + porte a 5 kg),
  // con * en superíndice; su explicación vive en Ajustes. Sin envío: precio del anuncio tal cual.
  if (conEnvio && isNum(precio)) {
    const kg = pesos[col(r, 'id')];   // peso real cacheado; si no hay, 5 kg + '*'
    const exact = typeof kg === 'number';
    price.textContent = eur(finalPrice(+precio, exact ? kg : undefined));
    if (!exact) { const s = document.createElement('sup'); s.className = 'li-star'; s.textContent = '*'; price.append(s); }
  } else {
    price.textContent = precio !== '' ? `${precio} €` : '—';
  }
  head.append(price);
  if (isNum(dias)) { const a = document.createElement('div'); a.className = 'li-age'; a.textContent = humanAge(+dias); head.append(a); }
  el.append(head);

  // envío + distancia en una sola línea centrada bajo el precio
  let where = km !== '' ? `a ${km} km` : '';
  if (ciudad) where += (where ? ' ' : '') + `(${ciudad})`;
  add('li-flags', where ? `${conEnvio ? 'Con envío' : 'Sin envío'}, ${where}` : (conEnvio ? 'Con envío' : 'Sin envío'));
  // cuándo se clasificó (solo en papelera/destacados y si hay marca de tiempo)
  if ((view === 'trash' || view === 'fav') && stamp[key(r)])
    add('li-when' + (view === 'fav' ? ' fav' : ''), `${view === 'fav' ? 'Destacado' : 'Descartado'} ${ago(stamp[key(r)])}`);

  const desc = col(r, 'descripcion');
  if (desc) add('li-desc', desc);
}
function listBody(r) { const td = document.createElement('td'); td.className = 'li'; fillCard(td, r); return td; }

// orden multinivel: clic añade columna como siguiente prioridad; reclic invierte
function toggleSort(col) {
  const k = sortKeys.find(s => s.col === col);
  if (k) k.dir = -k.dir; else sortKeys.push({ col, dir: 1 });
  paintSortHeaders(); render();
}
function paintSortHeaders() {
  thead.querySelectorAll('th[data-col]').forEach(th => {
    const idx = sortKeys.findIndex(s => s.col === +th.dataset.col);
    if (idx < 0) { th.classList.remove('sorted'); th.removeAttribute('data-dir'); }
    else { th.classList.add('sorted'); const s = sortKeys[idx];
      th.dataset.dir = (sortKeys.length > 1 ? (idx + 1) + ' ' : '') + (s.dir > 0 ? '▲' : '▼'); }
  });
}
function clearSort() { sortKeys = []; paintSortHeaders(); render(); }

// barra de orden de las listas: reclic invierte; "Entrada" (data-sort="") = orden de llegada
function applyListSort(name) {
  if (name === listSort) listSortDir = -listSortDir;
  else { listSort = name; listSortDir = name ? 1 : -1; }   // columnas asc (barato/cerca/reciente); entrada: recién añadido arriba
  render();
}
function paintListSort() {
  document.querySelectorAll('#listSort button').forEach(b => {
    const on = b.dataset.sort === listSort;
    b.classList.toggle('on', on);
    b.dataset.dir = on ? (listSortDir > 0 ? '▲' : '▼') : '';
  });
}
document.querySelectorAll('#listSort button').forEach(b => b.onclick = () => applyListSort(b.dataset.sort));

// filas visibles con el orden actual (compartido por tabla y modo swipe)
let listQ = '';   // filtro de texto de la pantalla de lista (papelera/destacados)
let listSeller = '';   // filtro por vendedor en la papelera (desde el banner: "ver" rechazados de un vendedor)
const isExcluded = r => {   // vetada por la query activa: categoría exacta o palabra en el título
  const cats = catExclTerms();
  if (cats.length && cats.includes(col(r, 'categoria'))) return true;
  const t = norm(r[iTitulo] || '');
  return exclTerms().some(w => t.includes(w));
};
// "lejos sin envío": a más de N km y sin envío, inalcanzable en la práctica. Nunca entran al mazo.
let lejosKm = +localStorage.getItem('wp_lejoskm') || 10;   // umbral configurable (Ajustes)
const isLejos = r => { const km = col(r, 'km'); return km !== '' && +km > lejosKm && col(r, 'envio') !== 'True'; };
let autoExclLejos = localStorage.getItem('wp_autoexcllejos') === '1';   // si activo, los lejos-sin-envío van solos a la papelera (Ajustes)
// compara dos celdas: numérica si ambas lo son (vacío = -∞), si no alfabética con acentos
function cmpCell(x, y) {
  if ((x === '' || isNum(x)) && (y === '' || isNum(y))) {
    x = x === '' ? -Infinity : +x; y = y === '' ? -Infinity : +y; return x - y;
  }
  return x.localeCompare(y, 'es', { numeric: true });
}
// orden de la lista (papelera/destacados): '' = momento de entrada (Set preserva inserción) | columna del CSV
let listSort = '', listSortDir = -1;   // por defecto: recién añadido arriba
function sortList(rows) {
  if (!listSort) {
    const order = [...(view === 'trash' ? trash : fav)];   // orden de llegada a la lista
    const pos = new Map(order.map((k, i) => [k, i]));
    rows.sort((a, b) => ((pos.get(key(a)) ?? -1) - (pos.get(key(b)) ?? -1)) * listSortDir);
    return;
  }
  const c = headers.indexOf(listSort); if (c < 0) return;
  rows.sort((a, b) => cmpCell(a[c], b[c]) * listSortDir);
}

function filteredRows() {
  const listView = view === 'trash' || view === 'fav';
  const q = listView ? norm(listQ) : '';   // el filtro solo aplica en vista de lista
  let rows = data.filter(r => {
    const k = key(r);
    if (q && !norm(r[iTitulo] || '').includes(q)) return false;
    if (view === 'trash' && listSeller && col(r, 'vendedor') !== listSeller) return false;
    if (view === 'trash') return trash.has(k);
    if (view === 'fav') return fav.has(k);
    return !fav.has(k) && !trash.has(k) && !isExcluded(r) && !isLejos(r);   // mazo: sin clasificar, sin vetar, sin lejos-sin-envío
  });
  if (listView) sortList(rows);   // las listas ordenan con su barra (#listSort)
  else if (sortKeys.length) rows.sort((a, b) => {   // mazo/swipe: orden multinivel
    for (const { col, dir } of sortKeys) { const c = cmpCell(a[col], b[col]); if (c) return c * dir; }
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
    if (!fav.has(k) && !trash.has(k) && isLejos(r)) { trash.add(k); stampNow(k); changed = true; }
  }
  if (changed) save('wp_discarded', trash);
}

function render() {
  enforceBlocks();   // vendedores bloqueados a la papelera antes de filtrar
  enforceLejos();    // auto-exclusión de lejos-sin-envío si el ajuste está activo
  const rows = filteredRows();
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const k = key(r);
    const tr = document.createElement('tr');

    // celda de acciones: Ver y Quitar grandes, uno al lado del otro
    const act = document.createElement('td'); act.className = 'act';
    const url = iUrl >= 0 ? r[iUrl] : '';
    const ver = document.createElement('a'); ver.className = 'btn ver'; ver.textContent = 'Ver';
    if (url) { ver.href = url; ver.target = '_blank'; }
    else { ver.setAttribute('aria-disabled', 'true'); }
    const quit = document.createElement('button'); quit.className = 'btn quitar';
    quit.textContent = view === 'trash' ? 'Restaurar' : 'Quitar';
    quit.onclick = () => (view === 'trash' ? restore(k) : discard(k, r[iTitulo]));
    act.append(ver, quit); tr.append(act);

    tr.append(listBody(r));
    frag.append(tr);
  }
  tbody.append(frag);
  const listView = view === 'trash' || view === 'fav';
  $('table').hidden = !(listView && headers.length);   // la tabla es la vista de lista editable (interesantes/papelera)
  // pantalla dedicada: en modo lista se oculta TODO el header de búsqueda y sale la barra de lista
  document.querySelector('header').classList.toggle('pinned', listView);   // fija la barra solo en modo lista (ver CSS)
  $('.brand').hidden = listView;
  document.querySelectorAll('header .panel').forEach(p => p.hidden = listView);   // varios paneles ahora (perfil, buscar, query activa)
  $('#listHead').hidden = !listView;
  if (!listView && listQ) { listQ = ''; $('#listFilter').value = ''; }   // el filtro no sobrevive al salir de la lista
  if (!listView) listSeller = '';   // ni el filtro por vendedor
  if (listView) $('#listTitle').textContent = view === 'fav' ? 'Destacados' : listSeller ? 'Rechazados del vendedor' : 'Papelera';
  $('#exportFav').hidden = !(view === 'fav' && rows.length);   // copiar solo tiene sentido con destacados a la vista
  $('#calcPeso').hidden = !(view === 'fav' && rows.some(r => col(r, 'envio') === 'True'));   // solo con destacados con envío
  $('#listActions').hidden = !(view === 'fav' && rows.length);   // la sección solo existe con destacados a la vista
  const hasRows = headers.length && rows.length;
  $('#swipeFab').hidden = !hasRows || listView;         // en modo lista se edita en la tabla, no se hace swipe
  if (!listView && hasRows) $('#swipeFab').textContent = 'REBUSCAR';
  $('#empty').hidden = !!hasRows;
  if (headers.length && !rows.length)
    $('#empty').textContent = listView && listQ ? 'Nada coincide con el filtro.'
      : view === 'trash' ? 'La papelera está vacía.'
      : view === 'fav' ? 'Sin interesantes todavía.' : 'Nada que revisar.';
  paintStat();
  paintSellerBanner();
  paintListSort();
  renderExcl();
  renderCats();
}

// chips de categorías presentes en la query (con nº de cartas); clic veta/reactiva la categoría
function renderCats() {
  const box = $('#cats'); if (!box) return;
  const show = headers.length && view === '' && curCsv && headers.includes('categoria');
  box.hidden = !show;
  const chips = $('#catChips'); chips.innerHTML = '';
  if (!show) return;
  const counts = {};
  for (const r of data) { const c = col(r, 'categoria'); if (c) counts[c] = (counts[c] || 0) + 1; }
  const excl = catExclTerms();
  for (const c of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) {
    const b = document.createElement('button');
    const off = excl.includes(c);
    b.className = 'chip cat-chip' + (off ? ' off' : '');
    b.textContent = `${c} (${counts[c]})`;   // textContent: a prueba de < & en el nombre
    b.onclick = () => {
      const cur = catExclMap[curCsv] || (catExclMap[curCsv] = []);
      const i = cur.indexOf(c);
      if (i >= 0) cur.splice(i, 1); else cur.push(c);
      if (!cur.length) delete catExclMap[curCsv];
      saveCatExcl(); render();
    };
    chips.append(b);
  }
  const clr = $('#catClear');   // limpiar (en el summary): reactiva todas las categorías vetadas
  clr.hidden = !excl.length;
  clr.onclick = e => { e.preventDefault(); e.stopPropagation(); delete catExclMap[curCsv]; saveCatExcl(); render(); };
}

// añade/quita una palabra de la exclusión de la query activa (compartido main + swipe)
function addExcl(raw) {   // true si cambió; norma la palabra, evita duplicados
  const w = norm(raw);
  if (!w || !curCsv || exclTerms().includes(w)) return false;
  (exclMap[curCsv] ||= []).push(w); saveExcl(); return true;
}
function delExcl(w) {
  exclMap[curCsv] = exclTerms().filter(x => x !== w);
  if (!exclMap[curCsv].length) delete exclMap[curCsv];
  saveExcl();
}
// pinta chips de palabras vetadas en un contenedor; onChange se llama al quitar una
function fillExclChips(chips, onChange) {
  chips.innerHTML = '';
  for (const w of exclTerms()) {
    const b = document.createElement('button');
    b.className = 'chip excl-chip'; b.textContent = w + ' ✕';   // textContent: sin inyección desde texto de usuario
    b.title = 'quitar exclusión';
    b.onclick = () => { delExcl(w); onChange(); };
    chips.append(b);
  }
}
// chips de palabras vetadas de la query activa (solo con CSV cargado y fuera de las vistas de lista)
function renderExcl() {
  const box = $('#excl'); if (!box) return;
  box.hidden = !(headers.length && view === '' && curCsv);
  fillExclChips($('#exclChips'), render);
}

function paintStat() {
  if (!headers.length) { $('#stat').innerHTML = ''; return; }
  const favs = data.filter(r => fav.has(key(r))).length;
  const disc = data.filter(r => trash.has(key(r))).length;
  const hasExcl = exclTerms().length || catExclTerms().length;   // ad-hoc: palabra en título o categoría
  const vetados = hasExcl ? data.filter(r => !fav.has(key(r)) && !trash.has(key(r)) && isExcluded(r)).length : 0;
  const lejos = data.filter(r => !fav.has(key(r)) && !trash.has(key(r)) && !isExcluded(r) && isLejos(r)).length;
  const sinVer = data.length - favs - disc - vetados - lejos;   // "vistos" = favs + disc; vetados y lejos (nunca en mazo) salen aparte
  $('#stat').innerHTML =
    `<span><b>${sinVer}</b> sin ver</span>` +
    (vetados ? `<span><b>${vetados}</b> excluidos · <span class="link" id="trashExcl">mandar a rechazados</span></span>` : '') +
    (lejos ? `<span><b>${lejos}</b> lejos y sin envío · <span class="link" id="trashLejos">rechazar</span></span>` : '') +
    `<span><b>${favs}</b> interesantes ` +
    (favs || view === 'fav' ? `· <span class="link" id="toggleFav">${view === 'fav' ? 'volver' : 'ver lista'}</span>` : '') +
    `</span>` +
    `<span><b>${disc}</b> descartados ` +
    (disc || view === 'trash' ? `· <span class="link" id="toggleTrash">${view === 'trash' ? 'volver' : 'ver papelera'}</span>` : '') +
    `</span>` +
    (sortKeys.length ? `<span>orden: <b>${sortKeys.map(s => headers[s.col]).join(' › ')}</b> · <span class="link" id="clearSort">limpiar</span></span>` : '');
  const toggle = v => () => { view = view === v ? '' : v; listSeller = ''; sellerReturn = false; $('#empty').textContent = ''; render(); };
  const t = $('#toggleTrash'); if (t) t.onclick = toggle('trash');
  const f = $('#toggleFav'); if (f) f.onclick = toggle('fav');
  const el = $('#trashLejos'); if (el) el.onclick = trashLejos;
  const te = $('#trashExcl'); if (te) te.onclick = trashExcluded;
  const cs = $('#clearSort');
  if (cs) cs.onclick = clearSort;
}

// manda los "lejos y sin envío" actuales a la papelera de una vez (deshacer: los saca)
function trashLejos() {
  const ks = data.filter(r => !fav.has(key(r)) && !trash.has(key(r)) && isLejos(r)).map(key);
  if (!ks.length) return;
  ks.forEach(k => { trash.add(k); stampNow(k); }); save('wp_discarded', trash); render();
  snack(`${ks.length} lejos a la papelera`, () => {
    ks.forEach(k => { trash.delete(k); unstamp(k); }); save('wp_discarded', trash); render();
  });
}
// manda todos los excluidos actuales a la papelera de una vez (deshacer: los saca)
function trashExcluded() {
  const ks = data.filter(r => !fav.has(key(r)) && !trash.has(key(r)) && isExcluded(r)).map(key);
  if (!ks.length) return;
  ks.forEach(k => { trash.add(k); stampNow(k); }); save('wp_discarded', trash); render();
  snack(`${ks.length} excluido${ks.length === 1 ? '' : 's'} a la papelera`, () => {
    ks.forEach(k => { trash.delete(k); unstamp(k); }); save('wp_discarded', trash); render();
  });
}

// ── auto-rechazo por vendedor ──
// vendedores bloqueados: sus items del CSV actual van a la papelera solos (idempotente, sin snack)
function enforceBlocks() {
  if (!blockSel.size || !headers.includes('vendedor')) return;
  let changed = false;
  for (const r of data) {
    const s = col(r, 'vendedor'); if (!s || !blockSel.has(s)) continue;
    const k = key(r);
    if (!trash.has(k)) { fav.delete(k); trash.add(k); stampNow(k); changed = true; }
  }
  if (changed) { save('wp_fav', fav); save('wp_discarded', trash); }
}
// candidatos a bloqueo: vendedor con ≥2 rechazados y ≥1 anuncio fresco en el CSV actual, no bloqueado aún
function sellerCandidates() {
  if (!headers.includes('vendedor')) return [];
  const rej = {}, fresh = {};
  for (const r of data) {
    const s = col(r, 'vendedor'); if (!s) continue;
    const k = key(r);
    if (trash.has(k)) rej[s] = (rej[s] || 0) + 1;
    else if (!fav.has(k) && !isExcluded(r) && !isLejos(r)) (fresh[s] = fresh[s] || []).push(r);
  }
  return Object.keys(rej).filter(s => rej[s] >= 2 && fresh[s] && !blockSel.has(s))
    .map(s => ({ s, rejected: rej[s], fresh: fresh[s] }))
    .sort((a, b) => b.rejected - a.rejected);
}
// bloquear vendedor: manda sus frescos a la papelera; deshacer = desbloquear + restaurar esos
function blockSeller(s) {
  const newly = data.filter(r => col(r, 'vendedor') === s && !trash.has(key(r))).map(key);
  blockSel.add(s); saveBlockSel();
  newly.forEach(k => { fav.delete(k); trash.add(k); stampNow(k); });
  save('wp_fav', fav); save('wp_discarded', trash); render();
  if (!swipeView.hidden) rebuildDeck();   // saca del mazo lo recién rechazado
  snack(`Vendedor bloqueado · ${newly.length} a la papelera`, () => {
    blockSel.delete(s); saveBlockSel();
    newly.forEach(k => { trash.delete(k); unstamp(k); });
    save('wp_discarded', trash); render();
    if (!swipeView.hidden) rebuildDeck();
  });
}
// "ver" del banner: cierra el swipe y abre la papelera filtrada a los rechazados de ese vendedor
let sellerReturn = false;   // al volver de esa lista, reabrir el swipe con los ajustes abiertos (de donde vino)
function showSellerTrash(s) { sellerReturn = true; listSeller = s; view = 'trash'; closeSwipe(); }
function paintSellerBanner() {
  const box = $('#sellerBanner'); if (!box) return;
  const cands = !swipeView.hidden && headers.length ? sellerCandidates() : [];
  const badge = $('#swipeCogBadge');   // señal en la cog para no perder el aviso al esconder el banner en el menú
  if (badge) { badge.hidden = !cands.length; badge.textContent = cands.length; }
  box.hidden = !cands.length; box.innerHTML = '';
  if (!cands.length) return;
  const head = document.createElement('div'); head.className = 'sb-head';
  const lbl = document.createElement('span');
  lbl.innerHTML = `<b>${cands.length}</b> vendedor${cands.length === 1 ? '' : 'es'} con 2+ rechazos`;
  head.append(lbl); box.append(head);
  const list = document.createElement('div'); list.className = 'sb-list';
  for (const c of cands) {
    const row = document.createElement('div'); row.className = 'sb-row';
    const info = document.createElement('span'); info.className = 'sb-info';
    const b = document.createElement('b'); b.textContent = c.rejected;
    const ver = document.createElement('span'); ver.className = 'link'; ver.textContent = 'ver';
    ver.onclick = () => showSellerTrash(c.s);   // papelera filtrada a este vendedor
    info.append(b, ' rechazados · ', ver);
    const btn = document.createElement('button'); btn.className = 'chip sb-block';
    btn.textContent = `Rechazar siguientes (${c.fresh.length})`;
    btn.onclick = () => blockSeller(c.s);
    row.append(info, btn); list.append(row);
  }
  box.append(list);
}

// ── descartar / restaurar con deshacer claro ──
let snackTimer;
function discard(k, titulo) {
  const wasFav = fav.has(k);                 // al descartar sale de interesantes (cubos exclusivos)
  fav.delete(k); trash.add(k); stampNow(k); save('wp_fav', fav); save('wp_discarded', trash); render();
  snack(`Descartado: ${(titulo || '').slice(0, 40)}`, () => {
    trash.delete(k); if (wasFav) { fav.add(k); stampNow(k); } else unstamp(k); save('wp_fav', fav); save('wp_discarded', trash); render();
  });
}
function restore(k) {                          // restaurar = volver a "sin ver"
  trash.delete(k); unstamp(k); save('wp_discarded', trash); render();
  snack('Restaurado', () => { trash.add(k); stampNow(k); save('wp_discarded', trash); render(); });
}
function snack(msg, undo) {
  $('#snackmsg').textContent = msg; const s = $('#snack'); s.hidden = false;
  $('#undo').hidden = !undo;
  requestAnimationFrame(() => s.classList.add('show'));
  $('#undo').onclick = () => { undo && undo(); hideSnack(); };
  clearTimeout(snackTimer); snackTimer = setTimeout(hideSnack, 5000);
}
function hideSnack() { const s = $('#snack'); s.classList.remove('show'); setTimeout(() => s.hidden = true, 220); }

// ── carga de un CSV (texto) ──
function loadCSV(text, name) {
  const rows = parseCSV(text);
  headers = rows[0]; data = rows.slice(1); sortKeys = []; view = '';
  iId = headers.indexOf('id'); iUrl = headers.indexOf('url'); iTitulo = headers.indexOf('titulo');
  iPrecio = headers.indexOf('precio');
  if (iTitulo < 0) iTitulo = 0;

  thead.innerHTML = '';
  const tr = document.createElement('tr');
  tr.append(Object.assign(document.createElement('th'), { className: 'act', textContent: '' }));
  headers.forEach((h, i) => {
    if (HIDE.has(h)) return;
    const th = document.createElement('th'); th.textContent = h; th.dataset.col = i;
    th.title = 'clic: añade a la prioridad de orden · otra vez: invierte';
    th.onclick = () => toggleSort(i);
    tr.append(th);
  });
  thead.append(tr);
  render();
}

// ── buscador de queries: combobox propio (input + lista vertical filtrable) ──
const pick = $('#pick'), qbox = $('.qbox'), qlist = $('#qlist'), pickSince = $('#pickSince');
let allQueries = [];   // [{csv, label, kw, since}] — fuente del combobox
let curCsv = null;     // csv de la query seleccionada (el input solo muestra el kw)
const lastCsvKey = () => 'wp_lastcsv_' + (perfil || 'casa');   // último dataset por persona
function loadQuery(csv) {   // carga el CSV (scopeado al perfil) y lo recuerda como el último de la persona
  fetch('/csvfile' + qsPerfil() + '&csv=' + encodeURIComponent(csv)).then(r => r.text()).then(t => loadCSV(t, csv));
  if (perfil) localStorage.setItem(lastCsvKey(), csv);
}
function selectQuery(csv) {   // input = solo el kw; el "desde" va como badge pino a la derecha
  const { kw, since } = queryParts(csv);
  pick.value = kw; curCsv = csv;
  pickSince.textContent = since ? SINCE_LABEL[since] : '';
  pickSince.hidden = !since;
  qbox.classList.toggle('has-since', !!since);
  loadQuery(csv);
}
function chooseQuery(csv) { selectQuery(csv); closeQlist(); pick.blur(); }
// pinta la lista filtrada por el texto tecleado (substring, sin acentos/mayúsculas)
function renderQlist(term) {
  const t = norm(term);
  const hits = allQueries.filter(q => norm(q.label).includes(t));
  qlist.innerHTML = '';
  if (!hits.length) { qlist.innerHTML = '<div class="qempty">sin coincidencias</div>'; qlist.hidden = false; return; }
  for (const q of hits) {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'qrow' + (q.csv === curCsv ? ' cur' : '');
    row.innerHTML = `<span class="qrow-kw"></span><span class="qrow-since">${SINCE_SHORT[q.since]}</span>`;
    row.querySelector('.qrow-kw').textContent = q.kw;   // textContent: a prueba de < & en el término
    row.onclick = () => chooseQuery(q.csv);
    qlist.appendChild(row);
  }
  qlist.hidden = false;
}
const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function openQlist() { renderQlist(pick.value); }
function closeQlist() { qlist.hidden = true; }
pick.onfocus = () => { pick.select(); openQlist(); };   // al enfocar: abre y selecciona para reescribir directo
pick.oninput = () => { pickSince.hidden = true; qbox.classList.remove('has-since'); openQlist(); };   // al teclear para filtrar, oculta el badge
document.addEventListener('pointerdown', e => { if (!qbox.contains(e.target)) closeQlist(); });
pick.addEventListener('keydown', e => { if (e.key === 'Escape') { closeQlist(); pick.blur(); } });
// al elegir perfil, recarga su último CSV del servidor (los sueltos por drag no persisten)
function restoreLastCsv() {
  const last = perfil && localStorage.getItem(lastCsvKey());
  if (!last) return;
  refreshCsvs().then(() => { if (allQueries.some(q => q.csv === last)) selectQuery(last); });
}

// nombre de CSV → partes de la query: "ps4--semana.csv" → {kw:"ps4", since:"semana"}
const SINCE_LABEL = { hora: 'última hora', dia: 'último día', semana: 'última semana', mes: 'último mes' };
const SINCE_SHORT = { '': 'TODO', hora: 'HORA', dia: 'DÍA', semana: 'SEMANA', mes: 'MES' };   // chip compacto de la lista
function queryParts(csv) {
  const base = csv.replace(/\.csv$/, '');
  const i = base.lastIndexOf('--');
  const since = i >= 0 && SINCE_LABEL[base.slice(i + 2)] ? base.slice(i + 2) : '';
  return { kw: (since ? base.slice(0, i) : base).replace(/-/g, ' '), since };
}
function queryLabel(csv) {   // etiqueta legible: "ps4 (última semana)"
  const { kw, since } = queryParts(csv);
  return since ? `${kw} (${SINCE_LABEL[since]})` : kw;
}
console.assert(queryLabel('ps4--semana.csv') === 'ps4 (última semana)'
  && queryLabel('tv-led.csv') === 'tv led'
  && queryLabel('deshumidificador--dia.csv') === 'deshumidificador (último día)', 'queryLabel() roto');

// CSVs que hay en el servidor → items del combobox (kw + ventana temporal, filtrable al escribir)
function refreshCsvs() {
  return fetch('/csvs' + qsPerfil()).then(r => r.json()).then(list => {
    const have = new Set(allQueries.map(q => q.csv));
    for (const c of list) if (!have.has(c)) {
      const { kw, since } = queryParts(c);
      allQueries.push({ csv: c, label: queryLabel(c), kw, since });
    }
    allQueries.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }).catch(() => {});   // sin servidor (file://): solo drag-drop
}
refreshCsvs();

// dispara el scraper y carga el resultado (el servidor cachea: no re-scrapea si es fresco)
// mismo slug que el server (servidor.py slug/csv_name) para sondear el progreso antes de saber el nombre
const csvNameOf = (kw, since) => kw.toLowerCase().split(/\s+/).filter(Boolean).join('-') +
  (since ? '--' + since : '') + '.csv';
// pinta el overlay: n = contador de encontrados (o null al arrancar, sin dato aun)
function setLoading(on, n) {
  const box = $('#loading');
  $('#stat').hidden = on;    // los stats son de la query vieja: ocúltalos mientras se busca
  $('.panel.picker').hidden = on;   // búsqueda activa + exclusiones son de la query vieja: fuera mientras se busca
  if (!on) { box.hidden = true; return; }   // render() recoloca #empty/botón al cargar el CSV
  $('#empty').hidden = true; $('#swipeFab').hidden = true; box.hidden = false;
  $('#loadingCount').textContent = n ? `${n} encontrados` : 'Buscando…';
}
let _timer;
function startTimer() {   // cronómetro de la búsqueda: puede tardar mucho si hay miles de resultados
  const t0 = Date.now();
  const paint = () => { const s = Math.round((Date.now() - t0) / 1000);
    $('#loadingTime').textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
  paint(); clearInterval(_timer); _timer = setInterval(paint, 1000);
}
$('#scrape').onclick = async () => {
  const kw = $('#kw').value.trim();
  if (!kw) return;
  const since = $('#since').value || '';
  const btn = $('#scrape'), txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Buscando…';
  const stop = $('#stopScrape'); stop.hidden = false; stop.textContent = 'parar búsqueda';
  stop.classList.add('link'); stop.onclick = doStop;   // restaura el estilo por si una parada previa se lo quitó
  function doStop() {   // corta el scraper; el /scrape en curso vuelve con el CSV parcial ya escrito
    stop.onclick = null; stop.classList.remove('link'); stop.textContent = 'parando…';
    fetch('/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: csvNameOf(kw, since), perfil: perfil || 'casa' }) }).catch(() => {});
  }
  setLoading(true, null); startTimer();
  const poll = setInterval(async () => {           // el server responde /progress en paralelo al scrape
    try {
      const p = (await (await fetch('/progress' + qsPerfil() + '&csv=' + encodeURIComponent(csvNameOf(kw, since)))).json()).progress;
      if (p) setLoading(true, p);   // el sidecar ya es solo el contador
    } catch {}
  }, 800);
  try {
    const res = await fetch('/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: kw, since: since || null, titleOnly: $('#titleOnly').checked, perfil: perfil || 'casa' }) });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    await refreshCsvs();
    selectQuery(r.csv);
  } catch (e) { snack('No se pudo buscar: ' + e.message, null); }
  finally { clearInterval(poll); clearInterval(_timer); setLoading(false); btn.disabled = false; btn.textContent = txt; }
};
$('#kw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#scrape').click(); });

// ── gestor de búsquedas: vista CRUD sobre los CSV del servidor ──
const searchesView = $('#searchesView'), searchesList = $('#searchesList');
let allSearches = [], searchesQ = '';   // fuente + filtro de texto del gestor
function openManager() {
  searchesView.hidden = false; document.body.style.overflow = 'hidden';
  searchesQ = ''; $('#searchesFilter').value = '';
  renderSearches();
}
function closeManager() { searchesView.hidden = true; document.body.style.overflow = ''; }
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;   // "última semana" → "Última semana"
function renderSearches() {   // relee del servidor y repinta con el filtro actual
  searchesList.innerHTML = '<div class="qempty">cargando…</div>';
  fetch('/searches' + qsPerfil()).then(r => r.json()).then(list => {
    allSearches = list; paintSearches();
  }).catch(() => { searchesList.innerHTML = '<div class="qempty">no se pudo cargar</div>'; });
}
function paintSearches() {
  const q = norm(searchesQ);
  const hits = allSearches.filter(s => norm(queryParts(s.csv).kw).includes(q));
  searchesList.innerHTML = '';
  if (!allSearches.length) { searchesList.innerHTML = '<div class="qempty">no hay búsquedas guardadas</div>'; return; }
  if (!hits.length) { searchesList.innerHTML = '<div class="qempty">nada coincide con el filtro</div>'; return; }
  const nowDays = Date.now() / 86400000;   // para "hace X" a partir del mtime
  for (const s of hits) {
    const { kw, since } = queryParts(s.csv);
    const card = document.createElement('div'); card.className = 'search-card';
    const age = humanAge(Math.max(0, nowDays - s.mtime / 86400));
    card.innerHTML =
      `<div class="sc-top"><span class="sc-kw"></span>` +
      (since ? `<span class="sc-since">${cap(SINCE_LABEL[since])}</span>` : '') + `</div>` +
      `<div class="sc-meta">${s.rows} resultado${s.rows === 1 ? '' : 's'} · ${age}</div>` +
      `<div class="sc-btns">` +
      `<button class="ghost sc-run">${ic('search')} Repetir</button>` +
      `<button class="danger sc-del">${ic('trash')} Borrar</button></div>`;
    card.querySelector('.sc-kw').textContent = kw;   // textContent: a prueba de < & en el término
    card.querySelector('.sc-run').onclick = () => relaunch(kw, since);
    card.querySelector('.sc-del').onclick = () => deleteSearch(s.csv, kw);
    searchesList.appendChild(card);
  }
}
function relaunch(kw, since) {   // rellena el buscador principal; el usuario decide cuándo lanzar
  $('#kw').value = kw; $('#since').value = since || '';
  closeManager(); $('#kw').focus();
}
function deleteSearch(csv, kw) {
  if (!confirm(`¿Borrar la búsqueda "${kw}"? Se pierde el CSV (el estado por perfil se conserva).`)) return;
  fetch('/csv' + qsPerfil() + '&csv=' + encodeURIComponent(csv), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrar: true }) })
    .then(r => r.json()).then(res => {
      if (res.error) return snack(res.error, null);
      afterCsvChange(csv, null); renderSearches();
    }).catch(() => snack('No se pudo borrar', null));
}
// sincroniza el combobox y el dataset abierto tras borrar/renombrar
function afterCsvChange(oldCsv, newCsv) {
  allQueries = []; refreshCsvs();   // el combobox se reconstruye entero (dedup no quita los que ya no están)
  if (curCsv === oldCsv) {
    if (newCsv) { selectQuery(newCsv); if (perfil) localStorage.setItem(lastCsvKey(), newCsv); }
    else { curCsv = null; pick.value = ''; pickSince.hidden = true; qbox.classList.remove('has-since');
      if (perfil) localStorage.removeItem(lastCsvKey());
      headers = []; data = []; sortKeys = []; view = ''; thead.innerHTML = '';   // sin query activa: nada de stats/rebuscar stale
      $('#empty').textContent = 'Busca algo primero'; render(); }
  }
}
$('#manageSearches').onclick = openManager;
$('#searchesX').onclick = closeManager;
$('#searchesFilter').oninput = e => { searchesQ = e.target.value; paintSearches(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !searchesView.hidden) closeManager(); });

// ── perfiles estilo "¿quién está buscando?": tarjetas grandes, color por persona (máx 4) ──
const COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#38D9A9', '#4DABF7', '#9775FA', '#F783AC'];
const chip = $('#perfilChip'), gate = $('#gate');
const avatarEl = $('#perfilAvatar'), opts = $('#perfilOpts');
// ── ajustes: auto-exclusión y umbral "lejos" (por dispositivo, en localStorage) ──
const autoExclEl = $('#autoExclLejos'), lejosKmEl = $('#lejosKm');
autoExclEl.checked = autoExclLejos;
lejosKmEl.value = lejosKm;
autoExclEl.onchange = () => { autoExclLejos = autoExclEl.checked; localStorage.setItem('wp_autoexcllejos', autoExclLejos ? '1' : '0'); render(); };
lejosKmEl.onchange = () => { lejosKm = +lejosKmEl.value || 10; lejosKmEl.value = lejosKm; localStorage.setItem('wp_lejoskm', lejosKm); render(); };
const tiles = $('#tiles'), creator = $('#creator'), swatches = $('#swatches');
let knownPerfiles = [];            // [{name, color}]
let pendingColor = COLORS[0];
let editing = null;                // perfil que se está editando, o null al crear
const initial = n => (n.trim()[0] || '?').toUpperCase();
function hue(n) { let h = 0; for (const c of n) h = (h + c.charCodeAt(0) * 37) % 360; return h; }
const colorOf = p => p.color || `hsl(${hue(p.name)} 85% 72%)`;   // fallback: perfiles viejos sin color
const ink = c => {   // texto legible según luminancia del fondo (sirve para pasteles nuevos y colores viejos oscuros)
  let L;
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); L = (0.299*(n>>16&255) + 0.587*(n>>8&255) + 0.114*(n&255)) / 255; }
  else { L = (parseFloat(c.match(/[\d.]+%/g)?.[1]) || 50) / 100; }   // hsl(): 2º % = lightness
  return L > 0.55 ? '#1A1E1B' : '#F4F6F2';
};
console.assert(ink('#FFD43B') === '#1A1E1B' && ink('#A23B4E') === '#F4F6F2'
  && ink('hsl(200 85% 72%)') === '#1A1E1B', 'ink(): contraste roto');

// pinta el avatar (inicial + color del perfil) y el texto del menú
function renderChip() {
  avatarEl.textContent = perfil ? initial(perfil) : '?';
  chip.textContent = perfil ? 'Cambiar de perfil' : 'Elegir perfil';
}

function setPerfil(name, color, isNew) {
  perfil = name; perfilColor = color;
  localStorage.setItem('wp_perfil', name);
  const found = knownPerfiles.find(p => p.name === name);
  if (found) found.color = color; else knownPerfiles.push({ name, color });
  renderChip();
  closeGate();
  // cambiar de perfil: olvida el combobox y el dataset del perfil anterior (búsquedas aisladas)
  allQueries = []; curCsv = null; pick.value = ''; pickSince.hidden = true; qbox.classList.remove('has-since');
  headers = []; data = []; sortKeys = []; view = ''; thead.innerHTML = '';
  $('#empty').textContent = 'Busca algo primero'; render();
  if (isNew) {                     // persiste ya el perfil vacío con su color
    for (const s of [trash, fav]) s.clear();
    fetch('/estado' + qsPerfil(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trash: [], fav: [], color }) }).catch(() => {});
    refreshCsvs();               // combobox del perfil nuevo (vacío)
  } else { hydrateEstado(); restoreLastCsv(); }
}

function showPicker() {            // fila de tarjetas + tile de añadir (si < 4)
  creator.hidden = true; tiles.hidden = false;
  tiles.innerHTML = '';
  for (const p of knownPerfiles) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tile';
    b.innerHTML = `<span class="edit" title="editar">${ic('pencil')}</span><span class="av" style="background:${colorOf(p)};color:${ink(colorOf(p))}">${initial(p.name)}</span><span class="name"></span>`;
    b.querySelector('.name').textContent = p.name;   // textContent -> a prueba de nombres con < o &
    b.querySelector('.edit').onclick = e => { e.stopPropagation(); showCreator(p); };
    b.onclick = () => setPerfil(p.name, colorOf(p), false);
    tiles.appendChild(b);
  }
  if (knownPerfiles.length < 4) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'tile add';
    add.innerHTML = `<span class="av">+</span><span class="name">Añadir</span>`;
    add.onclick = () => showCreator();
    tiles.appendChild(add);
  }
}
function showCreator(edit) {        // crear (edit=null) o editar un perfil: nombre + color
  editing = edit || null;
  tiles.hidden = true; creator.hidden = false;
  $('#cancelCreate').hidden = !knownPerfiles.length;   // "Volver" solo si hay perfiles a los que volver
  $('#deletePerfil').hidden = !editing;
  $('#saveBtn').textContent = editing ? 'Guardar' : 'Entrar';
  $('#newName').value = editing ? editing.name : '';
  pendingColor = editing ? colorOf(editing) : COLORS[knownPerfiles.length % COLORS.length];
  swatches.innerHTML = '';
  for (const c of COLORS) {
    const s = document.createElement('button');
    s.type = 'button'; s.className = 'swatch' + (c === pendingColor ? ' sel' : '');
    s.style.background = c; s.title = 'color';
    s.onclick = () => { pendingColor = c; swatches.querySelectorAll('.swatch').forEach(x => x.classList.toggle('sel', x === s)); };
    swatches.appendChild(s);
  }
  setTimeout(() => $('#newName').focus(), 50);
}
function openGate(mode) {          // 'first' (obligatorio) | 'switch' (se puede cerrar)
  $('#gateTitle').textContent = mode === 'switch' ? 'Cambiar de perfil' : '¿Quién está buscando?';
  $('#gateX').hidden = mode !== 'switch';
  gate.classList.add('show');
  knownPerfiles.length ? showPicker() : showCreator();   // sin perfiles -> directo a crear
}
function closeGate() { gate.classList.remove('show'); }

$('#creator').onsubmit = e => {
  e.preventDefault();
  const n = $('#newName').value.trim();
  if (!n) return;
  editing ? saveEdit(editing, n, pendingColor) : setPerfil(n, pendingColor, true);
};

// renombrar/recolorear en el servidor y refrescar el selector
function saveEdit(orig, name, color) {
  const wasActive = perfil === orig.name;
  fetch('/perfil?perfil=' + encodeURIComponent(orig.name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nuevo: name, color }) })
    .then(r => r.json()).then(res => {
      if (res.error) return snack(res.error, null);
      if (wasActive) { perfil = res.name; perfilColor = color; localStorage.setItem('wp_perfil', perfil); renderChip(); }
      reloadPicker();
    }).catch(() => snack('No se pudo guardar el perfil', null));
}
function deletePerfil(orig) {
  if (!confirm(`¿Borrar el perfil "${orig.name}"? Se perderá su estado.`)) return;
  const wasActive = perfil === orig.name;
  fetch('/perfil?perfil=' + encodeURIComponent(orig.name), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrar: true }) })
    .then(r => r.json()).then(res => {
      if (res.error) return snack(res.error, null);
      if (wasActive) { perfil = ''; perfilColor = ''; localStorage.removeItem('wp_perfil'); renderChip(); }
      reloadPicker();
    }).catch(() => snack('No se pudo borrar el perfil', null));
}
function reloadPicker() {   // vuelve a leer la lista y repinta las tarjetas
  return fetch('/perfiles').then(r => r.json()).then(list => { knownPerfiles = list; showPicker(); }).catch(showPicker);
}
$('#deletePerfil').onclick = () => editing && deletePerfil(editing);
$('#cancelCreate').onclick = showPicker;
$('#gateX').onclick = closeGate;
chip.onclick = () => { opts.open = false; openGate('switch'); };
avatarEl.onclick = () => openGate('switch');
gate.onclick = e => { if (e.target === gate && !$('#gateX').hidden) closeGate(); };   // backdrop cierra solo en 'switch'
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#gateX').hidden) closeGate(); });

fetch('/perfiles').then(r => r.json()).then(list => {
  knownPerfiles = list;
  const me = perfil && list.find(p => p.name === perfil);
  if (me) setPerfil(me.name, colorOf(me), false);   // dispositivo que ya sabe quién es -> directo
  else { perfil = ''; renderChip(); openGate('first'); }   // sin perfil -> chip vacío + elige/crea
}).catch(() => { perfil ? setPerfil(perfil, `hsl(${hue(perfil)} 42% 40%)`, false) : (renderChip(), openGate('first')); });

// ── modo swipe (tinder): una tarjeta a la vez; arrastra ← descartar / → interesa ──
const swipeView = $('#swipeView'), swipeStage = $('#swipeStage'), swipeCount = $('#swipeCount');
const likeStamp = $('#swLikeStamp'), nopeStamp = $('#swNopeStamp');   // sellos fijos detrás de la tarjeta
let deck = [], di = 0, card = null, undoStack = [];
const col = (r, name) => { const i = headers.indexOf(name); return i >= 0 ? r[i] : ''; };

function openSwipe() {
  deck = filteredRows(); di = 0; undoStack = [];
  if (!deck.length) return snack('No hay nada que revisar con estos filtros.', null);
  swipeView.hidden = false; document.body.style.overflow = 'hidden';
  renderSwExcl(); nextCard();
}
function rebuildDeck() { deck = filteredRows(); di = 0; undoStack = []; nextCard(); }   // re-baraja desde el principio (ya excluye clasificados/vetados); el historial de deshacer deja de ser válido
// chips sutiles de palabras vetadas dentro del swipe; añadir/quitar re-baraja el mazo en vivo
function renderSwExcl() { fillExclChips($('#swExclChips'), () => { rebuildDeck(); renderSwExcl(); }); }
function closeSwipe() { swipeView.hidden = true; $('#swipeMenu').hidden = true; document.body.style.overflow = ''; render(); }

function nextCard() {
  refreshUndo();
  swipeStage.querySelectorAll('.swipe-card, .swipe-done').forEach(e => e.remove());   // conserva los sellos
  likeStamp.style.opacity = nopeStamp.style.opacity = 0; card = null;
  paintSellerBanner();   // candidatos cambian al rechazar cartas dentro del swipe
  const done = di >= deck.length;   // mazo agotado: no hay tarjeta a la que copiar/abrir
  $('#swVer').disabled = $('#swCopy').disabled = done;
  if (done) {
    swipeCount.textContent = '';
    const el = document.createElement('div'); el.className = 'swipe-done';
    el.textContent = '✓ Has rebuscado todo'; swipeStage.appendChild(el);
    return;
  }
  swipeCount.textContent = (di + 1) + ' / ' + deck.length;
  card = buildCard(deck[di]); swipeStage.appendChild(card);
}
function refreshUndo() { $('#swUndo').disabled = !undoStack.length; }

function buildCard(r) {
  const c = document.createElement('div'); c.className = 'swipe-card';
  fillCard(c, r);   // mismo cuerpo que los items de papelera/favoritos
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
  let sx = 0, sy = 0, dx = 0, dy = 0, on = false, axis = 0, t0 = 0;
  root.onpointerdown = e => {
    if (!card || e.target.closest('a,button,input,.seller-banner')) return;   // sin tarjeta o sobre botón/input/banner: nada
    on = true; dx = dy = axis = 0; sx = e.clientX; sy = e.clientY; t0 = e.timeStamp;
    root.setPointerCapture(e.pointerId);
  };
  root.onpointermove = e => {
    if (!on || !card) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!axis) {                                   // eje aún sin decidir: espera intención clara (8px)
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dy) > Math.abs(dx) * 1.4 ? 'y' : 'x';   // ponytail: el swipe manda; solo bloquea a scroll un arrastre claramente vertical

      if (axis === 'x') card.classList.add('grab');
    }
    if (axis !== 'x') return;                       // vertical: deja scrollear la descripción
    e.preventDefault();
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    const t = Math.min(1, Math.abs(dx) / 120);
    likeStamp.style.opacity = dx > 0 ? t : 0; nopeStamp.style.opacity = dx < 0 ? t : 0;
  };
  root.onpointerup = root.onpointercancel = e => {
    if (!on) return; on = false;
    if (axis === 'x' && card) {
      card.classList.remove('grab');
      const d = decide(dx, dx / Math.max(1, e.timeStamp - t0));   // v en px/ms sobre el gesto
      if (d) return fling(d);
      card.style.transform = '';                   // no cuajó: vuelve al centro
    }
    likeStamp.style.opacity = nopeStamp.style.opacity = 0;
  };
}

function fling(dir) {
  const r = deck[di], k = key(r);
  undoStack.push({ di, k, wasFav: fav.has(k), wasTrash: trash.has(k), wasStamp: stamp[k] });   // estado previo para deshacer
  if (dir > 0) { fav.add(k); trash.delete(k); likeStamp.style.opacity = 1; }
  else { trash.add(k); fav.delete(k); nopeStamp.style.opacity = 1; }   // clasifica en un cubo exclusivo; sello a tope
  stampNow(k); save('wp_fav', fav); save('wp_discarded', trash);
  card.style.transition = 'transform .25s ease, opacity .25s ease';
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 20}deg)`; card.style.opacity = 0;
  card = null;   // bloquea doble-decisión mientras vuela
  setTimeout(() => { di++; nextCard(); }, 200);
}
// deshacer el último swipe: restaura el cubo/sello previo del item y vuelve a mostrar su tarjeta
function swUndo() {
  const h = undoStack.pop();
  if (!h) return;
  if (h.wasFav) fav.add(h.k); else fav.delete(h.k);
  if (h.wasTrash) trash.add(h.k); else trash.delete(h.k);
  if (h.wasStamp === undefined) unstamp(h.k);
  else { stamp[h.k] = h.wasStamp; localStorage.setItem('wp_stamp', JSON.stringify(stamp)); }
  save('wp_fav', fav); save('wp_discarded', trash);
  di = h.di; nextCard();   // vuelve a la tarjeta que se había swipeado
}

dragify(swipeView);   // toda la vista es zona de arrastre (no solo la tarjeta)
$('#listFilter').oninput = e => { listQ = e.target.value; render(); };
$('#exclAdd').onkeydown = e => {
  if (e.key !== 'Enter') return;
  if (addExcl(e.target.value)) render();
  e.target.value = '';
};
$('#swExclAdd').onkeydown = e => {
  if (e.key !== 'Enter') return;
  if (addExcl(e.target.value)) rebuildDeck();
  e.target.value = ''; renderSwExcl();
};
$('#listBack').onclick = e => {
  view = ''; $('#empty').textContent = '';
  if (sellerReturn) { sellerReturn = false; listSeller = ''; openSwipe(); swipeMenu.hidden = false; e.stopPropagation(); return; }   // volver justo a donde vino: swipe + ajustes abiertos (frena el "cerrar al tocar fuera")
  render();
};
$('#exportFav').onclick = () => {   // copia los destacados a la vista (título — precio) para pegar en una IA
  const txt = filteredRows().map(r => {
    const p = col(r, 'precio');
    return col(r, 'titulo') + (p ? ` — ${p}€` : '');
  }).join('\n');
  if (!txt) return;
  navigator.clipboard.writeText(txt)
    .then(() => snack(`Copiados ${filteredRows().length} al portapapeles`, null))
    .catch(() => snack('No se pudo copiar', null));
};
// precio exacto: pide a la API el peso real (tramo up_to_kg) de los destacados con envío sin cachear
$('#calcPeso').onclick = async () => {
  const btn = $('#calcPeso');
  const ids = filteredRows()
    .filter(r => col(r, 'envio') === 'True')
    .map(r => col(r, 'id'))
    .filter(id => id && !(id in pesos));   // sin recalcular lo ya conocido (incluye nulos: ítems sin peso)
  if (!ids.length) return snack('Precios ya calculados', null);
  btn.disabled = true; const prev = btn.textContent; btn.textContent = `Calculando ${ids.length}…`;
  try {
    const res = await fetch('/pesos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }) }).then(r => r.json());
    Object.assign(pesos, res);
    localStorage.setItem('wp_pesos', JSON.stringify(pesos));
    render();
    const ok = Object.values(res).filter(v => typeof v === 'number').length;
    snack(ok ? `Precio exacto de ${ok} artículo${ok === 1 ? '' : 's'}` : 'Sin peso disponible', null);
  } catch {
    snack('No se pudo calcular', null);
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
};
$('#swYes').onclick = () => card && fling(1);   // los hints ✓→ / ←✕ también clasifican, no solo el swipe
$('#swNo').onclick = () => card && fling(-1);
$('#swipeFab').onclick = openSwipe;
$('#swipeX').onclick = closeSwipe;
$('#swUndo').onclick = swUndo;
// cog: menú flotante con orden + gestión de vendedores; se cierra al tocar fuera
const swipeMenu = $('#swipeMenu');
$('#swipeCog').onclick = e => { e.stopPropagation(); swipeMenu.hidden = !swipeMenu.hidden; };
document.addEventListener('click', e => {
  if (swipeMenu.hidden) return;
  if (!swipeMenu.contains(e.target) && !$('#swipeCog').contains(e.target)) swipeMenu.hidden = true;
});
$('#swVer').onclick = () => {
  if (di >= deck.length) return;
  const r = deck[di], url = col(r, 'url');
  if (!url) return;
  window.open(url, '_blank');
};
// texto plano de la tarjeta actual (título, precio, ubicación, antigüedad, flags, url, descripción)
function cardText(r) {
  const precio = col(r, 'precio'), km = col(r, 'km'), ciudad = col(r, 'ciudad'), dias = col(r, 'dias');
  const lines = [col(r, 'titulo')];
  lines.push(precio !== '' ? `${precio} €` : '—');
  let where = km !== '' ? `a ${km} km` : '';
  if (ciudad) where += (where ? ' ' : '') + `(${ciudad})`;
  if (where) lines.push(where);
  if (isNum(dias)) lines.push(humanAge(+dias));
  lines.push(col(r, 'envio') === 'True' ? 'Con envío' : 'Sin envío');
  const url = col(r, 'url'); if (url) lines.push(url);
  const desc = col(r, 'descripcion'); if (desc) lines.push('', desc);
  return lines.join('\n');
}
$('#swCopy').onclick = () => {
  if (di >= deck.length) return;
  navigator.clipboard.writeText(cardText(deck[di]))
    .then(() => snack('Datos copiados al portapapeles', null))
    .catch(() => snack('No se pudo copiar', null));
};
// ── ordenar el mazo en vivo (precio ↑ · distancia ↑ · más reciente); reclic invierte ──
let swSortCol = null, swSortDir = 1;
function applySwipeSort(name) {
  const c = headers.indexOf(name); if (c < 0) return;
  if (swSortCol === name) swSortDir = -swSortDir; else { swSortCol = name; swSortDir = 1; }
  sortKeys = [{ col: c, dir: swSortDir }]; paintSortHeaders();
  paintSwipeSort();
  rebuildDeck();   // re-baraja desde el principio con el nuevo orden
}
function paintSwipeSort() {
  document.querySelectorAll('#swipeSort button').forEach(b => {
    const on = b.dataset.sort === swSortCol;
    b.classList.toggle('on', on);
    b.dataset.dir = on ? (swSortDir > 0 ? '▲' : '▼') : '';
  });
}
document.querySelectorAll('#swipeSort button').forEach(b => b.onclick = () => applySwipeSort(b.dataset.sort));
document.addEventListener('keydown', e => {
  if (swipeView.hidden) return;
  if (e.key === 'Escape') closeSwipe();
  else if (e.key === 'ArrowLeft') card && fling(-1);
  else if (e.key === 'ArrowRight') card && fling(1);
});
