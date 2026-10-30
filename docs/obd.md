# OBD-II (real vehicle data)

The gauges, trip computer, check-engine alert and **fault codes** can come from your car
through an ELM327 OBD-II adapter instead of the simulator.

**Status:** the whole path is built and tested — against a fake ELM327 over TCP, *and* through
a real serial device (a Linux pseudo-terminal that behaves like `/dev/rfcomm0`) using the same
`serialport` code the Pi runs. It has **not** been run against a real car or a real Bluetooth
adapter. Expect to adjust once.

## What you need to know first

* **Classic Bluetooth only (for now).** Most cheap "ELM327 Bluetooth" adapters are *classic*
  Bluetooth (they pair with a PIN and show up as a serial port). Newer "Bluetooth 4.0 / BLE"
  adapters (e.g. some Vgate/OBDLink-CX/Veepeak BLE models) are a different, Bluetooth-LE
  protocol and **won't work yet** — tell me which you have. A Wi-Fi adapter also works
  (`OBD_PORT=tcp://192.168.0.10:35000`), as does a USB one (`/dev/ttyUSB0`).
* **Cheap clones lie.** Many ELM327 clones are slow, drop connections, or mis-report. The app
  never invents values: a reading the car doesn't provide shows "—", and with no live link
  every gauge shows "—" rather than the last number.

## Try it with no car (works on Windows)

```sh
npm run obd:emulator            # a pretend car + ELM327, driven by the simulator
# in another terminal:
set VEHICLE_PROVIDER=obd        # (PowerShell: $env:VEHICLE_PROVIDER="obd")
set OBD_PORT=tcp://127.0.0.1:35000
npm run dev
```

Emulator flags: `--faults` (stored + pending fault codes), `--limited` (a car that only gives
RPM, speed and coolant — watch the other gauges show "—"), `--off` (ignition off for 10 s,
then on), `--iso` (an older non-CAN protocol), `--port N`. Stop it mid-drive to watch the app
report the lost adapter and reconnect by itself when you start it again.

## On the Pi with a Bluetooth adapter

1. **Pair it** (plug the adapter into the car's OBD port first so it has power):

   ```sh
   bluetoothctl
   > agent on
   > default-agent
   > scan on                  # wait for "OBDII" / "V-LINK" / "ELM327"…
   > pair AA:BB:CC:11:22:33   # PIN is usually 1234 (sometimes 0000)
   > trust AA:BB:CC:11:22:33
   > quit
   ```

2. **Bind it to a serial device.** Edit `deploy/obd-rfcomm.service` (your adapter's address;
   RFCOMM channel is almost always `1` — `sdptool browse <address>` shows it), then:

   ```sh
   sudo cp deploy/obd-rfcomm.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now obd-rfcomm
   ls -l /dev/rfcomm0
   ```

   `rfcomm bind` is the long-standing recipe (it's what the python-OBD guides use), but the
   `rfcomm` tool is marked deprecated in BlueZ — **check `which rfcomm` on your OS version**; if
   it's missing, tell me and I'll add another way to open the adapter.

3. **Point the app at it** in `.env` and restart the backend:

   ```ini
   VEHICLE_PROVIDER=obd
   OBD_PORT=/dev/rfcomm0
   ```

   The user running the backend must be in the `dialout` group (the `headunit.service` file does
   this for you).

On **Windows**, pair the adapter normally; Windows creates a COM port ("Standard Serial over
Bluetooth link") — use `OBD_PORT=COM5` (your number). Untested.

## What you'll see

* **Top bar pill** whenever there's no live data: *OBD offline* (adapter unreachable/lost),
  *Car off* (adapter fine, car silent — ignition off), *Connecting…*. It retries on its own:
  every few seconds while the car is off, with backoff if the adapter itself drops.
* **Vehicle page** (open it from the Apps screen; you can also add it to the navigation, see [navigation.md](navigation.md)): connection status, adapter name and protocol, every
  reading the car provides (and "not provided" for ones it doesn't), the **check-engine lamp**,
  and **fault codes**.
* An **alert banner** when the check-engine lamp is on.

### Readings

Speed, RPM, coolant temp, intake temp, outside temp, throttle, engine load, fuel level and
battery voltage (Mode 01 PIDs `0D 0C 05 0F 46 11 04 2F 42`, SAE J1979 formulas — covered by
unit tests). Speed and RPM refresh fastest; the rest rotate through. If the car has no
module-voltage PID, battery voltage falls back to the adapter's own measurement (OBD pin 16).
The trip computer (distance, time, average, top speed) integrates the speed readings.

### Fault codes

*Read codes* shows **stored** and **pending** codes with a description for the ~25 most common
generic codes; manufacturer-specific codes (e.g. `P1171`) are shown **without a made-up
meaning**. *Clear codes* needs a second tap and warns that it **resets the emissions readiness
monitors** (days of driving before an inspection passes) — fix the cause first. Most cars only
accept clearing with the engine off; if the car refuses you'll see why.

## Not done / not verified

* **Real adapter and real car** — see Status. In particular, behaviour of specific clones
  (timeouts, odd replies) is unknown until you try.
* BLE adapters (above). Manufacturer-specific PIDs/diagnostics (hybrid battery, oil temp on many
  cars, transmission). Freeze-frame data. Fuel economy (needs MAF/fuel-rate PIDs — easy to add).
* Windows Bluetooth COM ports.
