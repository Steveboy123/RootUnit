#!/usr/bin/env bash
# Launch OpenAuto Prodigy for the RPI Head Unit projection provider.
# The upstream app service is intentionally disabled so the custom dashboard stays the shell;
# OpenAuto's network/system support services remain enabled.
set -euo pipefail

MARKER="$HOME/.openauto/headunit-receiver-path"
APP="${OPENAUTO_PRODIGY_APP:-}"
if [[ -z "$APP" && -s "$MARKER" ]]; then
  APP="$(head -n1 "$MARKER")"
fi
if [[ -z "$APP" ]]; then
  for candidate in \
    "$HOME/openauto-prodigy/build/src/openauto-prodigy" \
    "$HOME/openauto-prodigy/build/openauto-prodigy" \
    /usr/local/bin/openauto-prodigy \
    /usr/bin/openauto-prodigy; do
    if [[ -x "$candidate" ]]; then APP="$candidate"; break; fi
  done
fi
if [[ -z "$APP" ]] && command -v openauto-prodigy >/dev/null 2>&1; then
  APP="$(command -v openauto-prodigy)"
fi
[[ -n "$APP" && -x "$APP" ]] || {
  echo "OpenAuto Prodigy receiver binary was not found." >&2
  echo "Run the main installer again: sudo ./install.sh" >&2
  exit 127
}

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-wayland}"

pick_wayland() {
  if [[ -n "${WAYLAND_DISPLAY:-}" && -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
    return 0
  fi
  local sock
  sock="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -printf '%f\n' 2>/dev/null | sort | head -1 || true)"
  [[ -n "$sock" ]] || return 1
  export WAYLAND_DISPLAY="$sock"
}

# At boot the backend can start before labwc creates its Wayland socket. Stay resident and wait.
for _ in $(seq 1 600); do
  if pick_wayland; then
    exec "$APP" "$@"
  fi
  sleep 0.2
done

echo "Wayland session did not appear in $XDG_RUNTIME_DIR" >&2
exit 1
