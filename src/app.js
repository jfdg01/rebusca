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
let perfil = localStorage.getItem('wp_perfil') || '';   // quién soy (por dispositivo)
let perfilColor = '';   // color elegido; se guarda en el JSON para el selector
const qsPerfil = () => '?perfil=' + encodeURIComponent(perfil || 'casa');
let _push;   // POST del estado del perfil actual, con debounce
function pushEstado() {
  if (!perfil) return;
  clearTimeout(_push);
  _push = setTimeout(() => fetch('/estado' + qsPerfil(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trash: [...trash], fav: [...fav], color: perfilColor }) }).catch(() => {}), 400);
}
// carga el estado del perfil actual desde el servidor (fuente de verdad, last-writer-wins)
function hydrateEstado() {
  return fetch('/estado' + qsPerfil()).then(r => r.json()).then(e => {
    for (const [set, arr] of [[trash, e.trash], [fav, e.fav]]) {
      set.clear(); (arr || []).forEach(x => set.add(x));
    }
    for (const k of fav) if (trash.has(k)) fav.delete(k);   // cubos exclusivos: limpia solapes heredados (gana papelera)
    localStorage.setItem('wp_discarded', JSON.stringify([...trash]));   // espejo offline
    localStorage.setItem('wp_fav', JSON.stringify([...fav]));
    if (data.length) render();
  }).catch(() => {});   // offline: nos quedamos con lo de localStorage
}

const HIDE = new Set(['id', 'cp', 'url']);   // no se muestran como columna (url va en el boton Ver)
let headers = [], data = [], sortKeys = [], view = '';  // view: '' mazo | 'trash' papelera | 'fav' interesantes
let iId = -1, iUrl = -1, iTitulo = -1, iPrecio = -1;
const isNum = v => v !== '' && !isNaN(v);
// identidad inmutable: id de Wallapop. Fallback titulo|precio solo para drag de CSV sin id.
const key = r => (iId >= 0 && r[iId]) || (r[iTitulo] + '|' + r[iPrecio]);

const $ = s => document.querySelector(s);
const thead = $('thead'), tbody = $('tbody');
// ── iconos: SVG inline de Lucide (MIT), heredan color con currentColor ──
const ICON = {
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  star: '<path d="M11.5 2.3 8.9 8.6 2.2 9.2c-.9.1-1.2 1.2-.5 1.8l5 4.4-1.5 6.5c-.2.9.7 1.6 1.5 1.1l5.8-3.5 5.8 3.5c.8.5 1.7-.2 1.5-1.1l-1.5-6.5 5-4.4c.7-.6.4-1.7-.5-1.8l-6.7-.6L13 2.3c-.3-.8-1.4-.8-1.7 0Z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};
const ic = n => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = ic(e.dataset.icon));

// firma: hue caliente (hoy) → frío (viejo) segun dias
function heat(d) {
  const t = Math.max(0, Math.min(1, d / 30));
  const h = 14 + (202 - 14) * t;
  return { fg: `hsl(${h} 44% 36%)`, bg: `hsl(${h} 46% 92%)` };
}

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

