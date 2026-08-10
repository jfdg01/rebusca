# Iteración 9 — la marca que se retiraba de más

**Zona:** `guardaIndice` y sus tres llamadores (`src/app.js:1804-1818`), el check 52e de
`src/test_buttons.js`, y `check.sh:7`.

**De dónde sale:** la review adversaria (F5) de la iteración 7, sobre `f297ff9`. Dos lentes en
worktrees propios y una síntesis que reprodujo cada hallazgo. Veredicto: **«NO se puede cerrar
`f297ff9` sobre `main` tal cual»**.

**El tema de la iteración:** el arreglo del hallazgo 4 de la iteración 7 se apoya en una premisa
que suena bien y es falsa. La escritura del índice **no** prueba que el cache del ocupante
anterior se haya ido: prueba que el disco tiene lo que hay en memoria. Es el tercer tropiezo
seguido de la misma clase — un arreglo aceptado por razonar en vez de por medir.

He reproducido el hallazgo yo mismo, sobre `f297ff9` sin tocar, antes de escribir esto:

```
$ node src/repro_marca2.js
A) texto en disco = "z1,Ford del ocupante anterior,300,Consol"
B) marca tras el arranque = "1" | texto del ocupante sigue = sí
C) marca tras scrapear    = undefined
   índice en disco        = ["ford.csv"]
D) títulos en pantalla    = ["Ford del ocupante anterior"]
```

## Los hallazgos que sobreviven

### 1 · media — la marca se retira sin que el cache ajeno se haya ido (regresión)

`src/app.js:1805` (`guardaIndice`), y sus llamadas desde `1812` (`cacheCsv`) y `1818`
(`dropCsvCache`).

Es el mismo síntoma que las iteraciones 6 y 7 existen para cerrar, por una puerta nueva. La
secuencia, con el almacén que se cura **a medias** —el apunte del índice son unos KB y entra, el
texto del CSV son cientos de KB y no cabe—:

1. el ocupante anterior del móvil scrapeó «ford»; su texto vive en `csv:ford.csv`;
2. el dueño restaura su copia; el almacén no acepta la escritura, así que el vaciado se aplaza y
   la marca `wp_cacheajena` se queda puesta, que es lo que el diseño quiere;
3. la cuota baja un poco: el usuario scrapea «ford», el apunte del índice entra y el texto no.
   `guardaIndice()` ve la escritura buena y **retira la marca**;
4. el nombre `ford.csv` del índice del usuario apunta al texto del ocupante, y ningún arranque
   futuro lo reintenta.

El usuario abre su búsqueda y lee los anuncios de otra persona, con el badge ⚙ contándolos como
novedades suyas.

La síntesis aisló la causa: corrió el mismo script contra el padre `ab0cbdd` y contra una variante
de `f297ff9` que revierte **solo** esta parte. Las dos salen limpias, así que la culpa no es del
otro arreglo de la iteración 7.

**Arreglo:** la marca se retira cuando el texto propio entra, porque ese texto pisa al homónimo
del ocupante. `cacheCsv` pasa a `async` y espera la escritura del texto:

```js
const okTexto = await idb.set("csv:" + csv, text);
if (okTexto) guardaIndice(); else idb.set("csvIndex", csvIndex);
```

Y `dropCsvCache` vuelve a `idb.set("csvIndex", csvIndex)`: borrar **un** nombre no prueba nada
sobre los demás textos del ocupante. Su único llamador (`src/app.js:2017`) no espera a `cacheCsv`,
así que el `async` no arrastra a nadie.

### 2 · media — el tercer llamador de `guardaIndice` no lo defiende ningún check

`src/app.js:1818`. Revertirlo a `idb.set("csvIndex", csvIndex)` deja los siete checks en verde. Es
literalmente el defecto que la iteración 7 vino a cerrar, repetido dentro de su propio arreglo.

