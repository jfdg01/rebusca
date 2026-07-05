# Rebusca — reglas del proyecto

Cazador de chollos de Wallapop. Desplegado en https://rebusca.dibogomez.com
(VPS `oracle` vía Cloudflare Tunnel). Solo **stdlib** de Python — sin dependencias,
sin uv/pip en el VPS.

Piezas:
- `wallapop.py` — scraper (API interna `v3/search`, `order_by=newest` + `time_filter`).
- `servidor.py` — servidor stdlib: sirve estáticos, lista CSVs, persiste perfiles, dispara el scraper.
- `ver.html` + `app.css` + `app.js` — frontend (markup / estilos / lógica; sin build).
- `deploy.sh` — rsync a `oracle` + reinicia el servicio.

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
