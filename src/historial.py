#!/usr/bin/env python3
"""Historial local de precios: una pasada por query -> un JSON con lo que cambió.

Corre en TU máquina, NO en el VPS: el scrape sale por tu IP, igual que el del browser
(ver CLAUDE.md). No toca la app ni su localStorage; su salida es texto en la terminal.

    python3 src/historial.py "deshumidificador" "thinkpad e14"
    python3 src/historial.py demo        # self-check, sin red

El fichero (por defecto ./historial.json):

    {"<id>": {"titulo", "url",
              "visto":  "<sello de la primera pasada que lo trajo>",
              "ultimo": "<sello de la última>",
              "qs":     {"<query>": "<sello de la última pasada de ESA query que lo trajo>"},
              "precios": [["<sello>", 429.99], ...],   # solo los CAMBIOS, no una muestra por pasada
              "fin":    "<sello>"}}                    # solo si desapareció de todas las queries

`precios` es un log de cambios: dos pasadas al día durante un año son 730 entradas por
anuncio, y el 99 % repite el importe anterior. El precio de venta de un anuncio que
desapareció es su última entrada (TODO 3).
"""
import argparse, datetime, json, os, sys
import wallapop as w


def stamp():
    """Sello de la pasada. Minutos: dos pasadas al día no chocan y se lee sin convertir nada."""
    return datetime.datetime.now().isoformat(timespec="minutes")


def merge(reg, q, rows, now, completa=True):
    """Mete la pasada de UNA query en `reg`. Lo muta y devuelve el informe de lo que cambió.

    `rows`: filas de wallapop.row (usa id, titulo, precio, url).
    `completa=False` si el scrape se cortó (403, red): entonces NO se buscan desapariciones.
    Media pasada haría desaparecer medio catálogo de golpe, y eso ensucia el historial de
    ventas para siempre.
    """
    inf = {"q": q, "vistos": len(rows), "nuevos": [], "bajaron": [], "vuelven": [], "fin": [],
           "parcial": not completa}
    for r in rows:
        e = reg.get(r["id"])
        if e is None:
            e = reg[r["id"]] = {"titulo": r["titulo"], "url": r["url"],
                                "visto": now, "ultimo": now, "qs": {}, "precios": []}
            inf["nuevos"].append(r["id"])
        e["ultimo"] = now
        e["qs"][q] = now
        # Lo dimos por desaparecido y ha vuelto: republicado, no vendido. El registro se cura
        # solo (el `fin` se borra), y por eso el informe es el ÚNICO sitio donde queda la huella:
        # sin esta línea la resurrección no se ve en ninguna parte. Son 3 de cada 22 (medido).
        muerto = e.pop("fin", None)
        if muerto:
            inf["vuelven"].append([r["id"], muerto])
        p = r["precio"]
        # `precio` viene "" cuando la API omite `price` (wallapop.row tolera el hueco). Un "" en
        # la serie rompe la comparación de la pasada siguiente, así que ni entra.
        if isinstance(p, (int, float)) and not isinstance(p, bool):
            ant = e["precios"][-1][1] if e["precios"] else None
            if p != ant:
                e["precios"].append([now, p])
                if ant is not None and p < ant:
                    inf["bajaron"].append([r["id"], ant, p])
    if completa:
        for i, e in reg.items():
            # Desaparecido de ESTA query = la trajo antes y en esta pasada no. Por query y no
            # global: caerse de OTRA búsqueda no dice nada de esta (TODO 3).
            if e["qs"].get(q, now) != now:
                del e["qs"][q]
                if not e["qs"]:          # ya no lo trae ninguna: vendido o retirado
                    e["fin"] = now
                    inf["fin"].append([i, e["precios"][-1][1] if e["precios"] else None])
    return inf


