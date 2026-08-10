# Iteración 39 — la edad del anuncio

Zona: `src/app.js:540-581` (`humanAge`, `adAge`, `ago`) y sus tres consumidores:
la tarjeta del listado (`src/app.js:711`), la línea de "cuándo se clasificó" (`src/app.js:720`)
y la tarjeta de una búsqueda guardada (`src/app.js:2126`).

Elegida por daño al usuario: la edad sale en **cada** tarjeta y decide si el anuncio se mira o se
pasa. `adAge` es la que más pesa y la que menos se mira: suma lo transcurrido desde el scrape a la
edad congelada del CSV. Sin esa suma, un CSV cacheado y reabierto tres días después pinta cada
anuncio tres días más joven de lo que es.

## F1 — Investigar

21 mutantes, veredicto por el código de salida de `./check.sh`.
**4 mueren, 15 VIVEN, 2 mutadores rotos.**

| mutante | veredicto en F1 |
| --- | --- |
| `humanAge`: los negativos no se cortan | VIVE |
| `humanAge`: redondea los minutos | VIVE |
| `humanAge`: el `<1 minuto` no salta | muere |
| `humanAge`: la frontera de la hora corrida | VIVE |
| `humanAge`: redondea las horas | VIVE |
| `humanAge`: la frontera del día corrida | muere |
| `humanAge`: redondea los días | MUTADOR ROTO |
| `humanAge`: el día siempre en plural | MUTADOR ROTO |
| `humanAge`: el minuto siempre en plural | VIVE |
| `adAge`: no suma lo transcurrido | VIVE |
| `adAge`: resta lo transcurrido | VIVE |
| `adAge`: el texto del CSV sin convertir | VIVE |
| `adAge`: cuenta en horas, no en días | VIVE |
| `adAge`: sin CSV cuenta desde el epoch | VIVE |
| `adAge`: el reloj atrasado resta | VIVE |
| `ago`: el momento no salta | muere |
| `ago`: cuenta en decenas de segundo | muere |
| `ago`: la frontera de la hora corrida | VIVE |
| `ago`: el día siempre en plural | VIVE |
| tarjeta: la edad sin lo transcurrido | VIVE |
| guardadas: la edad de la búsqueda sin cortar | VIVE |

Los cuatro que mueren los mata el `console.assert` que las dos funciones llevan al lado. El arnés
los convierte en fallos de la suite (`test_app.js:493`), así que son checks de verdad. Pero un
`console.assert` de una línea prueba **un** valor por rama, no la frontera de cada rama:
`humanAge(0.05) === "hace 1 hora"` no distingue `Math.floor` de `Math.round`, y
`humanAge(16.8) === "hace 16 días"` tampoco.

Los dos mutadores rotos apuntaban a `d === 1 ? "día" : "días"`, que sale igual en `humanAge` y en
`ago`. Se arreglan anclando el corte a la línea de arriba.

**`adAge` no tiene ni un check.** Sus seis mutantes viven, y con ellos vive el consumidor: la
tarjeta puede pintar `humanAge(dias)` en vez de `adAge(dias)` y los siete checks siguen verdes.

## F2 — El contrato

Lo que la zona tiene que cumplir, escrito antes del código:

1. `humanAge` usa **una sola** unidad, la mayor que cabe, y la trunca hacia abajo: 90 minutos son
   "hace 1 hora", no "hace 2 horas". Un anuncio de hace 100 minutos no puede leerse como de hace 2
   horas: la app existe para llegar el primero.
2. Las fronteras caen donde la unidad cambia: 60 minutos son "hace 1 hora" y 24 horas son
   "hace 1 día".
3. El singular y el plural se ven los dos: "hace 1 minuto" y "hace 2 minutos".
4. Una edad negativa (un reloj atrasado, un `mtime` en el futuro) vale "hace <1 minuto". No hay
   edades negativas para el usuario.
5. `adAge(dias)` = la edad congelada en el CSV **más** los días transcurridos desde el scrape.
   La columna del CSV es texto, así que la suma es numérica, no de cadenas.
6. Sin marca de scrape (`curCsvScrape === 0`) `adAge` pinta solo la congelada. Nunca cuenta desde
   el epoch.
7. Un `curCsvScrape` en el futuro no rejuvenece el anuncio: lo transcurrido se corta en 0.
8. La tarjeta del listado pinta `adAge`, no `humanAge`.

**Simplificación que sale del contrato:** hay **dos** `Math.max(0, …)` en la zona y los dos son
código muerto. El de `src/app.js:2126` es redundante porque `humanAge` corta por dentro. Y el de
dentro de `humanAge` es redundante porque la rama de abajo ya lo hace: con `min = -7200`,
`min < 1` es cierto y sale `"hace <1 minuto"`, igual que con `min = 0`. Se van los dos. Quien
cumple el punto 4 es la rama `min < 1`, no ningún `Math.max`.

## F3 — Implementar

Sin cambio de comportamiento: la zona no tiene defecto de producción. Tres cambios:

- `src/app.js:542`: fuera el `Math.max(0, …)` de `humanAge`.
- `src/app.js:2126`: fuera el `Math.max(0, …)` de la tarjeta de una búsqueda guardada.
- `src/test_buttons.js`: bloque `4b`, los ocho puntos del contrato.

## F4 — Probar

`./check.sh` verde. La suite pasa de 479 a 496 comprobaciones.

Barrido final, 24 mutantes: **22 mueren, 2 equivalentes.**

Los dos equivalentes son los dos `Math.max` puestos de vuelta. Un mutante equivalente es código que
no se puede romper porque no hace nada, y por eso mismo se quita.

Tres mutantes que en F1 no existían salieron del barrido final y también mueren: la tarjeta de una
búsqueda guardada contando en horas, contando desde 0, y leyendo el `mtime` como milisegundos en
vez de segundos. Esa línea no tenía ningún check: podía decir "hace <1 minuto" para todas las
búsquedas con los siete checks en verde.

## F5 — Review adversaria

**¿El bloque nuevo mide `adAge` o mide el arnés?** Mide `adAge`. Los checks escriben `curCsvScrape`
desde el sandbox y leen el texto que sale. Antes de creerme el verde comprobé lo contrario: con la
marca de scrape a dos días atrás el mismo `adAge("1")` da "hace 3 días", y con la marca de ahora da
"hace 1 día". Un check que no distingue no es un check.

**¿Por qué no se toca el `console.assert` de dentro de `app.js`?** Porque llega al usuario. Los
checks nuevos viven en la suite; los `console.assert` viven en producción y son lo único que avisa
si alguien edita `app.js` sin correr nada. Los dos sitios miden lo mismo y eso está bien: uno mide
un valor por rama, el otro mide las fronteras. En el barrido final se ve el reparto: 8 mutantes los
mata el `console.assert` y 14 los mata el bloque nuevo.

**¿Y el mutante que pinta `humanAge` en vez de `adAge` en la tarjeta?** Ese es el que más importa y
el que hacía falta llevar al DOM. El check nuevo construye la tarjeta con `fillCard` —el código de
producción, no una copia— con la marca de scrape dos días atrás, y lee el texto del chip `.li-age`.
Un check sobre la función sola lo habría dejado vivo.

**¿Los valores frontera aguantan el binario?** Sí, medido: `60/1440`, `1/24`, `23/24`, `36/24` y
`2/1440` multiplicados por 1440 dan enteros exactos. Un check inestable no es mejor que ningún
check.

**Regla que deja esta iteración:** *un `console.assert` de una línea prueba una rama, no su
frontera. La rama la mata un valor cualquiera; la frontera solo la mata el valor de al lado.*
