# Iteración 18 — el orden que nadie mira

**Zona:** `src/app.js`, la capa que ordena: `cmpCell`, `sortList`, el orden multinivel del mazo,
y `bucketRows`, que es quien decide qué filas llegan a ordenarse.
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

Barrido de mutantes con `./check.sh` completo. Ocho mutantes, **siete vivos**. Es la zona menos
defendida que queda: los checks miran qué filas salen y ninguno mira en qué orden salen.

```
bucketRows: no saca la fila del cache            VIVE
bucketRows: no marca la fila ya vista            muere
sortList: el sentido de la flecha se ignora      VIVE
sortList: la columna desconocida no se ignora    VIVE
sortList: el orden de llegada se ignora          VIVE
cmpCell: el vacío no va al final                 VIVE
cmpCell: números comparados como texto           VIVE
mazo: el orden multinivel se queda en 1          VIVE
```

### Qué pierde el usuario con cada uno

**1. `bucketRows` no saca la fila del cache** (`src/app.js:303`). `data` son las filas de la
búsqueda de ahora. Un anuncio que el usuario guardó hace un mes y que ya no está en Wallapop no
sale en `data`: sale de `rowCache`. Sin esa rama, favoritos y papelera enseñan solo lo que sigue
vivo, y lo demás desaparece de la pantalla sin desaparecer del cubo. El contador sigue
contándolo. Es el mismo síntoma que el aviso de huérfanos de dos líneas más abajo describe, y
ese aviso sí está y esta rama no.

**2. `cmpCell` compara números como texto** (`src/app.js:869`). Es el clásico: como texto,
`"1000"` va antes que `"200"`. Ordenar la papelera por precio daría un orden sin sentido, y
ordenar por precio es para lo que se ordena una lista de chollos.

**3. `cmpCell` manda el vacío al final** (`src/app.js:872`). Una celda vacía vale `-Infinity`, o
sea la primera con la flecha hacia arriba. Es una decisión, no un accidente, y no la mide nadie.

**4. `sortList` ignora el sentido de la flecha** (`src/app.js:895`). El botón que cambia
ascendente/descendente deja de hacer nada.

**5. `sortList` ignora el orden de llegada** (`src/app.js:885`). Con `listSort` vacío la lista se
ordena por el momento en que cada anuncio entró al cubo. Es el orden por defecto, el que ve
todo el mundo que no ha tocado la barra.

**6. `sortList` no ignora una columna desconocida** (`src/app.js:894`). `wp_listsort` sobrevive a
los despliegues. Si una columna del CSV cambia de nombre, `headers.indexOf` da `-1`, y sin la
guarda `cmpCell(a[-1], b[-1])` llama a `localeCompare` sobre `undefined`: excepción dentro del
`render`, y la lista no se pinta. La app se queda inerte hasta que alguien borre esa clave, y el
usuario no puede borrar lo que no puede abrir.

**7. El mazo se queda en el primer nivel de orden** (`src/app.js:931`). `sortKeys` es una lista:
"por precio, y a igualdad por km". Sin el `if (c)` el segundo criterio no se aplica nunca.

## F2 — Contrato

Un check por mutante. Cada uno tiene que ponerse en rojo con su mutante puesto.

1. **La papelera enseña el anuncio que ya no está en la búsqueda**, si está en `rowCache`.
2. **Ordenar por precio ordena por número**, no por texto: 50 antes que 200 antes que 1000.
3. **La celda vacía va al principio con la flecha ascendente**, y al final con la descendente.
4. **La flecha invierte el orden.** La lista con `listSortDir = 1` es la del `-1` del revés.
5. **Sin columna, la lista sale en el orden de entrada al cubo**, y la flecha también lo invierte.
6. **Un `wp_listsort` con una columna que ya no existe no tumba el render**: se ignora y la lista
   sale en el orden de llegada.
7. **El mazo desempata con el segundo criterio de `sortKeys`.**

No se toca `src/app.js`: los siete describen código que ya hace lo correcto. Regla 1 del método
intacta, no se pierde funcionalidad.

## F3 — Implementar

Sin cambios en producción. Solo checks, en `src/test_buttons.js`.

## F4 — Probar

Checks nuevos: `src/test_buttons.js` 339 → 351 (bloques 60 a 64). `./check.sh` sale 0.

Cada mutante puesto otra vez, ahora con la red dentro:

```
bucketRows: no saca la fila del cache            muere  FAIL: la papelera esconde el anuncio que solo vive en cache (vendido/caducado): a1
sortList: el sentido de la flecha se ignora      muere  FAIL: la flecha no invierte el orden: 50,200,1000
sortList: la columna desconocida no se ignora    muere  FAIL: un orden guardado por una columna que ya no existe tumba el render: Cannot read properties of undefined (reading 'localeCompare')
sortList: el orden de llegada se ignora          muere  FAIL: sin columna no salió en orden de llegada al cubo: a1,a2,a3
sortList: el orden de llegada no invierte        muere  FAIL: la flecha no invierte el orden de llegada: a3,a1,a2
cmpCell: el vacío no va al principio             muere  FAIL: el precio vacío no va el primero al ascender: 1000,,50
cmpCell: números comparados como texto           muere  FAIL: los precios con decimales no se ordenan como números: 1.5,1.25,50
mazo: el orden multinivel se queda en 1          muere  FAIL: el mazo no desempató por el segundo criterio: 1000,200,50
```

Ocho de ocho. El mutante de la columna desconocida enseña el fallo entero:
`Cannot read properties of undefined (reading 'localeCompare')`, dentro del render.

### La rama numérica de `cmpCell` no es un adorno, y casi lo parece

El primer intento de matar `cmpCell: números comparados como texto` falló: con la rama numérica
fuera, `"1000"` y `"200"` **siguen** saliendo bien. La causa es que el `localeCompare` de abajo
lleva `{ numeric: true }`, y esa opción ya compara las tiradas de dígitos como números. Con
precios enteros los dos caminos dan el mismo orden, así que el mutante parecía equivalente.

No lo es. `{ numeric: true }` parte la cadena por el punto decimal y compara tirada a tirada:
`"1.5"` contra `"1.25"` acaba comparando `5` contra `25`, y coloca 1,50 € por debajo de 1,25 €.
Los precios de Wallapop son `amount`, un float, así que los decimales llegan de verdad. El check
usa ese caso, y con él el mutante muere.

Es lo que dice la regla del método: una lente que descarta el hallazgo de otra tiene que medirlo.
Aquí el descarte era mío y era falso, y solo se vio al buscar la entrada que separa los dos
caminos en vez de razonar sobre ellos.

## F5 — Review adversaria

Ningún mutante se queda vivo en esta zona, así que no hay nada que justificar por inalcanzable ni
por equivalente. Sin cambios en `src/app.js`: la iteración añade red, no toca producción.
Regla 1 intacta.

Lo que queda fuera a propósito: el orden de la barra del mazo (`sortKeys`) se prueba llamando a
`filteredRows` con la lista puesta a mano, no pulsando las cabeceras. Pulsar cabecera es el
código de `src/app.js:784-798`, que arma la lista; ese es su propio barrido y no este.

