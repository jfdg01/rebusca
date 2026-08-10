# Iteración 29 — los rincones que el arnés no alcanzaba

**Zona:** el DOM de mentira de `src/test_app.js`, y los seis sitios de `src/app.js` que llaman a
`querySelectorAll()`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** robustez. Ninguna línea de producción cambia.

## F1 — Investigar

La iteración 28 dejó una regla: **cuando un mutante evidente sobrevive, sospecha del arnés antes que
de la aserción.** Esta iteración la aplica a propósito, en vez de tropezarse con ella.

Barrido de los no-ops del DOM de mentira contra lo que `app.js` usa de verdad:

| método del arnés | cómo estaba | usos en `app.js` |
|---|---|---|
| `querySelectorAll` (elemento) | `() => []` | **10** |
| `setAttribute` | `() => {}` | 2 |
| `removeAttribute` | `() => {}` | 1 |
| `insertBefore` | `(c) => c` | 0 |
| `replaceChildren` | vacía y tira los argumentos | 0 |
| `getAttribute` / `hasAttribute` | `null` / `false` | 0 |
| `focus` / `blur` / `scrollIntoView` / `animate` | no-ops | 4 (sin efecto observable) |

Los tres primeros sí tienen consumidores. `querySelectorAll` devolvía la lista vacía **siempre**, así
que seis sitios de `app.js` eran código inalcanzable para las siete suites:

1. `document.querySelectorAll("[data-icon]")` — mete el `<svg>` de cada icono de la app.
2. `thead.querySelectorAll("th[data-col]")` — `paintSortHeaders()`, la flecha y el número de orden.
3. `document.querySelectorAll("header .panel")` — esconde los paneles en modo lista.
4. `swipeStage.querySelectorAll(".swipe-card, .swipe-done")` — limpia el escenario del mazo.
5. `box.querySelectorAll("img")` — espera a las fotos antes de imprimir el dossier.
6. `document.querySelectorAll(".link:not([role])")` — el pase de accesibilidad de los `<span>`.

Mutantes, todos **vivos**: no marcar la columna ordenada, no limpiar la flecha vieja, invertir la
flecha, quitar el número del orden secundario, no limpiar el escenario del mazo, no dar `role` a los
`.link`, no darles `tabIndex`.

## F2 — Contrato

1. **El `querySelectorAll` de un elemento recorre su subárbol de verdad.** Con un emparejador
   pequeño: lista con comas, y de cada trozo el tag, las clases y un `[data-*]` presente. Ni
   descendencia ni `:not()`; lo que no encaje devuelve `[]`, como antes.
2. **`createElement(tag)` recuerda su etiqueta.** Sin `tagName` no hay forma de casar `th[data-col]`.
3. **`setAttribute` y `removeAttribute` tocan `dataset` para los `data-*`.** En el DOM real
   `removeAttribute("data-dir")` borra `dataset.dir`.
4. **Dos comprobaciones nuevas:** las cabeceras de orden y el escenario del mazo.
5. Ninguna línea de producción cambia. Las siete suites pasan.

## F3 — Implementar

**El emparejador**, `src/test_app.js`, junto a `ELS` y `PARENT`:

```js
const matches = (el, sel) =>
  String(sel).split(",").some((s) => {
    const m = /^([a-z]*)((?:\.[\w-]+)*)(?:\[data-([\w-]+)\])?$/.exec(s.trim());
    …
  });
```

**El recorrido**, en el elemento falso: baja por `children`, se queda con los que son elementos
falsos (`ELS`) y casan. **`createElement(tag)`** guarda `tagName`. **`setAttribute` /
`removeAttribute`** escriben y borran en `dataset` cuando el nombre empieza por `data-`.

**Comprobación `12g-ter`** en `test_app.js` — las cabeceras de la tabla: sin ordenar no hay ninguna
marcada; por precio sale `precio:▲`; el reclic la pone `▼`; añadir `km` da `precio:1 ▼|km:2 ▲`; y
`clearSort()` deja cero marcadas y cero flechas pegadas.

**Comprobación `9c`** en `test_buttons.js` — el escenario del mazo tiene **una** tarjeta al abrir,
una tras dos clasificaciones, y un solo nodo con el mazo agotado.

`test_app.js`: 85 líneas nuevas; `test_buttons.js`: 19. De 415 a **418 comprobaciones**.

## F4 — Probar

Los siete checks en verde. El barrido repetido:

```
cabeceras: no marca la columna ordenada          muere
cabeceras: no limpia la marca vieja              muere
cabeceras: no limpia la flecha vieja             muere
cabeceras: la flecha va al reves                 muere
cabeceras: no numera el orden secundario         muere
cabeceras: no las repinta al limpiar             muere
orden: el reclic no invierte                     muere
mazo: no limpia las tarjetas viejas              muere
```

## F5 — Review adversaria

**1. Lo que sigue fuera de alcance, y por qué.** Tres de los seis sitios son
`document.querySelectorAll(...)` sobre marcado que vive en `index.html`. En este arnés el HTML
estático **no es un árbol**: `q(sel)` fabrica un elemento memoizado por cadena de selector, y
`document.body` no tiene hijos. Recorrer no sirve de nada ahí. Los iconos, los paneles de la
cabecera y el pase de accesibilidad de los `.link` **siguen sin medirse**, y decirlo es parte del
trabajo: el barrido de la 28 los habría contado como «cubiertos» solo porque hay checks cerca.

**2. Un mutante que elegí mal.** Probé a añadir `.swipe-stamp` al selector del mazo para ver si
el «conserva los sellos» del comentario estaba medido. Vivió — pero **por mi culpa**: los sellos son
`.sc-badge`, no `.swipe-stamp`, así que el selector no casaba con nada. Con la clase buena tampoco
se mide, por el motivo del punto 1: los sellos están en `index.html` y no cuelgan del árbol falso.
La lección repite la de la 25: **un mutante que vive porque apunta a un nombre que no existe no dice
nada; antes de anotar "VIVE" hay que comprobar que el mutante toca lo que crees.**

**3. El emparejador es corto a propósito.** No entiende descendencia, ni `:not()`, ni atributos que
no sean `data-*`. Un selector que no encaje con la expresión regular devuelve `[]`, que es
exactamente lo que devolvía antes: el arnés no puede empeorar por un selector nuevo, solo dejar de
mejorar. Si algún día hace falta, se amplía la expresión regular.

**4. No hay captura de pantalla.** `app.js`, `app.css` e `index.html` están intactos.
