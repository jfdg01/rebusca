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

**Son ocho checks, no cuatro.** Los cuatro que no son un `demo()` viven en fichero aparte:
`src/test_app.js`, `src/test_buttons.js`, `src/test_scrape.js` y `src/test_servidor.py`.
Córrelos todos antes de cerrar sobre `main` (el bucle está en `CLAUDE.md`). Barato de
escribir también significa fácil de olvidar: `test_scrape.js` y `test_servidor.py` no
estaban en ninguna lista, y el primero estuvo 27 commits en rojo sin que nadie lo viera.
Ya están en las tres listas, y desde el 10/08/2026 hay runner: `./check.sh` los corre
todos en ~5 s, y `.githooks/pre-commit` lo dispara en cada commit. El detalle está en
`MEJORAS.md`, defecto 6. El total lo cuenta el propio `check.sh`: el "de 7" escrito a
mano se quedó viejo con el octavo check.

```bash
./check.sh                              # todos. Silencio = verde.
git config core.hooksPath .githooks     # una vez por clon; check.sh avisa si falta
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

**Cache-bust automático:** `stamped_mtimes()` descubre los estáticos que el HTML
referencia de verdad y `stamp_versions()` les pone `?v=<mtime>`; el HTML se sirve
`no-cache`. No hay lista que mantener: un `<script>` o un `<img>` nuevo se cachebustea
solo. `llms.txt` va aparte, porque su URL viaja en texto plano y la cachea el fetcher de
la IA. Cada deploy invalida la caché de 4h de Cloudflare sin tocar su config.

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

## 9. Un check que no distingue no es un check

Ninguna de estas reglas se inventó de antemano: cada una salió de un check que dio verde
sin medir nada, durante la tanda de robustez del 10/08/2026 (47 iteraciones, método en el
ya retirado `CICLO.md`). Se leen antes de escribir un check, no después. El commit de
cualquiera sale con `git log --grep="(it40)"`; la marca empieza en la it16.

**Antes de creerte un verde**

- Mueve la entrada y comprueba que la salida cambia (it20). Un check que falla por el
  motivo equivocado (it24), o que falla a ratos (it35), tampoco mide.
- Un caso no basta cuando la regla tiene varios lados: un cubo exclusivo pide un tercer id
  que solo esté en uno (it42), un tope pide además la aserción de que dejó pasar lo que
  tenía que dejar pasar (it44), y una simetría pide los dos lados (it36).
- Una aserción de una línea prueba la rama, no la frontera. La rama la mata cualquier
  valor; la frontera solo la mata el valor de al lado (it39).
- Datos de juguete miden juguetes: un dígito suelto ordena igual en texto que en número, y
  un precio de verdad no (it40, `test_buttons.js:443`).
- El escapado no se prueba con un caso, se prueba con un carácter por regla (it38,
  `test_buttons.js:408`).
- Una lista escrita a mano dentro de una prueba envejece en silencio (it31). Por eso la
  copia de seguridad recorre el almacén con `length`/`key` (`test_app.js:381`).

**Sobre el DOM falso de `test_app.js` (lo reutiliza `test_buttons.js`)**

- El arnés ya NO se inventa un id: `q()` lanza «el arnés se inventó #x» si el id no está en
  `index.html` ni en `app.js`, y `qa()` hace lo mismo con un contenedor sin hijos
  (`test_app.js:391-397` y `405-413`, it32). Esa guarda **es** el check: quien la quite le
  devuelve el verde a los ids mal escritos.
- Lo que sí se sigue inventando es una **propiedad que nadie sembró**: el proxy de `makeAny`
  responde truthy a cualquier nombre. Por eso `open` nace en `false` (`test_app.js:146`) y
  por eso se compara con `=== true` (it37).
- Un gancho que el código bajo prueba vuelve a llamar mide dos cosas y reporta una (it34).
- **Antes de acusar al arnés, léelo.** Dos iteraciones seguidas cerraron un abierto cuyo
  motivo era «el arnés no puede»: `makeContext` ya tenía `opts.limit` (it44,
  `test_app.js:357`) y el DOM falso ya vaciaba `children` (it45). La medida que te falta
  suele estar escrita en otro bloque del mismo fichero.

**Higiene**

- Un `clear()` antes de rellenar no se ve en la primera carga; pruébalo con la segunda
  (it42, `app.js:446`).
- Un filtro que solo tiene sentido en una vista necesita un check en la OTRA vista: el de
  la vista buena no distingue «filtra donde debe» de «filtra en todas partes» (it47,
  `app.js:957`).
- Lo que un bloque ensucia, el bloque lo limpia al salir. Un filtro que se queda puesto se
  lleva por delante los bloques de después (it46).
