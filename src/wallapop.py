#!/usr/bin/env python3
"""Scraper de Wallapop via su API interna. Sin dependencias (solo stdlib).

Uso:
    python3 wallapop.py "deshumidificador" --lat 37.7796 --lon -3.7849 -o jaen.csv
    python3 wallapop.py "deshumidificador"          # por defecto: Jaén, a wallapop.csv
"""
import argparse, csv, json, random, re, sys, time, unicodedata, urllib.parse, urllib.request, urllib.error
from math import radians, sin, cos, asin, sqrt
from pathlib import Path


def _norm(s):   # minúsculas sin acentos, para comparar título ~ términos
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower())
                   if unicodedata.category(c) != "Mn")


def title_matches(title, keywords):   # todas las palabras del término aparecen en el título
    t = _norm(title)
    return all(tok in t for tok in _norm(keywords).split())


def branches(keywords):
    """Ramas OR: 'corsair fuente OR seasonic' -> ['corsair fuente', 'seasonic'].
    Wallapop no sabe hacer OR en una query, así que cada rama es una búsqueda propia
    (el AND ya lo hace Wallapop dentro de cada rama). Separador: la palabra OR (o |)
    suelta entre espacios, sin distinguir may/min."""
    parts = [p.strip() for p in re.split(r"\s+(?:OR|\|)\s+", keywords, flags=re.I)]
    return [p for p in parts if p] or [keywords.strip()]

API = "https://api.wallapop.com/api/v3/search"
HEADERS = {"X-DeviceOS": "0", "User-Agent": "Mozilla/5.0", "Accept": "application/json",
           "Accept-Language": "es-ES"}   # taxonomía (categoría) en español


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


class Blocked(Exception):
    pass


def get(params, retries=5):
    """GET con reintentos + backoff exponencial. Distingue throttle de bloqueo real."""
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
            d = json.loads(body)
            if isinstance(d, dict) and d.get("status") == 400:
                raise ValueError(f"400 de la API (params malos): {d.get('message')!r}")
            return d
        except urllib.error.HTTPError as e:
            # 429 = throttle, 5xx = fallo pasajero -> reintentar. 403 = DataDome/bloqueo.
            if e.code in (403,):
                raise Blocked("403: bloqueo (DataDome/CloudFront). Cambia IP o baja el ritmo.")
            if e.code not in (429, 500, 502, 503, 504):
                raise
            wait = _retry_after(e) or (2 ** attempt + random.random())
            _warn(f"HTTP {e.code}, reintento {attempt+1}/{retries} en {wait:.1f}s")
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            wait = 2 ** attempt + random.random()
            _warn(f"red/parse {type(e).__name__}, reintento {attempt+1}/{retries} en {wait:.1f}s")
            time.sleep(wait)
    raise Blocked(f"agotados {retries} reintentos")


def _retry_after(e):
    v = e.headers.get("Retry-After") if e.headers else None
    return float(v) if v and v.isdigit() else None


def _warn(msg):
    print("  ! " + msg, file=sys.stderr)


def search(keywords, lat, lon, order_by=None, time_filter=None):
    """Generador: suelta cada PÁGINA de items segun llega, para escribir a disco ya.

    order_by='newest' -> mas reciente primero. time_filter='today'|'lastWeek'|'lastMonth'
    -> el servidor filtra por antiguedad (no hay que paginar todo el catalogo)."""
    params = {"keywords": keywords, "latitude": lat, "longitude": lon, "source": "search_box"}
    if order_by:
        params["order_by"] = order_by       # 'newest' verificado contra v3/search (200, desc por created_at)
    if time_filter:
        params["time_filter"] = time_filter  # 'today'/'lastWeek'/'lastMonth' (solo camelCase)
    while True:
        try:
            d = get(params)
        except Blocked as e:
            _warn(f"parada por bloqueo: {e}")
            return                    # lo ya escrito a disco esta a salvo
        yield d["data"]["section"]["payload"]["items"]
        nxt = d.get("meta", {}).get("next_page")
        if not nxt:
            return
        params = {"next_page": nxt}   # el cursor ya lleva keywords/lat/lon dentro
        time.sleep(0.5 + random.random())   # jitter: menos patron detectable. Sube si te capan


FIELDS = ["id", "titulo", "precio", "categoria", "ciudad", "cp", "km", "dias",
          "reservado", "envio", "url", "vendedor", "imagen", "descripcion"]  # id inmutable primero, descripcion al final


