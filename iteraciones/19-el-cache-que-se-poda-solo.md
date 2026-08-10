# Iteración 19 — el cache que se poda solo

**Zona:** `src/app.js`, el ciclo de vida del cache: `saveRows`, `cacheCsv`, `dropCsvCache`,
`unseenCount`.
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

Esta zona ya pasó por la iteración 4 y por la 11, así que la mitad de los mutantes mueren. Los
que quedan vivos son todos de la misma familia: **la poda**. El cache no crece sin control
porque hay tres sitios que borran, y ninguno de los tres tiene quien vigile qué borran de más.

```
loadQuery: ignora el cache y re-scrapea            muere
cacheCsv: guarda el índice sin que entre el texto  muere
saveRows: poda todo el cache                       muere
cacheCsv: poda también las búsquedas vivas         VIVE
saveRows: no retiene el lote enviado a la IA       VIVE
dropCsvCache: no borra el texto                    VIVE
saveRows: olvida de qué búsqueda salió la fila     VIVE
unseenCount: sin cache dice cero en vez de null    VIVE
```

### Qué pierde el usuario

**1. `saveRows` no retiene el lote enviado a la IA** (`src/app.js:295`). El botón que copia el
mazo para la IA guarda el lote en `wp_aisent` y cachea sus filas: el veredicto puede llegar en
otra sesión y sin CSV cargado. Esas filas no están en ningún cubo todavía, así que la poda de la
línea siguiente se las lleva. `sentIds` es lo único que las salva. Sin eso, el usuario pega el
`?keep=` que le devuelve la IA y el veredicto se aplica sobre filas que ya no existen.

**2. `cacheCsv` poda también las búsquedas vivas** (`src/app.js:1811`). La poda quita del índice
las búsquedas que ya no están guardadas. La condición tiene dos partes: `!saved.has(k)` (no está
guardada) y `k !== csv` (no es la que se acaba de cachear). Sin la primera, cachear una búsqueda
borra el cache de **todas las demás**, así que abrir cualquier otra búsqueda re-scrapea desde
cero. El cache es lo que hace que abrir una búsqueda guardada sea instantáneo.

**3. `dropCsvCache` no borra el texto** (`src/app.js:1820`). El nombre sale del índice y el texto
—cientos de KB— se queda en IndexedDB para siempre, sin nadie que lo pueda nombrar. Es la fuga
que se apuntó como conocida en iteraciones anteriores y nunca se midió.

### Los dos que se quedan fuera, con el motivo

**`saveRows` olvida `_csv`.** El único lector de `_csv` es la migración del modelo global viejo
(`src/app.js:226`), y esa corre en el arranque, antes que cualquier `saveRows`. Es defensa en
profundidad de un formato que ya no se escribe. No hay escenario de usuario que medir sin
inventárselo.

**`unseenCount` devuelve 0 en vez de null.** Sus dos llamadores hacen `|| 0`
(`src/app.js:1842`) y `sinVer[s.csv]` (`src/app.js:2142`); el primero no distingue, y el segundo
cambia un guion por un cero en el gestor. Cosmético, y la diferencia entre "no se sabe" y "nada
nuevo" ya la explica el comentario. No paga un check.

## F2 — Contrato

1. **La poda de `saveRows` respeta el lote enviado a la IA**, y poda lo que no está ni en un cubo
   ni en el lote. Las dos mitades, o el check pasa por no podar nada.
2. **Cachear una búsqueda no toca el cache de otra búsqueda guardada**: ni su entrada del índice
   ni su texto.
3. **`dropCsvCache` se lleva el texto**, no solo el nombre.

No se toca `src/app.js`.

## F3 — Implementar

Sin cambios en producción. Solo checks, en `src/test_buttons.js`, con el IndexedDB de mentira
del arnés (`idbMem`).

## F4 — Probar

Checks nuevos: `src/test_buttons.js` 351 → 358 (bloques 65, 66 y 67). `./check.sh` sale 0.

```
saveRows: no retiene el lote enviado a la IA       muere  FAIL: la poda se llevó el lote que espera el veredicto de la IA
saveRows: no poda nada                             muere  FAIL: la poda no limpió lo que no está ni en un cubo ni en el lote
cacheCsv: poda también las búsquedas vivas         muere  FAIL: cachear una búsqueda borró del índice otra búsqueda guardada
cacheCsv: no mete la búsqueda en el índice         muere  FAIL: el gestor no pintó el badge "sin ver"
dropCsvCache: no borra el texto                    muere  FAIL: dropCsvCache dejó el texto huérfano en IndexedDB: texto de vespa
dropCsvCache: no quita el nombre del índice        muere  FAIL: dropCsvCache no quitó el nombre del índice
```

Los tres mutantes vivos que entraban en el contrato mueren. Los otros tres son los mutantes de
control: cada check nuevo tiene su mitad contraria medida, para que no pase por no hacer nada.
El de `cacheCsv: no mete la búsqueda en el índice` lo mata un check que ya estaba, el del badge
"sin ver" del gestor, así que esa mitad no necesitaba red nueva.

## F5 — Review adversaria

Los dos hallazgos que quedaron fuera del contrato (`_csv` y el `null` de `unseenCount`) siguen
fuera con el mismo motivo, que está medido arriba, no razonado: `_csv` lo lee un solo sitio y
corre antes; `unseenCount` con 0 solo cambia un guion por un cero en el gestor.

Sin cambios en `src/app.js`. Regla 1 intacta.

Queda sin barrer en esta zona la mitad de arriba: `getCsvCache`, `restoreLastCsv` y el arranque
que hereda un cache ajeno. Eso lo cubrió la iteración 4 y tiene checks propios en
`test_buttons.js` (los bloques que usan `idbMem` y `idbFalla`), así que no se repite aquí.

