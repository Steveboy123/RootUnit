#!/usr/bin/env python3
"""
FM transmitter helper for the head unit ("fm_node.py").

It sits between the head unit and the vendored `fm_transmitter` program (vendor/fm_transmitter, BSD-3, unmodified) and is the ONLY
thing that ever starts that program. The program turns a Raspberry Pi's GPIO clock into a weak FM transmitter, needs root and
/dev/mem, works on the Pi Zero to Pi 4 only, and checks nothing about what it is asked to do. So this file does all the checking:

  * Board check, first and always. The program is never started unless /proc/device-tree says the board is one it is known to work
    on AND the hardware address list agrees with the model name. On a Pi 5, an unknown board, or a machine with no device tree (any
    PC), the helper still runs and answers, but says "not supported" and refuses to start the transmitter.
  * Validation. Frequency and bandwidth come in as JSON, are checked against a hard band (76 to 108 MHz) and the configured
    band, rounded to 0.05 MHz, and reach the program as a plain argument list (no shell).
  * A password (TOKEN) for every request, compared in constant time and never written to the log or to an answer.
  * A dead-man timer: if nothing authenticated has been heard for DEADMAN_S seconds, the transmitter is switched off.
  * A real-time pump. The program reads a WAV stream on stdin and treats one second without data as the end of the file, so we
    write our own WAV header, then exactly 22050 samples per second of either the head unit's sound or silence, paced on the
    monotonic clock, whether or not anyone is connected.

Wire protocol (FM_PROTOCOL 1, see packages/shared/src/fm.ts):
  Control, HTTP/1.1 + JSON, port 8788:  GET /v1/status   POST /v1/start {"frequency":100.6,"bandwidth":100}   POST /v1/stop
                                        every request carries "Authorization: Bearer <token>"
  Audio, raw TCP, port 8789:            "AUDIO 1 <token>\\n" -> "OK\\n" or "ERR <reason>\\n", then raw S16LE mono 22050 Hz

Python 3.9 or newer, standard library only. Runs as root under systemd (deploy/fm-node/headunit-fm-node.service).
"""
import argparse
import array
import collections
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import threading
import time

VERSION = "1.0.0"
PROTOCOL = 1

DEFAULT_CONFIG = "/etc/headunit-fm-node.conf"
DEFAULT_BINARY = "/usr/local/lib/headunit-fm/fm_transmitter"
DEFAULT_MODEL_FILE = "/proc/device-tree/model"
DEFAULT_RANGES_FILE = "/proc/device-tree/soc/ranges"

# What is sent to the transmitter program: one format only, the one it documents and handles (22050 Hz, mono, signed 16 bit).
SAMPLE_RATE = 22050
TICK_S = 0.02                  # the pump writes one block every 20 ms...
TICK_SAMPLES = 441             # ...of 441 samples = 20 ms at 22050 Hz...
TICK_BYTES = TICK_SAMPLES * 2  # ...= 882 bytes
RING_MAX_BYTES = 17640         # 400 ms: the most sound held back for the pump; beyond that the oldest is dropped
PREFILL_BYTES = 4410           # 100 ms: how much must be waiting before the pump starts to play it (and again after an underrun)
PIPE_LEAD_TICKS = 10           # 200 ms of silence written ahead of real time, so a late tick cannot starve the program's reads
CHILD_BACKLOG_MAX = 88200      # 2 s: if the program stops reading, drop the oldest beyond this instead of growing
MAX_CATCHUP_TICKS = 50         # a stalled pump writes up to 1 s of missed blocks at once, then gives up and restarts the schedule
LEVEL_DECAY = 0.92             # per tick: the level meter falls by about half in 170 ms
# The program counts the stream with an unsigned 32 bit number. We promise 0xFFFFFFFF and restart it well before that is used up.
WAV_DATA_LIMIT = 0xFFFFFFFF
ROLLOVER_BYTES = 3_900_000_000  # about 24.5 hours of audio

TERM_GRACE_S = 2.0        # SIGTERM first, SIGKILL after this
START_SETTLE_S = 0.4      # after starting, wait this long to notice a program that fails at once
SPAWN_MIN_GAP_S = 5.0     # a spawn that failed is not tried again for this long
SUPERVISE_S = 0.1

# Resource limits
REQUEST_TIMEOUT_S = 5.0       # a whole HTTP request, headers and body, must arrive within this
AUDIO_HELLO_TIMEOUT_S = 3.0   # the "AUDIO 1 <token>" line must arrive within this
AUDIO_HELLO_MAX = 128
MAX_HEAD_BYTES = 8192
MAX_BODY_BYTES = 1024
MAX_HEADERS = 40
AUTH_DELAY_S = 0.2            # wrong password: wait this long (one failure at a time, so about 5 guesses a second in total)
CONTROL_MAX_CONNECTIONS = 24
CONTROL_MAX_PER_IP = 8
AUDIO_MAX_CONNECTIONS = 12
AUDIO_MAX_PER_IP = 4

HARD_FREQ_MIN = 76.0          # whatever the config says, never outside this
HARD_FREQ_MAX = 108.0
BANDWIDTH_MIN = 25
BANDWIDTH_CEIL = 150          # +-75 kHz, what broadcast FM allows
DEFAULT_BANDWIDTH = 100       # the documented value
FREQ_GRID = 20                # 0.05 MHz steps

SILENCE = bytes(TICK_BYTES)


def log(message):
    """One line to stderr (journald adds the time). Never given a password, a request body or a header."""
    try:
        sys.stderr.write("fm-node: " + message + "\n")
        sys.stderr.flush()
    except Exception:
        pass


class ThrottledLog:
    """The same kind of event is logged at most once every `every` seconds, with a count of the ones skipped."""

    def __init__(self, every=10.0):
        self.every = every
        self._lock = threading.Lock()
        self._last = {}
        self._skipped = {}

    def __call__(self, key, message):
        now = time.monotonic()
        with self._lock:
            last = self._last.get(key)
            if last is not None and now - last < self.every:
                self._skipped[key] = self._skipped.get(key, 0) + 1
                return
            skipped = self._skipped.pop(key, 0)
            self._last[key] = now
        log(message + (" (%d more since the last report)" % skipped if skipped else ""))


