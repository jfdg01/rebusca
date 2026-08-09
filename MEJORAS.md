# Mejoras pendientes — auditoría de UX (2026-08-09)

Lista **ordenada por retorno**: valor para el usuario dividido por coste de hacerlo.
Cada punto lleva la evidencia en `fichero:línea` y el arreglo mínimo que funciona.

- **Valor** — 1 a 5. 5 = el usuario lo nota en cada sesión.
- **Coste** — `XS` = una línea o un atributo (0,5) · `S` = menos de media hora (1) ·
  `M` = unas horas (3) · `L` = un día o más (6).
- **Retorno** = valor ÷ coste. La columna *imp.* es el puesto en la lista anterior, ordenada
  solo por importancia.

> **Aviso: el retorno premia lo barato, no lo grave.** Los dos puntos de más valor absoluto
> caen a media tabla porque cuestan más: la **ubicación real** (nº 5) y la **copia de
> seguridad** (nº 20). El resto de la lista mejora la app; esos dos arreglan que hoy miente en
> cada kilómetro y que un borrado del navegador se lleva meses de trabajo. Si solo haces tres
> cosas, haz esas dos y la señal de precio.

Cómo se sacó: lectura del código completo (`app.js`, `scrape.js`, `index.html`, `app.css`,
`servidor.py`), capturas reales de la app corriendo en el server de pruebas (320×632, DPR 2)
y peticiones reales a `api.wallapop.com` para comprobar qué campos manda de verdad. Nada de
harness aparte. Ningún punto se apuntó sin verificarlo.

## Resumen

| # | Mejora | Valor | Coste | Retorno | imp. |
|--:|--------|:-----:|:-----:|--------:|-----:|
| 1 | Botones ✓ y ✕ del swipe a 44 px | 4 | XS | 8,0 | 6 |
| 2 | Listener del evento `storage` (dos pestañas) | 3 | XS | 6,0 | 9 |
| 3 | Título a dos líneas en las listas | 3 | XS | 6,0 | 11 |
| 4 | Esconder "Búsqueda activa" en el primer arranque | 3 | XS | 6,0 | 12 |
| 5 | **La ubicación real del usuario** | 5 | S | 5,0 | 1 |
| 6 | **Señal de precio (mediana del lote)** | 5 | S | 5,0 | 4 |
| 7 | La tarjeta enseña lo que la app ya sabe | 4 | S | 4,0 | 3 |
| 8 | No construir cientos de `<tr>` invisibles | 4 | S | 4,0 | 5 |
| 9 | `aria-live` en la carga y en el snack | 2 | XS | 4,0 | 13 |
| 10 | "Quitar" en rojo también en reposo | 2 | XS | 4,0 | 14 |
| 11 | Manifest para instalar en la pantalla de inicio | 3 | S | 3,0 | 8 |
| 12 | El contador dice por qué rama va | 3 | S | 3,0 | 10 |
| 13 | Botón que genera el enlace de la búsqueda | 3 | S | 3,0 | 18 |
| 14 | Tope en las búsquedas muy amplias | 3 | S | 3,0 | 21 |
| 15 | Recordar el orden de Favoritos y Papelera | 2 | S | 2,0 | 15 |
| 16 | Acercar la ayuda de la gramática al buscador | 2 | S | 2,0 | 17 |
| 17 | `navigator.share` antes del portapapeles | 2 | S | 2,0 | 22 |
| 18 | Desglosar el contador de "excluidos" | 2 | S | 2,0 | 24 |
| 19 | `decoding="async"` en la imagen de tarjeta | 1 | XS | 2,0 | 16 |
| 20 | **Copia de seguridad del estado** | 5 | M | 1,7 | 2 |
| 21 | Aviso de novedades fuera del gestor | 3 | M | 1,0 | 7 |
| 22 | Cabecera más compacta con resultados | 3 | M | 1,0 | 20 |
| 23 | Modo oscuro | 3 | M | 1,0 | 19 |
| 24 | Marcar posibles duplicados | 3 | M | 1,0 | 23 |

