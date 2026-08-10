# Iteración 4 — la escritura que falla se comporta como la lectura que falla

**Zona:** el wrapper `idb` (`src/app.js:113-152`), el exportador (`src/app.js:2289-2305`), el
importador (`src/app.js:2307-2370`) y el arnés (`src/test_app.js`).

**De dónde sale:** la review adversaria (F5) de la iteración 3. Las dos lentes coinciden en que
el núcleo del arreglo está probado — los mutantes sobre `t.oncomplete`, `t.onabort`, la guarda de
`almacenRoto` y el reparto de culpa del aviso salen todos en rojo — y en que lo que se degradó es
lo que **no** estaba en el contrato. Dos de los seis hallazgos son regresiones de la iteración 3.

## Hallazgos que se arreglan

### 1. Una escritura abortada no cierra el grifo, mata el «Deshacer» y grita «Fallo interno» — **alta**

Regresión de la iteración 3. Antes, una escritura abortada resolvía y nadie se enteraba. Ahora
rechaza, y los `idb.set` fire-and-forget del triaje (`saveRows`) no los captura nadie: el
`unhandledrejection` global (`src/app.js:7-15`) pinta `"Fallo interno: no queda espacio"` por
cada carta clasificada, y ese aviso pisa el de «Deshacer» del rechazo. Medido por la lente
guardián: tras rechazar una carta, `msg="Rechazado: Ford Focus"` con el botón deshacer visible,
y dos microtasks después `msg="Fallo interno: no queda espacio"` sin botón. Con el código de
antes del commit, el «Deshacer» sobrevivía.

Peor: `almacenRoto` solo se activa cuando falla la **lectura** del arranque
(`src/app.js:1822`). Con el disco lleno, el triaje sigue yendo a localStorage carta tras carta y
las filas no llegan nunca a IndexedDB. Es el favorito huérfano que la iteración 3 cerró para el
importador, abierto de par en par en el camino del swipe.

**Arreglo:** un fallo de escritura cierra el grifo igual que uno de lectura. Se avisa una vez,
con el mismo mensaje honesto, y las escrituras siguientes son no-ops. El wrapper deja de
propagar el rechazo: quien necesite saberlo mira `almacenRoto`, que es lo que hace el importador.

### 2. Exportar con el almacén roto da una copia sin filas que dice «Copia guardada» — **alta**

Con `almacenRoto`, `rowCache` está vacío **por el fallo de lectura**, no porque no haya filas.
`backupJSON` mete ese vacío en `filas`, el botón dice `"Copia guardada"`, y restaurar esa copia
en una sesión sana borra todas las filas sin un aviso: `{}` es truthy, así que pasa el
`if (copia.filas)`. Medido por la lente refutador: IndexedDB pasa de dos filas a cero, con
`recargas = 1` y `aviso = ""`. Y la sesión rota ya le ha dicho al usuario «esta sesión NO
guardará cambios», que es justo cuando uno se hace una copia.

**Arreglo:** con el almacén roto la copia sale **sin** el campo `filas`, que es un formato que el
importador ya soporta (las copias viejas no lo traen), y el aviso lo dice. La copia del triaje
se sigue pudiendo hacer: no se pierde funcionalidad.

### 3. El `process.on("unhandledRejection")` del arnés apaga fallos reales — **media**

Regresión de la iteración 3, y la peor clase: debilita la red que tiene que cazar las demás.
Medido: un `idb.del` que rechaza siempre deja `./check.sh` en verde **solo** por ese listener;
quitándolo, sale `EXIT=1`. Nadie lee el cubo `rechazos`. Y el comentario que lo justifica es
falso: el navegador no los recoge, ejecuta `ruido()` y le enseña un aviso al usuario.

**Arreglo:** borrarlo. Con el hallazgo 1 arreglado, el wrapper ya no deja rechazos sueltos, así
que Node vuelve a su comportamiento por defecto y un rechazo sin capturar vuelve a ser rojo.

### 4. `err.culpaDelFichero` sobre `null` deja al usuario sin ningún aviso — **media**

`rej(t.error)` puede propagar `null`: la spec de IndexedDB deja `transaction.error` a `null`
cuando se aborta con `abort()`. El `.catch` final lo desreferencia sin guarda, revienta dentro
del propio handler, y el usuario pulsa importar y no ve nada. Las dos lentes lo encuentran.

**Arreglo:** normalizar el error antes de mirarlo. Es una línea.

### 5. `err instanceof SyntaxError` es falso en el arnés y verdadero en el navegador — **media**

`makeContext` inyecta el `JSON` del host en el sandbox, así que el `SyntaxError` de `JSON.parse`
viene de otro realm y el `instanceof` falla. Un fichero que no es JSON da en el arnés el mensaje
del almacén y en el navegador `"Copia no válida"`. Un check escrito contra el arnés atornillaría
el mensaje equivocado.

**Arreglo:** `err.name === "SyntaxError"`, que cruza realms. Y un check del mensaje.

