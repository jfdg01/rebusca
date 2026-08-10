# Iteración 46 — el buscador de la lista

**Zona:** el filtro de `filteredRows` en vista de lista (`src/app.js:897-914`): el texto libre,
la forma `#id` con varios ids, y el filtro por vendedor.

**Por qué esta zona.** Es la única entrada de texto libre que el usuario escribe contra sus
propios datos, y nunca se había barrido.

## F1 — barrido de mutantes

15 mutantes escritos. El reloj de la iteración dio para 9 antes de tener que actuar, y se
actúa sobre lo medido, no sobre lo que se supone:

```
q: el filtro no se normaliza                   VIVE
q: el filtro vacio filtra igual                VIVE
#id: la almohadilla no fuerza id               muere
#id: la almohadilla se queda en la busqueda    muere
#id: no se parte por comas ni espacios         muere
#id: solo por comas                            muere
#id: los huecos vacios cuentan                 VIVE
#id: tienen que casar todos                    muere
#id: el id tiene que ser exacto                VIVE
```

La forma `#id` con lista estaba bien medida. Las fronteras, no.

## F2 — el contrato

1. **Una coma suelta no vacía el filtro.** Pegas la lista de ids que te dio la IA con una coma
   de más y queda un hueco vacío. Un hueco vacío casa con todo: el filtro dejaría de filtrar
   sin decirlo, y el usuario creería que esos 40 anuncios son los que pidió.
2. **Un id a medias encuentra su anuncio.** Pegar los primeros caracteres basta.
3. **El filtro normaliza los dos lados.** Buscar en mayúsculas encuentra el título.

## F4 — los checks

Bloque `7i` en `src/test_buttons.js`. Suite 525 → 528. El bloque deja `listQ` limpio al salir:
un filtro vivo se llevaría por delante los bloques de después.

## F5 — review adversaria

De los cuatro vivos, **tres mueren** ahora. El cuarto, `q: el filtro vacio filtra igual`, es
**equivalente y se midió**: con el filtro vacío la rama de texto hace `titulo.includes("")`,
que es verdad para todo, así que quitar el guardia `if (q)` no cambia ni una fila.

Quedan **6 mutantes sin correr** por reloj, los del filtro por vendedor y el orden. Se dejan
escritos en `mut46.py`, listos para la próxima iteración: no hay que volver a pensarlos.

## Lo que deja esta iteración

- Un separador que produce huecos vacíos convierte «filtra por estos ids» en «no filtra». El
  `filter(Boolean)` no es adorno, y su ausencia no la ve ningún check de camino feliz.
- Cuando el reloj corta un barrido, se actúa sobre lo medido y se deja el mutador escrito. Un
  barrido a medias con los mutantes en un fichero vale más que uno entero sin tiempo de usarlo.