// tarjeta compuesta (Destacados/Papelera + swipe): precio + ubicación + antigüedad + flags + descripción
function fillCard(el, r) {
  const add = (cls, txt) => { const e = document.createElement('div'); e.className = cls; e.textContent = txt; el.append(e); return e; };
  const precio = col(r, 'precio'), km = col(r, 'km'), ciudad = col(r, 'ciudad'), dias = col(r, 'dias');

  add('li-title', col(r, 'titulo'));

  const head = document.createElement('div'); head.className = 'li-head';
  const price = document.createElement('span'); price.className = 'li-price';
  price.textContent = precio !== '' ? `${precio} €` : '—'; head.append(price);
  let where = km !== '' ? `a ${km} km` : '';
  if (ciudad) where += (where ? ' ' : '') + `(${ciudad})`;
  if (where) { const w = document.createElement('span'); w.className = 'li-where'; w.textContent = where; head.append(w); }
  el.append(head);

  if (isNum(dias)) add('li-age', humanAge(+dias)).style.color = heat(+dias).fg;
  add('li-flags', `${col(r, 'reservado') === 'True' ? 'Reservado' : 'Sin reserva'} · ${col(r, 'envio') === 'True' ? 'Con envío' : 'Sin envío'}`);

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

// filas visibles con el orden actual (compartido por tabla y modo swipe)
let listQ = '';   // filtro de texto de la pantalla de lista (papelera/destacados)
function filteredRows() {
  const q = (view === 'trash' || view === 'fav') ? norm(listQ) : '';   // el filtro solo aplica en vista de lista
  let rows = data.filter(r => {
    const k = key(r);
    if (q && !norm(r[iTitulo] || '').includes(q)) return false;
    if (view === 'trash') return trash.has(k);
    if (view === 'fav') return fav.has(k);
    return !fav.has(k) && !trash.has(k);   // mazo: solo lo aún sin clasificar
  });
  if (sortKeys.length) {
    rows.sort((a, b) => {
      for (const { col, dir } of sortKeys) {
        let x = a[col], y = b[col], c;
        if ((x === '' || isNum(x)) && (y === '' || isNum(y))) {
          x = x === '' ? -Infinity : +x; y = y === '' ? -Infinity : +y; c = x - y;
        } else c = x.localeCompare(y, 'es', { numeric: true });
        if (c) return c * dir;
      }
      return 0;
    });
  }
  return rows;
}

function render() {
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
  $('.brand').hidden = listView;
  document.querySelectorAll('header .panel').forEach(p => p.hidden = listView);   // varios paneles ahora (perfil, buscar, query activa)
  $('#listHead').hidden = !listView;
  if (!listView && listQ) { listQ = ''; $('#listFilter').value = ''; }   // el filtro no sobrevive al salir de la lista
  if (listView) $('#listTitle').textContent = view === 'fav' ? 'Destacados' : 'Papelera';
  const hasRows = headers.length && rows.length;
  $('#swipeFab').hidden = !hasRows || listView;         // en modo lista se edita en la tabla, no se hace swipe
  if (!listView && hasRows) $('#swipeFab').textContent = `A REBUSCAR · ${rows.length}`;
  $('#empty').hidden = !!hasRows;
  if (headers.length && !rows.length)
    $('#empty').textContent = listView && listQ ? 'Nada coincide con el filtro.'
      : view === 'trash' ? 'La papelera está vacía.'
      : view === 'fav' ? 'Sin interesantes todavía.' : 'Nada que revisar.';
  paintStat();
}

function paintStat() {
  if (!headers.length) { $('#stat').innerHTML = ''; return; }
  const favs = data.filter(r => fav.has(key(r))).length;
  const disc = data.filter(r => trash.has(key(r))).length;
  const sinVer = data.length - favs - disc;   // "vistos" = favs + disc, implícito
  $('#stat').innerHTML =
    `<span><b>${sinVer}</b> sin ver</span>` +
    `<span><b>${favs}</b> interesantes ` +
    (favs || view === 'fav' ? `· <span class="link" id="toggleFav">${view === 'fav' ? 'volver' : 'ver lista'}</span>` : '') +
    `</span>` +
    `<span><b>${disc}</b> descartados ` +
    (disc || view === 'trash' ? `· <span class="link" id="toggleTrash">${view === 'trash' ? 'volver' : 'ver papelera'}</span>` : '') +
    `</span>` +
    (sortKeys.length ? `<span>orden: <b>${sortKeys.map(s => headers[s.col]).join(' › ')}</b> · <span class="link" id="clearSort">limpiar</span></span>` : '');
  const toggle = v => () => { view = view === v ? '' : v; $('#empty').textContent = ''; render(); };
  const t = $('#toggleTrash'); if (t) t.onclick = toggle('trash');
  const f = $('#toggleFav'); if (f) f.onclick = toggle('fav');
  const cs = $('#clearSort');
  if (cs) cs.onclick = clearSort;
}

// ── descartar / restaurar con deshacer claro ──
let snackTimer;
function discard(k, titulo) {
  const wasFav = fav.has(k);                 // al descartar sale de interesantes (cubos exclusivos)
  fav.delete(k); trash.add(k); save('wp_fav', fav); save('wp_discarded', trash); render();
  snack(`Descartado: ${(titulo || '').slice(0, 40)}`, () => {
    trash.delete(k); if (wasFav) fav.add(k); save('wp_fav', fav); save('wp_discarded', trash); render();
  });
}
function restore(k) {                          // restaurar = volver a "sin ver"
  trash.delete(k); save('wp_discarded', trash); render();
  snack('Restaurado', () => { trash.add(k); save('wp_discarded', trash); render(); });
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
function loadQuery(csv) {   // carga el CSV y lo recuerda como el último de la persona
  fetch(csv).then(r => r.text()).then(t => loadCSV(t, csv));
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
  return fetch('/csvs').then(r => r.json()).then(list => {
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
      body: JSON.stringify({ csv: csvNameOf(kw, since) }) }).catch(() => {});
  }
  setLoading(true, null); startTimer();
  const poll = setInterval(async () => {           // el server responde /progress en paralelo al scrape
    try {
      const p = (await (await fetch('/progress?csv=' + encodeURIComponent(csvNameOf(kw, since)))).json()).progress;
      if (p) setLoading(true, p);   // el sidecar ya es solo el contador
    } catch {}
  }, 800);
  try {
    const res = await fetch('/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: kw, since: since || null }) });
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
  fetch('/searches').then(r => r.json()).then(list => {
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
      `<button class="ghost sc-ren">${ic('pencil')} Renombrar</button>` +
      `<button class="ghost danger sc-del">${ic('trash')} Borrar</button></div>`;
    card.querySelector('.sc-kw').textContent = kw;   // textContent: a prueba de < & en el término
    card.querySelector('.sc-run').onclick = () => relaunch(kw, since);
    card.querySelector('.sc-ren').onclick = () => renameSearch(s.csv, kw, since);
    card.querySelector('.sc-del').onclick = () => deleteSearch(s.csv, kw);
    searchesList.appendChild(card);
  }
}
function relaunch(kw, since) {   // re-scrapea reusando el flujo del buscador
  $('#kw').value = kw; $('#since').value = since || '';
  closeManager(); $('#scrape').click();
}
function renameSearch(csv, kw, since) {
  const nuevo = prompt('Nuevo nombre de la búsqueda:', kw);
  if (nuevo === null) return;
  const name = nuevo.trim();
  if (!name || name === kw) return;
  fetch('/csv?csv=' + encodeURIComponent(csv), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nuevo: csvNameOf(name, since) }) })
    .then(r => r.json()).then(res => {
      if (res.error) return snack(res.error, null);
      afterCsvChange(csv, res.csv); renderSearches();
    }).catch(() => snack('No se pudo renombrar', null));
}
function deleteSearch(csv, kw) {
  if (!confirm(`¿Borrar la búsqueda "${kw}"? Se pierde el CSV (el estado por perfil se conserva).`)) return;
  fetch('/csv?csv=' + encodeURIComponent(csv), {
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
      if (perfil) localStorage.removeItem(lastCsvKey()); }
  }
}
$('#manageSearches').onclick = openManager;
$('#searchesX').onclick = closeManager;
$('#searchesFilter').oninput = e => { searchesQ = e.target.value; paintSearches(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !searchesView.hidden) closeManager(); });

