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
                  "reservado", "envio", "url", "vendedor", "imagen", "imagenes", "descripcion"];
  const SINCE_TF = { hora: "today", dia: "today", semana: "lastWeek", mes: "lastMonth" };
  const SINCE_DAYS = { hora: 1 / 24, dia: 1, semana: 7, mes: 30 };
  const JAEN = [37.7796, -3.7849];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  // expande una búsqueda booleana OR a ramas (mismo parser que wallapop.py branches)
  const TOK = /\(|\)|"[^"]*"|[^\s()]+/g;
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
      if (t === "(") { const inner = pExpr(); if (peek() === ")") nxt(); return inner; }
      if (t && t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return [t.slice(1, -1).trim()];
      return [t];
    }
    const res = pExpr().map((b) => b.trim()).filter(Boolean);
    return (res.length ? res : [keywords.trim()]).slice(0, 32);
  }

  function row(it, origin) {
    const loc = it.location || {};
    const lat = loc.latitude, lon = loc.longitude;
    const dist = lat && lon ? round1(haversineKm(origin[0], origin[1], lat, lon)) : "";
    const ca = it.created_at;               // epoch ms
    const dias = ca ? round1((Date.now() - ca) / 86400000) : "";
    const tax = it.taxonomy || [];
    return {
      id: it.id || "",
      titulo: deemoji(it.title),
      precio: it.price ? it.price.amount : "",
      categoria: tax.length ? tax[tax.length - 1].name : "",
      descripcion: deemoji(it.description || ""),
      ciudad: loc.city || "",
      cp: loc.postal_code || "",
      km: dist,
      dias: dias,
      reservado: (it.reserved || {}).flag || false,
      envio: (it.shipping || {}).user_allows_shipping || false,
      url: "https://es.wallapop.com/item/" + (it.web_slug || ""),
      vendedor: it.user_id || "",
      imagen: ((it.images || [{}])[0].urls || {}).small || "", // miniatura para la tarjeta
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
      try { res = await fetch(url, { headers: HEADERS, signal }); }
      catch (e) { if (e.name === "AbortError") throw e; await sleep(2 ** a * 1000 + Math.random() * 1000); continue; }
      if (res.ok) return res.json();
      if (res.status === 403) throw new Error("403: bloqueo (DataDome). Baja el ritmo o cambia de red.");
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error("HTTP " + res.status);
      const ra = parseFloat(res.headers.get("Retry-After"));
      await sleep((ra ? ra * 1000 : 2 ** a * 1000) + Math.random() * 1000);
    }
    throw new Error("agotados los reintentos");
  }

  // scrape({keywords, since, titleOnly, lat, lon, onProgress, signal}) -> texto CSV (mismo formato que wallapop.py)
  async function scrape(opts) {
    const { keywords, since = null, titleOnly = false,
            lat = JAEN[0], lon = JAEN[1], onProgress, signal } = opts;
    const orderBy = since ? "newest" : null;
    const tf = since ? SINCE_TF[since] : null;
    const maxDays = since != null ? SINCE_DAYS[since] : null;
    const origin = [lat, lon];
    const seen = new Set();
    const rows = [];
    const finish = () => {
      // ordena por cercanía al terminar (el server siempre lo hace: nunca pasa --max-km)
      rows.sort((a, b) => (a.km === "" ? 1 : 0) - (b.km === "" ? 1 : 0) || (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0));
      return toCSV(rows);
    };
    for (const kw of branches(keywords)) {
      let params = { keywords: kw, latitude: lat, longitude: lon, source: "search_box" };
      if (orderBy) params.order_by = orderBy;
      if (tf) params.time_filter = tf;
      let old = false;
      while (!old) {
        if (signal && signal.aborted) return finish();
        let d;
        try { d = await getJSON(API + "?" + new URLSearchParams(params), signal); }
        catch (e) {
          if (e.name === "AbortError") return finish();
          if (String(e.message).startsWith("403")) break;   // bloqueo: corta esta rama, conserva lo ya recogido
          throw e;
        }
        const items = (((d || {}).data || {}).section || {}).payload;
        for (const it of (items && items.items) || []) {
          const r = row(it, origin);
          if (seen.has(r.id)) continue;
          if (titleOnly && !titleMatches(r.titulo, kw)) continue;
          if (maxDays != null) {
            if (r.dias === "") continue;
            if (r.dias > maxDays) { old = true; break; }      // newest-first: el resto es más viejo
          }
          seen.add(r.id);
          rows.push(r);
          if (onProgress) onProgress(rows.length);
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
