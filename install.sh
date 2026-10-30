#!/usr/bin/env bash
# One-command Raspberry Pi 5 installer for RPI Head Unit.
# Run from the project directory:
#   sudo ./install.sh
#
# Installs Node.js 22+, project dependencies, builds the app, installs the
# headunit systemd service, configures the Chromium kiosk autostart, with
# optional wired Android Auto receiver (LIVI installed separately).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/rpi-head-unit-install.log"

log() { printf '\n[head-unit] %s\n' "$*"; }
die() { echo "[head-unit] ERROR: $*" >&2; exit 1; }

exec > >(tee -a "$LOG_FILE") 2>&1

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This installer must be run on Raspberry Pi OS/Linux."
fi

MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
if [[ "$MODEL" != *"Raspberry Pi 5"* && "$MODEL" != *"Raspberry Pi Compute Module 5"* ]]; then
  echo "[head-unit] WARNING: expected Raspberry Pi 5/CM5, detected: ${MODEL:-unknown}"
fi

ARCH="$(dpkg --print-architecture 2>/dev/null || true)"
[[ "$ARCH" == "arm64" ]] || echo "[head-unit] WARNING: this is not arm64 (${ARCH:-unknown})."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "raspbian" && "${ID_LIKE:-}" != *debian* && "${ID:-}" != "debian" ]]; then
    echo "[head-unit] WARNING: expected Raspberry Pi OS/Debian, detected ${PRETTY_NAME:-unknown OS}"
  fi
fi

# Determine the real desktop user. Running `sudo ./install.sh` is recommended.
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  TARGET_USER="$SUDO_USER"
else
  TARGET_USER="$(id -un)"
fi
[[ "$TARGET_USER" != "root" ]] || die "Run as your normal Pi desktop user with sudo, e.g. sudo ./install.sh"

TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
TARGET_UID="$(id -u "$TARGET_USER")"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
[[ -n "$TARGET_HOME" && -d "$TARGET_HOME" ]] || die "Could not determine home directory for $TARGET_USER"

# Real Pi hardware access: audio/video/render/input, Bluetooth and serial OBD.
EXTRA_GROUPS=()
for group in dialout audio video render bluetooth input plugdev; do
  getent group "$group" >/dev/null 2>&1 && EXTRA_GROUPS+=("$group")