**Arreglo:** el hallazgo 1 le quita esa llamada, así que el hueco se cierra solo. No es un arreglo
aparte; se anota para que la contabilidad cuadre.

### 3 · baja — el aviso del hook seguía saltando con el hook puesto

`check.sh:7`. La iteración 7 afirmó que esto quedaba resuelto por haber reescrito el valor
guardado. No quedó: el valor de este clon volvió a ser absoluto, y `check.sh` compara con el texto
literal `.githooks`.

Un aviso que sale con todo bien rompe la señal que sostiene la tanda entera —«silencio = verde»—,
porque la salida nunca está en silencio y nadie distingue el ruido de un fallo nuevo. Y la vez
anterior se arregló el clon, no el script; por eso volvió.

**Arreglo:** una línea, y ya no depende de cómo tenga cada clon guardado el valor.

```sh
case "$(git config core.hooksPath 2>/dev/null)" in *.githooks) ;; *) echo "AVISO: ..." ;; esac
```

## Descartados, con el motivo

- **El camino B del hallazgo 1** (un toque en «Borrar» dentro de la ventana de `location.reload()`).
  Reproduce en el arnés, pero ahí `location.reload` es un contador, no una navegación, así que la
  ventana del arnés es infinita y la del browser son unos cientos de ms. El contrato de la 7
  descartó «un scrape entre la marca y la recarga» con ese mismo argumento. El hallazgo 1 se
  sostiene entero sin esta ventana.
- **Los dos `await` de `hydrateStores → dropCacheAjena → guardaIndice`** (`src/app.js:1856` y
  `1872`): mutantes vivos con `./check.sh exit=0`, medido por las dos lentes. Ninguna les sacó
  síntoma —el cuerpo de `dropCacheAjena` corre síncrono hasta el primer `await`, así que el vaciado
  en memoria ya ha pasado cuando `hydrateStores` vuelve—. Regla dura 2. Se anota para que nadie los
  levante como si fueran gratis.
- **La fusión del handler de `storage` sin el guardián borrado.** Las dos lentes y la síntesis lo
  midieron: `{...filas, ...rowCache}` solo añade fichas donde no había ninguna. Sin síntoma.
- **Los textos `csv:` huérfanos.** Preexistente, ya catalogado. Ojo a la diferencia con el hallazgo
  1: allí el texto huérfano se vuelve **alcanzable** por colisión de nombre, y eso sí es dato de
  otra persona en pantalla.

## Qué se deja fuera a propósito

- **El tope de paginación de `src/scrape.js`.** Ya tiene contrato propio: la iteración 8.
- **El hallazgo 4 de la iteración 7 en su forma completa** —que la marca caduque también cuando la
  acción siguiente del usuario es borrar una búsqueda en vez de scrapear—. Con el arreglo 1 puesto
  queda cerrado en su reproducción documentada y abierto solo en ese camino. Cuesta un re-scrape,
  no un dato equivocado.
- Lo aplazado desde antes, que no se re-levanta: `render()` calculando `filteredRows()` dos veces
  en Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo en
  vez del índice, el badge «sin ver» frío tras una restauración, y la pérdida del Map de sesión en
  un navegador sin `indexedDB`.

## Cómo se prueba (F4)

El arreglo se ve en rojo antes de existir: un check nuevo junto al 52e, con el almacén curado **a
medias** (`idbFallaClave: "csv:"`), que exige que la marca **no** se retire. Es `repro_marca2.js`
convertido en check. Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. La prueba roja, palabra por palabra:

```
FAIL: la marca se retiró con el texto del ocupante todavía en el disco: undefined
```

Y el mismo `repro_marca2.js` de la síntesis, ya con el arreglo puesto:

```
C) marca tras scrapear    = "1"
D) títulos en pantalla    = []
```

Checks de `test_buttons.js`: 312 → **315**. Los siete checks de `check.sh`, en verde y en silencio
—esta vez el aviso del hook lo calla el script, no el clon—.
