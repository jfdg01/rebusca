// scrape.js — scraper de Wallapop EN EL BROWSER. Es el de producción. Produce un CSV con el
// mismo ESQUEMA DE COLUMNAS que wallapop.py, así loadCSV() en app.js lo consume sin cambios;
// el formato numérico sí difiere (aquí "5", en Python "5.0"). Sin dependencias.
// Corre en browser (window.Rebusca) y en node (module.exports) para el self-check: `node scrape.js demo`.
(function (root) {
  const API = "https://api.wallapop.com/api/v3/search";
  // X-DeviceOS dispara preflight CORS; el preflight de Wallapop REFLEJA la cabecera que se le
  // pide (contesta Access-Control-Allow-Headers: x-deviceos), así que es un eco, no una lista
  // blanca: el día que dejen de reflejar, esto deja de pasar el preflight sin aviso.
  // User-Agent sí es forbidden header en el browser (lo reemplaza por el suyo); en node vale.
  // Accept-Language NO lo es: llega tal cual, y es lo que trae la taxonomía en español.
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
      // `let`, y el listener antes del timer: el arnés de test_scrape.js llama al callback dentro
      // del propio setTimeout, así que con `const t` esto sería un ReferenceError por TDZ.
      let t;
      const fin = () => (clearTimeout(t), signal.removeEventListener("abort", fin), r());
      signal.addEventListener("abort", fin, { once: true });
      t = setTimeout(fin, ms);
    });
  // ponytail: los empates exactos (x.x5 km) suben, el round() de Python los deja pares. Solo
  // cambia una décima de km en la tarjeta.
  // OJO: wallapop.py ya NO va a la par con este fichero, y hace tiempo. Divergencias conocidas:
  // aquí hay MAX_ROWS, cupo por rama y MAX_PAGINAS_SECAS, y allí no; aquí el Retry-After se capa
  // a 60s y allí no; allí existe --max-km y aquí no. Las ramas OR sí van en paralelo en los dos,
  // de cuatro en cuatro. No toques uno esperando que el otro lo siga.
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
  // Ramas OR pidiendo a la vez. Mismo número que el ThreadPoolExecutor de wallapop.py: cuatro
  // conexiones es lo que aguanta DataDome sin devolver un 403, y con las 32 abiertas de golpe
  // el bloqueo es de la IP entera, no de una rama.
  const POOL_RAMAS = 4;
  // Único sitio donde una entrada mal escrita del usuario tumba la búsqueda antes de pedir nada
  // (los demás throw de este fichero son fallos de red o de la API). El error YA tiene receptor (el
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
    // Mismo caso que `created_at`, tres líneas más abajo: `lat && lon` solo mira que sean
    // truthy. Una coordenada de texto daba NaN, y "NaN" no es "" -> la ficha pintaba
    // "a NaN km" y el tope de distancia dejaba de filtrar esa fila sin decirlo. De paso,
    // truthy descartaba el 0: un anuncio en longitud 0 (pasa por Castellón) perdía la distancia.
    const finito = (v) => typeof v === "number" && Number.isFinite(v);
    let dist = "";
    if (lat != null && lon != null) {
      if (finito(lat) && finito(lon)) dist = round1(haversineKm(origin[0], origin[1], lat, lon));
      else avisaForma("location.latitude/longitude", loc);
    }
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
      // `(tax[-1] or {})` en wallapop.py: una taxonomía [null] hacía TypeError aquí dentro
      // del for de items, no lo atrapaba nadie y se llevaba la búsqueda entera por delante.
      categoria: (tax[tax.length - 1] || {}).name || "",
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
    // La causa del último intento. Sin ella, "agotados los reintentos" tapaba por igual un 429,
    // un preflight CORS rechazado (Wallapop revoca X-DeviceOS: la app muere para todos) y un
    // SyntaxError de una página de DataDome servida con 200. Los tres se ven idénticos en la
    // consola y en el snack, y solo el primero se arregla esperando.
    let ultimo = null;
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
      catch (e) { if (e.name === "AbortError" || e.fatal) throw e; ultimo = e; await esperar(2 ** a * 1000 + Math.random() * 1000); continue; }
      if (res.status === 403) throw new Error("403: bloqueo (DataDome). Baja el ritmo o cambia de red.");
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error("HTTP " + res.status);
      ultimo = new Error("HTTP " + res.status);
      // El `Retry-After` sí se respeta en el último intento. No precede a un reintento que no
      // existe, pero sí a la primera petición de la rama siguiente, y es una instrucción del
      // servidor: tirarla es perder funcionalidad. Lo que sobra es la espera exponencial a ciegas.
      // Con techo: el número lo elige el servidor y entraba entero en el `sleep`. Medido, con una
      // rama y cinco intentos: un `Retry-After: 3600` colgaba la barra 300 minutos. Los cuatro
      // intentos que duermen son a=0..3, o sea 1+2+4+8 = 15 s como mucho: 60 s son casi cuatro
      // veces la espera acumulada más larga que el backoff propio se permite, así
      // que la instrucción se respeta donde es razonable. Por encima, la rama cae en cinco minutos
      // con «agotados los reintentos», el usuario ve el aviso de parcial y busca cuando quiera.
      const ra = parseFloat(res.headers.get("Retry-After"));
      if (ra) await sleep(Math.min(ra, 60) * 1000 + Math.random() * 1000, signal);
      else await esperar(2 ** a * 1000 + Math.random() * 1000);
    }
    throw new Error("agotados los reintentos (" + (ultimo ? ultimo.message : "sin causa") + ")", { cause: ultimo });
  }

  // scrape({keywords, since, titleOnly, lat, lon, maxRows, onProgress, signal}) -> texto CSV
  // onProgress(filas, hechas, ramas): `hechas` son las ramas YA TERMINADAS, no la que va — con
  // cuatro en vuelo a la vez no hay "la que va". Sin ese número el usuario solo ve el reloj subir
  // y no sabe si le quedan once ramas o ninguna.
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
      // ordena por cercanía al terminar: aquí no hay filtro por distancia, así que el orden es lo
      // único que acerca lo bueno arriba. (El CLI wallapop.py sí tiene --max-km, y por eso allí
      // solo ordena cuando no se usa.)
      // El desempate por id no es cosmético: con las ramas en paralelo el orden en que llegan las
      // páginas depende de la red, así que sin él dos scrapes de la misma búsqueda daban CSVs
      // distintos (mismo contenido, otro orden) y el diff no servía para nada.
      rows.sort((a, b) => (a.km === "" ? 1 : 0) - (b.km === "" ? 1 : 0) || (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0) ||
                          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // `bloqueado` no está en la lista a propósito: solo se pone justo detrás de `ramasRotas++`,
      // así que sumarlo aquí es un término que ningún mutante mata. Con el término quitado los 48
      // checks siguen verdes; eso es lo que se midió, y por eso no vuelve.
      // `ramasSecas` NO entra: los demás motivos son transitorios —un 403, una rama caída, el
      // botón parar—, así que re-scrapear puede traer más y no cachear tiene sentido. Un corte por
      // no avanzar es determinista: la rama volverá a dar las mismas páginas secas. Marcarlo
      // parcial le quitaba el cache y costaba un scrape entero por apertura sin ganar un anuncio
      // —medido: 210 páginas en tres aperturas donde los dos predecesores hacían 200, con los
      // mismos 160 anuncios en pantalla—. El usuario sí se entera: `app.js` avisa igual.
      // `ramasTope` va de más: con el reparto por rondas una rama solo se queda a medias si algo
      // izó `parar`, y esos tres ya están en la lista. Se queda como red de seguridad barata —lo
      // que cuesta equivocarse aquí es cachear un recorte para siempre—, no como término medido.
      diag.parcial = diag.ramasRotas > 0 || diag.abortado || diag.tope > 0 || diag.ramasTope > 0;
      api.lastScrape = diag;
      if (diag.parcial) console.warn("Rebusca: scrape incompleto", diag);
      if (diag.sinId) console.warn(`Rebusca: ${diag.sinId} anuncios sin id, descartados`);
      return toCSV(rows);
    };
    const ramas = branches(keywords);
    diag.ramas = ramas.length;
    let ultimoFallo = null; // el error de la última rama caída; solo sube si caen todas
    // Lo que antes hacía un `return finish()` desde dentro del bucle. Con las ramas en paralelo
    // no hay un punto único desde el que cortar: la rama que ve el tope, el 403 o el abort iza
    // esta bandera, y las demás la miran antes de pedir la página siguiente y antes de empezar
    // una rama nueva. Lo que ya esté en vuelo se termina de aprovechar.
    let parar = false;
    let hechas = 0;         // ramas terminadas: es lo que puede contar un contador en paralelo
    const aviso = () => onProgress && onProgress(rows.length, hechas, ramas.length);
    // Cupo por rama. El tope se medía solo contra el total, así que la primera rama se lo comía
    // entero y las siguientes no llegaban a pedir ni una página: "iphone OR xiaomi" devolvía
    // 1500 iPhones y cero Xiaomis. Repartirlo de una vez a partes iguales tenía el defecto
    // contrario: la rama gorda se cortaba en 1500/8 aunque las otras siete dejaran sitio de
    // sobra —una búsqueda de 548 anuncios salía recortada y, por parcial, sin cachear—. Así que
    // el reparto va POR RONDAS: la rama que llena su cupo no muere, aparca su cursor y vuelve en
    // la ronda siguiente con lo que las demás no gastaron. Se recorta cuando se acaba el tope
    // global, no antes.
    const paramsDe = (kw) => {
      const p = { keywords: kw, latitude: lat, longitude: lon, source: "search_box" };
      if (orderBy) p.order_by = orderBy;
      if (tf) p.time_filter = tf;
      return p;
    };

    // Devuelve los params con los que reanudar si paró por cupo; nada si la rama terminó.
    async function rama(kw, params, cupo) {
      let old = false, lleno = false;   // `lleno`: esta rama agotó su cupo de la ronda, aparca
      let secas = 0;                    // páginas seguidas de ESTA rama que no trajeron ni una fila
      let mias = 0;                     // filas que ha puesto ESTA rama en ESTA ronda (el cupo va contra esto)
      let reanudar = null;              // la página donde cortó el cupo: la ronda siguiente la repite
      while (!old && !lleno && !parar) {
        if (signal && signal.aborted) { diag.abortado = true; parar = true; return; }
        // Corta la RAMA, no el scrape: una rama sinónima que solo repite lo que ya trajo otra da
        // cero filas nuevas de principio a fin, y las otras ramas sí tienen algo que decir.
        // Los tres escenarios sin fin mueren igual: en todos, ninguna página avanza nunca.
        if (secas >= MAX_PAGINAS_SECAS) { diag.ramasSecas++; return; }
        diag.paginas++;
        const antes = mias;
        const actual = params;   // se guarda ANTES de avanzar el cursor: es la página que aparcaría el cupo
        let d;
        try { d = await getJSON(API + "?" + new URLSearchParams(params), signal); }
        catch (e) {
          if (e.name === "AbortError") { diag.abortado = true; parar = true; return; }
          // El `break` era mudo: ni consola, ni contador, ni marca. Con todas las ramas caídas,
          // scrape() resolvía con un CSV de solo cabecera y eso se leía como "no hay nada".
          console.error(`Rebusca: la rama "${kw}" se corta`, e);
          diag.ramasRotas++;
          // El bloqueo de DataDome no es de una rama: es de esta IP. Seguir pidiendo con el "no"
          // ya puesto solo alarga el castigo, así que corta el scrape entero. Lo ya recogido se
          // conserva —`finish()` devuelve las filas—, y `bloqueado` le dice al llamador qué pasó.
          if (String(e.message).startsWith("403")) { diag.bloqueado = true; parar = true; return; }
          // Igual que el 403: muere ESTA rama, las demás siguen. Lo ya recogido no se tira
          // (wallapop.py deja en disco lo que llevara escrito). El error se guarda y se decide
          // al FINAL: `rows.length` valía 0 siempre en la primera rama, así que "iphone OR
          // xiaomi OR poco" con la red floja al empezar tiraba la búsqueda entera sin llegar a
          // pedir las otras dos. Solo sube el error si cayeron TODAS.
          ultimoFallo = e;
          return;
        }
        // Aquí NO se mira `parar`: una página ya descargada se aprovecha aunque otra rama haya
        // tocado techo mientras tanto. Descartarla tiraba lo recogido por la rama buena cuando la
        // mala se comía un 403, que es justo lo que la versión en serie sí conservaba.
        // El sobre es tan invariante como los campos hoja: `wallapop.py` lo indexa directo y peta
        // si cambia. Aquí el `|| []` lo convertía en cero anuncios con `diag.parcial` en false,
        // o sea una caída total de la API presentada como "no hay resultados" —y cacheada para
        // siempre, porque el cache no caduca—. Rama rota: se avisa y esto no se cachea.
        const items = (((d || {}).data || {}).section || {}).payload;
        if (!items || !Array.isArray(items.items)) {
          avisaForma("data.section.payload.items", d);
          diag.ramasRotas++;
          return;
        }
        for (const it of items.items) {
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
          mias++;
          aviso();
          // Tope duro: sin `since` no hay corte por fecha ni por páginas, y doce ramas OR son
          // minutos de peticiones. Sale por el mismo canal que una rama caída (diag.parcial),
          // así que el llamador ya sabe no cachear esto como definitivo. Con las ramas en
          // paralelo el CSV puede pasarse por una fila por cada rama que tuviera página en vuelo
          // (tres como mucho): tirar esas filas cuesta más de lo que vale cuadrar el número.
          if (rows.length >= maxRows) { diag.tope = maxRows; parar = true; return; }
          // El cupo corta a mitad de página, así que la ronda siguiente REPITE esta página en vez
          // de saltar al cursor: lo ya recogido lo tira `seen` y la cola de la página no se pierde.
          // Cuesta una petición repetida por rama aparcada; perder anuncios cuesta más.
          if (mias >= cupo) { reanudar = actual; lleno = true; break; }
        }
        secas = mias > antes ? 0 : secas + 1;   // una sola fila nueva perdona la racha entera
        const np = ((d || {}).meta || {}).next_page;
        if (!np || old || lleno) return reanudar;
        params = { next_page: np };                            // el cursor ya lleva keywords/lat/lon
        await sleep(500 + Math.random() * 500, signal);                // jitter anti-patrón
      }
      return reanudar;
    }

    // Cuatro ramas a la vez, el mismo tope que wallapop.py: doce ramas en serie son doce esperas
    // encadenadas (medio segundo de jitter por página, más los backoff), y abrir las 32 de golpe
    // es pedirle a DataDome un 403. Cada obrero coge la siguiente rama libre; el reparto sale
    // solo, sin trocear la lista por adelantado.
    // Rondas: la primera lleva todas las ramas; las siguientes, solo las que aparcaron por cupo.
    // Termina siempre — cada rama de una ronda o acaba (sale de la cola) o pone al menos `cupo`
    // filas (>= 1), así que o la cola encoge o `rows` crece hasta el tope y `parar` corta.
    let cola = ramas.map((kw) => ({ kw, params: paramsDe(kw) }));
    while (cola.length && !parar) {
      const ronda = cola;
      cola = [];
      // Lo que queda del tope, repartido entre las ramas vivas: las que ya terminaron dejan su
      // parte a las que no, así que el cupo sube en cada ronda.
      const cupo = Math.max(1, Math.ceil((maxRows - rows.length) / ronda.length));
      let siguiente = 0;
      const obrero = async () => {
        while (siguiente < ronda.length && !parar) {
          const t = ronda[siguiente++];
          aviso();  // al entrar en la rama: una rama sin resultados también mueve el contador
          const reanudar = await rama(t.kw, t.params, cupo);
          if (reanudar) cola.push({ kw: t.kw, params: reanudar });
          else hechas++;   // solo cuenta la rama TERMINADA: la que aparca vuelve en la ronda siguiente
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL_RAMAS, ronda.length) }, obrero));
    }
    // Ramas que se quedaron a medias. Con el reparto por rondas esto solo pasa si `parar` cortó
    // la fiesta (tope global, 403 o botón parar), y los tres marcan parcial por su cuenta.
    diag.ramasTope = cola.length;
    // Todas las ramas caídas y ni una fila: eso no es "no hay anuncios", es que no se pudo
    // buscar, y el llamador tiene que verlo como error. Con una sola rama en pie se devuelve
    // lo que haya, marcado parcial.
    if (ultimoFallo && diag.ramasRotas === diag.ramas && !rows.length) throw ultimoFallo;
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
    // el caso que se llamaba "acentos" comparaba "iPhone 12 azul" con "iphone azul": ni un acento
    // en ninguno de los dos, así que el NFD de norm() no lo defendía nadie
    a(titleMatches("Sillón de diseño", "sillon diseno"), "titleMatches acentos");
    a(titleMatches("iPhone 12 azul", "iphone azul"), "titleMatches mayúsculas");
    // TODAS las palabras, no una: con `some` en vez de `every`, "iphone azul" casaría esta funda
    a(!titleMatches("Funda iPhone gris", "iphone azul"), "titleMatches exige todas las palabras");
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
    // una hoja nula en el breadcrumb tumbaba row(), y row() corre dentro del for de items
    a(row({ id: "t", title: "x", location: {}, taxonomy: [null] }, [0, 0]).categoria === "", "taxonomy [null] -> vacío");
    a(row({ id: "t", title: "x", location: {}, taxonomy: [{ name: "Coches" }, {}] }, [0, 0]).categoria === "", "hoja sin name -> vacío");
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
