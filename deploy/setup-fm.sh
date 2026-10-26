#!/usr/bin/env bash
# Install the FM transmitter helper (deploy/fm-node/fm_node.py) and the transmitter program it drives (vendor/fm_transmitter).
#
#   sudo ./deploy/setup-fm.sh local|node [--gpio21] [--bind ADDR] [--freq-min F] [--freq-max F] [--no-start]
#   sudo ./deploy/setup-fm.sh uninstall [--purge]
#
#   local   the transmitter is on THIS Pi (only for a head unit that is a Pi Zero, 2, 3 or 4; the Pi 5 cannot do it)
#   node    this Pi is the transmitter, and the head unit reaches it over the network (use a Zero 2 W, 3 or 4 for this)
#
# Works offline: it builds the program from the source in vendor/fm_transmitter after checking its checksums, and needs build-essential
# and python3 (it installs them with apt only when they are missing). It refuses to do anything on a board the program does not work on:
# the program writes to the Pi's hardware as root, and on a board it does not know that would hit the wrong addresses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_SRC="$SCRIPT_DIR/fm-node"
VENDOR_SRC="$PROJECT_DIR/vendor/fm_transmitter"

say() { printf '%s\n' "$*"; }
note() { printf '[fm] %s\n' "$*"; }
die() { printf '[fm] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage:
  sudo ./deploy/setup-fm.sh local|node [--gpio21] [--bind ADDR] [--freq-min F] [--freq-max F] [--no-start]
  sudo ./deploy/setup-fm.sh uninstall [--purge]

  local        the transmitter is on this Pi (a head unit that is a Pi Zero, 2, 3 or 4)
  node         this Pi is the transmitter; the head unit reaches it over the network
  --gpio21     use GPIO21 (pin 40) instead of GPIO4 (pin 7) for the antenna (the advice for a Pi 4)
  --bind ADDR  address to listen on (default 127.0.0.1 for local, 0.0.0.0 for node)
  --freq-min F, --freq-max F   the band the helper accepts, in MHz (87.5 to 108.0 by default; never outside 76 to 108)
  --no-start   install and enable, but do not start now
  uninstall    remove the helper and the program; --purge also removes the password file
USAGE
}