def row(it, origin):
    loc = it.get("location") or {}
    lat, lon = loc.get("latitude"), loc.get("longitude")
    dist = round(haversine_km(origin[0], origin[1], lat, lon), 1) if lat and lon else ""
    ca = it.get("created_at")   # epoch ms; edad del anuncio = senal de "lo bueno ya voló"
    dias = round((time.time() * 1000 - ca) / 86400000, 1) if ca else ""
    tax = it.get("taxonomy") or []   # breadcrumb de categorias; la hoja es la mas especifica
    return {
        "id": it.get("id", ""),   # id inmutable de Wallapop: sobrevive a cambios de titulo/precio/desc
        "titulo": it["title"],
        "precio": it["price"]["amount"],
        "categoria": tax[-1]["name"] if tax else "",
        "descripcion": " ".join((it.get("description") or "").split()),  # 1 sola linea
        "ciudad": loc.get("city", ""),
        "cp": loc.get("postal_code", ""),
        "km": dist,
        "dias": dias,
        "reservado": it.get("reserved", {}).get("flag", False),
        "envio": it.get("shipping", {}).get("user_allows_shipping", False),
        "url": "https://es.wallapop.com/item/" + it.get("web_slug", ""),
        "vendedor": it.get("user_id", ""),   # id opaco del vendedor: estable, sirve de key para bloquear
        "imagen": ((it.get("images") or [{}])[0].get("urls") or {}).get("small", ""),  # thumb W320
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("keywords")
    p.add_argument("--lat", type=float, default=37.7796)   # Jaén
    p.add_argument("--lon", type=float, default=-3.7849)
    p.add_argument("--max-km", type=float, default=None, help="filtra por distancia")
    p.add_argument("--since", choices=["hora", "dia", "semana", "mes"], default=None,
                   help="solo anuncios publicados en la ultima hora/dia/semana/mes")
    p.add_argument("--title-only", action="store_true", help="solo si el término está en el título")
    p.add_argument("-n", "--limit", type=int, default=None, help="corta a N items")
    p.add_argument("-o", "--out", default=None, help="por defecto: <query>.csv")
    a = p.parse_args()
    if not a.out:
        slug = "-".join(a.keywords.lower().split()) or "wallapop"
        a.out = f"{slug}.csv"

    max_dias = {"hora": 1 / 24, "dia": 1, "semana": 7, "mes": 30}.get(a.since)
    # el server filtra por antiguedad; 'hora' no existe alli -> pide 'today' y afinamos en cliente
    time_filter = {"hora": "today", "dia": "today", "semana": "lastWeek", "mes": "lastMonth"}.get(a.since)
    order_by = "newest" if a.since else None   # sin --since dejamos el orden por defecto (luego ordena por km)
    origin = (a.lat, a.lon)
    brs = branches(a.keywords)   # una o varias ramas OR; cada una es una búsqueda de Wallapop
    if len(brs) > 1:
        print(f"búsqueda OR: {len(brs)} ramas -> {brs}", file=sys.stderr)
    seen = set()   # ids ya escritos: dedup al unir las ramas (un anuncio puede salir en varias)
    n = 0
    prog = Path(str(a.out) + ".progress")   # sidecar con el contador de encontrados; el server lo lee en vivo
    # Escritura incremental: cada pagina se vuelca y flushea. Si crashea a mitad,
    # el CSV conserva todo lo escrito hasta ese punto.
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        try:
            for kw in brs:
                for page in search(kw, a.lat, a.lon, order_by, time_filter):
                    old = False
                    for it in page:
                        r = row(it, origin)
                        if r["id"] in seen:
                            continue                  # ya lo trajo otra rama
                        if a.title_only and not title_matches(r["titulo"], kw):
                            continue
                        # nota: los "lejos sin envío" (km>10 && !envio) ya NO se descartan aquí;
                        # se guardan en el CSV y el frontend los oculta por defecto con un toggle.
                        if a.max_km is not None and (r["km"] == "" or r["km"] > a.max_km):
                            continue
                        if max_dias is not None:
                            if r["dias"] == "":
                                continue              # sin fecha: no sabemos si entra
                            if r["dias"] > max_dias:  # newest-first (--since => order_by=newest):
                                old = True             # esta rama ya da anuncios viejos -> a la siguiente
                                break
                        seen.add(r["id"])
                        w.writerow(r)
                        n += 1
                        if a.limit and n >= a.limit:
                            raise StopIteration
                    f.flush()             # a disco al cerrar cada pagina
                    prog.write_text(str(n))
                    if old:
                        break             # corta esta rama, sigue con la siguiente
        except (StopIteration, KeyboardInterrupt):
            pass                      # corte limpio: lo escrito queda intacto
    prog.unlink(missing_ok=True)      # busqueda acabada: fuera el sidecar
    print(f"{n} resultados -> {a.out}")
    if a.max_km is None:             # ordenar por cercania solo si no filtramos ya
        _sort_by_km(a.out)


def _sort_by_km(path):
    """Reordena el CSV por distancia in-place. Solo tras terminar (no arriesga datos)."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    rows.sort(key=lambda r: (r["km"] == "", float(r["km"]) if r["km"] else 0.0))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


def demo():
    # ponytail: check runnable sin red — haversine e id inmutable como clave de estado
    assert round(haversine_km(37.7796, -3.7849, 38.9785, -3.9097)) == 134, "haversine rota"
    it = {"id": "abc123", "title": "x", "price": {"amount": 5}, "location": {},
          "user_id": "sel1", "images": [{"urls": {"small": "http://x/i.jpg"}}]}
    r = row(it, (0, 0))
    assert r["id"] == "abc123", "id no capturado"
    assert r["vendedor"] == "sel1", "vendedor (user_id) no capturado"
    assert r["imagen"] == "http://x/i.jpg", "imagen (thumb) no capturada"
    assert row({"id": "y", "title": "x", "price": {"amount": 1}, "location": {}}, (0, 0))["imagen"] == "", "imagen sin fotos debe ser ''"
    assert title_matches("iPhone 12 azul", "iphone azul"), "title_matches: acentos/orden"
    assert not title_matches("Funda para móvil", "iphone"), "title_matches: no debería casar"
    assert branches("corsair fuente OR seasonic") == ["corsair fuente", "seasonic"], "branches: OR palabra"
    assert branches("a | b | c") == ["a", "b", "c"], "branches: pipe"
    assert branches("deshumidificador") == ["deshumidificador"], "branches: sin OR -> 1 rama"
    assert branches("corsair or seasonic") == ["corsair", "seasonic"], "branches: OR minúscula"
    assert branches("record player OR tocadiscos") == ["record player", "tocadiscos"], "branches: solo OR entre espacios (no dentro de palabra)"
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        main()
