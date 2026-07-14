#!/usr/bin/env bash
# Despliega el código actual (main) al VPS y reinicia el servicio.
# Ejecutar desde la raíz del repo. Los datos del VPS (estados/, csv/) no se tocan.
set -e
rsync -az src rebusca.service oracle:~/rebusca/
# el unit instalado vive en /etc/systemd/system: reinstálalo por si cambió ExecStart
ssh oracle 'sudo cp ~/rebusca/rebusca.service /etc/systemd/system/rebusca.service \
  && sudo systemctl daemon-reload && sudo systemctl restart rebusca && systemctl is-active rebusca'
echo "desplegado -> https://rebusca.dibogomez.com"
