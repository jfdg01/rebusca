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
python3 src/wallapop.py "deshumidificador"    # scrape CLI (referencia local) -> <query>.csv (Jaén por defecto)
python3 src/wallapop.py demo                  # self-check del scraper Python (sin red)
./deploy.sh                                   # rsync a oracle + systemctl restart rebusca
```

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

**El browser hace todo el trabajo; el server solo sirve ficheros.** `api.wallapop.com`
(`/v3/search`, `/v3/items/<id>`) devuelve `Access-Control-Allow-Origin: *` y permite el header
`X-DeviceOS` en preflight → cada browser scrapea directo sobre su IP (no hay ban compartido de
la IP del VPS, no hay cuentas, no hay endpoints de escritura).

- **Scrape:** botón Buscar → `window.Rebusca.scrape({keywords, since, titleOnly, lat, lon,
  onProgress, signal})` (`scrape.js`) → texto CSV → `loadCSV(text, name)` (`app.js`) lo pinta.
  `AbortController` para el botón parar; `onProgress` para el contador. Cada búsqueda re-scrapea
  (no hay CSV en disco). Ubicación por defecto Jaén (`getLoc()` lee `wp_loc`; selector de ciudad = pendiente).
- **Búsquedas guardadas:** `localStorage["wp_searches"]` = `[{csv, rows, mtime}]`
  (definiciones, no resultados). Abrir una guardada = re-scrape con su `kw`/`since`.
- **Estado (un usuario/navegador, sin perfiles):** `localStorage["wp_estado"]` guarda el blob
  `{trash, fav, star, blockSel, excl, catExcl, catMode, alias, stamp}`
  (`hydrateEstado`/`pushEstado`). También `wp_lastcsv`/`wp_lastseen`. Al cargar, una migración
  one-shot adopta el `wp_estado_<perfil>` del perfil activo del modelo viejo a estas claves fijas.
- **Pesos (precio con envío exacto):** `fetchPesos` hace el bucle en el browser contra
  `api.wallapop.com/v3/items/<id>` (`itemWeight`, saca `type_attributes.up_to_kg`, jitter, tope 200).
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
3. **Solo validación real:** el screenshot debe ser de la app de verdad corriendo (levanta el
   server en otro puerto y condúcelo hasta el estado real que se cambia). **Prohibido** un
   "harness fiel" o HTML aparte que reconstruya el markup: no ve la interacción con el resto
   del CSS (p. ej. el padding del `body`, la cabecera sticky, las tarjetas a sangre completa)
   y da falsos verdes.

### Cómo sacar el screenshot (probado en este entorno)

**CDP interactivo NO funciona aquí:** un Chrome con `--remote-debugging-port` muere con
exit 144 (lo mata el sandbox), lo lances como lo lances (`&`, `setsid`, background del tool,
`dangerouslyDisableSandbox`). No pierdas tiempo con websockets/CDP. Lo que **sí** funciona es
el one-shot `--screenshot` (arranca, pinta, sale):

```bash
google-chrome --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=320,632 \
  --virtual-time-budget=3500 \
  --screenshot=/ruta/salida.png "http://127.0.0.1:8123/"
```

`--force-device-scale-factor=2 --window-size=320,632` = el setup del usuario (DPR2, 320×632).
El one-shot **no ejecuta clics ni JS**, así que para llegar al estado real se **edita temporalmente
el disco** (el server de :8123 sirve de disco en cada request) y se **revierte tras la foto**:

- **Arranque directo:** ya no hay gate de perfil; el one-shot headless arranca con `localStorage`
  vacío y cae directo en la app (pantalla de bienvenida). Para fotografiar con estado, siembra las
  claves fijas al final de `app.js` (`localStorage.setItem("wp_estado", '...'); location.reload();`)
  y borra el bloque tras la foto.
- **Abrir un `<details>`/popover:** añade el atributo `open` en el HTML.
- **Abrir una vista que necesita clic** (p. ej. gestión de búsquedas): añade al final de `app.js`
  un `setTimeout(() => openManager(), 1200)` y sube `--virtual-time-budget` para que dé tiempo.
- **Revertir SIEMPRE:** deshaz los append/edits temporales. Comprueba con `grep` que no quedan
  restos (p. ej. `grep -n 'TEMP screenshot' src/app.js`) antes de commitear.

Sigue siendo validación real (mismo CSS/markup/flujo), solo se fuerza el estado que un tap daría.

## Estilo

- Ponytail/YAGNI: la solución más corta que funciona. stdlib y features nativas antes que código.
- Lógica no trivial deja un check runnable (`demo()` con `assert`, o un `test_*.py`).
