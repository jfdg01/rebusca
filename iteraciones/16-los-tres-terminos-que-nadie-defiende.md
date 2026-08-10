# Iteración 16 — los tres términos de `scrape.js` que se pueden borrar en silencio

**Zona:** `diag.parcial` (`src/scrape.js:247`) y el `break` de la rama seca (`src/scrape.js:273`).

**De dónde sale:** la review adversaria (F5) de la iteración 12, lente «checks que no defienden».
Sus dos hallazgos se re-midieron aquí antes de aceptarlos, según la regla del método: *una lente que
descarta —o afirma— el hallazgo de otra tiene que medirlo, no razonarlo.*

**El tema de la iteración:** la iteración 12 tocó `diag.parcial`. Es la línea que decide si un
resultado se cachea para siempre. Tres de sus alrededores se pueden borrar sin que ninguno de los
siete checks diga nada.

Medido en este árbol, mutante a mutante, restaurando entre cada uno:

```
quitar 'abortado' de diag.parcial              check.sh exit=0  SOBREVIVE
quitar 'ramasTope > 0' de diag.parcial         check.sh exit=0  SOBREVIVE
quitar 'tope > 0' de diag.parcial              check.sh exit=1  muere
break -> return finish() en rama seca          check.sh exit=0  SOBREVIVE
```

El cuarto está en la tabla a propósito: es el término vecino, y muere. La diferencia entre uno y
otro es lo que esta iteración viene a quitar.

## Los hallazgos

### 1 · alta (cobertura) — `abortado` y `ramasTope` pueden caerse de `diag.parcial`

`src/scrape.js:247`.

Hoy no hay defecto: los dos términos están y funcionan. Lo que falta es la red. Doce sitios de
`test_buttons.js` tocan `.parcial`/`.abortado`/`.ramasTope`, y los doce escriben `Rebusca.lastScrape`
a mano o sustituyen `Rebusca.scrape` por un doble; ninguno ejecuta el `scrape.js` de verdad. Los dos
que sí lo ejecutan (`test_app.js` 12l y 12m) lo hacen aislado, sin la cadena de aviso ni el cache.

El daño, si el término se cae: el usuario pulsa parar a media búsqueda, o una rama del OR llena su
cupo, y ese recorte se guarda como si fuera el resultado definitivo. El cache no caduca
(`src/app.js:1623`), así que la búsqueda se queda recortada para siempre.

**Arreglo:** dos checks en `src/test_scrape.js` que ejercitan `scrape()` de verdad y exigen
`parcial` en los dos escenarios.

### 2 · media — «corta la RAMA, no el scrape» no lo comprueba nadie

`src/scrape.js:273` — `if (secas >= MAX_PAGINAS_SECAS) { diag.ramasSecas++; break; }`.

El hueco lo nombraron los contratos 12 y 13, y los dos lo aplazaron. Con el mutante puesto
(`break` → `return finish()`) la rama que va detrás de la seca **no se pide nunca**: se pierde
entera, `ramasRotas` sigue en cero, no hay error en consola, y `parcial` sigue en `false`. Un
resultado al que le falta una rama entera, cacheado como definitivo y sin un solo indicio.

Es peor que un hueco de cobertura sobre código correcto: si esa línea se rompe, se rompe en
silencio.

**Arreglo:** un check con un OR real donde la primera rama se seca y la segunda tiene un anuncio
detrás.

## Qué se deja fuera a propósito

- **El techo de `MAX_ROWS`.** La lente lo volvió a medir: `1.000.000` pasa `check.sh` en silencio.
  Sigue siendo lo que el contrato 12 dejó fuera: el scrape **termina**, lo que falta es un número
  más bajo, y no hay medida de búsquedas reales que diga cuál. Su propia iteración.
- Lo aplazado desde antes, que no se re-levanta: `render()` calculando `filteredRows()` dos veces en
  Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo, el
  badge «sin ver» frío tras una restauración, la pérdida del Map de sesión sin `indexedDB`, los
  textos `csv:` huérfanos, y `cacheCsv` apuntando el índice antes de saber si el texto entró.

## Cómo se prueba (F4)

No hay defecto en producción, así que el rojo es el mutante. Cada check nuevo tiene que morir con su
línea de producción rota y volver al verde con ella puesta. La tabla de arriba se vuelve a correr al
final: las tres filas que hoy dicen `SOBREVIVE` tienen que decir `muere`.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. Los tres checks mueren con su mutante, palabra por palabra:

```
quitar 'abortado' de diag.parcial       FAIL: una búsqueda parada no se marca parcial: se cachearía como completa
quitar 'ramasTope > 0' de diag.parcial  FAIL: una rama que llena su cupo no marca parcial: se cachearía un recorte
break -> return finish()                FAIL: la rama de detrás se perdió con la rama seca: 0
```

La tabla completa, otra vez, con los checks puestos. Los cuatro términos de `diag.parcial` quedan
defendidos, y el vecino también:

```
quitar 'abortado' de diag.parcial              check.sh exit=1  muere
quitar 'ramasTope > 0' de diag.parcial         check.sh exit=1  muere
quitar 'tope > 0' de diag.parcial              check.sh exit=1  muere
quitar 'ramasRotas > 0' de diag.parcial        check.sh exit=1  muere
break -> return finish() en rama seca          check.sh exit=1  muere
reintroducir ramasSecas en diag.parcial        check.sh exit=1  muere
```

Dos de los tres checks entran donde ya había un escenario montado: el de parar (11) y el del cupo
por rama (13b). El tercero necesita su propio OR. Ninguno pide red.

Checks de `test_scrape.js`: 59 → **68**. Los siete checks de `check.sh`, en verde y en silencio.
