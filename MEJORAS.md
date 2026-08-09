# Mejoras pendientes — auditoría de UX (2026-08-09)

Lista ordenada, de más a menos importante, de lo que haría Rebusca más útil y más fluida.
Cada punto lleva la evidencia en `fichero:línea`, el arreglo mínimo que funciona y el coste
(**S** = menos de media hora, **M** = unas horas, **L** = un día o más).

Cómo se sacó: lectura del código completo (`app.js`, `scrape.js`, `index.html`, `app.css`,
`servidor.py`), capturas reales de la app corriendo en el server de pruebas (320×632, DPR 2)
y peticiones reales a `api.wallapop.com` para comprobar qué campos manda de verdad. Nada de
harness aparte. Ningún punto se apuntó sin verificarlo.

---

## Nivel 1 — lo que hoy está roto o falta de verdad

### 1. La ubicación real del usuario. Hoy todo se mide desde Jaén

- [ ] **Coste: S. Es el arreglo con más impacto de toda la lista.**

`getLoc()` lee `localStorage["wp_loc"]`, pero **nada en la app escribe esa clave**. No hay
selector de ciudad, ni botón de geolocalización, ni parámetro en el enlace. Quien no viva en
Jaén ve kilómetros falsos en cada tarjeta, un orden por cercanía sin sentido, y el ajuste
"excluir los lejos y sin envío" le tira los anuncios equivocados. Además la petición manda
esas coordenadas a Wallapop.

- Evidencia: `src/app.js:1707` (comentario "Fase 6, aún sin UI"), `src/app.js:1712-1718`,
  `src/app.js:712` (el ajuste de "lejos" depende del km), `src/scrape.js:200` (lat/lon van
  en la petición). `grep wp_loc` solo devuelve lecturas.
- Arreglo mínimo: un botón que llama a `navigator.geolocation.getCurrentPosition`, guarda
  `{lat,lon}` en `wp_loc` y relanza la búsqueda. La API es nativa y el fallback a Jaén ya
  existe en `getLoc()`. Producción va por HTTPS, así que el permiso funciona.

### 2. Una copia de seguridad del estado. Hoy no hay ninguna

- [ ] Coste: M. Es lo único de la lista que, si no se hace, no se puede recuperar después.

No hay cuentas ni backend. Meses de triaje viven solo en el `localStorage` de un navegador.
Si el usuario cambia de móvil, borra los datos, o Safari en iOS limpia el almacenamiento tras
días sin visitas, lo pierde todo sin aviso. "Copiar para IA" y "PDF para IA" no son copias
restaurables: solo exportan favoritos como texto.

- Evidencia: `grep` de export/import/backup en `src/app.js` y `src/index.html` devuelve cero.
- Arreglo mínimo: dos botones en el menú ⚙. Uno junta `wp_estado`, `wp_searches`,
  `wp_lastseen`, `wp_lastcsv`, `wp_lejoskm`, `wp_autoexcllejos` y `wp_loc` en un JSON y lo
  baja con `Blob` + `<a download>`. El otro lo lee con `<input type="file">` y recarga.
  No hace falta tocar IndexedDB: cada búsqueda se re-scrapea al abrirla.

### 3. La tarjeta debe enseñar lo que la app ya sabe

- [ ] Coste: S. Cero peticiones nuevas.

El dato ya está en el CSV, o la API ya lo manda, y la tarjeta no lo pinta. Cuatro cosas:

- **Reservado.** El campo se captura y solo se usa para el texto de la IA
  (`src/app.js:2490`). `fillCard` nunca lo lee. El usuario marca favorito un anuncio ya
  reservado y lo descubre al salir a Wallapop.
- **Perfil top, con garantía, reacondicionado.** Comprobado con una petición real: cada item
  trae `is_top_profile`, `has_warranty` e `is_refurbished`. El scraper los tira
  (`src/scrape.js:10-11`).
- **Número de fotos.** La columna `imagenes` ya trae todas las URL y solo la usa el PDF
  (`src/app.js:2617`). Una foto borrosa o siete fotos claras es una señal barata.
- Arreglo mínimo: 3 campos más en `FIELDS`/`row()` y unos chips cortos en `fillCard`, con el
  mismo patrón del chip de envío.

