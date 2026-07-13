# Metodología de desarrollo

Prácticas que hacen que trabajar en este repo sea rápido y sin fricción, con su
*porqué* y los comandos exactos. Cada una elimina un paso, una espera o un error.

## Principio de fondo: Ponytail / YAGNI

La solución más corta que funciona. Stdlib y features nativas antes que escribir
código; código antes que dependencias. Todo lo de abajo es este principio
aplicado a la infraestructura: menos piezas = menos que mantener, romper y
explicar a las 3am.

---

## 1. Cero dependencias, cero build

- Backend: **solo stdlib** (`http.server`) — sirve estáticos y nada más.
- Frontend: **HTML + CSS + JS vanilla**, sin bundler. El scraper (`scrape.js`)
  corre en el propio navegador.

Sin `pip install`, sin `node_modules`, sin `npm run build` entre editar y ver.
El VPS corre lo mismo que tu disco. Nada que actualizar, nada que se rompa por
una versión.

## 2. El servidor sirve de disco en cada request

`servidor.py` lee `app.css`/`app.js`/`index.html` del disco en **cada** petición:
editas → recargas el navegador → lo ves. Sin reinicio ni watch.

```bash
python3 src/servidor.py            # server -> http://0.0.0.0:8000 (PORT env override)
python3 src/servidor.py demo       # self-check sin red
```

> **Servidor de pruebas: SIEMPRE el puerto 8123.** Reúsalo si ya está abierto;
> si no, ábrelo y déjalo. **NUNCA matar ningún servidor** — el usuario tiene el
> suyo (normalmente :8000) en uso.
> ```bash
> curl -sf -o /dev/null http://127.0.0.1:8123/ || PORT=8123 python3 src/servidor.py &
> ```

## 3. Un `demo()` por fichero como test

Convención: la lógica no trivial deja un `demo()` con `assert`, invocable por
`python3 <fichero>.py demo` (ver `wallapop.py`, `servidor.py`). El "test suite"
es un `if __name__ == "__main__"`: sin pytest, sin fixtures, corre sin red.
Barato de escribir → se escribe de verdad.

```bash
python3 src/wallapop.py "deshumidificador"                 # scrape directo -> <query>.csv
python3 src/wallapop.py "cosa" --since dia --max-km 50 -n 100 -o out.csv
python3 src/wallapop.py demo                                # self-check sin red
```

## 4. QA sin tocar datos reales (un usuario por navegador)

Ya no hay perfiles ni estado en el servidor: **cada navegador es un usuario** y su
estado vive en `localStorage` (`wp_estado`, `wp_searches`, …). Para trastear sin
miedo, usa un perfil de navegador limpio o el modo incógnito: buscas, marcas y
descartas contra tu propio `localStorage`, sin nada compartido que romper. El
headless one-shot ya arranca con `localStorage` vacío; para sembrar estado dummy,
escribe directo las claves fijas (`wp_estado`/`wp_searches`/`wp_lastcsv`).

## 5. Screenshot de la app real, no de un harness

Se valida el diseño con captura de la **app corriendo de verdad** (headless
Chrome one-shot), nunca de un HTML reconstruido: un markup "fiel" da falsos
verdes porque no ve la interacción con el resto del CSS (padding del body,
cabecera sticky, tarjetas a sangre).

Setup a reproducir: **viewport 320×632, DPR 2, zoom 100%**.

```bash
google-chrome --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=320,632 \
  --virtual-time-budget=3500 \
  --screenshot=/ruta/salida.png "http://127.0.0.1:8123/"
```

CDP interactivo NO funciona aquí (el sandbox mata el Chrome con
`--remote-debugging-port`). El one-shot no ejecuta clics ni JS, así que para
llegar a un estado que pide un tap se **edita el disco temporalmente** (el server
de :8123 sirve de disco) y se **revierte tras la foto**:

- **Arranque directo:** ya no hay gate de perfil; el one-shot headless arranca con
  `localStorage` vacío y cae directo en la app. Para fotografiar con estado, siembra
  las claves fijas al final de `app.js`
  (`localStorage.setItem("wp_estado", '...'); location.reload();`) y borra el bloque
  tras la foto.
- **Abrir un `<details>`/popover:** añade `open` en el HTML.
- **Abrir una vista que necesita clic:** añade `setTimeout(() => openManager(), 1200)`
  al final de `app.js` y sube `--virtual-time-budget`.
- **Revertir SIEMPRE** y comprobar con `grep` que no quedan restos antes de commitear.

Sigue siendo validación real (mismo CSS/markup/flujo); solo se fuerza el estado.

## 6. Deploy en un comando

```bash
./deploy.sh    # rsync de src/ al VPS + reinstala el unit + systemctl restart
```

El servidor no guarda datos (el estado vive en el `localStorage` de cada navegador),
así que no hay nada en el VPS que un deploy pueda pisar. Como no hay build, lo que
subes es lo que probaste.

**Cache-bust automático:** `stamp_versions()` añade `?v=<mtime>` a `app.css`/
`app.js` y el HTML se sirve `no-cache`. Cada deploy invalida la caché de 4h de
Cloudflare sin tocar su config ni acordarte de nada.

## 7. Resiliencia: el fallo degrada, no destruye

El scraper corre en el browser (`scrape.js`) y acumula filas en memoria. Si Wallapop
suelta un `403` (DataDome), **corta esa rama y devuelve lo ya recogido** en vez de
fallar. Reintentos con backoff exponencial ante `429`/`5xx` (respeta `Retry-After`).
El botón de parar aborta vía `AbortController` y te quedas con el CSV parcial. Nada
de esto toca el disco del servidor: no hay estado que corromper.

## 8. Ciclo de git "full cycle" (`fc`)

Flujo obligatorio para **cualquier** cambio. `main` es siempre desplegable y es
lo que corre el VPS.

1. Arrancar de `main` limpio (`git status` sucio → **PARAR y avisar**; limpio →
   `git checkout main && git pull`).
2. Rama propia: `git checkout -b feat/<lo-que-sea>`. **Nunca se trabaja sobre `main`.**
3. Commits iterativos en la rama.
4. Cerrar sobre `main`: 1 commit → fast-forward; varios → squash a uno. Push,
   borrar la rama, `./deploy.sh`.

`fc` = ejecuta el ciclo entero de una, sin preguntar entre pasos.

**Cambios de diseño:** se enseña screenshot y se **espera aprobación** del
usuario antes de commitear/mergear.
