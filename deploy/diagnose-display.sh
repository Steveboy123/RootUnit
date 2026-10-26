#!/usr/bin/env bash
set -u
run_curl() { curl --connect-timeout 1 --max-time 3 "$@"; }
printf '%s\n' '=== backend ==='
run_curl -fsS http://127.0.0.1:8787/api/health || echo '[FAIL] backend health request failed/timed out'
printf '\n%s\n' '=== server ui health ==='
run_curl -fsS http://127.0.0.1:8787/api/ui-health || echo '[FAIL] server cannot see UI build'
printf '\n%s\n' '=== local ui build ==='
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [[ -s "$PROJECT_DIR/apps/ui/dist/index.html" ]]; then
  ls -lh "$PROJECT_DIR/apps/ui/dist/index.html"
  grep -o '<title>[^<]*</title>' "$PROJECT_DIR/apps/ui/dist/index.html" | head -1 || true
else
  echo "[FAIL] missing $PROJECT_DIR/apps/ui/dist/index.html"
fi
printf '\n%s\n' '=== ui http (3 second timeout) ==='
TMP=$(mktemp)
CODE=$(run_curl -sS -o "$TMP" -w '%{http_code}' http://127.0.0.1:8787/ || true)
printf 'HTTP %s\n' "${CODE:-timeout/error}"
head -c 500 "$TMP" 2>/dev/null || true
rm -f "$TMP"
printf '\n\n%s\n' '=== chromium ==='
pgrep -a chromium || pgrep -a chromium-browser || echo '[none]'
printf '\n%s\n' '=== wayland windows ==='
wlrctl toplevel list 2>/dev/null || echo '[wlrctl unavailable/no windows]'
printf '\n%s\n' '=== labwc autostart ==='
sed -n '1,160p' "$HOME/.config/labwc/autostart" 2>/dev/null || true
printf '\n%s\n' '=== chromium log ==='
tail -n 120 "${XDG_STATE_HOME:-$HOME/.local/state}/rpi-headunit/chromium.log" 2>/dev/null || echo '[no chromium log yet]'
printf '\n%s\n' '=== headunit service ==='
systemctl --no-pager --full status headunit 2>/dev/null | sed -n '1,35p' || true