_UNSAFE_TEXT = re.compile("[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def clean_text(value, limit=300):
    """Text from outside (program output, a model string) made safe to show: no control characters, one line, cut short."""
    if isinstance(value, (bytes, bytearray)):
        value = bytes(value).decode("utf-8", "replace")
    value = _UNSAFE_TEXT.sub(" ", str(value))
    return " ".join(value.split())[:limit]


def fmt_mhz(value):
    """87.5 -> "87.5", 108 -> "108.0", 87.55 -> "87.55" (for sentences)."""
    text = "%.2f" % value
    return text[:-1] if text.endswith("0") else text


# ------------------------------------------------------------------------------------------------------------------------------
# Board check
# ------------------------------------------------------------------------------------------------------------------------------

Board = collections.namedtuple("Board", "supported model reason")

# The peripheral base address each family of chip reports in /proc/device-tree/soc/ranges. The program picks its clock speed from it
# (PLLD 500 MHz, or 750 MHz when the base is 0xfe000000), so a model name and an address that disagree would put the signal on the
# wrong frequency. Both must agree.
_BCM2835 = 0x20000000  # Pi Zero, Pi 1
_BCM2836 = 0x3F000000  # Pi 2, Pi 3, Pi Zero 2 W
_BCM2711 = 0xFE000000  # Pi 4, Pi 400, CM4
_ALLOWED_BASES = (_BCM2835, _BCM2836, _BCM2711)
_REV = r"(?: Rev [0-9]+(?:\.[0-9]+)?)?"
_PLUS = r"(?:\+| Plus)"
_KNOWN_BOARDS = [
    (re.compile(pattern + _REV, re.ASCII), base)
    for pattern, base in (
        (r"Raspberry Pi Zero", _BCM2835),
        (r"Raspberry Pi Zero W", _BCM2835),
        (r"Raspberry Pi Model A", _BCM2835),
        (r"Raspberry Pi Model A\+", _BCM2835),
        (r"Raspberry Pi Model B", _BCM2835),
        (r"Raspberry Pi Model B\+", _BCM2835),
        (r"Raspberry Pi Compute Module", _BCM2835),
        (r"Raspberry Pi 2 Model B", _BCM2836),
        (r"Raspberry Pi 3 Model B", _BCM2836),
        (r"Raspberry Pi 3 Model B" + _PLUS, _BCM2836),
        (r"Raspberry Pi 3 Model A" + _PLUS, _BCM2836),
        (r"Raspberry Pi Zero 2 W", _BCM2836),
        (r"Raspberry Pi Compute Module 3", _BCM2836),
        (r"Raspberry Pi Compute Module 3" + _PLUS, _BCM2836),
        (r"Raspberry Pi 4 Model B", _BCM2711),
        (r"Raspberry Pi 400", _BCM2711),
        (r"Raspberry Pi Compute Module 4", _BCM2711),
        (r"Raspberry Pi Compute Module 4S", _BCM2711),
    )
]
_PI5_FAMILY = re.compile(r"Raspberry Pi (?:5|500|Compute Module 5)(?: .*)?", re.ASCII)
_WORKS_ON = "It works only on a Raspberry Pi Zero, 2, 3 or 4."


def _read_small(path, limit):
    try:
        with open(path, "rb") as handle:
            return handle.read(limit)
    except (OSError, ValueError):
        return None


def peripheral_base(ranges):
    """The address the program would map /dev/mem at: bytes 4 to 8 of `ranges`, or 8 to 12 when those are zero (as upstream does)."""
    if ranges is None or len(ranges) < 8:
        return None
    base = int.from_bytes(ranges[4:8], "big")
    if base == 0:
        if len(ranges) < 12:
            return None
        base = int.from_bytes(ranges[8:12], "big")
    return base


def check_board(model_file=DEFAULT_MODEL_FILE, ranges_file=DEFAULT_RANGES_FILE):
    """Is this board one the transmitter program is known to work on? Never raises. `reason` is a plain sentence when it is not."""
    raw = _read_small(model_file, 256)
    if not raw:
        return Board(False, None, "This computer does not say which Raspberry Pi it is, so the FM transmitter will not start here. " + _WORKS_ON)
    text = raw.rstrip(b"\x00\r\n \t").decode("ascii", "replace")
    shown = clean_text(text, 100)
    if not shown:
        return Board(False, None, "This computer does not say which Raspberry Pi it is, so the FM transmitter will not start here. " + _WORKS_ON)
    if _PI5_FAMILY.fullmatch(text):
        return Board(False, shown, "This is a %s. The transmitter program does not work on the Raspberry Pi 5 family (it has a different chip), "
                                   "so it will not start here. Use a second Pi, a Zero 2 W, 3 or 4, for FM." % shown)
    expected = [base for pattern, base in _KNOWN_BOARDS if pattern.fullmatch(text)]
    if not expected:
        return Board(False, shown, "\"%s\" is not a board the transmitter program is known to work on, so it will not start here. %s" % (shown, _WORKS_ON))
    base = peripheral_base(_read_small(ranges_file, 64))
    if base is None:
        return Board(False, shown, "This board's hardware address list could not be read, so the transmitter program will not start here.")
    if base not in _ALLOWED_BASES:
        return Board(False, shown, "This board reports a hardware address (0x%08x) the transmitter program does not know, so it will not start here." % base)
    if base not in expected:
        return Board(False, shown, "This board's name and its hardware address do not agree, so the transmitter program will not start here.")
    return Board(True, shown, None)


# ------------------------------------------------------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------------------------------------------------------

class ConfigError(Exception):
    pass


CONFIG_KEYS = ("TOKEN", "BIND", "CONTROL_PORT", "AUDIO_PORT", "BIN", "DMA", "FREQ_MIN", "FREQ_MAX", "BANDWIDTH_MAX", "DEADMAN_S")
_KEY_RE = re.compile(r"[A-Z][A-Z0-9_]{0,39}", re.ASCII)
_TOKEN_RE = re.compile(r"[\x21-\x7e]{16,100}")
_NUMBER_RE = re.compile(r"[0-9]{1,3}(?:\.[0-9]{1,4})?", re.ASCII)
_INT_RE = re.compile(r"[0-9]{1,6}", re.ASCII)


def parse_config_text(text):
    """KEY=VALUE lines, # comments. Returns (values, warnings). A warning never contains a value (it could be the password)."""
    values = {}
    warnings = []
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, sep, value = stripped.partition("=")
        key = key.strip()
        if not sep or not _KEY_RE.fullmatch(key):
            warnings.append("line %d of the config file is not KEY=VALUE and was ignored" % number)
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key not in CONFIG_KEYS:
            warnings.append("the setting %s in the config file is not known and was ignored" % key)
            continue
        if key in values:
            warnings.append("%s appears more than once in the config file; the last one is used" % key)
        values[key] = value
    return values, warnings


class Config:
    """Everything the helper needs, checked. Build it with build_config()."""

    def __init__(self):
        self.token = ""
        self.bind = "127.0.0.1"
        self.control_port = 8788
        self.audio_port = 8789
        self.binary = DEFAULT_BINARY
        self.dma = 0
        self.freq_min = 87.5
        self.freq_max = 108.0
        self.bandwidth_max = BANDWIDTH_CEIL
        self.deadman_s = 30
        self.model_file = DEFAULT_MODEL_FILE
        self.ranges_file = DEFAULT_RANGES_FILE


def _config_int(values, key, default, low, high, what):
    if key not in values or values[key] == "":
        return default
    if not _INT_RE.fullmatch(values[key]):
        raise ConfigError("%s in the config file must be a whole number (%s)." % (key, what))
    number = int(values[key])
    if number < low or number > high:
        raise ConfigError("%s in the config file must be between %d and %d (%s)." % (key, low, high, what))
    return number


def _config_freq(values, key, default):
    if key not in values or values[key] == "":
        return default
    if not _NUMBER_RE.fullmatch(values[key]):
        raise ConfigError("%s in the config file must be a frequency in MHz like 88.1." % key)
    return float(values[key])


def build_config(values, warnings, overrides=None):
    """Check the settings and apply the command-line overrides. Raises ConfigError with a plain sentence."""
    overrides = overrides or {}
    cfg = Config()
    token = values.get("TOKEN", "")
    if len(token) < 16:
        raise ConfigError("TOKEN is missing or shorter than 16 characters. Run deploy/setup-fm.sh to create one, or set a long random TOKEN in the config file.")
    if not _TOKEN_RE.fullmatch(token):
        raise ConfigError("TOKEN must be 16 to 100 plain characters with no spaces (letters and digits are best).")
    cfg.token = token

    bind = overrides.get("bind") or values.get("BIND") or "127.0.0.1"
    try:
        ipaddress.ip_address(bind)
    except ValueError:
        raise ConfigError("BIND must be an IP address such as 127.0.0.1 (this computer only) or 0.0.0.0 (every network).")
    cfg.bind = bind

    control = overrides.get("control_port")
    audio = overrides.get("audio_port")
    cfg.control_port = control if control is not None else _config_int(values, "CONTROL_PORT", 8788, 0, 65535, "a port")
    cfg.audio_port = audio if audio is not None else _config_int(values, "AUDIO_PORT", 8789, 0, 65535, "a port")
    if cfg.control_port and cfg.control_port == cfg.audio_port:
        raise ConfigError("CONTROL_PORT and AUDIO_PORT must be different.")

    binary = overrides.get("binary") or values.get("BIN") or DEFAULT_BINARY
    if not binary.startswith("/") or "\x00" in binary:
        raise ConfigError("BIN must be the full path of the transmitter program.")
    cfg.binary = binary

    cfg.dma = _config_int(values, "DMA", 0, 0, 15, "a DMA channel")
    cfg.deadman_s = _config_int(values, "DEADMAN_S", 30, 1, 3600, "seconds")

    low = _config_freq(values, "FREQ_MIN", 87.5)
    high = _config_freq(values, "FREQ_MAX", 108.0)
    if low < HARD_FREQ_MIN or high > HARD_FREQ_MAX:
        warnings.append("FREQ_MIN and FREQ_MAX are kept inside %s to %s MHz" % (fmt_mhz(HARD_FREQ_MIN), fmt_mhz(HARD_FREQ_MAX)))
    # Round inwards to the 0.05 MHz grid, so rounding a value that passed the check can never leave the band.
    low = math.ceil(max(low, HARD_FREQ_MIN) * FREQ_GRID - 1e-6) / FREQ_GRID
    high = math.floor(min(high, HARD_FREQ_MAX) * FREQ_GRID + 1e-6) / FREQ_GRID
    if low > high:
        raise ConfigError("FREQ_MIN must be lower than FREQ_MAX (and the band must lie between %s and %s MHz)." % (fmt_mhz(HARD_FREQ_MIN), fmt_mhz(HARD_FREQ_MAX)))
    cfg.freq_min, cfg.freq_max = low, high

    ceiling = _config_int(values, "BANDWIDTH_MAX", BANDWIDTH_CEIL, 0, 100000, "kHz")
    if ceiling < BANDWIDTH_MIN:
        raise ConfigError("BANDWIDTH_MAX in the config file must be at least %d (kHz)." % BANDWIDTH_MIN)
    if ceiling > BANDWIDTH_CEIL:
        warnings.append("BANDWIDTH_MAX is kept at %d kHz" % BANDWIDTH_CEIL)
        ceiling = BANDWIDTH_CEIL
    cfg.bandwidth_max = ceiling

    cfg.model_file = overrides.get("model_file") or DEFAULT_MODEL_FILE
    cfg.ranges_file = overrides.get("ranges_file") or DEFAULT_RANGES_FILE
    return cfg


def load_config(path, overrides=None):
    """Read and check the config file. Returns (Config, warnings). Raises ConfigError."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(65536 + 1)
        mode = os.stat(path).st_mode
    except OSError:
        raise ConfigError("The config file %s cannot be read. Run deploy/setup-fm.sh to create it." % path)
    if len(raw) > 65536:
        raise ConfigError("The config file %s is far too big." % path)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ConfigError("The config file %s is not plain text." % path)
    values, warnings = parse_config_text(text)
    if mode & 0o077:
        warnings.append("the config file %s can be read by other users; run: chmod 600 %s" % (path, path))
    return build_config(values, warnings, overrides), warnings


# ------------------------------------------------------------------------------------------------------------------------------
# What we send the transmitter program
# ------------------------------------------------------------------------------------------------------------------------------

def wav_header():
    """
    The 44 bytes the program's WaveReader accepts (vendor/fm_transmitter/wave_reader.cpp): RIFF/WAVE, a 16 byte `fmt ` chunk for PCM,
    mono, 22050 Hz, 16 bit with byteRate and blockAlign consistent, then `data` with the size 0xFFFFFFFF (a stream of unknown length).
    """
    channels, bits = 1, 16
    block_align = channels * bits // 8
    byte_rate = SAMPLE_RATE * block_align
    return (b"RIFF" + struct.pack("<I", WAV_DATA_LIMIT) + b"WAVE"
            + b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, SAMPLE_RATE, byte_rate, block_align, bits)
            + b"data" + struct.pack("<I", WAV_DATA_LIMIT))


WAV_HEADER = wav_header()


class BadRequest(Exception):
    pass


def _no_constant(name):
    raise ValueError("not a number")


def _number(value):
    """A JSON number as a float, or None when it is not one (booleans are not numbers here). Huge integers become infinity."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, int):
        return float(value) if abs(value) < 10 ** 9 else math.inf
    return value


def parse_start_body(body, cfg):
    """The body of POST /v1/start -> (frequency in MHz on the 0.05 grid, bandwidth in kHz). Raises BadRequest with a plain sentence."""
    try:
        data = json.loads(body.decode("utf-8"), parse_constant=_no_constant)
    except (ValueError, RecursionError):
        raise BadRequest("The request body is not valid JSON.")
    if not isinstance(data, dict):
        raise BadRequest("The request body must be a JSON object like {\"frequency\": 100.6, \"bandwidth\": 100}.")

    if "frequency" not in data:
        raise BadRequest("The frequency is missing.")
    frequency = _number(data["frequency"])
    if frequency is None:
        raise BadRequest("The frequency must be a number in MHz, like 100.6.")
    if not (math.isfinite(frequency) and cfg.freq_min <= frequency <= cfg.freq_max):
        raise BadRequest("The frequency must be between %s and %s MHz." % (fmt_mhz(cfg.freq_min), fmt_mhz(cfg.freq_max)))
    tuned = int(round(frequency * FREQ_GRID)) / FREQ_GRID
    if not (cfg.freq_min <= tuned <= cfg.freq_max):  # cannot happen (the band is on the grid); checked anyway
        raise BadRequest("The frequency must be between %s and %s MHz." % (fmt_mhz(cfg.freq_min), fmt_mhz(cfg.freq_max)))

    if data.get("bandwidth") is None:
        bandwidth = min(DEFAULT_BANDWIDTH, cfg.bandwidth_max)
    else:
        raw = _number(data["bandwidth"])
        if raw is None or not (math.isfinite(raw) and BANDWIDTH_MIN <= raw <= cfg.bandwidth_max):
            raise BadRequest("The bandwidth must be a number of kHz between %d and %d." % (BANDWIDTH_MIN, cfg.bandwidth_max))
        bandwidth = int(round(raw))
    return tuned, bandwidth


# ------------------------------------------------------------------------------------------------------------------------------
# Sound waiting for the pump
# ------------------------------------------------------------------------------------------------------------------------------

def peak_of(block):
    """Loudest sample in a block of S16LE bytes, 0 to 32768."""
    samples = array.array("h")
    samples.frombytes(block[: len(block) & ~1])
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        return 0
    return max(max(samples), -min(samples))


def drop_oldest(buf, limit):
    """Drops the oldest bytes of `buf` (a bytearray) until at most `limit` are left. Always an even number of bytes, so a sample is never
    cut in two and everything after it stays in step. Returns how many bytes were dropped."""
    excess = len(buf) - limit
    if excess <= 0:
        return 0
    excess += excess & 1
    del buf[:excess]
    return excess


class Ring:
    """
    What the audio client sent and the pump has not taken yet (at most 400 ms; the oldest is dropped beyond that). The pump takes
    exactly one block per tick. It starts playing only once 100 ms are waiting (so network jitter does not make holes), and when
    the sound runs dry it plays silence, counts an underrun, and waits for 100 ms again.
    """

    def __init__(self, maxlen=RING_MAX_BYTES, prefill=PREFILL_BYTES):
        self.maxlen = maxlen
        self.prefill = prefill
        self._lock = threading.Lock()
        self._buf = bytearray()
        self._primed = False
        self._connected = False
        self._underruns = 0
        self._dropped = 0
        self._level = 0.0

    def push(self, data):
        """Add sound (an even number of bytes). Returns how many bytes of the oldest had to be dropped."""
        with self._lock:
            self._buf += data
            extra = drop_oldest(self._buf, self.maxlen)
            self._dropped += extra
            return extra

    def take(self, n=TICK_BYTES):
        """The next n bytes: sound if there is a client and enough is waiting, silence otherwise."""
        with self._lock:
            block = None
            if self._connected:
                if not self._primed and len(self._buf) >= self.prefill:
                    self._primed = True
                if self._primed:
                    if len(self._buf) >= n:
                        block = bytes(self._buf[:n])
                        del self._buf[:n]
                    else:
                        self._primed = False
                        self._underruns += 1
            if block is None:
                block = SILENCE if n == TICK_BYTES else bytes(n)
                peak = 0
            else:
                peak = peak_of(block)
            self._level = min(1.0, max(peak / 32768.0, self._level * LEVEL_DECAY))
            return block

    def set_connected(self, connected):
        with self._lock:
            self._connected = connected
            self._buf.clear()
            self._primed = False

    def clear(self):
        with self._lock:
            self._buf.clear()
            self._primed = False

    def reset_level(self):
        with self._lock:
            self._level = 0.0

    def snapshot(self):
        with self._lock:
            return self._connected, self._level, self._underruns, self._dropped


# ------------------------------------------------------------------------------------------------------------------------------
# The transmitter program and everything that keeps it honest
# ------------------------------------------------------------------------------------------------------------------------------

class Run:
    """One start of the transmitter program: the child, the thread feeding it, and what it printed."""

    def __init__(self, child, frequency, bandwidth):
        self.child = child
        self.frequency = frequency
        self.bandwidth = bandwidth
        self.stop = threading.Event()       # asks the pump to end
        self.rollover = threading.Event()   # the pump says: nearly 4 GB sent, start again
        self.pump = None
        self.drains = []
        self.written = 0                    # bytes handed to the program's stdin, header included
        self.lines = collections.deque(maxlen=20)  # (stream, text), newest last
        self.lines_lock = threading.Lock()

    def add_line(self, stream, text):
        text = clean_text(text)
        if text:
            with self.lines_lock:
                self.lines.append((stream, text))

    def error_text(self, code):
        """The last thing the program said when it failed: its last error line, else its last unusual line, else a sentence."""
        with self.lines_lock:
            lines = list(self.lines)
        for stream, text in reversed(lines):
            if stream == "err":
                return text
        for stream, text in reversed(lines):
            if not text.startswith(("Broadcasting at", "Playing:", "Stopping")):
                return text
        if code is not None and code < 0:
            return "The transmitter program was stopped by signal %d." % -code
        return "The transmitter program stopped by itself (exit code %s)." % code


def binary_problem(path):
    """Why the program at `path` must not be run as root, or None. It must be ours or root's, and nobody else may be able to change it."""
    try:
        info = os.stat(path)
        folder = os.stat(os.path.dirname(path) or "/")
    except FileNotFoundError:
        return "The transmitter program is missing (%s). Run deploy/setup-fm.sh to build it." % clean_text(path, 120)
    except OSError:
        return "The transmitter program (%s) cannot be examined." % clean_text(path, 120)
    if not os.path.isfile(path) or not os.access(path, os.X_OK):
        return "The transmitter program (%s) is not a program that can be run." % clean_text(path, 120)
    me = os.geteuid()
    for entry in (info, folder):
        if entry.st_uid not in (0, me) or entry.st_mode & 0o022:
            return "The transmitter program (%s) or its folder can be changed by other users, so it will not be run." % clean_text(path, 120)
    return None


class Node:
    """The transmitter's state and everything that changes it. Safe to call from many threads."""

    def __init__(self, cfg, rollover_bytes=ROLLOVER_BYTES):
        self.cfg = cfg
        self.rollover_bytes = rollover_bytes
        self.board = check_board(cfg.model_file, cfg.ranges_file)
        self.ring = Ring()
        self.closing = threading.Event()
        self.lock = threading.Lock()        # guards the fields below, held only for a moment
        self.op_lock = threading.Lock()     # one start, stop or retune at a time (may be held for a second or two)
        self.run = None
        self.state = "idle"                 # idle | transmitting | error
        self.error = None
        self.frequency = None
        self.bandwidth = None
        self.last_attempt_at = None
        self.last_attempt_failed = False
        self.last_heard = time.monotonic()
        self.audio_session = None
        self.audio_lock = threading.Lock()
        self._token_digest = hashlib.sha256(cfg.token.encode("utf-8")).digest()
        self._auth_lock = threading.Lock()
        self._thread = None
        self.throttled = ThrottledLog()

    # -- authentication and the dead-man timer ----------------------------------------------------------------------------

    def check_token(self, candidate):
        """Constant-time comparison. `candidate` is bytes."""
        return hmac.compare_digest(hashlib.sha256(candidate).digest(), self._token_digest)

    def penalty(self):
        """Called after a wrong password. One at a time, so guesses are limited to a few a second however many connections there are."""
        with self._auth_lock:
            time.sleep(AUTH_DELAY_S)

    def touch(self):
        """Something authenticated was heard: the head unit is still there."""
        self.last_heard = time.monotonic()

    # -- status -----------------------------------------------------------------------------------------------------------

    def status(self):
        with self.lock:
            state, error, frequency, bandwidth, board = self.state, self.error, self.frequency, self.bandwidth, self.board
        connected, level, underruns, _dropped = self.ring.snapshot()
        transmitting = state == "transmitting"
        return {
            "protocol": PROTOCOL,
            "version": VERSION,
            "board": board.model,
            "supported": board.supported,
            "reason": board.reason,
            "state": state,
            "frequency": frequency,
            "bandwidth": bandwidth,
            "audio": {"connected": connected, "level": round(level, 3) if transmitting else 0.0, "underruns": underruns},
            "error": error if state == "error" else None,
            "limits": {"min": self.cfg.freq_min, "max": self.cfg.freq_max, "maxBandwidth": self.cfg.bandwidth_max},
            "deadmanS": self.cfg.deadman_s,
        }

    # -- start, stop -----------------------------------------------------------------------------------------------------

    def start(self, frequency, bandwidth):
        """Transmit on this frequency (retune if already on the air). Returns (http status, body). Values must be validated already."""
        with self.op_lock:
            if self.closing.is_set():
                return 503, {"error": "The FM helper is shutting down."}
            # The board is looked at again every time, not only at startup: this is the gate in front of the program.
            board = check_board(self.cfg.model_file, self.cfg.ranges_file)
            with self.lock:
                self.board = board
            if not board.supported:
                return 403, {"error": board.reason}
            now = time.monotonic()
            with self.lock:
                run = self.run
                unchanged = (run is not None and self.state == "transmitting" and self.frequency == frequency
                             and self.bandwidth == bandwidth and run.child.poll() is None)
                too_soon = self.last_attempt_failed and self.last_attempt_at is not None and now - self.last_attempt_at < SPAWN_MIN_GAP_S
            if unchanged:
                return 200, self.status()
            if too_soon:
                return 409, {"error": "The transmitter program was started a moment ago and stopped again. Wait a few seconds before trying again."}
            if run is not None:
                self._end_run(run)
                log("retuning to %.2f MHz" % frequency)
            self._spawn(frequency, bandwidth)
            return 200, self.status()

    def stop(self, reason="asked to stop"):
        """Carrier off: the program is terminated and reaped before this returns. Returns the status."""
        with self.op_lock:
            self._stop_locked(reason)
        return self.status()

    def _stop_locked(self, reason):
        with self.lock:
            run = self.run
        if run is not None:
            self._end_run(run)
            log("transmitter stopped (%s)" % reason)
        with self.lock:
            self.run = None
            self.state = "idle"
            self.error = None
            self.frequency = None
            self.bandwidth = None
        self.ring.reset_level()

    def _spawn(self, frequency, bandwidth):
        """Start the program. The only place it is ever started, and the last line of defence: it re-checks the board itself."""
        board = check_board(self.cfg.model_file, self.cfg.ranges_file)
        if not board.supported:
            self._fail(board.reason)
            return
        if not (isinstance(frequency, float) and isinstance(bandwidth, int) and self.cfg.freq_min <= frequency <= self.cfg.freq_max
                and BANDWIDTH_MIN <= bandwidth <= self.cfg.bandwidth_max):
            self._fail("The frequency or bandwidth is outside what this helper allows.")
            return
        problem = binary_problem(self.cfg.binary)
        if problem:
            self._fail(problem)
            return
        argv = [self.cfg.binary, "-f", "%.2f" % frequency, "-b", "%d" % bandwidth, "-d", "%d" % self.cfg.dma, "-"]
        self.ring.clear()
        started = time.monotonic()
        try:
            child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
                                     env={}, cwd="/", close_fds=True, start_new_session=True, shell=False)
        except OSError as problem_:
            self._fail("The transmitter program could not be started: %s." % clean_text(problem_.strerror or "unknown error", 100))
            return
        os.set_blocking(child.stdin.fileno(), False)
        run = Run(child, frequency, bandwidth)
        run.pump = threading.Thread(target=self._pump, args=(run,), name="fm-pump", daemon=True)
        run.drains = [threading.Thread(target=self._drain, args=(run, child.stdout, "out"), name="fm-out", daemon=True),
                      threading.Thread(target=self._drain, args=(run, child.stderr, "err"), name="fm-err", daemon=True)]
        with self.lock:
            self.run = run
            self.state = "transmitting"
            self.error = None
            self.frequency = frequency
            self.bandwidth = bandwidth
            self.last_attempt_at = started
            self.last_attempt_failed = False
        for thread in run.drains:
            thread.start()
        run.pump.start()
        log("transmitting on %.2f MHz, bandwidth %d kHz (pid %d)" % (frequency, bandwidth, child.pid))
        # A program that cannot start (no /dev/mem, bad argument) dies at once: say so in the answer instead of one poll later.
        deadline = started + START_SETTLE_S
        while time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.02)
        if child.poll() is not None:
            self._child_exited(run)

    def _fail(self, message):
        """A start that did not even get to run the program."""
        log("could not start the transmitter: " + message)
        with self.lock:
            self.run = None
            self.state = "error"
            self.error = clean_text(message)
            self.frequency = None
            self.bandwidth = None
            self.last_attempt_at = time.monotonic()
            self.last_attempt_failed = True

    def _child_exited(self, run, reason=None):
        """The program ended without being asked to: report it, never restart it by itself."""
        code = self._end_run(run)
        message = reason or run.error_text(code)
        log("the transmitter program stopped by itself (exit code %s): %s" % (code, message))
        with self.lock:
            if self.run is run:
                self.run = None
            self.state = "error"
            self.error = message
            self.frequency = None
            self.bandwidth = None
            self.last_attempt_failed = True
        self.ring.reset_level()

    def _end_run(self, run):
        """Make the program exit (SIGTERM, SIGKILL after TERM_GRACE_S), reap it, stop the pump. Returns its exit code."""
        child = run.child
        if child.poll() is None:
            # Ask first, and keep feeding it meanwhile: closing its stdin does NOT stop it (upstream spins on end-of-file); only a signal does.
            try:
                child.terminate()
            except OSError:
                pass
            try:
                child.wait(timeout=TERM_GRACE_S)
            except subprocess.TimeoutExpired:
                log("the transmitter program did not stop within %d seconds and was killed; the radio signal may stay on until it is started and stopped again" % TERM_GRACE_S)
                try:
                    child.kill()
                except OSError:
                    pass
                try:
                    child.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    log("the transmitter program could not be reaped")
        run.stop.set()
        if run.pump is not None and run.pump.is_alive():
            run.pump.join(2.0)
        for thread in run.drains:
            thread.join(1.0)
        return child.returncode

    # -- the pump ---------------------------------------------------------------------------------------------------------

    def _pump(self, run):
        """
        Feed the program its stdin in real time: the WAV header, 200 ms of silence, then one block every 20 ms (the head unit's sound,
        or silence). Writes never block; if the program stops reading, the oldest is dropped. Ends when run.stop is set or the pipe breaks.
        """
        stdin = run.child.stdin
        fd = stdin.fileno()
        out = bytearray(WAV_HEADER)
        out += SILENCE * PIPE_LEAD_TICKS
        next_tick = time.monotonic() + TICK_S
        try:
            while not run.stop.is_set():
                now = time.monotonic()
                made = 0
                while next_tick <= now and made < MAX_CATCHUP_TICKS:
                    out += self.ring.take(TICK_BYTES)
                    next_tick += TICK_S
                    made += 1
                if next_tick <= now:
                    self.throttled("pump-late", "the sound feed fell more than a second behind and was restarted")
                    next_tick = now + TICK_S
                if run.written >= len(WAV_HEADER) and drop_oldest(out, CHILD_BACKLOG_MAX):  # never the header: it has gone out first
                    self.throttled("child-slow", "the transmitter program is not reading fast enough; some sound was dropped")
                if out:
                    try:
                        sent = os.write(fd, out)
                    except BlockingIOError:
                        sent = 0
                    except OSError:
                        break  # the program is gone; the supervisor reports it
                    del out[:sent]
                    run.written += sent
                    if run.written >= self.rollover_bytes:
                        run.rollover.set()
                pause = next_tick - time.monotonic()
                if out:
                    pause = min(pause, 0.01)  # the pipe was full: look again soon
                run.stop.wait(max(0.0, pause))
        except Exception as problem:
            log("the sound feed failed: %s" % clean_text(repr(problem), 200))
        finally:
            try:
                stdin.close()
            except OSError:
                pass

    def _drain(self, run, stream, name):
        """Read what the program prints, a few lines of it, so a failure can be explained. Memory use is bounded."""
        pending = b""
        try:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    break
                pending += chunk
                *lines, pending = pending.split(b"\n")
                pending = pending[-1000:]
                for line in lines:
                    run.add_line(name, line[:1000])
            if pending:
                run.add_line(name, pending)
        except (OSError, ValueError):
            pass
        finally:
            try:
                stream.close()
            except OSError:
                pass

    # -- supervisor ------------------------------------------------------------------------------------------------------

    def start_supervisor(self):
        self._thread = threading.Thread(target=self._supervise, name="fm-supervisor", daemon=True)
        self._thread.start()

    def _supervise(self):
        while not self.closing.wait(SUPERVISE_S):
            try:
                self._tick()
            except Exception as problem:
                log("supervisor error: %s" % clean_text(repr(problem), 200))

    def _tick(self):
        if not self.op_lock.acquire(False):
            return  # a start or stop is in progress; look again in a moment
        try:
            run = self.run
            if run is None:
                return
            if run.child.poll() is not None:
                self._child_exited(run)
            elif run.pump is not None and not run.pump.is_alive() and not run.stop.is_set():
                self._child_exited(run, "The sound feed to the transmitter program stopped unexpectedly.")
            elif time.monotonic() - self.last_heard > self.cfg.deadman_s:
                log("nothing was heard from the head unit for %d seconds: switching the transmitter off" % self.cfg.deadman_s)
                self._stop_locked("dead-man timer")
            elif run.rollover.is_set():
                frequency, bandwidth = run.frequency, run.bandwidth
                log("restarting the transmitter program before its stream limit is reached (a short gap)")
                self._end_run(run)
                self._spawn(frequency, bandwidth)
        finally:
            self.op_lock.release()

    # -- audio client -----------------------------------------------------------------------------------------------------

    def attach_audio(self, session):
        """A new valid audio client replaces the old one."""
        with self.audio_lock:
            old = self.audio_session
            self.audio_session = session
        if old is not None:
            old.close()
        self.ring.set_connected(True)

    def detach_audio(self, session):
        with self.audio_lock:
            if self.audio_session is not session:
                return
            self.audio_session = None
        self.ring.set_connected(False)

    # -- shutdown -----------------------------------------------------------------------------------------------------------

    def close(self):
        self.closing.set()
        with self.audio_lock:
            session, self.audio_session = self.audio_session, None
        if session is not None:
            session.close()
        with self.op_lock:
            self._stop_locked("shutting down")


