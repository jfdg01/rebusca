# Iteración 28 — la tarjeta compuesta

**Zona:** `fillCard()` en `src/app.js:658-770`, y el arnés `carta()` de `src/test_app.js`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** robustez, con una simplificación de paso.

## F1 — Investigar

`fillCard()` monta la tarjeta que el usuario ve en Destacados, en la Papelera y en el mazo del
swipe. Es la única pieza que pinta un anuncio entero, y monta nueve partes: la foto, la etiqueta
de precio, el chip de chollo, la marca de reservado, el chip de frescura, la línea de cuándo se
clasificó, el título, la línea de envío y distancia, y la línea de extras.

De esas nueve, la suite mide cuatro: el chip de chollo (`test_app.js` 12f), reservado, el recuento
de fotos y las tres banderas (12g), y el aviso de anuncios repetidos (`test_buttons.js`). Las otras
cinco no las mira nadie.

**El barrido lo confirma.** 19 mutantes sobre la zona, 11 vivos:

| mutante | resultado |
|---|---|
| el chip de chollo no se pinta | muere |
| reservado no se pinta | muere |
| el recuento de fotos cambia singular y plural | muere |
| la bandera de garantía se lee al revés | muere |
| «perfil top» no se pinta | muere |
| el aviso de repetidos salta desde 1 anuncio | muere |
| el aviso de repetidos no sale nunca | muere |
| la foto pierde la carga diferida | muere |
| **el precio ignora el envío** | **VIVE** |
| **el precio vacío no pone la raya** | **VIVE** |
| **el chip de frescura no se pinta** | **VIVE** |
| **la foto rota no se quita** | **VIVE** |
| **el chip de envío dice lo contrario** | **VIVE** |
| **la clase naranja del envío va al revés** | **VIVE** |
| **sin km no se dice la ciudad** | **VIVE** |
| **«Favorito» y «Rechazado» cambiados** | **VIVE** |
| **la línea de cuándo se clasificó no sale** | **VIVE** |
| **el chip del id sale también en el mazo** | **VIVE** |
| **el chip del id copia el título** | **VIVE** |

El más caro es el primero: con envío, la etiqueta enseña el precio final estimado
(`finalPrice()`), no el que anuncia el vendedor. Es la razón de ser de la app — comparar precios
que se pueden comparar. Un cambio que la devuelva al precio de catálogo deja las siete suites en
verde y el usuario compara peras con manzanas sin enterarse.

El segundo es del mismo tamaño en pantalla: `dec1("")` devuelve `"0"`, porque `+"" === 0`. Sin la
guarda `precio !== ""`, un anuncio sin precio se anuncia a **0 €**.

**Y una copia de más.** El arnés `carta()`, que recorre la tarjeta y devuelve `"clase:texto"` de
cada hijo, está escrito dos veces palabra por palabra, en 12f y en 12g de `test_app.js`.

## F2 — Contrato

1. **Un solo `carta()`.** Sube al ámbito del fichero; los dos bloques que lo copiaban lo usan.
2. **Una comprobación nueva, 12g-bis**, que recorre la tarjeta parte por parte y cierra los once
   mutantes vivos. Una sola, no once: la tarjeta se monta de una vez y se mira de una vez.
3. **Ninguna línea de producción cambia.** Los once mutantes describen lo que la app ya hace bien;
   lo que falta es la red, no el arreglo.
4. Las siete suites pasan.

## F3 — Implementar

**Ninguna línea de producción cambia.** Los once mutantes describen lo que la app ya hace bien.

`carta(b, i)` sube al ámbito del fichero en `src/test_app.js`, junto a `htmlChildren()`. Los dos
bloques que lo declaraban dentro borran su copia.

**El arnés no podía ver dos de las once cosas, y por eso dos mutantes eran inmortales.** Los dos
arreglos son de `src/test_app.js`, no de la app:

1. `document.createTextNode()` devolvía `makeAny()`, el proxy universal, que **se traga el
   argumento**. La distancia y la ciudad de la tarjeta viajan en un nodo de texto suelto, así que
   para la suite eran invisibles. Ahora devuelve un objeto llano con `textContent`. Los dos únicos
   usos de `app.js` lo `append`an y no lo vuelven a tocar.
2. `remove()` era `remove() {}`, un no-op. La foto que no carga se quitaba en el navegador y en la
   suite seguía colgando. Ahora hay un `WeakMap` de padre por hijo que `append()` y `appendChild()`
   rellenan, y `remove()` se descuelga de verdad. `append("texto")` es legal en el DOM y una cadena
   no vale como clave de un `WeakMap`, así que el enlace solo se anota para objetos.

**La comprobación 12g-bis** monta un lote de dos anuncios a medida y recorre la tarjeta:

- `c1` con envío, precio 100, sin km, con ciudad y con `dias`: mide el precio final, el chip de
  frescura, el texto del chip de envío y la ciudad sola.
- `c2` sin precio, sin envío, con km y ciudad: mide la raya, la clase naranja y la línea entera.
- La foto rota: se dispara el `onerror` del `<img>` y se cuenta que la foto se fue.
- El chip del id: en el mazo no sale; en la lista sale y un toque copia el id.
- La línea de cuándo se clasificó: dice «Favorito» en Destacados y «Rechazado» en la Papelera, y
  sin marca de tiempo no sale.

`src/test_app.js`: 92 líneas nuevas, 17 borradas.

## F4 — Probar

Los siete checks en verde. Los **once** mutantes vivos vuelven a pasar por el barrido y **los once
mueren**. Y los dos arreglos del arnés se miden igual, mutándolos a como estaban:

```
arnes: remove() vuelve a ser un no-op          muere
arnes: el nodo de texto tira su texto          muere
```

## F5 — Review adversaria

**1. El arnés era el que mentía, no la app.** Dos de los once mutantes no vivían porque faltara una
aserción: vivían porque el arnés no podía ver la diferencia. Un nodo de texto sin texto y un
`remove()` que no quita nada dejan una zona entera fuera de alcance, y desde fuera se lee igual que
«esto ya está probado». La regla que sale de aquí: **cuando un mutante evidente sobrevive, sospecha
del arnés antes que de la aserción.** Los dos arreglos se midieron mutándolos de vuelta.

**2. La cuenta `3->2` no es tautológica.** Podría parecer que cualquier tarjeta la cumple. No:
si `fillCard()` dejara de meter la foto, `media.children[0]` sería la etiqueta de precio, que no
tiene `onerror`, y la comprobación reventaría en vez de pasar.

**3. No hay captura de pantalla, y no hace falta.** Ninguna línea de producción cambia: `app.js`,
`app.css` e `index.html` están intactos. Lo que cambia es lo que la suite mide.

**4. Lo que sigue sin medirse en esta zona.** El `title` del chip de chollo, el `decoding = "async"`
de la foto y el `loading = "lazy"` (este sí muere, pero por otro check). Son atributos de
rendimiento sin efecto observable en el contenido; se quedan anotados, no se fuerzan.