### 4. Una señal de precio. Hoy el cazador de chollos no dice qué es un chollo

- [ ] Coste: S.

El usuario compara precios de cabeza. La app tiene todos los precios del lote en memoria y no
calcula nada.

- Evidencia: `grep -i median src/app.js` → cero. `fillCard` pinta el precio como número suelto.
- Arreglo mínimo: la mediana de los precios del propio lote y un chip corto ("barato",
  "−30 %") en las filas muy por debajo. Cálculo síncrono, sin red.
- Aviso: una búsqueda con OR mezcla productos distintos, así que ahí la mediana engaña.
  Calcúlala por rama de la búsqueda, o enseña el chip solo cuando la desviación es grande.

---

## Nivel 2 — fricción que se nota en cada sesión

### 5. La app construye cientos de tarjetas que nadie ve

- [ ] Coste: S.

`render()` crea un `<tr>` completo por cada fila aunque la tabla esté oculta en la vista de
mazo. El swipe construye su propia tarjeta aparte, así que ese trabajo se tira. Pasa justo en
el instante en que el usuario espera resultados.

- Evidencia: `src/app.js:796-805` frente a `src/app.js:850`.
- Arreglo mínimo: poblar el `tbody` solo cuando `listView` es true. Y añadir
  `content-visibility: auto` a `tbody tr` (`src/app.css:302`) para las listas largas.

### 6. Los botones ✓ y ✕ del swipe son demasiado pequeños

- [ ] Coste: S.

Miden unos 27 px de alto. Es la acción más repetida de toda la app.

- Evidencia: `src/app.css:487` (padding `.2rem`), `src/app.css:490` (icono 21 px),
  `src/app.css:29` (`zoom: .95` del body).
- Arreglo mínimo: `min-height: 44px` o más padding vertical. Los dos botones están en extremos
  opuestos de la fila, así que agrandarlos no los acerca.

### 7. Nada avisa de que una búsqueda guardada tiene novedades

- [ ] Coste: M.

`unseenCount()` solo se calcula al abrir el gestor de búsquedas. Fuera de ahí no hay ninguna
señal, así que las búsquedas que el usuario no abre acumulan anuncios en silencio.

- Evidencia: `src/app.js:1894-1935` (`paintSearches`), invocado solo desde `openManager()`.
- Arreglo mínimo: sumar `unseenCount()` de todas las búsquedas al terminar el arranque y
  pintar un número sobre el icono ⚙. La clase del badge ya existe (`src/app.css:466-469`).
- Los avisos push de verdad no caben sin backend. Esto es lo más cerca que se puede llegar.

### 8. Falta el manifest para instalar la app en la pantalla de inicio

- [ ] Coste: S.

`servidor.py:40` ya sirve la extensión `.webmanifest`. El hueco está preparado y vacío. Para
una app que se abre a diario desde el móvil son diez líneas. Además una app instalada conserva
mejor su almacenamiento, así que refuerza el punto 2.

- Evidencia: `grep manifest src/index.html` → cero.
- Arreglo mínimo: `src/manifest.webmanifest` (nombre, `display: standalone`, icono reusando
  `wallapop-logo.webp`, colores de `:root`) + `<link rel="manifest">` y `apple-touch-icon`.
  `servidor.py` no se toca.

### 9. Dos pestañas abiertas se pisan el estado

- [ ] Coste: S.

`hydrateEstado()` corre una sola vez, en el arranque. No hay ningún listener del evento
`storage`. La pestaña que guarda la última machaca el triaje de la otra, sin error visible.

- Evidencia: `src/app.js:2161-2172` (boot), `src/app.js:377-428` (`hydrateEstado`).
  `grep storage src/app.js` no encuentra ningún listener.
- Arreglo mínimo: `addEventListener("storage", hydrateEstado)`. Una línea. `hydrateEstado` ya
  está escrita para repetirse, y el evento no dispara en la pestaña que escribe.

### 10. El contador de la búsqueda no dice por qué rama va

- [ ] Coste: S.

Las ramas OR se piden en serie y el overlay solo enseña el total y el cronómetro. Con doce
ramas, el usuario ve "0 encontrados" y el reloj subiendo, sin saber si va por la primera o por
la última.

