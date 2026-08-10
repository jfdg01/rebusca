# Iteración 1 — robustez del triaje y de la parada

Método: `CICLO.md`. Investigado el 10/08/2026 con cinco lentes independientes sobre
`src/`, más un sintetizador que dedujo, filtró y priorizó. 7 hallazgos en pie, 3
descartados.

Este documento es el contrato de la implementación. Si el código se sale de aquí, se
actualiza esto primero.

---

## Se arregla ahora

### 1 · Una copia que no cabe en cuota corrompe el triaje — gravedad **alta**

`src/app.js:2306-2314`, handler de `#importState`.

El importador escribe las claves nuevas antes de borrar las sobrantes. Ese orden lo
arregló el defecto 1 de `MEJORAS.md`. Pero el bucle no es atómico: si la cuota revienta
en la clave número tres, las dos primeras ya están escritas. El snack dice **«no se ha
restaurado nada, tu triaje sigue intacto»**, y miente.

El agravante lo encontró la síntesis, no la lente. `hydrateEstado` da precedencia **por
campo** a la clave espejo sobre el blob:

```js
const mir = (k, blobVal) => (localStorage.getItem(k) != null ? readJSON(k, null) : blobVal);
```

`src/app.js:394-395`. Con `wp_favorite` machacado a medias, el próximo arranque hace caso
al `wp_favorite` de la copia ajena **aunque `wp_estado` conserve los favoritos reales**.
No hay reload, así que el usuario no ve nada hasta que cierra la pestaña. En iOS eso pasa
solo, cuando el sistema mata la pestaña en segundo plano.

- **Reproducido.** Antes `wp_favorite = {"ford.csv":["a1"]}`, después
  `{"x.csv":["z9"]}`, snack de «no se ha restaurado nada», `reloads = 0`.
- **Por qué pasó los 7 checks:** `src/test_buttons.js:972-995` (check 42) monta este
  escenario exacto, pero solo mira que `wp_estado` sobreviva y que no haya reload. Nunca
  mira el **contenido** de las claves ya escritas.
- **Arreglo:** guardar el valor previo de cada clave antes del bucle, y reponerlo si algo
  revienta. ~10 líneas, solo en el camino de error.
- **Riesgo de perder funcionalidad:** ninguno. Si todo cabe, el flujo es byte a byte el
  de hoy.
- **Check en rojo primero:** ampliar el check 42 para exigir
  `b.store.wp_favorite === '{"ford.csv":["a1"]}'`.

### 2 · «Parar búsqueda» no corta las esperas — gravedad **media**

`src/scrape.js:20`, y las tres llamadas de `:173`, `:177` y `:263`.

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

No recibe `signal` ni lo consulta. El usuario pulsa parar, el botón dice «parando…», y no
pasa nada hasta que expira la espera en curso: medio segundo en el jitter normal, hasta
17 s en un reintento por `429`, o lo que Wallapop mande en un `Retry-After`.

- **Reproducido** con `setTimeout` real: aborta a los 201 ms, resuelve a los 1203 ms.
- **Por qué no lo ve el test:** el sandbox de `src/test_scrape.js:46` sustituye
  `setTimeout` por uno instantáneo.
- **Arreglo:** `sleep(ms, signal)` que escucha `abort` y hace `clearTimeout`. ~7 líneas.
- **Trampa al implementar:** ese sandbox **no define `clearTimeout`**. Hay que añadirlo
  antes de tocar `scrape.js`, o los 30 checks revientan con `ReferenceError`.
- **Riesgo de perder funcionalidad:** ninguno. Sin abort espera igual que siempre.

### 3 · El stub `closest()` del arnés es un falso verde estructural — gravedad **media**

`src/test_app.js:156` — `closest: () => null,` sin condición.

`src/app.js:2577` guarda contra arrastrar el mazo cuando el dedo cae sobre un botón:

```js
if (!card || e.target.closest("a,button,input,.seller-banner")) return;
```

