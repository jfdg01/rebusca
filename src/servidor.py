#!/usr/bin/env python3
"""Servidor de Rebusca. Solo stdlib. Sirve estáticos (index.html + app.css/app.js/
scrape.js + imágenes) y guarda la clave de DeepSeek, que no puede vivir en el browser
porque la app es pública. `POST /ia` reenvía el cuerpo TAL CUAL a DeepSeek con esa clave,
y solo a quien traiga la contraseña; `GET /clave` es el formulario que la cambia. El resto
sigue en el browser: el scraper, el estado (localStorage) y el cache (IndexedDB).

    python3 src/servidor.py            # http://0.0.0.0:8000
    PORT=8123 python3 src/servidor.py  # el puerto sale de $PORT
    python3 src/servidor.py 8123       # ...o del argumento, que gana al env
    python3 src/servidor.py clave      # pide contraseña + clave y las guarda (primera vez)
    python3 src/servidor.py demo       # self-check sin red
"""
import getpass, hashlib, hmac, io, ipaddress, json, os, re, sys, tempfile, time
import urllib.error, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent   # src/
PORT = int(os.environ.get("PORT", 8000))

# FUERA de src/ a propósito: `deploy.sh` hace `rsync --delete` sobre src/, así que una clave
# guardada ahí dentro la borra el deploy siguiente. Aquí cuelga al lado de csv/ y estados/,
# que es justo el sitio que el deploy no toca.
SECRETOS = HERE.parent / "secretos.json"
UPSTREAM = "https://api.deepseek.com/chat/completions"
MAX_CUERPO = 256 * 1024   # una conversación larga no llega ni de lejos; un cuerpo de 2 GB sí
TIMEOUT = 180             # un modelo que razona tarda; por debajo de esto se corta solo
# refs del HTML: href/src="..." que no empiece por / : ? #, y sin ? ni # dentro.
# OJO: eso descarta la ruta absoluta, no el esquema. `href="mailto:x@y.z"` casa igual, porque
# el `:` solo está vetado en el primer carácter. Quien use esto filtra los esquemas aparte.
REF = re.compile(r'(?:href|src)="([^":/?#][^"?#]*)"')

# Cabeceras de seguridad (Lighthouse Best Practices). script-src 'self' bloquea el script inline
# (mitiga el DOM-XSS de meter datos scrapeados de Wallapop por innerHTML: un onerror= inyectado
# no ejecuta). El estilo inline SÍ pasa ('unsafe-inline'): app.js escribe style="" a mano.
# img-src abre data: y cualquier https: (las fotos salen de varios CDN de Wallapop); connect-src
# deja el propio origen y api.wallapop.com, que es lo único a lo que llama scrape.js.
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
# Solo las que existen en src/: la lista achica lo que sale por un dominio público, así que
# una extensión especulativa la agranda gratis. Un .svg/.ico/.woff2 de verdad la reabre.
PUB = (".html", ".css", ".js", ".txt", ".png", ".webmanifest")


def publico(ruta):
    nombre = ruta.rsplit("/", 1)[-1].lower()
    return nombre.endswith(PUB) and not nombre.startswith("test_")


# ── la clave de DeepSeek y la contraseña que la abre ──────────────────────────────────
# La app es estática y pública: lo que toca el browser lo ve cualquiera, así que la clave
# se queda aquí y el browser solo manda la contraseña. Del cuerpo que le llega no se mira
# nada — modelo, mensajes y tope los elige quien llama. El server pone la clave, nada más.

