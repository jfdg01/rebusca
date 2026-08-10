# Iteración 3 — el almacén de filas dice la verdad

**Zona:** el wrapper `idb` (`src/app.js:113-145`) y el importador de copias (`src/app.js:2299-2347`).

**De dónde sale:** la review adversaria (F5) de la iteración 2. Las dos lentes coinciden en
que la mitad de localStorage del arreglo está bien, y la mitad de IndexedDB descansa sobre una
premisa falsa. Los hallazgos vuelven a F2, que es este documento, y no se parchean al vuelo.

**Premisas verificadas a mano antes de escribir esto**, porque una lente ya se equivocó una vez
(dijo que `st.id` no se asigna en el arnés, y sí se asigna, `src/test_app.js:93`):

- `src/app.js:128-135`: `tx` solo cablea `q.onsuccess` y `q.onerror` de la **petición**. Nadie
  escucha `transaction.oncomplete` ni `transaction.onabort`. Confirmado leyendo el fichero.
- `src/app.js:142`: `set: (k, v) => (almacenRoto ? Promise.resolve() : ...)`. Con el almacén
  roto, resuelve sin escribir. Confirmado leyendo el fichero.

## Hallazgos que se arreglan

### 1. `await idb.set(...)` resuelve antes de que la escritura esté guardada — **alta**

`IDBRequest.onsuccess` dispara **antes** del commit de la transacción. La cuota de IndexedDB
salta al commitear: la petición dice que sí y la transacción aborta después. Con el cableado de
hoy, el `await` del importador resuelve, el `try` no lanza, la vuelta atrás no corre, no hay
aviso, y `location.reload()` se ejecuta. Resultado: localStorage se queda con el triaje
importado y IndexedDB con las filas viejas. Los favoritos restaurados quedan huérfanos —
justo el fallo que el comentario de `src/app.js:2328-2329` dice haber cerrado.

**Arreglo:** en `readwrite`, resolver en `t.oncomplete` y rechazar en `t.onabort`. En
`readonly` sigue valiendo `q.onsuccess`: una lectura no tiene nada que commitear.

### 2. Con `almacenRoto`, el importador recarga a medias y en silencio — **media**

No es una carrera: es determinista. Si una lectura falló antes, `almacenRoto` es `true`,
`idb.set` resuelve sin escribir, y el importador da por buena una restauración que dejó las
filas sin poner. El grifo cerrado es correcto para los llamadores fire-and-forget; para el
importador es mentira.

**Arreglo:** el importador comprueba `almacenRoto` y lanza. No se toca el wrapper: los otros
llamadores necesitan el grifo cerrado.

### 3. Ningún check ejecuta la rama real de IndexedDB — **media**

`grep -c indexedDB src/test_*.js` da 0 en los cuatro. El arnés nunca define `indexedDB`, así
que `idb` cae siempre al `Map` de memoria (`src/app.js:115-118`), que no tiene ni transacciones
ni `almacenRoto`. Por eso los hallazgos 1 y 2 pasaron por delante del check 42 nuevo sin
despeinarlo.

**Arreglo:** un `indexedDB` de mentira en el arnés, con la semántica que importa: la petición
resuelve en un microtask y el commit en el siguiente. `opts.idbFalla` lo hace abortar.

### 4. El aviso culpa al fichero cuando quien falla es el almacén — **media**

Las dos lentes lo encuentran por separado. Cualquier error que no sea `QuotaExceededError` cae
en `"Copia no válida: ..."`. Un `AbortError` de IndexedDB, un `UnknownError` de disco, o el
almacén roto del hallazgo 2, hacen que el usuario lea que su copia no vale cuando el fichero
está perfecto. Puede tirar la única copia que tiene.

**Arreglo:** solo el error de la copia mal formada dice `"Copia no válida"`. Lo demás dice que
falló este navegador y que el triaje sigue intacto, que ahora es verdad gracias a la vuelta atrás.

### 5. Borrar la línea que borra las claves sobrantes deja los siete en verde — **media**

Coberura que falta, heredada pero re-tocada por la iteración 2.

**Arreglo:** un caso en el check 42 que importe una copia sin una clave que sí está en el
almacén, y compruebe que desaparece.

### 6. La vuelta atrás de las filas es código muerto con un `.catch` mudo — **baja**

`src/app.js:2334`. Una transacción de IndexedDB es atómica: si aborta, no dejó nada escrito, y
no hay nada que reponer. Y `await idb.set(...)` es la última sentencia del `try`, así que
cualquier error del `catch` ocurrió antes o durante ella. Encima usa el `.catch(() => {})` que
el comentario de `src/app.js:136-139` prohíbe.

**Arreglo:** borrarla, con un comentario que diga por qué no hace falta.

## Fuera de alcance (no se toca en esta iteración)

Lo de las iteraciones 1 y 2 sigue en pie: `render()` calcula `filteredRows()` dos veces en la
vista de Rechazados (`src/app.js:1333`), la guarda `typeof snack === "function"`
(`src/app.js:11`), el hook de pre-commit mide el árbol de trabajo y no el índice, y sin mirar
aún: `src/app.js:1595-1780`, el evento `storage` entre pestañas, los checks 1-37 de
`test_buttons.js`, `src/wallapop.py` fuera de su `demo()`, y la zona visual.

## Reglas duras que aplican

1. Ninguna funcionalidad se pierde.
2. Cada hallazgo se ve **rojo antes** del arreglo, y los siete checks en verde después.
