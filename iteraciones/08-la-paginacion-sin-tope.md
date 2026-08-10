# Iteración 8 — la paginación sin tope, y el bloqueo que seguimos martilleando

**Zona:** `src/scrape.js` — el bucle de páginas (`236-277`), el corte por 403 (`246`), el canal
`diag` (`216`) y el backoff de `getJSON` (`173-193`).

**De dónde sale:** la iteración 7 la aplazó por escrito. El defecto se levantó en la review
adversaria de la iteración 5 y las iteraciones 6 y 7 lo dejaron fuera de zona a propósito, dos
veces. Aquí se paga.

**El tema de la iteración:** el scraper corre en el browser del usuario y pide contra
`api.wallapop.com` sobre **su** IP. Un bucle que no termina no es una espera larga: es el usuario
martilleando a Wallapop hasta que DataDome le bloquea la red de casa.

## Los hallazgos que sobreviven

### 1 · alta — el bucle de páginas no termina si las filas no crecen

`src/scrape.js:236`, y la condición de salida de `274-276`.

Las paradas del bucle son tres: `old` (el anuncio es más viejo que el filtro), `lleno` (la rama
agotó su cupo de filas) y un `next_page` ausente. **`old` solo puede ponerse si hay filtro de
frescura**: con «cualquier fecha», `maxDays` es `null` y el `if` de `262` no se evalúa nunca. Y
`lleno` mira `rows.length`. O sea: si las filas no crecen, ninguna de las dos condiciones locales
llega jamás, y el bucle depende por entero de que la API deje de mandar cursor.

El propio código lo sabía y no lo remató. `src/scrape.js:16-18`:

```js
// Con frescura "cualquiera" no hay corte por fecha ni por páginas: doce ramas OR son minutos de
// peticiones y un CSV que no cabe en el móvil. El CLI ya tenía --limit; el browser, nada.
const MAX_ROWS = 1500;
```

El tope de filas es el paliativo, y falla justo en el caso en que las filas no suben.

Tres escenarios, medidos. El arnés no lanza desde el `fetch` —el reintento de `getJSON` se lo
tragaría y se leería como otro fallo—: cuenta peticiones y aborta con el `signal`, que es
exactamente lo que hoy tiene que hacer el usuario a mano con el botón «parar».

```
$ node repro_pag.js
A · páginas vacías con next_page (API rota)
  peticiones 500  filas 0  abortado true  -> 6.3 min de martilleo con el sleep de verdad
B · el mismo cursor y los mismos items (dedup por `seen`)
  peticiones 500  filas 2  abortado true  -> 6.3 min de martilleo con el sleep de verdad
C · titleOnly y un catálogo que no casa (API SANA)
  peticiones 500  filas 0  abortado true  -> 6.3 min de martilleo con el sleep de verdad
```

Las 500 son el tope del arnés, no del scraper: el bucle seguía. `abortado true` quiere decir que
lo único que lo paró fue el abort.

**El escenario C no necesita una API rota**, y es el que se ve en producción: con «solo en el
título» y una palabra que casi no aparece en los títulos, cada página trae items que el filtro
descarta, las filas no suben y el scraper recorre el catálogo entero. El usuario ve el contador
parado y el reloj subiendo.

**Arreglo:** un contador de páginas para todo el scrape, no por rama.

```js
const MAX_PAGINAS = 200;  // un scrape legítimo de 32 ramas gasta ~64 (cupo ~47 filas por rama,
                          // ~40 items por página); 200 deja holgura de sobra y corta la fuga
                          // en dos minutos y medio en vez de nunca
```

Sale por el canal que ya existe: `diag.paginasTope` entra en `diag.parcial`, así que `app.js` no
cachea el recorte como definitivo y lo dice con su propio mensaje. No se pierde ninguna búsqueda
que hoy termine: lo que corta es lo que hoy no termina.

### 2 · media — el 403 de DataDome corta la rama, y las demás siguen pidiendo

`src/scrape.js:246`. El comentario dice «bloqueo: corta esta rama, conserva lo ya recogido», y eso
es lo que hace: `break` sale del `while`, y el `for` de ramas pasa a la siguiente, que vuelve a
pedir contra un servidor que acaba de bloquear a este usuario.

```
$ node repro_403.js
D · 403 con 12 ramas OR
  peticiones con el bloqueo puesto: 12  (ramas 12, rotas 12)
```

Con el máximo de 32 ramas son 32 peticiones seguidas después del primer «no». DataDome escala el
castigo con la insistencia, así que el precio no es el tiempo: es que el bloqueo dure más.

**Arreglo:** el 403 corta el scrape entero, no la rama, y `diag` gana `bloqueado` para que el
usuario lea qué le pasa en vez de «12 de 12 ramas fallaron». Lo ya recogido se conserva —`finish()`
devuelve las filas—, así que la regla dura 1 se respeta.

