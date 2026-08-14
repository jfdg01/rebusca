# TODO

Cosas pensadas y no hechas. Cada una con el porqué, que es lo que se olvida.

---

## 1. Harness de prueba a ciegas de verdad

**Dónde estamos.** Las prompts de la IA (`askPrompt`, `aiPrompt`, `HAGGLE_RULES`,
`MSG_RULES` en `app.js`) se han afinado ocho rondas dándole el texto real de "copiar
para ia" a subagentes y leyendo lo que contestan. Once defectos salieron de ahí y
ninguno de un `assert`. Pero esos agentes corren con el system prompt de Claude Code:
son agentes de programación haciendo de asistente de chat, y el destinatario real es
alguien pegando esto en la app de Claude o de ChatGPT desde el móvil.

**Lo que falta.** Montar el harness con el CLI en modo headless, que sí da un modelo
de chat pelado:

```bash
claude -p --system-prompt "Eres un asistente de chat. Contestas desde el móvil." \
          --allowed-tools "" < lote.txt
```

- `--system-prompt` **reemplaza** el de Claude Code (no confundir con
  `--append-system-prompt`, que suma). Confirmar que la versión instalada lo trae.
- `--allowed-tools ""` deja el prompt sin esquemas de herramientas: menos tokens y,
  sobre todo, un modelo que no puede irse a leer el repo. Los agentes de ahora podrían
  y solo se lo impide una frase en su encargo.
- Corre sobre la suscripción, no pide clave de API.

**Cachear el prefijo.** El texto del lote ya está en el orden bueno: primero el bloque
de instrucciones (idéntico entre ejecuciones de la misma versión de la prompt) y las 50
fichas al final. Eso es un prefijo estable, que es lo que la cache necesita.

- Dentro de una ronda se lanzan 2+ agentes con la entrada **idéntica**. Lanzados a la
  vez todos fallan la cache (escriben a la vez); lanzando **uno primero y el resto
  después** de que termine, los demás entran enteros por cache.
- Entre rondas la cache muere igual, porque editar la prompt es justo lo que cambia el
  prefijo. No se puede evitar y no pasa nada: el coste está en repetir agentes dentro
  de una ronda, no entre rondas.
- Si el harness crece a un panel fijo (mismo lote, N variantes de prompt), invertir el
  orden: variar la prompt en la **cola** y no en la cabeza.

**Y de paso:** las ocho rondas han probado solo las reglas **inline**. Los agentes
tenían prohibido pedir la web, así que `llms.txt` no lo ha leído ninguno. Es el caso
pesimista y creo que el bueno (un chat nuevo se salta el enlace la mitad de las veces),
pero significa que `llms.txt` está sin verificar. Una ronda con `WebFetch` permitido lo
cerraría.

---

## 2. Bajada de precio

**Hecho el 11/08/2026: `src/historial.py`.** Una pasada por query guarda el precio de cada
id y la siguiente lo compara: el informe saca `NUEVO`, `BAJA` (con el % ) y `FIN`. Falta
solo la mitad de arriba: qué se hace con una bajada (mandarla a la IA, punto 4).

Es la señal más fuerte que hoy no se ve. Un anuncio ya juzgado a 400 € que baja a 330 €
vale más que cualquier anuncio nuevo, y ahora mismo pasa desapercibido porque cada
búsqueda empieza de cero.

**¿Lo da la API? No.** Volcada y mirada entera el 2026-08-11: 200 anuncios de 5 queries,
48 claves distintas por item, **ninguna de precio anterior ni de descuento**. `price` es
`{amount, currency}` y se acabó. El distintivo de "ha bajado de precio" de la app sale de
otro sitio, y pedir el detalle de cada anuncio es justo lo que este scraper no hace (ver
la restricción de `CLAUDE.md`). Así que el precio anterior lo ponemos nosotros. No es caro.

De paso, del mismo volcado: `modified_at` (epoch ms) es la única clave viva que el scraper
no lee, y viene en el 100 % de los anuncios. **No sirve de atajo:** sale distinta de
`created_at` hasta en anuncios de 15 segundos, así que no marca "cambió el precio".
Comparar el importe guardado es exacto y más barato.

