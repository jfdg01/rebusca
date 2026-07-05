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
const csvCell = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

// ── estado persistente: localStorage (offline) + servidor (compartido) ──
const load = k => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
const save = (k, set) => { localStorage.setItem(k, JSON.stringify([...set])); pushEstado(); };
const seen = load('wp_seen'), trash = load('wp_discarded'), fav = load('wp_fav');
let perfil = localStorage.getItem('wp_perfil') || '';   // quién soy (por dispositivo)
const qsPerfil = () => '?perfil=' + encodeURIComponent(perfil || 'casa');
let _push;   // POST del estado del perfil actual, con debounce
function pushEstado() {
  if (!perfil) return;
  clearTimeout(_push);
  _push = setTimeout(() => fetch('/estado' + qsPerfil(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seen: [...seen], trash: [...trash], fav: [...fav] }) }).catch(() => {}), 400);
}
// carga el estado del perfil actual desde el servidor (fuente de verdad, last-writer-wins)
function hydrateEstado() {
  return fetch('/estado' + qsPerfil()).then(r => r.json()).then(e => {
    for (const [set, arr] of [[seen, e.seen], [trash, e.trash], [fav, e.fav]]) {
      set.clear(); (arr || []).forEach(x => set.add(x));
    }
    localStorage.setItem('wp_seen', JSON.stringify([...seen]));      // espejo offline
    localStorage.setItem('wp_discarded', JSON.stringify([...trash]));
    localStorage.setItem('wp_fav', JSON.stringify([...fav]));
    if (data.length) render();
  }).catch(() => {});   // offline: nos quedamos con lo de localStorage
}

const HIDE = new Set(['cp', 'url']);   // no se muestran como columna (url va en el boton Ver)
const HIDE_CSV = new Set(['cp']);       // no se exportan (la url SÍ, es lo util)
let headers = [], data = [], sortKeys = [], showTrash = false, sourceName = '';  // sortKeys: [{col,dir}] por prioridad
let iUrl = -1, iTitulo = -1, iPrecio = -1, iKm = -1, iEnvio = -1, iReserved = -1;
const isNum = v => v !== '' && !isNaN(v);
const key = r => (iUrl >= 0 && r[iUrl]) || (r[iTitulo] + '|' + r[iPrecio]);

const $ = s => document.querySelector(s);
const thead = $('thead'), tbody = $('tbody');

// firma: hue caliente (hoy) → frío (viejo) segun dias
function heat(d) {
  const t = Math.max(0, Math.min(1, d / 30));
  const h = 14 + (202 - 14) * t;
  return { fg: `hsl(${h} 44% 36%)`, bg: `hsl(${h} 46% 92%)` };
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
function presetSort() {   // tu orden por defecto: tiempo → precio → distancia
  sortKeys = ['dias', 'precio', 'km'].map(h => headers.indexOf(h)).filter(i => i >= 0).map(col => ({ col, dir: 1 }));
  paintSortHeaders(); render();
}
function clearSort() { sortKeys = []; paintSortHeaders(); render(); }

function render() {
  const q = $('#q').value.toLowerCase();
  const pMin = +$('#pmin').value || 0, pMax = +$('#pmax').value || Infinity;
  const kmMax = $('#fkm').value === '' ? Infinity : +$('#fkm').value;
  let rows = data.filter(r => showTrash ? trash.has(key(r)) : !trash.has(key(r)));
  if (q) rows = rows.filter(r => r.some(c => c.toLowerCase().includes(q)));
  if (pMin || pMax !== Infinity) rows = rows.filter(r => { const p = +r[iPrecio]; return p >= pMin && p <= pMax; });
  if (kmMax !== Infinity && iKm >= 0) rows = rows.filter(r => r[iKm] !== '' && +r[iKm] <= kmMax);
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

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const k = key(r);
    const tr = document.createElement('tr');
    if (seen.has(k)) tr.className = 'seen';
    if (fav.has(k)) tr.className = (tr.className + ' fav').trim();
    if (showTrash) tr.className = (tr.className + ' trashed').trim();

    const g = document.createElement('td'); g.className = 'gutter';
    g.innerHTML = '<span class="dot"></span>'; tr.append(g);

    // celda de acciones: Ver y Quitar grandes, uno al lado del otro
    const act = document.createElement('td'); act.className = 'act';
    const url = iUrl >= 0 ? r[iUrl] : '';
    const ver = document.createElement('a'); ver.className = 'btn ver'; ver.textContent = 'Ver';
    if (url) { ver.href = url; ver.target = '_blank'; ver.onclick = () => { seen.add(k); save('wp_seen', seen); tr.classList.add('seen'); paintStat(); }; }
    else { ver.setAttribute('aria-disabled', 'true'); }
    const star = document.createElement('button'); star.className = 'btn star' + (fav.has(k) ? ' on' : '');
    star.textContent = fav.has(k) ? '★' : '☆'; star.title = 'Marcar como interesante';
    star.onclick = () => {
      if (fav.has(k)) fav.delete(k); else fav.add(k);
      save('wp_fav', fav); const on = fav.has(k);
      star.classList.toggle('on', on); star.textContent = on ? '★' : '☆'; tr.classList.toggle('fav', on); paintStat();
    };
    const quit = document.createElement('button'); quit.className = 'btn quitar';
    quit.textContent = showTrash ? 'Restaurar' : 'Quitar';
    quit.onclick = () => (showTrash ? restore(k) : discard(k, r[iTitulo]));
    act.append(ver, star, quit); tr.append(act);

    r.forEach((c, i) => {
      const h = headers[i];
      if (HIDE.has(h)) return;
      const td = document.createElement('td');
      if (h === 'dias' && isNum(c)) {
        td.className = 'heat'; const { fg, bg } = heat(+c); td.style.color = fg; td.style.background = bg; td.textContent = c;
      } else if (h === 'descripcion') { td.className = 'desc'; td.textContent = c; }
      else if (h === 'titulo') { td.className = 'titulo'; td.textContent = c; }
      else { td.textContent = c; if (isNum(c)) td.className = 'num'; }
      tr.append(td);
    });
    frag.append(tr);
  }
  tbody.append(frag);
  $('#empty').hidden = !!headers.length;
  if (headers.length && !rows.length)
    $('#empty').hidden = false, $('#empty').textContent = showTrash ? 'La papelera está vacía.' : 'Nada coincide con el filtro.';
  paintStat();
}

