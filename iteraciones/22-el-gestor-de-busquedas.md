# Iteración 22 — el gestor de búsquedas: el apodo, el filtro y el orden

**Zona:** `src/app.js`, `renameSearch()`, `paintSearches()` (el filtro y el orden de la lista) y la
tarjeta de cada búsqueda.
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

El check 21 pulsa los cinco botones de la tarjeta y comprueba que cada uno hace algo. Lo que ese
check no mira es **qué** hace: renombrar guarda el apodo, sí, pero nadie mide qué pasa al
cancelar, al dejarlo en blanco o al escribirlo con espacios. Y el orden de la lista —lo primero
que se ve al abrir el gestor— no lo mide nadie en absoluto.

Doce mutantes, diez vivos.

```
alias: renombrar no persiste                       muere
buscar: el filtro no mira el término real          muere
alias: renombrar con vacío no quita el apodo       VIVE
alias: cancelar el prompt renombra igual           VIVE
alias: el apodo no se recorta                      VIVE
buscar: el filtro no mira el apodo                 VIVE
buscar: el filtro distingue acentos                VIVE
orden: las de sin-ver no suben                     VIVE
orden: la fecha de apertura no cuenta              VIVE
orden: lo más nuevo va abajo                       VIVE
tarjeta: el apodo no manda como título             VIVE
tarjeta: el término real no se enseña              VIVE
```

### Qué pierde el usuario

**1. Cancelar el renombrado renombra igual** (`src/app.js:2231`). `prompt()` devuelve `null` al
cancelar. Sin la guarda, `null.trim()` lanza, o —con el mutante que la quita— el apodo se pierde.
Cancelar tiene que dejar las cosas como estaban.

**2. El apodo en blanco no lo quita** (`src/app.js:2233`). Borrar el texto y aceptar es la única
forma de volver al nombre real. Sin la rama del `else`, el apodo pasa a ser `""` y la tarjeta se
queda con el título vacío.

**3. El apodo no se recorta** (`src/app.js:2232`). Un apodo de un solo espacio no es un apodo: sin
el `trim()`, `" "` es truthy y la búsqueda se queda sin nombre visible.

**4. El filtro no mira el apodo** (`src/app.js:2135`). Le pones nombre a una búsqueda y luego no
la encuentras por ese nombre. El apodo existe para eso.

**5. El filtro distingue acentos** (`src/app.js:2133`). Escribir "bañera" con la tilde de más o de
menos deja la lista vacía. `norm()` está puesto en los dos lados justo para eso.

**6. El orden de la lista** (`src/app.js:2141`). Son tres reglas encadenadas y ninguna se mide:
las que tienen anuncios sin ver van arriba; entre las demás, la más recientemente tocada; y
"tocada" es lo más nuevo entre la última apertura y el último scrape. Con el orden al revés, lo
que sale primero es la búsqueda más vieja y sin novedades.

**7. La tarjeta con apodo** (`src/app.js:2181`). El apodo manda como título y el término real baja
a la segunda línea. Sin lo segundo, el usuario que apodó "Mi coche" ya no puede saber qué se
busca de verdad.

## F2 — Contrato

1. **Cancelar el renombrado no toca el apodo.**
2. **Un apodo en blanco (o solo espacios) quita el apodo.**
3. **El apodo se guarda recortado.**
4. **El filtro del gestor encuentra por apodo y por término real, con acentos o sin ellos.**
5. **La tarjeta con apodo enseña el apodo arriba y el término real debajo.**
6. **El orden: primero las que tienen sin ver; luego, la tocada más recientemente; y abrir una
   búsqueda cuenta como tocarla, igual que re-scrapearla.**

No se toca `src/app.js`.

## F3 — Implementar

Sin cambios en producción. Checks en `src/test_buttons.js`. El falso `prompt` del arnés es
constante por arranque (`opts.prompt`), así que el check lo reasigna en el sandbox
(`b.sandbox.prompt = () => …`) para medir las tres respuestas distintas sin arrancar tres veces.

## F4 — Probar

Checks 73, 74 y 75 en `src/test_buttons.js` (378 → 392 comprobaciones). Los diez mutantes que
vivían ahora mueren:

```
alias: renombrar con vacío no quita el apodo  muere  FAIL: un nombre en blanco no quita el apodo, lo deja vacío: ""
alias: el apodo no se recorta                 muere  FAIL: el apodo no se guardó recortado: "  Mi coche  "
alias: cancelar el prompt renombra igual      muere  Cannot read properties of null (reading 'trim')   [rc=1]
buscar: el filtro no mira el apodo            muere  FAIL: el filtro del gestor no encuentra por apodo
buscar: el filtro no mira el término real     muere  FAIL: #searchesFilter no restauró el gestor
buscar: el filtro distingue acentos           muere  FAIL: el filtro del gestor no encuentra por apodo
orden: las de sin-ver no suben                muere  FAIL: la búsqueda con anuncios sin ver no sube al principio: ford,vespa
orden: la fecha de apertura no cuenta         muere  FAIL: abrir una búsqueda no la sube: solo cuenta la fecha del scrape, vespa,ford
orden: lo más nuevo va abajo                  muere  FAIL: la búsqueda scrapeada más recientemente no sale la primera: ford,vespa
tarjeta: el apodo no manda como título        muere  FAIL: el apodo no manda como título de la tarjeta: ford
tarjeta: el término real no se enseña         muere  FAIL: la tarjeta con apodo no enseña el término real, y ya no hay forma de saber qué se busca
```

`src/app.js` queda igual que en `main` tras el barrido. `./check.sh` en verde.

## F5 — Review adversaria

**El arnés del barrido mentía en un caso, y casi cuela.** El barrido marca "muere" cuando la salida
trae la palabra `FAIL`. El mutante de cancelar mata la suite con `Cannot read properties of null
(reading 'trim')`, que no la trae: se leyó como vivo. Muere con `rc=1`. **La señal es el código de
salida, no el texto.** El barrido que decida por el texto vuelve a mentir en cuanto un mutante
rompa la suite en vez de fallarla.

**El check del orden tuvo que limpiar el residuo del arranque.** `loaded()` scrapea de verdad, y
ese scrape deja su propia huella en `wp_lastseen` y en `csvIndex`. La primera versión midió el
residuo (`ford` primera por una marca de apertura de hace un instante) y no el contrato. El
escenario se siembra ahora desde cero.

**El filtro por término real ya lo mataba el check 22, no el 74.** El mensaje del fallo lo dice:
`#searchesFilter no restauró el gestor`. El check 74 no sobra —cubre el caso con apodo puesto, que
el 22 no tiene— pero conviene saber cuál de los dos es la red que aguanta.
