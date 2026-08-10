# Defectos de la auditoría — cerrados (2026-08-09)

Los 6 defectos que encontró la auditoría de los 27 commits están arreglados, cada uno con
su test en rojo antes del arreglo. Este fichero queda como registro: qué falló, por qué, y
qué check lo vigila ahora. Lo que sigue abierto está al final, en «Pendiente».

**Gravedad** — `alta` = rompe o corrompe datos del usuario · `media` = comportamiento
erróneo visible · `baja` = molestia, o un falso verde en los tests.

Cómo se sacó: cinco auditores independientes sobre el diff acumulado de los 27 commits
y sobre el código real, más un verificador adversario que intentó refutar cada hallazgo.
14 hallazgos en bruto, **8 descartados**, 6 en pie. Cada uno de los 6 se reprodujo
ejecutando código, no solo leyéndolo.

## Resumen

| # | Defecto | Gravedad | Arreglado en | Lo vigila |
|--:|---------|:--------:|:------------:|-----------|
| 1 | Restaurar una copia borra lo viejo antes de escribir lo nuevo | alta | `7363244` | `test_buttons.js` 42 |
| 2 | El tope de 1500 filas deja ramas del `OR` sin pedir | media | `9a01fbb` | `test_scrape.js` 13 y 13b |
| 3 | La copia de seguridad no lleva el caché de filas (IndexedDB) | media | `7363244` | `test_buttons.js` 43 |
| 4 | El desplegable «Afinar» no se deja cerrar | media | `4def39f` | `test_buttons.js` 44 |
| 5 | El lector de pantalla canta el estado entero cada segundo | media | `4def39f` | `test_app.js` 12i-bis |
| 6 | `test_scrape.js` falla, y ningún runner lo ejecuta | baja | `9a01fbb` | el bucle de 7 checks de `CLAUDE.md` |

---

## 1. Restaurar una copia borra lo viejo antes de escribir lo nuevo

- [x] Gravedad **alta** · `115650b` → `7363244`

El importador borraba todas las claves `wp_*` y solo después escribía las de la copia. El
`setItem` era crudo: no pasa por `setLS`, que sí atrapa `QuotaExceededError`. Si la cuota
reventaba a mitad, el bucle moría, `location.reload()` no llegaba, y el `.catch` pintaba
`"Copia no válida: ..."`. Ese mensaje suena a fichero malo. La verdad era que el triaje
del usuario ya no existía.

- Evidencia: `src/app.js:2290-2303` del código viejo. Reproducido con el arnés de
  `src/test_app.js` y la cuota apretada: `wp_estado` desaparecido, `wp_searches` nunca
  escrito, sin recarga y sin aviso de pérdida.
- Arreglo: escribir primero, borrar las sobrantes después. Lo viejo sobrevive si la
  escritura falla. Solo se escriben claves `wp_`, así que una copia manipulada no ensucia
  el almacén. El aviso de cuota dice lo que pasa de verdad y que el triaje sigue intacto.

```js
const nuevas = Object.keys(datos).filter((k) => k.startsWith("wp_"));
for (const k of nuevas) localStorage.setItem(k, datos[k]);
for (const k of backupKeys()) if (!nuevas.includes(k)) localStorage.removeItem(k);
```

> Este arreglo se quedó corto y las iteraciones 1 y 2 lo profundizaron: el bucle no era
> atómico y la escritura de IndexedDB caía fuera. El código de hoy envuelve las tres
> operaciones y las deshace. Ver `iteraciones/01-robustez.md` (hallazgo 1) y
> `iteraciones/02-import-atomico.md` (hallazgos 1 y 2).

## 2. El tope de 1500 filas deja ramas del `OR` sin pedir

- [x] Gravedad **media** · `83d12ae` → `9a01fbb`

`return finish()` salía de los dos bucles: el de páginas y el de ramas. Con
`iphone OR pixel OR xiaomi`, la primera rama llenaba el tope sola. Las otras dos no pedían
ni una página. El usuario veía 1500 iPhones y cero Xiaomis.

- Evidencia: reproducido en un `vm` con `fetch` falso, 1000 anuncios por rama y páginas de
  100: `total filas 1500`, reparto `{ aaa: 1000, bbb: 500 }`, y `ccc` nunca se pidió.
- Arreglo: cupo acumulado por rama, `Math.ceil(maxRows * (i + 1) / ramas)`. Se mide sobre
  el total de filas, no por rama, así que lo que una rama no gasta queda para las de
  después. Llenar el cupo corta esa rama, no la búsqueda. `diag.ramasTope` cuenta las
  ramas cortadas y el aviso de `src/app.js` lo dice en vez de inventar ramas caídas.
- `src/wallapop.py` no tiene este defecto: allí las ramas van en paralelo con un `stop`
  compartido, así que ninguna puede dejar a otra sin pedir.

## 3. La copia de seguridad no lleva el caché de filas (IndexedDB)

- [x] Gravedad **media** · `115650b` → `7363244`

