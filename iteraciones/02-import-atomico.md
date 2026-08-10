# Iteración 2 — la restauración, entera o nada

Método: `CICLO.md`. Sale de la review adversaria (F5) de la iteración 1, corrida el
10/08/2026 con tres lentes: refutador, guardián de funcionalidad y crítico de
completitud. Los hallazgos de F5 vuelven a F2, no se parchean al vuelo.

Este documento es el contrato de la implementación. Si el código se sale de aquí, se
actualiza esto primero.

**Veredicto de F5 sobre la iteración 1:** dos lentes de tres dan por bueno el cierre. El
refutador no, y tiene razón: el arreglo del hallazgo 1 dejó abiertos dos caminos que
producen exactamente la pérdida de triaje que decía cerrar. Los arreglos 2, 3 y 5 salen
limpios de las tres lentes; cada uno se puso en rojo revirtiéndolo.

---

## Se arregla ahora

### 1 · La vuelta atrás puede reventar ella misma — gravedad **alta**

`src/app.js:2317-2323`, handler de `#importState`.

El comentario que escribí afirma **«Reponer solo libera sitio, así que la vuelta atrás no
puede reventar»**. Es falso. La vuelta atrás repone en el mismo orden que las escrituras.
Si una clave temprana **encogió** y una posterior **creció**, reponer la primera sube la
ocupación por encima de lo que había al empezar, y la cuota revienta otra vez. El bucle
de reposición se corta a medias y el triaje se queda machacado, con el snack diciendo que
sigue intacto.

- **Reproducido por dos lentes de forma independiente.** Almacén de partida lleno; la
  copia trae `wp_favorite` que encoge y `wp_searches` que crece. Resultado:
  `wp_favorite = "{}"` (favoritos perdidos), snack de «no se ha restaurado nada, tu
  triaje sigue intacto», `reloads = 0`.
- **Por qué pasó el check 42:** en ese check todas las claves de la copia **crecen**, así
  que la vuelta atrás siempre cabe.
- **Arreglo:** vaciar antes de reponer. Se hace `removeItem` de todas las claves tocadas
  y solo después se reponen los valores previos. Así el pico de ocupación nunca pasa de
  lo que ya cabía, y el argumento es una línea, no un razonamiento sobre órdenes.

### 2 · IndexedDB falla fuera del try, con las claves sobrantes ya borradas — gravedad **alta**

`src/app.js:2324-2327`.

`await idb.set("rows", copia.filas)` va **después** del try/catch y **después** del
borrado de las claves sobrantes. El wrapper de `idb` rechaza a propósito
(`src/app.js:135-140`, «sin `.catch` mudo»), así que un fallo ahí cae en el mismo
`.catch` del importador: mismo mensaje mentiroso, y nada deshecho. Peor, el borrado de
las claves sobrantes tampoco tiene vuelta atrás: `previo` solo guarda las claves de la
copia.

- **Reproducido.** Con `idb.set("rows")` lanzando `QuotaExceededError`: de 10 claves
  quedan 2, ambas con el contenido ajeno; `wp_lastcsv`, `wp_rejected`, `wp_blocksel`,
  `wp_lim`, `wp_alias`, `wp_stamp`, `wp_excl` y `wp_catexcl` borradas; `reloads = 0`;
  snack de «tu triaje sigue intacto».
- **Por qué no lo vio nadie:** el check 42 nunca pasa `filas` en la copia.
- **Arreglo:** meter las tres operaciones en el mismo try (escribir, borrar sobrantes,
  escribir filas) y ampliar la foto previa a **todas** las claves tocadas, que son las de
  la copia más las que `backupKeys()` ve antes de empezar. Las filas se reponen desde
  `rowCache`, que ya es la copia en memoria de lo que había.

### 3 · El `sleep` deja un listener de abort pegado por cada espera cumplida — gravedad **baja**

`src/scrape.js:26`.

El listener se registra siempre y `{once: true}` solo lo retira si el abort llega. Cuando
el temporizador se cumple, que es el caso normal, el listener se queda.

- **Reproducido.** Un scrape de 40 páginas deja 39 listeners en el signal, medido con
  `require("events").getEventListeners(ac.signal, "abort").length`. En `main` eran 0.
- **Síntoma visible: ninguno.** `app.js` crea un `AbortController` nuevo por búsqueda
  (`src/app.js:1907`), así que los listeners mueren con ella.
- **Se arregla igual** porque es coste nuevo que introdujo la iteración 1, cabe en dos
  líneas y admite un check que se pone en rojo.

### 4 · La rama `#` del `closest()` del arnés no tiene consumidor — gravedad **baja**

`src/test_app.js:166`.

Hay una sola llamada a `closest()` en todo `app.js`, con el literal
`"a,button,input,.seller-banner"`. La rama que casa por id no se ejecuta nunca.

**Corrección al refutador:** dijo que la rama además está rota porque `st.id` no se
asigna. Es falso, `src/test_app.js:93` lo asigna. El motivo para borrarla es solo que no
tiene consumidor.

- **Arreglo:** borrarla. Código muerto añadido en la misma rama cuyo último commit borra
  código muerto.

### 5 · `MEJORAS.md` enseña como arreglo un código que ya no corre — gravedad **baja**

`MEJORAS.md:45-49`.

El bloque del defecto 1 muestra el bucle sin try/catch. Desde el commit `c1d3311` ese
bucle va envuelto. Quien lea solo `MEJORAS.md` cree que ese es el código de hoy.

- **Arreglo:** una nota con el puntero a la iteración que lo profundizó.

---

## Se documenta, no se arregla

### El hook mide el árbol de trabajo, no lo que se commitea — gravedad **media**

`.githooks/pre-commit:3`.

`check.sh` corre sobre los ficheros del disco. Si el índice y el árbol difieren, el hook
aprueba un `HEAD` que está en rojo. Reproducido: romper `src/app.js`, `git add`,
restaurar el fichero bueno en el árbol, commitear — el hook acepta.

**No se arregla con `git stash --keep-index`.** Un stash dentro de un hook pierde trabajo
cuando el `pop` choca, y el fallo que evita es más raro que el que introduce. Se deja
escrito como límite conocido en `CLAUDE.md`. Un commit parcial con el árbol sano es un
caso que en este repo no se da: aquí nadie usa `git add -p`.

---

## Fuera de alcance

Sigue todo lo que la iteración 1 dejó fuera, sin cambios: los hallazgos 6 y 7 de
`iteraciones/01-robustez.md` (el `filteredRows()` duplicado y la guarda
`typeof snack === "function"`), `src/app.js:1595-1780`, el evento `storage` entre
pestañas, los checks 1-37 de `src/test_buttons.js`, `src/wallapop.py` fuera de su
`demo()`, y la zona visual.
