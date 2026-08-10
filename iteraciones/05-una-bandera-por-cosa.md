# Iteración 5 — una bandera por cosa, y una escritura que dice si entró

**Zona:** el wrapper `idb` (`src/app.js:106-165`), el exportador (`src/app.js:2301-2318`), el
importador (`src/app.js:2355-2378`), las dos migraciones de `hydrateStoresRaw`
(`src/app.js:1839-1860`) y el handler del evento `storage` (`src/app.js:2536-2538`).

**De dónde sale:** la review adversaria (F5) de la iteración 4, con tres lentes. Las dos que
revisaron el commit convergen en el mismo diagnóstico por caminos distintos, y la tercera trae de
una zona virgen un fallo con reproducción. **Cuatro de los doce hallazgos son regresiones de la
iteración 4**, y todas salen de la misma raíz: `almacenRoto` pasó a significar dos cosas a la vez.

**Premisas verificadas a mano antes de escribir esto:**

- `src/app.js:2374-2376`: el vaciado del cache de CSVs no tiene ninguna comprobación detrás.
  Confirmado leyendo el fichero.
- La clave `csv:ford--semana.csv` del check 52 no existe nunca. Conducido el arnés: el scrape del
  check deja `curCsv = "ford.csv"` y `csvIndex = ["ford.csv"]`. La aserción pasa por construcción.
- `src/app.js:110`: el comentario sigue diciendo «sin `indexedDB` (tests) cae a un Map», y la
  iteración 4 borró ese Map. Confirmado leyendo el fichero.

## La raíz

`almacenRoto` nació con un significado: **la lectura del arranque falló, así que `rowCache` y
`csvIndex` están vacíos por el fallo y no porque no haya datos** (`src/app.js:111-112`). De ahí
sale todo lo que cuelga de la bandera: cerrar el grifo, y exportar sin las fichas.

La iteración 4 le añadió un segundo significado: **una escritura abortó**. Ahí `rowCache` está
lleno y es bueno, y el almacén se lee perfectamente. Las dos consecuencias que la bandera arrastra
dejaron de ser ciertas, y como el importador tampoco tiene otra forma de enterarse, se le pegaron
dos comprobaciones de `almacenRoto` alrededor de un `await`.

El arreglo es uno y sirve para siete hallazgos: **la escritura devuelve si entró**, y cada bandera
vuelve a significar una sola cosa.

```js
lecturaRota   // el arranque no pudo leer: no escribas encima, y exporta sin las fichas
              // (es el `almacenRoto` de siempre, con el nombre que le corresponde)
idb.set(k, v) // -> Promise<boolean>: true si la transacción commiteó, false si no
idb.del(k)    // -> igual
```

Quien escribe y le da igual (el triaje, el cache) no mira el booleano y no deja rechazos sueltos.
Quien necesita saberlo (el importador, las dos migraciones) mira el booleano. Nadie consulta una
bandera global para averiguar si *su* escritura entró, que es lo que la iteración 4 hacía y lo que
deja los agujeros 1, 2 y 4.

Un fallo al escribir avisa una vez y **no cierra el grifo**: no hay ningún vacío que pueda
machacar datos buenos, e IndexedDB se recupera de un `QuotaExceededError` en cuanto baja la
presión. Cerrarlo es lo que convierte un fallo pasajero en una sesión de solo lectura.

## Hallazgos que se arreglan

### 1. La copia tira las fichas que tiene enteras en memoria — **alta**

Regresión de la iteración 4. `src/app.js:2315` decide con `almacenRoto` si la copia lleva `filas`,
y el comentario de encima razona sobre el fallo de **lectura**. Con `roto()` encendiendo la misma
bandera al fallar una **escritura**, `rowCache` está lleno y bueno, y la copia sale sin él.

Reproducido por la lente guardián: el usuario tría toda la tarde, una escritura aborta, lee «esta
sesión NO guardará cambios» y hace lo que el propio contrato de la iteración 4 dice que hace la
gente en ese momento — una copia. `rowCache` tiene `["a1","a2"]` y la copia sale sin `filas`. Al
restaurarla, los dos ids vuelven sin título, sin precio y sin foto, y `bucketRows`
(`src/app.js:293`) los tira por el borde. Es el favorito huérfano que la iteración 3 cerró,
reabierto por el camino del export.

