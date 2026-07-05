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


def perfil_path(name, base=None):
    # \w (unicode) conserva acentos y descarta /, ., espacios -> a prueba de path traversal
    slug = re.sub(r"[^\w-]", "", name or "", flags=re.UNICODE)[:40] or "casa"
    return (base or ESTADOS) / f"{slug}.json"


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
            return self._json(sorted(p.name for p in CSV_DIR.glob("*.csv")))
        if u.path == "/perfiles":
            return self._json(perfiles())
        if u.path == "/progress":
            name = Path((parse_qs(u.query).get("csv") or [""])[0]).name   # .name: anti-traversal
            f = CSV_DIR / (name + ".progress")
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
            if u.path == "/scrape":
                return self._scrape(data)
            if u.path == "/stop":
                name = Path(data.get("csv") or "").name   # .name: anti-traversal
                proc = RUNNING.get(name)
                if proc:
                    STOPPED.add(name)   # marca antes de matar: _scrape lo lee al salir
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
        CSV_DIR.mkdir(parents=True, exist_ok=True)
        out = CSV_DIR / csv_name(kw, since)   # sin cache: cada búsqueda re-scrapea (parar a la mitad no bloquea la siguiente)
        cmd = [sys.executable, str(HERE / "wallapop.py"), kw]
        if since:
            cmd += ["--since", since]
        cmd += ["-o", str(out)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        RUNNING[out.name] = proc
        try:
            _, err = proc.communicate(timeout=300)
        finally:
            RUNNING.pop(out.name, None)
        stopped = out.name in STOPPED
        STOPPED.discard(out.name)
        if err:                           # throttle/backoff/403 del scraper -> journald (antes se perdian)
            print(err, file=sys.stderr, end="", flush=True)
        if proc.returncode != 0 and not stopped:   # parada a mano no es fallo: el CSV parcial ya está en disco
            return self._json({"error": err[-500:] or "scraper falló"}, 500)
        return self._json({"csv": out.name, "stopped": stopped})

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
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        print(f"Rebusca en http://0.0.0.0:{PORT}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
