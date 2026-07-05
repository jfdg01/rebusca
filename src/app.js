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

// item de lista compuesto (Destacados/Papelera): precio + ubicación + antigüedad + flags + descripción
function listBody(r) {
  const td = document.createElement('td'); td.className = 'li';
  const add = (cls, txt) => { const e = document.createElement('div'); e.className = cls; e.textContent = txt; td.append(e); return e; };
  const precio = col(r, 'precio'), km = col(r, 'km'), ciudad = col(r, 'ciudad'), dias = col(r, 'dias');

  add('li-title', col(r, 'titulo'));

  const head = document.createElement('div'); head.className = 'li-head';
  const price = document.createElement('span'); price.className = 'li-price';
  price.textContent = precio !== '' ? `${precio} €` : '—'; head.append(price);
  let where = km !== '' ? `a ${km} km` : '';
  if (ciudad) where += (where ? ' ' : '') + `(${ciudad})`;
  if (where) { const w = document.createElement('span'); w.className = 'li-where'; w.textContent = where; head.append(w); }
  td.append(head);

  if (isNum(dias)) add('li-age', humanAge(+dias)).style.color = heat(+dias).fg;
  add('li-flags', `${col(r, 'reservado') === 'True' ? 'Reservado' : 'Sin reserva'} · ${col(r, 'envio') === 'True' ? 'Con envío' : 'Sin envío'}`);

  const desc = col(r, 'descripcion');
  if (desc) add('li-desc', desc);
  return td;
}

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
function filteredRows() {
  let rows = data.filter(r => {
    const k = key(r);
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
  // pantalla dedicada: en modo lista se oculta la búsqueda y sale una barra con título + volver
  $('.brand').hidden = $('.panel').hidden = $('#stat').hidden = listView;
  $('#listHead').hidden = !listView;
  if (listView) $('#listTitle').textContent = view === 'fav' ? 'Destacados' : 'Papelera';
  const hasRows = headers.length && rows.length;
  $('#swipeFab').hidden = !hasRows || listView;         // en modo lista se edita en la tabla, no se hace swipe
  if (!listView && hasRows) $('#swipeFab').textContent = `A REBUSCAR · ${rows.length}`;
  $('#empty').hidden = !!hasRows;
  if (headers.length && !rows.length)
    $('#empty').textContent = view === 'trash' ? 'La papelera está vacía.'
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

// ── fuentes: desplegable de CSVs del servidor (scrapeados o en cache) ──
const pick = $('#pick');
const lastCsvKey = () => 'wp_lastcsv_' + (perfil || 'casa');   // último dataset por persona
pick.onchange = () => {
  if (!pick.value) return;
  fetch(pick.value).then(r => r.text()).then(t => loadCSV(t, pick.value));
  if (perfil) localStorage.setItem(lastCsvKey(), pick.value);
};
// al elegir perfil, recarga su último CSV del servidor (los sueltos por drag no persisten)
function restoreLastCsv() {
  const last = perfil && localStorage.getItem(lastCsvKey());
  if (!last) return;
  refreshCsvs().then(() => {
    if ([...pick.options].some(o => o.value === last)) { pick.value = last; pick.onchange(); }
  });
}

// CSVs que hay en el servidor
function refreshCsvs() {
  return fetch('/csvs').then(r => r.json()).then(list => {
    const have = new Set([...pick.options].map(o => o.value));
    for (const c of list) if (!have.has(c)) pick.add(new Option(c, c));
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
  $('#stat').hidden = !on;   // los stats son de la query vieja: ocúltalos mientras se busca
  if (!on) { box.hidden = true; return; }   // render() recoloca #empty/botón al cargar el CSV
  $('#empty').hidden = true; $('#swipeFab').hidden = true; box.hidden = false;
  $('#loadingCount').textContent = n ? `${n} encontrados` : 'Buscando…';
}
$('#scrape').onclick = async () => {
  const kw = $('#kw').value.trim();
  if (!kw) return;
  const since = $('#since').value || '';
  const btn = $('#scrape'), txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Buscando…';
  setLoading(true, null);
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
    pick.value = r.csv; pick.onchange();
  } catch (e) { snack('No se pudo buscar: ' + e.message, null); }
  finally { clearInterval(poll); setLoading(false); btn.disabled = false; btn.textContent = txt; }
};
$('#kw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#scrape').click(); });

// ── perfiles estilo "¿quién está buscando?": tarjetas grandes, color por persona (máx 4) ──
const COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#38D9A9', '#4DABF7', '#9775FA', '#F783AC'];
const chip = $('#perfilChip'), gate = $('#gate');
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
  chip.classList.toggle('empty', !perfil);
  chip.style.background = perfil ? perfilColor : '';
  chip.style.color = perfil ? ink(perfilColor) : '';
  chip.textContent = perfil || 'Sin perfil';
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
    b.innerHTML = `<span class="edit" title="editar">✎</span><span class="av" style="background:${colorOf(p)};color:${ink(colorOf(p))}">${initial(p.name)}</span><span class="name"></span>`;
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
chip.onclick = () => openGate('switch');
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
  const dias = col(r, 'dias'), hs = isNum(dias) ? heat(+dias) : null;
  const meta = [];
  if (col(r, 'ciudad')) meta.push(escapeHtml(col(r, 'ciudad')));
  if (col(r, 'km') !== '') meta.push(col(r, 'km') + ' km');
  if (hs) meta.push(`<span class="sc-dias" style="color:${hs.fg};background:${hs.bg}">${dias} días</span>`);
  if (col(r, 'envio') === 'True') meta.push('📦 envío');
  if (col(r, 'reservado') === 'True') meta.push('reservado');
  c.innerHTML =
    `<div class="sc-price">${col(r, 'precio')} €</div>` +
    '<div class="sc-title"></div>' +
    `<div class="sc-meta">${meta.join(' · ')}</div>` +
    '<div class="sc-desc"></div>';
  c.querySelector('.sc-title').textContent = col(r, 'titulo');     // textContent: a prueba de < & en el texto
  c.querySelector('.sc-desc').textContent = col(r, 'descripcion');
  return c;
}
const escapeHtml = s => s.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

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
$('#listBack').onclick = () => { view = ''; $('#empty').textContent = ''; render(); };
$('#swipeFab').onclick = openSwipe;
$('#swipeX').onclick = closeSwipe;
$('#swNope').onclick = () => card && fling(-1);
$('#swLike').onclick = () => card && fling(1);
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
