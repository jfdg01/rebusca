# Iteración 43 — el estado que vuelve a medias

**Zona:** los seis mutantes que la iteración 42 dejó vivos por reloj, en `hydrateEstado`
(`src/app.js:379-450`), `foldDrawers` (`:192`), `espejo` (`:100`) y `pointBuckets` (`:245`).

**Por qué esta zona.** La 42 los dejó por escrito con nombre y daño, no por criterio. Una
iteración que hereda su F1 es la más barata que se puede cerrar bien: el barrido ya existe.

## F1 — heredada de la iteración 42

```
mir: una clave espejo vacia no cuenta          VIVE
blob: un blob que no es objeto pasa igual      VIVE
cajon activo: no se reapunta                   VIVE
espejo: los bloqueados se escriben con setLS   VIVE
fold: los topes se funden al reves             VIVE
render: el estado cargado no se pinta          VIVE
```

Sin defecto de producción, igual que en la 42. Seis agujeros de medida.

## F2 — el contrato

1. **Cargar el estado reapunta los cubos al cajón activo.** `rejected`/`favorite` son vars que
   apuntan a un cajón. Sin reapuntarlas, el usuario mira los cubos del cajón anterior.
2. **Una clave espejo dañada no se tapa con el blob.** Taparla se come el aviso «Datos
   dañados»: el usuario cree que su estado está entero cuando ya perdió una parte.
3. **Al fundir los topes por cajón gana el csv del cajón, no el acotado.** Si gana
   `ford--semana.csv`, el tope de precio que el usuario puso en `ford` desaparece.
4. **Un blob que no es un objeto no tumba el arranque.**

## F3 — implementación

Nada. Los seis viven por falta de check.

## F4 — los checks

Bloque `7f` en `src/test_buttons.js`. Suite 517 → 521.

El punto 1 no puede sembrar el nombre del cajón a mano: lo lee del sandbox con `curDrawer()`
al escribir la clave espejo. Una lista escrita a mano dentro de una prueba envejece en
silencio, y el nombre del cajón depende del csv que cargue `loaded()`.

El punto 2 siembra `wp_stamp: ""`. La cadena vacía no es JSON: la clave se aparta y el sello
queda vacío. El check fija justo eso, que el blob **no** rellene el hueco.

## F5 — review adversaria

Barrido de los seis: **3 mueren, 3 quedan.**

**Uno es equivalente, y se midió:** `blob: un blob que no es objeto pasa igual`. Con
`wp_estado` valiendo `"texto"`, quitar la guardia `obj(e)` no cambia nada: leer cualquier
propiedad de una cadena da `undefined`, igual que leerla de `{}`. El arranque no saca ningún
error con mutante ni sin él. La guardia se queda: documenta la intención y cuesta cero.

**Dos quedan abiertos, con su motivo:**

| mutante | por qué no se midió |
| --- | --- |
| `espejo: los bloqueados se escriben con setLS` | la diferencia solo aparece cuando `setLS` falla y la clave entra en `sinRespaldo`. Montar ese fallo pide un `localStorage` que reviente a demanda, y el arnés no lo tiene |
| `render: el estado cargado no se pinta` | no hay en el arnés una medida barata del repintado. Hace falta primero un modo de ver que `render()` corrió |

El segundo es trabajo de arnés, no de check. Es lo que pide la próxima iteración de esta zona.

## Lo que deja esta iteración

- Un barrido con demasiados supervivientes se puede cortar en dos iteraciones. La primera
  escribe los nombres; la segunda hereda la F1 y no la repite.
- Un check que necesita el nombre de un cajón lo pregunta al código, no lo escribe a mano.
- Un mutante que solo se distingue cuando falla el almacenamiento pide un arnés que sepa
  fallar. Sin él, no es un check que falte: es una pieza de arnés que falta.
