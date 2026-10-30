# Radio

**Internet radio works today.** Over-the-air FM/DAB+ needs a tuner you don't have
yet — see "Over-the-air" below for the options and what I'd need to know.

## Internet radio

Music → **Radio** tab. Tap a station to play; ★ favourites float to the top and feed
the **Radio presets** widget (one-tap buttons, like a car radio); **Find** searches the
[radio-browser.info](https://www.radio-browser.info) directory or adds a stream by URL;
the pencil toggles delete buttons.

How it works (`apps/server/src/radio/`):

* The Pi's backend fetches the stream, **strips the Shoutcast/Icecast "now playing"
  metadata out of the audio** (so players never see junk bytes), shows it as the
  track line, and re-serves clean audio from `/api/radio/stream/<id>` on the same
  origin. The browser plays it with a plain `<audio>` element — no CORS issues, no
  extra software to install, and it works the same on Windows.
* If the stream drops, the player reconnects (1.5 s → 10 s backoff) and the UI says
  "retrying".
* Starting radio pauses Spotify; starting Spotify later stops radio.
* Stations, favourites and the last station persist in `data/radio.json`. Radio
  never starts by itself at boot.

Verified here: the metadata stripper (fuzzed with random chunk boundaries), the proxy
(headers, errors, client-disconnect cleanup), persistence, and a real browser
decoding a real MP3 stream with metadata end-to-end.

**Not verified:**

* The four built-in stations (SomaFM ×2, Radio Paradise, FIP) and the station search
  — the build environment couldn't reach the internet. If one is dead you'll see an
  error and can delete it; if search fails, "Add by stream URL" still works.
* Very old Shoutcast v1 servers that answer `ICY 200 OK` instead of `HTTP/1.1` may be
  rejected by Node's HTTP parser. Icecast and modern Shoutcast are fine.
* Typing needs an on-screen keyboard on the touchscreen (e.g. `squeekboard` or
  `onboard`); search/URL entry works with a normal keyboard.
* Radio needs the phone's hotspot or another internet link in the car.

## Can a Pi get radio with no dongle?

Two different things get mixed up here:

* **Internet radio** needs no tuner at all — that's what's built and working (above). It
  only needs an internet link.
* **Over-the-air FM/DAB+ *reception*** needs a tuner: I looked for a way to do it with the Pi's
  own parts and found none. Every receive project I found uses a tuner chip (e.g. Si4731) or an
  RTL-SDR dongle. If you know of a specific project that does it, send me the link and I'll read it.
* What a Pi *can* do with no extra parts is **transmit** FM: PiFmRds and fm_transmitter turn
  GPIO4 plus a bit of wire into a low-power FM transmitter that any nearby radio can pick up
  (that's the "make its own broadcast" trick). Their docs cover the Pi 1–3; **I found nothing
  saying it works on a Pi 5**, whose GPIO sits behind a different chip — assume it doesn't until
  someone shows otherwise. Transmitting is also regulated (very low power only, and illegal in
  some places). And you don't need it: the Pi's RCA audio HAT already feeds an amplifier directly,
  which sounds better than going out over FM.

## Over-the-air (FM / DAB+)

Nothing in a Raspberry Pi receives radio by itself. The plan is to make each tuner
just another station whose "stream" is a local URL, so the same UI, presets and
now-playing work:

| Standard | Hardware | Software idea |
| --- | --- | --- |
| **DAB+** (EU, UK, AU…) | RTL-SDR dongle (~$30, antenna matters) | [`welle.io`](https://www.welle.io)'s `welle-cli` can run headless and serve each service as an HTTP audio stream plus a station list and dynamic label — a good fit. |
| **FM + RDS** (everywhere) | RTL-SDR dongle, or an I²C FM tuner chip board (e.g. Si470x/Si4731/TEA5767 class) | `rtl_fm` → `ffmpeg` → local HTTP stream; RDS text via `redsea`. Chips with a Linux driver can be simpler but audio quality/antenna varies. |
| **HD Radio / SiriusXM** | — | Not practical on a Pi. |

Antenna and in-car noise decide quality more than software. **I haven't built this
because it needs your hardware and region to be real.**

**To decide:** which country are you in (FM only, or DAB+ too), and are you happy to buy
an RTL-SDR dongle?
