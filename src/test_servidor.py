#!/usr/bin/env python3
"""End-to-end del CRUD de perfiles: arranca el handler real y pega a las mismas
rutas HTTP que usan los botones del HUD (crear/renombrar/recolorear/borrar).
Esto pilla fallos de enrutado que el demo del helper no ve (p.ej. "ruta desconocida").

    python3 src/test_servidor.py
"""
import json, tempfile, threading, urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import servidor


def post(base, path, obj):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:          # 4xx/5xx traen JSON en el cuerpo
        return e.code, json.loads(e.read())


def get(base, path):
    with urllib.request.urlopen(base + path) as r:
        return r.status, json.loads(r.read())


def main():
    d = Path(tempfile.mkdtemp())
    servidor.ESTADOS = d          # apunta el estado a un dir de usar y tirar
    srv = ThreadingHTTPServer(("127.0.0.1", 0), servidor.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        # crear (como el chip -> guardar estado con color)
        assert post(base, "/estado?perfil=javi", {"seen": [], "trash": [], "fav": [], "color": "#111"})[0] == 200
        assert [p["name"] for p in get(base, "/perfiles")[1]] == ["javi"]

        # renombrar + recolorear (botón Guardar en modo edición)
        st, res = post(base, "/perfil?perfil=javi", {"nuevo": "javier", "color": "#222"})
        assert st == 200 and res["name"] == "javier", res
        assert (d / "javier.json").exists() and not (d / "javi.json").exists()
        assert json.loads((d / "javier.json").read_text())["color"] == "#222"

        # colisión: no debe pisar un perfil existente
        post(base, "/estado?perfil=test", {"seen": [], "trash": [], "fav": [], "color": "#333"})
        st, res = post(base, "/perfil?perfil=javier", {"nuevo": "test"})
        assert st == 400 and "error" in res, (st, res)
        assert (d / "javier.json").exists()      # sigue intacto

        # borrar (botón Borrar del HUD) -> aquí saltaba "ruta desconocida" con el server viejo
        st, res = post(base, "/perfil?perfil=javier", {"borrar": True})
        assert st == 200 and res.get("ok"), (st, res)
        assert not (d / "javier.json").exists()
        assert [p["name"] for p in get(base, "/perfiles")[1]] == ["test"]
        print("ok")
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