def render(inf, reg):
    """El informe en texto: una línea por cosa que cambió. Sin cambios, solo la cabecera."""
    tit = lambda i: reg[i]["titulo"][:60]
    out = [f"[{inf['q']}] {inf['vistos']} anuncios" + (" — PARCIAL, sin desapariciones" if inf["parcial"] else "")]
    out += [f"  NUEVO  {reg[i]['precios'][-1][1] if reg[i]['precios'] else '?':>8} €  {tit(i)}" for i in inf["nuevos"]]
    out += [f"  VUELVE {reg[i]['precios'][-1][1] if reg[i]['precios'] else '?':>8} €  {tit(i)}"
            f"  (lo dimos por ido el {f})" for i, f in inf["vuelven"]]
    out += [f"  BAJA   {ant:>8} -> {p} € ({(p - ant) / ant * 100:+.0f} %)  {tit(i)}" for i, ant, p in inf["bajaron"]]
    out += [f"  FIN    {p:>8} €  {tit(i)}" for i, p in inf["fin"]]
    return "\n".join(out)


def scrape(q, lat, lon):
    """Scrapea UNA query entera (todas sus ramas OR). Devuelve (filas, incidencias).

    ponytail: ramas en fila india, sin el ThreadPoolExecutor de wallapop.main(). Una pasada
    de fondo no tiene prisa, y menos conexiones a la vez es menos 403.
    """
    inc, rows, seen = [], [], set()
    for kw in w.branches(q):
        for page in w.search(kw, lat, lon, incidencias=inc):
            nuevos = [w.row(it, (lat, lon)) for it in page]
            nuevos = [r for r in nuevos if r["id"] and r["id"] not in seen]
            if not nuevos:
                # El `while True` de search() solo para con el cursor agotado: un cursor que se
                # repite gira para siempre. En el CLI lo corta un humano; en el timer de TODO 4
                # no hay ninguno. Una página que no aporta un solo id es esa vuelta en redondo.
                break
            seen.update(r["id"] for r in nuevos)
            rows += nuevos
    return rows, inc


def save(reg, path):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False)
    os.replace(tmp, path)   # atómico: un Ctrl-C a mitad no deja el historial trunco


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("queries", nargs="+", help="una o varias búsquedas, como las de la app")
    p.add_argument("--lat", type=float, default=37.7796)   # Jaén, igual que wallapop.py
    p.add_argument("--lon", type=float, default=-3.7849)
    p.add_argument("-f", "--file", default="historial.json")
    a = p.parse_args()

    reg = json.load(open(a.file, encoding="utf-8")) if os.path.exists(a.file) else {}
    now, malas = stamp(), 0
    for q in a.queries:
        rows, inc = scrape(q, a.lat, a.lon)
        inf = merge(reg, q, rows, now, completa=not inc)
        save(reg, a.file)      # tras CADA query: un fallo en la tercera no tira las dos primeras
        print(render(inf, reg))
        for x in inc:
            print(f"  ! {x}", file=sys.stderr)
        malas += bool(inc)
    if malas:
        print(f"AVISO: {malas} de {len(a.queries)} queries INCOMPLETAS", file=sys.stderr)
        sys.exit(1)


