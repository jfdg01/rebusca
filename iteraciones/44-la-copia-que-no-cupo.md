# Iteración 44 — la copia que no cupo

**Zona:** `aparta` / `espejo` / `sinRespaldo` (`src/app.js:85-101`), la ruta que gestiona un
dato dañado en `localStorage`.

**Por qué esta zona.** La iteración 43 dejó `espejo: los bloqueados se escriben con setLS`
abierto y dijo por qué: «la diferencia solo aparece cuando `setLS` falla». Resultó ser falso
que el arnés no supiera fallar. `makeContext` ya tiene `opts.limit`, que reproduce el
`QuotaExceededError` de verdad. No faltaba arnés: faltaba mirarlo.

## La regla que cierra

`aparta(k)` copia el dato dañado a `roto:<k>` antes de ignorarlo. Cuando esa copia **no cabe**,
la clave entra en `sinRespaldo` y el original en su sitio pasa a ser la única copia que queda.
`espejo` existe para no machacarla. Un `setLS` crudo la borra, y con ella el único rastro de lo
que el usuario tenía.

## F4 — el check

Bloque `7g` en `src/test_buttons.js`. Suite 521 → 523.

El escenario pide un presupuesto calibrado, no un disco lleno: `wp_blocksel` vale 2000 bytes de
basura y el tope son 3000. La copia (2000 más) no cabe; las escrituras espejo pequeñas sí. Con
un tope de 4200 la copia cabía, el código hacía lo correcto y el check fallaba. El primer
`FAIL` fue del check, no de producción.

La segunda aserción del bloque comprueba que `roto:wp_blocksel` **no** existe. Sin ella, un
tope mal calibrado deja el check verde sin medir nada.

## F5 — review adversaria

Dos mutantes, los dos mueren:

```
espejo: la escritura espejo es un setLS crudo  muere
espejo: los bloqueados se escriben con setLS   muere
```

El primero es nuevo: ataca la definición de `espejo`. El segundo ataca una llamada. Un check
que solo matara la llamada mediría un sitio, no la regla.

## Lo que deja esta iteración

- Un check contra un presupuesto pide dos aserciones: la que mide, y la que comprueba que el
  presupuesto dejó pasar lo que tenía que dejar pasar. Con una sola, un tope mal puesto es un
  verde vacío.
- «El arnés no puede» se comprueba leyendo el arnés. Aquí ya podía desde hacía 30 iteraciones.
- Un mutante sobre una llamada mide un sitio. Para medir la regla hay que mutar su definición.
