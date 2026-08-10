# Iteración 37 — el botón atrás y el fondo inert

Zona: `src/app.js:2587-2596` (`enterOverlay`/`exitOverlay`) y `src/app.js:3155-3194`
(`anyOpen`/`closeTop`/`reconcileBack` + el manejador de `popstate`).

Elegida por daño al usuario: el botón atrás del móvil es la única superficie sin botón propio en
pantalla. Si se rompe, el usuario sale de la app en vez de cerrar la capa que tenía abierta. Y el
fondo `inert` es lo que atrapa el foco dentro del overlay; sin él, el teclado y el lector de
pantalla se van al fondo tapado.

## F1 — Investigar

16 mutantes, veredicto por el código de salida de `./check.sh`.
**4 mueren, 12 VIVEN.**

El único check que existía (bloque 28 de `test_buttons.js`) mide el gestor de búsquedas. El mazo y
la lista son las otras dos capas, y son las que el usuario tiene abiertas casi siempre: borrar la
rama del mazo de `anyOpen` o de `closeTop` pasaba los siete checks.

| mutante | veredicto en F1 |
| --- | --- |
| `anyOpen`: ignora la lista | VIVE |
| `anyOpen`: ignora el gestor | muere |
| `anyOpen`: ignora el mazo | VIVE |
| `closeTop`: no cierra el gestor | muere |
| `closeTop`: no cierra el mazo | VIVE |
| `closeTop`: no cierra la lista | VIVE |
| `closeTop`: dice que cerró algo sin cerrar nada | VIVE |
| `reconcileBack`: sin idempotencia | VIVE |
| `reconcileBack`: no retira la entrada al cerrar por UI | muere |
| `reconcileBack`: no arma la entrada | muere |
| `popstate`: cierra aunque no estuviera armado | VIVE |
| `popstate`: no re-arma la capa que queda | VIVE |
| `popstate`: no desarma | VIVE |
| `enterOverlay`: no marca el fondo `inert` | VIVE |
| `enterOverlay`: no lleva el foco | VIVE |
| `exitOverlay`: deja el fondo `inert` | VIVE |

### Hallazgo A — el arnés no sabía nada del foco

`makeEl` daba `focus() {}` y `blur() {}` vacíos. Con eso, `enterOverlay` podía dejar de llevar el
foco al overlay sin que nada se enterase.

Y no había manera de espiarlo desde fuera: el `get` del Proxy mira el objeto `api` **antes** que el
estado, así que un `el.focus = miEspía` desde el test se escribía en el estado y no se leía nunca.
El check que escribí primero con esa técnica no medía nada.

### Hallazgo B — `Boolean(propiedad que nadie asignó)` es siempre `true`

Mi primer check del fondo `inert` decía `[header.inert, main.inert].map(Boolean)`. El Proxy del
arnés devuelve una función comodín para toda propiedad sin asignar, y una función es truthy. Con
`enterOverlay` vacío el check seguía verde. Es la tautología de la iteración 33, con otra cara.

### Hallazgo C — el agujero de los selectores, por la puerta de las etiquetas

La iteración 32 le puso al arnés una lista de los `id` que existen de verdad. `querySelector("header")`
no lleva `#`, así que esa lista no lo mira: el arnés fabricaba la etiqueta sin preguntar. `overlayBg`
apunta a `header` y `main`; si el HTML deja de tenerlas, la a11y de los overlays sale verde y el
fondo queda navegable en el navegador.

### Sin defecto de producción

Los 12 mutantes vivos apuntan a comprobaciones que faltan, no a código roto. Es un resultado, y se
escribe tal cual.

## F2 — Documentar (el contrato)

1. **Producción: sin cambios.** La lógica del atrás y del `inert` es correcta.
2. **Arnés** (`test_app.js`): `focus()`/`blur()` dejan rastro en el estado del elemento; los
   selectores de etiqueta se comprueban contra `index.html` igual que los `id`.
3. **Checks nuevos** (bloque 28b de `test_buttons.js`), uno por capa y uno por invariante:
   - abrir el mazo y abrir la lista arman la entrada sintética; el atrás las cierra;
   - con dos capas abiertas hay **una** entrada, el atrás cierra solo la de arriba y deja armada
     la de abajo;
   - el atrás que cierra la última capa no puede pedir otro atrás (eso saca de la página);
   - con el overlay puesto, `header` y `main` quedan `inert` y el foco entra en el overlay;
   - al cerrar, el fondo vuelve a ser navegable.