Esa guarda es **inalcanzable desde el arnés**. Borrarla deja los 7 checks en verde, con
sus 232 comprobaciones. En el navegador real, tocar Ver, Copiar, «Rechazar siguientes» o
el banner del vendedor arrancaría un gesto de swipe.

- **Reproducido:** guarda quitada, `node src/test_app.js && node src/test_buttons.js` →
  exit 0 los dos.
- **Arreglo:** que `closest` compruebe el propio elemento contra los selectores, con el
  `cls()` que ya existe en `src/test_app.js:120`. No hace falta subir el árbol: en el
  único uso, el target *es* el elemento a excluir. Más un check que dispare `pointerdown`
  sobre `#swVer` y exija que no haya `setPointerCapture`.
- **Riesgo de perder funcionalidad:** ninguno, solo toca el arnés.

### 4 · No hay runner: los 7 checks dependen de la memoria — gravedad **baja**

El único punto «Pendiente» de `MEJORAS.md`. No hay `check.sh`, ni hook, ni CI. Es el
defecto 6 con otra cara: 27 commits pasaron sobre un check en rojo.

- **Arreglo:** `check.sh` de ~10 líneas con el bucle de `CLAUDE.md` y salida no-cero.
  Opcional, `.githooks/pre-commit` de 2 líneas.
- **Descartado a propósito:** GitHub Actions. El repo no tiene remoto de CI y sería una
  pieza más que mantener.
- **Va primero**, porque abarata todos los commits siguientes.

### 5 · `opts` es una variable muerta — gravedad **baja**

`src/app.js:2204`. `const opts = $("#perfilOpts");` no se lee en ningún sitio; el
`<details>` es nativo y funciona solo. Una línea. Viaja de propina en cualquier commit.

---

## Confirmados, pero fuera de esta iteración

Los dos están diagnosticados y son ciertos. Quedan fuera porque **ninguno admite un check
que pueda ir en rojo antes del arreglo**, y eso choca con F4. No se vuelven a levantar
como hallazgos nuevos.

- **`render()` calcula `filteredRows()` dos veces en la vista «Rechazados»**
  (`src/app.js:1333`). Es CPU tirada, ningún dato sale mal. Un check tendría que espiar el
  número de llamadas, o sea acoplarse a la implementación.
- **El guardián `typeof snack === "function"`** (`src/app.js:11`) protege un caso
  imposible: `app.js` es script clásico y `snack` es una declaración hoisteada. Rama
  inalcanzable por construcción. Beneficio para el usuario: cero.

## Descartados

- **`fetchPesos` / `itemWeight` sin control de errores.** Esa feature ya no existe en el
  código. Solo queda el `removeItem("wp_pesos")` de limpieza en `src/app.js:357`. Y
  `MEJORAS.md:178-180` prohíbe reintroducir el patrón.
- **Unificar el patrón «mover a un cubo + `stampNow` + `save`»** de `reject`, `fling`,
  `enforceBlocks`, `blockSeller`, `rejectedLejos` y `rejectedExcluded`. Toca seis flujos a
  la vez, sin medir y sin reproducir, con riesgo directo sobre la regla 1. Una abstracción
  nueva que unifique seis flujos es justo lo que `CICLO.md` llama deuda con otro nombre.
  Merece una iteración propia con guardián de funcionalidad dedicado.
- **CI de verdad además del runner local.** Fundido en el hallazgo 4 y recortado.

## Zonas que nadie miró

Material para la iteración siguiente.

- `src/app.js:1595-1780` — `restoreLastCsv`, `loadSearches`, `csvIndex`. Solo lectura
  superficial.
- El evento `storage` entre pestañas: dos pestañas clasificando a la vez, o una importando
  mientras la otra escribe.
- `src/test_buttons.js` del check 1 al 37: puede haber más falsos verdes del tipo del
  `closest()`.
- `src/wallapop.py` fuera de su `demo()`. Riesgo bajo, no corre en producción.
- Zona visual y CSS. Esta iteración no toca un píxel, así que no hay captura que aprobar.
