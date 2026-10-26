#!/usr/bin/env bash
# Optional one-time switch from Raspberry Pi OS desktop autologin to a self-contained
# mascot-themed kiosk. The regular desktop stays installed and can be restored.
# sudo ./deploy/setup-boot-experience.sh enable [username]
# sudo ./deploy/setup-boot-experience.sh disable
# sudo ./deploy/setup-boot-experience.sh status
# sudo ./deploy/setup-boot-experience.sh repair  # self-heal an already-enabled kiosk
# sudo ./deploy/setup-boot-experience.sh sync  # apply Boot Studio to Plymouth
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-status}"
STATE=/var/lib/headunit-boot-studio
LIGHTDM=/etc/lightdm/lightdm.conf
SESSION=/usr/share/wayland-sessions/headunit-kiosk.desktop
CMDLINE=/boot/firmware/cmdline.txt
[[ -f "$CMDLINE" ]] || CMDLINE=/boot/cmdline.txt
THEME_DIR=/usr/share/plymouth/themes/headunit
THEME_NAME=headunit
info(){ printf '[headunit-boot] %s\n' "$*"; }
fail(){ printf '[headunit-boot] ERROR: %s\n' "$*" >&2; exit 1; }
root(){ [[ $(id -u) == 0 ]] || fail "Run with sudo"; }


# Reconfigure an existing kiosk installation without overwriting the original
# system backups. This also runs during first enable. Browser launch is supervised
# so a compositor/browser race on cold boot does not strand the user at labwc's menu.
configure_session() {
  local username="$1" home="$2" group config_dir
  group="$(id -gn "$username")"
  config_dir="$home/.config/headunit-labwc"
  install -d -o "$username" -g "$group" -m 0755 "$config_dir"
  cat > "$config_dir/autostart" <<AUTOSTART
#!/bin/sh
# Dedicated session: no desktop, panel, or wallpaper processes.
# labwc runs this *after* exporting WAYLAND_DISPLAY.
mkdir -p "\$HOME/.local/state/rpi-headunit"
echo "\$(date -Is) labwc autostart reached" >> "\$HOME/.local/state/rpi-headunit/autostart.log"
"$PROJECT_DIR/deploy/kiosk-supervisor.sh" &
AUTOSTART
  chmod 0755 "$config_dir/autostart"
  cat > "$config_dir/headunit-start.sh" <<STARTUP
#!/bin/sh
"$PROJECT_DIR/deploy/kiosk-supervisor.sh" &
STARTUP
  chmod 0755 "$config_dir/headunit-start.sh"
  # Retain existing touch mapping; never import the full normal desktop autostart.
  if [[ ! -f "$config_dir/rc.xml" && -f "$home/.config/labwc/rc.xml" ]]; then
    cp -a "$home/.config/labwc/rc.xml" "$config_dir/rc.xml"
  fi
  chown -R "$username:$group" "$config_dir"

  cat >/usr/local/bin/headunit-session <<'SESSION_SCRIPT'
#!/bin/sh
# Head-unit-only Wayland session; intentionally no Raspberry Pi desktop.
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=labwc
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/rpi-headunit"
mkdir -p "$LOG_DIR"
printf '[%s] labwc launching uid=%s runtime=%s\n' "$(date -Is)" "$(id -u)" "${XDG_RUNTIME_DIR:-missing}" >>"$LOG_DIR/labwc-session.log"
# A second startup path independent of labwc's autostart file: if autostart
# is skipped on the first LightDM login, -s still starts the kiosk supervisor.
exec /usr/bin/labwc -C "$HOME/.config/headunit-labwc" -s "$HOME/.config/headunit-labwc/headunit-start.sh" >>"$LOG_DIR/labwc-session.log" 2>&1
SESSION_SCRIPT
  chmod 0755 /usr/local/bin/headunit-session
  cat > "$SESSION" <<'SESSION_DESKTOP'
[Desktop Entry]
Name=Head Unit Kiosk
Comment=Dedicated mascot kiosk session without Raspberry Pi OS desktop
Exec=/usr/local/bin/headunit-session
TryExec=/usr/bin/labwc
Type=Application
DesktopNames=labwc
SESSION_DESKTOP

  # Ensure the correct autologin session remains selected after updates.
  python3 - "$LIGHTDM" "$username" <<'PY_LIGHTDM'
from pathlib import Path
import sys
path=Path(sys.argv[1]); user=sys.argv[2]; lines=path.read_text().splitlines()
section='[Seat:*]'; out=[]; inside=False; found=False
for line in lines:
    if line.strip().startswith('[') and line.strip().endswith(']'):
        if inside:
            out += ['autologin-user='+user, 'autologin-user-timeout=0', 'autologin-session=headunit-kiosk']
        inside=line.strip()==section
        found |= inside
    if inside and line.strip().split('=',1)[0].strip().lstrip('#').strip() in ('autologin-user','autologin-user-timeout','autologin-session'):
        continue
    out.append(line)
if inside: out += ['autologin-user='+user, 'autologin-user-timeout=0', 'autologin-session=headunit-kiosk']
if not found: out += ['', section, 'autologin-user='+user, 'autologin-user-timeout=0', 'autologin-session=headunit-kiosk']
path.write_text('\n'.join(out)+'\n')
PY_LIGHTDM
}