def demo():
    fila = lambda i, p, t="cosa": {"id": i, "titulo": t, "precio": p, "url": "u/" + i}
    reg = {}

    inf = merge(reg, "q1", [fila("a", 100), fila("b", 50)], "d1")
    assert inf["nuevos"] == ["a", "b"] and not inf["bajaron"] and not inf["fin"], inf
    assert reg["a"]["precios"] == [["d1", 100]] and reg["a"]["visto"] == "d1", reg["a"]

    # mismo precio otra vez: ni nuevo, ni baja, y la serie NO crece (es log de cambios)
    inf = merge(reg, "q1", [fila("a", 100), fila("b", 50)], "d2")
    assert not inf["nuevos"] and not inf["bajaron"] and not inf["fin"], inf
    assert reg["a"]["precios"] == [["d1", 100]] and reg["a"]["ultimo"] == "d2", reg["a"]

    inf = merge(reg, "q1", [fila("a", 80), fila("b", 60)], "d3")
    assert inf["bajaron"] == [["a", 100, 80]], inf              # la subida de b no es una baja
    assert reg["b"]["precios"] == [["d1", 50], ["d3", 60]], reg["b"]   # pero sí queda apuntada

    # 'b' no viene: desaparecido de su única query -> fin, con el precio al que se fue
    inf = merge(reg, "q1", [fila("a", 80)], "d4")
    assert inf["fin"] == [["b", 60]] and reg["b"]["fin"] == "d4", (inf, reg["b"])
    assert reg["b"]["qs"] == {}, reg["b"]
    # y no se vuelve a contar en la pasada siguiente
    assert merge(reg, "q1", [fila("a", 80)], "d5")["fin"] == [], "una desaparición se cuenta una vez"

    # republicado: vuelve a aparecer, se le quita el fin, y el informe lo canta (el registro
    # ya no guarda rastro de que estuvo muerto, así que la línea es la única prueba)
    inf = merge(reg, "q1", [fila("a", 80), fila("b", 55)], "d6")
    assert "fin" not in reg["b"] and reg["b"]["precios"][-1] == ["d6", 55], reg["b"]
    assert inf["vuelven"] == [["b", "d4"]], inf
    assert "VUELVE" in render(inf, reg) and "d4" in render(inf, reg), render(inf, reg)
    assert merge(reg, "q1", [fila("a", 80), fila("b", 55)], "d6b")["vuelven"] == [], "vuelve una vez"

    # pasada parcial (403 a mitad): no inventa desapariciones
    inf = merge(reg, "q1", [fila("a", 80)], "d7", completa=False)
    assert inf["parcial"] and inf["fin"] == [] and "fin" not in reg["b"], (inf, reg["b"])

    # dos queries: caerse de una no es desaparecer si la otra lo sigue trayendo
    merge(reg, "q2", [fila("a", 80)], "d8")
    inf = merge(reg, "q1", [], "d9")
    assert "a" not in [x[0] for x in inf["fin"]], (inf, reg["a"])
    assert "fin" not in reg["a"] and reg["a"]["qs"] == {"q2": "d8"}, reg["a"]
    inf = merge(reg, "q2", [], "d9")
    assert inf["fin"] == [["a", 80]] and reg["a"]["fin"] == "d9", (inf, reg["a"])

    # precio ausente (la API omite `price` -> celda ""): no revienta y no entra en la serie
    merge(reg, "q3", [fila("c", "")], "d10")
    assert reg["c"]["precios"] == [], reg["c"]
    assert merge(reg, "q3", [fila("c", 10)], "d11")["bajaron"] == [], "sin anterior no hay baja"

    # ida y vuelta por JSON: nada del registro es una tupla ni un set
    reg2 = json.loads(json.dumps(reg))
    assert merge(reg2, "q3", [fila("c", 9)], "d12")["bajaron"] == [["c", 10, 9]], "sobrevive al disco"

    txt = render(merge(reg, "q1", [fila("z", 20, "Sofá")], "d13"), reg)
    assert "NUEVO" in txt and "Sofá" in txt and "[q1]" in txt, txt

    # El 403 de verdad, la cadena entera y sin red: get() revienta a media paginación, search()
    # lo apunta en `incidencias`, scrape() lo devuelve, y main() llama a merge con completa=False.
    # Ese es el único camino que envenena el historial de ventas para siempre, y en once pasadas
    # contra la API de verdad no se dio ni una vez: aquí es donde se prueba, no en producción.
    pag = {"data": {"section": {"payload": {"items": [
               {"id": "a", "title": "cosa", "price": {"amount": 100}, "web_slug": "u"}]}}},
           "meta": {"next_page": "cursor"}}   # queda otra página, y esa es la que se lleva el 403
    veces = []
    def get_403(params, retries=5):
        veces.append(params)
        if len(veces) > 1:
            raise w.Blocked("403: bloqueo (DataDome/CloudFront). Cambia IP o baja el ritmo.")
        return pag
    real_get, real_warn = w.get, w._warn
    w.get, w._warn = get_403, lambda *a, **k: None   # el aviso a stderr sobra en un self-check
    try:
        rows, inc = scrape("q1", 0.0, 0.0)
    finally:
        w.get, w._warn = real_get, real_warn
    assert len(rows) == 1 and len(inc) == 1 and "403" in inc[0], (rows, inc)

    reg3 = {}
    merge(reg3, "q1", [fila("a", 100), fila("b", 50)], "e1")
    inf = merge(reg3, "q1", rows, "e2", completa=not inc)     # lo mismo que hace main()
    assert inf["parcial"] and inf["fin"] == [], inf
    assert "fin" not in reg3["b"] and reg3["b"]["qs"] == {"q1": "e1"}, reg3["b"]
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "demo":
        demo()
    else:
        main()
