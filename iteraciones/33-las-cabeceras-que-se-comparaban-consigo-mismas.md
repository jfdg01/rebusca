# Iteración 33 — las cabeceras que se comparaban consigo mismas

Zona: las cabeceras de seguridad de `src/servidor.py` y el bloque 2 de
`src/test_servidor.py`.

Es el primer punto de «Pendiente» de `MEJORAS.md`, abierto en la iteración 31.

## F1 — Investigar

El bloque 2 de `test_servidor.py` recorre `servidor.SEC_HEADERS` y comprueba que la
respuesta trae cada clave con su valor. El valor esperado sale del mismo diccionario que se
está probando, así que la comprobación es cierta por construcción: **diga lo que diga el
diccionario, la respuesta coincide**.

Diez mutantes sobre `SEC_HEADERS`, diez vivos:

```
CSP: script-src acepta cualquier origen    VIVE
CSP: script-src acepta inline              VIVE
CSP: connect-src pierde la API             VIVE
CSP: img-src pierde https                  VIVE
CSP: se puede empotrar en un iframe        VIVE
CSP: object-src suelto                     VIVE
CSP: base-uri suelto                       VIVE
CSP entera fuera                           VIVE
nosniff fuera                              VIVE
HSTS a cero                                VIVE
```

Hasta borrar la `Content-Security-Policy` entera sale en verde: si la clave no está en el
diccionario, el bucle no la busca.

Dos de esos diez no son solo de seguridad:

- **`connect-src` sin `https://api.wallapop.com`** deja la app muerta del todo. El browser
  de cada usuario scrapea contra esa API; sin la directiva, el navegador corta cada
  petición y no hay ni una búsqueda. Los siete checks, en verde.
- **`img-src` sin `https:`** deja todas las fotos en blanco, que es la mitad de para qué
  sirve la app.

El resto es la mitigación que documenta `src/servidor.py:19-22`: `app.js` mete datos
scrapeados de Wallapop por `innerHTML`, y `script-src 'self'` es lo que impide que un
`onerror=` inyectado en un título llegue a ejecutarse. Aflojarlo a `*` o meterle
`'unsafe-inline'` reabre esa puerta sin que nada chiste.

## F2 — El contrato

**Nada de funcionalidad se pierde.** Ni una cabecera cambia de valor. Lo que cambia es que
ahora hay algo que las mide.

1. **El bloque 2 se queda como está.** Sigue comprobando que la respuesta trae lo que dice
   el diccionario, para **toda** ruta (portada, estático, 404). Eso sí lo mide bien: lo que
   no mide es el contenido.
2. **Bloque 2b nuevo**, que lee la `Content-Security-Policy` **de la respuesta** y la parte
   en directivas. Los valores que clava están escritos como literales en la prueba, no
   sacados de `servidor.SEC_HEADERS`: es la única forma de que la prueba pueda discrepar de
   la producción.
3. **Qué se clava, y por qué cada cosa:**
   - `default-src 'self'` y `script-src 'self'`, exactos: ni `*` ni `'unsafe-inline'`.
   - `connect-src` incluye `https://api.wallapop.com` — sin esto no hay app.
   - `img-src` incluye `https:` — sin esto no hay fotos.
   - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`.
   - `X-Content-Type-Options: nosniff` como literal.
   - `Strict-Transport-Security` con un `max-age` de un año como mínimo.
4. **`style-src` se queda con su `'unsafe-inline'`** y la prueba lo dice en voz alta. No es
   un descuido: `app.js` escribe estilos en el atributo `style` de los elementos, y sin
   `'unsafe-inline'` en `style-src` el navegador los tira. Clavarlo evita que alguien lo
   «arregle» pensando que sobra.

## F3 — Implementar

`src/test_servidor.py`: un bloque nuevo. `src/servidor.py` no se toca.

## F4 — Probar

Los siete checks en verde, y los diez mutantes de F1 muertos.

## F4 — Resultado

Los siete checks en verde. Doce mutantes, doce muertos: los diez de F1 más `default-src`
suelto y `style-src` sin `'unsafe-inline'`, que la prueba nueva también clava.

## F5 — Review adversaria

**El bloque 2b lee una sola ruta.** Coge la `Content-Security-Policy` de la portada, no la
de cada estático. Está bien repartido: el bloque 2 comprueba que las cinco cabeceras salen
en las cuatro rutas, y el 2b comprueba qué dicen. Que las dos mitades vivan en bloques
distintos no es un descuido, pero conviene saber que ninguna de las dos, sola, cubre el
caso «la CSP correcta solo en `/`». Hoy no puede pasar: `end_headers` manda el mismo
diccionario para toda respuesta.

**Nada de esto prueba que la CSP funcione.** Aquí no hay navegador. Una directiva nueva y
demasiado estricta —`require-trusted-types-for`, por ejemplo— dejaría la app muerta en el
móvil con los siete checks en verde y el bloque 2b encantado. El único respaldo real es el
Chrome headless de las capturas, que carga la app de verdad contra el servidor de verdad.
Eso no se corre en cada commit, y decirlo es parte del trabajo.

**La prueba ahora obliga a decidir.** `script-src` y `style-src` se clavan como conjuntos
exactos, así que meter un `nonce-` o quitar el `'unsafe-inline'` de los estilos rompe el
check. Es lo que se busca: que aflojar la CSP cueste editar una prueba que explica por qué
estaba apretada, en vez de pasar sin que nadie mire.

**Lo que sigue sin medirse.** El arranque del server (`PORT` y el argumento posicional)
sigue abierto en `MEJORAS.md`, y las tres cabeceras que no son CSP —`Referrer-Policy`,
`Cross-Origin-Opener-Policy` y el `Cache-Control`— se comprueban por el bucle del bloque 2,
o sea que su **valor** sigue siendo tautológico. Se dejan así a conciencia: ninguna de las
tres cambia el comportamiento de la app ni tapa un agujero como el de `script-src`.