### 6. `q.onerror` no la ejerce ningún check, y el modo `"peticion"` del fake es código muerto — **media**

Borrar `q.onerror` deja `./check.sh` en verde, y sin ella un fallo de lectura deja una promesa
colgada para siempre: `hydrateStores` no termina, `almacenRoto` no se cierra y no hay aviso. Es
el mecanismo del que depende el hallazgo 2 de la iteración 3.

**Arreglo:** un check que arranca con `idbFalla: "peticion"` y exige el aviso y el grifo cerrado.

### 7. La restauración deja el cache de CSVs de antes, y se pinta sin re-scrapear — **media**

El importador repone `rows` pero no toca `csvIndex` ni las claves `csv:<nombre>`. Tras restaurar
una copia de otro móvil, abrir esa búsqueda pinta los anuncios cacheados de antes en vez de
scrapear. Medido: `loadQuery('ford.csv')` pinta `["VIEJO del ocupante anterior"]`.

**Arreglo:** la restauración vacía el cache de CSVs. Los textos se regeneran solos: sin entrada
en `csvIndex`, abrir una búsqueda re-scrapea, que es lo que dice `src/app.js:2275-2276`.

### 8. El fake de IndexedDB no revierte al abortar — **baja**

Escribe en el Map y `onabort` no lo deshace, así que el arnés no modela la atomicidad, que es
justo la premisa con la que la iteración 3 borró la vuelta atrás de las filas.

**Arreglo:** el fake acumula las escrituras y solo las aplica al completar. Y un check que
compruebe que las filas viejas siguen ahí tras un commit abortado.

### 9. La rama del `Map` de memoria del wrapper es código muerto — **baja**

Su comentario nombra a los tests como único usuario, y los tests ya no la usan. Un navegador
siempre define `indexedDB`; sin él, `open()` rechaza y `hydrateStores` cierra el grifo con un
aviso honesto, que es mejor que un Map que no sobrevive a la recarga.

**Arreglo:** borrarla.

### 10. `queryParts` mira la cadena de prototipos — **baja**

Hallazgo propio, fuera de la review. `SINCE_LABEL[base.slice(i + 2)]` sin `Object.hasOwn`.
Reproducido: buscar `ps4--constructor` da la etiqueta
`ps4 (function Object() { [native code] })`, y ese `since` va al scraper, que compone
`SINCE_TF["constructor"]` en la petición a la API. `src/app.js:2396-2397` ya se guarda de esto,
con un comentario que nombra el peligro; a `queryParts` se le pasó.

**Arreglo:** `Object.hasOwn`, la misma guarda que la de al lado.

### 11. El texto nuevo del aviso no lo comprueba ningún check — **baja**

Sustituir la cadena entera por `"MUTANTE"` deja los siete en verde.

**Arreglo:** el check exige el texto, no solo la ausencia de «no válida».

## Lo que cambió al implementarlo

- **Hallazgo 4 se cierra solo, sin línea nueva.** El arreglo del hallazgo 1 hace que el wrapper
  ya no propague el rechazo de una escritura, así que el `null` de `transaction.error` no llega
  nunca al `.catch` que lo desreferenciaba: el importador lanza su propio error al ver
  `almacenRoto`. El check 47 conduce el caso con el modo `"anular"` del fake, que aborta dejando
  `error` a null, y exige el aviso honesto palabra por palabra. Meter la normalización habría
  sido una línea que ningún mutante puede matar.
- **Hallazgo 1 destapó una regresión propia en la migración.** `hydrateStoresRaw`
  (`src/app.js:1841-1846`) borraba `wp_rows` de localStorage después de escribir las filas en
  IndexedDB, y su comentario decía «solo si el set de arriba no lanzó». Con el wrapper tragándose
  el fallo, ya no lanza: ese borrado tiraba la única copia de las fichas. Ahora mira `almacenRoto`
  antes de borrar. El check 50 lo cubre.
- **El aviso del almacén se lleva por delante un «Deshacer», el primero y solo el primero.** Es
  el precio de avisar en el momento. Decirle al usuario que la sesión no guarda vale más que un
  botón de 5 segundos, y a partir de ahí el grifo está cerrado y no vuelve a hablar. El check 46
  lo fija en las dos direcciones.

## Fuera de alcance

Igual que en las iteraciones anteriores: `filteredRows()` dos veces en Rechazados
(`src/app.js:1333`), la guarda `typeof snack === "function"` (`src/app.js:11`), el hook de
pre-commit que mide el árbol de trabajo, y sin mirar aún el evento `storage` entre pestañas
(sospecha anotada: re-hidrata localStorage pero no `rowCache`, así que la pestaña vieja puede
machacar las filas de la otra), los checks 1-37 de `test_buttons.js`, `src/wallapop.py` fuera de
su `demo()`, y la zona visual.

## Reglas duras que aplican

1. Ninguna funcionalidad se pierde.
2. Cada hallazgo se ve **rojo antes** del arreglo, y los siete checks en verde después.
