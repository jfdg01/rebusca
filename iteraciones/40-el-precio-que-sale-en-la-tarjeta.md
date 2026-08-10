# Iteración 40 — el precio que sale en la tarjeta

Zona: `src/app.js:480-507` (`PORTE`, `finalPrice`, `dec1`, `eur`), `src/app.js:588-609`
(`medianPrice`, `median`, `dealOff`) y sus consumidores: la etiqueta de precio y el chip de chollo
de la tarjeta (`src/app.js:683-697`), el recálculo de la mediana al cargar un CSV
(`src/app.js:1554`) y el precio de la ficha para la IA (`src/app.js:2813`).

Elegida por daño al usuario: es la única cifra por la que se compra o no se compra. El chip
"−45 %" dice qué anuncio es un chollo, y sale de comparar el precio con la mediana del lote.

## F1 — Investigar

22 mutantes, veredicto por el código de salida de `./check.sh`.
**16 mueren, 6 VIVEN.**

| mutante que VIVE | qué ve el usuario |
| --- | --- |
| `median`: sin comparador de orden | la mediana del lote sale mal y el chip de chollo señala los anuncios equivocados |
| `median`: orden al revés | nada: la mediana no depende del sentido del orden |
| `dec1`: lo no numérico pasa como `NaN` | un precio raro en el CSV se pinta `NaN€` |
| `dealOff`: sin el guardia del precio | un anuncio a 0 € sale con el chip `−100 %`, el mejor chollo del lote |
| `dealOff`: sin el guardia de la mediana | nada: sin mediana la cuenta da `-Infinity` y el chip no sale igual |
| tarjeta: el precio final también sin envío | un anuncio en mano se pinta con la comisión y el porte encima |

Los 16 que mueren los matan los `console.assert` de al lado (`finalPrice`, `dec1`, `median`) y los
checks de la ficha y del chip que ya existían.

**El agujero de `median` es el peor y es del mismo tipo que el de la iteración 39.** El
`console.assert` usa `median([9, 1, 2, 3, 4, 5, 6, 7, 8])`: son dígitos sueltos, y ahí el orden
lexicográfico de `sort()` sin comparador coincide con el numérico. Con precios de verdad no
coincide: `[1000, 200, 30]` en texto va `"1000" < "200" < "30"`.

## F2 — El contrato

1. `median` ordena por valor, no por texto. Un lote con precios de distinta longitud da la misma
   mediana que ese lote ordenado a mano.
2. `dec1` con algo que no es un número devuelve el texto tal cual, nunca `NaN`.
3. `dealOff` no saca chip para un precio de 0 €.
4. La tarjeta pinta el precio final (comisión + porte) **solo** si el anuncio lleva envío. En mano,
   el precio anunciado tal cual.

## F3 — Implementar

Sin cambio de comportamiento: la zona no tiene defecto de producción, los cuatro puntos ya se
cumplen. Un cambio: `src/test_buttons.js`, bloque `7c`, los cuatro puntos del contrato más el
precio vacío, que la tarjeta corta antes de llegar a `dec1` y pinta como una raya.

Los dos mutantes equivalentes (`median` al revés, `dealOff` sin el guardia de la mediana) se dejan
como están. Al revés del `Math.max` de la iteración 39, aquí ninguno de los dos es código de más:
el comparador tiene que estar y el guardia de la mediana dice lo que quiere decir. Que la mediana
salga igual con el orden invertido es una propiedad de la mediana, no código muerto.

## F4 — Probar

`./check.sh` verde. La suite pasa de 496 a 504 comprobaciones.
Barrido final, 22 mutantes: **20 mueren, 2 equivalentes.**

## F5 — Review adversaria

**¿El check de `median` mide el orden o mide otra cosa?** Mide el orden. Usa precios de tres y
cuatro cifras, que es donde el orden lexicográfico y el numérico se separan. Con los dígitos
sueltos del `console.assert` de al lado el check habría dado verde con `sort()` a secas, que es
justo lo que pasaba.

**¿El check de la tarjeta sin envío no es el mismo que el de la tarjeta con envío?** No. Son los
dos lados del mismo `if`, y hasta ahora solo se visitaba uno. Es la regla de la iteración 36: un
check contra una simetría tiene que visitar los dos lados.

**Un check mío no medía lo que yo creía.** Escribí `eur("") === "€"` dando por hecho que la cadena
vacía pasaba de largo por `dec1`. No pasa: `+"" === 0`, así que `dec1("")` da `"0"`. Quien corta el
precio vacío es la tarjeta, con `precio !== "" ? … : "—"`, y ahí es donde está el check ahora.

**Regla que deja esta iteración:** *un check con datos de juguete mide juguetes. Un dígito suelto
ordena igual en texto que en número; un precio de verdad, no.*
