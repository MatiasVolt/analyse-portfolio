#!/usr/bin/env bash
# Met le serveur à jour après un push sur GitHub : bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
"$APP_DIR/.venv/bin/pip" install -q -r requirements.txt
sudo systemctl restart yield-api
echo "API mise à jour et redémarrée."
