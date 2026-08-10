#!/bin/sh
# repro_mutante_hook.sh — mutante vivo: revierte el `case` de check.sh (iteración 9, hallazgo 3)
# al `[ = ".githooks" ]` de antes. El código de salida sigue en 0 (check.sh "sobrevive" en el
# sentido estricto), pero reaparece el ruido "AVISO: ..." con el hook bien puesto: rompe la señal
# "silencio = verde" y ningún check automático lo detecta.
set -e
cd "$(dirname "$0")"
cp check.sh /tmp/check.sh.bak

perl -0pi -e 's/case "\$\(git config core\.hooksPath 2>\/dev\/null\)" in\n  \*\.githooks\) ;;\n  \*\) echo "AVISO: el hook no está activo -> git config core\.hooksPath \.githooks" ;;\nesac/[ "\$(git config core.hooksPath 2>\/dev\/null)" = ".githooks" ] ||\n  echo "AVISO: el hook no está activo -> git config core.hooksPath .githooks"/' check.sh

echo "--- diff aplicado ---"
diff -u /tmp/check.sh.bak check.sh || true
echo "--- ./check.sh (hooksPath actual: $(git config core.hooksPath)) ---"
./check.sh; echo "EXIT=$?"

cp /tmp/check.sh.bak check.sh
echo "--- restaurado ---"
git diff --stat check.sh
