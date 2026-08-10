# Iteración 24 — los topes del cajón y el recuento de la barra

**Zona:** `src/app.js`, el `onchange` de `#lim_*`, la línea de `renderExcl()` que repinta los
inputs, y el recuento de vetados de `paintStat()`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** red que falta. Los tres hallazgos ya estaban medidos: son los mutantes que salieron
**VIVOS** en el barrido de la iteración 22 y que aparqué entonces.

## F1 — Investigar

Los topes por cajón (`precio`, `dias`, `km`) sacan filas del mazo igual que una palabra vetada.
Tres piezas los sostienen, y el barrido de la iteración 22 dejó las tres sin red:

```
lim: el cajón vacío no se limpia        VIVE
lim: el input no refleja lo guardado    VIVE
stat: cuenta como vetado lo ya clasificado  VIVE
```

**1. El cajón vacío no se limpia.** `src/app.js:1184`:

```js
if (!Object.keys(m).length) delete limMap[curDrawer()];
```

Sin esa línea, quitar el último tope deja `{"ford.csv":{}}` en `wp_lim` en vez de `{}`. No cambia
lo que ve el usuario hoy, pero sí lo que se guarda, lo que se exporta y lo que viaja en el blob
`wp_estado`. Es exactamente el mismo fallo que la iteración 21 cerró para las categorías (check
72: *"destildar la última categoría deja el cajón vacío en el almacén"*). El mismo defecto en la
pieza de al lado, sin red.

**2. El input no refleja lo guardado.** `src/app.js:1166`:

```js
for (const [c] of LIMITS) $("#lim_" + c).value = limits()[c] ?? "";
```

Los topes se guardan **por cajón**. El input es uno solo, compartido por todas las búsquedas.
Sin esa línea, cambiar de búsqueda deja en pantalla el número de la búsqueda anterior: el filtro
que se aplica y el número que se lee dejan de ser el mismo. El check 18 ya mide que el tope
**filtra** y que se **guarda**; nadie mide que se **repinte**.

**3. El recuento de vetados cuenta lo ya clasificado.** `src/app.js:1198`:

```js
const vetados = hasExcl ? data.filter((r) => !clasif(r) && isExcluded(r)).length : 0;
```

`clasif(r)` es "ya está en un cubo" (rechazado o favorito). Sin ese `!clasif(r)`, una fila
rechazada **y** vetada se cuenta dos veces. Y el daño no se queda en su línea: `sinVer` se calcula
restando, `src/app.js:1215`:

```js
const sinVer = data.length - favoriteCount - disc - vetados;
```

Una fila contada dos veces baja el "sin ver" por debajo de lo real. Con suficientes filas
rechazadas y vetadas, el número sale **negativo**. Es el recuento que el usuario mira para saber
si le queda trabajo.

## F2 — Contrato

1. **Quitar el último tope borra el cajón entero de `wp_lim`.** El almacén queda en `{}`, no en
   `{"ford.csv":{}}`.
2. **Al cambiar de cajón, los inputs `#lim_*` muestran los topes de ese cajón.** Si el cajón
   nuevo no tiene tope, el input sale vacío, no con el número del cajón anterior.
3. **Una fila ya clasificada no cuenta como vetada.** El "N excluidos" y el "N sin ver" de la
   barra cuadran con las filas que hay.
4. Ninguna funcionalidad cambia. Solo se añaden comprobaciones.

## F3 — Implementar

Cero líneas de producción. Solo red, en `src/test_buttons.js`:

- **Check 18**, una aserción más al final: quitar el último tope deja `wp_lim` en `{}`.
- **Check 18b, nuevo**: el input del tope muestra el del cajón que se está viendo.
- **Check 20b, nuevo**: una fila ya rechazada no se cuenta también como vetada, ni en el total
  ni en el desglose por motivo.

De 396 a **402 comprobaciones**.

## F4 — Probar

Las siete suites en verde. Barrido sobre las cuatro líneas:

```
lim: el cajón vacío no se limpia               muere  FAIL: quitar el último tope deja el cajón vacío en el almacén: {"ford.csv":{}}
lim: el input no refleja lo guardado           muere  FAIL: al volver al cajón con tope el input no lo muestra:
stat: cuenta como vetado lo ya clasificado     muere  FAIL: el rechazado se sigue contando como vetado: …<b>1</b> exclui…
stat: el desglose por tope también lo cuenta   muere  FAIL: el desglose cuenta como tope un anuncio ya rechazado: …<b>1</b> excluidos por to…
lim: el tope 0 se guarda como tope             muere  FAIL: #lim_precio no quitó el tope al vaciarlo
```

Los tres primeros son los que la iteración 22 dejó **VIVOS**. El cuarto salió en este barrido:
misma forma de fallo en la línea de al lado. El quinto ya lo cubría el check 18.

## F5 — Review adversaria

**1. El primer borrador del check 18b medía otra cosa.** Escribí `loadCSV(texto, "otra.csv")`
para cambiar de búsqueda. Falló: el input seguía en `300`. Y **no era el defecto** —
`loadCSV()` mueve `loadedCsv`, no `curCsv`, y `limits()` lee `limMap[curDrawer()]`, que sale de
`curCsv`. El cajón nunca cambió, así que `300` era la respuesta correcta. Cambiado a
`selectQueryUI(csv); render()`, que es lo que hace el gesto de verdad. La regla de la iteración 20
otra vez, del otro lado: **un check que falla por el motivo equivocado tampoco es un check**.

**2. Por qué el mutante del desglose no lo mataba el check del total.** `porTexto` no se cuenta:
se resta (`vetados - porTope`). Con el total bien y el desglose mal, la resta da `0` y `dosMotivos`
se apaga; la línea entonces dice *"1 excluidos por tope"* cuando el veto vivo es el de la palabra.
El número sale bien y el motivo miente. Por eso hace falta una aserción sobre el texto del motivo,
no solo sobre la cifra.

**3. Lo que no se toca.** El cajón vacío en `wp_lim` no cambia nada de lo que el usuario ve hoy:
`Object.keys({}).length` es `0`, igual que si la clave no estuviera. La red está porque ese cajón
vacío sí viaja al blob `wp_estado`, al fichero de copia y a la fusión de `foldDrawers`, y porque
la iteración 21 encontró el mismo defecto en las categorías. Un patrón que ya falló una vez merece
red en todas sus copias.
