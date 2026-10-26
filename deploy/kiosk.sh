#!/bin/sh
# Reliable Raspberry Pi kiosk launcher.
# Do NOT probe the full UI over HTTP here: a slow/stuck static response must never
# prevent Chromium from starting and leave the user on the desktop.
set -u
# Start locally: show mascot animation even when Node is still starting.
# Never show Chromium connection-refused or the Raspberry Pi desktop.
URL="${HEADUNIT_URL:-file://$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/boot/loading.html}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/rpi-headunit"
LOG_FILE="$LOG_DIR/chromium.log"
mkdir -p "$LOG_DIR"

"$SCRIPT_DIR/fix-touch.sh" >/tmp/headunit-touch.log 2>&1 || true

# Health and UI readiness are polled from the branded boot page itself.
# A slow backend must not prevent the kiosk/browser from appearing.

# The UI build is local. Check the file directly instead of fetching '/' through
# the backend before Chromium starts.
if [ ! -s "$PROJECT_DIR/apps/ui/dist/index.html" ]; then
  {
    echo "[$(date -Is)] UI build missing: $PROJECT_DIR/apps/ui/dist/index.html"
    echo "Run: cd '$PROJECT_DIR' && npm run build"
  } >>"$LOG_FILE"
fi

BROWSER="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"
EXTENSION_DIR="$SCRIPT_DIR/chromium-touch-companion"

# Never kill an unrelated Chromium instance or steal the desktop profile.
# Chromium process-singleton handling on the normal desktop profile caused
# intermittent first-boot failures. The kiosk gets its own isolated profile.
PROFILE_DIR="${HEADUNIT_KIOSK_PROFILE:-$HOME/.config/rpi-headunit-kiosk-chromium}"
mkdir -p "$PROFILE_DIR"


PREFS="$PROFILE_DIR/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PREFS" 2>/dev/null || true

set -- \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE_DIR" \
  --start-fullscreen --disable-features=TranslateUI \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-pinch --overscroll-history-navigation=0 \
  --touch-events=enabled \
  --password-store=basic \
  --no-first-run --no-default-browser-check \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --ozone-platform=wayland \
  --enable-features=OverlayScrollbar \
  --enable-logging=stderr --log-level=0

if [ -f "$EXTENSION_DIR/manifest.json" ]; then
  set -- "$@" \
    --disable-extensions-except="$EXTENSION_DIR" \
    --load-extension="$EXTENSION_DIR"
fi

printf '[%s] launching %s %s display=%s profile=%s\n' "$(date -Is)" "$BROWSER" "$URL" "${WAYLAND_DISPLAY:-none}" "$PROFILE_DIR" >>"$LOG_FILE"
exec "$BROWSER" "$@" >>"$LOG_FILE" 2>&1
