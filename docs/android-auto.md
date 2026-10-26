# Android Auto — wired USB (v0.5.0)

The Pi 5 head unit now uses a native **USB Android Auto receiver**, not phone-hotspot mode and not Android Auto's developer Head Unit Server, ADB TCP 5277 or 5288 forwarding.

1. Install the normal head-unit app with `sudo ./install.sh` (this does not automatically download a large native receiver).
2. In the same project directory, **as your desktop user, without sudo**, run `./deploy/install-livi-wired.sh`. This pins and SHA256-verifies an ARM64 AppImage release of [LIVI](https://github.com/f-io/LIVI). It will set `PROJECTION_COMMAND` in `.env` to `deploy/livi-runtime.sh`.
3. Restart the Node backend with `sudo systemctl restart headunit.service`. Ensure you're on Raspberry Pi OS 64-bit with a working labwc/Wayland desktop.
4. Use a good USB data cable to plug your Android phone into a Pi USB-A host port; unlock the phone. On the Head Unit, open **Android Auto** and select **Start USB Android Auto** once detected.
5. LIVI itself may need first-run USB permissions or audio/input configuration; check upstream documentation. If it requests helper installation, do not grant privileges blindly: review the helper first.

**Important:** The screen showing "USB detected" only means the Pi can see a manufacturer USB ID. It does **not** prove that LIVI negotiated Android Auto, or that sound/touch/microphone/phone calls work. Real vehicle/phone testing is required. LIVI appears as its own native window; the existing dashboard and saved widgets remain separate. The old `deploy/install-android-auto.sh` command is now just an alias to `deploy/install-livi-wired.sh`.

Configuration options:

```
PROJECTION_COMMAND=/path/to/headunit/deploy/livi-runtime.sh
PROJECTION_MODE=ondemand
ANDROID_AUTO_DEV_ENABLED=0
```

To use another legitimate wired receiver, set `PROJECTION_COMMAND` to its executable or wrapper. Never set it to the old `openauto-runtime.sh` as a USB receiver: OpenAuto Prodigy as previously configured was wireless-only.

Diagnosis:

```bash
lsusb
ls -l /dev/bus/usb
sudo journalctl -u headunit -n 100 --no-pager
```

Use **Back to dashboard** to stop the on-demand projection process and return to Chromium. If LIVI fails to receive touch or audio, check LIVI's own device-access setup, PipeWire and input handling. This is an integration scaffold, not a hardware-validated in-car projection build.
