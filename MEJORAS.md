# Defectos abiertos — auditoría tras las 24 mejoras (2026-08-09)

Este fichero sustituye a la lista de mejoras pendientes. Las 24 están hechas. Lo que
queda son los defectos que esas 24 introdujeron, más la brecha de testing que dejó
pasar uno de ellos durante 27 commits.

**Gravedad** — `alta` = rompe o corrompe datos del usuario · `media` = comportamiento
erróneo visible · `baja` = molestia, o un falso verde en los tests.
**Coste** — `XS` = una línea o dos · `S` = menos de media hora · `M` = unas horas.

Cómo se sacó: cinco auditores independientes sobre el diff acumulado de los 27 commits
y sobre el código real, más un verificador adversario que intentó refutar cada hallazgo.
14 hallazgos en bruto, **8 descartados**, 6 en pie. Cada uno de los 6 se reprodujo
ejecutando código, no solo leyéndolo. Las reproducciones usan el arnés de
`src/test_app.js` o un `fetch` falso, sin red.

## Resumen

| # | Defecto | Gravedad | Coste | Origen | Dónde |
|--:|---------|:--------:|:-----:|:------:|-------|
| 1 | Restaurar una copia borra lo viejo antes de escribir lo nuevo | alta | XS | `115650b` | `src/app.js:2299` |
| 2 | El tope de 1500 filas deja ramas del `OR` sin pedir | media | S | `83d12ae` | `src/scrape.js:252` |
| 3 | La copia de seguridad no lleva el caché de filas (IndexedDB) | media | S | `115650b` | `src/app.js:2264` |
| 4 | El desplegable «Afinar» no se deja cerrar | media | XS | `7044a2d` | `src/app.js:1139` |
| 5 | El lector de pantalla canta el estado entero cada segundo | media | XS | `d599d93` | `src/index.html:301` |
| 6 | `test_scrape.js` falla, y ningún runner lo ejecuta | baja | XS | `b4f4a6a` | `src/test_scrape.js:173` |

---

## 1. Restaurar una copia borra lo viejo antes de escribir lo nuevo

- [ ] Gravedad **alta** · Coste XS · `115650b`

El importador borra todas las claves `wp_*` y solo después escribe las de la copia. El
`setItem` es crudo: no pasa por `setLS`, que sí atrapa `QuotaExceededError`. Si la cuota
revienta a mitad, el bucle muere, `location.reload()` no llega, y el `.catch` pinta
`"Copia no válida: ..."`. Ese mensaje suena a fichero malo. La verdad es que el triaje
del usuario ya no existe.

```js
for (const k of backupKeys()) localStorage.removeItem(k);   // borra TODO primero
for (const k in datos) localStorage.setItem(k, datos[k]);   // setItem crudo, sin catch
```

- Evidencia: `src/app.js:2290-2303`. `JSON.parse` va antes del borrado, así que un fichero
  corrupto sí está a salvo. El par borrar/escribir no tiene ni validación previa ni marcha
  atrás. Reproducido con el arnés de `src/test_app.js` y la cuota apretada: estado inicial
  de tres claves, copia de tres claves, salida real `store final:
  {"wp_favorite":"nuevo1","wp_rejected":"nuevo2"}` y `reloads: 0`. `wp_estado` desaparecido,
  `wp_searches` nunca escrito, sin recarga y sin aviso de pérdida.
- Arreglo: invierte el orden. Lo viejo sobrevive si la escritura falla.

```js
const nuevas = Object.keys(datos);
for (const k of nuevas) localStorage.setItem(k, datos[k]);
for (const k of backupKeys()) if (!nuevas.includes(k)) localStorage.removeItem(k);
```

- Aparte: `for (const k in datos)` no filtra por `wp_`. Una copia manipulada escribe
  cualquier clave de `localStorage`. Es menor, pero el filtro cuesta una condición.

## 2. El tope de 1500 filas deja ramas del `OR` sin pedir

