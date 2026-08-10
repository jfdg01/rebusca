# Iteración 13 — la espera que el servidor pide y nadie acota

**Zona:** el `Retry-After` de `getJSON` en `src/scrape.js:202-206`, y el check 16b de
`src/test_scrape.js:316-322`.

**De dónde sale:** zona nombrada por la review adversaria (F5) de las iteraciones 10 y 11, aplazada
entonces por la fecha límite. La iteración 12 la volvió a dejar fuera a propósito.

**El tema de la iteración:** la iteración 11 devolvió el `Retry-After` al último reintento, y con
razón: es una instrucción del servidor. Lo que no puso es un techo. El número lo elige Wallapop, y
la barra de progreso se lo come entero.

Medido, con el `scrape.js` de hoy y una rama a la que el servidor contesta 429:

```
$ node iteraciones/repros/repro13_retry.js
Retry-After: 30s    ->  5 esperas, 2.5 min colgado
Retry-After: 600s   ->  5 esperas, 50.0 min colgado
Retry-After: 3600s  ->  5 esperas, 300.0 min colgado
```

Cinco horas, por rama, con la barra girando. Una búsqueda de doce ramas OR multiplica eso por doce.

## El hallazgo

### 1 · media — un `Retry-After` largo cuelga la búsqueda sin techo

`src/scrape.js:205`.

El backoff propio está acotado por construcción: `2 ** a` con cuatro intentos da 16 s como máximo.
El `Retry-After` no está acotado por nada, y sustituye a ese backoff. Un número que el servidor
elige entra directo en un `sleep`.

No es un cuelgue del que no se salga: `sleep` escucha el `signal`, así que el botón parar funciona
durante la espera. Pero el usuario no tiene forma de saber que el reloj va para cinco horas: la
barra de progreso enseña el número de anuncios, no el de la espera.

**Arreglo:** `Math.min(ra, 60)`. Sesenta segundos son casi cuatro veces la espera más larga que el
backoff propio se permite, así que la instrucción del servidor se sigue respetando allí donde es
razonable. Por encima, se reintenta antes de lo que pidió.

**El coste, y por qué se acepta:** si el servidor de verdad necesita una hora, los cinco intentos se
gastan en cinco minutos y la rama cae con «agotados los reintentos». El usuario ve el aviso de
resultado parcial y vuelve a buscar cuando quiera. Es mejor trato que una barra girando media
tarde, y `parcial` ya impide que ese recorte se cachee.

## Qué se deja fuera a propósito

- **El techo de peticiones** (`MAX_ROWS × MAX_PAGINAS_SECAS` = 45.000). El scrape **termina**; lo que
  falta es un número más bajo, y no hay medida de búsquedas reales que diga cuál. La iteración 11 ya
  demostró lo que cuesta elegir ese número a ojo: un tope de páginas totales recortaba búsquedas
  sanas. Sin la medida, no se toca.
- **El check que falta de «corta la RAMA, no el scrape»** (`src/test_scrape.js:242-282`): lo está
  mirando la review adversaria de la iteración 12 mientras se escribe esto.
- Lo aplazado desde antes, que no se re-levanta: `render()` calculando `filteredRows()` dos veces en
  Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo, el
  badge «sin ver» frío tras una restauración, la pérdida del Map de sesión sin `indexedDB`, los
  textos `csv:` huérfanos, y `cacheCsv` apuntando el índice antes de saber si el texto entró.

## Cómo se prueba (F4)

El check 16b ya mide la lista de esperas con un `Retry-After: 30`, que está por debajo del techo y
no debe cambiar. El check nuevo usa `Retry-After: 3600` y exige que ninguna espera pase del minuto
más el jitter. Hoy sale en rojo con 3.600.000 ms.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. La prueba roja, palabra por palabra, con el check nuevo puesto y el arreglo
todavía no:

```
FAIL: una espera pasó del minuto: 3600929.4105388154 ms
```

El arreglo es un `Math.min`. La misma medida, después:

```
$ node iteraciones/repros/repro13_retry.js
Retry-After: 30s    ->  5 esperas, 2.5 min colgado     (no cambia: 30 está por debajo del techo)
Retry-After: 600s   ->  5 esperas, 5.0 min colgado
Retry-After: 3600s  ->  5 esperas, 5.1 min colgado
```

El número queda acotado por los dos lados, y por dos checks distintos: el 16b lo defiende por abajo
—un techo por debajo de 30 s tira la instrucción del servidor que ese check existe para conservar—
y el 16c por arriba.

```
techo 1    -> FAIL: el último 429 pidió 30 s y se esperó 1418.6783456548114
techo 20   -> FAIL: el último 429 pidió 30 s y se esperó 20764.83397565032
techo 60   -> ok (59 comprobaciones)
techo 600  -> FAIL: una espera pasó del minuto: 600987.7880711412 ms
```

Checks de `test_scrape.js`: 57 → **59**. Los siete checks de `check.sh`, en verde y en silencio.