function paintStat() {
  if (!headers.length) { $('#stat').innerHTML = ''; return; }
  const total = data.length, disc = data.filter(r => trash.has(key(r))).length;
  const vistos = data.filter(r => seen.has(key(r))).length;
  const favs = data.filter(r => fav.has(key(r))).length;
  $('#stat').innerHTML =
    `<span><b>${total - disc}</b> a la vista</span>` +
    `<span><b>${vistos}</b> vistos</span>` +
    `<span><b>★ ${favs}</b> interesantes</span>` +
    `<span><b>${disc}</b> descartados ` +
    (disc || showTrash ? `· <span class="link" id="toggleTrash">${showTrash ? 'volver' : 'ver papelera'}</span>` : '') +
    `</span>` +
    (sortKeys.length ? `<span>orden: <b>${sortKeys.map(s => headers[s.col]).join(' › ')}</b> · <span class="link" id="clearSort">limpiar</span></span>` : '');
  const t = $('#toggleTrash');
  if (t) t.onclick = () => { showTrash = !showTrash; $('#empty').textContent = ''; render(); };
  const cs = $('#clearSort');
  if (cs) cs.onclick = clearSort;
}

// ── descartar / restaurar con deshacer claro ──
let snackTimer;
function discard(k, titulo) {
  trash.add(k); save('wp_discarded', trash); render();
  snack(`Descartado: ${(titulo || '').slice(0, 40)}`, () => { trash.delete(k); save('wp_discarded', trash); render(); });
}
function restore(k) {
  trash.delete(k); save('wp_discarded', trash); render();
  snack('Restaurado', () => { trash.add(k); save('wp_discarded', trash); render(); });
}
// quitar en lote todo lo que cumpla pred; el snackbar deshace exactamente ese lote
function bulkDiscard(pred, label) {
  const added = [];
  for (const r of data) { const k = key(r); if (!trash.has(k) && pred(r)) { trash.add(k); added.push(k); } }
  save('wp_discarded', trash); render();
  if (!added.length) { snack('No había ninguno que quitar', null); return; }
  snack(`Quitados ${added.length} (${label})`, () => { added.forEach(k => trash.delete(k)); save('wp_discarded', trash); render(); });
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
  headers = rows[0]; data = rows.slice(1); sortKeys = []; showTrash = false; sourceName = name || '';
  iUrl = headers.indexOf('url'); iTitulo = headers.indexOf('titulo');
  iPrecio = headers.indexOf('precio'); iKm = headers.indexOf('km');
  iEnvio = headers.indexOf('envio'); iReserved = headers.indexOf('reservado');
  if (iTitulo < 0) iTitulo = 0;

  thead.innerHTML = '';
  const tr = document.createElement('tr');
  tr.append(Object.assign(document.createElement('th'), { className: 'gutter' }));
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

// ── descargar la lista de interesantes (★) ──
$('#download').onclick = () => {
  if (!headers.length) return;
  const kept = data.filter(r => fav.has(key(r)));
  if (!kept.length) return alert('No has marcado ningún producto como interesante (★).');
  const vis = headers.map((h, i) => i).filter(i => !HIDE_CSV.has(headers[i]));
  const cols = vis.map(i => headers[i]);
  const lines = [cols.map(csvCell).join(',')];
  for (const r of kept) lines.push(vis.map(i => r[i]).map(csvCell).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (sourceName.replace(/\.csv$/i, '') || 'wallapop') + '-interesantes.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

// ── fuentes: fichero suelto, desplegable, drag de carpeta, indice http ──
$('#file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => loadCSV(r.result, f.name); r.readAsText(f);
};
$('#q').oninput = render;
$('#pmin').oninput = render; $('#pmax').oninput = render; $('#fkm').oninput = render;
$('#preset').onclick = presetSort;
$('#actions').onchange = e => {
  const v = e.target.value; e.target.selectedIndex = 0;
  if (!headers.length) return;
  if (v === 'price') {
    const s = prompt('Quitar todos los productos de precio MAYOR que (€):');
    const x = parseFloat(s); if (s !== null && !isNaN(x)) bulkDiscard(r => +r[iPrecio] > x, `> ${x}€`);
  } else if (v === 'envio') {
    if (iEnvio < 0) return alert('Este CSV no tiene columna de envío.');
    bulkDiscard(r => r[iEnvio] !== 'True', 'sin envío');
  } else if (v === 'reserved') {
    if (iReserved < 0) return alert('Este CSV no tiene columna de reservado.');
    bulkDiscard(r => r[iReserved] === 'True', 'reservados');
  }
};

const dropped = {};
const pick = $('#pick');
pick.onchange = () => {
  if (!pick.value) return;
  const f = dropped[pick.value];
  if (f) { const r = new FileReader(); r.onload = () => loadCSV(r.result, f.name); r.readAsText(f); }
  else fetch(pick.value).then(r => r.text()).then(t => loadCSV(t, pick.value));
};

document.body.ondragover = e => { e.preventDefault(); document.body.classList.add('drag'); };
document.body.ondragleave = e => { if (e.relatedTarget === null) document.body.classList.remove('drag'); };
document.body.ondrop = e => {
  e.preventDefault(); document.body.classList.remove('drag');
  for (const item of e.dataTransfer.items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) walkEntry(entry);
  }
};
function walkEntry(entry) {
  if (entry.isFile && entry.name.toLowerCase().endsWith('.csv')) {
    entry.file(f => { if (!dropped[f.name]) { dropped[f.name] = f; pick.add(new Option(f.name, f.name)); } });
  } else if (entry.isDirectory) {
    entry.createReader().readEntries(list => list.forEach(walkEntry));
  }
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
$('#scrape').onclick = async () => {
  const kw = $('#kw').value.trim();
  if (!kw) return;
  const btn = $('#scrape'), txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const res = await fetch('/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: kw, since: $('#since').value || null }) });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    await refreshCsvs();
    pick.value = r.csv; pick.onchange();
  } catch (e) { snack('No se pudo buscar: ' + e.message, null); }
  finally { btn.disabled = false; btn.textContent = txt; }
};
$('#kw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#scrape').click(); });

// ── perfiles: cada persona (sin contraseña) tiene su visto/descartado/favoritos ──
const chip = $('#perfilChip'), gate = $('#gate'), people = $('#people');
let knownPerfiles = [];
const initial = n => (n.trim()[0] || '?').toUpperCase();
function hue(n) { let h = 0; for (const c of n) h = (h + c.charCodeAt(0) * 37) % 360; return h; }
const iniHtml = n => `<span class="ini" style="background:hsl(${hue(n)} 30% 86%);color:hsl(${hue(n)} 42% 30%)">${initial(n)}</span>`;

function setPerfil(name) {
  perfil = name;
  localStorage.setItem('wp_perfil', name);
  if (!knownPerfiles.includes(name)) knownPerfiles.push(name);
  chip.hidden = false;
  chip.innerHTML = iniHtml(name) + name;
  closeGate();
  hydrateEstado();
}
function openGate(mode) {   // 'first' (obligatorio elegir) | 'switch' (se puede cerrar)
  $('#gateTitle').textContent = mode === 'switch' ? 'Cambiar de perfil' : '¿Quién eres?';
  $('#gateX').hidden = mode !== 'switch';
  people.hidden = !knownPerfiles.length;
  people.innerHTML = '';
  for (const n of knownPerfiles) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'person'; b.innerHTML = iniHtml(n) + n;
    b.onclick = () => setPerfil(n);
    people.appendChild(b);
  }
  gate.classList.add('show');
  if (mode !== 'switch') setTimeout(() => $('#newName').focus(), 50);
}
function closeGate() { gate.classList.remove('show'); }

$('#gateNew').onsubmit = e => {
  e.preventDefault();
  const n = $('#newName').value.trim();
  if (n) { $('#newName').value = ''; setPerfil(n); }
};
$('#gateX').onclick = closeGate;
chip.onclick = () => openGate('switch');
gate.onclick = e => { if (e.target === gate && !$('#gateX').hidden) closeGate(); };   // backdrop solo cierra en 'switch'
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#gateX').hidden) closeGate(); });

fetch('/perfiles').then(r => r.json()).then(list => {
  knownPerfiles = list;
  if (perfil) setPerfil(perfil);   // dispositivo que ya sabe quién es -> directo, sin diálogo
  else openGate('first');          // primera vez aquí -> elige, sin auto-asignar a nadie
}).catch(() => { perfil ? setPerfil(perfil) : openGate('first'); });   // offline
