#!/usr/bin/env bash
# Watchdog for dedicated labwc Wayland head-unit sessions.
# Launched ONLY from labwc's autostart, where WAYLAND_DISPLAY is exported.
# Automatically retries Chromium if the first-login compositor/browser race occurs.
set -u
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/rpi-headunit"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/kiosk-supervisor.log"
exec >>"$LOG" 2>&1
printf '\n[%s] supervisor started user=%s display=%s runtime=%s\n' "$(date -Is)" "$(id -un)" "${WAYLAND_DISPLAY:-missing}" "${XDG_RUNTIME_DIR:-missing}"

# Multiple labwc autostarts can race after crashes; only run one supervisor.
exec 8>"$LOG_DIR/kiosk-supervisor.lock"
if ! flock -n 8; then
  echo 'Another kiosk supervisor is already running.'
  exit 0
fi

# labwc exports WAYLAND_DISPLAY before executing autostart. On a busy Pi the
# socket and GPU can still be initializing; give them time before Chromium.
if [[ -z "${XDG_RUNTIME_DIR:-}" || -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo 'Wayland environment missing; cannot open browser in this session.'
  exit 1
fi
if [[ "$WAYLAND_DISPLAY" == /* ]]; then SOCKET="$WAYLAND_DISPLAY"; else SOCKET="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"; fi
ready=0
for _ in $(seq 1 40); do
  if [[ -S "$SOCKET" ]]; then ready=1; break; fi
  sleep 0.5
done
if (( ready == 0 )); then echo "Wayland socket not ready: $SOCKET"; exit 1; fi
# Give Chromium its own initial compositor-ready window, NOT a fixed 30s
# delay. The animated boot background, if installed, stays visible meanwhile.
sleep "${HEADUNIT_STARTUP_DELAY:-3}"

# Optional mascot wallpaper during the gap before Chromium creates its window.
# swaybg is used only when installed; it is not a boot requirement.
BG_PID=''
if command -v swaybg >/dev/null 2>&1; then
  BG="$PROJECT_DIR/deploy/boot/mascot.png"
  if [[ -r "$BG" ]]; then
    swaybg -m fit -c '#08040f' -i "$BG" >>"$LOG" 2>&1 8>&- & BG_PID=$!
  fi
fi
cleanup(){
  if [[ -n "$BG_PID" ]]; then kill "$BG_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

attempt=0
while :; do
  attempt=$((attempt+1))
  echo "[$(date -Is)] kiosk attempt $attempt"
  "$PROJECT_DIR/deploy/kiosk.sh" 8>&-
  status=$?
  echo "[$(date -Is)] Chromium exited with status $status, restarting"
  # Avoid restarting in a tight loop if graphics drivers are temporarily down.
  if (( attempt < 3 )); then sleep 3; elif (( attempt < 6 )); then sleep 6; else sleep 12; fi
done
