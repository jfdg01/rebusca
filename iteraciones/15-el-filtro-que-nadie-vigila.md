# Iteración 15 — el filtro que decide qué ve el usuario, y que nadie vigila

**Zona:** `deckRows` (`src/app.js:899-904`) y la rama de lista de `filteredRows`
(`src/app.js:905-925`).

**De dónde sale:** F1 de esta iteración, con una tanda de mutantes en disco. La zona del precio se
barrió primero y salió bien defendida: los mutantes de `finalPrice`, `dealOff`, `median` y `dec1`
mueren todos, y el único que vive es un redondeo de `dec1` casi equivalente. La del filtro no.

**El tema de la iteración:** aquí no hay un defecto. El código hace lo correcto hoy. Lo que falta es
la red que impide que deje de hacerlo. Estas dos funciones deciden qué anuncios ve el usuario y
cuáles no; las cuatro conductas de abajo se pueden borrar sin que ninguno de los siete checks se
queje.

Medido, rompiendo la línea de producción a propósito y corriendo la suite:

```
deckRows: no esconde los rechazados                muere
deckRows: no esconde los favoritos                 VIVE
deckRows: ignora las exclusiones                   muere
lista: el filtro de texto no mira el id            VIVE
lista: #id casa con todos (some->every)            VIVE
papelera: el filtro de vendedor no filtra          VIVE
```

## Los hallazgos

### 1 · media — un favorito puede volver al mazo sin que nada avise

`src/app.js:902`. `deckRows` esconde tres cosas y solo dos tienen check. Sin `!favorite.has(k)` el
anuncio que el usuario acaba de guardar reaparece en el mazo, y lo tiene que volver a triar cada vez
que abre la búsqueda. El cubo de favoritos deja de significar «ya decidido».

### 2 · media — el filtro de texto de las listas puede dejar de buscar por id

`src/app.js:918`. El comentario de la línea de arriba lo dice: «id sin # también vale». Es lo que
pasa al pegar un id suelto en la barra. Nada lo comprueba.

### 3 · media — una lista de ids puede pasar a exigirlos todos

`src/app.js:917`. `want.some(...)` casa con cualquiera de los ids pegados. Con `every` no casa nunca
—ningún anuncio tiene dos ids—, así que la pantalla sale vacía y parece que la papelera está vacía.
Es el fallo más engañoso de los cuatro: no da error, da cero.

### 4 · media — el filtro por vendedor de la papelera puede dejar de filtrar

`src/app.js:920`. Sale al pulsar el nombre del vendedor en una fila de la papelera. Sin él, la
pantalla no cambia al pulsar y el usuario no sabe si pulsó mal o si ese vendedor tiene todo eso.

## Qué se deja fuera a propósito

- **La zona del precio.** Barrida en F1, defendida. No se le añaden checks por añadir.
- **`sortList` y `bucketRows`.** No entraron en el barrido. Quedan para una iteración siguiente.
- Lo aplazado desde antes, que no se re-levanta: el techo de peticiones, `render()` calculando
  `filteredRows()` dos veces en Rechazados, el guardián `typeof snack === "function"`, el hook
  midiendo el árbol de trabajo, el badge «sin ver» frío tras una restauración, la pérdida del Map de
  sesión sin `indexedDB`, los textos `csv:` huérfanos, y `cacheCsv` apuntando el índice antes de
  saber si el texto entró.

## Cómo se prueba (F4)

No hay defecto en producción, así que no hay rojo que enseñar por las buenas. La prueba roja **es el
mutante**: cada check nuevo tiene que morir con su línea de producción rota, y volver al verde con
ella puesta. Un check que ningún mutante mata no defiende nada.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

El orden: los checks se escribieron antes que este documento, al revés de lo que manda el método.
Se anota porque el método pide que se anote, no porque cambie el resultado: la tabla de mutantes de
F1 ya era el contrato, y ninguno de los cuatro checks cambió después de medirlos.

Los cuatro mueren con su mutante, palabra por palabra:

```
deckRows: no esconde los favoritos            FAIL: el mazo sigue enseñando un anuncio ya guardado en favoritos: a1,a2,a3
lista: el filtro de texto no mira el id       FAIL: el filtro de texto no encuentra por id:
lista: #id casa con todos (some->every)       FAIL: una lista de ids no casa con cualquiera de ellos:
papelera: el filtro de vendedor no filtra     FAIL: el filtro por vendedor de la papelera no filtra: a3,a2,a1
```

Checks de `test_buttons.js`: 319 → **326**. Los siete checks de `check.sh`, en verde y en silencio.
