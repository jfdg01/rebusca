# Iteración 38 — el texto del vendedor dentro del HTML

Zona: `src/app.js:3024-3044` (`esc` y `dossierHTML`), más los dos sitios que pintan el término de
búsqueda: la tarjeta del gestor (`src/app.js:2145-2146`) y la fila del desplegable
(`src/app.js:1657-1659`).

Elegida por daño al usuario: el título, la descripción, el enlace y las fotos de un anuncio los
escribe el vendedor. `dossierHTML` es el **único** sitio de la app que mete ese texto en
`innerHTML` con plantillas; el resto de la app usa `textContent`. Si `esc` falla, un vendedor
cualquiera abre etiquetas dentro de la página del usuario.

## F1 — Investigar

12 mutantes, veredicto por el código de salida de `./check.sh`.
**2 mueren, 10 VIVEN.**

| mutante | veredicto en F1 |
| --- | --- |
| `esc`: no escapa nada | VIVE |
| `esc`: se deja el `<` | VIVE |
| `esc`: se deja la comilla | VIVE |
| `esc`: se deja el `&` | VIVE |
| dossier: el título sin escapar | VIVE |
| dossier: la descripción sin escapar | VIVE |
| dossier: la foto sin escapar | VIVE |
| dossier: el enlace sin escapar | VIVE |
| gestor: el término por `innerHTML` | muere |
| gestor: el apodo por `innerHTML` | muere |
| desplegable: el término por `innerHTML` | VIVE |
| desplegable: el `title` sin poner | VIVE |

**`esc` se podía borrar entera y los siete checks salían verdes.** Los dos mutantes que morían lo
hacían de rebote: el arnés vacía los hijos al asignar `innerHTML`, así que el texto de la tarjeta
se perdía y fallaba otro check, no uno de escapado.

### Sin defecto de producción

`esc` escapa `& < > "`. No escapa la comilla simple, y no hace falta: todos los atributos de
`dossierHTML` van con comilla doble.

El otro camino que se mira siempre en esta zona es el esquema del enlace: `href="${esc(url)}"` no
para un `javascript:`. **No es alcanzable.** La columna `url` la construye el scraper con un prefijo
fijo (`src/scrape.js:161`, `"https://es.wallapop.com/item/" + it.web_slug`) y las fotos salen del
CDN de Wallapop. La app ya no tiene arrastre de CSV: el comentario de `src/app.js:477` que habla de
«drag de CSV sin id» se quedó viejo. Sin una vía de entrada, una guarda de esquema es código que
defiende de nada.

## F2 — Documentar (el contrato)

1. **Producción: sin cambios.** El escapado es correcto y completo para cómo se usa.
2. **Checks nuevos** (bloque 7b de `test_buttons.js`), uno por campo y uno por carácter:
   - el título, la descripción, el enlace y la foto de un anuncio con `x"><b>` dentro salen
     escapados del dossier, y no abren ninguna etiqueta;
   - un `&amp;` de entrada se ve como `&amp;` en el dossier, no como un `&` suelto;
   - la comilla de la foto no cierra el atributo `src`;
   - el término del desplegable se pinta como texto, y la fila conserva su `title`.

El veneno va sin espacios a propósito: la columna `imagenes` se parte por espacios, y un veneno
partido no mide nada.

## F3 — Implementar

Solo `src/test_buttons.js`: el bloque 7b. La suite pasa de 467 a 479 comprobaciones.

## F4 — Probar

**Los 12 mutantes mueren, cada uno por su propio motivo.**

| mutante | motivo con el que muere |
| --- | --- |
| `esc`: no escapa nada | `el campo «titulo» del anuncio abre etiquetas en el dossier` |
| `esc`: se deja el `<` | `el campo «titulo» no aparece escapado en el dossier` |
| `esc`: se deja la comilla | `la comilla de la foto cierra el atributo src del dossier` |
| `esc`: se deja el `&` | `el & del título no se escapa: el usuario ve una entidad en vez del texto` |
| dossier: el título sin escapar | `el campo «titulo» del anuncio abre etiquetas en el dossier` |
| dossier: la descripción sin escapar | `el campo «descripcion» del anuncio abre etiquetas en el dossier` |
| dossier: la foto sin escapar | `el campo «imagen» del anuncio abre etiquetas en el dossier` |
| dossier: el enlace sin escapar | `el campo «url» del anuncio abre etiquetas en el dossier` |
| gestor: el término por `innerHTML` | `el apodo no manda como título de la tarjeta` |
| gestor: el apodo por `innerHTML` | `la tarjeta con apodo no enseña el término real` |
| desplegable: el término por `innerHTML` | `el término del desplegable no se pinta como texto` |
| desplegable: el `title` sin poner | `la fila del desplegable se quedó sin title` |

Los siete checks en verde, 479 comprobaciones.

## F5 — Review adversaria

**El escapado no se prueba con un caso, se prueba con un carácter por regla.** Un solo check con
`<script>` habría matado «no escapa nada» y «se deja el `<`», y habría dejado vivos los otros dos.
La comilla solo se nota dentro de un atributo, y el `&` solo se nota cuando el texto de entrada ya
trae una entidad. Son tres sitios distintos del mismo `replace`.

**Y el check del `&` no mide lo que yo creía.** Lo escribí pensando en el doble escapado clásico:
escapar `&` después de `<` convierte `&lt;` en `&amp;lt;`. Aquí eso no puede pasar, porque `esc` no
encadena `replace`: hace uno solo con la clase `[&<>"]`, y un `replace` recorre la cadena de
entrada, no su propia salida. El orden dentro de la clase da igual. Lo que el check mide de verdad
es más simple, y hace falta igual: que el `&` se escape.

**Lo que no se mide, y por qué:** el esquema del enlace del dossier. Se decidió por el camino de
entrada, no por el riesgo en abstracto — sin arrastre de CSV y con la `url` construida por el
scraper, no hay forma de que llegue un `javascript:` ahí. Queda escrito para que la próxima persona
que añada una entrada de datos sepa qué mirar.
