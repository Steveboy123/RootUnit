#!/usr/bin/env bash
# Non-destructive diagnosis of Head Unit startup. Does not print .env or tokens.
set -u
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE=/var/lib/headunit-boot-studio
USER_NAME="$(cat "$STATE/user" 2>/dev/null || id -un)"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
CMDLINE=/boot/firmware/cmdline.txt
[[ -f "$CMDLINE" ]] || CMDLINE=/boot/cmdline.txt
headsec() { printf '\n=== %s ===\n' "$1"; }
headsec 'Boot mode'
[[ -f "$STATE/enabled" ]] && echo 'Mascot kiosk: enabled' || echo 'Mascot kiosk: not enabled'
echo "Kiosk user: $USER_NAME"
echo "Project: $PROJECT_DIR"
echo "UI build: $( [[ -s "$PROJECT_DIR/apps/ui/dist/index.html" ]] && echo present || echo MISSING)"
for file in /usr/share/wayland-sessions/headunit-kiosk.desktop /usr/local/bin/headunit-session "$HOME_DIR/.config/headunit-labwc/autostart" "$HOME_DIR/.config/headunit-labwc/headunit-start.sh"; do
  [[ -s "$file" ]] && echo "OK: $file" || echo "MISSING: $file"
done
headsec 'Boot image'
[[ -f "$CMDLINE" ]] && { grep -oE '(^| )(quiet|splash|loglevel=[^ ]+)' "$CMDLINE" || true; } || echo 'Kernel cmdline not found'
command -v plymouth-set-default-theme >/dev/null 2>&1 && plymouth-set-default-theme || echo 'Plymouth unavailable'
headsec 'Backend'
systemctl is-active headunit.service 2>/dev/null || true
curl -fsS --max-time 3 http://127.0.0.1:8787/api/ui-health 2>/dev/null || echo 'Backend UI health check failed'
headsec 'Chromium'
pgrep -a -u "$USER_NAME" chromium 2>/dev/null | head -5 || true
headsec 'Last kiosk logs'
for name in labwc-session autostart kiosk-supervisor chromium; do
  f="$HOME_DIR/.local/state/rpi-headunit/$name.log"
  echo "--- $name ---"
  if [[ -f "$f" ]]; then tail -n 25 "$f"; else echo '[no log found]'; fi
done
headsec 'LightDM config state'
grep -h -E '^autologin-(session|user)=' /etc/lightdm/lightdm.conf 2>/dev/null || true
headsec 'Recent service failures'
journalctl -b -u headunit.service -u lightdm.service -p warning --no-pager -n 40 2>/dev/null || true
printf '\nFor repairs, run from installed project folder:\n  sudo ./deploy/setup-boot-experience.sh repair\n  sudo reboot\n'
