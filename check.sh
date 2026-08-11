#!/bin/sh
# Los checks de CLAUDE.md, de una. Ninguno pide red.
# Silencio = todos en verde. Sale 1 si alguno falla.
cd "$(dirname "$0")" || exit 1

# El hook se activa una vez por clon, y olvidarlo es justo el fallo que cierra check.sh.
# `case`, no `=`: git guarda la ruta tal como se la dieron, y la absoluta es igual de válida.
# Comparar con el literal hacía saltar el aviso con el hook puesto y correcto, y un aviso que sale
# con todo bien rompe la señal de esta tanda entera: "silencio = verde".
case "$(git config core.hooksPath 2>/dev/null)" in
  *.githooks) ;;
  *) echo "AVISO: el hook no está activo -> git config core.hooksPath .githooks" ;;
esac

fallos=0
total=0
# El total se cuenta solo: el "de 7" a mano se quedó viejo en cuanto entró el octavo check.
for c in "python3 src/servidor.py demo" "python3 src/test_servidor.py" "python3 src/wallapop.py demo" \
         "python3 src/historial.py demo" \
         "node src/scrape.js demo" "node src/test_app.js" "node src/test_buttons.js" "node src/test_scrape.js"; do
  total=$((total + 1))
  $c >/dev/null 2>&1 || { echo "FALLA: $c"; fallos=$((fallos + 1)); }
done

[ "$fallos" -eq 0 ] || echo "$fallos de $total en rojo"
exit $((fallos > 0))