---

## 1. Botones ✓ y ✕ del swipe a 44 px

- [x] Valor 4 · Coste XS · **Retorno 8,0**

Miden unos 27 px de alto. Es la acción más repetida de toda la app.

- Evidencia: `src/app.css:487` (padding `.2rem`), `src/app.css:490` (icono 21 px),
  `src/app.css:29` (`zoom: .95` del body).
- Arreglo: `min-height: 44px` o más padding vertical. Los dos botones están en extremos
  opuestos de la fila, así que agrandarlos no los acerca.

## 2. Listener del evento `storage`: dos pestañas se pisan el estado

- [x] Valor 3 · Coste XS · **Retorno 6,0**

`hydrateEstado()` corre una sola vez, en el arranque. No hay ningún listener del evento
`storage`. La pestaña que guarda la última machaca el triaje de la otra, sin error visible.

- Evidencia: `src/app.js:2161-2172` (boot), `src/app.js:377-428` (`hydrateEstado`).
  `grep storage src/app.js` no encuentra ningún listener.
- Arreglo: `addEventListener("storage", hydrateEstado)`. `hydrateEstado` ya está escrita para
  repetirse, y el evento no dispara en la pestaña que escribe.

## 3. Título a dos líneas en las listas

- [x] Valor 3 · Coste XS · **Retorno 6,0**

`src/app.css:363` recorta a una sola línea. El propio código ya corrigió esto para el swipe
(`src/app.css:504`) y nunca lo extendió. En Wallapop el modelo y el estado van al final del
título, así que la línea que se corta es la que decide la compra.

- Arreglo: cambiar `-webkit-line-clamp: 1` por `2` en la regla base. Un carácter.

## 4. Esconder el panel "Búsqueda activa" en el primer arranque

- [x] Valor 3 · Coste XS · **Retorno 6,0**

Sin ninguna búsqueda guardada, esa segunda caja no hace nada y compite con el buscador real.
Se ve en la captura del arranque en blanco.

- Evidencia: `src/index.html:132-148` (el panel no lleva `hidden`).
- Arreglo: una línea en `render()` que lo oculta mientras no haya búsquedas ni CSV cargado.

## 5. La ubicación real del usuario. Hoy todo se mide desde Jaén

- [x] Valor 5 · Coste S · **Retorno 5,0**

`getLoc()` lee `localStorage["wp_loc"]`, pero **nada en la app escribe esa clave**. No hay
selector de ciudad, ni botón de geolocalización, ni parámetro en el enlace. Quien no viva en
Jaén ve kilómetros falsos en cada tarjeta, un orden por cercanía sin sentido, y el ajuste
"excluir los lejos y sin envío" le tira los anuncios equivocados. Además la petición manda
esas coordenadas a Wallapop.

- Evidencia: `src/app.js:1707` (comentario "Fase 6, aún sin UI"), `src/app.js:1712-1718`,
  `src/app.js:712` (el ajuste de "lejos" depende del km), `src/scrape.js:200` (lat/lon van en
  la petición). `grep wp_loc` solo devuelve lecturas.
- Arreglo: un botón que llama a `navigator.geolocation.getCurrentPosition`, guarda `{lat,lon}`
  en `wp_loc` y relanza la búsqueda. La API es nativa y el fallback a Jaén ya existe en
  `getLoc()`. Producción va por HTTPS, así que el permiso funciona.

## 6. Señal de precio. Hoy el cazador de chollos no dice qué es un chollo

- [x] Valor 5 · Coste S · **Retorno 5,0**

El usuario compara precios de cabeza. La app tiene todos los precios del lote en memoria y no
calcula nada.

- Evidencia: `grep -i median src/app.js` → cero. `fillCard` pinta el precio como número suelto.
- Arreglo: la mediana de los precios del propio lote y un chip corto ("barato", "−30 %") en las
  filas muy por debajo. Cálculo síncrono, sin red.
- Aviso: una búsqueda con OR mezcla productos distintos, así que ahí la mediana engaña.
  Calcúlala por rama de la búsqueda, o enseña el chip solo cuando la desviación es grande.

