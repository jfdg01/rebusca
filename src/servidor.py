#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve estáticos (index.html + app.css/app.js/
scrape.js + imágenes). Todo lo demás vive en el browser: el scraper, el estado, los
perfiles y las búsquedas (localStorage). El server ya no escribe nada.

    python3 src/servidor.py            # http://0.0.0.0:8000
    python3 src/servidor.py demo       # self-check sin red
"""
import io, os, re, sys
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


# Extensiones que la página pide de verdad. Todo lo demás (.py, .pyc, .sh, sin extensión,
# listados de directorio) no sale. Los `test_*` se caen aparte: son .js/.py y llevan dentro
# el mapa de la app. ponytail: lista blanca de extensiones, no de ficheros; añadir un icono
# nuevo no obliga a tocar esto, añadir un .py sí (que es justo lo que se quiere).
PUB = (".html", ".css", ".js", ".txt", ".webp", ".png", ".svg", ".ico", ".json", ".webmanifest", ".woff2")


def publico(ruta):
    nombre = ruta.rsplit("/", 1)[-1].lower()
    return nombre.endswith(PUB) and not nombre.startswith("test_")


def stamp_versions(html, mtimes):
    # Añade ?v=<mtime> a href/src de los estáticos versionados. El HTML no se cachea
    # (no-cache), pero Cloudflare sí cachea el JS/CSS/imágenes 4h ignorando el origen; al
    # cambiar la URL en cada deploy, el móvil ve la versión nueva al recargar sin tocar Cloudflare.
    for f, v in mtimes.items():
        html = html.replace(f'"{f}"', f'"{f}?v={v}"')
    # llms.txt: su URL va en texto plano (nota para IAs) y en hrefs absolutos; versionarla
    # bustea la cache del FETCHER de la IA (leía guías viejas días después de un deploy).
    lv = int((HERE / "llms.txt").stat().st_mtime) if (HERE / "llms.txt").is_file() else 0
    return html.replace("/llms.txt", f"/llms.txt?v={lv}") if lv else html


def stamped_mtimes(html):
    # Descubre solo los estáticos locales referenciados en el HTML que existen en disco.
    # Automático: añadir/quitar un <script>/<link>/<img> se cachebustea sin tocar este fichero.
    # Un fichero referenciado que NO existe se descartaba en silencio: la portada salía 200 con
    # una ref rota y sin ?v=, así que Cloudflare cacheaba el 404 cuatro horas. Ahora deja rastro.
    encontrados, faltan = {}, []
    for f in REF.findall(html):
        if (HERE / f).is_file():
            encontrados[f] = int((HERE / f).stat().st_mtime)
        elif "://" not in f:   # una URL externa no tiene por qué existir en disco
            faltan.append(f)
    if faltan:
        print(f"AVISO: index.html referencia ficheros que no existen: {', '.join(faltan)}",
              file=sys.stderr, flush=True)
    return encontrados


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

    # Todo pasa por send_head: es lo que usan GET y HEAD, así que el HEAD anuncia el mismo
    # tamaño que luego sirve el GET (los bots y Cloudflare preguntan con HEAD antes de bajar).
    def send_head(self):
        ruta = urlparse(self.path).path
        if ruta in ("/", "/index.html"):
            # encoding explícito: systemd arranca sin LANG y read_text() cogería ascii
            html = (HERE / "index.html").read_text(encoding="utf-8")
            body = stamp_versions(html, stamped_mtimes(html)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            # señal para IA (Claude/Gemini): la guía de uso vive en /llms.txt
            self.send_header("Link", '</llms.txt>; rel="alternate"; type="text/plain"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return io.BytesIO(body)   # do_GET lo vuelca al socket; do_HEAD lo tira
        # Lista blanca: en src/ conviven el server, el scraper de referencia y los tests, y el
        # dominio es público. Cualquier cosa que no sea un estático de la página se va en 404
        # (404, no 403: no confirma qué ficheros existen).
        if not publico(ruta):
            self.send_error(404, "File not found")
            return None
        return super().send_head()   # app.js/app.css/scrape.js/imágenes (anti-traversal propio)

    # Solo el access-log. Antes esto era `log_message`, y BaseHTTPRequestHandler delega
    # log_error EN log_message: silenciaba TODOS los errores del server, así que el journal
    # del VPS salía vacío pasara lo que pasara. log_error se deja como está (a stderr).
    def log_request(self, *a):   # menos ruido
        pass

    def log_error(self, fmt, *a):
        # Un dominio público recibe bots probando rutas todo el día: el 404 es ruido esperado.
        # Todo lo demás (500, 501, errores de socket) SÍ va al journal. Eso es lo nuevo.
        msg = fmt % a if a else fmt
        if msg.startswith("code 404"):
            return
        super().log_error(fmt, *a)


def demo():
    assert stamp_versions('<link href="app.css"><script src="app.js"><script src="scrape.js">',
                          {"app.css": 5, "app.js": 9, "scrape.js": 3}) \
        == '<link href="app.css?v=5"><script src="app.js?v=9"><script src="scrape.js?v=3">'
    # la URL de llms.txt (texto plano o href) sale versionada -> bustea la cache del fetcher IA
    assert "llms.txt?v=" in stamp_versions('lee https://x.com/llms.txt <a href="/llms.txt">', {})
    # descubrimiento: coge locales existentes (servidor.py existe en HERE); ignora http/absolutas/ancla
    m = stamped_mtimes('<link href="servidor.py"><a href="https://x/y"><img src="/logo.png"><a href="#z">')
    assert list(m) == ["servidor.py"], m
    # lista blanca: sale lo que pide la página, no el fuente ni los tests
    assert all(map(publico, ["/app.js", "/app.css", "/llms.txt", "/wallapop-logo.webp", "/x/i.png"]))
    assert not any(map(publico, ["/servidor.py", "/wallapop.py", "/test_app.js", "/SERVIDOR.PY",
                                 "/__pycache__/", "/deploy.sh", "/.git/config", "/"]))
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
        port = int(sys.argv[1]) if len(sys.argv) == 2 else PORT  # arg posicional gana al env
        print(f"Rebusca en http://0.0.0.0:{port}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