`backupKeys()` solo recorre `localStorage`. `rowCache` vive en IndexedDB. Marcas favorito
un anuncio, Wallapop lo retira, el id sigue en `wp_favorite`, pero su título, precio, URL y
foto solo están en IndexedDB. Exportabas, importabas en otro móvil, y el favorito se caía
en `bucketRows()` con un `console.warn`.

- Evidencia: el Blob exportado daba `contiene "Sofa vintage"? false` y `contiene id z9? true`.
- Arreglo: el JSON lleva un campo `filas` con `rowCache`, que ya viene podado a los ids
  clasificados. Al restaurar se espera a `idb.set("rows", ...)` antes de recargar: sin la
  espera, `location.reload()` mata la transacción a medias. Una copia vieja sin `filas`
  se sigue restaurando igual.

## 4. El desplegable «Afinar» no se deja cerrar

- [x] Gravedad **media** · `7044a2d` → `4def39f`

`renderExcl()` corre en cada `render()`, y con un filtro puesto volvía a abrir el
`<details id="excl">`. Marcabas un favorito, hacías swipe, u otra pestaña disparaba
`storage`: se abría otra vez. La cabecera quedaba desplegada para siempre, que es justo lo
que el commit venía a arreglar.

- Evidencia: tras forzar `#excl.open = false` y hacer un `render()` ajeno, la salida era
  `excl.open tras render ajeno: true`.
- Arreglo: abrir solo cuando cambie el número de filtros. Un filtro nuevo sigue avisando;
  un cierre manual se respeta.

```js
if (puestos && box.dataset.n !== String(puestos)) box.open = true;
box.dataset.n = String(puestos);
```

## 5. El lector de pantalla canta el estado entero cada segundo

- [x] Gravedad **media** · `d599d93` → `4def39f`

`#loading` era `role="status" aria-live="polite"`, y `#loadingTime` vivía dentro.
`startTimer()` lo reescribe con `setInterval` cada 1000 ms. Cada tick mutaba la región viva,
así que el lector repetía «N encontrados · rama 2/12, 47s buscando · parar búsqueda» una vez
por segundo durante toda la búsqueda.

- Evidencia: `src/index.html:301-310` (el cronómetro y el enlace «parar búsqueda» estaban
  dentro de la región) y `src/app.js:1887-1897` (`startTimer`). El contador por anuncio de
  `src/scrape.js` **no** era el problema: esas mutaciones caen todas en la misma tarea
  síncrona entre dos `fetch`, y el árbol de accesibilidad solo ve el valor final.
- Arreglo: la región viva es solo `#loadingCount`. El cronómetro y el enlace de parar se
  quedan fuera.

## 6. `test_scrape.js` falla, y ningún runner lo ejecuta

- [x] Gravedad **baja** · `b4f4a6a` → `9a01fbb`

`node src/test_scrape.js` salía con código 1: `FAIL: onProgress no contó bien: 0,1,2`.
El test estaba mal, no `scrape.js`. El commit añadió `aviso()` también al entrar en cada
rama, y eso es deliberado: una rama sin resultados también mueve el contador.
`test_app.js` y `test_buttons.js` sí se actualizaron. `test_scrape.js` no.

Esta era la brecha de testing de verdad. 27 commits pasaron por encima de un check en rojo
sin que nadie lo viera, porque el fichero no estaba en la lista de comandos de `CLAUDE.md`.
`test_servidor.py` estaba igual de huérfano.

- Arreglo: la expectativa correcta es `"0,1,2"`, y los dos comandos huérfanos ya están en
  la lista de `CLAUDE.md`, `README.md` y `DESARROLLO.md`, con un bucle que corre los siete.

---

## Pendiente

- [x] **Cerrado en la iteración 33** (`test_servidor.py`, bloque 2b: las directivas que
  aguantan peso van clavadas a mano, y los doce mutantes de las cabeceras mueren).
  **Las cabeceras de seguridad se comparan consigo mismas.** `src/test_servidor.py`
  comprueba que la respuesta trae cada cabecera de `servidor.SEC_HEADERS`, y el valor
  esperado lo saca de ese mismo diccionario. Cambiar `script-src 'self'` por `script-src *`
  pasa los siete checks sin despeinarse, y con él se cae la mitigación del DOM-XSS que
  documenta `src/servidor.py:19-22` (la app mete datos scrapeados de Wallapop por
  `innerHTML`). Clavar las directivas que aguantan peso es una decisión de seguridad, no un
  arreglo mecánico: va a su propia iteración. Encontrado en la iteración 31.
- [x] **Cerrado en la iteración 35** (`test_servidor.py`, bloque 10: se levanta el proceso
  entero, como lo levanta systemd, y se le pide la portada). **El arranque del server no se
  mide.** `PORT` del entorno y el argumento posicional (`src/servidor.py:167-173`) viven
  dentro de `if __name__ == "__main__"`. Se podían romper los dos con los siete checks en
  verde, y `PORT=8123 python3 src/servidor.py` es el servidor de pruebas que documenta
  `CLAUDE.md`. Encontrado en la iteración 31.
  Queda sin medir una sola cosa del bloque: que el bind sea `0.0.0.0` y no `127.0.0.1`.
  Medirlo pide una segunda interfaz de red, y el check saldría inestable en un contenedor.

