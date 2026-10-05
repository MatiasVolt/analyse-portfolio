#!/usr/bin/env bash
# Installe l'API de The Yield Is Yours sur un serveur Ubuntu (Oracle Cloud) :
# Python + dépendances, service permanent, HTTPS automatique (Caddy), mise à jour du screener chaque nuit.
# Usage : bash deploy/setup.sh            (adresse gratuite api-<ip>.sslip.io)
#         bash deploy/setup.sh api.mondomaine.com
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_IP="$(curl -s https://ifconfig.me)"
DOMAIN="${1:-api-${PUBLIC_IP//./-}.sslip.io}"
echo "==> Dossier : $APP_DIR — adresse de l'API : https://$DOMAIN"

echo "==> Paquets système"
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip caddy netfilter-persistent

# Petite machine : 2 Go de mémoire d'appoint pour la reconstruction du screener
if [ "$(free -m | awk '/Mem:/ {print $2}')" -lt 3000 ] && [ ! -f /swapfile ]; then
  echo "==> Mémoire d'appoint (swap 2 Go)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Environnement Python"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

echo "==> Service permanent (redémarre tout seul en cas de plantage ou de reboot)"
sudo tee /etc/systemd/system/yield-api.service > /dev/null <<UNIT
[Unit]
Description=The Yield Is Yours - API
After=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
Environment=PYTHONIOENCODING=utf-8
ExecStart=$APP_DIR/.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now yield-api

echo "==> HTTPS automatique (certificat Let's Encrypt via Caddy)"
sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:8000
}
CADDY
sudo systemctl restart caddy

echo "==> Pare-feu de la machine : ouverture des ports 80 et 443"
# Les images Ubuntu d'Oracle bloquent tout sauf SSH par défaut
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $port -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 6 -p tcp --dport $port -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save

echo "==> Screener reconstruit chaque nuit à 5 h (heure du serveur)"
CRON="0 5 * * * cd $APP_DIR && PYTHONIOENCODING=utf-8 $APP_DIR/.venv/bin/python update_screener.py >> $HOME/screener.log 2>&1"
( crontab -l 2>/dev/null | grep -v update_screener.py ; echo "$CRON" ) | crontab -

sleep 3
echo
if curl -s -m 10 -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/screener/status | grep -q 200; then
  echo "OK : l'API tourne."
else
  echo "ATTENTION : l'API ne répond pas encore. Voir : sudo journalctl -u yield-api -n 50"
fi
echo
echo "Adresse à mettre dans Cloudflare (variable VITE_API_URL) :  https://$DOMAIN"
