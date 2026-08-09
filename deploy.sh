#!/usr/bin/env bash
# Despliega el código actual (main) al VPS y reinicia el servicio.
# Ejecutar desde la raíz del repo. Los datos del VPS (estados/, csv/) no se tocan.
set -e
rsync -az src rebusca.service oracle:~/rebusca/
# el unit instalado vive en /etc/systemd/system: reinstálalo por si cambió ExecStart
ssh oracle 'sudo cp ~/rebusca/rebusca.service /etc/systemd/system/rebusca.service \
  && sudo systemctl daemon-reload && sudo systemctl restart rebusca && systemctl is-active rebusca'
# `is-active` da verde con el proceso arriba aunque la portada responda 404 o 500: un deploy
# roto se daba por bueno y el fallo solo salía al abrir la web. La única prueba es pedirla.
# `curl -sf` sale con código != 0 en cualquier HTTP >= 400, y `set -e` corta aquí.
ssh oracle 'sleep 1; curl -sf -o /dev/null http://127.0.0.1:8000/' \
  || { echo "FALLO: el servicio arranca pero la portada no responde 200"; exit 1; }
echo "desplegado -> https://rebusca.dibogomez.com"
