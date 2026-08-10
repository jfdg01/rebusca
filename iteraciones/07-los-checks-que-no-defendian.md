# Iteración 7 — los checks que no defendían, y la marca que caduca

**Zona:** `dropCacheAjena` y `hydrateStores` (`src/app.js:1839-1855`), el acumulador de la
migración de `wp_csv` (`src/app.js:1885`), el handler del evento `storage` (`src/app.js:2580`), los
tres sitios que guardan `csvIndex` (`src/app.js:1805`, `1811`, `1848`) y los checks 50c y 52c de
`src/test_buttons.js`.

**De dónde sale:** la review adversaria (F5) de la iteración 6, sobre `ab0cbdd`. Tres lentes en
worktrees propios y una síntesis que reprodujo cada hallazgo antes de aceptarlo. Veredicto:
**«NO se puede cerrar `ab0cbdd` sobre `main` tal cual»**.

**El tema de la iteración:** el código de producción de la 6 está bien —la síntesis revirtió cada
línea arreglada y vio los dos bugs volver—, pero **dos de los tres arreglos no los defiende ningún
check**, y el contrato de la 6 afirmaba que sí. Un arreglo sin check es un arreglo con fecha de
caducidad: la próxima iteración lo borra y nadie se entera.

**Aviso de método, y es el hallazgo más caro de la tanda:** el refutador afirmó que el mutante
«quitar `&& ok`» muere en `./check.sh`, y con esa premisa falsa descartó el hallazgo real del
guardián. La síntesis lo midió y lo tumbó. **Lo he vuelto a medir yo, en el árbol de verdad, antes
de escribir este documento** — los dos mutantes viven:

```
--- mutante acumulador (src/app.js:1885) ---
check exit=0
--- mutante sin .catch (handler storage, src/app.js:2580) ---
check exit=0
```

Regla que se lleva a `DESARROLLO.md` cuando la tanda cierre: **una lente que descarta el hallazgo de
otra lente tiene que medirlo, no razonarlo.**

## Los hallazgos que sobreviven

### 1 · media — el check 50c no mata el mutante que dice matar

`src/test_buttons.js:1394`, defiende `src/app.js:1885`.

El commit `ab0cbdd` se titula «y dos mutantes dejan de vivir». Solo muere uno. Hay **dos** `&& ok`
en la migración de `wp_csv`, y el mutante que maté fue el del `if` final (`src/app.js:1890`), no el
del acumulador del bucle:

```js
ok = (await idb.set("csv:" + k, m[k].text)) && ok;   // 1885 — el acumulador, INDEFENSO
…
if (!((await idb.set("csvIndex", csvIndex)) && ok))  // 1890 — este sí lo mata el check 50c
```

El check 50c mete **una sola clave** en `wp_csv`, y con una vuelta del bucle `ok = X` y
`ok = X && ok` son la misma cosa. Síntoma que vuelve si alguien toca la línea: con un texto perdido
en el bucle y el resto entrando, `lecturaRota` se queda en `false`, el aviso baja al flojo
«No se pudo guardar…» y `csvIndex` conserva entradas cuyo texto ya no existe.

**Arreglo:** dos claves en el `viejo` del check y `idbFallaClave: "csv:ford"`, de modo que la
primera vuelta falle y la segunda entre. Con eso mueren los dos mutantes, no uno.

### 2 · media — `dropCacheAjena()` no corre «pase lo que pase»

`src/app.js:1853` (la llamada), `src/app.js:1841-1843` (el comentario que lo afirma).

La llamada está **dentro** del `try` de `hydrateStores`, detrás de `await hydrateStoresRaw()`. Un
`throw` de la migración la salta entera. El disparador natural es el `ok === false` de
`src/app.js:1890`: basta con que uno de los textos del ocupante anterior no quepa.

Reproducido de punta a punta, con el importador de verdad en medio y sin cocinar el store a mano:

```
$ node e2e_drop.js   # ab0cbdd
s1 lecturaRota      = true
s1 wp_csv sobrevive = true
s1 recargó          = 1
s1 marca            = "1"
s2 csvIndex memoria = {"grande.csv":{…},"ps5.csv":{…}}
s2 badge ⚙ sin ver  = 1 hidden= false
s2 titulos pantalla = ["PS5 del ocupante anterior"]
```

El usuario restaura su copia y la app le pinta los anuncios del ocupante anterior, con el badge
contándolos como novedades suyas.

Por el camino cayó una premisa que dos lentes daban por buena: **el borrado de `wp_csv` no es
incondicional**. Si la migración de `wp_rows` lanza, el `throw` corta antes de leer `wp_csv`, que
sobrevive intacto. Por eso `wp_csv` y `wp_cacheajena` sí coinciden en un mismo arranque.

**Arreglo:** la llamada sale del `try`. El comentario deja de mentir.

### 3 · media — el `.catch` del handler de `storage` no lo defiende ningún check

`src/app.js:2580`. Es el arreglo de gravedad alta de la iteración 6, y quitarlo deja los siete
checks en verde. El contrato de la 6 citaba como prueba roja el mensaje del check 46, que viene de
la iteración 4 y **no dispara nunca el evento `storage`**.

```
$ node repro_storage2.js   # árbol tal cual
snack antes   = "Rechazado: Otro" | Deshacer visible: true
snack despues = "Rechazado: Otro" | Deshacer visible: true

$ node repro_storage2.js   # quitando solo `, () => {}`
snack despues = "Fallo interno: almacén de mentira: QuotaExceededError" | Deshacer visible: false
```

**Arreglo:** un check propio. Necesita recoger el rechazo suelto, así que engancha el
`unhandledRejection` de Node al listener que `src/app.js:13` registra de verdad, arranca con el
almacén sano, lo tumba en caliente y dispara el evento.

