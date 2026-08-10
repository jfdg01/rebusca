# Iteración 11 — el freno que frenaba a las búsquedas sanas

**Zona:** `MAX_PAGINAS` y el bucle de páginas de `src/scrape.js:24, 246-248`, el helper `esperar` de
`getJSON` (`src/scrape.js:181, 198-199`), y los checks 14 y 16 de `src/test_scrape.js`.

**De dónde sale:** la review adversaria (F5) de las iteraciones 8 y 9, sobre `426a036`. Dos lentes
en worktrees propios y una síntesis que reprodujo cada hallazgo y aisló la causa contra el padre.
Veredicto: **«NO se puede cerrar `feat/ciclo-robustez` sobre `main` tal cual»**.

**El tema de la iteración:** el freno de la iteración 8 mide lo que no debe. Un contador de páginas
totales no distingue «esta búsqueda no avanza» de «esta búsqueda avanza despacio», y las búsquedas
que avanzan despacio son legítimas y frecuentes.

He reproducido el hallazgo yo mismo, sobre `426a036` sin tocar, antes de escribir esto:

```
$ node iteraciones/repros/repro_sintesis_umbral.js
Una palabra ("sofa"), casilla "solo en el título" marcada, API perfecta.
aciertos/pag |      426a036^ (sin tope)      |        426a036 (tope 200)
   8/40 (20%)  | 188 pág, 1500 filas, parcial true  | 188 pág, 1500 filas, parcial true
   6/40 (15%)  | 250 pág, 1500 filas, parcial true  | 200 pág, 1200 filas, parcial true   <- PIERDE 300 anuncios
   4/40 (10%)  | 375 pág, 1500 filas, parcial true  | 200 pág,  800 filas, parcial true   <- PIERDE 700 anuncios
```

Una palabra, sin ramas OR, API perfecta, catálogo finito. Basta marcar «solo en el título» y que el
término case en menos del 15 % de los títulos.

## Los hallazgos que sobreviven

### 1 · alta — el tope recorta búsquedas sanas, y el recorte les quita el cache (regla dura 1)

`src/scrape.js:24, 248`.

La frase del contrato de la iteración 8 —«No se pierde ninguna búsqueda que hoy termine: lo que
corta es lo que hoy no termina»— es falsa, y la medida de arriba la desmiente. El cálculo que la
sostenía («~64 páginas para 32 ramas») supone que los 40 items de cada página acaban en fila. Con
`titleOnly` —el escenario que motivó la propia iteración 8— eso no se cumple, y con ramas sinónimas
que se deduplican entre sí tampoco (medido por la síntesis: 228 páginas).

El segundo daño es peor que el primero. `paginasTope` entra en `diag.parcial`, `runScrape`
(`src/app.js:2025`) no cachea lo parcial, y `loadQuery` (`src/app.js:1623`) re-scrapea en cada
apertura. Medido con el ciclo entero conducido por el `app.js` de verdad:

```
$ node iteraciones/repros/repro8_ciclo.js
426a036^ (sin tope)
  buscar        -> 256 páginas, 1024 anuncios en pantalla
  ¿se cachea?      true   badge "sin ver": 1024
  TOTAL a api.wallapop.com en tres aperturas: 256 páginas
426a036 (tope 200)
  buscar        -> 200 páginas, 800 anuncios en pantalla
  ¿se cachea?      false   badge "sin ver": null (muerto)
  TOTAL a api.wallapop.com en tres aperturas: 600 páginas
```

El freno multiplica por 2,3 el martilleo a Wallapop que la iteración 8 existe para cortar.

**Arreglo:** medir el avance, no el volumen. El contador pasa a ser de **páginas seguidas que no
traen ni una fila nueva**, y se pone a cero en cuanto una la trae. Corta la **rama**, como `lleno`,
no el scrape entero.

Con eso, los tres escenarios del contrato de la 8 siguen muertos —los tres dan cero filas nuevas
para siempre— y ninguna búsqueda que progrese lo toca: para disparar con «solo en el título» al
10 % harían falta 30 páginas seguidas, 1200 anuncios, sin un solo acierto.

Que corte la rama y no el scrape arregla además el caso de las ramas sinónimas: la rama que solo
repite lo que ya trajo otra se corta sola y el scrape sigue con la siguiente.

El bucle infinito no se reabre por ningún lado: una API que sí añade filas está topada por
`MAX_ROWS` y por el cupo de la rama, que ya existían.

### 2 · media — el número del tope no lo defiende ningún check

`src/test_scrape.js:258` solo exige `calls.length <= 200`. Medido por la lente:

```
$ node iteraciones/repros/repro8_mutante.js     # sección A
  MAX_PAGINAS = 200  ->  ./check.sh exit=0   (VERDE: el mutante vive)
  MAX_PAGINAS =  20  ->  ./check.sh exit=0   (VERDE: el mutante vive)
  MAX_PAGINAS =   9  ->  ./check.sh exit=0   (VERDE: el mutante vive)
```

Es el agujero por el que se coló el hallazgo 1: la suite mide el beneficio del freno sobre una
búsqueda rota y nunca su coste sobre una sana.

**Arreglo:** un check nuevo con el caso sano —catálogo finito, `titleOnly` al 10 %, API perfecta—
que exige todas las filas y `parcial` en `false`. Muere si el freno recorta lo que progresa.

