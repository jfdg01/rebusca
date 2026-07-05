#!/usr/bin/env python3
"""Scraper de Wallapop via su API interna. Sin dependencias (solo stdlib).

Uso:
    python3 wallapop.py "deshumidificador" --lat 37.7796 --lon -3.7849 -o jaen.csv
    python3 wallapop.py "deshumidificador"          # por defecto: Jaén, a wallapop.csv
"""
import argparse, csv, json, random, sys, time, urllib.parse, urllib.request, urllib.error
from math import radians, sin, cos, asin, sqrt

API = "https://api.wallapop.com/api/v3/search"
HEADERS = {"X-DeviceOS": "0", "User-Agent": "Mozilla/5.0", "Accept": "application/json"}

# Rotacion de IP: lista de proxies "http://user:pass@host:port". Vacia = IP directa.
# Rellenala desde un fichero (--proxies) o pega aqui tus proxies residenciales.
PROXIES = []


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


class Blocked(Exception):
    pass


def _opener():
    """Opener con un proxy al azar de PROXIES (o directo si esta vacia)."""
    if not PROXIES:
        return urllib.request.build_opener()
    px = random.choice(PROXIES)
    return urllib.request.build_opener(urllib.request.ProxyHandler({"http": px, "https": px}))


def get(params, retries=5):
    """GET con reintentos + backoff exponencial. Distingue throttle de bloqueo real."""
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(retries):
        try:
            with _opener().open(req, timeout=20) as r:
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


def search(keywords, lat, lon):
    """Generador: suelta cada PÁGINA de items segun llega, para escribir a disco ya."""
    params = {"keywords": keywords, "latitude": lat, "longitude": lon, "source": "search_box"}
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


FIELDS = ["titulo", "precio", "ciudad", "cp", "km",
          "reservado", "envio", "url", "descripcion"]  # descripcion al final


def row(it, origin):
    loc = it.get("location") or {}
    lat, lon = loc.get("latitude"), loc.get("longitude")
    dist = round(haversine_km(origin[0], origin[1], lat, lon), 1) if lat and lon else ""
    return {
        "titulo": it["title"],
        "precio": it["price"]["amount"],
        "descripcion": " ".join((it.get("description") or "").split()),  # 1 sola linea
        "ciudad": loc.get("city", ""),
        "cp": loc.get("postal_code", ""),
        "km": dist,
        "reservado": it.get("reserved", {}).get("flag", False),
        "envio": it.get("shipping", {}).get("user_allows_shipping", False),
        "url": "https://es.wallapop.com/item/" + it.get("web_slug", ""),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("keywords")
    p.add_argument("--lat", type=float, default=37.7796)   # Jaén
    p.add_argument("--lon", type=float, default=-3.7849)
    p.add_argument("--max-km", type=float, default=None, help="filtra por distancia")
    p.add_argument("-n", "--limit", type=int, default=None, help="corta a N items")
    p.add_argument("--proxies", help="fichero con un proxy por linea (http://user:pass@host:port)")
    p.add_argument("-o", "--out", default=None, help="por defecto: <query>.csv")
    a = p.parse_args()
    if not a.out:
        slug = "-".join(a.keywords.lower().split()) or "wallapop"
        a.out = f"{slug}.csv"

    if a.proxies:
        with open(a.proxies) as f:
            PROXIES.extend(l.strip() for l in f if l.strip() and not l.startswith("#"))
        print(f"{len(PROXIES)} proxies cargados")

    origin = (a.lat, a.lon)
    n = 0
    # Escritura incremental: cada pagina se vuelca y flushea. Si crashea a mitad,
    # el CSV conserva todo lo escrito hasta ese punto.
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        try:
            for page in search(a.keywords, a.lat, a.lon):
                for it in page:
                    r = row(it, origin)
                    if a.max_km is not None and (r["km"] == "" or r["km"] > a.max_km):
                        continue
                    w.writerow(r)
                    n += 1
                    if a.limit and n >= a.limit:
                        raise StopIteration
                f.flush()             # a disco al cerrar cada pagina
        except (StopIteration, KeyboardInterrupt):
            pass                      # corte limpio: lo escrito queda intacto
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
    # ponytail: check runnable sin red — la haversine es la unica logica no trivial
    assert round(haversine_km(37.7796, -3.7849, 38.9785, -3.9097)) == 134, "haversine rota"
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        main()
