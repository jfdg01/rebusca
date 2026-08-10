# Iteración 41 — los filtros que esconden anuncios

Zona: `src/app.js:845-858` (`exclPorTope`, `exclPorTexto`, `isExcluded`) y las tres listas por
cajón de las que leen: `exclTerms` (`src/app.js:338`), `catExclTerms` (`src/app.js:348`) y
`catMode` (`src/app.js:351`).

Elegida por daño al usuario: es el único código de la app que **esconde** un anuncio. Un anuncio
mal excluido no aparece en el mazo, no aparece en ninguna lista, y el usuario no se entera de que
existió. Es el daño peor de todos, porque no deja rastro.

## F1 — Investigar

17 mutantes, veredicto por el código de salida de `./check.sh`.
**15 mueren, 2 VIVEN.** La zona ya estaba bien medida: los topes, el ajuste de lejos, el modo
incluir, la palabra vetada y las tres listas por cajón tienen cada uno su check.

| mutante que VIVE | qué ve el usuario |
| --- | --- |
| categoría: sin la guarda de lista vacía | en modo "incluir", si desmarca la última categoría el mazo se vacía entero |
| categoría: casa por trozo, no exacta | vetar "Coches" se lleva también "Coches clásicos" |

El primero es el que más asusta. En modo "incluir" la regla es "solo se conservan las marcadas".
Con la lista vacía no hay ninguna marcada, así que sin la guarda `cats.length` **todo** el lote
queda fuera. El usuario ve un mazo vacío y ningún motivo.

## F2 — El contrato

1. Con la lista de categorías vacía no se excluye nada, sea cual sea el modo. Una lista vacía es
   "no filtro", nunca "filtra todo".
2. La categoría casa exacta, no por trozo: el comentario de `catExclMap` lo dice y nadie lo medía.

## F3 — Implementar

Sin cambio de comportamiento: los dos puntos ya se cumplen. Un cambio: `src/test_buttons.js`,
bloque `7d`, los dos puntos del contrato.

## F4 — Probar

`./check.sh` verde. La suite pasa de 504 a 509 comprobaciones.
Barrido final, 17 mutantes: **17 mueren.**

## F5 — Review adversaria

**¿La guarda de lista vacía se puede alcanzar de verdad?** Sí. `catExclMap[cajón]` empieza sin
existir y `catExclTerms()` devuelve `[]`; y si el usuario marca categorías en modo "incluir" y
luego las desmarca todas, vuelve a `[]` con el modo puesto. Un mutante que vive por un estado
inalcanzable no dice nada, así que el check llega a ese estado por las dos vías: la lista sin
tocar y la lista vaciada.

**¿El check de la categoría exacta mide el `includes` o mide otra cosa?** Mide el `includes`. Usa
dos categorías donde una contiene a la otra como texto, que es el único sitio donde la comparación
exacta y la parcial se separan. Es la regla de la iteración 40 aplicada a texto en vez de a
números.

**Regla que deja esta iteración:** *una lista de filtros vacía significa "no filtro". El código que
la lee tiene que decirlo, y el check tiene que visitar la lista vacía además de la llena.*
