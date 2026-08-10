# Iteración 31 — el servidor que nadie había mutado

Zona: `src/servidor.py` (166 líneas) y su suite `src/test_servidor.py` (136 líneas).

Es el único fichero de producción que nunca pasó por un barrido de mutantes. Sirve la app
en el VPS: si se cae, no hay app. Encaja de lleno en el «busca robustez» del objetivo.

## F1 — Investigar

45 mutantes sobre `servidor.py`, uno a uno, cada veredicto atado al código de salida de
`./check.sh`. 33 mueren. Estos 12 viven:

| mutante | qué pasa en producción |
|---|---|
| `log_request` se llama `log_message` | **el journal del VPS se queda mudo** |
| `log_error`: `super().log_error(...)` → `pass` | lo mismo, por la otra puerta |
| `log_error`: no filtra el `code 404` | el journal se llena de bots |
| `stamped_mtimes`: no imprime el `AVISO` | una `href` rota sale 200 y nadie se entera |
| `stamped_mtimes`: las URL externas cuentan como que faltan | el `AVISO` grita siempre y deja de leerse |
| `REF`: acepta rutas absolutas y esquemas | mismo `AVISO` inútil |
| `publico`: sin `.lower()` | en un disco que no distingue mayúsculas, `/Test_App.js` sale |
| `stamp_versions`: `replace` sin las comillas | versiona cualquier mención del nombre, no solo la ref |
| `PUB`: sin `.webmanifest` | el manifiesto da 404 y el móvil no instala la app |
| `PUB`: sin `.svg` / `.ico` / `.woff2` | nada, no hay ni un fichero de esos |
| `PORT`: ignora la variable de entorno | `PORT=8123 python3 src/servidor.py` deja de funcionar |
| `main`: el argumento posicional no gana al entorno | (dentro de `__main__`, inalcanzable al importar) |

El caro es el primero. `servidor.py:124-126` lleva escrito el accidente: la función se
llamó `log_message` una vez, `BaseHTTPRequestHandler` delega `log_error` **en**
`log_message`, y el journal del VPS salió vacío pasara lo que pasara. Lo arreglaron. Nada
lo mide. Renombrar la función lo repone entero y los siete checks siguen en verde.

El segundo grupo es el `AVISO` de `stamped_mtimes`. Sus cuatro líneas de comentario
(`servidor.py:61-64`) cuentan otro accidente: una ref a un fichero que no existe se
descartaba en silencio, la portada salía 200 con la ref rota y Cloudflare cacheaba el 404
cuatro horas. La solución fue el `AVISO` por `stderr`. Tampoco lo mide nadie: se puede
borrar el aviso, o hacer que grite por cada URL externa hasta volverlo ruido, sin romper
nada.

El tercero es la lista blanca. `test_servidor.py:116` comprueba que «lo que la página sí
necesita» se sigue sirviendo, con una lista escrita a mano de cinco rutas. La página
referencia seis ficheros locales, y dos de ellos —`manifest.webmanifest` y
`apple-touch-icon.png`— no están en la lista. Por eso quitar `.webmanifest` de `PUB` no
rompe nada: la lista se quedó vieja y nadie lo vio.

Y `PUB` tiene cuatro extensiones que no usa nadie: no hay ni un `.svg`, ni un `.ico`, ni un
`.woff2`, ni un `.json` en `src/`, y la portada no pide ninguno. El `.json` de `index.html`
es el `accept=` de un `<input type="file">`: eso lo lee el browser del disco del usuario,
no lo sirve el server.

## F2 — El contrato

**Nada de funcionalidad se pierde.** El servidor sirve exactamente los mismos ficheros que
antes.

1. **La medida del log.** `test_servidor.py` comprueba el comportamiento de `log_error`
   sobre un handler suelto: un `code 404` no deja rastro, un `code 500` sí. Esto mata los
   tres mutantes del log de una, el rename incluido: si la función se llama `log_message`,
   `super().log_error` no escribe nada y el `code 500` desaparece.
2. **La medida del `AVISO`.** `test_servidor.py` captura `stderr` de `stamped_mtimes` con
   un HTML que mezcla las tres clases de ref: una local que existe, una local que no, y una
   externa. El aviso nombra la que falta y **solo** la que falta.
3. **La lista que no se queda vieja.** El bucle de `test_servidor.py:116` deja de estar
   escrito a mano: sale de `stamped_mtimes(html)`, que es la misma función que decide qué
   se versiona. Añadir un `<script>` o un `<img>` a la portada entra en la prueba solo.
   Con un `assert` del recuento para que la lista vacía no pase por buena.
