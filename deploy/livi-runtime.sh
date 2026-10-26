#!/usr/bin/env bash
# Native wired Android Auto receiver, launched on demand by the existing Projection provider.
set -euo pipefail
APP="${LIVI_APPIMAGE:-$HOME/.local/opt/rpi-headunit/LIVI.AppImage}"
if [[ ! -x "$APP" ]]; then
  echo "LIVI AppImage not found. Run ./deploy/install-livi-wired.sh first." >&2
  exit 127
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
# Start after labwc/Wayland appears, just like the existing OpenAuto runtime.
for _ in $(seq 1 80); do
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    if [[ -S "$sock" ]]; then
      export WAYLAND_DISPLAY="${sock##*/}"
      exec "$APP" "$@"
    fi
  done
  sleep .25
done
echo "Wayland unavailable; start the Pi desktop session first." >&2
exit 1