El aviso encima miente: «este navegador no las lee» — las leyó perfectamente.

**Arreglo:** el export mira `lecturaRota`, que es la bandera que de verdad significa «`rowCache`
está vacío por un fallo». El check 49 fija hoy la pérdida (`ev(b, "almacenRoto = true")` con
`rowCache` bueno) y hay que corregirlo, no solo ampliarlo.

### 2. El importador recarga diciendo que sí, y luego pinta los anuncios del ocupante anterior — **alta**

Regresión de la iteración 4. `src/app.js:2374-2376` vacía el cache de CSVs sin ninguna guarda
detrás: con el almacén sin escribir, los `idb.del` y el `idb.set` son no-ops, nadie lanza, y
`location.reload()` corre. Y el camino **sin** `copia.filas` — el formato que la iteración 4
introdujo, y el de cualquier copia vieja — no entra en el bloque de `src/app.js:2366` en absoluto,
así que se salta las dos guardas enteras.

Reproducido por la lente guardián, conduciendo `hydrateStoresRaw()` + `restoreLastCsv()`, que es
lo que corre al arrancar: `reloads: 1`, `csvIndex` tras la recarga `["ford.csv"]`, y lo que se
pinta es `["COCHE DEL OCUPANTE ANTERIOR"]`. El hallazgo 7 de la iteración 4 queda reabierto en
cuanto el almacén no escriba.

**Arreglo:** el importador mira el booleano de cada escritura que hace, las filas y el índice por
igual. Con eso desaparecen las dos comprobaciones de `almacenRoto` de `src/app.js:2367` y `:2369`.

### 3. La guarda que impide escribir con el almacén roto no la mata ningún mutante — **alta**

Cobertura. Quitar `almacenRoto ? Promise.resolve() :` de `src/app.js:161` deja los siete en verde.

Reproducido por la lente refutador conduciendo el arnés: favorito guardado, fallo **transitorio**
de lectura al arrancar (el bloqueo que el comentario de `src/app.js:119-120` nombra), el fallo
pasa, y el usuario abre **otra** búsqueda y marca un favorito. Con la guarda, la ficha del Focus
sigue: `["a1"]`. Sin ella: `["b9"]`. El mecanismo es `saveRows` (`src/app.js:283-288`), que
repuebla `rowCache` solo con lo que hay en `data`, así que con la búsqueda vieja cerrada escribe
el vacío encima.

El check 46 comprueba que el grifo **se cierra**, nunca que estar cerrado **impida escribir**.

**Arreglo:** el check que le falta, con ese guion exacto.

### 4. Un fallo pasajero al escribir un CSV deja la sesión sin guardar el triaje — **media**

`src/app.js:161-162`: cualquier `set` o `del` que aborte cierra el grifo para todo. Los CSVs
(cientos de KB) y el `rows` del triaje (unos KB) lo comparten. Un `QuotaExceededError` al
commitear un texto grande — el caso real por el que existe `cacheCsv` — apaga también `saveRows`,
y no se vuelve a abrir aunque el almacén se recupere.

Reproducido por la lente guardián: con `idbFalla` de vuelta a sano, `idb.set` sigue siendo un
`Promise.resolve()` que no escribe. Antes de la iteración 4 ese fallo era un rechazo suelto:
molesto, pero **la escritura siguiente sí lo intentaba**.

El contrato de la iteración 4 lo llamó «el precio de avisar en el momento». El precio real es otro,
y es peor de lo que se escribió allí.

**Arreglo:** un fallo de escritura avisa una vez y no cierra nada. El aviso deja de prometer que
la sesión entera está muerta, porque no lo está.

### 5. Borrar una búsqueda con el almacén sin commitear revive el «Fallo interno» — **media**

Cobertura, con fallo vivo detrás. Quitar el `.catch(roto)` de `del` (`src/app.js:162`) deja los
siete en verde. Reproducido por la lente refutador borrando una búsqueda guardada
(`removeSearch` → `dropCsvCache`, `src/app.js:1797-1801`): sale un rechazo sin capturar, que en el
navegador llega al `unhandledrejection` de `src/app.js:7-15` y pinta «Fallo interno» encima del
aviso honesto. Es el hallazgo 1 de la iteración 4, vivo por el camino de `del`.