# ---------------------------------------------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------------------------------------------
MODE=""
GPIO21=0
BIND_ARG=""
FREQ_MIN_ARG=""
FREQ_MAX_ARG=""
NO_START=0
PURGE=0

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
case "$1" in
  local|node|uninstall) MODE="$1"; shift ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --gpio21) GPIO21=1 ;;
    --no-start) NO_START=1 ;;
    --purge) PURGE=1 ;;
    --bind) [[ $# -ge 2 ]] || die "--bind needs an address."; BIND_ARG="$2"; shift ;;
    --freq-min) [[ $# -ge 2 ]] || die "--freq-min needs a number."; FREQ_MIN_ARG="$2"; shift ;;
    --freq-max) [[ $# -ge 2 ]] || die "--freq-max needs a number."; FREQ_MAX_ARG="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
  shift
done
if [[ "$MODE" == uninstall ]]; then
  (( ! GPIO21 && ! NO_START )) && [[ -z "$BIND_ARG$FREQ_MIN_ARG$FREQ_MAX_ARG" ]] || die "uninstall takes only --purge."
else
  (( ! PURGE )) || die "--purge goes with uninstall."
fi

# ---------------------------------------------------------------------------------------------------------------------------------
# Where things go. HEADUNIT_FM_ROOT puts every system path under a folder (for tests); the other HEADUNIT_FM_* switches below are
# honoured only then, so that nothing in a normal environment can change the board check or the build.
# ---------------------------------------------------------------------------------------------------------------------------------
ROOT="${HEADUNIT_FM_ROOT:-}"
while [[ "$ROOT" == */ ]]; do ROOT="${ROOT%/}"; done      # "/" counts as no prefix at all
STAGED=0
if [[ -n "$ROOT" ]]; then
  [[ "$ROOT" == /* ]] || die "HEADUNIT_FM_ROOT must be a full path."
  STAGED=1
fi

LIB_DIR="$ROOT/usr/local/lib/headunit-fm"
CONF="$ROOT/etc/headunit-fm-node.conf"
UNIT_NAME="headunit-fm-node.service"
UNIT_FILE="$ROOT/etc/systemd/system/$UNIT_NAME"
ENV_FILE="$PROJECT_DIR/.env"

if (( STAGED )); then
  MODEL_FILE="${HEADUNIT_FM_MODEL_FILE:-$ROOT/proc/device-tree/model}"
  RANGES_FILE="${HEADUNIT_FM_RANGES_FILE:-$ROOT/proc/device-tree/soc/ranges}"
  MAKE_CMD="${HEADUNIT_FM_MAKE:-make}"
  note "STAGED install under $ROOT: nothing outside it is touched."
else
  MODEL_FILE=/proc/device-tree/model
  RANGES_FILE=/proc/device-tree/soc/ranges
  MAKE_CMD=make
  for hook in HEADUNIT_FM_MODEL_FILE HEADUNIT_FM_RANGES_FILE HEADUNIT_FM_MAKE; do
    [[ -z "${!hook:-}" ]] || note "Ignoring $hook: it only works together with HEADUNIT_FM_ROOT."
  done
fi
# apt and systemctl: skipped in a staged install, unless a test puts a stub of each first in PATH and sets the switch to 0.
# HEADUNIT_FM_SKIP_APT=1 and HEADUNIT_FM_SKIP_SYSTEMCTL=1 are honoured everywhere (they only do less).
SKIP_APT=0
SKIP_SYSTEMCTL=0
if (( STAGED )); then
  [[ "${HEADUNIT_FM_SKIP_APT:-1}" == 0 ]] || SKIP_APT=1
  [[ "${HEADUNIT_FM_SKIP_SYSTEMCTL:-1}" == 0 ]] || SKIP_SYSTEMCTL=1
fi
[[ "${HEADUNIT_FM_SKIP_APT:-}" != 1 ]] || SKIP_APT=1
[[ "${HEADUNIT_FM_SKIP_SYSTEMCTL:-}" != 1 ]] || SKIP_SYSTEMCTL=1

if (( ! STAGED )) && [[ "$(id -u)" != 0 ]]; then
  die "Run as root: sudo ./deploy/setup-fm.sh $MODE"
fi
OWNER_ARGS=()
[[ "$(id -u)" == 0 ]] && OWNER_ARGS=(-o root -g root)

# ---------------------------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------------------------
BUILD_DIR=""
cleanup() { [[ -z "$BUILD_DIR" ]] || rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

have() { command -v "$1" >/dev/null 2>&1; }

# get_conf FILE KEY: the value of the last KEY=value line (empty when there is none)
get_conf() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1; }

# set_conf FILE KEY VALUE: replace the first KEY=... line, or add one. The file keeps its owner and mode (mode 0600 from the start).
set_conf() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  # The value goes in through the environment, not the command line, so the password never shows in `ps`.
  SET_CONF_VALUE="$value" awk -v key="$key" '
    BEGIN { done = 0; value = ENVIRON["SET_CONF_VALUE"] }
    index($0, key "=") == 1 && !done { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }' "$file" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
}

systemctl_do() {
  (( SKIP_SYSTEMCTL )) && return 0
  have systemctl || { note "systemctl is not available; start the helper by hand (see docs/fm.md)."; return 0; }
  systemctl "$@"
}

# ---------------------------------------------------------------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------------------------------------------------------------
if [[ "$MODE" == uninstall ]]; then
  note "Removing the FM transmitter helper."
  if (( ! SKIP_SYSTEMCTL )) && have systemctl; then
    systemctl disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
  fi
  rm -f "$UNIT_FILE"
  systemctl_do daemon-reload || true
  [[ -n "$LIB_DIR" && "$LIB_DIR" == */usr/local/lib/headunit-fm ]] || die "Internal error: unexpected install folder."
  rm -rf "$LIB_DIR"
  if (( PURGE )); then
    rm -f "$CONF"
    note "Removed the helper, the program and the password file."
  else
    [[ ! -e "$CONF" ]] || note "Kept $CONF (it holds the password). Remove it with: sudo ./deploy/setup-fm.sh uninstall --purge"
    note "Removed the helper and the program."
  fi
  say "If the head unit's .env file has FM_NODE_URL and FM_NODE_TOKEN lines, you can delete them."
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------------------------------
# Checks on what was asked
# ---------------------------------------------------------------------------------------------------------------------------------
[[ -f "$NODE_SRC/fm_node.py" && -f "$NODE_SRC/headunit-fm-node.service" && -f "$NODE_SRC/fm-node.conf.example" ]] \
  || die "The helper files are missing from $NODE_SRC."
[[ -f "$VENDOR_SRC/SOURCE.txt" && -f "$VENDOR_SRC/Makefile" ]] || die "The transmitter source is missing from $VENDOR_SRC."

# python3 first: the board check and the password both need it.
if ! have python3; then
  if (( SKIP_APT )); then die "python3 is needed. Install it with: sudo apt install python3"; fi
  note "Installing python3 (apt)."
  apt-get install -y python3 || die "Could not install python3. Connect to the internet once, or run: sudo apt install python3"
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "python3 is older than 3.9."

if [[ -n "$BIND_ARG" ]]; then
  python3 -I -c 'import ipaddress, sys; ipaddress.ip_address(sys.argv[1])' "$BIND_ARG" 2>/dev/null \
    || die "--bind must be an IP address like 127.0.0.1 or 0.0.0.0."
fi
valid_freq() {
  [[ "$1" =~ ^[0-9]{2,3}(\.[0-9]{1,2})?$ ]] && awk -v f="$1" 'BEGIN { exit !(f >= 76 && f <= 108) }'
}
for pair in "--freq-min:$FREQ_MIN_ARG" "--freq-max:$FREQ_MAX_ARG"; do
  [[ -z "${pair#*:}" ]] || valid_freq "${pair#*:}" || die "${pair%%:*} must be a frequency between 76 and 108 MHz, like 88.1."
done
if [[ -n "$FREQ_MIN_ARG" && -n "$FREQ_MAX_ARG" ]]; then
  awk -v a="$FREQ_MIN_ARG" -v b="$FREQ_MAX_ARG" 'BEGIN { exit !(a < b) }' || die "--freq-min must be lower than --freq-max."
fi

# ---------------------------------------------------------------------------------------------------------------------------------
# The board. Nothing is installed, built or enabled unless the helper itself says this board is one the program works on.
# ---------------------------------------------------------------------------------------------------------------------------------
BOARD_JSON="$(python3 -B -I "$NODE_SRC/fm_node.py" --check-board --model-file "$MODEL_FILE" --ranges-file "$RANGES_FILE" 2>/dev/null)" && BOARD_OK=1 || BOARD_OK=0
json_field() { python3 -I -c 'import json, sys; v = json.loads(sys.argv[1]).get(sys.argv[2]); print("" if v is None else v)' "$BOARD_JSON" "$1" 2>/dev/null || true; }
BOARD_NAME="$(json_field board)"
if [[ "$BOARD_OK" != 1 ]]; then
  BOARD_REASON="$(json_field reason)"
  note "This computer cannot be used as the FM transmitter."
  say "  ${BOARD_REASON:-It is not a board the transmitter program is known to work on.}" >&2
  if [[ "$MODE" == local ]]; then
    say "  To get FM anyway, put a second Pi (a Zero 2 W, 3 or 4) in the car and run  sudo ./deploy/setup-fm.sh node  on it." >&2
  else
    say "  Run this on a Raspberry Pi Zero, 2, 3 or 4." >&2
  fi
  exit 1
fi
note "Board: ${BOARD_NAME:-unknown} (supported)."

# ---------------------------------------------------------------------------------------------------------------------------------
# The source: copy it to a temporary folder, check the copy against the checksums, build there. Nothing is built in the project.
# ---------------------------------------------------------------------------------------------------------------------------------
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/headunit-fm-build.XXXXXX")"
while IFS= read -r -d '' entry; do
  [[ -f "$entry" && ! -L "$entry" ]] || die "Unexpected entry in vendor/fm_transmitter: ${entry##*/}"
  cp -- "$entry" "$BUILD_DIR/"
done < <(find "$VENDOR_SRC" -mindepth 1 -maxdepth 1 -print0)

SUMS="$(sed -n 's/^\([0-9a-f]\{64\}\)  \([A-Za-z0-9_.-]\{1,60\}\)$/\1  \2/p' "$VENDOR_SRC/SOURCE.txt")"
[[ -n "$SUMS" ]] || die "vendor/fm_transmitter/SOURCE.txt has no checksums."
if ! CHECK_OUT="$(cd "$BUILD_DIR" && printf '%s\n' "$SUMS" | sha256sum -c --quiet - 2>&1)"; then
  printf '%s\n' "$CHECK_OUT" >&2
  die "The transmitter source in vendor/fm_transmitter does not match the checksums in SOURCE.txt. Nothing was built or installed."
fi
for file in "$BUILD_DIR"/*; do
  name="${file##*/}"
  case "$name" in SOURCE.txt|NOTICE) continue ;; esac
  grep -q "  $name\$" <<<"$SUMS" || die "vendor/fm_transmitter/$name is not covered by the checksums in SOURCE.txt."
done
note "Checked the transmitter source against its checksums."

# ---------------------------------------------------------------------------------------------------------------------------------
# Build (skipped when the installed program was built from the same source with the same flags)
# ---------------------------------------------------------------------------------------------------------------------------------
CXXFLAGS_VALUE="-Wall -O3 -std=c++11"
(( GPIO21 )) && CXXFLAGS_VALUE="$CXXFLAGS_VALUE -DGPIO21"
STAMP="$(printf '%s\nCXXFLAGS=%s\n' "$SUMS" "$CXXFLAGS_VALUE" | sha256sum | cut -d' ' -f1)"

if [[ -x "$LIB_DIR/fm_transmitter" && "$(cat "$LIB_DIR/build.stamp" 2>/dev/null || true)" == "$STAMP" ]] \
   && "$LIB_DIR/fm_transmitter" -v >/dev/null 2>&1; then
  note "The transmitter program is already built from this source with these flags."
  PROGRAM="$LIB_DIR/fm_transmitter"
else
  if [[ "$MAKE_CMD" == make ]]; then
    if ! have make || ! have g++ || ! have gcc; then
      (( ! SKIP_APT )) || die "make and a C++ compiler are needed. Install them with: sudo apt install build-essential"
      note "Installing build-essential (apt)."
      apt-get install -y build-essential || die "Could not install build-essential. Connect to the internet once, or run: sudo apt install build-essential"
    fi
  fi
  note "Building the transmitter program (this takes a minute on a small Pi)."
  # A clean environment, so nothing the caller exported (CXXFLAGS, CPATH, MAKEFLAGS ...) changes the build.
  if ! env -i PATH="$PATH" LC_ALL=C "$MAKE_CMD" -C "$BUILD_DIR" CXXFLAGS="$CXXFLAGS_VALUE" >"$BUILD_DIR/build.log" 2>&1; then
    tail -n 20 "$BUILD_DIR/build.log" >&2
    die "Building the transmitter program failed. Nothing was installed."
  fi
  [[ -x "$BUILD_DIR/fm_transmitter" ]] || die "The build finished but there is no fm_transmitter program."
  # '-v' prints the version and touches no hardware. It is the only way the program is run here.
  VERSION_OUT="$("$BUILD_DIR/fm_transmitter" -v 2>&1)" || die "The program that was built does not run on this Pi."
  [[ "$VERSION_OUT" == *version* ]] || die "The program that was built did not report a version."
  note "Built: ${VERSION_OUT##*/}"
  PROGRAM="$BUILD_DIR/fm_transmitter"
fi

# ---------------------------------------------------------------------------------------------------------------------------------
# Install the files
# ---------------------------------------------------------------------------------------------------------------------------------
install -d -m 0755 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$LIB_DIR"
if [[ "$PROGRAM" != "$LIB_DIR/fm_transmitter" ]]; then
  install -m 0755 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$PROGRAM" "$LIB_DIR/fm_transmitter"
  printf '%s\n' "$STAMP" >"$LIB_DIR/build.stamp"
  chmod 644 "$LIB_DIR/build.stamp"
fi
install -m 0755 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$NODE_SRC/fm_node.py" "$LIB_DIR/fm_node.py"

# The settings file: created once (with a new password), then only edited. It is mode 0600 before the password goes into it.
install -d -m 0755 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$(dirname "$CONF")"
DEFAULT_BIND=127.0.0.1
[[ "$MODE" == node ]] && DEFAULT_BIND=0.0.0.0
if [[ ! -e "$CONF" ]]; then
  ( umask 077; cat "$NODE_SRC/fm-node.conf.example" >"$CONF" )
  chmod 600 "$CONF"
  set_conf "$CONF" TOKEN "$(python3 -I -c 'import secrets; print(secrets.token_hex(24))')"
  set_conf "$CONF" BIND "${BIND_ARG:-$DEFAULT_BIND}"
  note "Created $CONF with a new password."
else
  chmod 600 "$CONF"
  TOKEN_NOW="$(get_conf "$CONF" TOKEN)"
  if [[ ${#TOKEN_NOW} -lt 16 ]]; then
    set_conf "$CONF" TOKEN "$(python3 -I -c 'import secrets; print(secrets.token_hex(24))')"
    note "The password in $CONF was missing or too short; made a new one."
  else
    note "Kept the existing password in $CONF."
  fi
  [[ -z "$BIND_ARG" ]] || set_conf "$CONF" BIND "$BIND_ARG"
fi
[[ -z "$FREQ_MIN_ARG" ]] || set_conf "$CONF" FREQ_MIN "$FREQ_MIN_ARG"
[[ -z "$FREQ_MAX_ARG" ]] || set_conf "$CONF" FREQ_MAX "$FREQ_MAX_ARG"
TOKEN="$(get_conf "$CONF" TOKEN)"
BIND_NOW="$(get_conf "$CONF" BIND)"
CONTROL_PORT_NOW="$(get_conf "$CONF" CONTROL_PORT)"
CONTROL_PORT_NOW="${CONTROL_PORT_NOW:-8788}"
# Make sure the helper accepts the file it will be started with (a hand-edited setting can be wrong).
python3 -B -I "$LIB_DIR/fm_node.py" --config "$CONF" --check-config || die "The settings file $CONF has a problem (see above). Fix it and run this again."

# The service
install -d -m 0755 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$(dirname "$UNIT_FILE")"
install -m 0644 ${OWNER_ARGS[@]+"${OWNER_ARGS[@]}"} "$NODE_SRC/headunit-fm-node.service" "$UNIT_FILE"
if (( ! SKIP_SYSTEMCTL )); then
  WAS_ACTIVE=0
  systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null && WAS_ACTIVE=1
  systemctl_do daemon-reload
  if (( NO_START )); then
    systemctl_do enable "$UNIT_NAME" || true
    note "Installed and enabled the helper; not started (--no-start). Start it with: sudo systemctl start $UNIT_NAME"
  else
    systemctl_do enable --now "$UNIT_NAME" || die "Could not start the helper. See: journalctl -u $UNIT_NAME -n 30"
    (( ! WAS_ACTIVE )) || systemctl_do restart "$UNIT_NAME"
    sleep 1
    systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null || die "The helper did not stay running. See: journalctl -u $UNIT_NAME -n 30"
    note "The helper is running."
  fi
else
  note "Installed the helper files (service not enabled: systemctl skipped)."
fi

# ---------------------------------------------------------------------------------------------------------------------------------
# Tell the head unit about it
# ---------------------------------------------------------------------------------------------------------------------------------
env_has() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null; }
THIS_ADDRESS="127.0.0.1"
if [[ "$MODE" == node ]]; then
  case "$BIND_NOW" in
    ""|0.0.0.0|::) THIS_ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"; THIS_ADDRESS="${THIS_ADDRESS:-<address of this Pi>}" ;;
    *) THIS_ADDRESS="$BIND_NOW" ;;
  esac
fi
URL_LINE="FM_NODE_URL=http://$THIS_ADDRESS:$CONTROL_PORT_NOW"
TOKEN_LINE="FM_NODE_TOKEN=$TOKEN"

say
if [[ "$MODE" == local ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    ADDED=0
    if ! env_has FM_NODE_URL; then
      [[ -z "$(tail -c 1 "$ENV_FILE" 2>/dev/null)" ]] || printf '\n' >>"$ENV_FILE"
      printf '%s\n' "$URL_LINE" >>"$ENV_FILE"; ADDED=1
    fi
    if ! env_has FM_NODE_TOKEN; then
      [[ -z "$(tail -c 1 "$ENV_FILE" 2>/dev/null)" ]] || printf '\n' >>"$ENV_FILE"
      printf '%s\n' "$TOKEN_LINE" >>"$ENV_FILE"; ADDED=1
    fi
    if (( ADDED )); then
      note "Added the FM lines to $ENV_FILE (they were missing). Restart the head unit to pick them up."
    else
      note "$ENV_FILE already has FM_NODE_URL and FM_NODE_TOKEN; left as they are."
    fi
    if env_has FM_NODE_TOKEN && [[ "$(get_conf "$ENV_FILE" FM_NODE_TOKEN)" != "$TOKEN" ]]; then
      note "WARNING: FM_NODE_TOKEN in $ENV_FILE is not the password in $CONF. Make them the same."
    fi
  else
    say "There is no $ENV_FILE yet. When you create it, add these two lines:"
    say "  $URL_LINE"
    say "  $TOKEN_LINE"
  fi
else
  say "This Pi is ready to be the transmitter (listening on $BIND_NOW, port $CONTROL_PORT_NOW)."
  say "On the head unit, add these two lines to its .env file and restart it:"
  say "  $URL_LINE"
  say "  $TOKEN_LINE"
  case "$BIND_NOW" in
    127.0.0.1|::1) say "NOTE: the helper listens on $BIND_NOW only, so the head unit cannot reach it. Run again with --bind 0.0.0.0 (or this Pi's address)." ;;
  esac
fi

PIN_TEXT="GPIO4 (pin 7)"
(( GPIO21 )) && PIN_TEXT="GPIO21 (pin 40)"
say
say "Antenna: connect 20 to 40 cm of plain wire to $PIN_TEXT. Nothing else: no amplifier and no longer antenna."
say "Legal: sending on FM frequencies needs permission in many countries. You are responsible for following the rules where you drive."
say "Pick a frequency no station is using (tune the car radio across the band first). More in docs/fm.md."
