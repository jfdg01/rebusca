# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Rebusca — reglas del proyecto

Cazador de chollos de Wallapop, **app 100% estática y pública**: el dominio solo sirve
HTML/CSS/JS y **el browser de cada usuario scrapea Wallapop sobre su propia IP**. Desplegado
en https://rebusca.dibogomez.com (VPS `oracle` vía Cloudflare Tunnel). Solo **stdlib** de
Python — sin dependencias, sin uv/pip en el VPS. Sin backend de datos: **un usuario por
navegador** (sin perfiles); estado y búsquedas viven en `localStorage`.

Estructura: todo el código vive en `src/`.

Piezas:
- `src/scrape.js` — scraper **en el browser** (`window.Rebusca.scrape(...)` → texto CSV).
  Reproduce `wallapop.py` byte-a-byte. Es lo que se usa en prod.
- `src/wallapop.py` — mismo scraper en Python; ya **no se usa en prod**, se mantiene como
  CLI/referencia local (no se sirve, cero superficie).
- `src/servidor.py` — servidor stdlib **solo-estáticos**: sirve `index.html` (con `stamp_versions`)
  + `app.css`/`app.js`/`scrape.js`/imágenes, header `no-cache`. No escribe nada.
- `src/index.html` + `src/app.css` + `src/app.js` — frontend (markup / estilos / lógica; sin build).
- `deploy.sh` — rsync a `oracle` + reinicia el servicio.

## Comandos

Ejecutar desde la raíz del repo.

```bash
python3 src/servidor.py                       # levanta el server estático -> http://0.0.0.0:8000 (PORT env override)
python3 src/servidor.py demo                  # self-check del server (sin red)
node src/scrape.js demo                       # self-check del scraper del browser (sin red)
node src/test_app.js                          # smoke test de app.js (evalúa el módulo + boot, sin navegador)
node src/test_buttons.js                      # suite de botones: cada botón hace lo suyo (DOM falso sobre el boot de test_app.js)
node src/test_scrape.js                       # suite del scraper: paginación, OR, reintentos, abortar (sin red)
python3 src/test_servidor.py                  # suite del server: rutas, MIME, anti-traversal, stamp
python3 src/wallapop.py "deshumidificador"    # scrape CLI (referencia local) -> <query>.csv (Jaén por defecto)
python3 src/wallapop.py demo                  # self-check del scraper Python (sin red)
./deploy.sh                                   # rsync a oracle + systemctl restart rebusca
```

**Los siete checks de una, antes de cerrar sobre `main`.** Ninguno pide red. Que el
comando calle es la señal de que van bien: solo habla cuando algo sale con código != 0.
`test_scrape.js` y `test_servidor.py` se quedaron fuera de esta lista y estuvieron rotos
27 commits sin que nadie lo notara (ver `MEJORAS.md`, defecto 6).

```bash
./check.sh    # los siete, ~5s. Silencio = verde. Sale 1 si alguno falla.
```

Ya no depende de que alguien se acuerde: `.githooks/pre-commit` lo corre en cada commit.
Se activa una vez por clon, y `check.sh` avisa si te lo saltas:

```bash
git config core.hooksPath .githooks
```

Saltarlo en un commit suelto: `git commit --no-verify`.

**Límite conocido:** el hook mide el árbol de trabajo, no el índice. Con un `git add` de un
fichero roto y el fichero bueno de vuelta en el disco, el hook aprueba un `HEAD` en rojo. No
se arregla con `git stash --keep-index`: un stash dentro de un hook pierde trabajo cuando el
`pop` choca, y aquí nadie usa `git add -p`.

> **Servidor de pruebas: SIEMPRE el puerto 8123.** Para verificar cambios, comprueba
> si ya está abierto y reúsalo; si no, ábrelo tú y déjalo estar:
> ```bash
> curl -sf -o /dev/null http://127.0.0.1:8123/ || PORT=8123 python3 src/servidor.py &
> ```
> Sirve estáticos desde disco en cada petición, así que recoge tus ediciones de `app.css`/`app.js`/`scrape.js`
> sin reiniciar. **Ojo:** cambios en `servidor.py` sí requieren reiniciar el server de pruebas.
>
> **QA sin tocar datos reales:** ya no hay perfiles (un usuario por navegador). Para probar/capturar,
> el headless one-shot arranca con `localStorage` vacío, así que trastea ahí sin miedo. Si necesitas
> sembrar estado dummy, escribe directo las claves fijas `wp_estado`/`wp_searches`/`wp_lastcsv`.

Convención: la lógica no trivial deja un check runnable (`demo()` con `assert`, `python3 <fichero>.py demo`
o `node <fichero>.js demo`).

## Arquitectura (flujo de datos)

