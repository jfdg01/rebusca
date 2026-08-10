# Iteración 26 — el viaje de ida y vuelta del lote

**Zona:** `src/app.js`, `ficha()` y el `?keep=` de `fromURL()`, atados por el formato `[#id]`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** red que falta. Es el hueco que dejó anotado la review adversaria de la iteración 25.

## F1 — Investigar

Las dos mitades del flujo de la IA están probadas por separado. La ida, desde la iteración 25: el
lote copiado es el que se anota. La vuelta, desde la iteración 20: `?keep=<ids>` conserva unos y
descarta el resto del lote.

**Lo que nadie mide es el contrato que las une.** `ficha()` escribe cada anuncio así,
`src/app.js:2913`:

```js
`${i + 1}. [#${col(r, "id")}] ${stripEmoji(col(r, "titulo"))} — ${pricePair(r)}`
```

Y `LINK_RULES` le dice a la IA, `src/app.js:2881`: *"Los ids son los [#...] de las fichas de
abajo, copiados enteros y literales"*. `fromURL()` los recibe y les quita la almohadilla,
`src/app.js:2475`.

O sea: **el formato `[#id]` es una API entre la app y la IA**, y las dos puntas viven en
funciones distintas, a 400 líneas una de otra. Cambia el formato de la ficha y la app sigue en
verde: el texto se copia, el lote se anota, y el veredicto que vuelve no encuentra ningún id. El
usuario pulsa el enlace de la IA y no pasa nada, o peor, se descarta el lote entero por no
reconocer a ninguno de los conservados.

Segundo hueco, del mismo sitio: `promptIntro(n, total)` avisa a la IA cuando solo va un tope del
mazo (`de ${total} sin clasificar`). Sin ese aviso, la IA cree que ha visto todo y cierra el
veredicto sobre 60 de 200 anuncios.

## F2 — Contrato

1. **Los ids que salen en las fichas son los del lote anotado**, leídos del texto con la misma
   regla que el prompt le da a la IA.
2. **Ese texto, devuelto como `?keep=<id>`, clasifica de verdad:** el conservado a favoritos, el
   resto del lote a la papelera.
3. **Con más filas que el tope, el prompt dice cuántas de cuántas van.**
4. Ninguna funcionalidad cambia. Solo se añaden comprobaciones.

## F3 — Implementar

Cero líneas de producción. En `src/test_buttons.js`:

- **Check 5bis, nuevo**: el viaje entero. Copia el mazo, saca los ids del texto copiado con
  `/^\d+\. \[#([^\]]+)\]/gm`, los compara con `wp_aisent`, y devuelve el primero por
  `location.search = "?keep=" + id` + `fromURL()`.
- **Check 5b**, una aserción más: con 70 filas el prompt dice `60 anuncios de 70 sin clasificar`.

De 409 a **414 comprobaciones**.

## F4 — Probar

Las siete suites en verde. Barrido sobre las dos puntas del contrato:

```
ficha: el id sale sin la almohadilla     muere  FAIL: las fichas no llevan los ids del mazo en [#id]:
ficha: manda la url en vez del id        muere  FAIL: … : https://w/a1,https://w/a2,…
keep: no quita la almohadilla del id     muere
keep: el resto del lote no se descarta   muere  FAIL: el resto del lote no se descartó:
prompt: no avisa del tope                muere
ficha: numera desde 0                    VIVE
```

## F5 — Review adversaria

**1. El mutante que vive, y por qué se queda vivo.** Numerar las fichas desde 0 no tiene ningún
observable en la app: el número solo lo lee la IA en el chat, y ni el `?keep=` ni el lote anotado
dependen de él. Es un mutante **equivalente para la app**. Escribir un check sobre él sería medir
el gusto del autor, no el contrato.

**2. La regla del test tuvo que aprender a distinguir.** El primer borrador sacaba los ids con
`/\[#([^\]]+)\]/g` y falló: el propio prompt contiene el literal `[#...]` cuando le explica a la
IA de dónde sacar los ids, así que la primera "ficha" que encontraba era `...`. Anclada a
`^\d+\. `, que es la forma de verdad de una ficha. **El fallo fue útil**: dice que un texto que
habla de su propio formato necesita una regla de lectura más estrecha que "busca corchetes", y eso
vale igual para la IA que lo recibe.

**3. Lo que este check no prueba.** Que la IA obedezca. El check mide que **si** la IA copia los
ids literales como se le pide, el enlace funciona. No puede medir que una IA de verdad no acorte
un id o se invente uno; para eso está el filtrado por `rowCache`, que la iteración 20 ya cubre
(un id desconocido se cuenta como huérfano y no clasifica nada).
