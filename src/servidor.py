#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve estáticos (index.html + app.css/app.js/
scrape.js + imágenes). Todo lo demás vive en el browser: el scraper, el estado, los
perfiles y las búsquedas (localStorage). El server ya no escribe nada.

    python3 src/servidor.py            # http://0.0.0.0:8000
    python3 src/servidor.py demo       # self-check sin red
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent   # src/
PORT = int(os.environ.get("PORT", 8000))
# refs locales en el HTML: href/src="fichero" relativo (sin esquema http:, sin ? ni #, sin barra inicial)
REF = re.compile(r'(?:href|src)="([^":/?#][^"?#]*)"')

# Cabeceras de seguridad (Lighthouse Best Practices). script-src 'self' bloquea inline
# (mitiga el DOM-XSS de meter datos scrapeados de Wallapop por innerHTML: un onerror= inyectado
# no ejecuta). img-src https: = fotos de cualquier CDN de Wallapop; connect-src = solo su API.
# ponytail: sin Trusted Types (app.js usa innerHTML por todos lados; migrarlo es otra tarea).
SEC_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; connect-src 'self' https://api.wallapop.com; "
        "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000",
}


def stamp_versions(html, mtimes):
    # Añade ?v=<mtime> a href/src de los estáticos versionados. El HTML no se cachea
    # (no-cache), pero Cloudflare sí cachea el JS/CSS/imágenes 4h ignorando el origen; al
    # cambiar la URL en cada deploy, el móvil ve la versión nueva al recargar sin tocar Cloudflare.
    for f, v in mtimes.items():
        html = html.replace(f'"{f}"', f'"{f}?v={v}"')
    return html


def stamped_mtimes(html):
    # Descubre solo los estáticos locales referenciados en el HTML que existen en disco.
    # Automático: añadir/quitar un <script>/<link>/<img> se cachebustea sin tocar este fichero.
    return {f: int((HERE / f).stat().st_mtime)
            for f in REF.findall(html) if (HERE / f).is_file()}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(HERE), **k)

    def end_headers(self):
        # no-cache = el navegador revalida siempre (If-Modified-Since -> 304 si no cambió).
        # Sin esto, Cloudflare mandaba max-age=14400 y el móvil veía la versión vieja horas.
        self.send_header("Cache-Control", "no-cache")
        for k, v in SEC_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def guess_type(self, path):
        # SimpleHTTPRequestHandler manda text/plain sin charset -> el browser adivina Latin-1
        # y los acentos UTF-8 salen como mojibake (p. ej. /llms.txt). Forzamos utf-8 en text/*.
        t = super().guess_type(path)
        if t.startswith("text/") and "charset" not in t:
            t += "; charset=utf-8"
        return t

    def do_GET(self):
        if urlparse(self.path).path in ("/", "/index.html"):
            html = (HERE / "index.html").read_text()
            body = stamp_versions(html, stamped_mtimes(html)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            # señal para IA (Claude/Gemini): la guía de uso vive en /llms.txt
            self.send_header("Link", '</llms.txt>; rel="alternate"; type="text/plain"')
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
    # descubrimiento: coge locales existentes (servidor.py existe en HERE); ignora http/absolutas/ancla
    m = stamped_mtimes('<link href="servidor.py"><a href="https://x/y"><img src="/logo.png"><a href="#z">')
    assert list(m) == ["servidor.py"], m
    # charset utf-8 en text/*; binarios sin tocar
    g = H.__new__(H).guess_type
    assert g("x.txt").endswith("charset=utf-8"), g("x.txt")
    assert g("x.css").endswith("charset=utf-8"), g("x.css")
    assert "charset" not in g("x.png"), g("x.png")
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        print(f"Rebusca en http://0.0.0.0:{PORT}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
