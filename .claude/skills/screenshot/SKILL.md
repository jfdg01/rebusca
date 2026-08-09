---
name: screenshot
description: Cómo sacar el screenshot de Rebusca en este entorno (Chrome headless one-shot, DPR2 320×632, forzar estado editando disco). Úsalo al verificar cualquier cambio de diseño o cuando te pidan una captura de la app.
---

# Cómo sacar el screenshot (probado en este entorno)

Reglas obligatorias (esperar feedback, solo validación real, prohibido el harness fiel):
`CLAUDE.md`, sección `## Cambios de diseño`. Esto es solo el cómo.

## 0. Levanta el server de pruebas (siempre :8123)

```bash
curl -sf -o /dev/null http://127.0.0.1:8123/ || PORT=8123 python3 src/servidor.py &
```

Sirve de disco en cada request, así que recoge tus ediciones de `app.css`/`app.js`/`scrape.js`
sin reiniciar. Cambios en `servidor.py` sí piden reinicio.

## 1. Dispara la foto

**CDP interactivo NO funciona aquí:** un Chrome con `--remote-debugging-port` muere con
exit 144 (lo mata el sandbox), lo lances como lo lances (`&`, `setsid`, background del tool,
`dangerouslyDisableSandbox`). No pierdas tiempo con websockets/CDP. Lo que **sí** funciona es
el one-shot `--screenshot` (arranca, pinta, sale):

```bash
google-chrome --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=320,632 \
  --virtual-time-budget=3500 \
  --screenshot=/tmp/rebusca-shot.png "http://127.0.0.1:8123/"
```

`--force-device-scale-factor=2 --window-size=320,632` = el setup del usuario (DPR2, 320×632).
**Guarda el PNG fuera del repo** (`/tmp/…`). Un PNG suelto en el árbol ensucia el `git status`
del que depende la regla 1 de `## Cambios de diseño`.

## 2. Fuerza el estado (si hace falta)

El one-shot **no ejecuta clics ni JS**, así que para llegar al estado real se **edita temporalmente
el disco** y se **revierte tras la foto**. **Marca cada línea temporal con `TEMP screenshot`**
(`// TEMP screenshot` en JS, `<!-- TEMP screenshot -->` en HTML); sin la marca el paso 3 no
puede verificar nada:

- **Arranque directo:** ya no hay gate de perfil; el one-shot headless arranca con `localStorage`
  vacío y cae directo en la app (pantalla de bienvenida). Para fotografiar con estado, siembra las
  claves fijas al final de `app.js` (`localStorage.setItem("wp_estado", '...'); location.reload();
  // TEMP screenshot`) y borra el bloque tras la foto.
- **Abrir un `<details>`/popover:** añade el atributo `open` en el HTML
  (`<details open><!-- TEMP screenshot -->`).
- **Abrir una vista que necesita clic** (p. ej. gestión de búsquedas): añade al final de `app.js`
  un `setTimeout(() => openManager(), 1200); // TEMP screenshot` y sube `--virtual-time-budget`
  para que dé tiempo.

Sigue siendo validación real (mismo CSS/markup/flujo), solo se fuerza el estado que un tap daría.

## 3. Revierte SIEMPRE, antes de commitear

```bash
grep -rn 'TEMP screenshot' src/ ; git diff --stat src/
```

El `grep` no debe devolver nada. El `git diff` solo debe mostrar el cambio de diseño real.
Si queda una línea temporal, bórrala y repite.
