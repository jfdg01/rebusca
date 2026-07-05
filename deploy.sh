#!/usr/bin/env bash
# Despliega el código actual (main) al VPS y reinicia el servicio.
# Ejecutar desde la raíz del repo. Los datos del VPS (estados/, *.csv) no se tocan.
set -e
rsync -az wallapop.py servidor.py ver.html wallapop.service oracle:~/wallapop-scraper/
ssh oracle 'sudo systemctl restart wallapop && systemctl is-active wallapop'
echo "desplegado -> https://rebusca.dibogomez.com"