done
if (( ${#EXTRA_GROUPS[@]} )); then
  usermod -aG "$(IFS=,; echo "${EXTRA_GROUPS[*]}")" "$TARGET_USER"
fi

# If the project was extracted as root, repair ownership so npm/data remain usable.
if [[ "$(stat -c '%u' "$PROJECT_DIR")" == "0" && "$TARGET_UID" != "0" ]]; then
  log "Fixing project ownership for $TARGET_USER"
  chown -R "$TARGET_USER:$TARGET_GROUP" "$PROJECT_DIR"
fi

export DEBIAN_FRONTEND=noninteractive

log "Installing OS packages"
apt-get update
apt-get install -y \
  ca-certificates curl gnupg git unzip rsync \
  build-essential python3 \
  iw rfkill wireless-regdb \
  network-manager bluez \
  chromium \
  brightnessctl \
  wlrctl \
  avahi-daemon \
  pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth pulseaudio-utils \
  gpsd gpsd-clients ffmpeg v4l-utils \
  libasound2-plugins

# NodeSource provides a current Node 22 on Raspberry Pi OS/Debian when the
# distro's nodejs package is older than this project's requirement.
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)"
  if (( NODE_MAJOR > 22 || (NODE_MAJOR == 22 && NODE_MINOR >= 9) )); then
    NODE_OK=1
  fi
fi

if (( NODE_OK == 0 )); then
  log "Installing Node.js 22.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
NODE_VERSION="$("$NODE_BIN" --version)"
NPM_VERSION="$("$NPM_BIN" --version)"
log "Using Node $NODE_VERSION / npm $NPM_VERSION"

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[1]')"
(( NODE_MAJOR > 22 || (NODE_MAJOR == 22 && NODE_MINOR >= 9) )) \
  || die "Node.js >= 22.9 is required; found $NODE_VERSION"

log "Installing JavaScript dependencies"
cd "$PROJECT_DIR"
run_user() {
  sudo -u "$TARGET_USER" -H env \
    HOME="$TARGET_HOME" \
    XDG_RUNTIME_DIR="/run/user/$TARGET_UID" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$TARGET_UID/bus" \
    PATH="/usr/local/bin:/usr/bin:/bin:$TARGET_HOME/.local/bin" \
    "$@"
}

# High-quality phone -> Pi Bluetooth audio. The Pi acts as an A2DP sink; WirePlumber negotiates the
# best mutually-supported codec (LDAC/aptX HD/aptX/AAC/SBC-XQ/SBC), with SBC as a universal fallback.
log "Configuring high-quality Bluetooth audio"
WP_DIR="$TARGET_HOME/.config/wireplumber/wireplumber.conf.d"
PW_DIR="$TARGET_HOME/.config/pipewire/pipewire.conf.d"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0755 "$WP_DIR" "$PW_DIR"
cat >"$WP_DIR/51-headunit-bluetooth.conf" <<'EOF_WP'
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink hfp_hf ]
  bluez5.codecs = [ ldac aptx_hd aptx aac sbc_xq sbc ]
  bluez5.enable-sbc-xq = true
  bluez5.enable-hw-volume = true
  bluez5.hfphsp-backend = "native"
}
EOF_WP
cat >"$PW_DIR/20-headunit-quality.conf" <<'EOF_PW'
context.properties = {
  default.clock.rate = 48000
  default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 ]
}
EOF_PW
chown "$TARGET_USER:$TARGET_GROUP" "$WP_DIR/51-headunit-bluetooth.conf" "$PW_DIR/20-headunit-quality.conf"
# Apply immediately when the desktop user session is already alive; otherwise the reboot at the end applies it.
run_user systemctl --user try-restart wireplumber.service pipewire.service pipewire-pulse.service >/dev/null 2>&1 || true

run_user "$NPM_BIN" install

log "Building production UI and server"
run_user "$NPM_BIN" run build

# Make sure scripts are executable.
chmod +x \
  "$PROJECT_DIR/install.sh" \
  "$PROJECT_DIR/deploy/"*.sh 2>/dev/null || true

# Runtime state must be writable by the unprivileged headunit.service user.
# GNU `install -d -o user /path/to/data/updates` only applies the requested owner
# to the final directory; newly-created parent directories can remain root-owned.
# That previously caused Spotify Connect to crash the backend while creating its cache.
DATA_DIR="$PROJECT_DIR/data"
log "Preparing writable application data directory"
mkdir -p "$DATA_DIR"
chown -R "$TARGET_USER:$TARGET_GROUP" "$DATA_DIR"
chmod 0755 "$DATA_DIR"

# Root-owned, tightly-scoped connectivity helper. The web backend itself stays unprivileged;
# only validated NetworkManager/BlueZ actions are elevated through this helper.
CONNECTIVITY_HELPER="/usr/local/sbin/headunit-connectivity"
log "Installing Wi-Fi/Bluetooth connectivity helper"
install -o root -g root -m 0755 "$PROJECT_DIR/deploy/connectivity-helper.py" "$CONNECTIVITY_HELPER"
CONNECTIVITY_SUDOERS="/etc/sudoers.d/headunit-connectivity"
printf '%s ALL=(root) NOPASSWD: %s *\n' "$TARGET_USER" "$CONNECTIVITY_HELPER" > "$CONNECTIVITY_SUDOERS"
chmod 0440 "$CONNECTIVITY_SUDOERS"
visudo -cf "$CONNECTIVITY_SUDOERS" >/dev/null || die "Connectivity sudo rule failed validation"
# Raspberry Pi OS Bookworm/Trixie uses NetworkManager by default. Make sure both managers are alive.
systemctl enable --now NetworkManager.service >/dev/null 2>&1 || true
systemctl enable --now bluetooth.service >/dev/null 2>&1 || true

