# Iteración 10 — la lista blanca que se salta con un `%74`

**Zona:** `publico()` y `send_head()` de `src/servidor.py:43-45, 99-118`, y el bloque 7b de
`src/test_servidor.py:104-114`.

**De dónde sale:** F1 de esta iteración, mientras la review adversaria de las iteraciones 8 y 9
corría aparte. Es la primera vez que se mira `src/servidor.py` fuera de su `demo()`.

**El tema de la iteración:** la lista blanca decide sobre la ruta **sin decodificar**, y quien sirve
el fichero la decodifica después. Las dos leen rutas distintas, así que el filtro de prefijo es
decorativo.

## El hallazgo

### 1 · baja — el filtro `test_` se cae con un solo carácter escapado

`src/servidor.py:100` pasa `urlparse(self.path).path` a `publico()`. Ese texto conserva los escapes
`%XX`. `SimpleHTTPRequestHandler.translate_path()`, que corre después dentro de
`super().send_head()`, sí hace `unquote`. Resultado: `publico()` juzga `%74est_app.js` y el disco
sirve `test_app.js`.

Medido contra el server de verdad en el puerto 8123, sin tocar código:

```
/test_app.js         -> 404 335b
/%74est_app.js       -> 200 55617b
/te%73t_app.js       -> 200 55617b
/servidor.py         -> 404 335b
/%73ervidor.py       -> 404 335b
```

Y los tres ficheros que el filtro nombra, uno a uno:

```
/%74est_app.js           -> 200
/%74est_buttons.js       -> 200
/%74est_scrape.js        -> 200
```

**Por qué es baja y no alta.** El `.py` y el `.sh` siguen fuera: para pasar hay que terminar en una
extensión de `PUB` **literal**, y `servidor%2Epy` no termina en `.py`. Lo único alcanzable son los
tres `test_*.js`, y el repo es público en GitHub (`api.github.com/repos/jfdg01/rebusca` responde
`200` sin credenciales), así que no se filtra nada que no esté ya a la vista.

Lo que sí se pierde es la defensa tal como está declarada. El comentario de `src/servidor.py:36-39`
dice que los `test_*` no salen porque «llevan dentro el mapa de la app». Hoy salen. Y el día que un
fichero con extensión de `PUB` deba quedarse dentro, esta puerta ya está abierta.

**Arreglo:** decodificar antes de juzgar, con la misma función que usa quien sirve.

```python
ruta = unquote(urlparse(self.path).path)
```

Un `+` no se toca (`unquote`, no `unquote_plus`): en una ruta el `+` es un `+`.

## Descartados, con el motivo

- **El escape de directorio.** `src/test_servidor.py:99-102` ya lo prueba con `%2e%2e` y `..%2f`, y
  el 404 sale. La defensa de `translate_path` es la buena; el fallo de arriba es solo del filtro
  propio. No se toca.
- **`servidor.py` sin `index.html` en disco.** `send_head` haría `FileNotFoundError` y un 500.
  Real, pero el deploy es un `rsync` del directorio entero: no hay camino que borre solo la
  portada. Sin reproducción que valga, regla dura 2.
- **`stamp_versions` reemplaza texto entre comillas en todo el HTML.** Un nombre de fichero que
  apareciera dentro de un `<script>` en línea se estamparía también. El CSP prohíbe el script en
  línea (`script-src 'self'`), así que no hay dónde reproducirlo.
- **`ThreadingHTTPServer` sin `timeout` de socket.** Un cliente lento ata un hilo. Es denegación de
  servicio y el dominio está detrás de un túnel de Cloudflare; medirlo de verdad pide una prueba de
  carga que esta tanda no tiene. Se anota, no se arregla aquí.

## Cómo se prueba (F4)

El bloque 7b de `src/test_servidor.py` ya tiene la lista de rutas que no deben salir. El check nuevo
son tres líneas más en esa misma lista, con la primera letra escapada. Se ve en rojo antes del
arreglo, porque hoy responden `200`.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. La prueba roja, palabra por palabra, con el check nuevo puesto y el arreglo
todavía no:

```
AssertionError: ('se sirve el fuente: /%74est_app.js', 200, b'// test_app.js \xe2\x80\x94 smoke test de app.js SIN navegador ni dependencias (solo stdl')
```

El arreglo son dos líneas: `unquote` en el `import` y `unquote(...)` en `send_head`. Después,
`python3 src/test_servidor.py` sale `ok` y los siete checks de `check.sh` salen en verde y en
silencio.

Se implementó y se probó en un worktree aparte, porque la review adversaria de las iteraciones 8
y 9 corría a la vez sobre el repo: un árbol en rojo durante el arreglo habría contaminado su
medida. El parche esperó a que esa review cerrara.