- [x] **No hay runner ni CI.** Era el defecto 6 con otra cara: el bucle de siete comandos
  dependía de que alguien se acordara. Ahora `./check.sh` los corre de una (~5 s, sale 1
  si alguno falla) y `.githooks/pre-commit` lo dispara en cada commit. `check.sh` avisa
  si el hook no está activado en el clon, que es el único paso que queda a mano.
  Validado rompiendo `src/scrape.js` a propósito: 4 de 7 en rojo, exit 1, y revertido.
  Sin GitHub Actions: el repo no tiene remoto de CI y sería otra pieza que mantener.

- [ ] **Revisar el bucle de afinar la búsqueda** (añadido el 2026-08-11, con la feature
  recién puesta). La IA recibe ahora una muestra al azar del mazo y la URL entera de la
  búsqueda, y devuelve un segundo enlace `?q=…` con la query corregida. Está probado con
  los checks, no con uso real. Lo que hay que mirar cuando lleve unas cuantas vueltas:
  - **Copiar dos veces manda dos lotes DISTINTOS.** `wp_aisent` guarda solo el último, así
    que pegar la respuesta del primero rechaza anuncios que esa respuesta nunca vio. Antes
    no pasaba: los dos lotes eran los mismos 60 primeros. Es el riesgo real que introdujo
    el muestreo. Arreglo probable: no re-muestrear si el mazo no ha cambiado desde la
    última copia, o avisar al copiar por segunda vez.
  - **Quitar una exclusión no se puede por enlace**: el `excl` de un deep-link se suma al
    del cajón (`app.js`, `fromURL`). Si la IA se pasa de celosa, el usuario tiene que
    borrar el chip a mano. Documentado en `llms.txt`, sin arreglar.
  - El bloque de afinar se cuela también en «copiar favoritos» y en el PDF dossier, donde
    no aporta. Se dejó así por no meter un flag en tres llamadas; si molesta, es trivial.
  - `URLSearchParams` encodea las comas (`excl=roto%2Cpiezas`). Funciona, se lee peor.
  - Sin medir: si la IA de verdad devuelve el enlace afinado y si converge en 2-3 vueltas
    o se queda dando tumbos. Eso solo lo dice el uso.

## Verificado y limpio

Estas zonas se auditaron y no tienen defecto. No son «sin mirar».

- **Enlace profundo** (`fromURL`). Está endurecido de verdad: `Object.hasOwn` contra la
  contaminación de prototipo, `Set` para deduplicar, `parseFloat` con aviso al usuario
  cuando el tope viene mal, y `replaceState` para que el enlace sea de un solo uso.
- **Texto de la API en el DOM.** Los 27 commits añadieron siete `textContent` y un solo
  `innerHTML`, y ese es `tbody.innerHTML = ""`. No hay superficie nueva de inyección.
- **`manifest.webmanifest` y `apple-touch-icon.png`.** El servidor los sirve con el
  `Content-Type` correcto (`application/manifest+json` e `image/png`) y `stamp_versions`
  los versiona. El `theme-color` claro y el oscuro están los dos en el `<meta>`.
- **Duplicados del mismo vendedor.** Es un `Map` de una pasada, O(n), no O(n²). El
  vendedor vacío no agrupa.
- **`decoding="async"`.** Es un atributo del `<img>`, no `img.decode()`. No hay promesa
  sin `catch` ni carrera con el repintado.

## Descartados

El verificador mató estos ocho. Se apuntan para que nadie los vuelva a levantar.

- Cancelar la hoja de compartir dispara la copia al portapapeles: es intencionado
  (`src/app.js`) y los mensajes son veraces.
- El manifest no tiene variante oscura: ningún navegador acepta media queries en el
  `theme_color` del manifest. Los `<meta>` sí lo cubren.
- El contador del scrape dispara la región viva por anuncio: refutado, las mutaciones caen
  en la misma tarea síncrona. El defecto real era el cronómetro (defecto 5).
- Tres mejoras de solo CSS sin aserción (botones del swipe a 44 px, título a dos líneas,
  altura de la cabecera compacta): ningún arnés sin navegador mide píxeles. Se validan por
  captura, y así está documentado.
- El stub de `querySelector` del arnés no valida que el selector exista: se comprobó que
  los diez selectores nuevos existen en `src/index.html`. Es un riesgo del arnés, no un
  fallo de hoy.

## Restricciones que siguen vigentes

**No** vuelvas a pedir la ficha de cada anuncio para sacar la reputación del vendedor o el
estado del artículo. La API de búsqueda no los trae, y ese patrón es justo el que se quitó
en `d506eb2`.
