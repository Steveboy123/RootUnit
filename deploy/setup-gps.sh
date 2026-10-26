#!/usr/bin/env bash
# Configure gpsd for an already-connected DFRobot USB GPS without touching other services.
set -euo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Run as: sudo ./deploy/setup-gps.sh'; exit 1; }
apt-get update && apt-get install -y gpsd gpsd-clients
mapfile -t DEVICES < <(find /dev/serial/by-id -maxdepth 1 -type l 2>/dev/null | sort)
if (( ${#DEVICES[@]} == 0 )); then
  mapfile -t DEVICES < <(find /dev -maxdepth 1 \( -name 'ttyACM*' -o -name 'ttyUSB*' \) -print 2>/dev/null | sort)
fi
if (( ${#DEVICES[@]} == 0 )); then
  echo 'No GPS serial device found. Plug the USB DFRobot receiver in and check: lsusb; dmesg | tail -30' >&2
  exit 1
fi
echo 'Available USB serial devices:'
printf ' - %s\n' "${DEVICES[@]}"
DEVICE="${GPS_DEVICE:-${DEVICES[0]}}"
[[ -c "$(readlink -f "$DEVICE")" ]] || { echo "Not a serial device: $DEVICE" >&2; exit 1; }
if [[ -f /etc/default/gpsd ]]; then cp -n /etc/default/gpsd /etc/default/gpsd.headunit-backup || true; fi
cat >/etc/default/gpsd <<CFG
START_DAEMON="true"
USBAUTO="true"
DEVICES="$DEVICE"
GPSD_OPTIONS="-n"
CFG
systemctl enable --now gpsd.socket
systemctl restart gpsd.socket
systemctl restart gpsd.service 2>/dev/null || true
printf '\nGPS configured: %s\nTest: timeout 8 gpspipe -w | head -5\n' "$DEVICE"
