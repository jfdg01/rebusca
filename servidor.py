#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve ver.html, lista CSVs, persiste el
estado (visto/descartado/favorito) y dispara el scraper con cache por mtime.

Pensado para correr tras Tailscale (sin auth, solo tus dispositivos lo ven).

    python3 servidor.py            # http://0.0.0.0:8000
    python3 servidor.py demo       # self-check sin red
"""
import json, os, re, subprocess, sys, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
ESTADOS = HERE / "estados"     # un JSON por persona: estados/<nombre>.json
TTL = 30 * 60          # cache: no re-scrapea si el CSV tiene < 30 min
PORT = int(os.environ.get("PORT", 8000))


def perfil_path(name):
    # \w (unicode) conserva acentos y descarta /, ., espacios -> a prueba de path traversal
    slug = re.sub(r"[^\w-]", "", name or "", flags=re.UNICODE)[:40] or "casa"
    return ESTADOS / f"{slug}.json"


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


def fresh(path):
    return path.exists() and (time.time() - path.stat().st_mtime) < TTL


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(HERE), **k)

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
            html = (HERE / "ver.html").read_text()
            mt = {f: int((HERE / f).stat().st_mtime) for f in ("app.css", "app.js")}
            body = stamp_versions(html, mt).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/csvs":
            return self._json(sorted(p.name for p in HERE.glob("*.csv")))
        if u.path == "/perfiles":
            return self._json(perfiles())
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
            if u.path == "/scrape":
                return self._scrape(data)
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
        out = HERE / csv_name(kw, since)
        if fresh(out):
            return self._json({"csv": out.name, "cached": True})
        cmd = [sys.executable, str(HERE / "wallapop.py"), kw]
        if since:
            cmd += ["--since", since]
        cmd += ["-o", str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return self._json({"error": r.stderr[-500:] or "scraper falló"}, 500)
        return self._json({"csv": out.name, "cached": False})

    def log_message(self, *a):                    # menos ruido: solo POST/errores
        if self.command == "POST":
            super().log_message(*a)


def demo():
    assert slug("Deshumidificador  De Aire") == "deshumidificador-de-aire"
    assert csv_name("cosa", "dia") == "cosa--dia.csv"
    assert csv_name("cosa", None) == "cosa.csv"
    assert fresh(Path("/no/existe.csv")) is False
    assert perfil_path("../../etc/passwd").name == "etcpasswd.json"   # sin / ni . -> no traversal
    assert perfil_path("").name == "casa.json"                        # default
    assert perfil_path("Mamá").name == "Mamá.json"                    # conserva acentos
    assert perfil_path("../../etc/passwd").parent == ESTADOS          # siempre dentro de estados/
    assert stamp_versions('<link href="app.css"><script src="app.js">', {"app.css": 5, "app.js": 9}) \
        == '<link href="app.css?v=5"><script src="app.js?v=9">'       # cache-busting por mtime
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        print(f"Rebusca en http://0.0.0.0:{PORT}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