# ------------------------------------------------------------------------------------------------------------------------------
# Network: a small, strict HTTP/1.1 reader and the audio port
# ------------------------------------------------------------------------------------------------------------------------------

REASONS = {200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
           408: "Request Timeout", 409: "Conflict", 411: "Length Required", 413: "Payload Too Large", 415: "Unsupported Media Type",
           431: "Request Header Fields Too Large", 500: "Internal Server Error", 503: "Service Unavailable"}
_REQUEST_LINE = re.compile(r"([A-Z]{3,10}) (/[\x21-\x7e]{0,255}) HTTP/1\.[01]", re.ASCII)
_HEADER_LINE = re.compile(r"([!#$%&'*+.^_`|~0-9A-Za-z-]+):([\t\x20-\x7e\x80-\xff]*)", re.ASCII)
_SINGLE_HEADERS = ("content-length", "content-type", "authorization", "transfer-encoding")


class HttpError(Exception):
    def __init__(self, status, message, headers=()):
        Exception.__init__(self, message)
        self.status = status
        self.message = message
        self.headers = headers


class Closed(Exception):
    """The other side went away; there is nobody to answer."""


class Request:
    def __init__(self, method, target, headers, body):
        self.method = method
        self.target = target
        self.headers = headers
        self.body = body


def _recv(conn, deadline, size):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise HttpError(408, "The request took too long to arrive.")
    try:
        conn.settimeout(remaining)
        return conn.recv(size)
    except socket.timeout:
        raise HttpError(408, "The request took too long to arrive.")
    except OSError:
        raise Closed()


