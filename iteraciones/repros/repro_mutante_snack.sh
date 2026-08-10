#!/bin/sh
# repro_mutante_snack.sh — mutante vivo: borra la rama `diag.bloqueado` (y opcionalmente
# `diag.paginasTope`) del snack de runScrape en src/app.js y corre ./check.sh. Ningún check
# defiende el mensaje: check.sh sigue en verde con la rama borrada.
# Uso: ./repro_mutante_snack.sh          (muta diag.bloqueado)
#      ./repro_mutante_snack.sh paginas  (muta diag.paginasTope)
set -e
cd "$(dirname "$0")"
cp src/app.js /tmp/app.js.bak

if [ "$1" = "paginas" ]; then
  perl -0pi -e 's/: diag\.paginasTope\n        \? `Tope de \$\{diag\.paginas - 1\} páginas: resultado recortado, no se guarda\. Afina la búsqueda\.`\n        //' src/app.js
else
  perl -0pi -e 's/: diag\.bloqueado\n        \? "Wallapop ha bloqueado esta red: espera un rato o cámbiala\. Resultado parcial, no se guarda"\n        //' src/app.js
fi

echo "--- diff aplicado ---"
diff -u /tmp/app.js.bak src/app.js || true
echo "--- ./check.sh ---"
./check.sh; echo "EXIT=$?"

cp /tmp/app.js.bak src/app.js
echo "--- restaurado ---"
git diff --stat src/app.js
