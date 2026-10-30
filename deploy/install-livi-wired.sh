#!/usr/bin/env bash
# Optional: install a PINNED real wired-USB Android Auto receiver without touching the head-unit kiosk.
# Run as the logged-in Pi desktop user, NOT via sudo. Requires Pi OS 64-bit Trixie.
set -euo pipefail
[[ "$(uname -m)" == aarch64 ]] || { echo 'LIVI arm64 AppImage requires 64-bit Raspberry Pi OS.' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as the Pi desktop user, without sudo.' >&2; exit 1; }
cd "$(dirname "$0")/.."
ROOT="$(pwd -P)"
DEST="$HOME/.local/opt/rpi-headunit"
mkdir -p "$DEST"
VERSION=9.3.0
URL="https://github.com/f-io/LIVI/releases/download/v$VERSION/LIVI-$VERSION-linux-arm64.AppImage"
SHA256=41a64b9a36f33d7365e4e9aa3fff7ee82d5d9f7459b010636fbf5726a8701c1e
TMP="$DEST/LIVI.AppImage.downloading"
trap 'rm -f "$TMP"' EXIT
printf 'Downloading pinned LIVI v%s (~219 MB)...\n' "$VERSION"
curl --fail --location --retry 3 --connect-timeout 20 --output "$TMP" "$URL"
echo "$SHA256  $TMP" | sha256sum -c -
chmod 0755 "$TMP"
mv -f "$TMP" "$DEST/LIVI.AppImage"
ENV="$ROOT/.env"
touch "$ENV"
upsert(){ local key="$1" value="$2"; if grep -q "^$key=" "$ENV";then sed -i "s|^$key=.*|$key=$value|" "$ENV";else printf '\n%s=%s\n' "$key" "$value" >>"$ENV";fi; }
upsert PROJECTION_COMMAND "$ROOT/deploy/livi-runtime.sh"
upsert PROJECTION_MODE ondemand
upsert ANDROID_AUTO_DEV_ENABLED 0
upsert HEADUNIT_ALLOW_RESIDENT_AA 0
printf '\nLIVI AppImage verified and installed at %s.\n' "$DEST/LIVI.AppImage"
printf 'The existing Chromium kiosk is unchanged. Finish LIVI helper/USB permissions on first run if prompted.\n'
printf 'Restart the headunit backend: sudo systemctl restart headunit.service\n'