### 3 · baja — el último reintento tira el `Retry-After` que el servidor acaba de mandar

`src/scrape.js:181, 199`. El contrato de la 8 lo justificó con «la última espera no precede a
nada». Sí precede: a la primera petición de la rama siguiente.

```
$ node iteraciones/repros/repro8_backoff.js
C · "buena OR mala OR tercera", la rama mala devuelve 429 con Retry-After: 30
  426a036^  peticiones 7  ·  hueco tras el último 429: 30.2 s (el servidor pidió 30)
  426a036   peticiones 7  ·  hueco tras el último 429: 0.0 s (el servidor pidió 30)
```

La misma medida confirma que el resto del arreglo de la 8 está bien: el backoff de los intentos 1
a 4 no cambió y un 429 seguido de un 200 sigue funcionando.

**Arreglo:** la espera exponencial del quinto intento sigue fuera; el `Retry-After` explícito, no.
Es una instrucción del servidor, y tirarla es perder funcionalidad.

## Descartados, con el motivo

- **Que el `Retry-After` perdido haga que DataDome castigue más.** No está reproducido: 2,5 frente a
  2,0 peticiones por minuto no provoca ningún bloqueo, y el contrato de la 8 ya descartó el jitter
  entre ramas con ese mismo argumento, que esta medida no refuta. El hallazgo 3 se sostiene por la
  funcionalidad perdida, no por el daño.
- **La fuga de datos del ocupante anterior al reabrir en la MISMA sesión** (`src/app.js:1794`). La
  síntesis la reprodujo en `HEAD` **y en `d1888eb~1` con la línea D idéntica**: es preexistente. La
  causa es que `cacheCsv` escribe `csvIndex[csv]` en memoria antes de saber si el texto entra, y eso
  no lo tocó la iteración 9. Esa iteración va en la dirección contraria y mejora el caso: mantiene
  la marca, así que el arranque siguiente sí limpia el texto ajeno. No bloquea el cierre; se aplaza
  con zona nombrada.

## Qué se deja fuera a propósito

- **Las dos ramas nuevas del `snack`** (`src/app.js:2011-2024`): mutantes vivos, sin defecto de
  comportamiento hoy. Es cobertura sobre código nuevo, no un fallo.
- **El `case` de `check.sh:10-13`**: revertirlo devuelve el ruido y `check.sh` sigue saliendo 0.
  Nadie automatiza la señal «silencio = verde» sobre sí misma.
- **`cacheCsv` escribiendo el índice antes de saber si el texto entró** (`src/app.js:1794-1812`):
  preexistente y medido. Cierre natural: mover el apunte detrás del `await`. Es su propia iteración.
- Lo aplazado desde antes, que no se re-levanta: `render()` calculando `filteredRows()` dos veces en
  Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo en vez
  del índice, el badge «sin ver» frío tras una restauración, la pérdida del Map de sesión en un
  navegador sin `indexedDB`, y los textos `csv:` huérfanos.

## Cómo se prueba (F4)

Dos checks, y el primero es el que la iteración 8 no tuvo:

1. **el caso sano**: catálogo finito de 250 páginas, `titleOnly`, 4 aciertos de cada 40. Exige las
   1000 filas y `parcial` en `false`. Hoy sale en rojo con 800 filas.
2. **los tres escenarios rotos** del check 14 siguen terminando, ahora por no avanzar.
3. **el `Retry-After` del quinto intento**: la lista de esperas tiene que acabar con la que el
   servidor pidió, y las cuatro anteriores no cambian.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. Las dos pruebas rojas, palabra por palabra, cada una capturada antes de su
arreglo:

```
FAIL: el freno recortó una búsqueda que avanza: 200 páginas de 250
FAIL: el Retry-After del último intento se tiró: 4 esperas
```

Una cosa que el contrato no preveía: **el check del caso sano tampoco defendía el número por
abajo.** Con las 250 páginas trayendo aciertos todas, un freno de una sola página seca pasaba
verde. Así que el caso sano lleva ahora un tramo de tres páginas seguidas sin un solo acierto de
cada veinticinco —catálogo real, no todo casa— y el número queda acotado por los dos lados:

```
MAX_PAGINAS_SECAS = 1     -> FAIL: el freno recortó una búsqueda que avanza: 23 páginas de 250
MAX_PAGINAS_SECAS = 2     -> FAIL: el freno recortó una búsqueda que avanza: 24 páginas de 250
MAX_PAGINAS_SECAS = 3     -> FAIL: el freno recortó una búsqueda que avanza: 25 páginas de 250
MAX_PAGINAS_SECAS = 10    -> ok (54 comprobaciones)
MAX_PAGINAS_SECAS = 1000  -> FAIL: sin freno por no avanzar: "páginas vacías" pidió 401 veces
```

Los checks no fijan el número exacto, y no deben: fijan la banda donde el freno es sano. Cualquier
valor por encima de 30 muere en el check 14, y de 3 para abajo muere en el 14b.

`diag.paginasTope` se va y entra `diag.ramasSecas`, así que la frase del `snack` de `src/app.js`
cambia con él. `diag.paginas` se queda: sigue siendo el contador que el diagnóstico enseña.

Checks de `test_scrape.js`: 48 → **54**. Los siete checks de `check.sh`, en verde y en silencio.
