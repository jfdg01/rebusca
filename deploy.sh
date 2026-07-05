#!/usr/bin/env bash
# Despliega el código actual (main) al VPS y reinicia el servicio.
# Ejecutar desde la raíz del repo. Los datos del VPS (estados/, csv/) no se tocan.
set -e
rsync -az src wallapop.service oracle:~/wallapop-scraper/
# el unit instalado vive en /etc/systemd/system: reinstálalo por si cambió ExecStart
ssh oracle 'sudo cp ~/wallapop-scraper/wallapop.service /etc/systemd/system/wallapop.service \
  && sudo systemctl daemon-reload && sudo systemctl restart wallapop && systemctl is-active wallapop'
echo "desplegado -> https://rebusca.dibogomez.com"
