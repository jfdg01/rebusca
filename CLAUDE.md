# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Rebusca — reglas del proyecto

Cazador de chollos de Wallapop. Desplegado en https://rebusca.dibogomez.com
(VPS `oracle` vía Cloudflare Tunnel). Solo **stdlib** de Python — sin dependencias,
sin uv/pip en el VPS.

Estructura: el código vive en `src/`, los CSVs generados en `csv/` (gitignored).

Piezas:
- `src/wallapop.py` — scraper (API interna `v3/search`, `order_by=newest` + `time_filter`).
- `src/servidor.py` — servidor stdlib: sirve estáticos, lista CSVs, persiste perfiles, dispara el scraper.
- `src/index.html` + `src/app.css` + `src/app.js` — frontend (markup / estilos / lógica; sin build).
- `deploy.sh` — rsync a `oracle` + reinicia el servicio.

## Comandos

Ejecutar desde la raíz del repo (los paths de `src/servidor.py` asumen `csv/` y `estados/` como hermanos de `src/`).

```bash
python3 src/servidor.py                       # levanta el server -> http://0.0.0.0:8000 (PORT env override)
python3 src/servidor.py demo                  # self-check del server (sin red)
python3 src/wallapop.py "deshumidificador"    # scrape directo -> <query>.csv (Jaén por defecto)
python3 src/wallapop.py "cosa" --since dia --max-km 50 -n 100 -o out.csv
python3 src/wallapop.py demo                  # self-check del scraper (sin red)
./deploy.sh                                   # rsync a oracle + systemctl restart wallapop
```

Convención: la lógica no trivial deja un `demo()` con `assert`, invocable por `python3 <fichero>.py demo`.

## Arquitectura (flujo de datos)

Frontend (`app.js`) → `POST /scrape {keywords, since}` → el server ejecuta `wallapop.py`
como subproceso y escribe `csv/<slug>[--<since>].csv` → responde con el nombre del CSV
(con cache por `mtime`: no re-scrapea si el CSV tiene < 30 min, `TTL` en `servidor.py`).
El frontend luego pide `GET /<csv>` y lo pinta (el server enruta los `.csv` a `csv/`).

- **Estado por persona:** `estados/<perfil>.json` guarda `{seen, trash, fav, color}`.
  El frontend lo lee/escribe vía `GET|POST /estado?perfil=<nombre>`. `perfil_path()`
  sanea el nombre (anti path-traversal). `estados/` y `csv/` viven solo en el VPS
  (gitignored); `deploy.sh` no los toca.
- **Escritura incremental:** el scraper flushea cada página a disco; si crashea o lo bloquean
  (403 DataDome), el CSV conserva lo ya escrito. Ordena por km al final si no se filtró por distancia.
- **Cache del móvil:** el HTML se sirve `no-cache`; `stamp_versions()` añade `?v=<mtime>` a
  `app.css`/`app.js` para bustear la cache de 4h de Cloudflare en cada deploy.

## Flujo de trabajo (obligatorio)

- **Toda novedad va en su propia rama.** Nunca se trabaja directamente sobre `main`.
- **Cada rama parte de un `main` limpio y actualizado:** `git checkout main && git pull`
  antes de `git checkout -b feat/<lo-que-sea>`.
- **Al terminar algo, se mergea a `main`** (fast-forward), se pushea, y se borra la rama.
  `main` es siempre desplegable y es lo que corre el VPS.
- Desplegar tras mergear: `./deploy.sh`.

## Estilo

- Ponytail/YAGNI: la solución más corta que funciona. stdlib y features nativas antes que código.
- Lógica no trivial deja un check runnable (`demo()` con `assert`, o un `test_*.py`).
