# Iteración 20 — el vendedor bloqueado y el veredicto de la IA

**Zona:** `src/app.js`, `enforceBlocks` (el bloqueo de vendedores) y los bordes de `fromURL`
(el enlace que trae el veredicto).
**Fecha:** 10 de agosto de 2026.

## F1 — Investigar

Dos barridos. El de `fromURL` sale casi limpio: es zona que ya trabajaron las iteraciones 4 y 11,
y ocho de diez mutantes mueren. El de `enforceBlocks` sale entero vivo: **nadie ha probado nunca
el bloqueo de vendedores**, y eso que la iteración 17 apoyó un check en él para explicar por qué
`restore` desbloquea.

```
fromURL: los ids repetidos no se funden              muere
fromURL: ?fav no asciende (solo ?keep)               muere
fromURL: since de la URL sin validar                 muere
fromURL: el resto del lote no se rechaza             muere
fromURL: el veredicto no se consume (2 usos)         muere
fromURL: el id sin cajón se archiva bajo ''          muere
fromURL: el cajón de origen del id se ignora         muere
maxp/maxd: un tope no numérico pasa                  muere
fromURL: el # del id no se quita                     VIVE
fromURL: los cubos dejan de ser exclusivos           VIVE
maxp/maxd: el tope malo se traga sin avisar          VIVE
fromURL: el enlace de ?q= no es de un solo uso       VIVE

enforceBlocks: sin columna vendedor no para          VIVE
enforceBlocks: no saca de favoritos                  VIVE
enforceBlocks: re-sella lo ya rechazado              VIVE
enforceBlocks: no persiste el cambio                 VIVE
```

### Qué pierde el usuario

**1. `enforceBlocks` no saca de favoritos** (`src/app.js:1401`). Bloquear a un vendedor manda sus
anuncios a la papelera. Si no los saca de favoritos, el mismo anuncio queda en los dos cubos a la
vez, y los cubos son exclusivos en todo lo demás de la app. A partir de ahí los dos contadores
mienten y el anuncio sale en las dos listas.

**2. `enforceBlocks` no persiste** (`src/app.js:1408`). El auto-rechazo se aplica en memoria y no
se escribe. Al recargar, los anuncios del vendedor bloqueado vuelven a estar sin ver, se
auto-rechazan otra vez, y otra vez no se guardan. El bloqueo parece que funciona hasta que
cierras la pestaña.

**3. `enforceBlocks` vuelve a sellar lo ya rechazado** (`src/app.js:1400`). La guarda
`if (!rejected.has(k))` es lo único que impide re-sellar en **cada render**. Sin ella,
"descartado hace 3 días" vuelve a ser "hace un momento" cada vez que se pinta la pantalla, y cada
render escribe en `localStorage` una lista que no ha cambiado.

**4. `fromURL` no quita el `#` del id** (`src/app.js:2478`). La IA devuelve los ids con almohadilla
—es como se pegan en el filtro de las listas, y el propio código lo dice—. Sin el recorte, ningún
id del enlace casa con nada: el veredicto no aplica nada y, con `?keep=`, el lote entero se va a
la papelera porque ninguno de los "conservados" se reconoce.

**5. `fromURL` deja de respetar cubos exclusivos** (`src/app.js:2502`). Un id que llega en `?no=`
y ya estaba en favoritos se queda en los dos.

**6. El tope malo del enlace se traga sin avisar** (`src/app.js:2552`). `?maxp=barato` no es un
número, así que se ignora. El comentario de esa línea cuenta que el fallo real era ignorarlo **en
silencio**: el usuario veía resultados por encima de su tope creyendo que el enlace lo aplicaba.
El aviso es la corrección, y no lo mide nadie.

### Los dos que se quedan fuera, con el motivo

**`enforceBlocks` sin columna `vendedor`.** Sin la guarda, `col(r, "vendedor")` devuelve
`undefined` para cada fila y el `if (!s) continue` de dentro la salta. El resultado observable es
el mismo. Es una salida temprana por coste, no por corrección: mutante equivalente.

**El enlace de un solo uso.** `history.replaceState` del arnés no mira el tercer argumento (la
URL), y `location.search` es un campo fijo del falso. No hay nada que observar sin cambiarle el
falso a los cientos de checks que ya lo usan. Queda apuntado: el observable que falta es que
`replaceState` limpie `location.search`.

## F2 — Contrato

1. **Bloquear a un vendedor manda sus anuncios a la papelera, los saca de favoritos, y se guarda.**
2. **Un anuncio ya rechazado de un vendedor bloqueado no se vuelve a sellar en cada render.**
3. **El `#` de los ids del enlace se ignora**: `?keep=#a1` conserva `a1`.
4. **Un id de `?no=` que estaba en favoritos sale de favoritos.**
5. **Un tope no numérico en el enlace se avisa**, no se traga.

No se toca `src/app.js`.

## F3 — Implementar

Sin cambios en producción. Checks en `src/test_buttons.js` (el bloqueo, que necesita CSV cargado)
y en `src/test_app.js` (los del enlace, que van por `opts.search`).

## F4 — Probar

Checks 68 y 69 en `src/test_buttons.js` (358 → 364 comprobaciones), y 9e, 9f y 10d en
`src/test_app.js`. Los seis mutantes que vivían ahora mueren:

```
enforceBlocks: no saca de favoritos        muere  FAIL: bloquear no sacó de favoritos: el anuncio está en los dos cubos, ["a1"]
enforceBlocks: re-sella lo ya rechazado    muere  FAIL: el bloqueo re-sella en cada render lo ya rechazado: la antigüedad del descarte se reinicia sola
enforceBlocks: no persiste el cambio       muere  FAIL: bloquear no rechazó a1
fromURL: el # del id no se quita           muere  FAIL: ?keep=#a1: no se quitó la almohadilla del id, favoritos salió {"ps4.csv":["#a1"]}
fromURL: los cubos dejan de ser exclusivos muere  FAIL: ?no=: el rechazado sigue en favoritos, está en los dos cubos: {"ps4.csv":["a1"]}
maxp/maxd: el tope malo se traga sin avisar muere FAIL: ?maxp=barato se ignoró sin avisar, el snack dijo:
```

`src/app.js` queda igual que en `main` (`git status --short src/app.js` vacío tras el barrido).
`./check.sh` en verde.

## F5 — Review adversaria

**El aviso del tope necesitó `timers: true`.** El falso `setTimeout` del arnés no ejecuta nada por
defecto, así que la primera versión del check 10d midió un snack vacío y falló en verde-falso: el
mutante y el original daban lo mismo. Con `timers: true` el aviso llega y el mutante muere. Es la
regla de siempre: el check que no distingue no es un check.

**El check 10d también mide que el tope bueno sobrevive al malo** (`?maxp=barato&maxd=30` deja
`{"kindle.csv":{"dias":30}}`). Un mutante que abortase el bucle entero al primer valor malo se
escaparía de un check que solo mirase el aviso.

**`?keep=#a1` viaja como `%23a1`.** En una URL de verdad la almohadilla sin escapar corta el
`search` y el id ni llega. El check usa la forma escapada, que es la que produce el enlace real.
