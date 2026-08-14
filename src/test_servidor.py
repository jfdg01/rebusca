#!/usr/bin/env python3
"""End-to-end del servidor de estáticos: arranca el handler real y pide por HTTP lo
mismo que pide el navegador. Pilla lo que el demo() de servidor.py no ve, porque hace
falta un socket: enrutado, cabeceras de seguridad, mime y charset, el ?v= de la portada,
el 404, el escape de directorio, un método raro, y qué llega al journal y qué no.
Arranca además un proceso con el locale en C, que es como lo lanza systemd.

    python3 src/test_servidor.py
"""
import contextlib, http.client, io, os, socket, subprocess, sys, threading, time
from http.server import ThreadingHTTPServer
from pathlib import Path

import servidor

HERE = Path(__file__).resolve().parent

# Arranca el server en un proceso con el locale en C y la coerción a C.UTF-8 apagada.
# Es el escenario de systemd sin LANG: si algo lee un fichero con el encoding del locale,
# la portada revienta con UnicodeDecodeError y devuelve 500.
SUB = """
import threading, urllib.request
from http.server import ThreadingHTTPServer
import servidor
s = ThreadingHTTPServer(("127.0.0.1", 0), servidor.H)
threading.Thread(target=s.serve_forever, daemon=True).start()
print(urllib.request.urlopen("http://127.0.0.1:%d/" % s.server_address[1]).status)
"""


def req(port, path, method="GET", headers=None):
    """Pide `path` TAL CUAL. http.client no normaliza la ruta: así se puede probar '/../x',
    que es justo lo que urllib arreglaría por su cuenta antes de salir a la red."""
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path, headers=headers or {})
    r = c.getresponse()
    body = r.read()
    c.close()
    return r.status, r.headers, body   # r.headers busca sin distinguir mayúsculas