# Rebuild both early mascot assets and boot flags. Do not change login backups.
refresh_early_splash() {
  [[ -d "$THEME_DIR" ]] || mkdir -p "$THEME_DIR"
  cp -f "$PROJECT_DIR/deploy/boot/headunit.plymouth" "$PROJECT_DIR/deploy/boot/headunit.script" \
    "$PROJECT_DIR/deploy/boot/plymouth-mascot.png" "$PROJECT_DIR/deploy/boot/plymouth-title.png" "$THEME_DIR/"
  if python3 -c 'from PIL import Image' >/dev/null 2>&1; then
    python3 "$PROJECT_DIR/deploy/boot/render-plymouth.py" "$THEME_DIR" "${HEADUNIT_DATA_DIR:-$PROJECT_DIR/data}" || info 'WARNING: custom Plymouth render failed; keeping packaged images.'
  fi
  if command -v plymouth-set-default-theme >/dev/null 2>&1; then
    plymouth-set-default-theme "$THEME_NAME" -R || info 'WARNING: Plymouth initramfs rebuild failed; see diagnosis.'
  else
    info 'WARNING: Plymouth is not installed; early Linux splash is unavailable.'
  fi
  if [[ -f "$CMDLINE" ]]; then
    python3 - "$CMDLINE" <<'PY_CMDLINE'
from pathlib import Path
import sys
p=Path(sys.argv[1]); args=p.read_text().strip().split()
for flag in ('quiet','splash','loglevel=3','vt.global_cursor_default=0','logo.nologo'):
    if flag not in args:args.append(flag)
p.write_text(' '.join(args)+'\n')
PY_CMDLINE
  fi
}

