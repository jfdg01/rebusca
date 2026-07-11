#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve estáticos (index.html + app.css/app.js/
scrape.js + imágenes). Todo lo demás vive en el browser: el scraper, el estado, los
perfiles y las búsquedas (localStorage). El server ya no escribe nada.

    python3 src/servidor.py            # http://0.0.0.0:8000
    python3 src/servidor.py demo       # self-check sin red
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent   # src/
PORT = int(os.environ.get("PORT", 8000))
STAMPED = ("app.css", "app.js", "scrape.js")   # ficheros a los que se añade ?v=<mtime>


def stamp_versions(html, mtimes):
    # Añade ?v=<mtime> a href/src de los estáticos versionados. El HTML no se cachea
    # (no-cache), pero Cloudflare sí cachea el JS/CSS 4h ignorando el origen; al cambiar
    # la URL en cada deploy, el móvil ve la versión nueva al recargar sin tocar Cloudflare.
    for f, v in mtimes.items():
        html = html.replace(f'"{f}"', f'"{f}?v={v}"')
    return html


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(HERE), **k)

    def end_headers(self):
        # no-cache = el navegador revalida siempre (If-Modified-Since -> 304 si no cambió).
        # Sin esto, Cloudflare mandaba max-age=14400 y el móvil veía la versión vieja horas.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if urlparse(self.path).path in ("/", "/index.html"):
            html = (HERE / "index.html").read_text()
            mt = {f: int((HERE / f).stat().st_mtime) for f in STAMPED}
            body = stamp_versions(html, mt).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()   # app.js/app.css/scrape.js/imágenes (anti-traversal propio)

    def log_message(self, *a):   # menos ruido
        pass


def demo():
    assert stamp_versions('<link href="app.css"><script src="app.js"><script src="scrape.js">',
                          {"app.css": 5, "app.js": 9, "scrape.js": 3}) \
        == '<link href="app.css?v=5"><script src="app.js?v=9"><script src="scrape.js?v=3">'
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        print(f"Rebusca en http://0.0.0.0:{PORT}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