// ── perfiles estilo "¿quién está buscando?": tarjetas grandes, color por persona (máx 4) ──
const COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#38D9A9', '#4DABF7', '#9775FA', '#F783AC'];
const chip = $('#perfilChip'), gate = $('#gate');
const nameEl = $('#perfilName'), opts = $('#perfilOpts');
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

// pinta el chip: avatar+nombre con perfil, o estado vacío (punteado) si no hay
function renderChip() {
  nameEl.textContent = perfil || 'invitado';
  chip.textContent = perfil ? 'Cambiar de perfil' : 'Elegir perfil';
}

function setPerfil(name, color, isNew) {
  perfil = name; perfilColor = color;
  localStorage.setItem('wp_perfil', name);
  const found = knownPerfiles.find(p => p.name === name);
  if (found) found.color = color; else knownPerfiles.push({ name, color });
  renderChip();
  closeGate();
  if (isNew) {                     // persiste ya el perfil vacío con su color
    for (const s of [trash, fav]) s.clear();
    fetch('/estado' + qsPerfil(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trash: [], fav: [], color }) }).catch(() => {});
    if (data.length) render();
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
let deck = [], di = 0, card = null;
const col = (r, name) => { const i = headers.indexOf(name); return i >= 0 ? r[i] : ''; };