La causa: **ningún check de los siete hace fallar nunca un `del`**. El check 46 usa
`idbFalla: "commit"` pero `csvIndex` está vacío en el primer scrape, así que `src/app.js:1793` no
emite ninguno; el check 52 sí borra, pero con el almacén sano.

**Arreglo:** un check que borra una búsqueda con el almacén abortando.

### 6. El check 52 pregunta por una clave que no existe — **media**

`src/test_buttons.js:1333` pide `idb.get("csv:ford--semana.csv")`. En ese bloque el scrape va sin
sufijo de frescura, así que la búsqueda se llama `ford.csv` y esa clave no se crea nunca: la
aserción pasa por construcción, en las dos direcciones. Verificado a mano conduciendo el arnés.

Las dos lentes lo encuentran por separado, y el efecto no es solo de cobertura: nada más borra
claves `csv:` que no estén en `csvIndex` (`cacheCsv` solo poda las que sí están,
`src/app.js:1793`), así que sin ese `del` los textos del ocupante anterior — títulos, precios,
vendedores — se quedan en IndexedDB para siempre, comiendo cuota.

**Arreglo:** pedir `csv:ford.csv`.

### 7. La migración de `wp_csv` perdió la propagación sin nada que la compense — **media**

`src/app.js:1857-1859`. Es el hermano de la migración de `wp_rows`, que la iteración 4 sí protegió.
`localStorage.removeItem(csvCacheKey)` ya corrió antes (`src/app.js:1852`), así que si las
escrituras no entran los CSVs se pierden — eso era igual antes. Lo nuevo es que
`hydrateStoresRaw` **devuelve OK**, así que `csvIndex` se queda en memoria lleno de entradas cuyo
texto no existe, y el badge de «sin ver» cuenta anuncios que no se pueden abrir sin volver a la red.

**Arreglo:** mirar el booleano, igual que su hermano.

### 8. Entre dos pestañas, una machaca las filas que la otra acaba de escribir — **media**

Zona nueva, la que quedaba sin mirar desde la iteración 1. El handler del evento `storage`
(`src/app.js:2536-2538`) llama a `hydrateEstado()`, que re-lee de localStorage los cubos, los
filtros y los alias (`src/app.js:396-447`) y **no toca `rowCache`**. Y `s.put(v, k)` reemplaza el
registro entero, no fusiona.

Reproducido por la lente exploradora: la pestaña B marca un favorito de una búsqueda que A no
tiene cargada; A recibe el evento y actualiza su cubo, pero no la ficha; A clasifica algo suyo, y
su `saveRows` escribe su `rowCache` — sin la ficha de B — encima de todo.

```
A ve a9 como favorito tras el evento storage: [ 'a9' ]
rowCache de A justo después del evento storage: {}
IndexedDB 'rows' tras la clasificación de A: {"a1":{…}}
```

Síntoma: `a9` cuenta como favorito para siempre y su ficha no vuelve a aparecer, ni recargando.
`bucketRows` (`src/app.js:289-304`) ya modela ese huérfano y lo manda a `console.warn`, sin nada en
pantalla. Dos pestañas con dos búsquedas es un uso normal de la app.

Si las dos pestañas tienen la **misma** búsqueda cargada no pasa: el `saveRows` de A se autocura
porque la fila está en su propio `data`.

**Arreglo:** el handler fusiona las filas del almacén con las suyas antes de que el triaje escriba.
Los cubos ya vienen re-hidratados, así que la poda de `saveRows` respeta lo fusionado.

### 9. Una copia de una sesión sana sin clasificar borra las filas del destino — **media**

Preexistente, pero el contrato de la iteración 4 razona sobre ello y lo deja abierto por el otro
lado. `src/app.js:2366`, `if (copia.filas)`: un usuario que aún no ha clasificado nada exporta con
`filas: {}`, que es truthy. Reproducido por la lente guardián: las fichas del destino pasan de
`["a1"]` a `[]`.

**Arreglo:** una copia sin ninguna ficha no tiene nada que restaurar.

### 10. La comprobación previa al `await` del importador es código muerto — **baja**

`src/app.js:2367`. La que la iteración 4 añadió después la subsume: con la bandera puesta,
`idb.set` devuelve sin escribir y el segundo `throw` dispara igual. Ningún mutante puede matarla.
Verificado por la lente refutador byte a byte. Con el arreglo de la raíz desaparecen las dos.