**El browser hace todo el trabajo; el server solo sirve ficheros.**
`api.wallapop.com/api/v3/search` devuelve `Access-Control-Allow-Origin: *` y permite el header
`X-DeviceOS` en preflight → cada browser scrapea directo sobre su IP (no hay ban compartido de
la IP del VPS, no hay cuentas, no hay endpoints de escritura). Es el ÚNICO endpoint que se pide:
no se vuelve a pedir el detalle de cada anuncio (ver `MEJORAS.md`).

- **Scrape:** botón Buscar → `window.Rebusca.scrape({keywords, since, titleOnly, lat, lon,
  onProgress, signal})` (`scrape.js`) → texto CSV → `loadCSV(text, name)` (`app.js`) lo pinta.
  `AbortController` para el botón parar; `onProgress` para el contador. Ubicación por defecto Jaén;
  `getLoc()` lee `wp_loc`, y el botón de ubicación lo escribe con la del navegador y re-scrapea.
- **Cache de resultados:** el texto CSV de cada búsqueda va a IndexedDB (`csv:<nombre>`), y el
  índice `{csv:{ts, ids}}` a `csvIndex`. Abrir una búsqueda guardada **sirve el cache**, no
  re-scrapea; «Repetir» es lo que refresca. El cache **no caduca**. Un resultado `parcial` —403,
  rama caída, botón parar, tope— no se cachea, y uno vacío tampoco. Un corte por no avanzar sí:
  es determinista (iteración 12).
- **Búsquedas guardadas:** `localStorage["wp_searches"]` = `[{csv, rows, mtime}]`
  (definiciones, no resultados). Sin cache, abrir una guardada re-scrapea con su `kw`/`since`.
- **Estado (un usuario/navegador, sin perfiles):** `localStorage["wp_estado"]` guarda el blob
  `{rejected, favorite, blockSel, excl, catExcl, catMode, lim, alias, stamp}`
  (`hydrateEstado`/`pushEstado`). También `wp_lastcsv`/`wp_lastseen`. Al cargar, una migración
  one-shot adopta el `wp_estado_<perfil>` del perfil activo del modelo viejo a estas claves fijas.
- **Precio con envío:** estimado, no exacto. `finalPrice` (`app.js`) suma 0,70 € + 5 % + el porte
  del tramo de 5 kg. El peso real pedía una petición por anuncio y salía mal a menudo.
- **Cache del móvil:** el HTML se sirve `no-cache`; `stamp_versions()` añade `?v=<mtime>` a
  `app.css`/`app.js`/`scrape.js` para bustear la cache de 4h de Cloudflare en cada deploy.

## Flujo de trabajo (obligatorio)

> **NUNCA trabajar sobre `main`. SIEMPRE crear rama ANTES de cualquier cambio.**
> Ni una sola edición, ni un solo comando que toque ficheros, antes de `git checkout -b`.

Ciclo obligatorio para **cualquier** cambio (feature/fix/lo que sea):

1. **Arrancar de `main` limpio.** Si `git status` no está limpio, **PARAR y avisar
   al usuario** — no se toca nada. Si está limpio: `git checkout main && git pull`.
2. **Rama propia:** `git checkout -b feat/<lo-que-sea>`. Nunca se trabaja sobre `main`.
3. **Cambios + commits iterativos** en la rama (los que hagan falta, o ninguno si no aplica).
4. **Cerrar sobre `main`:**
   - 1 commit → merge fast-forward.
   - varios commits → squash a uno solo.
   Luego push y borrar la rama. Empieza un ciclo nuevo desde el paso 1.

`main` es siempre desplegable y es lo que corre el VPS. Desplegar tras cerrar: `./deploy.sh`.

> **`fc` = "full cycle":** ejecuta el ciclo entero de una (rama → commits → cerrar sobre
> `main` → push + borrar rama → `./deploy.sh`), sin ir preguntando entre pasos.

## Cambios de diseño (obligatorio)

1. **Esperar feedback del usuario** antes de commitear o dar por terminado un cambio de diseño.
2. **Siempre sacar screenshot** para verificar. Setup del usuario: viewport 320×632px, zoom 100%, DPR 2.
   **Siempre enseñar el antes Y el después**: dos capturas (o una con las dos), la de `main` sin el
   cambio y la del cambio aplicado. Una captura sola no deja juzgar si el cambio mejora algo.
3. **Solo validación real:** el screenshot debe ser de la app de verdad corriendo (levanta el
   server en otro puerto y condúcelo hasta el estado real que se cambia). **Prohibido** un
   "harness fiel" o HTML aparte que reconstruya el markup: no ve la interacción con el resto
   del CSS (p. ej. el padding del `body`, la cabecera sticky, las tarjetas a sangre completa)
   y da falsos verdes.

El cómo (Chrome headless one-shot, forzar estado, revertir): skill `screenshot`
(`.claude/skills/screenshot/SKILL.md`).

## Estilo

- Ponytail/YAGNI: la solución más corta que funciona. stdlib y features nativas antes que código.
- Lógica no trivial deja un check runnable (`demo()` con `assert`, o un `test_*.py`).
