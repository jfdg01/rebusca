# Iteración 6 — una marca en vez de un vaciado, y dos mutantes que vivían

**Zona:** el importador (`src/app.js:2384-2413`), el arranque (`hydrateStores` y la migración de
`wp_csv`, `src/app.js:1841-1892`) y el handler del evento `storage` (`src/app.js:2560-2568`).

**De dónde sale:** la review adversaria (F5) de la iteración 5, sobre el commit `672dae1`. Cuatro
lentes, veredicto **«NO se puede cerrar `672dae1` sobre `main` tal cual»**. Dos de los cinco
hallazgos son regresiones que la propia iteración 5 metió.

> **Aviso de método:** este documento se escribió **después** del código, y eso es una infracción
> de F2. La causa: el veredicto de F5 llegó con dos hallazgos marcados «obligatorio antes de
> cerrar» y salté a arreglarlos. El contrato retro-ajustado sirve igual para el registro, pero
> cuenta como deuda del ciclo, no como una excepción que se pueda repetir.

## Los hallazgos que sobreviven

### 1 · alta — el evento de la otra pestaña pisa el aviso honesto (regresión)

`src/app.js`, handler de `storage`. La iteración 5 dejó `idb.get("rows").then(...)` sin `.catch`.
`get` **sí** relanza —a diferencia de `set` y `del`, que se tragan el rechazo a propósito—, así que
con el almacén parado cada evento de la otra pestaña llega al `unhandledrejection`, pinta
`"Fallo interno: …"` encima del aviso honesto y se lleva por delante el botón «Deshacer».

Reproducido contra el árbol sin tocar, y comparado con `7323847`, que deja el snack intacto.

**Arreglo:** con la lectura rota no hay nada que fusionar —lo que hay en el almacén es el vacío del
fallo—, así que ni se pide; y la petición lleva su rechazo cerrado.

```js
if (!lecturaRota) idb.get("rows").then((filas) => { … }, () => {});
```

### 2 · alta — restaurar una copia sin fichas no restauraba nada (regresión, regla dura 1)

`src/app.js:2387-2388` de `672dae1`. El importador vaciaba el cache de CSVs del ocupante anterior y
lanzaba si el almacén no aceptaba la escritura. Ese `throw` deshacía **toda** la restauración, y los
favoritos, los rechazados, las búsquedas, los alias y las exclusiones viven en localStorage: se
reponen enteros sin tocar IndexedDB.

Afecta a las copias sin `filas`: las del modelo viejo, las de una sesión sin clasificar, y las que
exporta este mismo navegador cuando la lectura está rota. `7323847` restauraba `wp_favorite`,
`wp_searches` y `wp_alias` sin problema. Es la regla dura 1 —ninguna funcionalidad se pierde— rota
por un arreglo de robustez.

**Arreglo:** el importador no vacía nada. Deja una marca y el vaciado lo hace el arranque de después
de la recarga.

```js
const cacheAjenaKey = "wp_cacheajena"; // vive en localStorage a propósito: el almacén que hay que
                                       // vaciar puede ser justo el que no escribe, y la marca tiene
                                       // que sobrevivir a la recarga para reintentarlo
```

`dropCacheAjena()` corre desde `hydrateStores`, vacía `csvIndex` en memoria y solo borra la marca
cuando el almacén acepta la escritura. Sin `throw`, así que ninguna restauración de localStorage se
pierde por un IndexedDB mudo.

> **Corregido por la iteración 7:** aquí decía «vacía `csvIndex` en memoria **pase lo que pase**», y
> era falso — la llamada estaba dentro del `try`, así que un `throw` de la migración se la saltaba
> entera. La iteración 7 la sacó del `try` y ahí sí es verdad. También decía que la prueba roja de
> los hallazgos 1 y 4 existía: de las cuatro que cita el apartado F5 de más abajo, dos no defienden
> lo que dicen. Los checks que faltaban están en la iteración 7. Y el guardián `if (!lecturaRota)`
> del hallazgo 1 se borró allí: ningún mutante lo mataba, porque con el `.catch` puesto no cambia
> nada que el usuario vea.

### 3 · media — un comentario que dejó de ser verdad

El `catch` del importador decía «la que completó no llega hasta aquí», y con dos escrituras en el
`try` eso ya era falso. **Arreglo:** el comentario dice ahora lo que pasa de verdad —las filas sí
pueden haberse escrito y no se reponen, porque `rowCache` en memoria sigue siendo el bueno y la
primera clasificación lo vuelca encima.

### 4 · baja — dos mutantes que los siete checks no mataban

La lente de completitud lo midió en el árbol de `672dae1`:

- quitar `&& ok` de la migración de `wp_csv` deja los siete checks en verde;
- invertir `rowCache = { ...filas, ...rowCache }` a `{ ...rowCache, ...filas }` también.

Ninguno de los dos es un bug del código —el código está bien—, pero una línea que ningún check
defiende es una línea que la próxima iteración borra sin enterarse.

**Arreglo:** dos checks nuevos, y el arnés aprende a fallar **por clave**.

```js
// `opts.idbFallaClave`: limita el fallo a las claves que empiezan por ese texto. Un fallo PARCIAL
// —una escritura del bucle aborta y la de después entra— es lo que distingue mirar cada booleano
// de mirar solo el último.
```

## Descartados, con el motivo

- **La paginación de `src/scrape.js:236, 275-276` no tiene tope.** Una API que devuelva
  `items: []` con `next_page` no nulo no termina nunca; medido, 500 peticiones. Es real y tiene
  reproducción, pero **está fuera de la zona de esta iteración**: pasa a ser la iteración 7. No se
  vuelve a levantar aquí.
- **La marca `wp_cacheajena` sobrevive a un `catch` del importador.** Hoy es imposible: la marca se
  escribe en la última línea del `try`, así que nada puede lanzar después de ponerla. Un arreglo
  para una línea futura es deuda con otro nombre. Si algún día se añade código detrás, la marca
  entra en `tocadas` y el rollback la repone sola.

## Qué se deja fuera a propósito

Lo aplazado de las iteraciones anteriores sigue aplazado y no se re-levanta: `render()` calculando
`filteredRows()` dos veces en Rechazados, el guardián `typeof snack === "function"`, el hook de
pre-commit midiendo el árbol de trabajo en vez del índice, el badge «sin ver» quedándose frío tras
una restauración, y la pérdida del Map de sesión en un navegador sin `indexedDB`.

## Las pruebas (F4)

Cada arreglo se vio en rojo antes de existir. Las cuatro pruebas rojas, palabra por palabra:

```
FAIL: el fallo de escritura volvió a pisar el aviso del rechazo: No se pudo guardar…
FAIL: una copia sin fichas no se restauró entera con el almacén mudo
FAIL: un texto perdido en el bucle no cerró el grifo          (mutante: sin `&& ok`)
FAIL: el disco pisó la ficha que esta pestaña tenía en memoria: Versión vieja del disco
```

Los dos últimos son mutantes de disco: se rompe el código a propósito, se ve el check morir, se
restaura. Es la única forma de saber que un check defiende algo.

Checks de `test_buttons.js`: 292 → **302**. Los siete checks de `check.sh`, en verde.