### 3 · baja — el último reintento duerme 16 s y se rinde igual

`src/scrape.js:173-193`. El bucle de reintentos duerme **después** del quinto intento y a
continuación lanza `"agotados los reintentos"`. La última espera no precede a nada.

```
$ node repro_403.js
E · 5xx: el sleep del último intento
  peticiones 5  dormido 33 s  -> "agotados los reintentos"
```

De esos 33 s, unos 16 son la espera del intento que no existe. Con las ramas cayendo una a una, es
medio minuto por rama que el usuario mira sin que pase nada.

**Arreglo:** una línea dentro del `for`, y las dos llamadas a `sleep` pasan por ella.

```js
// el último intento no duerme: esperar 16 s y rendirse igual es espera regalada
const esperar = (ms) => (a < 4 ? sleep(ms, signal) : Promise.resolve());
```

## Descartados, con el motivo

- **`throw e` sin pasar por `finish()`** (`src/scrape.js:251`): con la primera rama rota y cero
  filas, `scrape()` lanza y `api.lastScrape` conserva el diagnóstico del scrape anterior. Sin
  síntoma: `app.js:2007` solo lee `lastScrape` en la ruta de éxito, y el siguiente scrape que
  termine lo reescribe. Regla dura 2.
- **`titleOnly` descarta antes de `seen.add`**, así que un item que no casa se vuelve a evaluar en
  cada rama. Es trabajo de CPU sin petición de red y sin efecto en el resultado. Sin síntoma.
- **El jitter entre ramas.** Al acabar una rama, la primera petición de la siguiente sale sin
  esperar. Real, pero es una petición cada varias decenas: no reproduce ningún bloqueo.

## Qué se deja fuera a propósito

Lo aplazado sigue aplazado y no se re-levanta: `render()` calculando `filteredRows()` dos veces en
Rechazados, el guardián `typeof snack === "function"`, el hook de pre-commit midiendo el árbol de
trabajo en vez del índice, el badge «sin ver» frío tras una restauración, la pérdida del Map de
sesión en un navegador sin `indexedDB`, y los textos `csv:` huérfanos de `cacheCsv`.

## Cómo se prueba (F4)

Los tres arreglos se ven en rojo antes de existir, en `src/test_scrape.js`, que ya tiene el `fetch`
falso y el reloj instantáneo montados:

1. una API que sirve páginas con cursor y sin filas nuevas termina, y termina marcando `parcial`;
2. un 403 en la primera rama deja el resto sin pedir;
3. cinco fallos de 5xx no dejan pegada la espera del quinto.

Después, los siete checks de `check.sh`.

## Lo que cambió al implementarlo

Nada del contrato. Las diez pruebas rojas, palabra por palabra, capturadas antes del arreglo con
una variante de la suite que acumula fallos en vez de parar en el primero:

```
FAIL: sin tope de páginas: "páginas vacías" pidió 401 veces
FAIL: el recorte de "páginas vacías" no se marca parcial y se cachearía como definitivo
FAIL: sin tope de páginas: "el mismo item una y otra vez" pidió 401 veces
FAIL: el recorte de "el mismo item una y otra vez" no se marca parcial y se cachearía como definitivo
FAIL: sin tope de páginas: "titleOnly y nada que case" pidió 401 veces
FAIL: el recorte de "titleOnly y nada que case" no se marca parcial y se cachearía como definitivo
FAIL: tras el 403 se siguió pidiendo: 3 peticiones
FAIL: el bloqueo no sale por el diagnóstico y el usuario no sabe qué le pasa
FAIL: el intento que no existe también durmió: 5 esperas para 5 intentos
FAIL: la espera más larga es la del intento que se rinde: 16998.520018810417
```

Los tres escenarios del hallazgo 1 apagan el cursor a las 400 páginas. Ese freno salva al **test**,
no al scraper: sin él la suite no falla, se queda sin memoria. Que hiciera falta ponerlo es la
medida exacta del defecto.

Dos cosas que el contrato no preveía:

- **El aviso al usuario.** `parcial` ya existía, pero `src/app.js` no tenía frase para los dos
  cortes nuevos. Sin ella el usuario ve menos anuncios y ningún motivo. Dos ramas más en el `snack`:
  el bloqueo de red y el tope de páginas.
- **Un término que ningún mutante mata.** `diag.parcial` iba a llevar `|| diag.bloqueado`. Quitado,
  los 48 checks siguen verdes: `bloqueado` solo se pone detrás de `ramasRotas++`, que ya cuenta.
  Medido antes de borrarlo, y el comentario de `src/scrape.js:222` dice por qué no vuelve.

Checks de `test_scrape.js`: 32 → **48**. Los siete checks de `check.sh`, en verde y en silencio.
