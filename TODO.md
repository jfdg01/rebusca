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

Es la señal más fuerte que hoy no se ve. Un anuncio ya juzgado a 400 € que baja a 330 €
vale más que cualquier anuncio nuevo, y ahora mismo pasa desapercibido porque cada
búsqueda empieza de cero.

**¿Lo da la API? No.** Volcada y mirada entera el 2026-08-11: 200 anuncios de 5 queries,
48 claves distintas por item, **ninguna de precio anterior ni de descuento**. `price` es
`{amount, currency}` y se acabó. El distintivo de "ha bajado de precio" de la app sale de
otro sitio, y pedir el detalle de cada anuncio es justo lo que este scraper no hace (ver
`MEJORAS.md`). Así que el precio anterior lo ponemos nosotros. No es caro.

De paso, del mismo volcado: `modified_at` (epoch ms) es la única clave viva que el scraper
no lee, y viene en el 100 % de los anuncios. **No sirve de atajo:** sale distinta de
`created_at` hasta en anuncios de 15 segundos, así que no marca "cambió el precio".
Comparar el importe guardado es exacto y más barato.

**Calculándolo nosotros:** un fichero JSON de la vigilancia (ver 4) con
`id → {visto_primero, precios: [[fecha, importe]], veredicto, nota}`. Cada pasada
compara el precio de hoy con el último guardado; si cambió, se apunta y el anuncio
vuelve a la cola de la IA. Los ids son estables entre pasadas (`it.id` es el de
Wallapop, no uno nuestro), así que el cruce es una comparación de claves, sin heurística
de duplicados.

---

## 3. Desapariciones = precios de venta

Un id que deja de aparecer se vendió o se retiró. Vale para dos cosas: sacarlo del
ranking, y **guardar a qué precio desapareció**. En unas semanas eso es un histórico de
precios de verdad para "¿cuánto vale un ThinkPad E14 Gen 4?", que hoy es la parte más
floja de todo el sistema: la IA lo estima de memoria y no puede citar nada comprobable.
Justo lo que las reglas del regateo le exigen y no le pueden dar.

Necesita semanas de pasadas antes de servir de algo. Motivo de más para empezar el
registro pronto aunque el ranking tarde.

Cuidado con un falso positivo: desaparecer del lote también puede ser que la búsqueda
cambió o que el anuncio se cayó de las 1500 filas del tope. Solo contar como
desaparición si la misma query lo trajo ayer y hoy no.

---

## 4. Vigilancia diaria (dos pasadas al día)

**Dónde corre: en la máquina de uno, NO en el VPS.** Toda la arquitectura existe para
que cada navegador scrapee sobre su propia IP; un cron nocturno desde el VPS devuelve
el riesgo de ban compartido para todos los que usan el dominio. Un `systemd` timer con
`Persistent=true` cubre el portátil apagado a las 6.

**Dos pasadas al día** (mañana y tarde) parecen suficientes para pillar el chollo
relámpago sin que la cosa se vuelva un scraper agresivo: son dos búsquedas al día, menos
tráfico que abrir la web un rato.

**La forma: podar y luego juzgar.**

1. **Poda determinista, gratis.** Teléfono o WhatsApp en la descripción, "para piezas",
   palabras de accesorio (batería, funda, dock, caja, trackpad), duplicados de mismo
   vendedor y mismo título, precios absurdos. En las ocho rondas esto se llevaba ~18 %
   del lote, y es una expresión regular, no tokens.
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
un proceso de fondo no ha mandado ningún lote (`app.js:2602`).

**Memoria: un JSON del script, no la memoria del agente.** Son miles de filas
estructuradas; la memoria del agente es para hechos sueltos en prosa.

**Orden de ataque:** el registro y la poda determinista primero. Sirven solos, sin que
haya ningún modelo de por medio, y son la mitad del valor.
