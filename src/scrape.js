// scrape.js — scraper de Wallapop EN EL BROWSER. Produce el MISMO CSV que wallapop.py,
// así loadCSV() en app.js lo consume sin cambios. Sin dependencias.
// Corre en browser (window.Rebusca) y en node (module.exports) para el self-check: `node scrape.js demo`.
(function (root) {
  const API = "https://api.wallapop.com/api/v3/search";
  // X-DeviceOS dispara preflight CORS; verificado que Wallapop lo permite (Access-Control-Allow-Headers: x-deviceos).
  // User-Agent/Accept-Language son forbidden headers en el browser (los ignora y pone los suyos); en node sí valen.
  const HEADERS = { "X-DeviceOS": "0", "Accept": "application/json",
                    "Accept-Language": "es-ES", "User-Agent": "Mozilla/5.0" };
  const FIELDS = ["id", "titulo", "precio", "categoria", "ciudad", "cp", "km", "dias",
                  "reservado", "top", "garantia", "reacond",
                  "envio", "url", "vendedor", "imagen", "imagenes", "descripcion"];
  const SINCE_TF = { hora: "today", dia: "today", semana: "lastWeek", mes: "lastMonth" };
  const SINCE_DAYS = { hora: 1 / 24, dia: 1, semana: 7, mes: 30 };
  const JAEN = [37.7796, -3.7849];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ponytail: los empates exactos (x.x5 km) suben, el round() de Python los deja pares. Es la
  // única desviación conocida frente a wallapop.py, y solo cambia una décima de km en la tarjeta.
  const round1 = (x) => Math.round(x * 10) / 10;
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const titleMatches = (title, kw) => {
    const t = norm(title);
    return norm(kw).split(/\s+/).filter(Boolean).every((tok) => t.includes(tok));
  };

  // quita emojis/pictogramas y colapsa los huecos (mismos rangos que wallapop.py _deemoji)
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
  const deemoji = (s) => (s || "").replace(EMOJI, "").split(/\s+/).filter(Boolean).join(" ");

  function haversineKm(lat1, lon1, lat2, lon2) {
    const r = 6371, R = Math.PI / 180;
    const dlat = (lat2 - lat1) * R, dlon = (lon2 - lon1) * R;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dlon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  // La forma de la respuesta de la API es un invariante: si un campo cambia, se pierde en TODAS
  // las filas a la vez. Un aviso por campo y sesión, para no llenar la consola con 60 items.
  const avisados = new Set();
  const avisaForma = (campo, valor) => {
    if (avisados.has(campo)) return;
    avisados.add(campo);
    console.error(`Rebusca: el campo "${campo}" de la API cambió de forma; se pierde en todas las filas. Valor:`, valor);
  };

  // expande una búsqueda booleana OR a ramas (mismo parser que wallapop.py branches)
  const TOK = /\(|\)|"[^"]*"|[^\s()]+/g;
  const MAX_RAMAS = 32; // más ramas = más peticiones de las que Wallapop deja hacer seguidas
  // Único sitio del proyecto donde se lanza en vez de avisar: el error YA tiene receptor (el
  // onclick de Buscar y loadQuery hacen snack("No se pudo buscar: " + e.message)). Lanzar
  // cancela una búsqueda que iba a salir mal igual; no deja la app en blanco.
  function branches(keywords) {
    const toks = keywords.match(TOK) || [];
    let i = 0;
    const peek = () => (i < toks.length ? toks[i] : null);
    const nxt = () => { const t = peek(); i++; return t; };
    const isOr = (t) => t === "|" || (t != null && t.toLowerCase() === "or");
    const isAnd = (t) => t === "&" || (t != null && t.toLowerCase() === "and");
    function pExpr() { let out = pAnd(); while (isOr(peek())) { nxt(); out = out.concat(pAnd()); } return out; }
    function pAnd() {
      let combos = [""], t;
      while ((t = peek()) != null && !isOr(t) && t !== ")") {
        if (isAnd(t)) { nxt(); continue; }
        const alts = pFactor();
        combos = combos.flatMap((c) => alts.map((a) => (c + " " + a).trim()));
      }
      return combos;
    }
    function pFactor() {
      const t = nxt();
      if (t === "(") {
        const inner = pExpr();
        // Antes: `if (peek() === ")") nxt();`. Sin cierre, el paréntesis se tragaba y la
        // búsqueda salía recortada. "(corsair OR seasonic gold" buscaba menos de lo pedido.
        if (peek() !== ")") throw new Error(`falta un paréntesis de cierre en: ${keywords}`);
        nxt();
        return inner;
      }
      if (t && t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return [t.slice(1, -1).trim()];
      return [t];
    }
    const res = pExpr().map((b) => b.trim()).filter(Boolean);
    // Un `)` de más paraba el parser a media expresión y lo que sobraba se tiraba sin error.
    if (i < toks.length) throw new Error(`sobra un paréntesis de cierre en: ${keywords}`);
    if (!res.length) throw new Error(`la búsqueda no tiene ninguna palabra: ${keywords}`);
    // El `.slice(0, 32)` recortaba combinaciones en silencio: el usuario pedía 40 ramas, se
    // buscaban 32, y el resultado parecía completo.
    if (res.length > MAX_RAMAS) throw new Error(`la búsqueda da ${res.length} ramas OR (máximo ${MAX_RAMAS}): acótala`);
    return res;
  }

  // null/ausente = anuncio sin precio, legítimo. Cualquier otra forma = la API cambió.
  function precioDe(it) {
    const p = it.price;
    if (p == null) return "";
    if (typeof p === "object" && p.amount != null) return p.amount;
    return avisaForma("price", p), "";
  }

  function row(it, origin) {
    const loc = it.location || {};
    const lat = loc.latitude, lon = loc.longitude;
    const dist = lat && lon ? round1(haversineKm(origin[0], origin[1], lat, lon)) : "";
    const ca = it.created_at;               // epoch ms
    // Sin comprobar el tipo: un created_at en segundos descartaba TODOS los anuncios por viejos,
    // y uno no numérico daba NaN, que no es "" ni mayor que maxDays -> el filtro de frescura
    // dejaba de filtrar y nadie se enteraba.
    let dias = "";
    if (ca != null && ca !== "") {
      if (typeof ca === "number" && Number.isFinite(ca)) dias = round1((Date.now() - ca) / 86400000);
      else avisaForma("created_at", ca);
    }
    const tax = it.taxonomy || [];
    return {
      id: it.id || "",
      titulo: deemoji(it.title),
      // `it.price ? it.price.amount : ""` daba celda vacía cuando `price` cambiaba de forma, y
      // eso es indistinguible de "este anuncio no tiene precio". El precio es el producto entero.
      precio: precioDe(it),
      categoria: tax.length ? tax[tax.length - 1].name : "",
      descripcion: deemoji(it.description || ""),
      ciudad: loc.city || "",
      cp: loc.postal_code || "",
      km: dist,
      dias: dias,
      reservado: (it.reserved || {}).flag || false,
      // tres señales que la API de búsqueda YA manda (misma forma {flag} que reserved) y que el
      // scraper tiraba: perfil profesional, garantía y reacondicionado. Cero peticiones nuevas.
      top: (it.is_top_profile || {}).flag || false,
      garantia: (it.has_warranty || {}).flag || false,
      reacond: (it.is_refurbished || {}).flag || false,
      envio: (it.shipping || {}).user_allows_shipping || false,
      url: "https://es.wallapop.com/item/" + (it.web_slug || ""),
      vendedor: it.user_id || "",
      // ojo: `images: []` (anuncio sin fotos) es truthy en JS y falsy en Python, así que el
      // `|| [{}]` de wallapop.py aquí no salva: hay que defender también el [0].
      imagen: (((it.images || [])[0] || {}).urls || {}).small || "", // miniatura para la tarjeta
      // todas las fotos (mejor resolución disponible), separadas por espacio, para el PDF/dossier
      imagenes: (it.images || [])
        .map((im) => { const u = im.urls || {}; return u.big || u.large || u.xlarge || u.medium || u.small || ""; })
        .filter(Boolean)
        .join(" "),
    };
  }

  // serializa a CSV igual que python csv (QUOTE_MINIMAL, booleanos True/False, \r\n)
  const qcsv = (v) => {
    const s = v === true ? "True" : v === false ? "False" : v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const toCSV = (rows) =>
    [FIELDS.join(","), ...rows.map((r) => FIELDS.map((f) => qcsv(r[f])).join(","))].join("\r\n") + "\r\n";

  async function getJSON(url, signal) {
    for (let a = 0; a < 5; a++) {                 // backoff ante 429/5xx; 403 = bloqueo -> corta
      let res;
      try {
        res = await fetch(url, { headers: HEADERS, signal });
        // el parseo va DENTRO del try: Wallapop sirve páginas de error con 200, y ese
        // res.json() rechaza. Fuera del try su rechazo se escapaba sin un solo reintento.
        if (res.ok) {
          const d = await res.json();
          // 200 con error blando: params malos (== ValueError de wallapop.py). No se reintenta:
          // en el fallback de "sin items" se colaba como 0 resultados, en silencio.
          if (d && d.status === 400) { const b = new Error("400 de la API (params malos): " + d.message); b.fatal = 1; throw b; }
          return d;
        }
      }
      catch (e) { if (e.name === "AbortError" || e.fatal) throw e; await sleep(2 ** a * 1000 + Math.random() * 1000); continue; }
      if (res.status === 403) throw new Error("403: bloqueo (DataDome). Baja el ritmo o cambia de red.");
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error("HTTP " + res.status);
      const ra = parseFloat(res.headers.get("Retry-After"));
      await sleep((ra ? ra * 1000 : 2 ** a * 1000) + Math.random() * 1000);
    }
    throw new Error("agotados los reintentos");
  }

  // scrape({keywords, since, titleOnly, lat, lon, onProgress, signal}) -> texto CSV (mismo formato que wallapop.py)
  // onProgress(filas, rama, ramas): las ramas OR se piden EN SERIE, así que sin el número de rama
  // el usuario solo ve el reloj subir y no sabe si va por la primera de doce o por la última.
  async function scrape(opts) {
    const { keywords, since = null, titleOnly = false,
            lat = JAEN[0], lon = JAEN[1], onProgress, signal } = opts;
    const orderBy = since ? "newest" : null;
    const tf = since ? SINCE_TF[since] : null;
    const maxDays = since != null ? SINCE_DAYS[since] : null;
    const origin = [lat, lon];
    const seen = new Set();
    const rows = [];
    // Canal único de "este resultado está incompleto". Antes, una rama caída, un 403 de DataDome
    // y un scrape completo daban exactamente el mismo CSV: el llamador no podía distinguirlos y
    // lo cacheaba como definitivo. `scrape()` sigue devolviendo un string, así que nada cambia
    // para quien no mire el diagnóstico.
    const diag = { ramas: 0, ramasRotas: 0, sinId: 0, abortado: false, parcial: false };
    const finish = () => {
      // ordena por cercanía al terminar (el server siempre lo hace: nunca pasa --max-km)
      rows.sort((a, b) => (a.km === "" ? 1 : 0) - (b.km === "" ? 1 : 0) || (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0));
      diag.parcial = diag.ramasRotas > 0 || diag.abortado;
      api.lastScrape = diag;
      if (diag.parcial) console.warn("Rebusca: scrape incompleto", diag);
      if (diag.sinId) console.warn(`Rebusca: ${diag.sinId} anuncios sin id, descartados`);
      return toCSV(rows);
    };
    const ramas = branches(keywords);
    diag.ramas = ramas.length;
    for (const [iRama, kw] of ramas.entries()) {
      const aviso = () => onProgress && onProgress(rows.length, iRama + 1, ramas.length);
      aviso(); // al entrar en la rama: una rama sin resultados también mueve el contador
      let params = { keywords: kw, latitude: lat, longitude: lon, source: "search_box" };
      if (orderBy) params.order_by = orderBy;
      if (tf) params.time_filter = tf;
      let old = false;
      while (!old) {
        if (signal && signal.aborted) { diag.abortado = true; return finish(); }
        let d;
        try { d = await getJSON(API + "?" + new URLSearchParams(params), signal); }
        catch (e) {
          if (e.name === "AbortError") { diag.abortado = true; return finish(); }
          // El `break` era mudo: ni consola, ni contador, ni marca. Con todas las ramas caídas,
          // scrape() resolvía con un CSV de solo cabecera y eso se leía como "no hay nada".
          console.error(`Rebusca: la rama "${kw}" se corta`, e);
          diag.ramasRotas++;
          if (String(e.message).startsWith("403")) break;   // bloqueo: corta esta rama, conserva lo ya recogido
          // `break`, igual que el 403: muere ESTA rama, las siguientes se piden igual. Lo ya
          // recogido no se tira (wallapop.py deja en disco lo que llevara escrito). Sin filas
          // todavía sí sube el error: si no, la caída se vería como "no hay nada".
          if (rows.length) break;
          throw e;
        }
        const items = (((d || {}).data || {}).section || {}).payload;
        for (const it of (items && items.items) || []) {
          const r = row(it, origin);
          // Sin id no hay dedup ni clasificación. Antes caían todos como "duplicados" del
          // primer id vacío, sin contarse: la lista salía corta y nadie sabía por qué.
          if (!r.id) { diag.sinId++; continue; }
          if (seen.has(r.id)) continue;
          if (titleOnly && !titleMatches(r.titulo, kw)) continue;
          if (maxDays != null) {
            if (r.dias === "") continue;
            if (r.dias > maxDays) { old = true; break; }      // newest-first: el resto es más viejo
          }
          seen.add(r.id);
          rows.push(r);
          aviso();
        }
        const np = ((d || {}).meta || {}).next_page;
        if (!np || old) break;
        params = { next_page: np };                            // el cursor ya lleva keywords/lat/lon
        await sleep(500 + Math.random() * 500);                // jitter anti-patrón
      }
    }
    return finish();
  }

  function demo() {
    const a = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
    a(Math.round(haversineKm(37.7796, -3.7849, 38.9785, -3.9097)) === 134, "haversine");
    const it = { id: "abc123", title: "x", price: { amount: 5 }, location: {}, user_id: "sel1",
      images: [{ urls: { small: "http://x/i.jpg", big: "http://x/big1.jpg" } }, { urls: { medium: "http://x/m2.jpg" } }] };
    const r = row(it, [0, 0]);
    a(r.id === "abc123", "id"); a(r.vendedor === "sel1", "vendedor"); a(r.imagen === "http://x/i.jpg", "imagen");
    a(r.imagenes === "http://x/big1.jpg http://x/m2.jpg", "imagenes: todas, mejor res"); // small p/tarjeta, big/medium p/dossier
    a(row({ id: "y", title: "x", price: { amount: 1 }, location: {} }, [0, 0]).imagen === "", "imagen vacía");
    a(row({ id: "y", title: "x", price: { amount: 1 }, location: {} }, [0, 0]).imagenes === "", "imagenes vacía");
    // banderas {flag} de la API: presentes, ausentes y con la clave a null
    const banderas = row({ id: "f", title: "x", location: {}, is_top_profile: { flag: true },
      has_warranty: { flag: false }, is_refurbished: null }, [0, 0]);
    a(banderas.top === true && banderas.garantia === false && banderas.reacond === false, "banderas {flag}");
    a(row({ id: "f", title: "x", location: {} }, [0, 0]).top === false, "bandera ausente -> false");
    a(titleMatches("iPhone 12 azul", "iphone azul"), "titleMatches acentos");
    a(!titleMatches("Funda para móvil", "iphone"), "titleMatches no casa");
    const eq = (x, y, m) => a(JSON.stringify(branches(x)) === JSON.stringify(y), m);
    eq("corsair fuente OR seasonic", ["corsair fuente", "seasonic"], "OR palabra");
    eq("a | b | c", ["a", "b", "c"], "pipe");
    eq("deshumidificador", ["deshumidificador"], "sin OR");
    eq("corsair or seasonic", ["corsair", "seasonic"], "OR minúscula");
    eq("record player OR tocadiscos", ["record player", "tocadiscos"], "OR entre espacios");
    eq("(corsair OR seasonic) gold", ["corsair gold", "seasonic gold"], "grupo distribuye");
    eq("(corsair OR seasonic) AND gold", ["corsair gold", "seasonic gold"], "AND opcional");
    eq("(a OR b) (c OR d)", ["a c", "a d", "b c", "b d"], "producto");
    eq('"be quiet" OR corsair', ["be quiet", "corsair"], "frase comillas");
    eq("corsair OR seasonic gold", ["corsair", "seasonic gold"], "OR liga flojo");
    // lo que antes se recortaba en silencio ahora lanza
    const lanza = (fn, frag, m) => {
      try { fn(); } catch (e) { a(String(e.message).includes(frag), m + " (mensaje: " + e.message + ")"); return; }
      a(false, m + ": no lanzó");
    };
    lanza(() => branches("(corsair OR seasonic gold"), "falta un paréntesis", "paréntesis sin cerrar");
    lanza(() => branches("corsair) gold"), "sobra un paréntesis", "paréntesis de más");
    lanza(() => branches("   "), "ninguna palabra", "búsqueda vacía");
    // ojo: el tokenizador parte por espacios, así que "a|b" es UN token, no un OR
    lanza(() => branches("(a | b | c | d) (e | f | g | h) (i | j | k)"), "máximo 32", "tope de ramas");
    a(branches("(a | b | c | d) (e | f | g | h)").length === 16, "16 ramas sí pasan");
    // forma inesperada de la API: celda vacía, pero con rastro en consola
    a(row({ id: "p", title: "x", price: { amount: 0 }, location: {} }, [0, 0]).precio === 0, "precio 0 no es vacío");
    a(row({ id: "p", title: "x", price: 5, location: {} }, [0, 0]).precio === "", "precio escalar -> vacío");
    a(row({ id: "d", title: "x", location: {}, created_at: "ayer" }, [0, 0]).dias === "", "created_at no numérico -> vacío");
    a(typeof row({ id: "d", title: "x", location: {}, created_at: Date.now() - 86400000 }, [0, 0]).dias === "number", "created_at ms -> número");
    a(deemoji("Aleron 🔥 AMG 🚗💨") === "Aleron AMG", "deemoji colapsa");
    a(deemoji("café ñ 5€ ✅") === "café ñ 5€", "deemoji conserva acentos/€");
    a(deemoji("🇪🇸 España") === "España", "deemoji banderas");
    const csv = toCSV([{ id: "1", titulo: 'a,b "c"', precio: 5, reservado: true, envio: false,
      km: 3, dias: 1, url: "u", vendedor: "v", imagen: "i", categoria: "cat", ciudad: "ci", cp: "cp", descripcion: "d\ne" }]);
    a(csv.startsWith(FIELDS.join(",")), "header CSV");
    a(csv.includes('"a,b ""c"""'), "quoting coma+comilla");
    a(csv.includes('"d\ne"'), "quoting salto de línea");
    a(/,True,/.test(csv) && /,False,/.test(csv), "booleanos True/False");
    console.log("ok");
  }

  const api = { scrape, branches, haversineKm, deemoji, titleMatches, row, toCSV, FIELDS, demo, JAEN };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    if (require.main === module && process.argv[2] === "demo") demo();
  } else {
    root.Rebusca = api;   // browser: window.Rebusca.scrape({...})
  }
})(typeof self !== "undefined" ? self : this);
