# Iteración 42 — el blob de estado

**Zona:** `pushEstado` / `hydrateEstado` (`src/app.js:379-450`), y las claves espejo
`wp_rejected`, `wp_favorite`, `wp_blocksel`, `wp_excl`, `wp_catexcl`, `wp_lim`, `wp_alias`,
`wp_stamp`.

**Por qué esta zona.** Es la única parte de la app cuyo fallo pierde trabajo del usuario. Un
anuncio mal pintado se arregla al recargar. Una clasificación perdida no vuelve: el usuario
rechazó 300 anuncios, cierra el móvil, y al volver los tiene otra vez delante.

## F1 — barrido de mutantes, antes de tocar nada

19 mutantes. **6 mueren, 13 viven.**

```
mir: manda el blob, no la clave espejo         muere
mir: la clave espejo manda aunque no exista    muere
mir: el blob manda siempre                     muere
mir: una clave espejo vacia no cuenta          VIVE
blob: un blob que no es objeto pasa igual      VIVE
cubos: la papelera ya no gana a favoritos      VIVE
cubos: gana favoritos, no la papelera          VIVE
cubos: solo mira los cajones de la papelera    VIVE
migracion: los interesantes viejos se pierden  muere
cajon activo: no se reapunta                   VIVE
bloqueados: no se vacia antes de rellenar      VIVE
bloqueados: la lista no se lee                 VIVE
espejo: los bloqueados se escriben con setLS   VIVE
fold: las palabras vetadas no se funden por cajon muere
fold: los topes se funden al reves             VIVE
stamp: el sello de hora no se carga            VIVE
push: el blob se queda sin los sellos          VIVE
push: el blob se queda sin la papelera         muere
render: el estado cargado no se pinta          VIVE
```

**No hay defecto de producción.** Los 13 supervivientes son agujeros de medida, y todos
cuentan el mismo daño: el usuario recarga y su clasificación vuelve mal o no vuelve.

## F2 — el contrato

El reloj de esta iteración no da para los 13. Se recorta el **alcance**, no F4 ni F5. Van los
cuatro puntos cuya pérdida el usuario ve con los ojos:

1. **El sello de hora vuelve del blob.** Es lo que pinta «Rechazado hace 3 días» en la
   papelera. Sin él la papelera se queda muda.
2. **Clasificar deja el sello escrito en el blob**, no solo en memoria.
3. **La lista de vendedores bloqueados vuelve**, y se vacía antes de rellenarse. Si no vuelve,
   el vendedor bloqueado reaparece entero. Si no se vacía, desbloquear en otra pestaña no
   desbloquea aquí.
4. **Los cubos son exclusivos por cajón y la papelera gana.** Un id en los dos cubos sale en
   las dos listas: el mismo anuncio, favorito y rechazado a la vez.

Ninguna funcionalidad se toca. Esta iteración solo añade medida.

## F3 — implementación

Nada que implementar. No hay defecto que arreglar y no hay código muerto que quitar: cada
línea del barrido que sobrevive lo hace por falta de check, no por sobrar.

## F4 — los checks

Bloque `7e` en `src/test_buttons.js`, antes del bloque 8. Suite 509 → 517.

El punto 3 pide dos cargas, no una: en el primer arranque `blockSel` ya venía vacía, así que
el `clear()` no se distingue. El check llama a `hydrateEstado()` una segunda vez con otra
lista en la clave espejo, y comprueba que el vendedor de la primera carga ya no está.

El punto 4 no pasa por el store: pone el mismo id en las dos claves espejo y vuelve a
hidratar. Un tercer id, solo en favoritos, comprueba que la reconciliación no se lleva de más.

## F5 — review adversaria

Barrido final: **12 de 19 mueren, 7 quedan.** Los 7 no son iguales.

**Uno es equivalente de verdad, y se midió en vez de razonarlo:**
`cubos: solo mira los cajones de la papelera`. El bucle recorre la unión de los dos cubos.
Con el mutante recorre solo los cajones de la papelera. Un cajón que está en favoritos y no
en la papelera no tiene nada con lo que chocar, así que no hay id que borrar. Se sembró ese
caso y el resultado es el mismo con mutante y sin él.

**Seis quedan sin medir, y se dicen por su nombre:**

| mutante | lo que perdería el usuario |
| --- | --- |
| `cajon activo: no se reapunta` | tras cargar, los cubos apuntan al cajón que no es |
| `fold: los topes se funden al reves` | el tope de precio de otro cajón gana al del cajón |
| `blob: un blob que no es objeto pasa igual` | un `localStorage` corrupto entra sin guardia |
| `mir: una clave espejo vacia no cuenta` | una clave espejo vacía tapa el blob |
| `espejo: los bloqueados se escriben con setLS` | el espejo se escribe por la puerta que no es |
| `render: el estado cargado no se pinta` | la lista no se repinta al cargar |

Estos seis se dejan abiertos **por reloj, no por criterio**. Son la primera zona de la
próxima iteración de esta parte.

## Lo que deja esta iteración

- Un cubo exclusivo se prueba con el id que está en los dos, y con un tercero que solo está en
  uno: sin el tercero, el check no distingue «reconcilia» de «vacía el otro cubo».
- Un `clear()` antes de rellenar no se ve en la primera carga. Se prueba con la segunda.
- Un barrido con 13 supervivientes no cabe en una iteración. Se recorta el alcance por daño al
  usuario, y se escribe qué queda fuera.
