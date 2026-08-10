# Iteración 17 — lo que se promete y no se cumple

**Zona:** `src/app.js`, triaje + deshacer + escritura en `localStorage`.
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

Barrido de mutantes sobre la zona de triaje de `src/app.js`. Un mutante es una línea de
producción rota a propósito. Se corre `./check.sh`. El mutante **muere** si algún check se
pone en rojo. El mutante **VIVE** si los siete pasan en verde: entonces esa línea no la
defiende nadie, y quien la borre por error se va a `main` sin enterarse.

Tabla medida en este worktree, con `src/app.js` restaurado entre mutante y mutante:

```
reject: no saca el anuncio de favoritos              muere
reject: deshacer no devuelve el favorito             VIVE
restore: no desbloquea al vendedor                   VIVE
fling: no guarda el sello previo                     VIVE
swUndo: el sello previo se ignora                    VIVE
fling: no mira si el mazo cambió en el vuelo         muere
fling: no bloquea los botones en el vuelo            muere
unseenCount: no descuenta lo ya triado               muere
setLS: dice que guardó cuando no guardó              VIVE
```

Cinco vivos, y cuentan la misma historia: **la app promete deshacer, y nadie mide la
promesa.** Los checks de `test_buttons.js` comprueban que la acción se hace. Ninguno
comprueba que deshacerla devuelve el mundo a donde estaba.

El quinto es de otra familia y es el más grave: `setLS` devuelve `true`/`false` para decir
si la escritura entró. Ese valor decide dos cosas, y las dos pierden datos del usuario si
miente.

### Los cinco, uno a uno

**1. `reject` deshecho no devuelve el favorito** (`src/app.js:1516`). Los cubos son
exclusivos: rechazar un anuncio lo saca de favoritos. `reject` se guarda `wasFavorite`
antes, y el `snack` de deshacer lo repone. Si `wasFavorite` se ignora, deshacer deja el
anuncio en "sin ver": el usuario recupera el anuncio pero pierde que era favorito, y no hay
segundo deshacer.

**2. `restore` no desbloquea al vendedor** (`src/app.js:1535`). Sacar un anuncio de la
papelera llama a `unblockFor`, que quita al vendedor de `blockSel`. Sin eso, el anuncio
vuelve a estar sin rechazar pero su vendedor sigue bloqueado, así que el anuncio no aparece:
el usuario pulsa Restaurar y no pasa nada visible. El deshacer del propio `restore` vuelve a
bloquear (`reblock`), y eso tampoco lo mide nadie.

**3 y 4. El sello previo se pierde al deshacer un swipe** (`src/app.js:2757` y `2795`).
`stamp[k]` es la marca de cuándo se triado un anuncio. `fling` la guarda en `undoStack`
(`wasStamp`) y `swUndo` la repone; si el anuncio no tenía sello, `swUndo` llama a `unstamp`.
Son dos líneas, cada una en un extremo, y ninguna de las dos tiene check. Rotas, deshacer un
swipe deja un sello nuevo donde había uno viejo, o deja sello donde no había ninguno.

**5. `setLS` miente sobre haber escrito** (`src/app.js:60`). Devuelve `false` cuando
`localStorage` está lleno. Ese `false` gobierna exactamente dos sitios:

- `aparta` (`src/app.js:86`) copia un dato dañado a `roto:<clave>` **antes** de ignorarlo. Es
  la única copia que va a existir. Si `setLS` dice que guardó y no guardó, `aparta` le dice
  al usuario "copia en roto:wp_estado" —copia que no existe— y no mete la clave en
  `sinRespaldo`. Entonces `espejo` (`src/app.js:100`) reescribe la clave saneada encima del
  original dañado. El dato desaparece del todo, y el usuario tiene un mensaje que dice que
  está a salvo.
- `migrateFromPerfiles` (`src/app.js:378`) borra `wp_perfil` cuando la migración termina. Si
  `setLS` miente, borra el perfil viejo después de una migración que no escribió nada.

## F2 — Contrato

Este es el trato. Cada punto es un check nuevo, y cada check tiene que ponerse en rojo con su
mutante puesto.

1. **Deshacer un rechazo devuelve el favorito a favoritos.** Rechazar un favorito y deshacer
   deja el anuncio en favoritos, no en "sin ver".
2. **Restaurar de la papelera desbloquea al vendedor, y deshacer lo vuelve a bloquear.**
3. **Deshacer un swipe repone el sello previo tal cual.** Si el anuncio ya tenía sello, vuelve
   el viejo, no uno nuevo. Si no tenía, no queda ninguno.
