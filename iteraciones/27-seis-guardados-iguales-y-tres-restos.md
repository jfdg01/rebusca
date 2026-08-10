# Iteración 27 — seis guardados iguales y tres restos

**Zona:** `src/app.js` (los seis `saveX()`), `src/app.css` y `src/index.html`.
**Fecha:** 10 de agosto de 2026.
**Tipo:** simplificación. Segunda iteración que borra código de producción.

## F1 — Investigar

**1. Seis funciones que dicen lo mismo.** Entre `src/app.js:319` y `:366` hay seis guardados,
uno por mapa, y los seis tienen el mismo cuerpo:

```js
const saveBlockSel = () => { setLS("wp_blocksel", JSON.stringify([...blockSel])); pushEstado(); };
const saveExcl     = () => { setLS("wp_excl",     JSON.stringify(exclMap));       pushEstado(); };
const saveLimits   = () => { setLS("wp_lim",      JSON.stringify(limMap));        pushEstado(); };
const saveCatExcl  = () => { setLS("wp_catexcl",  JSON.stringify(catExclMap));    pushEstado(); };
const saveCatMode  = () => { setLS("wp_catmode",  JSON.stringify(catModeMap));    pushEstado(); };
const saveAlias    = () => { setLS("wp_alias",    JSON.stringify(aliasMap));      pushEstado(); };
```

Escritos a cuatro líneas cada uno son **24 líneas** que solo cambian en dos palabras. La única
diferencia real es `saveBlockSel`, que extiende un `Set` a lista antes de serializar.

**2. Tres restos que ya no señalan a nada.** Medidos con un barrido de clases del CSS contra el
HTML y el JS, y de ids del HTML contra el JS y el CSS:

| resto | dónde | por qué está muerto |
|---|---|---|
| `.li-head` | `src/app.css:567` | ninguna clase `li-head` se escribe en el JS; las diez `li-*` que sí existen son cadenas literales |
| `id="perfilOpts"` | `src/index.html:58` | resto de la época de los perfiles; el menú de ajustes se estila por `.opts` y se busca por otro camino |
| `id="swExcl"` | `src/index.html:378` | el CSS apunta a `.swipe-excl`, que está en el mismo elemento |

Los tres `#lim_precio` / `#lim_dias` / `#lim_km` salen en el mismo barrido y **no** son restos: se
buscan con `$("#lim_" + c)`. Un barrido de nombres no sabe leer una plantilla.

## F2 — Contrato

1. **Un solo molde de guardado.** `saver(clave, dame)` devuelve la función; los seis nombres se
   quedan igual, porque quien los llama no tiene que enterarse.
2. **Se borran los tres restos.** La app se ve exactamente igual: la clase no la lleva ningún
   elemento y los dos ids no los mira nadie.
3. **Nada cambia para el usuario.** Lo escrito en `localStorage` es lo mismo.
4. Las siete suites pasan sin tocar ninguna aserción.

## F3 — Implementar

**El molde**, `src/app.js:319`:

```js
const saver = (k, dame) => () => {
  setLS(k, JSON.stringify(dame()));
  pushEstado();
};
const saveBlockSel = saver("wp_blocksel", () => [...blockSel]);
const saveExcl = saver("wp_excl", () => exclMap);
…
```

Los seis nombres se quedan igual: ni una sola llamada cambia. `src/app.js`: 10 líneas nuevas, 22
borradas.

**Los tres restos:** `.li-head` sale de la lista de selectores de `src/app.css:567` (las otras dos
clases de la lista se quedan); `id="perfilOpts"` e `id="swExcl"` salen de sus etiquetas en
`src/index.html`. Los elementos y sus clases no se tocan.

**Un check nuevo** (ver F5), dentro del 76: vetar una palabra tiene que llegar al blob `wp_estado`.
De 414 a **415 comprobaciones**.

## F4 — Probar

Las siete suites en verde. Barrido sobre el molde:

```
saver: no escribe la clave espejo          muere
saver: blockSel se guarda sin extender     muere
saver: excl y catexcl cambian de clave     muere
saver: el alias no se guarda               muere
saver: no propaga el estado                muere   (tras el check nuevo; antes VIVE)
```

## F5 — Review adversaria

**1. El mismo hueco que la iteración 23, en la pieza de al lado.** Quitar `pushEstado()` del molde
dejaba las siete suites en verde. Es idéntico al hallazgo de la 23 sobre `saveBuckets()`: la
clave espejo se escribía y el blob `wp_estado` se quedaba viejo, así que el arranque siguiente
pisaba el ajuste. La 23 lo cerró para los cubos; aquí se cierra para los seis ajustes, que ahora
comparten un solo molde y por tanto un solo check. **Juntar las seis copias no solo borró 12
líneas: convirtió seis huecos posibles en uno solo, y ese ya tiene red.**

**2. El barrido de restos y sus falsos positivos.** El mismo barrido que encontró los tres restos
señaló `#lim_precio`, `#lim_dias` y `#lim_km`, que se buscan con `$("#lim_" + c)`. Tres de seis
candidatos eran falsos. Un barrido de nombres propone; quien decide es leer el código.

**3. La captura de pantalla: no la hay, y lo digo.** La regla del proyecto pide captura para un
cambio de diseño. Este no lo es, y el argumento se puede medir: la clase `li-head` no la escribe
nadie — las diez clases `li-*` del JS son cadenas literales y ninguna es esa —, y los dos ids
borrados no salen ni en el CSS ni en el JS, así que no había regla `#id` ni `getElementById` que
los mirara. Además las suites arrancan el `index.html` de verdad: un `$("#…")` que devolviera
`null` reventaría, y están en verde. Con todo, **es una comprobación estática, no una captura**.
Si el usuario prefiere la captura antes de desplegar, se hace.