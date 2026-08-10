# Iteración 23 — los dos cubos se escriben juntos

**Zona:** `src/app.js`, `save()` y sus 23 llamadas.
**Fecha:** 10 de agosto de 2026.
**Tipo:** simplificación. Es la primera iteración que borra código de producción en vez de
añadir red. Las 392 comprobaciones de `test_buttons.js` y las de `test_app.js` son lo que la
hace posible.

## F1 — Investigar

`save(k, _set)` tiene dos ramas:

```js
const save = (k, _set) => {
  if (BUCKET_KEYS.has(k)) { setLS(k, JSON.stringify(fromMap(buckets[k.slice(3)]))); saveRows(); }
  else setLS(k, JSON.stringify([..._set]));
  pushEstado();
};
```

Tres hechos medidos:

**1. Las 23 llamadas usan una clave de cubo.** `grep -o 'save("wp_[a-z]*"' src/app.js | sort |
uniq -c` da exactamente `8 save("wp_favorite"` y `16 save("wp_rejected")` (23 llamadas más la
definición). No hay ni una con otra clave.

**2. La otra rama no la alcanza nadie.** Cambiada por un `throw`, las siete suites siguen en
verde:

```
else throw new Error("rama muerta de save()");   →  ./check.sh en verde
```

**3. El parámetro `_set` no se usa.** En la rama viva, el valor que se escribe sale de
`buckets[k.slice(3)]`, no del argumento. El guion bajo del nombre ya lo decía. Las 23 llamadas
pasan un argumento que el cuerpo tira.

**Y hay siete sitios donde las dos llamadas van pegadas**, una detrás de otra
(`src/app.js:1408`, `1443`, `1458`, `1521`, `1530`, `2777`, `2807`). Cada pareja corre `saveRows()`
dos veces y `pushEstado()` dos veces. `saveRows()` recorre `data` entera y `rowCache` entero: en
el camino de rechazar, restaurar y bloquear se hace ese trabajo dos veces por gesto.

### Por qué importa, y no es solo estética

Las iteraciones 20 y 21 encontraron dos veces la misma forma de fallo: **escribir un cubo y
olvidar el otro**. `enforceBlocks` sin `favorite.delete(k)`, `fromURL` sin la línea de
exclusividad. Los dos cubos son exclusivos y se escriben siempre juntos. Una llamada que escribe
uno solo es una invitación a repetir ese fallo.

## F2 — Contrato

1. **`saveBuckets()` sustituye a `save()`.** Escribe los dos cubos, y llama a `saveRows()` y a
   `pushEstado()` una sola vez.
2. **Desaparecen `save` y `BUCKET_KEYS`**, que solo existía para elegir entre las dos ramas.
3. **Nada cambia para el usuario.** Lo escrito en `localStorage` es byte a byte lo mismo: los
   sitios que escribían un cubo solo ahora reescriben el otro con el valor que ya tenía.
4. **Las siete suites pasan sin tocar ninguna aserción**, solo el nombre de la función en los
   checks que la llaman desde el sandbox.

## F3 — Implementar

`save(k, _set)` y `BUCKET_KEYS` desaparecen. En su sitio queda una función sin argumentos:

```js
const saveBuckets = () => {
  for (const n of BUCKET_NAMES) setLS("wp_" + n, JSON.stringify(fromMap(buckets[n])));
  saveRows();
  pushEstado();
};
```

- **24 llamadas** sustituidas en `src/app.js`, y **8 parejas** pegadas colapsadas a una sola
  llamada (7 en líneas seguidas, 1 en la misma línea dentro de `fromURL`).
- **37 llamadas** sustituidas en `src/test_buttons.js`. Ninguna aserción cambia.
- `src/app.js`: 23 líneas nuevas, 27 borradas. Es la primera iteración con saldo negativo.

## F4 — Probar

Las siete suites en verde: `./check.sh` calla. `test_buttons.js` da **393 comprobaciones**.

Un check nuevo, el 76, porque el barrido encontró un hueco (ver F5):

```
// ── 76. rechazar también actualiza el blob de estado, no solo la clave espejo ──
```

Barrido de mutantes sobre la función nueva:

```
saveBuckets: solo escribe un cubo      muere  FAIL: #swYes no mandó la carta a favoritos
saveBuckets: no guarda las filas       muere  FAIL: la copia no lleva la fila del favorito, solo su id
saveBuckets: no propaga el estado      muere  FAIL: rechazar no llega al blob de estado: al recargar vuelve el anuncio, undefined
```

## F5 — Review adversaria

**1. ¿La escritura de más puede perder datos?** La duda real de esta iteración. Siete sitios
escribían un cubo solo, y ahora reescriben también el otro. Si alguno de esos sitios cambiaba el
otro cubo en memoria y contaba con no persistirlo, la refactorización cambia lo que se guarda.

Medido, no razonado: `rejectedLejos`, `rejectedExcluded`, `bulkRestore`, `restore`, `unblockFor`
y `reblock` **solo leen** `favorite` (`favorite.has(...)` en dos filtros). Ninguno lo escribe. La
reescritura del otro cubo pone el mismo valor que ya estaba. Lo escrito en `localStorage` es byte
a byte lo mismo, y el contrato 3 se sostiene.

**2. El hueco que encontró el barrido.** El mutante `no propaga el estado` empezó **VIVO**. Quitar
`pushEstado()` dejaba las siete suites en verde. Eso no es un fallo que introduzca esta iteración
— es una red que faltaba desde siempre —, pero cae justo en la función que acabo de reescribir,
así que se cierra aquí. `wp_estado` es el blob que `hydrateEstado()` lee al arrancar: sin
`pushEstado()`, la clave espejo `wp_rejected` se escribe y el arranque siguiente la pisa con la
versión vieja del blob. El rechazo se pierde al recargar. El check 76 lo mide.

**3. El mensaje del mutante.** La primera versión del check 76 hacía
`JSON.parse(b.store.wp_estado)` a secas. Con el mutante, el fallo salía como `"undefined" is not
valid JSON`: muere, pero no dice por qué. Cambiado a `JSON.parse(b.store.wp_estado || "{}")` para
que el que lea el fallo lea la frase del contrato. Regla de la iteración 20 otra vez: un check que
muere sin explicar es medio check.

**4. Lo que esta iteración no toca.** `save()` tenía una rama muerta (`else setLS(k,
JSON.stringify([..._set]))`). Se borra sin sustituto porque nadie la alcanza — medido en F1 con un
`throw`. Si mañana hace falta guardar un `Set` que no sea un cubo, la línea son 40 caracteres y se
escribe entonces.