**Calculándolo nosotros:** eso es `historial.json`, con `id → {visto, ultimo, qs, precios}`.
Los ids son estables entre pasadas (`it.id` es el de Wallapop, no uno nuestro), así que el
cruce es una comparación de claves, sin heurística de duplicados. `veredicto` y `nota` aún no
existen en el registro: los añadirá el punto 4, cuando haya IA que los escriba.

---

## 3. Desapariciones = precios de venta

**El registro ya está (11/08/2026).** `historial.py` marca `fin: <sello>` cuando ninguna query
trae ya el id, y el precio de venta es la última entrada de sus `precios`. Falta lo de siempre:
semanas de pasadas, y luego dárselo a la IA.

Un id que deja de aparecer se vendió o se retiró. Vale para dos cosas: sacarlo del
ranking, y **guardar a qué precio desapareció**. En unas semanas eso es un histórico de
precios de verdad para "¿cuánto vale un ThinkPad E14 Gen 4?", que hoy es la parte más
floja de todo el sistema: la IA lo estima de memoria y no puede citar nada comprobable.
Justo lo que las reglas del regateo le exigen y no le pueden dar.

Necesita semanas de pasadas antes de servir de algo. Motivo de más para empezar el
registro pronto aunque el ranking tarde.

Cuidado con un falso positivo: desaparecer del lote también puede ser que la búsqueda
cambió o que el anuncio se cayó de las 1500 filas del tope. Solo contar como
desaparición si la misma query lo trajo ayer y hoy no. Eso ya lo hace `merge()`: la fecha
de "visto" se guarda **por query** (`qs`), y una pasada cortada por un 403 no cuenta ninguna
desaparición, que si no media pasada hace desaparecer medio catálogo.

**Medido (vigilia del 11→12/08/2026: once pasadas horarias, 5463 anuncios, cero anomalías).**
El otro falso positivo existe y ya tiene número: el orden de la API baila, un anuncio se cae de
una pasada y vuelve en la siguiente, y eso fue **3 de 22 desapariciones (14 %)**. Uno de ellos
(«Stream Cleaner TR7», 245 €) se fue y volvió dos veces en cuatro horas. El registro se cura
solo — `merge()` borra el `fin` en cuanto el id vuelve — y desde el 12/08 el informe lo canta
con una línea `VUELVE`, que es la única huella que queda de la resurrección.

**La regla de «dos pasadas seguidas sin aparecer» no se va a construir.** Habría evitado 2 de
esos 3, no los 3, y a cambio pide un campo nuevo y retrasa **toda** venta de verdad una pasada.
Sale más barato leer la lista de ventas del **estado** del registro y no del log: vendidos = los
que tienen `fin` y llevan N días sin volver. Eso funciona hoy, sin tocar una línea, justo porque
el `fin` se borra al volver.

---

## 4. Vigilancia diaria (dos pasadas al día)

**Dónde corre: en la máquina de uno, NO en el VPS.** Toda la arquitectura existe para
que cada navegador scrapee sobre su propia IP; un cron nocturno desde el VPS devuelve
el riesgo de ban compartido para todos los que usan el dominio. Un `systemd` timer con
`Persistent=true` cubre el portátil apagado a las 6.

**Dos pasadas al día** (mañana y tarde) parecen suficientes para pillar el chollo
relámpago sin que la cosa se vuelva un scraper agresivo: son dos búsquedas al día, menos
tráfico que abrir la web un rato.

**Medido en la vigilia (11→12/08/2026, once pasadas horarias).** Una pasada entera cuesta
~188 s de red y trae 1,7 anuncios nuevos y 0,7 bajadas de precio. El coste no se reparte:
`thinkpad e14` son 275 anuncios (~10 s) y `deshumidificador` se lleva el 95 % restante con
~5170. La cadencia va **por query** y no en un timer global: la búsqueda estrecha puede correr
cada hora sin que se note, la ancha no. Y la hora manda: las ocho pasadas de 01:00 a 08:00
costaron 25 minutos de red para 4 bajadas y 11 anuncios nuevos, y la sola pasada de las 09:00
dio 3 bajadas y 3 nuevos en 3 minutos. La mañana rinde seis veces más por pasada.

**La forma: cribar poco y que juzgue la IA.**

