# Iteración 21 — los chips de categoría y el vendedor que se sugiere

**Zona:** `src/app.js`, `sellerCandidates()` (a quién ofrece bloquear el mazo) y la parte de la
interfaz de los chips de categoría (`renderCatChips`, `#catMode`, `#catClear`).
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

`sellerCandidates` no aparece ni una vez en las suites: 0 menciones en `test_buttons.js` y en
`test_app.js`. El filtro de categoría sí está probado por dentro (`exclPorTexto`, el modo incluir),
pero la interfaz que lo maneja no. Trece mutantes, nueve vivos.

```
cat: el modo incluir se ignora                       muere
cat: el filtro de categoría no filtra                muere
cat: el modo por defecto es incluir                  muere
cat: destildar no limpia el cajón vacío              VIVE
cat: el chip no se pinta apagado                     VIVE
cat: "limpiar" sale con 0 marcadas                   VIVE
cat: la categoría vacía cuenta                       VIVE
vend: sugiere con 1 rechazo                          VIVE
vend: sugiere sin anuncios frescos                   VIVE
vend: sugiere al ya bloqueado                        VIVE
vend: el orden de sugerencia se invierte             VIVE
vend: cuenta como fresco lo excluido                 VIVE
vend: sin columna vendedor no para                   VIVE
```

### Qué pierde el usuario

**El banner de bloqueo es una acción destructiva de un solo clic.** "Rechazar siguientes" manda a
la papelera todos los anuncios frescos del vendedor. Quién sale ahí, y en qué orden, decide qué
se borra. Hoy nada lo mide.

**1. El umbral de 2 rechazos** (`src/app.js:1426`). Con uno solo, la app propone borrar a un
vendedor por un anuncio que no gustó. La sugerencia es un patrón, no una casualidad.

**2. Sugerir sin anuncios frescos** (`src/app.js:1426`). El banner ofrece "rechazar siguientes"
cuando no hay siguientes: un botón que no hace nada, sobre un vendedor ya agotado.

**3. Sugerir a un vendedor ya bloqueado** (`src/app.js:1426`). El bloqueo ya está puesto y el
banner insiste en cada carta.

**4. El orden de la sugerencia** (`src/app.js:1429`). El primero de la lista es el que se ve. Al
revés, el mazo propone antes al vendedor con menos rechazos que al que se repite más.

**5. Lo excluido cuenta como fresco** (`src/app.js:1423`). Un anuncio fuera del mazo por una
palabra vetada, por un tope o por estar lejos no es un "siguiente". Sin la guarda, la app propone
bloquear por anuncios que el usuario ya no ve, y el bloqueo se los lleva a la papelera de verdad.

**6. La categoría vacía pinta un chip** (`src/app.js:1084`). Un CSV con la columna `categoria` en
blanco genera un chip sin nombre, que se puede pulsar y veta "".

**7. El chip del modo incluir se pinta al revés** (`src/app.js:1092`). En modo incluir, la
categoría marcada es la única que se conserva. Si se pinta apagada, el usuario lee lo contrario de
lo que pasa.

**8. "Limpiar" con 0 categorías marcadas** (`src/app.js:1109`). Un botón visible que no limpia nada.

**9. Destildar deja el cajón vacío en el almacén** (`src/app.js:1099`). `wp_catexcl` acumula
`{"ford.csv":[]}` por cada búsqueda que se tocó y se dejó como estaba. Nunca se limpia solo.

### El que se queda fuera, con el motivo

**`sellerCandidates` sin columna `vendedor`.** Igual que `enforceBlocks` en la iteración 20: sin la
salida temprana, `col(r, "vendedor")` devuelve `undefined` en cada fila y el `if (!s) continue` de
dentro la salta. Devuelve `[]` por los dos caminos. Mutante equivalente.

## F2 — Contrato

1. **El banner sugiere a partir de 2 rechazos, no de 1.**
2. **No sugiere a un vendedor sin anuncios frescos.**
3. **No sugiere a un vendedor ya bloqueado.**
4. **Sugiere primero al de más rechazos.**
5. **Un anuncio excluido del mazo no cuenta como fresco.**
6. **La categoría vacía no pinta chip.**
7. **En modo incluir, la categoría marcada se pinta encendida.**
8. **"Limpiar" está oculto mientras no haya categorías marcadas.**
9. **Destildar la última categoría borra la entrada del cajón en `wp_catexcl`.**

No se toca `src/app.js`.

## F3 — Implementar

Sin cambios en producción. Checks en `src/test_buttons.js`, más un CSV de prueba con dos
vendedores de distinto número de rechazos y una fila sin categoría.

## F4 — Probar

Checks 70, 71 y 72 en `src/test_buttons.js` (364 → 378 comprobaciones), con un CSV nuevo
(`CSV_VEND`). Los nueve mutantes que vivían ahora mueren:

```
vend: sugiere con 1 rechazo                muere  FAIL: propone bloquear por UN solo rechazo: Ana
vend: sugiere sin anuncios frescos         muere  FAIL: sigue proponiendo a un vendedor sin anuncios frescos: no hay 'siguientes' que rechazar, Ana,Bea
vend: sugiere al ya bloqueado              muere  FAIL: propone bloquear a un vendedor ya bloqueado: Bea
vend: el orden de sugerencia se invierte   muere  FAIL: no propone primero al vendedor con más rechazos: Bea,Ana
vend: cuenta como fresco lo excluido       muere  FAIL: cuenta como fresco un anuncio excluido del mazo: ["Ana"]
cat: la categoría vacía cuenta             muere  FAIL: la fila sin categoría pintó un chip sin nombre: ["Coches (6)"," (1)"]
cat: el chip no se pinta apagado           muere  FAIL: en modo incluir la categoría marcada se pinta apagada, que es lo contrario de lo que hace
cat: "limpiar" sale con 0 marcadas         muere  FAIL: 'limpiar' se ve sin ninguna categoría marcada
cat: destildar no limpia el cajón vacío    muere  FAIL: destildar la última categoría deja el cajón vacío en el almacén: {"ford.csv":[]}
```

`src/app.js` queda igual que en `main` tras el barrido. `./check.sh` en verde.

## F5 — Review adversaria

**El CSV nuevo hizo falta por el orden, no por el resto.** Con `CSV_ANA` solo hay un vendedor con
rechazos, y un mutante que invierte el `sort` de una lista de un elemento no se puede distinguir.
Dos vendedores con recuentos distintos (Ana 3, Bea 2) es el mínimo que separa los dos órdenes.

**El check del chip vacío mira el texto, no el número de chips.** Contar chips lo ataría al número
de categorías del CSV, y añadir una fila a `CSV_VEND` lo rompería sin que nada esté mal. Mirar que
ningún chip empiece por `(` es lo que dice el contrato: un chip sin nombre.

**La secuencia del check 70 mide en el orden en que el usuario llega.** Cada `rechaza()` mueve el
escenario un paso, y el mismo bloque cubre el umbral, el orden, el agotamiento y el bloqueo. Un
check por escenario habría repetido cuatro arranques de la app para medir el mismo objeto.