- Evidencia: `src/scrape.js:199` (bucle en serie), `src/app.js:1733` (el contador nunca
  menciona ramas).
- Arreglo mínimo: pasar el índice de rama al `onProgress` que ya existe y pintar "rama 2/12".

---

## Nivel 3 — pulido barato, casi todo de una línea

- [ ] **11. Título a dos líneas en las listas.** `src/app.css:363` recorta a una sola línea.
  El propio código ya corrigió esto para el swipe (`src/app.css:504`) y nunca lo extendió.
  En Wallapop el modelo y el estado van al final del título. Cambia un carácter. Coste: S.
- [ ] **12. Esconder el panel "Búsqueda activa" en el primer arranque.** Sin ninguna búsqueda
  guardada, esa segunda caja no hace nada y compite con el buscador real
  (`src/index.html:132-148`). Una línea en `render()`. Coste: S.
- [ ] **13. `aria-live` en el overlay de carga y en el snack.** Ninguno de los dos anuncia sus
  cambios (`src/index.html:262-272` y `:356-359`). Dos atributos en el HTML, sin tocar el JS.
  Coste: S.
- [ ] **14. El botón "Quitar" solo se pone rojo con el ratón encima.** En un móvil no hay
  ratón, así que la pista nunca aparece (`src/app.css:332-334`). Dale un rojo apagado en
  reposo. Coste: S.
- [ ] **15. Recordar el orden elegido en Favoritos y Papelera.** `listSort` y `listSortDir`
  viven en variables sueltas (`src/app.js:738-739`) y se pierden al recargar. Coste: S.
- [ ] **16. `decoding="async"` junto al `loading="lazy"`** de la imagen de tarjeta
  (`src/app.js:583`). Una palabra. Coste: S.
- [ ] **17. Acercar la ayuda de la gramática al buscador.** El icono está en la fila del botón
  de IA, no en la del campo de búsqueda (`src/index.html:105-129`). Quien busca una palabra
  suelta nunca descubre que existen `OR`, los paréntesis y las comillas. Coste: S.

---

## Nivel 4 — mayores, o decisiones tuyas

- [ ] **18. Un botón que genere el enlace de la búsqueda.** La app recibe ocho parámetros de
  URL y no genera ninguno (`src/app.js:2064-2153`). Un botón "copiar enlace" en el gestor
  sirve para compartir con otra persona y, de paso, para llevarte una búsqueda a otro móvil.
  Coste: S.
- [ ] **19. Modo oscuro.** Todos los colores ya son variables en `:root` (`src/app.css:1-22`).
  Falta un bloque `@media (prefers-color-scheme: dark)` que las redefina. Ninguna otra regla
  cambia. Coste: M.
- [ ] **20. La cabecera se come casi la mitad de la pantalla.** Medido sobre la captura real:
  unos 304 px de los 632, y sube a unos 386 px cuando aparecen los contadores. La barra
  compacta ya existe para Favoritos y Papelera (`#listHead`). Reusarla en la vista de mazo es
  un cambio de diseño: pide captura y visto bueno antes de cerrar. Coste: M.
- [ ] **21. Un tope en las búsquedas muy amplias.** Con frescura "cualquiera" no hay corte por
  fecha ni por número de páginas (`src/scrape.js:174-179`). Con muchas ramas OR eso son
  minutos. El CLI sí tiene `--limit` (`src/wallapop.py:224`); el navegador no tiene nada.
  Coste: S.
- [ ] **22. `navigator.share` antes del portapapeles** en los botones de IA
  (`src/app.js:2506-2517`). Abre la hoja de compartir del móvil y ahorra el cambio de app a
  mano. Coste: S.
- [ ] **23. Marcar posibles duplicados** agrupando por vendedor y título normalizado sobre los
  datos ya cargados. Útil, pero es una heurística: puede marcar de más. Coste: M.
- [ ] **24. Desglosar el contador de "excluidos"** (`src/app.js:1034-1041`). Hoy un solo número
  junta palabra, categoría y topes, así que no sabes qué filtro te quitó qué. Coste: S.

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