1. ~~**Poda determinista, gratis.**~~ **Descartada el 11/08/2026, por decisión del dueño:
   la criba la hace la IA.** El motivo aguanta solo: esas reglas (accesorios, recambios,
   piezas sueltas) ya están escritas en la prompt de la app (`aiPrompt` en `app.js`), y ponerlas otra
   vez en una expresión regular de Python es una segunda copia que se desincroniza. El ahorro
   era ~18 % de tokens; el precio, dos sitios donde arreglar cada falso descarte.
2. **A la IA van solo dos cosas:** ids nunca vistos, e ids cuyo precio bajó. El resto
   conserva su veredicto guardado. Así una pasada de 1500 anuncios se queda en ~20 de
   trabajo real, que es lo que hace que esto quepa en una suscripción.
3. **Una pasada de ranking** sobre los supervivientes.

**Puntuación estable.** Cada anuncio se puntúa **una vez**, al verlo por primera vez,
contra una rúbrica escrita, y la nota se guarda. Solo se vuelve a puntuar si cambia el
precio. Si no, el ranking se rebaraja cada día por ruido del modelo y el informe deja de
poder leerse.

**La salida es un enlace.** No hace falta MCP ni automatizar el navegador: la app ya
tiene API de escritura, que es el enlace `?fav=id1,id2,…`. El trabajo diario termina en
una URL que se pulsa en el móvil y los anuncios aparecen en favoritos. Ojo: `?fav=` y no
`?keep=`, porque `keep` además **rechaza** el resto del lote que cree que se le mandó, y
un proceso de fondo no ha mandado ningún lote (`fromURL`, la rama `isKeep` de `app.js`).

**Memoria: un JSON del script, no la memoria del agente.** Son miles de filas
estructuradas; la memoria del agente es para hechos sueltos en prosa.

**Orden de ataque:** el registro primero, y ya está hecho (`src/historial.py`, 11/08/2026).
Sirve solo, sin ningún modelo de por medio, y es la mitad del valor.

**Lo siguiente NO es el timer.** Antes de automatizar nada hay que correr la pasada a mano
unos días, sobre las queries de verdad, y mirar si el informe dice algo que sirva. Un timer
sobre un informe que no se lee es un cron que nadie mira. El punto 1 (el harness a ciegas) y
el resto de este punto 4 esperan a esa prueba.

---

## 5. Revisar el bucle de afinar la búsqueda

Añadido el 11/08/2026, con la feature recién puesta. La IA recibe una muestra al azar del
mazo y la URL entera de la búsqueda, y devuelve un segundo enlace `?q=…` con la query
corregida. Está probado con los checks, no con uso real. Lo que hay que mirar cuando lleve
unas cuantas vueltas:

- **Copiar dos veces manda dos lotes DISTINTOS.** `wp_aisent` guarda solo el último, así
  que pegar la respuesta del primero rechaza anuncios que esa respuesta nunca vio. Antes no
  pasaba: los dos lotes eran los mismos 60 primeros. Es el riesgo real que introdujo el
  muestreo. Arreglo probable: no re-muestrear si el mazo no ha cambiado desde la última
  copia, o avisar al copiar por segunda vez.
- **Quitar una exclusión no se puede por enlace**: el `excl` de un deep-link se suma al del
  cajón (`fromURL` en `app.js`). Si la IA se pasa de celosa, el usuario tiene que borrar el
  chip a mano. Documentado en `llms.txt`, sin arreglar.
- El bloque de afinar se cuela también en «copiar favoritos» y en el PDF dossier, donde no
  aporta. Se dejó así por no meter un flag en tres llamadas; si molesta, es trivial.
- `URLSearchParams` encodea las comas (`excl=roto%2Cpiezas`). Funciona, se lee peor.
- Sin medir: si la IA de verdad devuelve el enlace afinado y si converge en 2-3 vueltas o
  se queda dando tumbos. Eso solo lo dice el uso.

---

## Cerrado (para que nadie lo vuelva a levantar)

La auditoría del 09/08/2026 encontró 6 defectos y los 6 están arreglados, cada uno con su
check. El registro entero vivía en `MEJORAS.md`, borrado el 14/08/2026: git lo guarda, y un
fichero de defectos cerrados solo daba trabajo de mantener. Para leerlo:

```bash
git show 89db422:MEJORAS.md
```