4. **`aparta` no miente cuando no puede respaldar.** Con el almacén lleno, el aviso dice que
   NO se ha podido respaldar, y el original dañado se queda donde está: `espejo` no lo pisa.

Regla 1 del método: no se quita funcionalidad. Aquí no se toca `src/app.js`. Los cinco
mutantes describen código que ya hace lo correcto; lo que falta es la red que lo sujeta.

**No entra en esta iteración:** `migrateFromPerfiles` con el almacén lleno. Es el otro
consumidor de `setLS`, pero su escenario pide un `wp_perfil` del modelo viejo *más* un almacén
lleno *más* un boot; el check 4 ya mata el mutante de `setLS`, y un segundo camino al mismo
mutante no añade defensa.

## F3 — Implementar

Sin cambios en producción. Solo checks.

## F4 — Probar

Checks nuevos: `src/test_buttons.js` 326 → 339 (bloques 57, 58 y 59), `src/test_app.js` bloque 5b.
`./check.sh` sale 0.

Cada mutante puesto otra vez, ahora con los checks dentro. La prueba en rojo es el mutante:
no hay defecto en producción que arreglar, así que lo que se demuestra es que la red sujeta.

```
reject: deshacer no devuelve el favorito       muere  FAIL: deshacer el rechazo de un favorito no lo devuelve a favoritos: []
restore: no desbloquea al vendedor             muere  FAIL: restaurar no desbloqueó al vendedor: enforceBlocks lo devuelve a la papelera solo
fling: no guarda el sello previo               muere  FAIL: deshacer el swipe no repuso el sello previo: undefined
swUndo: ignora el sello previo (lo pisa)       muere  FAIL: deshacer el swipe no repuso el sello previo: undefined
swUndo: no borra el sello del sin-ver          muere  FAIL: deshacer dejó un sello en un anuncio que vuelve a 'sin ver': 1786333849828
setLS: dice que guardó cuando no guardó        muere  FAIL: el original dañado se machacó sin haberlo podido respaldar; quedó {}
aparta: ignora el fallo del respaldo           muere  FAIL: el original dañado se machacó sin haberlo podido respaldar; quedó {}
espejo: escribe aunque no haya respaldo        muere  FAIL: el original dañado se machacó sin haberlo podido respaldar; quedó {}
```

Los cinco vivos de F1 están muertos, y de propina caen los otros dos consumidores del booleano
de `setLS` (`aparta` y `espejo`), que es la cadena entera del punto 4 del contrato.

### El presupuesto a medida del check 5b

`boot(store, { limit })` es un presupuesto en bytes sobre el almacén entero. Para reproducir el
fallo hace falta que quepa lo que ya hay y no quepa **duplicar** el dato dañado: dato de 1803
bytes, presupuesto 2400. Así la copia a `roto:wp_excl` no entra, y la escritura espejo que viene
después —`{}`, 2 bytes sobre los 1803 de la misma clave— sí entraría. Ese es exactamente el
hueco por el que se pierde el dato si el booleano miente.

### Dos mutantes que se quedan vivos, medidos y explicados

```
swUndo: el sello previo se ignora  →  if (false) unstamp(h.k)   VIVE
swUndo: no repone el cubo previo (favorito)                     VIVE
```

El primero es **equivalente**: por esa rama el `else` hace `stamp[k] = undefined`, y
`JSON.stringify` no serializa `undefined`. En disco sale lo mismo que tras el `delete`, y todos
los lectores usan el valor, no la presencia de la clave. No hay comportamiento que medir. La
variante que sí es un cambio real —quitar la llamada a `unstamp`— muere (tabla de arriba).

El segundo es **inalcanzable**, como el fallback de `itemId` de la iteración anterior:
`deckRows` esconde los favoritos (lo mide el check 55), así que el mazo nunca contiene una carta
que ya sea favorita, y `h.wasFavorite` siempre es `false`. Para llegar a `true` haría falta estar
en el mismo `di` con la carta ya en favoritos, y el único camino hasta ahí es el propio deshacer,
que la saca. Se queda la línea: cuesta nada y borrarla arma una trampa si algún día `deckRows`
deja de esconder favoritos.

## F5 — Review adversaria

Reproducción propia de los dos hallazgos que la lente de F1 dejó abiertos, antes de decidir nada
(regla del método: una lente que descarta el hallazgo de otra tiene que medirlo, no razonarlo).
Los dos se midieron y los dos quedan justificados arriba con el número delante.

Sin cambios en `src/app.js`: la iteración añade red, no toca producción. Regla 1 intacta —
ninguna funcionalidad se pierde.