### 11. «Avisa una vez» no lo cuenta ningún check — **baja**

Cambiar `if (almacenRoto) return;` por `if (false) return;` deja los siete en verde. Con tres
escrituras en vuelo (`loadCSV` dispara `saveRows` y `cacheCsv` a la vez, `src/app.js:1600`) el
aviso sale 3 veces en vez de 1. Hoy no se nota porque las tres dicen lo mismo, pero la cabecera
del check 46 promete «avisa UNA vez» y nada lo sostiene.

**Arreglo:** contar los avisos en el camino concurrente.

### 12. El comentario del wrapper nombra un Map que ya no existe — **baja**

`src/app.js:110`: «sin `indexedDB` (tests) cae a un Map». La iteración 4 lo borró.

**Arreglo:** borrar la frase.

## Sobre el método, no sobre el código

Las tres lentes corrieron a la vez sobre **el mismo árbol de trabajo**, y dos de ellas aplican
mutantes en disco. La lente guardián midió `./check.sh` en rojo seis veces seguidas y estuvo a
punto de reportar una fragilidad inexistente; lo cazó comparando el `mtime` de `src/app.js` con lo
que ella misma había tocado. Después midió 280 ejecuciones limpias.

**Regla nueva para F5:** una lente que muta ficheros corre en su propio worktree
(`isolation: 'worktree'`), o las medidas de las demás no valen nada. Va a `CICLO.md`.

## Lo que cambió al implementarlo

- **El arranque avisaba dos veces del mismo fallo.** La migración escribe, la escritura falla, y
  `fallo()` saca «puede que algo no quede guardado» por un microtask; el aviso honesto del arranque
  iba por `setTimeout(…, 0)`, así que llegaba un macrotask después y se quedaba encima por
  casualidad. `snack` es una declaración de función, está izada, y ese `catch` corre tras un
  `await` con el módulo ya evaluado: el `setTimeout` sobraba. Fuera. Ahora los dos avisos caen en
  el mismo turno y el honesto manda, que es lo que el usuario necesita leer — con el grifo cerrado
  no es que «puede que algo no quede guardado», es que no se guarda nada.
- **La migración de `wp_csv` necesitó su propio check.** Los mutantes de los otros seis hallazgos
  salieron rojos con los checks que ya había; el del hallazgo 7 salió verde. El check 50b arranca
  con un `wp_csv` viejo y el almacén abortando, y exige el grifo cerrado y el aviso.
- **El check 46 pedía un aviso que no existía.** El `/no pudo guardar/i` de su primera versión no
  casa con «No se pudo guardar»: sobra un «se». Corregido en los tres sitios.
- **Hallazgo 9 se cierra con `Object.keys(...).length`, no con una guarda aparte.** Una copia sin
  ninguna ficha no tiene nada que restaurar, y la misma expresión resuelve el `filas: {}` truthy y
  el `filas` ausente de las copias viejas por el mismo camino.

## Fuera de alcance

- `filteredRows()` dos veces en Rechazados (`src/app.js:1333`) y la guarda
  `typeof snack === "function"` (`src/app.js:11`): siguen sin tocarse.
- El hook de pre-commit mide el árbol de trabajo y no el índice.
- Restaurar una copia deja el badge de «sin ver» en «no lo sé» hasta el siguiente scrape (lente
  guardián, hallazgo 5). **No se arregla, y es deliberado:** `unseenCount` ya modela ese estado
  (`null` = no se puede saber sin re-scrapear) y lo pinta escondiendo el badge. Restaurar una copia
  es llegar como un navegador nuevo. Saber qué hay de nuevo respecto a los anuncios de otro móvil
  no es una pregunta que tenga respuesta.
- Sin el Map, un navegador sin `indexedDB` pierde la persistencia de `rowCache` dentro de la
  sesión (lente guardián, hallazgo 7). Todo navegador define `indexedDB`; el aviso honesto que sale
  en su lugar vale más que un almacén que muere al recargar.
- Sin mirar todavía: los checks 1-37 de `test_buttons.js`, `src/wallapop.py` fuera de su `demo()`,
  y la zona visual.

## Reglas duras que aplican

1. Ninguna funcionalidad se pierde.
2. Cada hallazgo se ve **rojo antes** del arreglo, y los siete checks en verde después.