def read_request(conn, deadline):
    """One HTTP request, strictly: CRLF line ends, small head, a Content-Length body of at most 1 KiB, all within the deadline."""
    buf = bytearray()
    while True:
        end = buf.find(b"\r\n\r\n")
        if end != -1:
            break
        if len(buf) > MAX_HEAD_BYTES:
            raise HttpError(431, "The request headers are too long.")
        chunk = _recv(conn, deadline, 4096)
        if not chunk:
            if buf:
                raise HttpError(400, "The request ended too early.")
            raise Closed()
        buf += chunk
    if end > MAX_HEAD_BYTES:
        raise HttpError(431, "The request headers are too long.")
    lines = bytes(buf[:end]).split(b"\r\n")
    body = bytearray(buf[end + 4:])

    match = _REQUEST_LINE.fullmatch(lines[0].decode("latin-1"))
    if not match:
        raise HttpError(400, "That is not a valid HTTP request.")
    method, target = match.group(1), match.group(2)

    headers = {}
    if len(lines) - 1 > MAX_HEADERS:
        raise HttpError(431, "The request has too many headers.")
    for line in lines[1:]:
        parsed = _HEADER_LINE.fullmatch(line.decode("latin-1"))
        if not parsed:
            raise HttpError(400, "A request header is not valid.")
        name = parsed.group(1).lower()
        if name in headers and name in _SINGLE_HEADERS:
            raise HttpError(400, "A request header was sent twice.")
        headers[name] = parsed.group(2).strip(" \t")

    if "transfer-encoding" in headers:
        raise HttpError(400, "Chunked or encoded request bodies are not supported.")
    length = headers.get("content-length")
    if length is not None:
        if not re.fullmatch(r"[0-9]{1,18}", length):
            raise HttpError(400, "The Content-Length header is not valid.")
        wanted = int(length)
        if wanted > MAX_BODY_BYTES:
            raise HttpError(413, "The request body is too big (the limit is %d bytes)." % MAX_BODY_BYTES)
        while len(body) < wanted:
            chunk = _recv(conn, deadline, wanted - len(body))
            if not chunk:
                raise HttpError(400, "The request ended too early.")
            body += chunk
        del body[wanted:]
    else:
        body = bytearray()
    return Request(method, target, headers, bytes(body))