### 4 · baja — la marca pendiente no caduca y se come el cache propio del usuario

`src/app.js:1848`. Es un modo de fallo **nuevo de la iteración 6**: aplazar el vaciado creó un
vaciado pendiente que apunta al futuro.

```
$ node my_marca.js
s1 marca            = "1"     (el almacén no pudo vaciar)
s1 csvIndex propio  = ["ford.csv"]   (la cuota bajó y el usuario scrapeó lo suyo)
s2 csvIndex         = {}      (el arranque siguiente se come SU cache)
s2 badge ⚙ sin ver  = 0 hidden= true
```

**Arreglo, y de paso menos código:** guardar el índice **es** la prueba de que el disco ya no tiene
el índice del ocupante anterior. Los tres sitios que lo guardan pasan por un helper que retira la
marca en cuanto una escritura entra, la haga quien la haga.

```js
const guardaIndice = async () => {
  if (await idb.set("csvIndex", csvIndex)) localStorage.removeItem(cacheAjenaKey);
};
```

Tres llamadas a `idb.set("csvIndex", csvIndex)` pasan a ser tres llamadas a `guardaIndice()`. El
check 52c cambia de premisa: la marca ya no sobrevive a que el usuario cachee lo suyo.

### 5 · baja — el aviso del hook saltaba con el hook puesto

`check.sh:7` compara la ruta con el texto `.githooks`, y `git config` puede tener guardada la
absoluta. Un aviso que sale con todo bien enseña a ignorar los avisos.

**Arreglo:** ninguno en el código. El valor guardado era absoluto en este clon y se ha reescrito
relativo. `check.sh` ya sale en silencio. Se anota aquí porque el aviso ensucia la salida de las
cinco últimas iteraciones y podría leerse como un defecto de `check.sh`.

## Descartados, con el motivo

- **Los textos `csv:` huérfanos** que dejan los `idb.del` fire-and-forget de `dropCacheAjena` cuando
  el borrado aborta y el índice entra. Real y reproducido, pero **preexistente**: el mecanismo vive
  entero en `cacheCsv` (`src/app.js:1800-1805`), que este diff no toca, y reproduce idéntico sobre
  `672dae1`. El daño es espacio muerto en IndexedDB, no un dato perdido. Va a la lista de
  aplazados, no a esta iteración.
- **`BACKUP_SKIP` sin `cacheAjenaKey`** (`src/app.js:2325`): el mutante sobrevive a `./check.sh`,
  pero no tiene síntoma. El importador repone la marca en la última línea del `try`, y al entrar en
  `nuevas` el rollback la retira. Sin síntoma no es un hallazgo (regla dura 2).
- **La cuota tumbando el `setItem` de la marca** y llevándose por delante una restauración que
  antes cabía. No reproducido sin artificio. Regla dura 2.
- **Un scrape entre la marca y la recarga.** `location.reload()` es la línea siguiente al `setItem`.
  No hay ventana.
- **El importador dando por buena una restauración a medias** tras quitarle el `throw` del cache. El
  único `throw` que queda dentro del `try` es el de `idb.set("rows")`, y su `catch` sigue deshaciendo
  localStorage entero. No reproducido.

## Qué se deja fuera a propósito

- **El tope de paginación de `src/scrape.js:236, 275-276`.** Una API que devuelva `items: []` con
  `next_page` no nulo no termina nunca; medido, 500 peticiones. Es la iteración 8, entera para él y
  para el resto de `scrape.js`.
- Lo aplazado desde antes, que no se vuelve a levantar: `render()` calculando `filteredRows()` dos
  veces en Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de
  trabajo en vez del índice, el badge «sin ver» frío tras una restauración, y la pérdida del Map de
  sesión en un navegador sin `indexedDB`.

## Cómo se prueba (F4)

Los tres arreglos con check nuevo se ven en rojo antes de existir, y los dos de cobertura se
prueban con su mutante de disco: se rompe la línea, se ve morir el check, se restaura. Después, los
siete checks de `check.sh`.

## Lo que cambió al implementarlo

**Una línea se fue en vez de ganar un check: el guardián `if (!lecturaRota)` del handler de
`storage`.** Al probar los mutantes salió que solo uno de los dos mata algo:

```
--- mutante: quitar el `, () => {}` ---
FAIL: el evento de la otra pestaña pisó el aviso honesto: Fallo interno: almacén de mentira: QuotaExceededError
--- mutante: `if (true) idb.get("rows")` ---
ok (312 comprobaciones)
```

Con el `.catch` puesto, el guardián no cambia nada que el usuario vea: si la lectura está rota el
`get` se rechaza y el `.catch` se lo come, y si el almacén se cura a mitad de sesión lo que trae el
disco solo puede **añadir** fichas, porque en la fusión manda la memoria. La regla dura 2 vale
igual para el código propio: sin síntoma no hay nada que defender. La línea se borra, y el
comentario cuenta por qué.

**Las cinco pruebas rojas, palabra por palabra:**

```
FAIL: un texto perdido en el bucle no cerró el grifo                    (los DOS `&& ok`, ahora)
FAIL: el cache del ocupante anterior sigue en el índice: ["grande.csv","ps5.csv"]
FAIL: la marca sigue puesta con el índice del usuario ya escrito: 1
FAIL: la marca se quedó puesta con el cache ya vaciado
FAIL: el evento de la otra pestaña pisó el aviso honesto: Fallo interno: almacén de mentira: QuotaExceededError
```

Checks de `test_buttons.js`: 302 → **312**. Los siete checks de `check.sh`, en verde y en silencio
—el aviso del hook también—.
