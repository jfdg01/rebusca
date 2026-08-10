# Iteración 25 — el lote que se manda a la IA

**Zona:** `src/app.js`, `copyForAI()` y `setAisent()`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** red que falta, en la mitad que nadie había mirado.

## F1 — Investigar

Medida de cobertura por nombre sobre las dos suites: `copyForAI` sale **0 veces**, `aiPrompt`
**0 veces**, `setAisent` **1 vez**. La iteración 20 cubrió la vuelta del viaje (`fromURL`, el
enlace `?keep=`).

**La medida por nombre engaña, y hay que decirlo.** Los checks 5 y 6 sí pulsan `#copyDeck` y
`#copyFav`: miden que se copia el mazo sin clasificar, que el clasificado no va, que sin favoritos
avisa, y que `wp_aisent` queda anotado. La suite prueba la función por el botón, no por el nombre.
Así que el hueco no era la zona entera; había que buscarlo con el barrido.

Barrido sobre `copyForAI()` y `setAisent()`, `src/app.js:2961`:

```
ia: registra la lista entera, no lo copiado   VIVE
ia: el cajón se lee tras el await             VIVE
ia: no cachea la ficha de lo enviado          VIVE
ia: la copia fallida anota lote igual         VIVE
ia: la copia fallida no avisa                 VIVE
ia: el botón no se rehabilita nunca           VIVE
ia: la lista vacía anota lote igual           muere   ← ya lo cubría el check 6
```

Las dos mitades del viaje están atadas: `?keep=<ids>` conserva como favoritos los ids del enlace
y **rechaza el resto del lote anotado en `wp_aisent`**. Un lote mal anotado no se queda en un
aviso feo — manda a la papelera anuncios que el usuario nunca vio. Los seis vivos:

**1. El lote anotado tiene que ser el copiado, no la lista entera.** Se copian 60 fichas
(`UNSEEN_CAP`); si se anotan las 200, el `?keep=` de la respuesta rechaza 140 anuncios que la IA
jamás vio. Es el fallo más caro de esta zona.

**2. El cajón se captura antes del `await`, no dentro.** El comentario de `src/app.js:278-280` ya
cuenta que esto se arregló una vez: entre el clic y la resolución de la copia el usuario puede
cambiar de búsqueda, y el lote quedaba etiquetado con la búsqueda equivocada. Sin red, vuelve.

**3. `setAisent()` cachea la ficha de cada id en `rowCache`**, porque el veredicto puede llegar en
otra sesión, sin el CSV cargado. Sin ese cacheo, `?keep=` llega y no encuentra las filas.

**4, 5 y 6. El camino del fallo.** Si el portapapeles dice que no: el aviso lo tiene que decir, el
lote **no** se anota (anotarlo dejaría pendiente un lote que la IA no tiene), y el botón vuelve de
"Preparando…" en vez de quedarse muerto hasta recargar.

## F2 — Contrato

1. **Con la lista vacía, `copyForAI` avisa, no copia y no toca `wp_aisent`.**
2. **Con más de `UNSEEN_CAP` filas, se copian y se registran exactamente las primeras 60.**
3. **`wp_aisent.csv` es el cajón de cuando se pulsó**, aunque el usuario cambie de búsqueda antes
   de que la copia resuelva.
4. **`setAisent` deja en `rowCache` la ficha de cada id enviado**, para que el veredicto funcione
   sin CSV cargado.
5. **Si la copia falla, el aviso lo dice, `wp_aisent` no cambia y el botón vuelve a su texto.**
6. Ninguna funcionalidad cambia. Solo se añaden comprobaciones.

## F3 — Implementar

Cero líneas de producción. Dos checks nuevos en `src/test_buttons.js`:

- **5b**: con un CSV de 70 filas, el lote anotado son los 60 primeros, lleva el cajón de origen
  aunque el usuario cambie de búsqueda entre el clic y la copia, y deja la ficha en `rowCache`.
- **5c**: con el portapapeles rechazando, el aviso lo dice, `wp_aisent` sigue vacío y el botón
  vuelve de "Preparando…".

De 402 a **409 comprobaciones**.

## F4 — Probar

Las siete suites en verde. El barrido, después:

```
ia: registra la lista entera, no lo copiado   muere  FAIL: el lote anotado no es el copiado (tope UNSEEN_CAP): 70 ids
ia: el cajón se lee tras el await             muere  FAIL: el lote quedó etiquetado con la búsqueda a la que se cambió…: otra
ia: no cachea la ficha de lo enviado          muere  FAIL: el lote enviado no dejó su ficha en rowCache…
ia: la copia fallida anota lote igual         muere  FAIL: una copia fallida anotó lote igual: {"csv":"ford.csv","ids":["a1","a2","a3"]}
ia: la copia fallida no avisa                 muere  FAIL: una copia fallida no avisa:
ia: el botón no se rehabilita nunca           muere  FAIL: el botón se queda muerto en 'Preparando…' tras un fallo de copia: Preparando…
```

## F5 — Review adversaria

**1. Un mutante que salió VIVO y se queda vivo, con argumento.** Cambiar `.finally(…)` por
`.then(…)` **no cambia nada**: el `.catch()` de la línea anterior se traga el error y devuelve una
promesa resuelta, así que el `.then` de después corre en los dos caminos, el bueno y el malo. Es
un mutante **equivalente**. Lo que sí hay que medir es que el botón se rehabilite, y eso lo mide
el mutante que vacía el bloque entero: muere.

**2. Cómo se mide "el usuario cambia de búsqueda a mitad de la copia".** El portapapeles falso
resuelve ya, así que su `.then` corre en la cola de microtareas. `click()` es síncrono: llamar a
`selectQueryUI("otra.csv")` en la misma línea del test, antes del primer `await`, cae entre el
clic y la resolución. Es la ventana exacta que el comentario de `src/app.js:278` describe.

**3. La medida de cobertura por nombre no vale como F1.** `copyForAI` salía con 0 menciones y la
zona **sí** tenía red: la suite pulsa botones, no llama funciones por su nombre. Si me hubiera
fiado del recuento, habría escrito otra vez los checks 5 y 6. Regla nueva del método: **el recuento
de menciones sirve para elegir dónde barrer, nunca para afirmar que algo no está probado.** Quien
decide es el mutante.

**4. Lo que sigue sin red en esta zona.** El texto del prompt (`promptIntro`, `ficha`) se mide solo
por dos `includes`. Un cambio en el formato de la ficha no lo nota nadie, y la IA responde con
enlaces `?keep=` que dependen del `[#id]`. Queda anotado para una iteración siguiente; no entra
aquí porque este barrido ya cerró seis.
