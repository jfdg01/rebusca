# Iteración 30 — un molde para los dos rechazos en bloque

**Zona:** `rejectedLejos()` y `rejectedExcluded()` en `src/app.js`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** simplificación, con la red que faltaba.

## F1 — Investigar

Un barrido de bloques repetidos de cuatro líneas sobre las 3228 líneas de `src/app.js` deja arriba
del todo estas tres, cada una con tres apariciones:

```
rejected.add(k); | stampNow(k); | }); | saveBuckets();
ks.forEach((k) => { | rejected.delete(k); | unstamp(k); | });
if (!ks.length) return; | ks.forEach((k) => { | rejected.add(k); | stampNow(k);
```

Dos de las tres apariciones son `rejectedLejos()` y `rejectedExcluded()`, los dos atajos de la barra
de estado. **Son la misma función**: eligen las filas sin clasificar que cumplen un filtro, las
mandan a la papelera con su fecha, guardan, repintan y ofrecen deshacer. Solo cambian el filtro y el
texto del aviso. La tercera es `blockSeller()`, que además bloquea al vendedor y devuelve a
favoritos los que lo eran; esa se queda como está.

**Lo que estaba probado y lo que no.** La suite pulsa los dos atajos y comprueba a quién mandan a la
papelera. El resto del cuerpo, no. Ocho mutantes, **seis vivos**:

| mutante | antes |
|---|---|
| el bloque ignora el filtro | muere |
| el deshacer no guarda | muere |
| **el bloque se lleva también los favoritos** | **VIVE** |
| **el bloque no sella la fecha** | **VIVE** |
| **el deshacer no quita el sello** | **VIVE** |
| **sin nada que rechazar, sigue igual** | **VIVE** |
| **el plural del aviso va al revés** | **VIVE** |
| **los dos avisos dicen lo mismo** | **VIVE** |

El caro es el primero de los vivos. Un anuncio que el usuario ya guardó en favoritos y que además
está lejos y sin envío **no puede irse a la papelera de rebote**: eso deshace a mano una decisión que
ya se tomó a mano. La guarda `!favorite.has(key(r))` lo impide, y nadie la medía.

## F2 — Contrato

1. **Un solo molde**, `bulkReject(pred, msg)`. Los dos nombres se quedan, así que ni la barra de
   estado ni la suite cambian una línea.
2. **El mensaje es una función del número**, porque el plural depende de él.
3. **Una comprobación nueva** que cierra los seis mutantes vivos.
4. Nada cambia para el usuario. Las siete suites pasan.

## F3 — Implementar

```js
const bulkReject = (pred, msg) => () => {
  const ks = data
    .filter((r) => !rejected.has(key(r)) && !favorite.has(key(r)) && pred(r))
    .map(key);
  if (!ks.length) return;
  …
};
const rejectedLejos = bulkReject(isLejos, (n) => `${n} lejos a la papelera`);
const rejectedExcluded = bulkReject(
  isExcluded,
  (n) => `${n} excluido${n === 1 ? "" : "s"} a la papelera`,
);
```

`src/app.js`: 14 líneas nuevas, 36 borradas. **22 líneas de producción menos.**

**Comprobación 20c** en `src/test_buttons.js`: un favorito que además está lejos no se va a la
papelera y el aviso ni sale; quitado de favoritos sí se va, con su sello, y el aviso dice
«1 lejos a la papelera»; deshacer quita el sello; el otro atajo dice «1 excluido» con uno y
«3 excluidos» con tres. De 418 a **426 comprobaciones**.

## F4 — Probar

Los siete checks en verde. Los ocho mutantes vuelven a pasar y **los ocho mueren**.

## F5 — Review adversaria

**1. La comprobación del favorito solo recorre un atajo.** El check pulsa `#rejectedLejos` con un
favorito puesto; no repite la prueba con `#rejectedExcl`. Antes de esta iteración eso sería un
agujero: eran dos funciones y la guarda estaba escrita dos veces. Ahora es **una sola línea
compartida**, y el mutante lo demuestra: al quitar la guarda del molde, la suite se pone roja. Es la
misma razón que en la 27 — juntar copias no solo borra líneas, convierte varios agujeros posibles en
uno con red.

**2. Dos mutantes mal escritos, y cómo se notaron.** El primer barrido devolvió `MUTADOR ROTO` en
dos, porque las cadenas que elegí salían más de una vez en el fichero. Un `MUTADOR ROTO` **no es un
resultado**: no dice ni «muere» ni «VIVE». Se volvieron a lanzar con las líneas de alrededor como
contexto, y los dos estaban vivos. Anotar «cubierto» ahí habría sido falso.

**3. `blockSeller()` se queda fuera a propósito.** Comparte las cuatro líneas del centro, pero
además bloquea al vendedor, guarda el bloqueo aparte, devuelve a favoritos los que lo eran y
reconstruye el mazo. Meterla en el molde pediría tres parámetros más y dejaría el molde menos claro
que las dos copias que borra. YAGNI: se queda como está.

**4. No hay captura de pantalla.** El cambio es de estructura: la barra de estado, sus dos enlaces y
los dos avisos dicen exactamente lo mismo que antes, y eso es justo lo que mide la comprobación
nueva.
