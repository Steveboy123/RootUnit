#!/usr/bin/env bash
set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pkill -u "$(id -u)" -f 'chromium.*127\.0\.0\.1:8787|chromium-browser.*127\.0\.0\.1:8787|chromium.*rpi-headunit-chromium' >/dev/null 2>&1 || true
pkill -f 'openauto|prodigy' >/dev/null 2>&1 || true
sleep 1
nohup "$SCRIPT_DIR/kiosk.sh" >/tmp/headunit-kiosk-rescue.log 2>&1 &
echo "Head-unit kiosk restart requested. Log: /tmp/headunit-kiosk-rescue.log"
