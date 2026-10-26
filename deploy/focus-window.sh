#!/usr/bin/env bash
# Focus the native Android Auto receiver or Chromium dashboard on Raspberry Pi OS labwc/Wayland.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  android-auto|dashboard|hide-android-auto) ;;
  *) echo "usage: $0 android-auto|dashboard|hide-android-auto" >&2; exit 2 ;;
esac

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ -z "${WAYLAND_DISPLAY:-}" || ! -S "$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-}" ]]; then
  WAYLAND_DISPLAY="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -printf '%f\n' 2>/dev/null | sort | head -1 || true)"
  [[ -n "$WAYLAND_DISPLAY" ]] || { echo "no Wayland display found" >&2; exit 3; }
  export WAYLAND_DISPLAY
fi

command -v wlrctl >/dev/null 2>&1 || { echo "wlrctl is not installed" >&2; exit 127; }

focus_one() {
  local spec="$1"
  wlrctl toplevel find "$spec" >/dev/null 2>&1 || return 1
  # On labwc, focusing a minimized toplevel restores it as well. This is what
  # lets Android Auto stay resident in the background until the user opens it.
  wlrctl toplevel focus "$spec" >/dev/null 2>&1 || return 1
}

minimize_one() {
  local spec="$1"
  wlrctl toplevel find "$spec" >/dev/null 2>&1 || return 1
  wlrctl toplevel minimize "$spec" >/dev/null 2>&1 || return 1
}

# Exact IDs first; then discover whatever app_id/title the current Qt/Chromium build actually exposes.
focus_from_list() {
  local pattern="$1" line appid
  while IFS= read -r line; do
    [[ "$line" =~ $pattern ]] || continue
    appid="${line%%:*}"
    appid="${appid#${appid%%[![:space:]]*}}"
    appid="${appid%${appid##*[![:space:]]}}"
    [[ -n "$appid" ]] && focus_one "app_id:$appid" && return 0
  done < <(wlrctl toplevel list 2>/dev/null || true)
  return 1
}

minimize_android_auto_now() {
  local found=1 line appid
  # Known app IDs/titles first.
  for spec in \
    'app_id:openauto-prodigy' \
    'app_id:OpenAutoProdigy' \
    'title:OpenAuto Prodigy'; do
    if minimize_one "$spec"; then found=0; fi
  done

  # Then cover current/future Prodigy builds whose Wayland app_id differs.
  while IFS= read -r line; do
    [[ "$line" =~ ([Oo]pen[Aa]uto|[Pp]rodigy|[Aa]ndroid[[:space:]]*[Aa]uto) ]] || continue
    appid="${line%%:*}"
    appid="${appid#${appid%%[![:space:]]*}}"
    appid="${appid%${appid##*[![:space:]]}}"
    if [[ -n "$appid" ]] && wlrctl toplevel minimize "app_id:$appid" >/dev/null 2>&1; then
      found=0
    fi
  done < <(wlrctl toplevel list 2>/dev/null || true)
  return "$found"
}

# Up to 20 seconds covers a cold Qt start on the Pi without timing out the backend hook.
for _ in $(seq 1 100); do
  case "$TARGET" in
    android-auto)
      # Focusing a minimized toplevel restores it on labwc.
      focus_one 'app_id:openauto-prodigy' && exit 0
      focus_one 'app_id:OpenAutoProdigy' && exit 0
      focus_one 'title:OpenAuto Prodigy' && exit 0
      focus_from_list '([Oo]pen[Aa]uto|[Pp]rodigy|[Aa]ndroid[[:space:]]*[Aa]uto)' && exit 0
      ;;
    hide-android-auto)
      minimize_android_auto_now && exit 0
      ;;
    dashboard)
      # Merely focusing Chromium is not enough when Prodigy is fullscreen or
      # stacked above it. Hide AA first, then bring the dashboard forward.
      minimize_android_auto_now || true
      focus_one 'title:Head Unit' && exit 0
      focus_one 'app_id:chromium-browser' && exit 0
      focus_one 'app_id:chromium' && exit 0
      focus_one 'app_id:org.chromium.Chromium' && exit 0
      focus_from_list '([Hh]ead[[:space:]]*[Uu]nit|[Cc]hromium|[Cc]hrome)' && exit 0
      ;;
  esac
  sleep 0.2
done

echo "could not find $TARGET window" >&2
exit 1
