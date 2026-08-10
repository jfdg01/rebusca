# Iteración 12 — el freno que se castiga a sí mismo

**Zona:** el término `diag.ramasSecas > 0` de `diag.parcial` en `src/scrape.js:236-237`, la cadena
de `snack` que lo consume en `src/app.js:2011-2025`, el check 14 de `src/test_scrape.js:261` y el
check 31b de `src/test_buttons.js:682-700`.

**De dónde sale:** la review adversaria (F5) de las iteraciones 10 y 11, sobre `e2930e7`. Dos lentes
en worktrees propios y una síntesis que reprodujo cada hallazgo. Veredicto: **«NO se puede cerrar
`feat/ciclo-robustez` sobre `main` tal cual»**, con un solo punto que bloquea.

**El tema de la iteración:** el freno nuevo corta bien, y después se cobra el corte marcando la
búsqueda `parcial`. `parcial` le quita el cache, y sin cache la búsqueda se re-scrapea entera en
cada apertura. El freno gasta más peticiones que la avería que evita.

He reproducido el hallazgo yo mismo, con `node iteraciones/repros/repro11_cache.js`, que conduce el `app.js` de verdad:

```
HEAD     (MAX_PAGINAS_SECAS=30)
  buscar        -> 70 páginas, 160 anuncios en pantalla
  diag             parcial=true  ramasSecas=1 ramasTope=0 tope=0
  ¿se cachea?      false   badge "sin ver": null (muerto)
  abrir guardada-> +70 páginas · otra vez -> +70 páginas
  TOTAL a api.wallapop.com en tres aperturas: 210 páginas
```

Los dos predecesores hacen 200 páginas en esas mismas tres aperturas, y los tres enseñan **los
mismos 160 anuncios**. El corte no pierde ni un anuncio; lo único que cambia es el cache.

## El hallazgo

### 1 · alta — un corte que no pierde nada se marca `parcial`, y eso le cuesta el cache

`src/scrape.js:237`, consumido en `src/app.js:2011-2025`.

Los otros cinco motivos de `parcial` son **transitorios**: un 403, un 429, una rama caída o un
botón parar. Volver a scrapear puede traer más, así que negarse a cachear tiene sentido.

Un corte por no avanzar es **determinista**: la rama dio treinta páginas seguidas sin una fila
nueva y las volverá a dar. Re-scrapear devuelve los mismos bytes. Negarle el cache no gana nada y
cuesta un scrape entero por apertura.

**Arreglo:** sacar `diag.ramasSecas > 0` de `diag.parcial`. El aviso al usuario se queda: sale
fuera del `if (diag.parcial)`, porque enterarse de que una rama se cerró sola sí es información.

Medido por la síntesis con el término fuera: las tres aperturas bajan de 210 a **70 páginas**,
menos que las 80 de `426a036^` y las 200 de `426a036`.

**El coste, y por qué se acepta:** con un acierto por cada mil anuncios, el resultado recortado
—una fila de diecisiete— se cachea en vez de re-scrapearse. El usuario lo ve en pantalla, y
«Repetir» refresca. Es el mismo trato que ya tiene cualquier búsqueda: el cache no caduca nunca
(`loadQuery`, `src/app.js:1623`), y quien quiere datos frescos pulsa «Repetir».

### 2 · el agujero que abre el arreglo, y su tapón

El cache no caduca. Así que un resultado **vacío** cacheado lo es para siempre.

Hoy eso no puede pasar por esta puerta: sin filas no hay `ramasSecas` sin `parcial`. Con el arreglo
sí. Una API que responde `200` con páginas vacías —un bloqueo silencioso, sin `403` que lo delate—
da treinta páginas secas, cero filas y un cache permanente de «esta búsqueda no tiene nada».

**Tapón:** no se cachea lo vacío. Un término, `data.length`, en la misma condición.

Cambia también el caso que ya existía: una búsqueda legítima de cero resultados deja de cachearse.
El coste es una página por apertura, y a cambio la búsqueda se recupera sola el día que aparezca un
anuncio. Se acepta a propósito.

## Descartados, con el motivo

Cada uno lo volví a medir antes de aceptar que cae. Es la regla que ganó la iteración 7: una lente
que descarta el hallazgo de otra tiene que medirlo, no razonarlo.

- **El goteo de 44.971 peticiones.** El scrape **termina**, y con las 1500 filas. El acantilado está
  en 1 acierto de cada 400, no de cada 1200, y el techo pasó de infinito a `MAX_ROWS ×
  MAX_PAGINAS_SECAS`. Es un número alto, no un bucle sin fin.