def send_json(conn, status, payload, extra_headers=()):
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    head = ["HTTP/1.1 %d %s" % (status, REASONS.get(status, "Status")), "Content-Type: application/json", "Content-Length: %d" % len(body),
            "Cache-Control: no-store", "X-Content-Type-Options: nosniff", "Connection: close"]
    head.extend(extra_headers)
    try:
        conn.settimeout(REQUEST_TIMEOUT_S)
        conn.sendall(("\r\n".join(head) + "\r\n\r\n").encode("ascii") + body)
    except OSError:
        pass


def linger(conn):
    """Close politely: a client still sending (a refused big body) gets to read our answer instead of a reset."""
    try:
        conn.shutdown(socket.SHUT_WR)
        deadline = time.monotonic() + 0.5
        total = 0
        while total < 65536:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            conn.settimeout(remaining)
            chunk = conn.recv(4096)
            if not chunk:
                break
            total += len(chunk)
    except OSError:
        pass


def bearer_token(header):
    """The token from "Bearer <token>" as bytes, or None."""
    if header is None:
        return None
    scheme, sep, rest = header.partition(" ")
    if not sep or scheme.lower() != "bearer":
        return None
    return rest.strip(" ").encode("latin-1", "replace")


class Gate:
    """Limits how many connections are handled at once, in total and from one address."""

    def __init__(self, max_total, max_per_ip):
        self.max_total = max_total
        self.max_per_ip = max_per_ip
        self._lock = threading.Lock()
        self._total = 0
        self._per_ip = {}

    def enter(self, ip):
        with self._lock:
            if self._total >= self.max_total or self._per_ip.get(ip, 0) >= self.max_per_ip:
                return False
            self._total += 1
            self._per_ip[ip] = self._per_ip.get(ip, 0) + 1
            return True

    def leave(self, ip):
        with self._lock:
            self._total -= 1
            left = self._per_ip.get(ip, 1) - 1
            if left > 0:
                self._per_ip[ip] = left
            else:
                self._per_ip.pop(ip, None)