## 7. La tarjeta enseña lo que la app ya sabe

- [x] Valor 4 · Coste S · **Retorno 4,0**

El dato ya está en el CSV, o la API ya lo manda, y la tarjeta no lo pinta. Cero peticiones
nuevas. Por orden de valor:

- **Reservado.** El campo se captura y solo se usa para el texto de la IA (`src/app.js:2490`).
  `fillCard` nunca lo lee. El usuario marca favorito un anuncio ya reservado y lo descubre al
  salir a Wallapop.
- **Perfil top, con garantía, reacondicionado.** Comprobado con una petición real: cada item
  trae `is_top_profile`, `has_warranty` e `is_refurbished`. El scraper los tira
  (`src/scrape.js:10-11`).
- **Número de fotos.** La columna `imagenes` ya trae todas las URL y solo la usa el PDF
  (`src/app.js:2617`). Una foto borrosa o siete fotos claras es una señal barata.
- Arreglo: 3 campos más en `FIELDS`/`row()` y unos chips cortos en `fillCard`, con el mismo
  patrón del chip de envío.

## 8. No construir cientos de `<tr>` que nadie ve

- [x] Valor 4 · Coste S · **Retorno 4,0**

`render()` crea un `<tr>` completo por cada fila aunque la tabla esté oculta en la vista de
mazo. El swipe construye su propia tarjeta aparte, así que ese trabajo se tira. Pasa justo en
el instante en que el usuario espera resultados.

- Evidencia: `src/app.js:796-805` frente a `src/app.js:850`.
- Arreglo: poblar el `tbody` solo cuando `listView` es true. Y añadir `content-visibility: auto`
  a `tbody tr` (`src/app.css:302`) para las listas largas.

## 9. `aria-live` en el overlay de carga y en el snack

- [x] Valor 2 · Coste XS · **Retorno 4,0**

Ninguno de los dos anuncia sus cambios, así que un lector de pantalla no se entera de que la
búsqueda empezó ni de que apareció un "Deshacer".

- Evidencia: `src/index.html:262-272` y `src/index.html:356-359`.
- Arreglo: dos atributos en el HTML. El JS no se toca.

## 10. "Quitar" en rojo también en reposo

- [x] Valor 2 · Coste XS · **Retorno 4,0**

El botón destructivo solo se pone rojo con el ratón encima. En un móvil no hay ratón, así que
la pista nunca aparece.

- Evidencia: `src/app.css:332-334`.
- Arreglo: un rojo apagado en reposo, y el rojo sólido para `:hover` y `:active`.

## 11. Manifest para instalar la app en la pantalla de inicio

- [x] Valor 3 · Coste S · **Retorno 3,0**

`servidor.py:40` ya sirve la extensión `.webmanifest`. El hueco está preparado y vacío. Para
una app que se abre a diario desde el móvil son diez líneas. Además una app instalada conserva
mejor su almacenamiento, así que refuerza el punto 20.

- Evidencia: `grep manifest src/index.html` → cero.
- Arreglo: `src/manifest.webmanifest` (nombre, `display: standalone`, icono reusando
  `wallapop-logo.webp`, colores de `:root`) + `<link rel="manifest">` y `apple-touch-icon`.
  `servidor.py` no se toca.

## 12. El contador de la búsqueda dice por qué rama va

- [x] Valor 3 · Coste S · **Retorno 3,0**

Las ramas OR se piden en serie y el overlay solo enseña el total y el cronómetro. Con doce
ramas, el usuario ve "0 encontrados" y el reloj subiendo, sin saber si va por la primera o por
la última.

- Evidencia: `src/scrape.js:199` (bucle en serie), `src/app.js:1733` (el contador nunca
  menciona ramas).
- Arreglo: pasar el índice de rama al `onProgress` que ya existe y pintar "rama 2/12".

## 13. Un botón que genera el enlace de la búsqueda

- [x] Valor 3 · Coste S · **Retorno 3,0**