- [ ] Gravedad **media** · Coste S · `83d12ae`

`return finish()` sale de los dos bucles: el de páginas y el de ramas. Busca
`iphone OR pixel OR xiaomi`. La primera rama sola llena el tope. Las otras dos no piden
ni una página. El usuario ve 1500 iPhones y cero Xiaomis.

- Evidencia: `src/scrape.js:252`. Reproducido en un `vm` con `fetch` falso, 1000 anuncios
  por rama y páginas de 100: `total filas 1500`, reparto `{ aaa: 1000, bbb: 500 }`, y
  `ccc` nunca se pidió. El `diag` resultante es
  `{ramas:3, ramasRotas:0, tope:1500, parcial:true}`, indistinguible de un recorte
  repartido. El aviso de `src/app.js:1945` tampoco lo dice. El único test del tope
  (`src/test_app.js`, bloque 12m) usa una sola rama.
- Arreglo: reparte el tope entre ramas (`maxRows / ramas`), o cuenta las ramas sin pedir
  en `diag` y dilo en el aviso.

## 3. La copia de seguridad no lleva el caché de filas (IndexedDB)

- [ ] Gravedad **media** · Coste S · `115650b`

`backupKeys()` solo recorre `localStorage`. `rowCache` vive en IndexedDB. Marcas favorito
un anuncio. Wallapop lo retira. El id sigue en `wp_favorite`, pero la fila con su título,
precio, URL y foto solo está en IndexedDB. Exportas, importas en otro móvil, y el favorito
se cae en `bucketRows()` con un `console.warn`. El botón prometía una copia del estado.

- Evidencia: `src/app.js:2265-2272` (`backupKeys`) y `src/app.js:2264` (`BACKUP_SKIP`, que
  ni contempla IndexedDB). `rowCache` se persiste con `idb.set('rows', ...)` en
  `src/app.js:259` y `268`, y `wp_rows` se borra de `localStorage` en la migración
  (`src/app.js:1817-1820`), así que la copia nunca puede incluirlo. Reproducido: el Blob
  exportado da `contiene "Sofa vintage"? false` y `contiene id z9? true`.
- Arreglo: mete en el JSON las filas de `rowCache` cuyos ids estén en favoritos o
  rechazados. Son las únicas que el usuario echará de menos.

## 4. El desplegable «Afinar» no se deja cerrar

- [ ] Gravedad **media** · Coste XS · `7044a2d`

`renderExcl()` corre en cada `render()`, y con un filtro puesto vuelve a abrir el
`<details id="excl">`. Marcas un favorito, haces swipe, u otra pestaña dispara `storage`:
se abre otra vez. La cabecera queda desplegada para siempre, que es justo lo que el
commit venía a arreglar. El `<details id="cats">` hermano no hace esto y sí respeta al
usuario.

- Evidencia: `src/app.js:1139`, `if (puestos) box.open = true;`, llamada incondicional
  desde `render()` en `src/app.js:1037`. No hay ninguna rama que ponga `open = false` ni
  que recuerde un cierre manual. Reproducido con el arnés: tras forzar `#excl.open = false`
  y hacer un `render()` ajeno, la salida es `excl.open tras render ajeno: true`.
- Arreglo: fuerza la apertura solo cuando cambie el número de filtros.

```js
if (puestos && box.dataset.n !== String(puestos)) box.open = true;
box.dataset.n = puestos;
```

## 5. El lector de pantalla canta el estado entero cada segundo

- [ ] Gravedad **media** · Coste XS · `d599d93`

`#loading` es `role="status" aria-live="polite"`, y `#loadingTime` vive dentro.
`startTimer()` lo reescribe con `setInterval` cada 1000 ms. Cada tick muta la región viva.
El lector repite «N encontrados · rama 2/12, 47s buscando · parar búsqueda» una vez por
segundo, durante toda la búsqueda. La mejora de accesibilidad hace la espera más difícil
de seguir que el silencio que venía a arreglar.