class Server:
    """A listening socket, an accept thread, and one short-lived thread per connection (within the Gate's limits)."""

    def __init__(self, name, host, port, handler, gate, throttled):
        family = socket.AF_INET6 if ipaddress.ip_address(host).version == 6 else socket.AF_INET
        self.name = name
        self.handler = handler
        self.gate = gate
        self.throttled = throttled
        self.stopping = threading.Event()
        self.sock = socket.socket(family, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, port))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._accept_loop, name="fm-" + name + "-accept", daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.stopping.set()
        try:
            self.sock.close()
        except OSError:
            pass

    def _accept_loop(self):
        self.sock.settimeout(0.5)
        while not self.stopping.is_set():
            try:
                conn, addr = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                if self.stopping.is_set():
                    return
                time.sleep(0.05)  # out of descriptors, say: do not spin
                continue
            ip = addr[0]
            if not self.gate.enter(ip):
                self.throttled(self.name + "-busy", "%s: too many connections, one was turned away" % self.name)
                try:
                    conn.close()
                except OSError:
                    pass
                continue
            threading.Thread(target=self._serve, args=(conn, ip), name="fm-" + self.name, daemon=True).start()

    def _serve(self, conn, ip):
        try:
            self.handler(conn, ip)
        except Exception as problem:
            log("%s: a connection failed: %s" % (self.name, clean_text(repr(problem), 200)))
        finally:
            try:
                conn.close()
            except OSError:
                pass
            self.gate.leave(ip)


