#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve index.html, lista CSVs, persiste el
estado (visto/descartado/favorito) y dispara el scraper (sin cache).

Pensado para correr tras Tailscale (sin auth, solo tus dispositivos lo ven).

    python3 src/servidor.py            # http://0.0.0.0:8000
    python3 src/servidor.py demo       # self-check sin red
"""
import json, os, re, subprocess, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent   # src/
ROOT = HERE.parent                        # raíz del repo
CSV_DIR = ROOT / "csv"         # los CSVs generados viven fuera del código
ESTADOS = ROOT / "estados"     # un JSON por persona: estados/<nombre>.json
PORT = int(os.environ.get("PORT", 8000))


def perfil_slug(name):
    # \w (unicode) conserva acentos y descarta /, ., espacios -> a prueba de path traversal
    return re.sub(r"[^\w-]", "", name or "", flags=re.UNICODE)[:40] or "casa"


def perfil_path(name, base=None):
    return (base or ESTADOS) / f"{perfil_slug(name)}.json"


def perfil_csv_dir(perfil):
    # cada perfil ve solo sus búsquedas: csv/<perfil>/  (aislamiento entre personas)
    return CSV_DIR / perfil_slug(perfil)


def perfil_update(old, data, base=None):
    # CRUD del perfil: borrar, o renombrar/recolorear conservando su estado.
    base = base or ESTADOS
    src = perfil_path(old, base)
    if data.get("borrar"):
        src.unlink(missing_ok=True)
        return {"ok": True}
    state = json.loads(src.read_text()) if src.exists() else {"seen": [], "trash": [], "fav": []}
    if data.get("color"):
        state["color"] = data["color"]
    dst = perfil_path(data.get("nuevo") or old, base)
    if dst != src and dst.exists():
        return {"error": "ya existe un perfil con ese nombre"}
    base.mkdir(exist_ok=True)
    dst.write_text(json.dumps(state))
    if dst != src:
        src.unlink(missing_ok=True)   # renombrado: mueve el estado al nombre nuevo
    return {"ok": True, "name": dst.stem}


def perfiles():
    # cada perfil = {name, color}; color lo guarda el cliente en el propio JSON
    out = []
    if ESTADOS.exists():
        for f in sorted(ESTADOS.glob("*.json")):
            try:
                color = json.loads(f.read_text()).get("color")
            except Exception:
                color = None
            out.append({"name": f.stem, "color": color})
    return out


def stamp_versions(html, mtimes):
    # Añade ?v=<mtime> a href/src de app.css/app.js. El HTML no se cachea (no-cache),
    # pero Cloudflare sí cachea el JS/CSS 4h ignorando el origen; al cambiar la URL en
    # cada deploy, el móvil ve la versión nueva al recargar sin tocar config de Cloudflare.
    for f, v in mtimes.items():
        html = html.replace(f'"{f}"', f'"{f}?v={v}"')
    return html


def searches(base=None):
    # cada búsqueda = un CSV; devuelve nº de filas (sin cabecera) y mtime para la vista de gestión
    base = base or CSV_DIR
    out = []
    if base.exists():
        for f in sorted(base.glob("*.csv")):
            try:
                with f.open() as fh:
                    rows = max(0, sum(1 for _ in fh) - 1)   # -1 = cabecera
            except Exception:
                rows = 0
            out.append({"csv": f.name, "rows": rows, "mtime": int(f.stat().st_mtime)})
    return out


def csv_op(name, data, base=None):
    # CRUD del fichero de búsqueda: borrar, o renombrar (con su sidecar .progress).
    base = base or CSV_DIR
    src = base / Path(name or "").name   # .name: anti-traversal
    if not name or not src.name.endswith(".csv") or not src.exists():
        return {"error": "búsqueda no encontrada"}
    if data.get("borrar"):
        src.unlink(missing_ok=True)
        (base / (src.name + ".progress")).unlink(missing_ok=True)
        return {"ok": True}
    nuevo = Path(data.get("nuevo") or "").name
    if not nuevo.endswith(".csv"):
        return {"error": "nombre inválido"}
    dst = base / nuevo
    if dst == src:
        return {"ok": True, "csv": dst.name}
    if dst.exists():
        return {"error": "ya existe una búsqueda con ese nombre"}
    src.rename(dst)
    prog = base / (src.name + ".progress")
    if prog.exists():
        prog.replace(base / (dst.name + ".progress"))
    return {"ok": True, "csv": dst.name}


def slug(kw):
    return "-".join(kw.lower().split()) or "wallapop"


def csv_name(kw, since):
    return f"{slug(kw)}{'--' + since if since else ''}.csv"


RUNNING = {}   # csv_name -> Popen del scraper en curso, para poder pararlo
STOPPED = set()   # csv_names parados a mano: su returncode != 0 no es fallo, es parada


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(HERE), **k)

    def translate_path(self, path):
        # el código se sirve desde src/; los .csv desde csv/ (sibling). super() ya
        # colapsa '..' y ancla en HERE; .name deja solo el fichero -> sin traversal.
        p = super().translate_path(path)
        return str(CSV_DIR / Path(p).name) if p.endswith(".csv") else p

    def end_headers(self):
        # no-cache = el navegador revalida siempre (If-Modified-Since -> 304 si no cambió).
        # Sin esto, Cloudflare mandaba max-age=14400 y el móvil veía la versión vieja horas.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:                         # ponytail: tope anti-abuso, sube si hace falta
            raise ValueError("body demasiado grande")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            html = (HERE / "index.html").read_text()
            mt = {f: int((HERE / f).stat().st_mtime) for f in ("app.css", "app.js")}
            body = stamp_versions(html, mt).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/csvs":
            perfil = (parse_qs(u.query).get("perfil") or ["casa"])[0]
            d = perfil_csv_dir(perfil)
            return self._json(sorted(p.name for p in d.glob("*.csv")) if d.exists() else [])
        if u.path == "/searches":
            perfil = (parse_qs(u.query).get("perfil") or ["casa"])[0]
            return self._json(searches(perfil_csv_dir(perfil)))
        if u.path == "/csvfile":                       # descarga de un CSV, ya scopeado por perfil
            q = parse_qs(u.query)
            perfil = (q.get("perfil") or ["casa"])[0]
            name = Path((q.get("csv") or [""])[0]).name   # .name: anti-traversal
            f = perfil_csv_dir(perfil) / name
            if not name.endswith(".csv") or not f.exists():
                return self._json({"error": "búsqueda no encontrada"}, 404)
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            # hora del scrape: el front la usa para calcular la edad real de cada anuncio
            self.send_header("Last-Modified", self.date_time_string(int(f.stat().st_mtime)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/perfiles":
            return self._json(perfiles())
        if u.path == "/progress":
            q = parse_qs(u.query)
            perfil = (q.get("perfil") or ["casa"])[0]
            name = Path((q.get("csv") or [""])[0]).name   # .name: anti-traversal
            f = perfil_csv_dir(perfil) / (name + ".progress")
            return self._json({"progress": f.read_text() if f.exists() else ""})
        if u.path == "/estado":
            perfil = (parse_qs(u.query).get("perfil") or ["casa"])[0]
            f = perfil_path(perfil)
            return self._json(json.loads(f.read_text()) if f.exists()
                              else {"seen": [], "trash": [], "fav": []})
        return super().do_GET()                   # sirve *.csv y estáticos (con anti-traversal propio)

    def do_POST(self):
        try:
            u = urlparse(self.path)
            data = self._body()
            if u.path == "/estado":
                perfil = (parse_qs(u.query).get("perfil") or ["casa"])[0]
                ESTADOS.mkdir(exist_ok=True)
                perfil_path(perfil).write_text(json.dumps(data))
                return self._json({"ok": True})
            if u.path == "/perfil":
                perfil = (parse_qs(u.query).get("perfil") or [""])[0]
                res = perfil_update(perfil, data)
                return self._json(res, 400 if res.get("error") else 200)
            if u.path == "/csv":
                q = parse_qs(u.query)
                perfil = (q.get("perfil") or ["casa"])[0]
                name = (q.get("csv") or [""])[0]
                res = csv_op(name, data, perfil_csv_dir(perfil))
                return self._json(res, 400 if res.get("error") else 200)
            if u.path == "/scrape":
                return self._scrape(data)
            if u.path == "/pesos":
                return self._pesos(data.get("ids") or [])
            if u.path == "/stop":
                perfil = data.get("perfil") or "casa"
                name = Path(data.get("csv") or "").name   # .name: anti-traversal
                key = str(perfil_csv_dir(perfil) / name)
                proc = RUNNING.get(key)
                if proc:
                    STOPPED.add(key)   # marca antes de matar: _scrape lo lee al salir
                    proc.terminate()
                return self._json({"ok": bool(proc)})
        except Exception as e:                    # ponytail: 1 handler; el cliente muestra el mensaje
            return self._json({"error": str(e)}, 500)
        self._json({"error": "ruta desconocida"}, 404)

    def _scrape(self, data):
        kw = (data.get("keywords") or "").strip()
        since = data.get("since") or None
        if not kw:
            return self._json({"error": "faltan keywords"}, 400)
        if since and since not in ("hora", "dia", "semana", "mes"):
            return self._json({"error": "since inválido"}, 400)
        cdir = perfil_csv_dir(data.get("perfil") or "casa")   # el CSV va a la carpeta del perfil
        cdir.mkdir(parents=True, exist_ok=True)
        out = cdir / csv_name(kw, since)   # sin cache: cada búsqueda re-scrapea (parar a la mitad no bloquea la siguiente)
        key = str(out)
        cmd = [sys.executable, str(HERE / "wallapop.py"), kw]
        if since:
            cmd += ["--since", since]
        if data.get("titleOnly"):
            cmd += ["--title-only"]
        cmd += ["-o", str(out)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        RUNNING[key] = proc
        try:
            _, err = proc.communicate(timeout=300)
        finally:
            RUNNING.pop(key, None)
        stopped = key in STOPPED
        STOPPED.discard(key)
        if err:                           # throttle/backoff/403 del scraper -> journald (antes se perdian)
            print(err, file=sys.stderr, end="", flush=True)
        if proc.returncode != 0 and not stopped:   # parada a mano no es fallo: el CSV parcial ya está en disco
            return self._json({"error": err[-500:] or "scraper falló"}, 500)
        return self._json({"csv": out.name, "stopped": stopped})

    def _pesos(self, ids):
        """Peso real (tramo up_to_kg) por item, vía el detalle de la API. -> {id: kg|None}.

        Proxy server-side: el browser no puede pegar a api.wallapop.com (CORS/DataDome).
        None = ítem borrado, sin peso, o bloqueo -> el cliente cae al estimado de 5 kg."""
        import random, time, urllib.request
        out = {}
        for iid in list(ids)[:200]:                # ponytail: tope defensivo; una lista de favs no llega
            iid = str(iid)
            if not re.fullmatch(r"[a-zA-Z0-9]+", iid):   # id opaco de Wallapop: alfanumérico
                out[iid] = None
                continue
            try:
                req = urllib.request.Request(
                    "https://api.wallapop.com/api/v3/items/" + iid,
                    headers={"X-DeviceOS": "0", "User-Agent": "Mozilla/5.0",
                             "Accept": "application/json", "Accept-Language": "es-ES"})
                d = json.loads(urllib.request.urlopen(req, timeout=20).read())
                v = ((d.get("type_attributes") or {}).get("up_to_kg") or {}).get("value")
                out[iid] = float(v) if v else None
            except Exception:
                out[iid] = None
            time.sleep(0.25 + random.random() * 0.25)   # jitter anti-DataDome
        return self._json(out)

    def log_message(self, *a):                    # menos ruido: solo POST/errores
        if self.command == "POST":
            super().log_message(*a)


def demo():
    assert slug("Deshumidificador  De Aire") == "deshumidificador-de-aire"
    assert csv_name("cosa", "dia") == "cosa--dia.csv"
    assert csv_name("cosa", None) == "cosa.csv"
    assert perfil_path("../../etc/passwd").name == "etcpasswd.json"   # sin / ni . -> no traversal
    assert perfil_path("").name == "casa.json"                        # default
    assert perfil_path("Mamá").name == "Mamá.json"                    # conserva acentos
    assert perfil_path("../../etc/passwd").parent == ESTADOS          # siempre dentro de estados/
    assert perfil_csv_dir("Javi") == CSV_DIR / "Javi"                 # cada perfil -> su subcarpeta
    assert perfil_csv_dir("../../etc").name == "etc"                  # scope aislado, sin traversal
    assert perfil_csv_dir("") == CSV_DIR / "casa"                     # default
    assert stamp_versions('<link href="app.css"><script src="app.js">', {"app.css": 5, "app.js": 9}) \
        == '<link href="app.css?v=5"><script src="app.js?v=9">'       # cache-busting por mtime
    import tempfile
    d = Path(tempfile.mkdtemp())
    perfil_update("javi", {"color": "#123456"}, d)                    # crear
    assert (d / "javi.json").exists()
    perfil_update("javi", {"nuevo": "javier", "color": "#123456"}, d)  # renombrar
    assert not (d / "javi.json").exists() and (d / "javier.json").exists()
    perfil_update("test", {"color": "#000000"}, d)
    assert perfil_update("javier", {"nuevo": "test"}, d).get("error")  # colisión no pisa
    assert (d / "javier.json").exists()                               # sigue intacto
    perfil_update("javier", {"borrar": True}, d)                      # borrar
    assert not (d / "javier.json").exists()
    # CRUD de búsquedas (CSV)
    (d / "ps4.csv").write_text("a,b\n1,2\n3,4\n")
    assert searches(d) == [{"csv": "ps4.csv", "rows": 2, "mtime": int((d / "ps4.csv").stat().st_mtime)}]
    assert csv_op("../../etc/passwd", {"borrar": True}, d).get("error")   # traversal + no existe
    assert csv_op("ps4.csv", {"nuevo": "ps5.csv"}, d).get("csv") == "ps5.csv"
    assert not (d / "ps4.csv").exists() and (d / "ps5.csv").exists()      # renombrado
    (d / "otra.csv").write_text("x\n")
    assert csv_op("ps5.csv", {"nuevo": "otra.csv"}, d).get("error")       # colisión no pisa
    assert csv_op("ps5.csv", {"borrar": True}, d) == {"ok": True}         # borrar
    assert not (d / "ps5.csv").exists()
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        print(f"Rebusca en http://0.0.0.0:{PORT}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
