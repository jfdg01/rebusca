# Iteración 36 — el dedo sobre la tarjeta

Zona: `src/app.js:2666-2773` — `decide`, `dragify`, `fling`, `swUndo`.
Elegida por daño al usuario: el mazo se usa con el dedo, y el móvil es el sitio donde se usa
Rebusca. Un gesto que decide mal clasifica un anuncio que el usuario no quería, y en el mazo cada
anuncio pasa una sola vez.

## F1 — Investigar

25 mutantes, veredicto por el código de salida de `./check.sh`.
**11 mueren, 11 VIVEN, 3 mutadores rotos** (el texto que elegí sale dos veces en el fichero).

| mutante | veredicto |
| --- | --- |
| `decide`: umbral de distancia a 6px | muere |
| `decide`: sin flick rápido | muere |
| `decide`: el flick a la izquierda con el signo mal | muere |
| `decide`: cualquier gesto clasifica | muere |
| `dragify`: sin espera de intención (8px) | VIVE |
| `dragify`: el eje vertical no gana margen (1.4) | VIVE |
| `dragify`: el arrastre vertical también mueve la tarjeta | VIVE |
| `dragify`: arrastra desde un botón | muere |
| `dragify`: sin captura del puntero | VIVE |
| `dragify`: `pointercancel` no suelta | VIVE |
| `dragify`: el sello se pinta de los dos lados | VIVE |
| `fling`: el favorito no saca de rechazados | VIVE |
| `fling`: el rechazo no saca de favoritos | VIVE |
| `fling`: no bloquea la doble decisión | VIVE |
| `fling`: los botones no se ven bloqueados | muere |
| `fling`: avanza sobre un mazo ajeno | muere |
| `fling`: no avanza de tarjeta | muere |
| `fling`: no apunta nada para deshacer | muere |
| `swUndo`: con la pila vacía sigue | VIVE |
| `swUndo`: no repone el sello previo | muere |
| `swUndo`: no vuelve a la tarjeta | muere |
| `nextCard`: el botón deshacer siempre activo | VIVE |

### Hallazgo A — un defecto de verdad: el gesto cancelado clasifica

```js
root.onpointerup = root.onpointercancel = (e) => { ... if (d) return fling(d); ... }
```

`pointercancel` no es soltar. Lo dispara el sistema cuando se lleva el dedo: entra una llamada,
el navegador decide que aquello era un scroll, aparece un gesto del sistema operativo. Tratarlo
igual que un `pointerup` **clasifica el anuncio sin que el usuario suelte**, y con la regla del
flick basta un movimiento corto y rápido para que `decide` devuelva 1.

En el mazo cada anuncio pasa una sola vez. Un rechazo así lo esconde.

Es el único mutante de los 11 que apunta a un fallo de producción. Los otros 10 apuntan a
comprobaciones que faltan.

### Hallazgo B — el bloque 32 mide que el arrastre vertical no clasifica, no que deje scrollear

El check que ya existe (`test_buttons.js:943-951`) comprueba que un arrastre vertical no cambia de
tarjeta. Con `if (axis !== "x") return;` borrado eso sigue siendo cierto, porque `pointerup` mira
`axis === "x"`. Lo que se pierde es otra cosa: `e.preventDefault()` corre sobre el movimiento
vertical y **la descripción de la tarjeta deja de scrollear en el móvil**. Y la tarjeta se tuerce
mientras el dedo sube.

### Hallazgo C — los dos cubos pueden acabar con el mismo anuncio

`fling` hace `favorite.add(k); rejected.delete(k)`. El `delete` es el que mantiene los cubos
exclusivos, y no lo mide nadie. La carta en pantalla SÍ puede estar ya clasificada: otra pestaña
la clasifica, o un enlace de la IA con `?no=` la reparte mientras el mazo está abierto.

### Hallazgo D — «Deshacer» con la pila vacía

Dos guardas, ninguna medida: `if (!h) return` dentro de `swUndo`, y
`$("#swUndo").disabled = !undoStack.length` en `nextCard`. Rotas las dos, pulsar «Deshacer»
nada más abrir el mazo lanza un `TypeError`.

### Hallazgo E — la espera de intención de 8px, la doble decisión y los sellos

- Sin los 8px, un toque con un temblor de 3px decide el eje, y al soltar rápido `decide` ve una
  velocidad enorme y clasifica.
- `card = null` bloquea una segunda decisión durante los 200 ms del vuelo.
- `likeStamp` y `nopeStamp` se pintan con el signo de `dx`: sin él salen los dos sellos a la vez.

### Lo que se queda sin medir, y por qué

- **El margen de 1.4 del eje vertical.** Es una constante de ajuste, no una regla. Un check
  clavaría un número que se toca con el dedo puesto en un móvil de verdad.
- **`setPointerCapture`.** Medirlo en un DOM falso solo comprueba que se llama a la función, que
  es la tautología de la iteración 33 otra vez. Lo que hace de verdad (seguir recibiendo eventos
  cuando el dedo sale del elemento) no existe en el arnés.