class ControlHandler:
    def __init__(self, node):
        self.node = node

    def __call__(self, conn, ip):
        node = self.node
        deadline = time.monotonic() + REQUEST_TIMEOUT_S
        try:
            request = read_request(conn, deadline)
        except Closed:
            return
        except HttpError as problem:
            send_json(conn, problem.status, {"error": problem.message}, problem.headers)
            linger(conn)
            return

        token = bearer_token(request.headers.get("authorization"))
        if token is None or not node.check_token(token):
            node.throttled("auth", "control: a request from %s had a wrong or missing password" % ip)
            node.penalty()
            send_json(conn, 401, {"error": "The password is missing or wrong."}, ["WWW-Authenticate: Bearer"])
            linger(conn)
            return
        node.touch()

        path = request.target.split("?", 1)[0]
        if path == "/v1/status":
            allowed = "GET"
        elif path in ("/v1/start", "/v1/stop"):
            allowed = "POST"
        else:
            send_json(conn, 404, {"error": "There is nothing at that address."})
            linger(conn)
            return
        if request.method != allowed:
            send_json(conn, 405, {"error": "That address does not accept this kind of request."}, ["Allow: " + allowed])
            linger(conn)
            return

        if path == "/v1/status":
            status, payload = 200, node.status()
        elif path == "/v1/stop":
            status, payload = 200, node.stop("asked to stop")
        else:
            status, payload = self._start(request)
        send_json(conn, status, payload)
        linger(conn)

    def _start(self, request):
        kind = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if kind != "application/json":
            return 415, {"error": "Send the request as application/json."}
        if "content-length" not in request.headers:
            return 411, {"error": "The request needs a Content-Length header."}
        try:
            frequency, bandwidth = parse_start_body(request.body, self.node.cfg)
        except BadRequest as problem:
            return 400, {"error": str(problem)}
        return self.node.start(frequency, bandwidth)


class AudioSession:
    """One connected audio client. close() is safe from any thread and ends its reading loop."""

    def __init__(self, conn, ip):
        self.conn = conn
        self.ip = ip

    def close(self):
        try:
            self.conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def _keepalive(conn):
    """A client that vanished without a goodbye is noticed in about 25 seconds."""
    try:
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        for name, value in (("TCP_KEEPIDLE", 10), ("TCP_KEEPINTVL", 5), ("TCP_KEEPCNT", 3)):
            option = getattr(socket, name, None)
            if option is not None:
                conn.setsockopt(socket.IPPROTO_TCP, option, value)
    except OSError:
        pass


