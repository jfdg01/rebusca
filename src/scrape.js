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
  // Con frescura "cualquiera" no hay corte por fecha ni por páginas: doce ramas OR son minutos de
  // peticiones y un CSV que no cabe en el móvil. El CLI ya tenía --limit; el browser, nada.
  const MAX_ROWS = 1500;
  // El tope de filas era el único freno, y falla justo cuando las filas no crecen: una API que
  // repite cursor, o un `titleOnly` que descarta página tras página, giran para siempre. Sin
  // frescura `old` no se pone nunca, así que no quedaba ninguna condición local de parada.
  // Mide el AVANCE, no el volumen: un tope de páginas totales no distingue "no avanza" de
  // "avanza despacio", y recortaba búsquedas sanas —medido: `titleOnly` con 4 aciertos de cada
  // 40 perdía 700 anuncios—. Peor aún, el recorte las marcaba parciales, así que no se cacheaban
  // y se re-scrapeaban en cada apertura: 2,3 veces más peticiones que sin freno ninguno.
  // 30 páginas seguidas sin una sola fila nueva son 1200 anuncios sin un acierto; el que avanza
  // despacio pone el contador a cero mucho antes.
  const MAX_PAGINAS_SECAS = 30;

  // El sleep escucha el abort. Sin esto, «parar búsqueda» se quedaba esperando a que la espera
  // en curso se cumpliera: medio segundo en el jitter, hasta 17s en un backoff por 429, o lo
  // que mandara un Retry-After. El signal ya abortado se mira antes de armar el timer, porque
  // addEventListener("abort") no dispara sobre un signal que ya abortó.
  // `once: true` solo retira el listener si el abort llega, y en una búsqueda normal no llega:
  // sin el removeEventListener, cada página dejaba el suyo pegado al signal hasta el final.
  const sleep = (ms, signal) =>
    new Promise((r) => {
      if (signal && signal.aborted) return r();
      if (!signal || !signal.addEventListener) return void setTimeout(r, ms);
      let t; // `let`, y el listener antes del timer: el arnés llama al callback dentro del propio setTimeout
      const fin = () => (clearTimeout(t), signal.removeEventListener("abort", fin), r());
      signal.addEventListener("abort", fin, { once: true });
      t = setTimeout(fin, ms);
    });
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
      // el último intento no duerme: esperar 16 s y rendirse igual es media espera regalada
      const esperar = (ms) => (a < 4 ? sleep(ms, signal) : Promise.resolve());
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
      catch (e) { if (e.name === "AbortError" || e.fatal) throw e; await esperar(2 ** a * 1000 + Math.random() * 1000); continue; }
      if (res.status === 403) throw new Error("403: bloqueo (DataDome). Baja el ritmo o cambia de red.");
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error("HTTP " + res.status);
      // El `Retry-After` sí se respeta en el último intento. No precede a un reintento que no
      // existe, pero sí a la primera petición de la rama siguiente, y es una instrucción del
      // servidor: tirarla es perder funcionalidad. Lo que sobra es la espera exponencial a ciegas.
      // Con techo: el número lo elige el servidor y entraba entero en el `sleep`. Medido, con una
      // rama y cinco intentos: un `Retry-After: 3600` colgaba la barra 300 minutos. 60 s son casi
      // cuatro veces la espera más larga que el backoff propio se permite (`2 ** 4` = 16 s), así
      // que la instrucción se respeta donde es razonable. Por encima, la rama cae en cinco minutos
      // con «agotados los reintentos», el usuario ve el aviso de parcial y busca cuando quiera.
      const ra = parseFloat(res.headers.get("Retry-After"));
      if (ra) await sleep(Math.min(ra, 60) * 1000 + Math.random() * 1000, signal);
      else await esperar(2 ** a * 1000 + Math.random() * 1000);
    }
    throw new Error("agotados los reintentos");
  }

  // scrape({keywords, since, titleOnly, lat, lon, onProgress, signal}) -> texto CSV (mismo formato que wallapop.py)
  // onProgress(filas, rama, ramas): las ramas OR se piden EN SERIE, así que sin el número de rama
  // el usuario solo ve el reloj subir y no sabe si va por la primera de doce o por la última.
  async function scrape(opts) {
    const { keywords, since = null, titleOnly = false,
            lat = JAEN[0], lon = JAEN[1], maxRows = MAX_ROWS, onProgress, signal } = opts;
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
    const diag = { ramas: 0, ramasRotas: 0, ramasTope: 0, sinId: 0, abortado: false, tope: 0,
                   paginas: 0, ramasSecas: 0, bloqueado: false, parcial: false };
    const finish = () => {
      // ordena por cercanía al terminar (el server siempre lo hace: nunca pasa --max-km)
      rows.sort((a, b) => (a.km === "" ? 1 : 0) - (b.km === "" ? 1 : 0) || (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0));
      // `bloqueado` no está en la lista a propósito: solo se pone justo detrás de `ramasRotas++`,
      // así que sumarlo aquí es un término que ningún mutante mata. Con el término quitado los 48
      // checks siguen verdes; eso es lo que se midió, y por eso no vuelve.
      // `ramasSecas` NO entra: los otros cinco motivos son transitorios —un 403, una rama caída, el
      // botón parar—, así que re-scrapear puede traer más y no cachear tiene sentido. Un corte por
      // no avanzar es determinista: la rama volverá a dar las mismas páginas secas. Marcarlo
      // parcial le quitaba el cache y costaba un scrape entero por apertura sin ganar un anuncio
      // —medido: 210 páginas en tres aperturas donde los dos predecesores hacían 200, con los
      // mismos 160 anuncios en pantalla—. El usuario sí se entera: `app.js` avisa igual.
      diag.parcial = diag.ramasRotas > 0 || diag.abortado || diag.tope > 0 || diag.ramasTope > 0;
      api.lastScrape = diag;
      if (diag.parcial) console.warn("Rebusca: scrape incompleto", diag);
      if (diag.sinId) console.warn(`Rebusca: ${diag.sinId} anuncios sin id, descartados`);
      return toCSV(rows);
    };
    const ramas = branches(keywords);
    diag.ramas = ramas.length;
    // Cupo acumulado por rama. El tope se medía solo contra el total, así que la primera rama
    // se lo comía entero y las siguientes no llegaban a pedir ni una página: "iphone OR xiaomi"
    // devolvía 1500 iPhones y cero Xiaomis. El cupo se mide sobre `rows`, no por rama, así que
    // lo que una rama no gasta queda para las de después.
    const cupo = (i) => Math.ceil((maxRows * (i + 1)) / ramas.length);
    for (const [iRama, kw] of ramas.entries()) {
      const aviso = () => onProgress && onProgress(rows.length, iRama + 1, ramas.length);
      aviso(); // al entrar en la rama: una rama sin resultados también mueve el contador
      let params = { keywords: kw, latitude: lat, longitude: lon, source: "search_box" };
      if (orderBy) params.order_by = orderBy;
      if (tf) params.time_filter = tf;
      let old = false, lleno = false;   // `lleno`: esta rama agotó su cupo, se pasa a la siguiente
      let secas = 0;                    // páginas seguidas de ESTA rama que no trajeron ni una fila
      while (!old && !lleno) {
        if (signal && signal.aborted) { diag.abortado = true; return finish(); }
        // Corta la RAMA, no el scrape: una rama sinónima que solo repite lo que ya trajo otra da
        // cero filas nuevas de principio a fin, y las ramas que quedan detrás sí tienen algo que
        // decir. Los tres escenarios sin fin mueren igual: en todos, ninguna página avanza nunca.
        if (secas >= MAX_PAGINAS_SECAS) { diag.ramasSecas++; break; }
        diag.paginas++;
        const antes = rows.length;
        let d;
        try { d = await getJSON(API + "?" + new URLSearchParams(params), signal); }
        catch (e) {
          if (e.name === "AbortError") { diag.abortado = true; return finish(); }
          // El `break` era mudo: ni consola, ni contador, ni marca. Con todas las ramas caídas,
          // scrape() resolvía con un CSV de solo cabecera y eso se leía como "no hay nada".
          console.error(`Rebusca: la rama "${kw}" se corta`, e);
          diag.ramasRotas++;
          // El bloqueo de DataDome no es de una rama: es de esta IP. Seguir pidiendo con el "no"
          // ya puesto solo alarga el castigo, así que corta el scrape entero. Lo ya recogido se
          // conserva —`finish()` devuelve las filas—, y `bloqueado` le dice al llamador qué pasó.
          if (String(e.message).startsWith("403")) { diag.bloqueado = true; return finish(); }
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
          // Tope duro: sin `since` no hay corte por fecha ni por páginas, y doce ramas OR son
          // minutos de peticiones. Sale por el mismo canal que una rama caída (diag.parcial),
          // así que el llamador ya sabe no cachear esto como definitivo.
          if (rows.length >= maxRows) { diag.tope = maxRows; return finish(); }
          if (rows.length >= cupo(iRama)) { diag.ramasTope++; lleno = true; break; }
        }
        secas = rows.length > antes ? 0 : secas + 1;   // una sola fila nueva perdona la racha entera
        const np = ((d || {}).meta || {}).next_page;
        if (!np || old || lleno) break;
        params = { next_page: np };                            // el cursor ya lleva keywords/lat/lon
        await sleep(500 + Math.random() * 500, signal);                // jitter anti-patrón
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