La app recibe ocho parámetros de URL y no genera ninguno. Un botón "copiar enlace" en el gestor
sirve para compartir con otra persona y, de paso, para llevarte una búsqueda a otro móvil.

- Evidencia: `src/app.js:2064-2153` (`fromURL` los parsea todos; nadie construye la URL
  inversa).
- Arreglo: armar `location.origin + "?q=…&since=…"` con los datos de `queryParts` y copiarlo
  con el `copyAsync` que ya existe.

## 14. Un tope en las búsquedas muy amplias

- [x] Valor 3 · Coste S · **Retorno 3,0**

Con frescura "cualquiera" no hay corte por fecha ni por número de páginas. Con muchas ramas OR
eso son minutos. El CLI sí tiene `--limit` (`src/wallapop.py:224`); el navegador no tiene nada.

- Evidencia: `src/scrape.js:174-179`.
- Arreglo: un tope duro de filas o de páginas que marque `diag.parcial`, por el mismo canal que
  ya avisa de una rama caída.

## 15. Recordar el orden elegido en Favoritos y Papelera

- [x] Valor 2 · Coste S · **Retorno 2,0**

`listSort` y `listSortDir` viven en variables sueltas y se pierden al recargar.

- Evidencia: `src/app.js:738-739`.
- Arreglo: una clave en `localStorage`, igual que `wp_autoexcllejos`.

## 16. Acercar la ayuda de la gramática al buscador

- [x] Valor 2 · Coste S · **Retorno 2,0**

El icono está en la fila del botón de IA, no en la del campo de búsqueda. Quien busca una
palabra suelta nunca descubre que existen `OR`, los paréntesis y las comillas.

- Evidencia: `src/index.html:88-104` frente a `src/index.html:105-129`.
- Arreglo: mover el `<details class="help">` a la fila del buscador. Alternativa más barata: un
  `placeholder` con un ejemplo, tipo `corsair OR seasonic`.

## 17. `navigator.share` antes del portapapeles

- [x] Valor 2 · Coste S · **Retorno 2,0**

Los botones de IA solo escriben al portapapeles. En el móvil eso obliga a cambiar de app a mano
y buscar dónde pegar.

- Evidencia: `src/app.js:2506-2517` (`copyAsync` solo contempla el portapapeles).
- Arreglo: intentar `navigator.share({text})` primero, y caer al camino actual si no existe.

## 18. Desglosar el contador de "excluidos"

- [x] Valor 2 · Coste S · **Retorno 2,0**

Un solo número junta palabra, categoría y topes, así que no sabes qué filtro te quitó qué.

- Evidencia: `src/app.js:1034-1041` (`paintStat`) frente a `src/app.js:715-726`
  (`isExcluded` sí distingue los cuatro motivos).
- Arreglo: partir el predicado en dos y enseñar dos contadores. En 320 px no caben cuatro.

## 19. `decoding="async"` en la imagen de tarjeta

- [x] Valor 1 · Coste XS · **Retorno 2,0**

`loading="lazy"` ya está puesto y cubre casi todo el ahorro. Falta el atributo hermano.

- Evidencia: `src/app.js:583`.

## 20. Copia de seguridad del estado. Hoy no hay ninguna

- [x] Valor 5 · Coste M · **Retorno 1,7**

**Es lo único de la lista que, si no se hace, no se puede recuperar después.** No hay cuentas
ni backend. Meses de triaje viven solo en el `localStorage` de un navegador. Si el usuario
cambia de móvil, borra los datos, o Safari en iOS limpia el almacenamiento tras días sin
visitas, lo pierde todo sin aviso. "Copiar para IA" y "PDF para IA" no son copias restaurables:
solo exportan favoritos como texto.

- Evidencia: `grep` de export/import/backup en `src/app.js` y `src/index.html` devuelve cero.
- Arreglo: dos botones en el menú ⚙. Uno junta `wp_estado`, `wp_searches`, `wp_lastseen`,
  `wp_lastcsv`, `wp_lejoskm`, `wp_autoexcllejos` y `wp_loc` en un JSON y lo baja con `Blob` +
  `<a download>`. El otro lo lee con `<input type="file">` y recarga. No hace falta tocar
  IndexedDB: cada búsqueda se re-scrapea al abrirla.