def libre():
    """Un puerto que ahora mismo no usa nadie. El kernel lo elige, se suelta y se pasa al
    proceso hijo: la carrera dura microsegundos y no hay número fijo que chocar con el 8000
    del usuario ni con el 8123 de las pruebas a mano."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def espera(p, port, intentos=100):
    """El estado de la portada en cuanto el hijo escuche, o None si se murió o no llegó.
    El bind tarda unas décimas: pedirla a la primera falla siempre."""
    for _ in range(intentos):
        if p.poll() is not None:
            return None
        try:
            return req(port, "/")[0]
        except OSError:
            time.sleep(0.05)
    return None


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), servidor.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        # ── 1. la portada: HTML utf-8, versiones estampadas y el aviso de /llms.txt ──
        st, h, body = req(port, "/")
        assert st == 200, st
        assert h["Content-Type"] == "text/html; charset=utf-8", h
        assert h["Content-Length"] == str(len(body)), (h["Content-Length"], len(body))
        assert 'rel="alternate"' in h.get("Link", ""), h
        html = body.decode()          # falla si el server no sirvió utf-8
        assert "app.js?v=" in html and "app.css?v=" in html, "faltan las versiones"
        assert '"app.js"' not in html and '"app.css"' not in html, "quedó una ref sin estampar"
        assert "/llms.txt?v=" in html, "la URL de llms.txt salió sin versión"
        assert req(port, "/index.html")[2] == body, "/index.html no sirve lo mismo que /"
        assert req(port, "/?q=ford")[0] == 200, "la portada con query string no se sirve"

        # ── 1b. HEAD /: las mismas cabeceras que el GET, sin cuerpo. Es lo que preguntan
        #        Cloudflare y los bots antes de descargar; con el Content-Length del fichero
        #        en disco (sin estampar) el tamaño anunciado no es el que luego se sirve.
        st, hh, hb = req(port, "/", method="HEAD")
        assert st == 200 and hb == b"", (st, len(hb))
        assert hh["Content-Length"] == str(len(body)), (hh["Content-Length"], len(body))
        assert hh["Content-Type"] == "text/html; charset=utf-8", hh
        assert 'rel="alternate"' in hh.get("Link", ""), hh
        assert req(port, "/servidor.py", method="HEAD")[0] == 404, "HEAD sí sirve el fuente"

        # ── 2. no-cache + cabeceras de seguridad en TODA respuesta ──
        for path in ("/", "/app.js", "/app.css", "/no-existe.js"):
            _, hh, _ = req(port, path)
            assert hh["Cache-Control"] == "no-cache", (path, hh.get("Cache-Control"))
            for k, v in servidor.SEC_HEADERS.items():
                assert hh.get(k) == v, (path, k, hh.get(k))

        # ── 2b. qué DICEN las cabeceras, no solo que estén ──
        #        El bloque 2 saca el valor esperado de servidor.SEC_HEADERS, o sea del mismo
        #        diccionario que prueba: es cierto por construcción. Con él solo, se podía
        #        cambiar script-src a `*`, quitar la API de connect-src o borrar la CSP entera
        #        con los siete checks en verde. Estos valores van a mano a propósito: es la
        #        única forma de que la prueba pueda discrepar de la producción.
        _, hh, _ = req(port, "/")
        csp = {}
        for d in hh["Content-Security-Policy"].split(";"):
            if d.split():
                csp[d.split()[0]] = set(d.split()[1:])
        assert csp["default-src"] == {"'self'"}, csp
        # la mitigación del DOM-XSS: app.js mete títulos scrapeados por innerHTML, y esto es
        # lo que impide que un onerror= inyectado llegue a ejecutarse
        assert csp["script-src"] == {"'self'"}, csp
        # `==` y no `in`: con `in` se medía solo que no se QUITE la fuente necesaria, no que no se
        # ENSANCHE la lista. Metiendo un `*` en connect-src los siete seguían verdes, y connect-src
        # es justo el canal por donde se exfiltra lo que el script-src de arriba no deja ejecutar.
        # Los otros seis directivos ya se clavan así; estos dos se habían quedado a medias.
        # sin esta línea el navegador corta cada scrape y no hay app
        assert csp["connect-src"] == {"'self'", "https://api.wallapop.com"}, csp
        # sin esta, las fotos de los CDN de Wallapop salen en blanco
        assert csp["img-src"] == {"'self'", "data:", "https:"}, csp
        assert csp["frame-ancestors"] == {"'none'"}, csp
        assert csp["object-src"] == {"'none'"}, csp
        assert csp["base-uri"] == {"'self'"}, csp
        # style-src SÍ lleva 'unsafe-inline', y no es un descuido: app.js escribe el atributo
        # style de los elementos, y sin esto el navegador los tira. Clavado para que nadie lo
        # "arregle" pensando que sobra.
        assert csp["style-src"] == {"'self'", "'unsafe-inline'"}, csp
        assert hh["X-Content-Type-Options"] == "nosniff", hh.get("X-Content-Type-Options")
        # las dos que el bloque 2b se había dejado fuera: borrarlas, o degradar la primera a
        # `unsafe-url`, pasaba invisible por el mismo motivo por el que el bloque 2 es tautológico
        assert hh["Referrer-Policy"] == "strict-origin-when-cross-origin", hh.get("Referrer-Policy")
        assert hh["Cross-Origin-Opener-Policy"] == "same-origin", hh.get("Cross-Origin-Opener-Policy")
        edad = int(hh["Strict-Transport-Security"].split("max-age=")[1].split(";")[0])
        assert edad >= 31536000, edad

        # ── 3. mime + charset de cada estático que sirve la app ──
        for path, ct in (("/app.js", "javascript"), ("/scrape.js", "javascript"),
                         ("/app.css", "text/css"), ("/llms.txt", "text/plain"),
                         ("/icon.png", "image/png")):
            st, hh, _ = req(port, path)
            assert st == 200, (path, st)
            got = hh["Content-Type"]
            assert ct in got, (path, got)
            # texto SIEMPRE con charset: sin él el móvil adivina Latin-1 y salen mojibake
            assert ("charset=utf-8" in got) == got.startswith("text/"), (path, got)

        # ── 4. el ?v= del cachebusting no rompe el servido ──
        assert req(port, "/app.js?v=123")[0] == 200, "el estático versionado no se sirve"

        # ── 5. revalidación: no-cache solo vale si el 304 funciona ──
        _, hh, _ = req(port, "/app.css")
        st, _, b = req(port, "/app.css", headers={"If-Modified-Since": hh["Last-Modified"]})
        assert st == 304 and b == b"", (st, len(b))

        # ── 6. ruta que no existe: 404, no 500 ──
        assert req(port, "/no-existe.js")[0] == 404

        # ── 6b. …y si la que falta es un estático servible, el journal se entera ──
        #        El filtro de `log_error` se traga todos los 404 por igual, porque un dominio
        #        público recibe bots todo el día. Pero un .js que la lista blanca acepta y no
        #        está en disco es un deploy a medias, y ese sí hay que verlo. El server corre
        #        en un hilo de este proceso, así que su stderr es este stderr.
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            assert req(port, "/no-existe.js")[0] == 404
        assert "no-existe.js" in buf.getvalue(), "un estático que falta no llega al journal"
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            assert req(port, "/wp-login.php")[0] == 404   # bot: no es servible, sigue siendo ruido
            assert req(port, "/app.css")[0] == 200        # y un estático que SÍ está no se comenta
        assert buf.getvalue() == "", "el ruido de los bots vuelve a ensuciar el journal"

        # ── 7. escape de directorio: nada de fuera de src/ sale por la red ──
        for path in ("/../CLAUDE.md", "/..%2fCLAUDE.md", "//../CLAUDE.md",
                     "/x/../../CLAUDE.md", "/%2e%2e/deploy.sh"):
            st, _, b = req(port, path)
            assert st != 200, (path, st, b[:80])
        # Los de arriba NO miden el anti-traversal: ninguno acaba en una extensión de PUB, así
        # que `publico()` los tira antes. Borra `translate_path` y siguen en verde. Este cebo sí
        # lleva una extensión servible, así que la única defensa que le queda es la de la ruta.
        cebo = HERE.parent / "cebo-traversal.txt"
        cebo.write_text("SECRETO FUERA DE src/", encoding="utf-8")
        try:
            for path in ("/../cebo-traversal.txt", "/..%2fcebo-traversal.txt",
                         "//../cebo-traversal.txt", "/x/../../cebo-traversal.txt",
                         "/%2e%2e/cebo-traversal.txt", "/..%252fcebo-traversal.txt"):
                st, _, b = req(port, path)
                assert st != 200 and b'SECRETO' not in b, ("se sirvió fuera de src/", path, st, b[:80])
        finally:
            cebo.unlink(missing_ok=True)

        # ── 7b. el código fuente NO se sirve: src/ tiene el server, el scraper de
        #        referencia y los tests, y el dominio es público. Solo salen los estáticos
        #        que usa la página.
        # Los `%XX` van en la lista a propósito: el filtro juzga la ruta cruda y quien sirve el
        # fichero la decodifica, así que sin igualar las dos lecturas `%74est_app.js` sale con 200.
        for path in ("/servidor.py", "/wallapop.py", "/test_app.js", "/test_buttons.js",
                     "/test_scrape.js", "/test_servidor.py", "/__pycache__/",
                     "/servidor.py?v=1", "/SERVIDOR.PY",
                     "/%74est_app.js", "/%74est_buttons.js", "/te%73t_scrape.js"):
            st, _, b = req(port, path)
            assert st != 200, ("se sirve el fuente: " + path, st, b[:80])
        # ...y lo que la página sí necesita sigue saliendo. La lista sale de la propia portada
        # (la misma función que decide qué se versiona), no escrita a mano: así un <script> o un
        # <img> nuevo entra en la prueba solo. Escrita a mano se quedó vieja y no lo vio nadie:
        # le faltaban el manifiesto y el icono, y quitar .webmanifest de PUB pasaba los 7 checks.
        # del fichero de disco, no del `html` que sirvió el server: ese ya viene estampado y REF
        # descarta a propósito toda ref con `?`
        locales = servidor.stamped_mtimes((HERE / "index.html").read_text(encoding="utf-8"))
        assert len(locales) >= 5, "la portada no referencia casi nada: " + str(list(locales))
        for path in list(locales) + ["llms.txt"]:   # llms.txt va por URL absoluta, no lo pilla REF
            assert req(port, "/" + path)[0] == 200, "el filtro se llevó por delante " + path

        # ── 8. método no soportado: 501, y el server sigue vivo ──
        assert req(port, "/", method="POST")[0] == 501, "POST debería ser 501"
        assert req(port, "/")[0] == 200, "el server se quedó tocado tras el POST"

        # ── 8b. el journal del VPS: el 404 de los bots no sale, todo lo demás sí ──
        #        Esto mide el accidente que cuenta el comentario de `log_request`. La función se llamó
        #        `log_message` una vez, y BaseHTTPRequestHandler delega log_error EN log_message:
        #        el journal salía vacío pasara lo que pasara. Renombrarla lo repone entero, así
        #        que la prueba no mira el nombre, mira que el error llegue a stderr.
        h = servidor.H.__new__(servidor.H)
        h.client_address = ("1.2.3.4", 4321)

        def loguea(fmt, *a):
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                h.log_error(fmt, *a)
            return buf.getvalue()

        assert loguea("code %d, message %s", 404, "File not found") == "", "el 404 de los bots ensucia el journal"
        assert "500" in loguea("code %d, message %s", 500, "boom"), "un 500 no llega al journal"
        assert "socket" in loguea("error de socket"), "un error sin código no llega al journal"

        # ── 8c. una ref rota en la portada deja rastro por stderr ──
        #        `stamped_mtimes`: sin el aviso se descarta en silencio, la portada sale 200 con la
        #        ref rota y Cloudflare cacheaba el 404 cuatro horas. El aviso nombra la que falta
        #        y SOLO la que falta: si grita por cada URL externa, deja de leerse.
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            servidor.stamped_mtimes('<script src="app.js"><script src="no-existe.js">'
                                    '<img src="https://x.com/y.png">')
        aviso = buf.getvalue()
        assert "no-existe.js" in aviso, "una ref rota no deja rastro: " + repr(aviso)
        assert "x.com" not in aviso and "app.js" not in aviso, "el aviso grita de más: " + repr(aviso)
        # una ref absoluta y un ancla tampoco son cosa nuestra: REF solo mira las relativas
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            servidor.stamped_mtimes('<img src="/logo.png"><a href="#arriba">')
        assert buf.getvalue() == "", "el aviso salta con refs que no son locales: " + repr(buf.getvalue())

        # ── 9. la portada se lee como utf-8 aunque el servicio arranque sin locale ──
        env = dict(os.environ, LC_ALL="C", PYTHONCOERCECLOCALE="0", PYTHONUTF8="0")
        r = subprocess.run([sys.executable, "-c", SUB], cwd=HERE, env=env,
                           capture_output=True, text=True, timeout=30)
        assert r.returncode == 0 and r.stdout.strip() == "200", \
            "la portada falla con el locale en C: " + (r.stderr[-300:] or r.stdout)

        # ── 10. el arranque de verdad: `python3 servidor.py [puerto]` ──
        #        Todo lo de arriba monta `servidor.H` a mano. El bloque `__main__` — el env
        #        `PORT`, el argumento posicional y el bind de `ThreadingHTTPServer` — es lo
        #        único que corre en el VPS, y no lo medía nadie. Aquí se levanta el proceso
        #        entero, como lo levanta systemd, y se le pide la portada.
        for con_arg in (True, False):
            puerto, otro = libre(), libre()
            args = [str(puerto)] if con_arg else []
            # el que NO manda va cruzado a propósito: si el server escuchara en él, la portada
            # no aparece en `puerto` y esto falla. El argumento posicional gana al env.
            env = dict(os.environ, PORT=str(otro if con_arg else puerto))
            p = subprocess.Popen([sys.executable, str(HERE / "servidor.py")] + args, cwd=HERE,
                                 env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                 text=True)
            try:
                assert espera(p, puerto) == 200, \
                    ("el argumento posicional" if con_arg else "PORT") + " no manda: nadie sirve la portada"
            finally:
                p.kill()
                p.wait(timeout=10)
        # `demo` no es un puerto: sin su rama, `int("demo")` revienta el arranque
        r = subprocess.run([sys.executable, str(HERE / "servidor.py"), "demo"], cwd=HERE,
                           capture_output=True, text=True, timeout=30)
        assert r.returncode == 0 and r.stdout.strip() == "ok", (r.returncode, r.stdout, r.stderr[-300:])

        print("ok")
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