## F3 — Implementar

`src/test_app.js`, tres retoques:

```js
focus() { st.focused = true; },
blur() { st.focused = false; },
```

```js
const TAGS = new Set(["html", "head", "body",
  ...[...HTML.matchAll(/<([a-zA-Z][\w-]*)[\s/>]/g)].map(([, t]) => t.toLowerCase())]);
```

```js
const tag = /^[a-zA-Z][\w-]*$/.test(sel) && sel.toLowerCase();
if (tag && !TAGS.has(tag))
  throw new Error(`el arnés se inventó <${tag}>: esa etiqueta no está en index.html`);
```

`html`, `head` y `body` van sembradas a mano: HTML5 deja escribirlas implícitas, e `index.html` no
las lleva.

`src/test_buttons.js`: el bloque 28b. La suite pasa de 451 a 467 comprobaciones.

## F4 — Probar

**13 de los 16 mutantes mueren, cada uno por su propio motivo.**

| mutante | motivo con el que muere |
| --- | --- |
| `anyOpen`: ignora la lista | `abrir la lista no armó la entrada sintética de historial` |
| `anyOpen`: ignora el gestor | `abrir el gestor no armó la entrada sintética de historial` |
| `anyOpen`: ignora el mazo | `abrir el mazo no armó la entrada sintética de historial` |
| `closeTop`: no cierra el gestor | `el botón atrás no cerró el gestor` |
| `closeTop`: no cierra el mazo | `el botón atrás no cerró el mazo` |
| `closeTop`: no cierra la lista | `el botón atrás no cerró la lista` |
| `reconcileBack`: sin idempotencia | `la segunda capa duplicó la entrada de historial: 2` |
| `reconcileBack`: no retira la entrada al cerrar por UI | `cerrar por UI dejó la entrada sintética colgando` |
| `reconcileBack`: no arma la entrada | `abrir el gestor no armó la entrada sintética de historial` |
| `popstate`: no desarma | `la capa que queda abierta se quedó sin entrada de historial` |
| `enterOverlay`: no marca el fondo `inert` | `el mazo abierto deja el fondo navegable: false,false` |
| `enterOverlay`: no lleva el foco | `abrir el mazo no llevó el foco al overlay` |
| `exitOverlay`: deja el fondo `inert` | `al cerrar el mazo el fondo se queda inert: true,true` |

Y la guarda nueva del arnés, medida aparte: con `overlayBg` apuntando a `hedaer` en vez de a
`header`, `node src/test_app.js` sale en rojo con `el arnés se inventó <hedaer>`.

Los siete checks en verde, 467 comprobaciones.

## F5 — Review adversaria

### Los 3 mutantes que siguen vivos, y por qué se quedan

Los tres viven por el mismo motivo: piden un estado que `reconcileBack` no deja existir. La
función corre en cada `render()`, en `openManager`, en `closeManager` y en `openSwipe`, así que
`rbArmed` y `anyOpen()` no se pueden separar.

1. **`closeTop`: `return false` → `return true`.** Solo se nota si llega un `popstate` armado sin
   nada abierto.
2. **`popstate`: quitar la guarda `wasArmed &&`.** El mismo estado imposible.
3. **`popstate`: quitar el `reconcileBack()` del final.** Las tres funciones que cierra `closeTop`
   ya lo llaman ellas (`closeManager` directo; `closeSwipe` y `#listBack` a través de `render()`).

**Se quedan a propósito.** Quitarlas acorta tres líneas y cambia una guarda explícita por un
contrato implícito: «toda superficie que se cierre tiene que acordarse de reconciliar». Eso es lo
que rompe el próximo cambio. La regla de la iteración 12 vale igual aquí: un freno que no se
dispara no es código muerto, es el freno.

### Dos checks míos no medían nada

Los dos hallazgos A y B salieron de mis propios checks, no del código de producción. Los dos daban
verde contra el mutante.

**La regla:** un check contra el arnés mide el arnés. Antes de creerte un verde sobre una propiedad
del DOM falso, comprueba que esa propiedad **cambia** — que el valor de antes y el de después no
son el mismo. Una propiedad que nadie asigna, y un método que no deja rastro, dan el mismo verde
que el código correcto.