## 21. Un aviso de novedades fuera del gestor

- [x] Valor 3 · Coste M · **Retorno 1,0**

`unseenCount()` solo se calcula al abrir el gestor de búsquedas. Fuera de ahí no hay ninguna
señal, así que las búsquedas que el usuario no abre acumulan anuncios en silencio.

- Evidencia: `src/app.js:1894-1935` (`paintSearches`), invocado solo desde `openManager()`.
- Arreglo: sumar `unseenCount()` de todas las búsquedas al terminar el arranque y pintar un
  número sobre el icono ⚙. La clase del badge ya existe (`src/app.css:466-469`).
- Los avisos push de verdad no caben sin backend. Esto es lo más cerca que se puede llegar.

## 22. Cabecera más compacta cuando hay resultados

- [x] Valor 3 · Coste M · **Retorno 1,0**

Medido sobre la captura real: la cabecera ocupa unos 304 px de los 632, y sube a unos 386 px
cuando aparecen los contadores. La barra compacta ya existe para Favoritos y Papelera
(`#listHead`).

- Evidencia: `src/app.css:33-58` y `:179-197`, `src/app.js:1026-1062` (`paintStat`),
  `src/app.js:852` (la cabecera solo se fija en modo lista).
- Es un cambio de diseño: pide captura y visto bueno antes de cerrar.

## 23. Modo oscuro

- [x] Valor 3 · Coste M · **Retorno 1,0**

Todos los colores ya son variables en `:root` (`src/app.css:1-22`). Falta un bloque
`@media (prefers-color-scheme: dark)` que las redefina. Ninguna otra regla cambia.

- Evidencia: `grep prefers-color-scheme src/app.css` → cero.

## 24. Marcar posibles duplicados

- [x] Valor 3 · Coste M · **Retorno 1,0**

Si el mismo vendedor republica el mismo producto con otro id, la app no lo señala. Solo
deduplica por id exacto dentro de un mismo scrape.

- Evidencia: `src/scrape.js:224-233`.
- Arreglo: agrupar por vendedor y título normalizado sobre los datos ya cargados. `norm()` ya
  existe. Es una heurística: puede marcar de más.

---

## Una decisión de producto, no un fallo

Tras cada búsqueda, el botón grande y relleno es "COPIAR PARA IA"; el de triar a mano es el
secundario. El comentario de `src/app.css:448` dice que es deliberado: *"swipear a mano es el
plan B"*. Si el objetivo es servir también a quien no usa ninguna IA, invierte los dos
estilos. Si no, déjalo.

## Lo que ya está bien y no hay que tocar

- La cuota de `localStorage` ya no es un riesgo: los CSV se movieron a IndexedDB y una
  escritura fallida avisa (`src/app.js:56-65`). Un JSON corrupto se copia a `roto:<clave>`.
- El manejo de fallos parciales del scrape es sólido y nunca cachea un resultado incompleto
  (`src/scrape.js:183-243`, `src/app.js:1787-1795`).
- El enlace `?q=` sí dispara la búsqueda solo (`src/app.js:2147-2151`).
- El deshacer del swipe es multinivel, no solo el último (`src/app.js:2323-2377`).
- Las búsquedas se guardan solas al terminar un scrape, y se pueden renombrar y borrar.
- Los diálogos ya usan `role="dialog"`, `aria-modal` e `inert` al abrir.
- El viewport ya lleva `interactive-widget=resizes-content` y no bloquea el zoom.
- La miniatura ya pide el tamaño `small` (W320) y ya lleva `loading="lazy"`.

**No** vuelvas a pedir la ficha de cada anuncio para sacar la reputación del vendedor o el
estado del artículo: la API de búsqueda no los trae, y ese patrón es justo el que se quitó en
`d506eb2`.