case "$COMMAND" in
  status)
    if [[ -f "$STATE/enabled" ]]; then
      info "Mascot startup ENABLED for $(cat "$STATE/user" 2>/dev/null || echo unknown)"
      info "Kiosk session: $SESSION"
      info "Early boot theme: $THEME_DIR"
    else info "Normal Pi OS startup (mascot kiosk not enabled)"; fi
    info "Backend (if running): $(systemctl is-active headunit.service 2>/dev/null || true)"
    exit 0
    ;;
  enable)
    root
    [[ -f "$LIGHTDM" ]] || fail "LightDM configuration not found: $LIGHTDM (unsupported display manager)"
    [[ -f "$CMDLINE" ]] || fail "Pi firmware cmdline.txt not found"
    command -v labwc >/dev/null || fail "labwc is missing; install Raspberry Pi OS Desktop or 'sudo apt install labwc'"
    command -v chromium >/dev/null || command -v chromium-browser >/dev/null || fail "Chromium is not installed. First run sudo ./install.sh."
    [[ -s "$PROJECT_DIR/apps/ui/dist/index.html" ]] || fail "Head unit UI is not built. First run sudo ./install.sh or install the ZIP via Software update."
    [[ -f "$PROJECT_DIR/deploy/boot/loading.html" ]] || fail 'Boot loader files missing.'
    TARGET_USER="${2:-${SUDO_USER:-}}"
    [[ -n "$TARGET_USER" && "$TARGET_USER" != root ]] || fail 'Specify desktop username: sudo ./deploy/setup-boot-experience.sh enable sound'
    TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
    [[ -n "$TARGET_HOME" && -d "$TARGET_HOME" ]] || fail "Unknown Linux user: $TARGET_USER"
    [[ ! -f "$STATE/enabled" ]] || { info 'Already enabled; repairing existing installation.'; COMMAND=repair; exec "$0" repair; }
    command -v plymouth-set-default-theme >/dev/null || {
      info 'Installing Plymouth for early boot splash.'
      apt-get update
      apt-get install -y plymouth plymouth-themes
    }
    mkdir -p "$STATE" "$THEME_DIR" /usr/share/wayland-sessions
    # These pristine copies are deliberately not overwritten by a second install.
    cp -a "$LIGHTDM" "$STATE/lightdm.original"
    cp -a "$CMDLINE" "$STATE/cmdline.original"
    printf '%s\n' "$CMDLINE" > "$STATE/cmdline.path"
    printf '%s\n' "$TARGET_USER" > "$STATE/user"
    printf '%s\n' "$TARGET_HOME" > "$STATE/home"
    (plymouth-set-default-theme 2>/dev/null || true) > "$STATE/plymouth.original"
    # Changes to login/boot MUST be transactional: on installer failure revert
    # the saved OS configuration before exiting.
    boot_enable_failed() {
      info 'Boot setup interrupted; restoring previous login and boot configuration.'
      cp -a "$STATE/lightdm.original" "$LIGHTDM" || true
      cp -a "$STATE/cmdline.original" "$CMDLINE" || true
      rm -f "$SESSION" /usr/local/bin/headunit-session "$STATE/enabled"
      if [[ -s "$STATE/plymouth.original" ]]; then
        plymouth-set-default-theme "$(head -1 "$STATE/plymouth.original")" -R || true
      fi
    }
    trap boot_enable_failed ERR
    configure_session "$TARGET_USER" "$TARGET_HOME"
    refresh_early_splash
    touch "$STATE/enabled"
    trap - ERR
    info 'Enabled. REBOOT to use the splash and isolated kiosk session.'
    info 'IMPORTANT: Ensure SSH is enabled or you can access a spare console (Ctrl+Alt+F2).'
    info "Recovery: sudo $PROJECT_DIR/deploy/setup-boot-experience.sh disable && sudo reboot"
    ;;
  repair)
    root
    [[ -f "$STATE/enabled" ]] || fail 'Mascot kiosk is not enabled; first run: sudo ./deploy/setup-boot-experience.sh enable YOUR_USER'
    [[ -f "$LIGHTDM" && -f "$CMDLINE" ]] || fail 'Pi OS LightDM or boot files missing. Do not change boot settings automatically.'
    [[ -s "$PROJECT_DIR/apps/ui/dist/index.html" ]] || fail 'Built UI missing; install or build Head Unit before repairing the kiosk.'
    command -v labwc >/dev/null || fail 'labwc missing.'
    command -v chromium >/dev/null || command -v chromium-browser >/dev/null || fail 'Chromium missing.'
    user="$(cat "$STATE/user")"
    home="$(getent passwd "$user" | cut -d: -f6)"
    [[ -n "$home" && -d "$home" ]] || fail "Kiosk user no longer exists: $user"
    info "Repairing mascot kiosk session for $user"
    configure_session "$user" "$home"
    refresh_early_splash
    # Avoid silently restarting the graphical session during update or recovery.
    info 'Repair complete. Reboot to activate the corrected kiosk startup.'
    info "Run: sudo $PROJECT_DIR/deploy/diagnose-boot.sh (to see readiness, logs and boot checks)"
    info "Recovery: sudo $PROJECT_DIR/deploy/setup-boot-experience.sh disable && sudo reboot"
    ;;
  sync)
    root
    [[ -f "$STATE/enabled" ]] || fail "Mascot kiosk is not enabled yet. First, from your installed project directory, run: sudo ./deploy/setup-boot-experience.sh enable ${SUDO_USER:-your-desktop-user} ; then sudo reboot. Only run sync after enabling and saving later Boot Studio changes."
    [[ -d "$THEME_DIR" ]] || fail "Missing installed Plymouth theme: $THEME_DIR"
    command -v plymouth-set-default-theme >/dev/null || fail 'Plymouth is not installed'
    python3 -c 'from PIL import Image' >/dev/null 2>&1 || fail 'Install Pillow: sudo apt install python3-pil'
    python3 "$PROJECT_DIR/deploy/boot/render-plymouth.py" "$THEME_DIR" "${HEADUNIT_DATA_DIR:-$PROJECT_DIR/data}"
    plymouth-set-default-theme "$THEME_NAME" -R || fail 'Could not rebuild early boot initramfs'
    info 'Early Linux boot graphics updated. The HTML kiosk loader uses saved Boot Studio settings automatically.'
    ;;
  disable)
    root
    [[ -f "$STATE/enabled" ]] || { info 'Already disabled'; exit 0; }
    # Restore the exact boot/login files that were present before enabling.
    [[ -f "$STATE/lightdm.original" ]] && cp -a "$STATE/lightdm.original" "$LIGHTDM"
    [[ -f "$STATE/cmdline.original" ]] && cp -a "$STATE/cmdline.original" "$(cat "$STATE/cmdline.path")"
    if [[ -s "$STATE/plymouth.original" ]] && command -v plymouth-set-default-theme >/dev/null; then
      plymouth-set-default-theme "$(head -1 "$STATE/plymouth.original")" -R || info 'WARNING: Could not restore original Plymouth theme.'
    fi
    rm -f "$SESSION" /usr/local/bin/headunit-session "$STATE/enabled"
    info 'Restored original Pi OS desktop autologin configuration. Reboot to apply.'
    ;;
  *) fail 'Usage: sudo ./deploy/setup-boot-experience.sh enable [desktop-user] | repair | sync | disable | status' ;; 
esac
