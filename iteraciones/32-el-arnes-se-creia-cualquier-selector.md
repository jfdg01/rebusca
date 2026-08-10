# Iteración 32 — el arnés se creía cualquier selector

Zona: el DOM falso de `src/test_app.js`, en concreto `q(sel)` y `qa(sel)`.

Es el agujero que la iteración 29 dejó anotado y que `MEJORAS.md` tenía en «Descartados»
con la coletilla «es un riesgo del arnés, no un fallo de hoy». Dejó de serlo.

## F1 — Investigar

El arnés **fabrica un elemento por cada selector que le piden** y lo memoiza. Eso es lo que
hace que los siete checks funcionen sin navegador. También significa que
`$("#boton-que-ya-no-existe")` devuelve un objeto que se deja leer, escribir y pulsar. En el
navegador ese mismo `$` devuelve `null` y la app revienta al primer punto.

Cruzando a mano los id de `src/index.html` con los que pide `src/app.js`:

- 79 id en el HTML, 79 pedidos por `app.js`.
- Cinco pedidos no están en el HTML: `clearSort`, `rejectedExcl`, `rejectedLejos`,
  `toggleFavorite`, `toggleTrash`. No son erratas: los pinta `app.js` con `innerHTML` (la
  barra de estado y las cabeceras de orden). El universo válido no es el HTML, es **el HTML
  más los `id="..."` que `app.js` se escribe a sí misma**.

Con ese universo se puede preguntar de verdad. Poniendo el guardia y corriendo los siete
checks salió un fantasma:

```
el arnés se inventó #snackundo: ese id no está ni en index.html ni en app.js
```

`src/test_buttons.js:1879` preguntaba por `#snackundo`. El botón se llama `#undo`
(`src/app.js:1518`). La comprobación era:

```js
ok(!b.q("#snackundo").hidden === true, "el evento de la otra pestaña escondió el botón «Deshacer»")
```

El elemento inventado nace sin `hidden`, así que `!undefined === true` y la línea salía
verde **pasara lo que pasara**. Es un check muerto que llevaba contándose entre los 426.

`qa(sel)` tiene el mismo agujero por la otra puerta. Para `"#listSort button"` saca los
hijos del HTML, y si el contenedor no aparece, `htmlChildren` devuelve `[]` sin quejarse:
el bucle de `app.js` no hace nada y quien lo mire no distingue «no hay botones» de «los
botones ya no se llaman así».

## F2 — El contrato

**Nada de funcionalidad se pierde.** Esto solo toca el arnés y una línea de una prueba.

1. **`IDS`**, el universo de id que existen: los de `index.html` más los de `app.js`.
2. **`q(sel)` revienta** si el selector es un `#id` que no está en `IDS`. Los selectores por
   clase o compuestos se siguen fabricando: validar clases es otra discusión y otro coste.
3. **`qa(sel)` revienta** si el selector casa con su gramática (`#id tag`) y el contenedor
   no tiene ni un hijo de esa etiqueta en el HTML.
4. **El fantasma se arregla**, no se borra: `#snackundo` pasa a `#undo` y la aserción se
   escribe en su forma directa (`hidden === false`). Con el id bueno, la comprobación pasa:
   el comportamiento de producción era correcto, lo muerto era el check.

Lo que **no** se hace, y por qué:

- **La dirección contraria (markup muerto).** Un id en `index.html` que nadie nombra es un
  resto, y en esta tanda ya han salido dos (`perfilOpts` y `swExcl`, iteración 27). Un
  barrido a mano da tres falsos positivos —`lim_precio`, `lim_dias`, `lim_km`— porque
  `app.js` los pide como `$("#lim_" + c)`. Automatizarlo pide una lista de prefijos
  dinámicos escrita a mano, que es exactamente contra lo que avisa la regla de la iteración
  31: una lista a mano dentro de una prueba envejece en silencio. Se deja fuera a
  conciencia.

## F3 — Implementar

`src/test_app.js`: `IDS` (6 líneas), el guardia de `q` (3), el guardia de `qa` (4).
`src/test_buttons.js`: una línea, la del fantasma.

## F4 — Probar

Los siete checks en verde, 426 comprobaciones. Y los guardias tienen que aguantar peso:
se renombra un id en cada uno de los tres sitios que importan y `./check.sh` tiene que
salir en rojo.

## F4 — Resultado

Los siete checks en verde, 426 comprobaciones. Siete mutantes, siete muertos:

```
index.html: se renombra el id de un botón             muere
index.html: se renombra el contenedor #listSort       muere
app.js: el id que pinta la barra de estado cambia     muere
app.js: errata al pedir el botón Deshacer             muere
test_buttons: vuelve el fantasma #snackundo           muere
test_app: se quita el guardia de q                    muere
test_app: se quita el guardia de qa                   muere
```

Los dos últimos no morían al principio, y eso era lo esperado: a la prueba no la prueba
nadie, quitar un guardia solo hace la suite más permisiva y ningún check lo nota. Por eso
el arnés se comprueba a sí mismo en el bloque 0: pide un id inventado y un contenedor
inventado, y exige que las dos peticiones revienten. Con ese bloque delante, quitar
cualquiera de los dos guardias sale en rojo.

## F5 — Review adversaria

**El orden de las fases se rompió, y conviene decirlo.** El guardia se escribió durante F1,
antes del doc. No fue por saltarse el método: sin ponerlo no había forma de saber cuántos
selectores fantasma había ni de qué clase, y la respuesta —uno, en `test_buttons.js`— es lo
que decidió el alcance. La investigación necesitaba código. Lo que sí se respetó es que el
contrato de F2 se cerró antes de tocar nada más.

**El guardia solo mira id.** `q(".foo")`, `q("header .panel")` y `q(".link:not([role])")`
se siguen fabricando sin preguntar. Son tres sitios reales de `app.js` que la iteración 29
ya dejó anotados como no medidos, y siguen sin medirse. Validar clases pide cotejar contra
el CSS y el HTML a la vez, con los selectores compuestos por medio; es otra iteración, no
una línea más de esta.

**El fantasma pudo no ser el único de su especie.** El guardia caza los inventados, no los
**equivocados pero existentes**: `b.q("#snack")` donde se quería `#snackmsg` pasa limpio,
porque los dos id existen. Ese caso no lo cubre nada, y no hay atajo barato: distinguirlo
pide saber qué esperaba el check, que es justo lo que el check dice mal.

**El recuento no cambia.** Siguen siendo 426 comprobaciones, pero una de ellas ha dejado de
ser decorativa. El número no mide nada por sí solo, y este es el ejemplo: durante meses
incluyó una línea que salía verde con la app rota.

**Regla nueva para el método:** *un arnés que fabrica lo que le piden convierte una errata
en un check verde. El arnés tiene que saber qué existe de verdad, y quejarse cuando le
piden otra cosa.*