class AudioHandler:
    def __init__(self, node):
        self.node = node

    def _reply(self, conn, text):
        try:
            conn.settimeout(2.0)
            conn.sendall((text + "\n").encode("ascii"))
        except OSError:
            pass

    def __call__(self, conn, ip):
        node = self.node
        deadline = time.monotonic() + AUDIO_HELLO_TIMEOUT_S
        buf = bytearray()
        while True:
            end = buf.find(b"\n")
            if end != -1:
                break
            if len(buf) >= AUDIO_HELLO_MAX:
                self._reply(conn, "ERR first line too long")
                linger(conn)
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._reply(conn, "ERR no greeting in time")
                linger(conn)
                return
            try:
                conn.settimeout(remaining)
                chunk = conn.recv(AUDIO_HELLO_MAX + 1024)
            except socket.timeout:
                self._reply(conn, "ERR no greeting in time")
                linger(conn)
                return
            except OSError:
                return
            if not chunk:
                return
            buf += chunk
        if end >= AUDIO_HELLO_MAX:
            self._reply(conn, "ERR first line too long")
            linger(conn)
            return
        line = bytes(buf[:end]).rstrip(b"\r")
        carry = bytes(buf[end + 1:])

        parts = line.split(b" ")
        if len(parts) != 3 or parts[0] != b"AUDIO":
            self._reply(conn, "ERR expected: AUDIO 1 <password>")
            linger(conn)
            return
        if parts[1] != str(PROTOCOL).encode("ascii"):
            self._reply(conn, "ERR unsupported protocol version")
            linger(conn)
            return
        if not node.check_token(parts[2]):
            node.throttled("audio-auth", "audio: a client at %s had a wrong password" % ip)
            node.penalty()
            self._reply(conn, "ERR wrong password")
            linger(conn)
            return
        node.touch()
        if not node.board.supported:
            self._reply(conn, "ERR this board is not supported")
            linger(conn)
            return

        session = AudioSession(conn, ip)
        self._reply(conn, "OK")
        _keepalive(conn)
        node.attach_audio(session)
        log("audio: client connected from %s" % ip)
        started = time.monotonic()
        try:
            self._stream(conn, node, carry)
        finally:
            node.detach_audio(session)
            log("audio: client from %s left after %d seconds" % (ip, time.monotonic() - started))

    def _stream(self, conn, node, first):
        """Raw S16LE until the client goes away. An odd trailing byte waits for the next read."""
        carry = b""
        chunk = first  # whatever arrived in the same packet as the greeting line
        while not node.closing.is_set():
            if chunk:
                node.touch()
                data = carry + chunk
                usable = len(data) & ~1
                carry = data[usable:]
                if usable and node.ring.push(data[:usable]):
                    node.throttled("audio-overflow", "audio: the client is sending faster than real time; some sound was dropped")
                    time.sleep(0.05)  # slow a flooding client down instead of spinning on it
            try:
                conn.settimeout(5.0)
                chunk = conn.recv(8192)
            except socket.timeout:
                chunk = b""
                continue
            except OSError:
                return
            if not chunk:
                return


# ------------------------------------------------------------------------------------------------------------------------------
# Start-up
# ------------------------------------------------------------------------------------------------------------------------------

def parse_args(argv):
    parser = argparse.ArgumentParser(prog="fm_node.py", description="FM transmitter helper for the head unit.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="config file (default %s)" % DEFAULT_CONFIG)
    parser.add_argument("--model-file", default=DEFAULT_MODEL_FILE, help="where the board model is read from (tests)")
    parser.add_argument("--ranges-file", default=DEFAULT_RANGES_FILE, help="where the hardware address list is read from (tests)")
    parser.add_argument("--binary", help="path of the transmitter program (overrides BIN)")
    parser.add_argument("--bind", help="address to listen on (overrides BIND)")
    parser.add_argument("--control-port", type=int, help="control port, 0 = pick one (overrides CONTROL_PORT)")
    parser.add_argument("--audio-port", type=int, help="audio port, 0 = pick one (overrides AUDIO_PORT)")
    parser.add_argument("--check-board", action="store_true", help="print whether this board is supported, as JSON, and exit 0 (yes) or 1 (no)")
    parser.add_argument("--check-config", action="store_true", help="check the config file, print any problem as a sentence, and exit 0 (fine) or 2 (not usable)")
    parser.add_argument("--version", action="store_true", help="print the version and exit")
    parser.add_argument("--rollover-bytes", type=int, default=ROLLOVER_BYTES, help=argparse.SUPPRESS)  # tests only
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.version:
        print("fm_node %s (protocol %d)" % (VERSION, PROTOCOL))
        return 0
    if args.check_board:
        board = check_board(args.model_file, args.ranges_file)
        print(json.dumps({"supported": board.supported, "board": board.model, "reason": board.reason}, separators=(",", ":")), flush=True)
        return 0 if board.supported else 1

    os.umask(0o077)
    overrides = {"bind": args.bind, "control_port": args.control_port, "audio_port": args.audio_port, "binary": args.binary,
                 "model_file": args.model_file, "ranges_file": args.ranges_file}
    for key in ("control_port", "audio_port"):
        if overrides[key] is not None and not 0 <= overrides[key] <= 65535:
            print("fm-node: --%s must be a port number" % key.replace("_", "-"), file=sys.stderr)
            return 2
    try:
        cfg, warnings = load_config(args.config, overrides)
    except ConfigError as problem:
        log(str(problem))
        return 2
    for warning in warnings:
        log("warning: " + warning)
    if args.check_config:
        return 0
    if not 1000 <= args.rollover_bytes <= ROLLOVER_BYTES:
        args.rollover_bytes = ROLLOVER_BYTES

    node = Node(cfg, args.rollover_bytes)
    if node.board.supported:
        log("board: %s" % node.board.model)
    else:
        log("this board is not supported, the transmitter will NOT be started: %s" % node.board.reason)
    try:
        control = Server("control", cfg.bind, cfg.control_port, ControlHandler(node), Gate(CONTROL_MAX_CONNECTIONS, CONTROL_MAX_PER_IP), node.throttled)
        audio = Server("audio", cfg.bind, cfg.audio_port, AudioHandler(node), Gate(AUDIO_MAX_CONNECTIONS, AUDIO_MAX_PER_IP), node.throttled)
    except OSError as problem:
        log("cannot listen on %s: %s" % (cfg.bind, clean_text(problem.strerror or "unknown error", 100)))
        return 1

    stop = threading.Event()
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, lambda *_: stop.set())
    node.start_supervisor()
    control.start()
    audio.start()
    if cfg.bind not in ("127.0.0.1", "::1"):
        log("listening on %s: anyone on that network can try the password" % cfg.bind)
    print(json.dumps({"listening": {"control": control.port, "audio": audio.port}}, separators=(",", ":")), flush=True)

    while not stop.wait(0.5):
        pass
    log("shutting down")
    control.close()
    audio.close()
    node.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