## F2 — Documentar (el contrato)

1. **Producción, una línea:** `pointercancel` cancela; no decide. `pointerup` sigue igual.
2. Checks nuevos (bloque 32b de `test_buttons.js`), uno por hallazgo:
   - el arrastre vertical no llama a `preventDefault` ni mueve la tarjeta; el horizontal SÍ frena;
   - un gesto cancelado no clasifica y devuelve la tarjeta al centro;
   - un anuncio ya rechazado que se manda a favoritos sale de rechazados (y al revés);
   - «Deshacer» empieza deshabilitado y no revienta si se le llama con la pila vacía;
   - un temblor de 3px no clasifica;
   - una segunda decisión durante el vuelo no cuenta;
   - los dos sellos no se encienden a la vez.

## F3 — Implementar

**Producción, una línea** (`src/app.js:2716`):

```js
const d = e.type === "pointercancel" ? 0 : decide(dx, dx / Math.max(1, e.timeStamp - t0));
```

El resto del manejador no cambia: `pointercancel` sigue soltando la tarjeta, quitando la clase
`grab`, devolviéndola al centro y apagando los sellos. Lo único que ya no hace es clasificar.

**Checks: el bloque 32b de `test_buttons.js`.** El bloque 32 mide lo que el dedo consigue. El 32b
mide lo que no puede pasar. La suite pasa de 426 a 451 comprobaciones.

## F4 — Probar

15 mutantes sobre la zona, veredicto por el código de salida de `./check.sh`, y el motivo por la
primera línea `FAIL` de `node src/test_buttons.js`. **Los 15 mueren, cada uno por lo suyo.**

| mutante | motivo con el que muere |
| --- | --- |
| sin espera de intención (8px) | `un temblor de 3px clasificó la tarjeta` |
| el arrastre vertical también mueve | `el arrastre vertical se come el scroll de la descripción: 1 frenazos` |
| el sello se pinta de los dos lados | `los dos sellos se encienden a la vez: like=0.33 nope=0.33` |
| el sello del rechazo siempre encendido | `los dos sellos se encienden a la vez: like=0.33 nope=0.33` |
| `pointercancel` no suelta | `el gesto cancelado dejó la tarjeta torcida: translateX(-40px)…` |
| **el gesto cancelado decide** | `el gesto que canceló el sistema clasificó la tarjeta` |
| la tarjeta cancelada no vuelve al centro | `el gesto cancelado dejó la tarjeta torcida: translateX(-40px)…` |
| el sello no se apaga al soltar | `los sellos se quedaron encendidos sobre la tarjeta siguiente` |
| `fling`: el favorito no saca de rechazados | `el anuncio quedó en los dos cubos a la vez tras #swYes` |
| `fling`: el rechazo no saca de favoritos | `el anuncio quedó en los dos cubos a la vez tras #swNo` |
| `fling`: no bloquea la doble decisión | `un gesto durante el vuelo decidió otra vez: 2` |
| `fling`: sin sello de hora | `clasificar no refrescó el sello` |
| `fling`: no guarda los cubos | `#swYes no mandó la carta a favoritos` |
| `swUndo`: con la pila vacía sigue | `«Deshacer» con la pila vacía revienta` |
| `nextCard`: el botón deshacer siempre activo | `«Deshacer» se ofrece sin nada que deshacer` |

Los siete checks en verde, 451 comprobaciones.

## F5 — Review adversaria

**Dos de mis checks nuevos no distinguían nada en el primer barrido.** Los dos mutantes sobrevivían
con el check ya escrito, y el check pasaba en verde igual.

1. *sin espera de intención*. Mi temblor era de 3px en 10 ms: 0.3 px/ms, por debajo del umbral de
   flick de 0.5. Sin la guarda de los 8px el gesto tampoco clasificaba, así que el mutante vivía por
   un número que yo había elegido, no por la producción. Con `ts=2` (1.5 px/ms) el temblor es un
   flick de libro y el mutante muere.
2. *el sello se pinta de los dos lados*. Mi gesto arrastraba solo a la derecha, y ahí el mutante y
   el código correcto pintan lo mismo. Hizo falta el movimiento espejo hacia la izquierda.

**La regla:** un check contra un umbral tiene que caer del lado que quiere medir, y un check contra
una simetría tiene que visitar los dos lados. Escribir el gesto no basta; hay que elegir los números
y el signo con el mutante delante.

**Tres mutadores rotos**, y ninguno decía nada: el texto que corté salía dos y cinco veces en
`app.js`. `rejected.delete(k);` sale cinco veces; `stampNow(k); saveBuckets();` sale dos. Recortados
con la línea de arriba pegada, los tres mueren. Vale la regla de la iteración 30: un `MUTADOR ROTO`
no es un resultado.

**Sigue sin medir, a propósito** (ya en F1): el margen de 1.4 del eje vertical, que es una constante
de ajuste, y `setPointerCapture`, que en un DOM falso solo se puede comprobar como llamada.