- Evidencia: `src/index.html:301-310` (el cronómetro y el enlace «parar búsqueda» están
  dentro de la región) y `src/app.js:1887-1897` (`startTimer` con su `setInterval`).
  El contador por anuncio de `src/scrape.js:248` **no** es el problema: esas mutaciones
  caen todas en la misma tarea síncrona entre dos `fetch`, y el árbol de accesibilidad
  solo ve el valor final. El cronómetro sí es una tarea por segundo.
- Arreglo: saca el cronómetro de la región viva. Pon el `role="status"` en `#loadingCount`,
  o `aria-live="off"` en `#loadingTime`.

## 6. `test_scrape.js` falla, y ningún runner lo ejecuta

- [ ] Gravedad **baja** · Coste XS · `b4f4a6a`

`node src/test_scrape.js` sale con código 1: `FAIL: onProgress no contó bien: 0,1,2`.
El test está mal, no `scrape.js`. El commit añadió `aviso()` también al entrar en cada
rama, y eso es deliberado: una rama sin resultados también mueve el contador.
`test_app.js` y `test_buttons.js` sí se actualizaron. `test_scrape.js` no.

Esta es la brecha de testing de verdad. 27 commits pasaron por encima de un check en rojo
sin que nadie lo viera, porque el fichero no está en la lista de comandos de `CLAUDE.md`.
No hay CI ni hooks. `test_servidor.py` está igual de huérfano.

- Evidencia: `src/test_scrape.js:168-174` espera la secuencia `"1,2"`; `src/scrape.js:212`
  emite el aviso de entrada de rama; el contrato documentado en `src/scrape.js:183-184` es
  `onProgress(filas, rama, ramas)`. `git log -3 -- src/test_scrape.js` da un último toque
  anterior al commit que cambió el contrato.
- Arreglo: cambia la expectativa a `"0,1,2"`, y añade los dos comandos huérfanos a la
  lista de `CLAUDE.md`. Ya están añadidos en `README.md` y en `DESARROLLO.md`.

---

## Verificado y limpio

Estas zonas se auditaron y no tienen defecto. No son «sin mirar».

- **Enlace profundo** (`fromURL`, `src/app.js:2324`). Está endurecido de verdad:
  `Object.hasOwn` contra la contaminación de prototipo, `Set` para deduplicar,
  `parseFloat` con aviso al usuario cuando el tope viene mal, y `replaceState` para que
  el enlace sea de un solo uso.
- **Texto de la API en el DOM.** Los 27 commits añadieron siete `textContent` y un solo
  `innerHTML`, y ese es `tbody.innerHTML = ""`. No hay superficie nueva de inyección.
- **`manifest.webmanifest` y `apple-touch-icon.png`.** El servidor los sirve con el
  `Content-Type` correcto (`application/manifest+json` e `image/png`) y `stamp_versions`
  los versiona. El `theme-color` claro y el oscuro están los dos en el `<meta>`.
- **Duplicados del mismo vendedor** (`src/app.js:596`). Es un `Map` de una pasada, O(n),
  no O(n²). El vendedor vacío no agrupa.
- **`decoding="async"`.** Es un atributo del `<img>`, no `img.decode()`. No hay promesa
  sin `catch` ni carrera con el repintado.

## Descartados

El verificador mató estos ocho. Se apuntan para que nadie los vuelva a levantar.

- Cancelar la hoja de compartir dispara la copia al portapapeles: es intencionado
  (`src/app.js:2773-2776`) y los mensajes son veraces.
- El manifest no tiene variante oscura: ningún navegador acepta media queries en el
  `theme_color` del manifest. Los `<meta>` sí lo cubren.
- El contador del scrape dispara la región viva por anuncio: refutado, las mutaciones caen
  en la misma tarea síncrona. El defecto real es el cronómetro (defecto 5).
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