- **El quinto reintento con `Retry-After`.** `HEAD` es la conducta de antes de la iteración 8 menos
  la espera exponencial a ciegas: una reversión parcial que mejora el original. Abortar durante la
  espera sigue funcionando.
- **El umbral del 0,1 %.** `HEAD` iguala o supera al tope viejo en las siete filas medidas, y una
  cola sana de `titleOnly` es indistinguible del escenario sin fin por construcción.
- **El mutante `break` → `return finish()`.** Hueco de cobertura, sin defecto de conducta hoy. Se
  aplaza con zona nombrada.
- **La iteración 10 aguanta:** las catorce rutas escapadas dan 404, y `/app.js`, `/%61pp.js` e
  `/index.html` siguen dando 200.

## Qué se deja fuera a propósito

- **El techo de peticiones** (`src/scrape.js:28`): 45.000 peticiones y ~9 h en el peor caso, ~7.000
  y 1,5 h en el realista. Es un número que no eligió nadie. Su propia iteración.
- **`Retry-After` sin tope** (`src/scrape.js:202-206`): un `Retry-After: 3600` cuelga la barra de
  progreso cinco horas. Cierre natural: `Math.min(ra, 60)`.
- **El check que falta de «corta la RAMA, no el scrape»** (`src/test_scrape.js:242-282`): los checks
  14 y 14b usan una palabra sin `OR`, así que el mutante `return finish()` pasa los siete en verde.
- Lo aplazado desde antes, que no se re-levanta: `render()` calculando `filteredRows()` dos veces en
  Rechazados, el guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo, el
  badge «sin ver» frío tras una restauración, la pérdida del Map de sesión sin `indexedDB`, los
  textos `csv:` huérfanos, y `cacheCsv` apuntando el índice antes de saber si el texto entró.

## Cómo se prueba (F4)

1. **`src/test_buttons.js`, check 31b**: un `lastScrape` con `ramasSecas: 1` y `parcial: false`
   tiene que dejar `csvIndex["ford.csv"]` puesto **y** sacar el aviso. Hoy sale en rojo: con el
   `parcial` de hoy no hay cache, y con el arreglo a medias no hay aviso.
2. **`src/test_buttons.js`, check 31b**: un scrape completo de cero filas no se cachea.
3. **`src/test_scrape.js`, check 14**: la aserción pasa de `api.lastScrape.parcial` a
   `api.lastScrape.ramasSecas === 1`. Sin cambiarla, el check exige justo lo que se quita.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Las tres pruebas rojas que salieron solas, palabra por palabra, cada una antes de su arreglo:

```
FAIL: no avisó de que una rama se cerró sola:
FAIL: un resultado vacío se cacheó: la búsqueda se queda a cero para siempre
FAIL: el recorte de "páginas vacías" no se marca parcial y se cachearía como definitivo
```

**Una del contrato no salió roja, y hay que decirlo.** El check «un recorte por no avanzar sí se
cachea» pasó verde desde el primer momento. El motivo: `test_buttons.js` **finge** `lastScrape`, así
que pone `parcial: false` a mano y se salta justo la línea de `scrape.js` que es el defecto. Es un
guardián de la condición de `app.js`, no una reproducción del hallazgo. Para probar que sirve de
algo lo maté con un mutante:

```
app.js  -> if (!diag.parcial && !diag.ramasSecas && data.length) cacheCsv(...)
  FAIL: un recorte por no avanzar no se cacheó: se re-scrapea entero en cada apertura
```

Y el término quitado de `scrape.js`, devuelto a su sitio, muere en el check 14:

```
scrape.js -> diag.parcial = ... || diag.ramasSecas > 0;
  FAIL: "páginas vacías" se marcó parcial: pierde el cache y se re-scrapea entero en cada apertura
```

La cadena de `snack` se partió en dos: el texto se calcula siempre y se enseña si hay algo que
decir; el cache es una condición aparte. Eso quita el `else` que ataba las dos cosas, que es lo que
convertía un aviso en un castigo. El mensaje de `ramasSecas` ya no dice «no se guarda», porque
ahora sí se guarda.

La medida del ciclo entero, con el `app.js` de verdad, contra los dos predecesores:

```
$ node iteraciones/repros/repro11_cache.js
426a036^ (sin freno)          200 páginas en tres aperturas · 160 anuncios · cachea
426a036  (MAX_PAGINAS=200)    200 páginas en tres aperturas · 160 anuncios · cachea
HEAD     (con esta iteración)  70 páginas en tres aperturas · 160 anuncios · cachea
```

Checks: `test_scrape.js` 54 → **57**, `test_buttons.js` 316 → **319**. Los siete checks de
`check.sh`, en verde y en silencio.
