# Iteración 45 — la lista que no se repinta

**Zona:** el `if (data.length) render()` del final de `hydrateEstado` (`src/app.js:450`).

**Por qué esta zona.** Es el último mutante que la iteración 43 dejó abierto. Su motivo escrito
era «no hay en el arnés una medida barata del repintado». Igual que en la 44, el motivo no
aguantó el primer examen: el arnés sí mide, pero no por donde yo miraba.

## La regla que cierra

El estado puede llegar cuando la lista ya está pintada: otra pestaña clasifica, o una carga
tardía completa el blob. Sin repintar, el usuario mira una papelera vacía que tiene anuncios
dentro, y su clasificación parece perdida hasta que navega a otra vista y vuelve.

## F4 — el check

Bloque `7h` en `src/test_buttons.js`. Suite 523 → 525.

Dos intentos fallidos antes del bueno, los dos por medir el arnés en vez del código:

1. `tbody.children.length === 0` sobre la papelera vacía. Falló. Diagnostiqué que el DOM falso
   no vacía `children` al asignar `innerHTML`. **Era falso:** `test_app.js:283` lo vacía desde
   siempre. La causa real es que la lista vacía **pinta su propia fila de aviso**, así que el
   conteo correcto de una papelera vacía es 1, no 0.
2. El conteo por `children` tampoco sirve con datos: la fila de aviso entra y sale según haya
   filas, así que el número no distingue «una fila real» de «el aviso».

El check bueno cuenta las filas por su botón de quitar, que solo existe en una fila real. Es
lo que ya hacían los bloques 12 y 13; la medida estaba escrita en el fichero.

## F5 — review adversaria

```
render: el estado cargado no se pinta          muere
cajon activo: no se reapunta                   muere
```

Con esto, de los 19 mutantes del barrido original de la iteración 42 queda **uno solo vivo**, y
es equivalente y medido (`blob: un blob que no es objeto pasa igual`, it43).

## Lo que deja esta iteración

- Un motivo escrito para dejar algo abierto se revisa antes de darlo por bueno. Dos iteraciones
  seguidas (44 y 45) han cerrado un abierto cuyo motivo era «el arnés no puede», y las dos
  veces el arnés podía.
- Antes de acusar al arnés, mira si el código pinta algo más de lo que crees. Una lista vacía
  que pinta su aviso hace que el conteo «correcto» sea 1.
- La medida que necesitas suele estar ya escrita en el fichero de pruebas, en otro bloque.