def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def secretos():
    """{"pass": <sha256 de la contraseña>, "api": <clave de DeepSeek>}, o {} si no hay fichero."""
    try:
        return json.loads(SECRETOS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def guarda(d):
    # 0o600 al crear Y al reescribir: crear y luego cambiar permisos deja la clave legible
    # por toda la máquina durante un instante, y el O_CREAT no toca un fichero que ya existe.
    fd = os.open(SECRETOS, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.chmod(SECRETOS, 0o600)


def pass_ok(dada):
    guardada = secretos().get("pass", "")
    # compare_digest sobre los dos sha256: comparar con `==` delata por el tiempo cuántos
    # caracteres del principio acertaste, y la longitud del hash no dice nada de la contraseña.
    return bool(guardada) and hmac.compare_digest(sha(dada), guardada)


# La contraseña es lo único entre el internet público y el saldo de DeepSeek, así que probar
# a lo bruto no puede salir gratis. Solo cuenta el intento FALLIDO: usar la app no gasta cupo.
# Dos cubos, y hacen falta los dos. El de por IP para al que insiste desde un sitio. El GLOBAL
# para al que estrena IP en cada intento, que con un /64 de IPv6 —lo trae cualquier conexión
# doméstica— es gratis y deja el cubo por IP en cero para siempre.
# El precio del cubo global: mientras alguien ataque, el dueño tampoco entra. Se acepta a
# sabiendas, porque perder la clave es peor que quedarse sin IA un rato. Lo que de verdad
# sostiene esto es que la contraseña sea larga y aleatoria, no el freno.
# ponytail: listas en memoria, se olvidan al reiniciar.
FALLOS = {}
TODOS = []
FALLOS_MAX, TODOS_MAX, FALLOS_VENTANA = 10, 60, 300


def falla(ip, ahora=None):
    ahora = time.time() if ahora is None else ahora
    FALLOS.setdefault(ip, []).append(ahora)
    TODOS.append(ahora)


def frenado(ip, ahora=None):
    ahora = time.time() if ahora is None else ahora
    if len(FALLOS) > 1000:   # rotar IPs no puede hacer crecer el dict sin tope
        FALLOS.clear()       # ...y vaciarlo no perdona nada: TODOS sigue contando aparte
    TODOS[:] = [t for t in TODOS if ahora - t < FALLOS_VENTANA]
    recientes = [t for t in FALLOS.get(ip, ()) if ahora - t < FALLOS_VENTANA]
    FALLOS[ip] = recientes
    return len(recientes) >= FALLOS_MAX or len(TODOS) >= TODOS_MAX


FORMULARIO = """<!DOCTYPE html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rebusca · clave</title>
<h1>Clave de DeepSeek</h1>
<p>{}
<form method="post" action="/clave">
<p><label>Contraseña<br><input name="pass" type="password" required></label>
<p><label>Clave nueva<br><input name="api" type="password" autocomplete="off" required></label>
<p><button type="submit">Guardar</button>
</form>
"""


def stamp_versions(html, mtimes):
    # Añade ?v=<mtime> a cada "<fichero>" ENTRECOMILLADO del HTML: sustituye la cadena con sus
    # comillas, no el atributo, así que el nombre suelto en prosa se queda quieto. El HTML no se cachea
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
    # Un fichero referenciado que no existe deja un AVISO en stderr: la portada sigue saliendo 200
    # con la ref rota y sin ?v=, y Cloudflare cachea ese 404 cuatro horas. Sin el aviso, en silencio.
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
        # Sin esto, Cloudflare manda max-age=14400 y el móvil ve la versión vieja horas.
        # El 304 solo llega a los ficheros de disco: la portada la genera send_head y sale sin
        # Last-Modified ni ETag, así que su HTML viaja entero en cada visita (son ~40 KB).
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

    def pagina(self, html, estado=200):
        """Manda una página hecha aquí dentro. Devuelve el cuerpo como fichero, que es lo que
        espera send_head: así el HEAD manda las cabeceras y se queda sin escribir el cuerpo."""
        body = html.encode()
        self.send_response(estado)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def de_quien(self):
        # Detrás del túnel de Cloudflare, client_address es siempre el propio túnel: sin la
        # cabecera, el freno de los intentos fallidos sería uno solo para todo internet.
        # Pero la cabecera la escribe quien llama, así que solo vale si quien llama es el
        # túnel: Cloudflare la sobrescribe con la IP real, y un desconocido que llegue al
        # puerto por su cuenta no. De fuera de la red local se cree el socket, no la cabecera
        # — si no, se pone la que le dé la gana y el freno no salta nunca.
        peer = self.client_address[0]
        try:
            de_casa = ipaddress.ip_address(peer).is_private   # incluye 127.0.0.1 y ::1
        except ValueError:
            de_casa = False
        return (self.headers.get("CF-Connecting-IP") or peer) if de_casa else peer

    def do_POST(self):
        ruta = unquote(urlparse(self.path).path)
        if ruta == "/ia":
            return self.ia()
        if ruta == "/clave":
            # las cabeceras las manda `pagina`; aquí solo queda volcar el cuerpo al socket
            return self.wfile.write(self.guarda_clave().getvalue())
        self.send_error(501, "Unsupported method ('POST')")

    def ia(self):
        """Puente a DeepSeek: comprueba la contraseña, pone la clave y reenvía el cuerpo TAL
        CUAL. No valida ni cambia lo que va dentro — el modelo y el tope los elige la app."""
        ip = self.de_quien()
        if frenado(ip):
            return self.send_error(429, "Demasiados intentos")
        if not pass_ok(self.headers.get("X-Pass", "")):
            falla(ip)
            # sin tildes: esto va en la línea de estado del HTTP, que es ASCII
            return self.send_error(401, "Acceso denegado")
        api = secretos().get("api", "")
        if not api:
            return self.send_error(503, "Sin clave de DeepSeek: python3 src/servidor.py clave")
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_CUERPO:
            return self.send_error(413, "Cuerpo demasiado grande")
        pet = urllib.request.Request(UPSTREAM, data=self.rfile.read(n), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "Authorization": "Bearer " + api})
        # ponytail: la respuesta se lee entera y luego se manda. Con "stream": true el SSE
        # llega igual, pero de golpe al final. Streaming de verdad = pasar a chunked.
        try:
            with urllib.request.urlopen(pet, timeout=TIMEOUT) as r:
                estado, tipo, salida = r.status, r.headers.get("Content-Type"), r.read()
        except urllib.error.HTTPError as e:
            # 401 de clave caducada, 402 sin saldo, 400 por un cuerpo raro: el error de
            # DeepSeek sale tal cual, que es lo único que le sirve a la app para explicarlo.
            estado, tipo, salida = e.code, e.headers.get("Content-Type"), e.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            estado, tipo, salida = 504, "text/plain; charset=utf-8", f"DeepSeek no contesta: {e}".encode()
        self.send_response(estado)
        self.send_header("Content-Type", tipo or "application/json")
        self.send_header("Content-Length", str(len(salida)))
        self.end_headers()
        self.wfile.write(salida)

    def guarda_clave(self):
        """POST /clave: cambia la clave de DeepSeek sin entrar por ssh. La contraseña NO se
        toca desde aquí — ver `pon_clave`."""
        ip = self.de_quien()
        if frenado(ip):
            return self.pagina(FORMULARIO.format("Demasiados intentos. Espera unos minutos."), 429)
        n = int(self.headers.get("Content-Length") or 0)
        campos = parse_qs(self.rfile.read(n).decode("utf-8", "replace")) if 0 < n <= 4096 else {}
        if not pass_ok(campos.get("pass", [""])[0]):
            falla(ip)
            return self.pagina(FORMULARIO.format("Contraseña incorrecta."), 401)
        api = campos.get("api", [""])[0].strip()
        if not api:
            return self.pagina(FORMULARIO.format("La clave venía vacía."), 400)
        guarda(dict(secretos(), api=api))
        return self.pagina("<!DOCTYPE html><html lang=es><meta charset=utf-8><p>Clave guardada.")

    # Todo pasa por send_head: es lo que usan GET y HEAD, así que el HEAD anuncia el mismo
    # tamaño que luego sirve el GET (los bots y Cloudflare preguntan con HEAD antes de bajar).
    def send_head(self):
        # `unquote`, y con la misma función que usa quien sirve el fichero: `translate_path`
        # decodifica los `%XX`, así que juzgar la ruta cruda deja pasar `/%74est_app.js`.
        # Dos lecturas distintas de la misma ruta hacen decorativo el filtro de abajo.
        # `unquote`, no `unquote_plus`: en una ruta el `+` es un `+`.
        ruta = unquote(urlparse(self.path).path)
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
        if ruta == "/clave":
            return self.pagina(FORMULARIO.format(""))   # sin contraseña solo se ve el formulario
        if ruta == "/test":
            self.path = "/test.html"   # la prueba del puente, servida como un estático más
            ruta = self.path
        # Lista blanca: en src/ conviven el server, el scraper de referencia y los tests, y el
        # dominio es público. Cualquier cosa que no sea un estático de la página se va en 404
        # (404, no 403: no confirma qué ficheros existen).
        if not publico(ruta):
            self.send_error(404, "File not found")
            return None
        # Un 404 de un estático que la página SÍ pide no es ruido de bot: es un deploy a medias
        # (rsync cortado, fichero renombrado). `log_error` se traga TODOS los 404 por igual, así
        # que sin esta línea el journal callaría mientras la app sale rota en el móvil. Se avisa
        # aquí, con la ruta, y el 404 lo sigue dando `super()`.
        if not os.path.isfile(self.translate_path(self.path)):
            self.log_error("falta un estático servible: %s", ruta)
        return super().send_head()   # app.js/app.css/scrape.js/imágenes (anti-traversal propio)

    # Silencia SOLO el access-log. No vale silenciar `log_message`: BaseHTTPRequestHandler delega
    # log_error EN log_message, así que eso se lleva por delante todos los errores del server y
    # el journal del VPS se queda vacío pase lo que pase. log_error va a stderr, intacto.
    def log_request(self, *a):   # menos ruido
        pass

    def log_error(self, fmt, *a):
        # Un dominio público recibe bots probando rutas todo el día: el 404 es ruido esperado.
        # Todo lo demás (500, 501, errores de socket) SÍ va al journal.
        msg = fmt % a if a else fmt
        if msg.startswith("code 404"):
            return
        super().log_error(fmt, *a)


def pon_clave():
    """Primera vez: guarda la contraseña y la clave. Va por terminal y no por web a propósito
    — un formulario público que FIJA la contraseña se lo queda el primero que lo encuentre,
    y el dominio es público. Puesta ya, /clave sirve para cambiar la clave desde el móvil."""
    p = getpass.getpass("contraseña (la que compartís): ")
    api = getpass.getpass("clave de DeepSeek (sk-...): ").strip()
    if not p or not api:
        sys.exit("vacío: no se guarda nada")
    guarda({"pass": sha(p), "api": api})
    print(f"guardado en {SECRETOS}")


def demo():
    assert stamp_versions('<link href="app.css"><script src="app.js"><script src="scrape.js">',
                          {"app.css": 5, "app.js": 9, "scrape.js": 3}) \
        == '<link href="app.css?v=5"><script src="app.js?v=9"><script src="scrape.js?v=3">'
    # la URL de llms.txt (texto plano o href) sale versionada -> bustea la cache del fetcher IA
    assert "llms.txt?v=" in stamp_versions('lee https://x.com/llms.txt <a href="/llms.txt">', {})
    # las comillas mandan: se versiona la ref, no una mención del nombre en prosa
    assert stamp_versions('<script src="app.js"> mira app.js', {"app.js": 9}) \
        == '<script src="app.js?v=9"> mira app.js'
    # descubrimiento: coge locales existentes (servidor.py existe en HERE); ignora http/absolutas/ancla
    m = stamped_mtimes('<link href="servidor.py"><a href="https://x/y"><img src="/logo.png"><a href="#z">')
    assert list(m) == ["servidor.py"], m
    # lista blanca: sale lo que pide la página, no el fuente ni los tests
    assert all(map(publico, ["/app.js", "/app.css", "/llms.txt", "/icon.png", "/x/i.png"]))
    # `/Test_App.js`: en un disco que no distingue mayúsculas ese fichero SÍ se abre, así que
    # el veto a los tests tiene que juzgar el nombre en minúsculas y no tal como venga
    assert not any(map(publico, ["/servidor.py", "/wallapop.py", "/test_app.js", "/SERVIDOR.PY",
                                 "/Test_App.js", "/__pycache__/", "/deploy.sh", "/.git/config", "/"]))
    # charset utf-8 en text/*; binarios sin tocar
    g = H.__new__(H).guess_type
    assert g("x.txt").endswith("charset=utf-8"), g("x.txt")
    assert g("x.css").endswith("charset=utf-8"), g("x.css")
    assert "charset" not in g("x.png"), g("x.png")

    # ── la clave y la contraseña, sobre un fichero de usar y tirar ──
    global SECRETOS
    real = SECRETOS
    with tempfile.TemporaryDirectory() as tmp:
        SECRETOS = Path(tmp) / "secretos.json"
        try:
            # sin fichero no entra nadie: el fallo peligroso es que "sin contraseña guardada"
            # se lea como "cualquier contraseña vale" y el puente quede abierto de par en par
            assert secretos() == {}, secretos()
            assert not pass_ok("") and not pass_ok("loquesea"), "sin fichero se cuela cualquiera"
            guarda({"pass": sha("abre"), "api": "sk-demo"})
            assert SECRETOS.stat().st_mode & 0o777 == 0o600, oct(SECRETOS.stat().st_mode)
            assert pass_ok("abre"), "la contraseña buena no abre"
            assert not any(map(pass_ok, ["", "abr", "abre ", "Abre", "abrex"])), "abre una que no es"
            # cambiar la clave por /clave no puede llevarse por delante la contraseña
            guarda(dict(secretos(), api="sk-otra"))
            assert pass_ok("abre") and secretos()["api"] == "sk-otra", secretos()
            assert SECRETOS.stat().st_mode & 0o777 == 0o600, "reescribir afloja los permisos"
            # un fichero a medio escribir no puede abrir la puerta
            SECRETOS.write_text('{"pass"', encoding="utf-8")
            assert secretos() == {} and not pass_ok("abre"), "el JSON roto se lee igual"
        finally:
            SECRETOS = real

    # ── el freno, cubo por IP ──
    FALLOS.clear(), TODOS.clear()
    assert not frenado("1.2.3.4")
    for _ in range(FALLOS_MAX):
        falla("1.2.3.4", ahora=1000.0)
    assert frenado("1.2.3.4", ahora=1000.0), "el freno por IP no salta"
    assert not frenado("5.6.7.8", ahora=1000.0), "frenar una IP frena a todas"
    # y suelta solo: si no caduca, un intento tonto deja fuera al usuario para siempre
    assert not frenado("1.2.3.4", ahora=1000.0 + FALLOS_VENTANA + 1), "los intentos no caducan"

    # ── el freno, cubo global ──
    # Estrenar IP en cada intento sale gratis con un /64 de IPv6, así que el cubo por IP
    # solo no para nada: se prueban contraseñas a velocidad de red y nunca salta.
    FALLOS.clear(), TODOS.clear()
    for i in range(TODOS_MAX):
        ip = "2001:db8::%x" % i
        assert not frenado(ip, ahora=2000.0), f"el cubo global salta antes de tiempo (intento {i})"
        falla(ip, ahora=2000.0)
    assert frenado("2001:db8::ffff", ahora=2000.0), "rotando la IP se prueba sin freno"
    assert not frenado("2001:db8::ffff", ahora=2000.0 + FALLOS_VENTANA + 1), "el global no caduca"
    # y vaciar el dict por tamaño no puede perdonar lo ya contado: rotar 1000 IPs sería
    # justo la forma de provocar ese vaciado y salir limpio
    FALLOS.clear(), TODOS.clear()
    for i in range(TODOS_MAX):
        falla("10.0.0.%d" % i, ahora=3000.0)
    FALLOS.update({"relleno%d" % i: [] for i in range(1001)})
    assert frenado("10.0.1.1", ahora=3000.0), "vaciar el dict por tamaño perdona la fuerza bruta"
    FALLOS.clear(), TODOS.clear()
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    elif len(sys.argv) == 2 and sys.argv[1] == "clave":
        pon_clave()
    else:
        port = int(sys.argv[1]) if len(sys.argv) == 2 else PORT  # arg posicional gana al env
        print(f"Rebusca en http://0.0.0.0:{port}  (Ctrl-C para parar)")
        ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