function openSwipe() {
  deck = filteredRows(); di = 0;
  if (!deck.length) return snack('No hay nada que revisar con estos filtros.', null);
  swipeView.hidden = false; document.body.style.overflow = 'hidden';
  nextCard();
}
function closeSwipe() { swipeView.hidden = true; document.body.style.overflow = ''; render(); }

function nextCard() {
  swipeStage.querySelectorAll('.swipe-card, .swipe-done').forEach(e => e.remove());   // conserva los sellos
  likeStamp.style.opacity = nopeStamp.style.opacity = 0; card = null;
  if (di >= deck.length) {   // mazo agotado
    swipeCount.textContent = '';
    const done = document.createElement('div'); done.className = 'swipe-done';
    done.textContent = '✓ Revisado todo'; swipeStage.appendChild(done);
    return;
  }
  swipeCount.textContent = (di + 1) + ' / ' + deck.length;
  card = buildCard(deck[di]); swipeStage.appendChild(card);
}

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
    if (!card || e.target.closest('a,button')) return;   // sin tarjeta (volando/agotado) o sobre un botón: nada
    on = true; dx = dy = axis = 0; sx = e.clientX; sy = e.clientY; t0 = e.timeStamp;
    root.setPointerCapture(e.pointerId);
  };
  root.onpointermove = e => {
    if (!on || !card) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!axis) {                                   // eje aún sin decidir: espera intención clara (8px)
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
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
  if (dir > 0) { fav.add(k); trash.delete(k); likeStamp.style.opacity = 1; }
  else { trash.add(k); fav.delete(k); nopeStamp.style.opacity = 1; }   // clasifica en un cubo exclusivo; sello a tope
  save('wp_fav', fav); save('wp_discarded', trash);
  card.style.transition = 'transform .25s ease, opacity .25s ease';
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 20}deg)`; card.style.opacity = 0;
  card = null;   // bloquea doble-decisión mientras vuela
  setTimeout(() => { di++; nextCard(); }, 200);
}

dragify(swipeView);   // toda la vista es zona de arrastre (no solo la tarjeta)
$('#listFilter').oninput = e => { listQ = e.target.value; render(); };
$('#listBack').onclick = () => { view = ''; $('#empty').textContent = ''; render(); };
$('#swipeFab').onclick = openSwipe;
$('#swipeX').onclick = closeSwipe;
$('#swVer').onclick = () => {
  if (di >= deck.length) return;
  const r = deck[di], url = col(r, 'url');
  if (!url) return;
  window.open(url, '_blank');
};
document.addEventListener('keydown', e => {
  if (swipeView.hidden) return;
  if (e.key === 'Escape') closeSwipe();
  else if (e.key === 'ArrowLeft') card && fling(-1);
  else if (e.key === 'ArrowRight') card && fling(1);
});