4. **`PUB` pierde `.svg`, `.ico`, `.json` y `.woff2`.** La lista blanca existe para achicar
   lo que sale por un dominio público; cuatro extensiones especulativas la agrandan gratis.
   Vuelven en una palabra el día que haya un icono o una fuente de verdad.
5. **Dos aserciones sueltas en `demo()`**: `publico("/Test_App.js")` es falso, y
   `stamp_versions` no versiona una mención del nombre en prosa, solo la ref entrecomillada.

Lo que **no** se toca, y por qué:

- **`PORT` y el argumento posicional.** El `PORT` del entorno se puede medir recargando el
  módulo, pero el argumento posicional vive dentro de `if __name__ == "__main__"` y no hay
  forma de alcanzarlo sin levantar un proceso que no termina nunca. Medir media pareja
  invita a creer que la otra mitad está medida. Se anota y se deja.
- **La tautología de las cabeceras de seguridad.** `test_servidor.py:73` compara la
  respuesta con `servidor.SEC_HEADERS`, que es justo lo que se está probando: cambiar
  `script-src 'self'` por `script-src *` pasa los siete checks. Es un agujero real, pero
  clavar las directivas en la prueba es una decisión de diseño de seguridad, no una
  simplificación; va a su propia iteración.

## F3 — Implementar

`src/servidor.py`: `PUB` pierde cuatro extensiones, `demo()` gana dos aserciones.
`src/test_servidor.py`: bloque nuevo para el log, bloque nuevo para el `AVISO`, y la lista
a mano sustituida por el bucle derivado.

## F4 — Probar

Los siete checks en verde. Y cada mutante que este trabajo dice matar, muerto: se repone
uno a uno y se comprueba que `./check.sh` sale con código distinto de 0.

## F4 — Resultado

Los siete checks en verde. De los 12 mutantes vivos, **10 mueren ahora**:

```
log_request se llama log_message               muere
log_error: silencia todo                       muere
log_error: no filtra el 404                    muere
stamped: no avisa de los que faltan            muere
stamped: externas cuentan como faltan          muere
REF: acepta rutas absolutas y esquemas         muere
publico: sin .lower()                          muere
stamp: replace sin comillas                    muere
PUB: sin .webmanifest / .png / .webp / .txt / .css   muere (los cinco)
```

Los dos que siguen vivos son los del arranque (`PORT` y el argumento posicional), y están
anotados en `MEJORAS.md` con el motivo.

El mutante del `REF` ancho no moría con la primera versión del bloque 8c: con una URL
externa y una ref rota, el regex ancho da exactamente el mismo aviso. Lo que lo separa es
una ref absoluta o un ancla, y por eso el bloque acabó con un segundo `stderr` capturado
sobre `<img src="/logo.png"><a href="#arriba">`, donde el aviso tiene que salir vacío.

## F5 — Review adversaria

**¿Achicar `PUB` rompe algo que se sirve de verdad?** El riesgo es el manifiesto: si pide
un icono `.svg` o `.ico`, quitar la extensión lo deja en 404 y ningún check lo nota, porque
`REF` solo lee `index.html`. Comprobado a mano: `src/manifest.webmanifest` pide
`/wallapop-logo.webp` y `/apple-touch-icon.png`, y las dos extensiones se quedan. Los
iconos de la interfaz no son ficheros: `index.html` los pinta con `data-icon` por
`innerHTML`. El `.json` que aparece en `index.html:101` es el `accept=` de un
`<input type="file">`: eso lo lee el browser del disco del usuario, el server no lo sirve
nunca. Y `deny.html` sigue saliendo, que `.html` no se toca.

**El sesgo de esta iteración.** El bloque 8c mide `stamped_mtimes` llamándola a pelo, no
sirviendo la portada. Es más barato y aísla mejor, pero no comprueba que el aviso salga
**cuando alguien pide `/`**. Si `send_head` dejara de llamar a `stamped_mtimes`, el aviso
desaparecería de producción con el bloque 8c en verde. Lo tapa otro mutante ya medido:
sin `stamped_mtimes` la portada sale sin versiones y el bloque 1 se cae. Está cubierto,
pero por carambola, y conviene saberlo.

**Tres líneas que ningún mutante puede matar.** En el bucle derivado, el `assert len(locales)
>= 5` y el `+ ["llms.txt"]` son de la prueba, y a la prueba no la prueba nadie: romperlas
deja los siete checks en verde. No son un hallazgo escondido, son el suelo del método. Se
escriben aquí para no contarlas después como cobertura.

**Regla nueva para el método:** *una lista escrita a mano dentro de una prueba envejece en
silencio. Si la producción ya sabe derivarla, que la derive.* La lista de
`test_servidor.py:116` llevaba dos ficheros de retraso, y el precio fue que `.webmanifest`
se podía borrar de la lista blanca sin que nada chistara.