# Install a narrowly-scoped, root-owned update helper. The web service can only call
# status/apply/rollback; the helper itself fixes the project path and validates ZIPs.
UPDATER_HELPER="/usr/local/sbin/headunit-update"
UPDATER_STATE="/var/lib/headunit-updater"
UPDATER_INBOX="$PROJECT_DIR/data/updates"
log "Installing in-place update/rollback helper"
install -d -m 0755 "$UPDATER_STATE/backups" "$UPDATER_STATE/staging"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0755 "$UPDATER_INBOX"
{
  echo '#!/usr/bin/env bash'
  echo 'set -euo pipefail'
  printf 'PROJECT_DIR=%q\n' "$PROJECT_DIR"
  printf 'TARGET_USER=%q\n' "$TARGET_USER"
  printf 'TARGET_GROUP=%q\n' "$TARGET_GROUP"
  printf 'TARGET_HOME=%q\n' "$TARGET_HOME"
  printf 'NPM_BIN=%q\n' "$NPM_BIN"
  printf 'STATE_DIR=%q\n' "$UPDATER_STATE"
  printf 'INBOX_DIR=%q\n' "$UPDATER_INBOX"
  cat <<'UPDATER_EOF'
SERVICE=headunit.service
BACKUPS="$STATE_DIR/backups"
STAGING="$STATE_DIR/staging"

fail() { echo "head-unit updater: $*" >&2; exit 1; }
run_user() {
  runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" PATH="/usr/local/bin:/usr/bin:/bin:$TARGET_HOME/.local/bin" "$@"
}
latest_backup() {
  find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -printf '%f\n' 2>/dev/null | sort | tail -1
}
schedule_restart() {
  local unit="headunit-restart-$(date +%s)"
  systemd-run --quiet --on-active=3s --unit="$unit" /bin/systemctl restart "$SERVICE" >/dev/null
}
validate_zip() {
  local zip="$1"
  python3 - "$zip" <<'PY_VALIDATE'
import os, stat, sys, zipfile
p=sys.argv[1]
try:
    z=zipfile.ZipFile(p)
except Exception as e:
    raise SystemExit(f"Not a valid ZIP: {e}")
infos=z.infolist()
if not infos or len(infos) > 20000:
    raise SystemExit("ZIP has an invalid number of files")
total=0
for i in infos:
    name=i.filename.replace('\\','/')
    parts=[x for x in name.split('/') if x not in ('', '.')]
    if name.startswith('/') or '..' in parts:
        raise SystemExit(f"Unsafe path in ZIP: {name}")
    mode=(i.external_attr >> 16) & 0xffff
    if stat.S_ISLNK(mode):
        raise SystemExit(f"Symlinks are not allowed in update ZIPs: {name}")
    total += i.file_size
    if total > 2 * 1024 * 1024 * 1024:
        raise SystemExit("ZIP expands beyond the 2 GB safety limit")
PY_VALIDATE
}
find_project_root() {
  local root="$1" f
  while IFS= read -r f; do
    if python3 - "$f" <<'PY_PKG'
import json, sys
try:
    p=json.load(open(sys.argv[1], encoding='utf-8'))
    raise SystemExit(0 if p.get('name') == 'rpi-head-unit' else 1)
except Exception:
    raise SystemExit(1)
PY_PKG
    then
      dirname "$f"
      return 0
    fi
  done < <(find "$root" -maxdepth 3 -type f -name package.json -print)
  return 1
}
backup_current() {
  local stamp version dest
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  version="$(python3 - "$PROJECT_DIR/package.json" <<'PY_VER'
import json, sys
try: print(json.load(open(sys.argv[1], encoding='utf-8')).get('version','unknown'))
except Exception: print('unknown')
PY_VER
)"
  dest="$BACKUPS/backup-${stamp}-${version//[^A-Za-z0-9._-]/_}"
  mkdir -p "$dest/code"
  rsync -a --delete --exclude='.env' --exclude='data/' --exclude='.git/' "$PROJECT_DIR/" "$dest/code/"
  printf '%s\n' "$version" > "$dest/version"
  echo "$dest"
}
restore_backup() {
  local backup="$1"
  [[ -d "$backup/code" ]] || fail "Backup is incomplete: $backup"
  rsync -a --delete --exclude='.env' --exclude='data/' --exclude='.git/' "$backup/code/" "$PROJECT_DIR/"
  chown -R "$TARGET_USER:$TARGET_GROUP" "$PROJECT_DIR"
}
prune_backups() {
  mapfile -t all < <(find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -print | sort)
  while (( ${#all[@]} > 3 )); do
    rm -rf -- "${all[0]}"
    all=("${all[@]:1}")
  done
  mapfile -t used < <(find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -name 'used-*' -print | sort)
  while (( ${#used[@]} > 2 )); do
    rm -rf -- "${used[0]}"
    used=("${used[@]:1}")
  done
}

case "${1:-}" in
  status)
    b="$(latest_backup || true)"
    if [[ -n "$b" ]]; then
      echo 'ROLLBACK_AVAILABLE=1'
      echo "BACKUP=$b"
    else
      echo 'ROLLBACK_AVAILABLE=0'
      echo 'BACKUP='
    fi
    ;;
  apply)
    zip="${2:-}"
    [[ -n "$zip" && -f "$zip" ]] || fail 'Update ZIP was not found.'
    real_zip="$(realpath -e "$zip")"
    real_inbox="$(realpath -e "$INBOX_DIR")"
    [[ "$real_zip" == "$real_inbox/"* ]] || fail 'Update ZIP must come from the head-unit update inbox.'
    validate_zip "$real_zip"
    exec 9>/run/lock/headunit-update.lock
    flock -n 9 || fail 'Another update or rollback is already running.'
    work="$(mktemp -d "$STAGING/apply-XXXXXX")"
    trap 'rm -rf "$work"' EXIT
    chown "$TARGET_USER:$TARGET_GROUP" "$work"
    run_user mkdir -p "$work/extracted"
    run_user unzip -q "$real_zip" -d "$work/extracted"
    src="$(find_project_root "$work/extracted")" || fail 'This ZIP is not an RPI Head Unit update.'
    [[ -f "$src/package-lock.json" ]] || fail 'Update is missing package-lock.json.'
    echo '[updater] Installing dependencies in staging…'
    (cd "$src" && run_user "$NPM_BIN" ci --no-audit --no-fund)
    echo '[updater] Building update in staging…'
    (cd "$src" && run_user "$NPM_BIN" run build)
    [[ -f "$src/apps/server/dist/index.js" && -f "$src/apps/ui/dist/index.html" ]] || fail 'Update build did not produce the expected files.'
    backup="$(backup_current)"
    echo "[updater] Saved rollback point: $(basename "$backup")"
    if ! rsync -a --delete --exclude='.env' --exclude='data/' --exclude='.git/' "$src/" "$PROJECT_DIR/"; then
      echo '[updater] Copy failed; restoring previous version.' >&2
      restore_backup "$backup"
      fail 'Update copy failed; previous version was restored.'
    fi
    chown -R "$TARGET_USER:$TARGET_GROUP" "$PROJECT_DIR"
    prune_backups
    echo '[updater] Update installed successfully.'
    schedule_restart
    ;;
  rollback)
    exec 9>/run/lock/headunit-update.lock
    flock -n 9 || fail 'Another update or rollback is already running.'
    name="$(latest_backup || true)"
    [[ -n "$name" ]] || fail 'No rollback version is available.'
    backup="$BACKUPS/$name"
    # Keep an emergency copy of the version being rolled back from. It is not part of the normal rollback stack.
    redo="$BACKUPS/used-$(date -u +%Y%m%dT%H%M%SZ)-pre-rollback"
    mkdir -p "$redo/code"
    rsync -a --delete --exclude='.env' --exclude='data/' --exclude='.git/' "$PROJECT_DIR/" "$redo/code/"
    restore_backup "$backup"
    mv "$backup" "$BACKUPS/used-${name#backup-}"
    prune_backups
    echo "[updater] Restored $name"
    schedule_restart
    ;;
  *)
    fail 'Allowed actions: status, apply <zip>, rollback'
    ;;
esac
UPDATER_EOF
} > "$UPDATER_HELPER"
chown root:root "$UPDATER_HELPER"
chmod 0755 "$UPDATER_HELPER"

SUDOERS_FILE="/etc/sudoers.d/headunit-updater"
printf '%s ALL=(root) NOPASSWD: %s *\n' "$TARGET_USER" "$UPDATER_HELPER" > "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null || die "Updater sudo rule failed validation"

# Create/update a service using the actual account, UID and checkout path.
SUPP_LINE=""
if (( ${#EXTRA_GROUPS[@]} )); then
  SUPP_LINE="SupplementaryGroups=$(IFS=' '; echo "${EXTRA_GROUPS[*]}")"
fi
SERVICE="/etc/systemd/system/headunit.service"
log "Installing systemd service: $SERVICE"
cat >"$SERVICE" <<EOF
[Unit]
Description=RPI Head Unit backend
After=network.target sound.target

[Service]
Type=simple
User=$TARGET_USER
$SUPP_LINE
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN --env-file-if-exists=$PROJECT_DIR/.env apps/server/dist/index.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production
Environment=XDG_RUNTIME_DIR=/run/user/$TARGET_UID
Environment=WAYLAND_DISPLAY=wayland-0
Environment=XDG_SESSION_TYPE=wayland
Environment=QT_QPA_PLATFORM=wayland
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$TARGET_UID/bus
Environment=HOME=$TARGET_HOME

[Install]
WantedBy=multi-user.target
EOF

# Create .env only if it doesn't exist; never overwrite user configuration.
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  log "Creating .env from .env.example"
  run_user cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
fi

ENV_FILE="$PROJECT_DIR/.env"
set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# Raspberry Pi hardware/services-only configuration. Keep an existing custom OBD_PORT.
set_env SPOTIFY_DEVICE_NAME "RPI Headunit"
sed -i -E '/^SPOTIFY_CONNECT_ENABLED=.*/d' "$ENV_FILE" 2>/dev/null || true
set_env SPOTIFY_CONNECT_DISABLED 0
# Remove obsolete runtime-mode/provider switches from older installs; v0.2.5 ignores them.
for legacy_key in HEADUNIT_DEMO VEHICLE_PROVIDER VEHICLE_SIM_FAULTS DEVICES_PROVIDER SYSTEM_PROVIDER; do
  sed -i -E "/^${legacy_key}=.*/d" "$ENV_FILE" 2>/dev/null || true
done
set_env SPOTIFY_CONNECT_BACKEND alsa
set_env SPOTIFY_CONNECT_DEVICE default
set_env SPOTIFY_CONNECT_BITRATE 320
set_env SPOTIFY_CONNECT_NORMALIZE 0
if ! grep -qE '^OBD_PORT=' "$ENV_FILE"; then
  printf '\nOBD_PORT=/dev/rfcomm0\n' >> "$ENV_FILE"
fi

# Configure Chromium kiosk autostart for Raspberry Pi OS labwc.
AUTOSTART_DIR="$TARGET_HOME/.config/labwc"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"
log "Configuring labwc Chromium kiosk autostart"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" "$AUTOSTART_DIR"

# Use real touchscreen events rather than Raspberry Pi OS mouse emulation.
# This is required for one-finger Chromium scrolling under labwc/Trixie.
if [[ -x "$PROJECT_DIR/deploy/fix-touch.sh" ]]; then
  run_user env HOME="$TARGET_HOME" XDG_CONFIG_HOME="$TARGET_HOME/.config" "$PROJECT_DIR/deploy/fix-touch.sh" || true
fi

KIOSK_LINE="$PROJECT_DIR/deploy/kiosk.sh &"
touch "$AUTOSTART_FILE"
chown "$TARGET_USER:$TARGET_GROUP" "$AUTOSTART_FILE"

# Older releases were installed from versioned folders under ~/Downloads and each
# install appended another kiosk launcher. That could start an old Chromium first,
# causing the new invocation to reuse the old process/keyring settings. Keep exactly
# one RPI Head Unit kiosk launcher while preserving unrelated labwc autostart entries.
AUTOSTART_TMP="$(mktemp)"
awk '
  /RPI-head-unit[^[:space:]]*\/deploy\/kiosk\.sh([[:space:]]|$)/ { next }
  /RPI-head-unit-New\/deploy\/kiosk\.sh([[:space:]]|$)/ { next }
  /rpi-head-unit[^[:space:]]*\/deploy\/kiosk\.sh([[:space:]]|$)/ { next }
  { print }
' "$AUTOSTART_FILE" >"$AUTOSTART_TMP"
cat "$AUTOSTART_TMP" >"$AUTOSTART_FILE"
rm -f "$AUTOSTART_TMP"
printf '\n%s\n' "$KIOSK_LINE" >>"$AUTOSTART_FILE"
chown "$TARGET_USER:$TARGET_GROUP" "$AUTOSTART_FILE"

systemctl daemon-reload
systemctl enable --now avahi-daemon >/dev/null 2>&1 || true
systemctl enable headunit.service
systemctl restart headunit.service

log "Waiting for backend health check"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8787/api/health >/dev/null \
  || die "Backend did not become healthy. Check: sudo journalctl -u headunit -n 100 --no-pager"

# Wired USB Android Auto. Stop auto-installing the old wireless-only Prodigy receiver.
# Explicitly clear the old ADB projection command; USB phone detection is built into the
# head-unit itself. Projection remains unavailable until a wired-capable receiver is configured.
log "Configuring wired USB Android Auto (no phone hotspot, ADB, or old Prodigy installer)"
# Preserve an explicitly installed wired receiver on reinstall. Replace old wireless-only
# OpenAuto projection commands, but do not erase a custom working native USB command.
CURRENT_PROJECTION="$(sed -n 's/^PROJECTION_COMMAND=//p' "$ENV_FILE" | tail -1)"
if [[ "$CURRENT_PROJECTION" == *openauto* || "$CURRENT_PROJECTION" == *adb* ]]; then
  set_env PROJECTION_COMMAND ""
  set_env PROJECTION_ARGS ""
fi
set_env PROJECTION_MODE ondemand
set_env HEADUNIT_ALLOW_RESIDENT_AA 0
set_env PROJECTION_FOCUS_COMMAND "'$PROJECT_DIR/deploy/focus-window.sh android-auto'"
set_env PROJECTION_BACK_COMMAND "'$PROJECT_DIR/deploy/focus-window.sh dashboard'"
set_env ANDROID_AUTO_DEV_ENABLED 0
set_env ANDROID_AUTO_DEV_AUTO_CONNECT 0
set_env ANDROID_AUTO_DEV_AUTO_BRIDGE 0
# The upgraded head-unit must not start its old resident OpenAuto shell.
systemctl disable --now openauto-prodigy.service >/dev/null 2>&1 || true
# gpsd is local-only; run deploy/setup-gps.sh once after plugging in the DFRobot GPS.
# WLED uses the ESP32's private IP; front dashcam recording is opt-in.

systemctl restart headunit.service

cat <<EOF

============================================================
 RPI HEAD UNIT INSTALL COMPLETE
============================================================

Project:  $PROJECT_DIR
User:     $TARGET_USER
Node:     $NODE_VERSION
Backend:  http://127.0.0.1:8787

The backend is enabled to start automatically at boot.
The Chromium kiosk is configured in:
  $AUTOSTART_FILE

Useful commands:
  sudo systemctl status headunit
  sudo journalctl -u headunit -f
  curl http://127.0.0.1:8787/api/health

Pi mode:   HARDWARE/SERVICES ONLY (simulator removed)
Vehicle:   real OBD-II (/dev/rfcomm0 unless you changed OBD_PORT)
Devices:   real BlueZ Bluetooth
System:    real PipeWire/brightness controls
Spotify:   Native RPI Headunit Connect @ 320 kbps + browser fallback

Android Auto: USB phone detection ready; requires compatible native wired receiver
AA installer:    ./deploy/install-livi-wired.sh  (as your desktop user, without sudo)
  This optional step installs a pinned, verified native USB wired receiver.
  ADB, phone hotspot and developer Head Unit Server are NOT needed.

USB GPS:       sudo ./deploy/setup-gps.sh  (after connecting DFRobot GPS)
WLED LEDs:     Use the new Car Lab > Ambient LEDs page (ESP32 + WLED)
USB dashcam:   Use the new Car Lab > Dashcam page (UVC camera + ffmpeg)

Installer log:
  $LOG_FILE

A reboot is recommended so the labwc kiosk and all Pi hardware services
start from a clean session.
============================================================
EOF
