# Iteración 14 — el mapa que ya no describe el terreno

**Zona:** la sección «Arquitectura (flujo de datos)» de `CLAUDE.md:80-100`.

**De dónde sale:** F1 de esta iteración. Salió al buscar `fetchPesos` en el código para mirar la
zona del precio, y no encontrarlo en ninguna parte.

**El tema de la iteración:** `CLAUDE.md` se carga en cada petición y es lo que decide dónde mira
quien trabaja aquí. Cuatro de sus frases describen un código que ya no existe, y una de ellas niega
justo la pieza que la iteración 12 acaba de arreglar. Un mapa equivocado no es un defecto menor que
un `if` equivocado: manda a la iteración siguiente al sitio que no es.

Medido, con el árbol de `main` tal cual:

```
$ for s in fetchPesos itemWeight up_to_kg "v3/items"; do printf '%-12s ' "$s"; grep -rl "$s" src/ | tr '\n' ' '; echo; done
fetchPesos
itemWeight
up_to_kg
v3/items
```

Cuatro términos que `CLAUDE.md` nombra como el mecanismo del precio con envío. Ninguno aparece en
`src/`. El endpoint que sí se pide es uno solo:

```
$ grep -n "api.wallapop.com" src/scrape.js
5:  const API = "https://api.wallapop.com/api/v3/search";
```

## Los hallazgos

### 1 · alta — el mapa dice que no hay cache, y hay cache

`CLAUDE.md:89-90`: «Cada búsqueda re-scrapea (no hay CSV en disco)». Y `CLAUDE.md:92`: «Abrir una
guardada = re-scrape con su `kw`/`since`».

Es falso desde que existe `csvIndex`. `loadQuery` (`src/app.js:1623`) mira el cache primero y solo
scrapea si no lo hay. Es la línea que la iteración 12 midió: 210 páginas frente a 70 según se
cachee o no.

Esta frase es la peligrosa de las cuatro. Quien la lea antes de tocar `runScrape` no va a buscar el
cache, porque el mapa le dice que no existe.

**Arreglo:** una entrada propia para el cache, con lo que la tanda de robustez aprendió de él: qué
se cachea, qué no, y que no caduca.

### 2 · media — el mapa describe un mecanismo de pesos que se borró

`CLAUDE.md:97-98` nombra `fetchPesos`, `itemWeight`, `type_attributes.up_to_kg` y una petición por
anuncio contra `/v3/items/<id>`. No existe nada de eso. El precio con envío sale de `finalPrice`
(`src/app.js:497`), que estima el tramo de 5 kg para todos.

Peor: el mismo `MEJORAS.md` prohíbe volver a pedir el detalle de cada anuncio, así que el mapa
describe como arquitectura lo que las reglas prohíben.

**Arreglo:** contar lo que hace `finalPrice`, y decir en la cabecera que `/api/v3/search` es el
único endpoint que se pide.

### 3 · baja — el selector de ubicación ya no está pendiente

`CLAUDE.md:90` dice «selector de ciudad = pendiente». `src/app.js:2301-2340` tiene el botón, escribe
`wp_loc` con la ubicación del navegador, y re-scrapea para recalcular los km.

## Qué se deja fuera a propósito

- **El resto de `CLAUDE.md`.** Los comandos, el flujo de trabajo y las reglas de diseño se
  comprobaron uno a uno y describen lo que hay.
- Lo aplazado desde antes, que no se re-levanta: el techo de peticiones, el check que falta de
  «corta la RAMA, no el scrape», `render()` calculando `filteredRows()` dos veces en Rechazados, el
  guardián `typeof snack === "function"`, el hook midiendo el árbol de trabajo, el badge «sin ver»
  frío tras una restauración, la pérdida del Map de sesión sin `indexedDB`, los textos `csv:`
  huérfanos, y `cacheCsv` apuntando el índice antes de saber si el texto entró.

## Cómo se prueba (F4)

Un documento no tiene check runnable, y no se le va a inventar uno. Lo que sí se hace es medir cada
frase contra el árbol, que es lo de arriba: cuatro `grep` que salen vacíos y un `grep` que sale con
el endpoint de verdad. Los siete checks de `check.sh` tienen que seguir en verde, porque este cambio
no toca código.

## Lo que cambió al implementarlo

Nada del contrato. Los siete checks de `check.sh`, en verde y en silencio: el cambio es solo texto.
