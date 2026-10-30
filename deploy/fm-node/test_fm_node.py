#!/usr/bin/env python3
"""
Tests for fm_node.py. Run:  python3 -B -m unittest discover -s deploy/fm-node

Nothing here ever runs the real fm_transmitter program: the helper is started with a FAKE program (a script that records its
arguments, environment and stdin) and a fake model file. The one exception is the WaveReader test, which compiles the program's own
wave_reader.cpp (a plain file reader with no hardware access) and feeds it the stream the helper produces.

Set FM_NODE_PATH to test a different copy of fm_node.py (used for mutation checks).
"""
import ast
import http.client
import importlib.util
import json
import math
import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
FM_NODE = os.environ.get("FM_NODE_PATH") or os.path.join(HERE, "fm_node.py")
VENDOR = os.path.normpath(os.path.join(HERE, "..", "..", "vendor", "fm_transmitter"))

_spec = importlib.util.spec_from_file_location("fm_node_under_test", FM_NODE)
fm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fm)

TOKEN = "t0ken-0123456789-abcdefABCDEF"
WRONG = "wrong-0123456789-abcdefABCDEF"

PI4 = b"Raspberry Pi 4 Model B Rev 1.4\x00"
PI4_RANGES = bytes.fromhex("7e000000" "00000000" "fe000000" "01800000")  # how a Pi 4 writes it: the address is in the second cell
PI3 = b"Raspberry Pi 3 Model B Plus Rev 1.3\x00"
PI3_RANGES = bytes.fromhex("7e000000" "3f000000" "01000000")
PI_ZERO = b"Raspberry Pi Zero W Rev 1.1\x00"
PI_ZERO_RANGES = bytes.fromhex("7e000000" "20000000" "02000000")
PI5 = b"Raspberry Pi 5 Model B Rev 1.0\x00"
PI5_RANGES = bytes.fromhex("00000000" "00000000" "1000007c" "00000000")

EXPECTED_HEADER = bytes.fromhex(
    "52494646" "ffffffff" "57415645"          # RIFF, size, WAVE
    "666d7420" "10000000" "0100" "0100" "22560000" "44ac0000" "0200" "1000"  # fmt , 16, PCM, mono, 22050, 44100, 2, 16
    "64617461" "ffffffff")                    # data, 0xFFFFFFFF


def wait_for(predicate, timeout=10.0, interval=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    return predicate()


def read_text(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError:
        return ""


def quiet_log(test):
    """Keeps the helper's log lines out of the test output (in-process tests only); returns the list they go to."""
    lines = []
    original = fm.log
    fm.log = lines.append
    test.addCleanup(setattr, fm, "log", original)
    return lines


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


# --------------------------------------------------------------------------------------------------------------------
# A fake transmitter program, and a helper process to talk to
# --------------------------------------------------------------------------------------------------------------------

FAKE_PROGRAM = r'''#!@PYTHON@
import json, os, select, signal, sys, time
REC = @REC@
mode = ""
try:
    mode = open(os.path.join(REC, "mode")).read().strip()
except OSError:
    pass
run = os.path.join(REC, "run-%d-%d" % (time.time_ns(), os.getpid()))
os.makedirs(run)
def put(name, text):
    with open(os.path.join(run, name), "w") as handle:
        handle.write(text)
put("argv.json", json.dumps(sys.argv[1:]))
with open("/proc/self/environ", "rb") as handle:   # the real starting environment (Python itself may add LC_CTYPE to os.environ)
    raw_env = handle.read()
put("env.json", json.dumps([item for item in raw_env.decode().split("\0") if item]))
put("cwd", os.getcwd())
put("pid", str(os.getpid()))
if mode.startswith("fail:"):
    sys.stderr.write(mode[5:] + "\n")
    sys.stderr.flush()
    sys.exit(1)
if mode == "exit0":
    print("Broadcasting at", sys.argv[2], "MHz with", sys.argv[4], "kHz bandwidth")
    sys.stdout.flush()
    sys.exit(0)
if mode.startswith("stall:"):
    time.sleep(float(mode[6:]))   # a program busy starting up: it does not read stdin for a while
if mode == "ignore_term":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
else:
    def term(*_):
        put("term", str(time.time()))
        os._exit(0)
    signal.signal(signal.SIGTERM, term)
out = open(os.path.join(run, "stdin.bin"), "ab", buffering=0)
times = open(os.path.join(run, "times.log"), "a", buffering=1)
print("Broadcasting at", sys.argv[2], "MHz with", sys.argv[4], "kHz bandwidth")
sys.stdout.flush()
while True:
    ready, _, _ = select.select([0], [], [], 1.0)
    if not ready:
        put("starved", str(time.time()))   # the real program treats one silent second as the end of the stream
        sys.exit(0)
    data = os.read(0, 65536)
    if not data:
        put("eof", str(time.time()))
        sys.exit(0)
    out.write(data)
    times.write("%.3f %d\n" % (time.time(), len(data)))
'''


class Run:
    """What one start of the fake program recorded."""

    def __init__(self, path):
        self.path = path

    def read(self, name, binary=False):
        try:
            with open(os.path.join(self.path, name), "rb" if binary else "r") as handle:
                return handle.read()
        except OSError:
            return b"" if binary else None

    @property
    def argv(self):
        return json.loads(self.read("argv.json") or "null")

    @property
    def pid(self):
        return int(self.read("pid") or 0)

    @property
    def stdin(self):
        return self.read("stdin.bin", True)

    def exists(self, name):
        return os.path.exists(os.path.join(self.path, name))


class Helper:
    """fm_node.py running as a child process, with a fake model file and a fake transmitter program."""

    def __init__(self, test, model=PI4, ranges=PI4_RANGES, config="", args=(), token=TOKEN, fake_mode=None, binary_mode=0o755):
        self.test = test
        self.tmp = tempfile.mkdtemp(prefix="fm-node-test-")
        test.addCleanup(shutil.rmtree, self.tmp, True)
        self.rec = os.path.join(self.tmp, "rec")
        os.makedirs(self.rec)
        self.model = os.path.join(self.tmp, "model")
        self.ranges = os.path.join(self.tmp, "ranges")
        if model is not None:
            with open(self.model, "wb") as handle:
                handle.write(model)
        if ranges is not None:
            with open(self.ranges, "wb") as handle:
                handle.write(ranges)
        self.binary = os.path.join(self.tmp, "fake_transmitter")
        with open(self.binary, "w") as handle:
            handle.write(FAKE_PROGRAM.replace("@PYTHON@", sys.executable).replace("@REC@", repr(self.rec)))
        os.chmod(self.binary, binary_mode)
        if fake_mode:
            self.set_mode(fake_mode)
        self.config = os.path.join(self.tmp, "fm-node.conf")
        with open(self.config, "w") as handle:
            handle.write("TOKEN=%s\n%s\n" % (token, config))
        os.chmod(self.config, 0o600)
        self.args = list(args)
        self.stderr_lines = []
        self.proc = None
        self.control = self.audio = None

    def set_mode(self, mode):
        with open(os.path.join(self.rec, "mode"), "w") as handle:
            handle.write(mode)

    def start(self, binary=None):
        cmd = [sys.executable, "-B", FM_NODE, "--config", self.config, "--model-file", self.model, "--ranges-file", self.ranges,
               "--binary", binary or self.binary, "--control-port", "0", "--audio-port", "0"] + self.args
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={"PATH": os.environ.get("PATH", "")})
        self.test.addCleanup(self.close)
        threading.Thread(target=self._read_stderr, daemon=True).start()
        line = self.proc.stdout.readline()
        self.test.assertTrue(line, "the helper printed no listening line: " + "".join(self.stderr_lines))
        listening = json.loads(line)["listening"]
        self.control, self.audio = listening["control"], listening["audio"]
        return self

    def _read_stderr(self):
        for line in self.proc.stderr:
            self.stderr_lines.append(line.decode("utf-8", "replace"))

    @property
    def log(self):
        return "".join(self.stderr_lines)

    def runs(self):
        names = sorted(n for n in os.listdir(self.rec) if n.startswith("run-"))
        return [Run(os.path.join(self.rec, n)) for n in names]

    def request(self, method, path, body=None, token=TOKEN, headers=None, timeout=15, content_type="application/json"):
        """Returns (status, parsed JSON or None, headers dict). Fails the test if the token ever shows up in an answer."""
        conn = http.client.HTTPConnection("127.0.0.1", self.control, timeout=timeout)
        try:
            hdrs = dict(headers or {})
            if token is not None:
                hdrs["Authorization"] = "Bearer " + token
            data = None
            if body is not None:
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                hdrs.setdefault("Content-Type", content_type)
            conn.request(method, path, body=data, headers=hdrs)
            response = conn.getresponse()
            raw = response.read()
        finally:
            conn.close()
        self.test.assertNotIn(TOKEN.encode(), raw)
        self.test.assertNotIn(WRONG.encode(), raw)
        for value in response.getheaders():
            self.test.assertNotIn(TOKEN, value[1])
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return response.status, parsed, dict((k.lower(), v) for k, v in response.getheaders())

    def status(self):
        code, body, _ = self.request("GET", "/v1/status")
        self.test.assertEqual(code, 200)
        return body

    def start_tx(self, frequency=100.6, bandwidth=100):
        return self.request("POST", "/v1/start", {"frequency": frequency, "bandwidth": bandwidth})

    def audio_connect(self, token=TOKEN, line=None, timeout=10):
        sock = socket.create_connection(("127.0.0.1", self.audio), timeout=timeout)
        self.test.addCleanup(sock.close)
        sock.sendall(line if line is not None else ("AUDIO 1 %s\n" % token).encode())
        return sock

    def audio_ok(self):
        sock = self.audio_connect()
        reply = recv_line(sock)
        self.test.assertEqual(reply, b"OK\n")
        return sock

    def close(self):
        if self.proc is None:
            return
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        for stream in (self.proc.stdout, self.proc.stderr):
            try:
                stream.close()
            except OSError:
                pass
        # whatever happened, no fake program may be left running
        for run in self.runs():
            if run.pid and pid_alive(run.pid):
                try:
                    os.kill(run.pid, signal.SIGKILL)
                except OSError:
                    pass
        self.proc = None
        # the password must never be in the log, right or wrong
        self.test.assertNotIn(TOKEN, self.log)
        self.test.assertNotIn(WRONG, self.log)


def recv_line(sock, limit=4096):
    data = b""
    while b"\n" not in data and len(data) < limit:
        chunk = sock.recv(1)
        if not chunk:
            break
        data += chunk
    return data


def recv_all(sock, timeout=5.0):
    sock.settimeout(timeout)
    data = b""
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
    except (socket.timeout, ConnectionResetError):
        pass
    return data


def connect(test, port, timeout=10):
    """A plain TCP connection to the helper that is closed when the test ends."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    test.addCleanup(sock.close)
    return sock


def closed_by_peer(sock, timeout=3.0):
    """True when the other side has hung up (end of stream or reset); False when it is still there and silent."""
    sock.settimeout(timeout)
    try:
        while True:
            if sock.recv(65536) == b"":
                return True
    except socket.timeout:
        return False
    except (ConnectionResetError, BrokenPipeError):
        return True


def tone(seconds, rate=22050, freq=440.0, amplitude=0.5):
    count = int(seconds * rate)
    return b"".join(struct.pack("<h", int(amplitude * 32767 * math.sin(2 * math.pi * freq * i / rate))) for i in range(count))


# --------------------------------------------------------------------------------------------------------------------
# Pure functions
# --------------------------------------------------------------------------------------------------------------------

class BoardCheckTests(unittest.TestCase):
    def check(self, model, ranges):
        tmp = tempfile.mkdtemp(prefix="fm-node-board-")
        self.addCleanup(shutil.rmtree, tmp, True)
        model_file = os.path.join(tmp, "model")
        ranges_file = os.path.join(tmp, "ranges")
        if model is not None:
            with open(model_file, "wb") as handle:
                handle.write(model)
        if ranges is not None:
            with open(ranges_file, "wb") as handle:
                handle.write(ranges)
        return fm.check_board(model_file, ranges_file)

    def test_every_listed_board_is_supported_with_its_own_address(self):
        boards = [
            (b"Raspberry Pi Zero Rev 1.3", PI_ZERO_RANGES), (b"Raspberry Pi Zero W Rev 1.1", PI_ZERO_RANGES),
            (b"Raspberry Pi Model A", PI_ZERO_RANGES), (b"Raspberry Pi Model A+ Rev 1.1", PI_ZERO_RANGES),
            (b"Raspberry Pi Model B Rev 2", PI_ZERO_RANGES), (b"Raspberry Pi Model B+ Rev 1.2", PI_ZERO_RANGES),
            (b"Raspberry Pi Compute Module Rev 1.0", PI_ZERO_RANGES),
            (b"Raspberry Pi 2 Model B Rev 1.1", PI3_RANGES), (b"Raspberry Pi 3 Model B Rev 1.2", PI3_RANGES),
            (b"Raspberry Pi 3 Model B Plus Rev 1.3", PI3_RANGES), (b"Raspberry Pi 3 Model B+", PI3_RANGES),
            (b"Raspberry Pi 3 Model A Plus Rev 1.0", PI3_RANGES), (b"Raspberry Pi Zero 2 W Rev 1.0", PI3_RANGES),
            (b"Raspberry Pi Compute Module 3 Rev 1.0", PI3_RANGES), (b"Raspberry Pi Compute Module 3 Plus Rev 1.0", PI3_RANGES),
            (b"Raspberry Pi 4 Model B Rev 1.4", PI4_RANGES), (b"Raspberry Pi 4 Model B Rev 1.5", PI4_RANGES),
            (b"Raspberry Pi 400 Rev 1.0", PI4_RANGES), (b"Raspberry Pi Compute Module 4 Rev 1.0", PI4_RANGES),
            (b"Raspberry Pi Compute Module 4S Rev 1.0", PI4_RANGES),
        ]
        for model, ranges in boards:
            with self.subTest(model=model):
                board = self.check(model + b"\x00", ranges)
                self.assertTrue(board.supported, board.reason)
                self.assertIsNone(board.reason)
                self.assertEqual(board.model, model.decode())

    def test_the_pi_5_family_is_refused_with_a_plain_reason(self):
        for model in (b"Raspberry Pi 5 Model B Rev 1.0", b"Raspberry Pi 500 Rev 1.0", b"Raspberry Pi Compute Module 5 Rev 1.0"):
            for ranges in (PI5_RANGES, PI4_RANGES, PI3_RANGES, PI_ZERO_RANGES, None):  # even with a valid-looking address list
                with self.subTest(model=model, ranges=ranges):
                    board = self.check(model + b"\x00", ranges)
                    self.assertFalse(board.supported)
                    self.assertIn("Pi 5", board.reason)
                    self.assertIn("second Pi", board.reason)

    def test_unknown_unreadable_and_odd_boards_are_refused(self):
        odd = [None, b"", b"\x00", b"   \n", b"Orange Pi 5", b"Raspberry Pi", b"Raspberry Pi 6 Model B", b"Raspberry Pi 4", b"Raspberry Pi 40 Model B",
               b"Raspberry Pi 4 Model B Rev 1.4; reboot", b"Raspberry Pi 4 Model B Rev 1.4\nRaspberry Pi 5", b"Raspberry Pi 4 Model B Rev",
               b"xRaspberry Pi 4 Model B", b"Raspberry Pi 4 Model B Rev 1.4 extra", b"Raspberry Pi 4 Model B\x00Raspberry Pi 5",
               "Raspberry Pi \u0664 Model B".encode(), b"raspberry pi 4 model b", b"Raspberry Pi Zero 3", b"Raspberry Pi Model C",
               b"Raspberry Pi Compute Module 2", b"Raspberry Pi 3 Model C", b"Raspberry Pi 4 Model B" + b"A" * 300]
        for model in odd:
            with self.subTest(model=model):
                board = self.check(model, PI4_RANGES)
                self.assertFalse(board.supported)
                self.assertTrue(board.reason)

    def test_the_hardware_address_must_be_readable_known_and_agree_with_the_name(self):
        cases = [
            (PI4, None, "could not be read"),
            (PI4, b"", "could not be read"),
            (PI4, bytes.fromhex("7e000000"), "could not be read"),
            (PI4, bytes.fromhex("7e000000" "00000000"), "could not be read"),              # zero, and no third cell to fall back on
            (PI4, bytes.fromhex("7e000000" "00000000" "00000000" "01800000"), "does not know"),  # zero in both cells: address 0
            (PI4, bytes.fromhex("7e000000" "12345678" "fe000000"), "does not know"),
            (PI4, PI3_RANGES, "do not agree"),            # a Pi 4 name with a Pi 3 address would run the clock at the wrong speed
            (PI4, PI_ZERO_RANGES, "do not agree"),
            (PI3, PI4_RANGES, "do not agree"),
            (PI3, PI_ZERO_RANGES, "do not agree"),
            (PI_ZERO, PI4_RANGES, "do not agree"),
            (PI_ZERO, PI3_RANGES, "do not agree"),
            (PI4, PI5_RANGES, "does not know"),
        ]
        for model, ranges, expect in cases:
            with self.subTest(model=model, ranges=ranges):
                board = self.check(model, ranges)
                self.assertFalse(board.supported)
                self.assertIn(expect, board.reason)

    def test_the_address_is_read_the_way_upstream_reads_it(self):
        self.assertEqual(fm.peripheral_base(PI4_RANGES), 0xFE000000)  # cell 1 is zero: take cell 2
        self.assertEqual(fm.peripheral_base(PI3_RANGES), 0x3F000000)
        self.assertEqual(fm.peripheral_base(PI_ZERO_RANGES), 0x20000000)
        self.assertIsNone(fm.peripheral_base(b"1234567"))

    def test_a_missing_device_tree_is_refused_without_raising(self):
        board = fm.check_board("/nonexistent/model", "/nonexistent/ranges")
        self.assertFalse(board.supported)
        self.assertIsNone(board.model)
        board = fm.check_board("/", "/")  # directories
        self.assertFalse(board.supported)

    def test_the_model_text_shown_is_made_safe(self):
        board = self.check(b"Raspberry Pi \x1b[31mX\x07\xe2\x80\xa8Y", PI4_RANGES)
        self.assertFalse(board.supported)
        self.assertNotRegex(board.model, "[\x00-\x1f\x7f\u2028\u2029]")
        self.assertNotRegex(board.reason, "[\x00-\x1f\x7f\u2028\u2029]")


class CliBoardTests(unittest.TestCase):
    def run_check(self, model, ranges):
        tmp = tempfile.mkdtemp(prefix="fm-node-cli-")
        self.addCleanup(shutil.rmtree, tmp, True)
        files = []
        for name, data in (("model", model), ("ranges", ranges)):
            path = os.path.join(tmp, name)
            if data is not None:
                with open(path, "wb") as handle:
                    handle.write(data)
            files.append(path)
        return subprocess.run([sys.executable, "-B", FM_NODE, "--check-board", "--model-file", files[0], "--ranges-file", files[1]],
                              capture_output=True, timeout=20)

    def test_supported(self):
        done = self.run_check(PI4, PI4_RANGES)
        self.assertEqual(done.returncode, 0)
        self.assertEqual(json.loads(done.stdout), {"supported": True, "board": "Raspberry Pi 4 Model B Rev 1.4", "reason": None})

    def test_pi_5_exits_1_and_says_why(self):
        done = self.run_check(PI5, PI5_RANGES)
        self.assertEqual(done.returncode, 1)
        answer = json.loads(done.stdout)
        self.assertFalse(answer["supported"])
        self.assertEqual(answer["board"], "Raspberry Pi 5 Model B Rev 1.0")
        self.assertIn("Pi 5", answer["reason"])

    def test_no_device_tree_exits_1(self):
        done = self.run_check(None, None)
        self.assertEqual(done.returncode, 1)
        self.assertEqual(json.loads(done.stdout)["board"], None)

    @unittest.skipIf(os.path.exists("/proc/device-tree/model"), "this machine has a device tree")
    def test_this_machine_without_flags_is_not_a_pi(self):
        done = subprocess.run([sys.executable, "-B", FM_NODE, "--check-board"], capture_output=True, timeout=20)
        self.assertEqual(done.returncode, 1)
        self.assertFalse(json.loads(done.stdout)["supported"])


class ConfigTests(unittest.TestCase):
    def build(self, text, overrides=None):
        values, warnings = fm.parse_config_text(text)
        return fm.build_config(values, warnings, overrides), warnings

    def test_defaults(self):
        cfg, warnings = self.build("TOKEN=" + "a" * 16)
        self.assertEqual((cfg.bind, cfg.control_port, cfg.audio_port, cfg.dma, cfg.deadman_s), ("127.0.0.1", 8788, 8789, 0, 30))
        self.assertEqual((cfg.freq_min, cfg.freq_max, cfg.bandwidth_max), (87.5, 108.0, 150))
        self.assertEqual(cfg.binary, "/usr/local/lib/headunit-fm/fm_transmitter")
        self.assertEqual(warnings, [])

    def test_the_password_is_required_and_must_be_long_and_plain(self):
        for text in ("", "TOKEN=", "TOKEN=short", "TOKEN=" + "a" * 15, "# TOKEN=" + "a" * 20):
            with self.subTest(text=text):
                with self.assertRaises(fm.ConfigError) as caught:
                    self.build(text)
                self.assertIn("shorter than 16", str(caught.exception))
        for text in ("TOKEN=" + "a" * 101, "TOKEN=" + "a" * 8 + " " + "b" * 8, "TOKEN=" + "a" * 15 + "\u00e9"):
            with self.subTest(text=text):
                with self.assertRaises(fm.ConfigError) as caught:
                    self.build(text)
                self.assertIn("16 to 100 plain characters", str(caught.exception))
        self.build("TOKEN=" + "a" * 16)
        self.build("TOKEN=" + "a" * 100)
        self.build('TOKEN="%s"' % ("b" * 20))

    def test_comments_quotes_unknown_keys_and_junk(self):
        cfg, warnings = self.build("# a comment\n\nTOKEN='%s'\n  BIND = 0.0.0.0  \nFOO=bar\nlowercase=1\nnot a setting\nDMA=3\n" % ("c" * 20))
        self.assertEqual(cfg.token, "c" * 20)
        self.assertEqual((cfg.bind, cfg.dma), ("0.0.0.0", 3))
        self.assertEqual(len(warnings), 3)
        self.assertIn("FOO", " ".join(warnings))

    def test_warnings_never_contain_values(self):
        secret = "s3cr3t-value-0123456789"
        _, warnings = fm.parse_config_text("TOKEN=%s\nTOKEN=%s\nFOO=%s\n%s\nbad key=%s\n" % (secret, secret, secret, secret, secret))
        self.assertTrue(warnings)
        self.assertNotIn(secret, " ".join(warnings))

    def test_bind_must_be_an_ip_address(self):
        for bad in ("localhost", "example.com", "1.2.3", "999.1.1.1", "0.0.0.0/0", "::g"):
            with self.subTest(bad=bad):
                with self.assertRaises(fm.ConfigError):
                    self.build("TOKEN=%s\nBIND=%s" % ("a" * 16, bad))
        for good in ("127.0.0.1", "0.0.0.0", "192.168.4.2", "::1", "::"):
            self.assertEqual(self.build("TOKEN=%s\nBIND=%s" % ("a" * 16, good))[0].bind, good)

    def test_numbers_are_checked(self):
        for line in ("CONTROL_PORT=70000", "CONTROL_PORT=-1", "CONTROL_PORT=abc", "AUDIO_PORT=1.5", "DMA=16", "DMA=-1", "DEADMAN_S=0", "DEADMAN_S=99999",
                     "BANDWIDTH_MAX=10", "FREQ_MIN=abc", "FREQ_MIN=nan", "FREQ_MAX=inf", "FREQ_MIN=1e3", "CONTROL_PORT=8788\nAUDIO_PORT=8788"):
            with self.subTest(line=line):
                with self.assertRaises(fm.ConfigError):
                    self.build("TOKEN=%s\n%s" % ("a" * 16, line))

    def test_the_band_is_kept_inside_76_to_108_and_on_the_grid(self):
        cfg, warnings = self.build("TOKEN=%s\nFREQ_MIN=50\nFREQ_MAX=200" % ("a" * 16))
        self.assertEqual((cfg.freq_min, cfg.freq_max), (76.0, 108.0))
        self.assertTrue(warnings)
        cfg, _ = self.build("TOKEN=%s\nFREQ_MIN=88.12\nFREQ_MAX=91.99" % ("a" * 16))
        self.assertEqual((cfg.freq_min, cfg.freq_max), (88.15, 91.95))  # rounded inwards
        cfg, _ = self.build("TOKEN=%s\nFREQ_MIN=88.1\nFREQ_MAX=90.3" % ("a" * 16))
        self.assertEqual((cfg.freq_min, cfg.freq_max), (88.1, 90.3))
        with self.assertRaises(fm.ConfigError):
            self.build("TOKEN=%s\nFREQ_MIN=100\nFREQ_MAX=99" % ("a" * 16))
        with self.assertRaises(fm.ConfigError):
            self.build("TOKEN=%s\nFREQ_MIN=109\nFREQ_MAX=120" % ("a" * 16))

    def test_the_bandwidth_ceiling_is_150(self):
        cfg, warnings = self.build("TOKEN=%s\nBANDWIDTH_MAX=400" % ("a" * 16))
        self.assertEqual(cfg.bandwidth_max, 150)
        self.assertTrue(warnings)
        self.assertEqual(self.build("TOKEN=%s\nBANDWIDTH_MAX=60" % ("a" * 16))[0].bandwidth_max, 60)

    def test_command_line_overrides_win(self):
        cfg, _ = self.build("TOKEN=%s\nBIND=0.0.0.0\nCONTROL_PORT=9000" % ("a" * 16), {"bind": "127.0.0.1", "control_port": 0, "audio_port": 0, "binary": "/x/y"})
        self.assertEqual((cfg.bind, cfg.control_port, cfg.audio_port, cfg.binary), ("127.0.0.1", 0, 0, "/x/y"))

    def test_the_binary_path_must_be_absolute(self):
        with self.assertRaises(fm.ConfigError):
            self.build("TOKEN=%s\nBIN=fm_transmitter" % ("a" * 16))

    def test_load_config_reads_the_file_and_warns_about_open_permissions(self):
        tmp = tempfile.mkdtemp(prefix="fm-node-conf-")
        self.addCleanup(shutil.rmtree, tmp, True)
        path = os.path.join(tmp, "c.conf")
        with open(path, "w") as handle:
            handle.write("TOKEN=" + "d" * 20 + "\n")
        os.chmod(path, 0o644)
        cfg, warnings = fm.load_config(path)
        self.assertEqual(cfg.token, "d" * 20)
        self.assertTrue(any("chmod 600" in w for w in warnings))
        os.chmod(path, 0o600)
        self.assertEqual(fm.load_config(path)[1], [])
        with self.assertRaises(fm.ConfigError):
            fm.load_config(os.path.join(tmp, "missing.conf"))
        with open(path, "wb") as handle:
            handle.write(b"\xff\xfe TOKEN")
        with self.assertRaises(fm.ConfigError):
            fm.load_config(path)

    def test_errors_never_contain_the_password(self):
        secret = "s3cr3t-value-0123456789"
        for text in ("TOKEN=%s\nBIND=nope" % secret, "TOKEN=%s\nDMA=99" % secret, "TOKEN=%s\nFREQ_MIN=x" % secret):
            try:
                self.build(text)
            except fm.ConfigError as problem:
                self.assertNotIn(secret, str(problem))
            else:
                self.fail("should have been refused")


class StartBodyTests(unittest.TestCase):
    def setUp(self):
        values, warnings = fm.parse_config_text("TOKEN=" + "a" * 16)
        self.cfg = fm.build_config(values, warnings)

    def parse(self, body, cfg=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return fm.parse_start_body(raw, cfg or self.cfg)

    def test_good_values_are_rounded_to_0_05(self):
        self.assertEqual(self.parse({"frequency": 100.6, "bandwidth": 100}), (100.6, 100))
        self.assertEqual(self.parse({"frequency": 100.63, "bandwidth": 100}), (100.65, 100))
        self.assertEqual(self.parse({"frequency": 100.62, "bandwidth": 100}), (100.6, 100))
        self.assertEqual(self.parse({"frequency": 100, "bandwidth": 100}), (100.0, 100))
        self.assertEqual(self.parse({"frequency": 87.5, "bandwidth": 25}), (87.5, 25))
        self.assertEqual(self.parse({"frequency": 108.0, "bandwidth": 150}), (108.0, 150))
        self.assertEqual(self.parse({"frequency": 99.99, "bandwidth": 100.4}), (100.0, 100))
        self.assertEqual(self.parse({"frequency": 99.1, "bandwidth": 100, "extra": [1, 2], "other": None}), (99.1, 100))

    def test_the_result_is_always_on_the_grid_and_in_the_band(self):
        step = 0.0137
        f = 87.5
        while f <= 108.0:
            tuned, _ = self.parse({"frequency": f, "bandwidth": 100})
            self.assertTrue(87.5 <= tuned <= 108.0, f)
            self.assertAlmostEqual(tuned * 20, round(tuned * 20), places=6)
            self.assertLess(abs(tuned - f), 0.0251)
            f += step

    def test_a_missing_bandwidth_means_the_documented_100(self):
        self.assertEqual(self.parse({"frequency": 100.6}), (100.6, 100))
        self.assertEqual(self.parse({"frequency": 100.6, "bandwidth": None}), (100.6, 100))

    def test_bad_frequencies_are_refused_with_a_sentence(self):
        bad = [None, "100.6", True, False, [], {}, [100.6], 0, -100.6, 87.49, 87.4999, 108.01, 108.1, 200, 1e9, 10 ** 400, -(10 ** 400), 76.0, 3.0]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(fm.BadRequest) as caught:
                    self.parse({"frequency": value, "bandwidth": 100})
                self.assertRegex(str(caught.exception), r"^The frequency ")
                self.assertLess(len(str(caught.exception)), 120)
        with self.assertRaises(fm.BadRequest):
            self.parse({"bandwidth": 100})

    def test_booleans_are_said_not_to_be_numbers(self):
        for body in ({"frequency": True, "bandwidth": 100}, {"frequency": False, "bandwidth": 100}):
            with self.assertRaises(fm.BadRequest) as caught:
                self.parse(body)
            self.assertIn("must be a number", str(caught.exception))
        with self.assertRaises(fm.BadRequest) as caught:
            self.parse({"frequency": 100.6, "bandwidth": True})
        self.assertIn("The bandwidth must be a number", str(caught.exception))

    def test_nan_and_infinity_are_refused_at_the_parser_and_again_at_the_range_check(self):
        for text in (b'{"frequency": NaN}', b'{"frequency": Infinity}', b'{"frequency": 100.6, "bandwidth": -Infinity}'):
            with self.assertRaises(fm.BadRequest) as caught:
                self.parse(text)
            self.assertIn("not valid JSON", str(caught.exception))   # JSON has no NaN; Python's parser would take it
        self.assertFalse(fm._number(float("nan")) == fm._number(float("nan")))   # NaN is not equal to itself: the range check below would still refuse it
        values, warnings = fm.parse_config_text("TOKEN=" + "a" * 16)
        cfg = fm.build_config(values, warnings)
        original = fm.json.loads
        fm.json.loads = lambda text, parse_constant=None: {"frequency": float("nan"), "bandwidth": float("nan")}
        try:
            with self.assertRaises(fm.BadRequest):
                fm.parse_start_body(b"{}", cfg)
            fm.json.loads = lambda text, parse_constant=None: {"frequency": 100.6, "bandwidth": float("nan")}
            with self.assertRaises(fm.BadRequest):
                fm.parse_start_body(b"{}", cfg)
        finally:
            fm.json.loads = original

    def test_non_json_numbers_are_refused(self):
        for text in (b'{"frequency": NaN, "bandwidth": 100}', b'{"frequency": Infinity, "bandwidth": 100}', b'{"frequency": -Infinity, "bandwidth": 100}',
                     b'{"frequency": 100.6, "bandwidth": NaN}', b'{"frequency": 1e999, "bandwidth": 100}', b'{"frequency": 100.6, "bandwidth": 1e999}'):
            with self.subTest(text=text):
                with self.assertRaises(fm.BadRequest):
                    self.parse(text)

    def test_a_number_too_big_for_a_float_is_a_frequency_error_not_a_crash(self):
        for text in (b'{"frequency": 1e999}', b'{"frequency": -1e999, "bandwidth": 100}', b'{"frequency": 1' + b"0" * 400 + b'}'):
            with self.assertRaises(fm.BadRequest) as caught:
                self.parse(text)
            self.assertIn("The frequency must be between", str(caught.exception))
        with self.assertRaises(fm.BadRequest) as caught:
            self.parse(b'{"frequency": 100.6, "bandwidth": 1e999}')
        self.assertIn("The bandwidth must be", str(caught.exception))

    def test_bad_bandwidths_are_refused(self):
        for value in ("100", True, [], {}, 0, 24, 24.4, 24.99, 151, 150.6, 1000, -100, 1e9, 10 ** 400):
            with self.subTest(value=value):
                with self.assertRaises(fm.BadRequest) as caught:
                    self.parse({"frequency": 100.6, "bandwidth": value})
                self.assertRegex(str(caught.exception), r"^The bandwidth ")

    def test_not_json_at_all(self):
        for body in (b"", b"{", b"null", b"[]", b"5", b'"x"', b"\xff\xfe", b'{"frequency": 100.6,}', b"[" * 1000, b"[" * 100000, b'{"a":' * 500, b"\x00"):
            with self.subTest(body=body[:20]):
                with self.assertRaises(fm.BadRequest):
                    self.parse(body)

    def test_the_configured_band_and_bandwidth_narrow_the_limits(self):
        values, warnings = fm.parse_config_text("TOKEN=%s\nFREQ_MIN=88\nFREQ_MAX=92\nBANDWIDTH_MAX=80" % ("a" * 16))
        cfg = fm.build_config(values, warnings)
        self.assertEqual(self.parse({"frequency": 90, "bandwidth": 80}, cfg), (90.0, 80))
        for body in ({"frequency": 87.95, "bandwidth": 50}, {"frequency": 92.05, "bandwidth": 50}, {"frequency": 90, "bandwidth": 81}):
            with self.assertRaises(fm.BadRequest):
                self.parse(body, cfg)
        self.assertEqual(self.parse({"frequency": 90}, cfg), (90.0, 80))  # the default 100 is cut to the ceiling

    def test_whatever_the_config_says_76_to_108_holds(self):
        values, warnings = fm.parse_config_text("TOKEN=%s\nFREQ_MIN=10\nFREQ_MAX=500\nBANDWIDTH_MAX=9999" % ("a" * 16))
        cfg = fm.build_config(values, warnings)
        self.assertEqual(self.parse({"frequency": 76.0, "bandwidth": 150}, cfg), (76.0, 150))
        self.assertEqual(self.parse({"frequency": 108, "bandwidth": 150}, cfg), (108.0, 150))
        for body in ({"frequency": 75.95, "bandwidth": 50}, {"frequency": 108.05, "bandwidth": 50}, {"frequency": 150, "bandwidth": 50}, {"frequency": 90, "bandwidth": 151}):
            with self.assertRaises(fm.BadRequest):
                self.parse(body, cfg)


class WavHeaderTests(unittest.TestCase):
    """The 44 bytes must be exactly what the program's WaveReader accepts."""

    class Rejected(Exception):
        pass

    @classmethod
    def wave_reader_accepts(cls, stream):
        """A line-by-line port of the WaveReader constructor (vendor/fm_transmitter/wave_reader.cpp, lines 80 to 103)."""
        header = bytearray(44)  # struct WaveHeader, no padding
        state = {"pos": 0, "offset": 0}

        def read(count):
            if state["pos"] + count > len(stream):
                raise cls.Rejected("Failed to read header, data corrupted")
            chunk = stream[state["pos"]:state["pos"] + count]
            state["pos"] += count
            if state["offset"] + count > len(header):
                raise cls.Rejected("memcpy past the end of the header struct")  # undefined behaviour in the C++
            header[state["offset"]:state["offset"] + count] = chunk
            state["offset"] += count

        u16 = lambda at: struct.unpack_from("<H", header, at)[0]
        u32 = lambda at: struct.unpack_from("<I", header, at)[0]
        read(4 + 4 + 4)
        if bytes(header[0:4]) != b"RIFF" or bytes(header[8:12]) != b"WAVE":
            raise cls.Rejected("WAVE file expected")
        read(4 + 4)
        if bytes(header[12:16]) != b"fmt " or u32(16) < 2 + 2 + 4 + 4 + 2 + 2:
            raise cls.Rejected("data corrupted")
        read(u32(16))
        audio_format, channels, rate, byte_rate, block_align, bits = u16(20), u16(22), u32(24), u32(28), u16(32), u16(34)
        if (audio_format != 1 or byte_rate != (bits >> 3) * channels * rate or block_align != (bits >> 3) * channels
                or ((bits >> 3) != 1 and (bits >> 3) != 2)):
            raise cls.Rejected("unsupported WAVE format")
        read(4 + 4)
        if bytes(header[36:40]) != b"data":
            raise cls.Rejected("data corrupted")
        return {"channels": channels, "rate": rate, "bits": bits, "byte_rate": byte_rate, "block_align": block_align, "data_size": u32(40),
                "consumed": state["pos"]}

    def test_the_header_is_exactly_these_44_bytes(self):
        self.assertEqual(len(fm.WAV_HEADER), 44)
        self.assertEqual(fm.WAV_HEADER, EXPECTED_HEADER)
        self.assertEqual(fm.wav_header(), EXPECTED_HEADER)

    def test_waveReader_accepts_it_and_reads_nothing_beyond_it(self):
        info = self.wave_reader_accepts(fm.WAV_HEADER + b"\x01\x02\x03\x04")
        self.assertEqual(info, {"channels": 1, "rate": 22050, "bits": 16, "byte_rate": 44100, "block_align": 2, "data_size": 0xFFFFFFFF, "consumed": 44})

    def test_the_port_rejects_what_the_real_reader_rejects(self):
        def mutate(offset, value):
            data = bytearray(fm.WAV_HEADER)
            data[offset:offset + len(value)] = value
            return bytes(data)
        bad = [mutate(0, b"RIFX"), mutate(8, b"WAVX"), mutate(12, b"fmtX"), mutate(16, struct.pack("<I", 15)), mutate(20, struct.pack("<H", 3)),
               mutate(28, struct.pack("<I", 44101)), mutate(32, struct.pack("<H", 3)), mutate(34, struct.pack("<H", 24)), mutate(36, b"dataX"[:4].replace(b"a", b"x")),
               mutate(16, struct.pack("<I", 18)), fm.WAV_HEADER[:43]]
        for stream in bad:
            with self.subTest(stream=stream.hex()):
                with self.assertRaises(self.Rejected):
                    self.wave_reader_accepts(stream)

    def test_the_stream_limit_is_the_unsigned_32_bit_maximum(self):
        self.assertEqual(struct.unpack_from("<I", fm.WAV_HEADER, 40)[0], 0xFFFFFFFF)
        self.assertLess(fm.ROLLOVER_BYTES, 0xFFFFFFFF - 44 - 10 * 44100)  # restart well before the program would see the end of the data


@unittest.skipUnless(shutil.which("g++") and os.path.exists(os.path.join(VENDOR, "wave_reader.cpp")), "needs g++ and the vendored source")
class RealWaveReaderTests(unittest.TestCase):
    """Compiles the program's own wave_reader.cpp (it only reads a file or stdin: no hardware) and feeds it what the helper produces."""

    HARNESS = r'''
#include "wave_reader.hpp"
#include <cstdio>
#include <cstdlib>
#include <mutex>
int main(int argc, char **argv) {
    std::mutex mtx;
    bool enable = true;
    unsigned buffers = argc > 1 ? std::atoi(argv[1]) : 1;
    try {
        WaveReader reader(std::string(), enable, mtx);
        const WaveHeader &h = reader.GetHeader();
        std::printf("header channels=%u rate=%u bits=%u byteRate=%u blockAlign=%u dataSize=%u\n", h.channels, h.sampleRate, h.bitsPerSample, h.byteRate, h.blockAlign, h.subchunk2Size);
        std::fflush(stdout);
        for (unsigned i = 0; i < buffers; i++) {
            std::vector<Sample> samples = reader.GetSamples(h.sampleRate, enable, mtx);
            double peak = 0;
            for (auto &s : samples) { double v = s.GetMonoValue(); if (v < 0) v = -v; if (v > peak) peak = v; }
            std::printf("buffer %u samples=%zu peak=%.4f\n", i, samples.size(), peak);
            std::fflush(stdout);
            if (samples.size() < h.sampleRate) { std::printf("short\n"); return 3; }
        }
    } catch (std::exception &e) {
        std::printf("error %s\n", e.what());
        return 1;
    }
    return 0;
}
'''

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="fm-node-wavereader-")
        for name in ("wave_reader.cpp", "wave_reader.hpp"):
            shutil.copy(os.path.join(VENDOR, name), cls.dir)
        with open(os.path.join(cls.dir, "harness.cpp"), "w") as handle:
            handle.write(cls.HARNESS)
        cls.exe = os.path.join(cls.dir, "harness")
        done = subprocess.run(["g++", "-std=c++11", "-O1", "-o", cls.exe, os.path.join(cls.dir, "harness.cpp"), os.path.join(cls.dir, "wave_reader.cpp")],
                              capture_output=True, cwd=cls.dir, timeout=120)
        if done.returncode != 0:
            shutil.rmtree(cls.dir, True)
            raise unittest.SkipTest("could not compile the WaveReader harness: " + done.stderr.decode()[-300:])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, True)

    def read_with_real_reader(self, stream, buffers=1):
        done = subprocess.run([self.exe, str(buffers)], input=stream, capture_output=True, timeout=30)
        return done.returncode, done.stdout.decode()

    def test_the_real_reader_accepts_our_header_and_reads_full_buffers(self):
        code, out = self.read_with_real_reader(fm.WAV_HEADER + bytes(44100 * 2), 2)
        self.assertEqual(code, 0, out)
        self.assertIn("header channels=1 rate=22050 bits=16 byteRate=44100 blockAlign=2 dataSize=4294967295", out)
        self.assertIn("buffer 0 samples=22050 peak=0.0000", out)
        self.assertIn("buffer 1 samples=22050 peak=0.0000", out)

    def test_the_real_reader_agrees_with_the_port_on_damaged_headers(self):
        base = fm.WAV_HEADER
        mutations = []
        for offset, value in ((0, b"RIFX"), (8, b"WAVX"), (12, b"fmtX"), (16, struct.pack("<I", 15)), (20, struct.pack("<H", 3)),
                              (22, struct.pack("<H", 2)), (24, struct.pack("<I", 44100)), (28, struct.pack("<I", 44101)), (32, struct.pack("<H", 3)),
                              (34, struct.pack("<H", 24)), (36, b"datX"), (4, struct.pack("<I", 0)), (40, struct.pack("<I", 0x7FFFFFFF)),
                              (22, struct.pack("<H", 2)), (32, struct.pack("<H", 4))):
            data = bytearray(base)
            data[offset:offset + len(value)] = value
            mutations.append(bytes(data))
        for stream in mutations:
            with self.subTest(stream=stream.hex()):
                try:
                    WavHeaderTests.wave_reader_accepts(stream)
                    port = True
                except WavHeaderTests.Rejected:
                    port = False
                code, out = self.read_with_real_reader(stream + bytes(44100 * 2))
                self.assertEqual(code == 0, port, "the port says %s, the real reader says: %s" % ("accepted" if port else "rejected", out))

    def test_the_helper_feeds_the_real_reader_without_a_gap(self):
        """Three full seconds through the real reader: it never sees the one silent second that it takes for the end of the stream."""
        helper = Helper(self)
        out_file = os.path.join(helper.tmp, "reader.txt")
        wrapper = os.path.join(helper.tmp, "wrapper.sh")
        with open(wrapper, "w") as handle:
            handle.write('#!/bin/sh\nexec "%s" 3 > "%s"\n' % (self.exe, out_file))
        os.chmod(wrapper, 0o755)
        helper.start(binary=wrapper)
        code, body, _ = helper.start_tx()
        self.assertEqual(code, 200, body)
        # a tone from a client, sent in real time in odd-sized pieces
        sock = helper.audio_ok()
        pcm = tone(5.0)
        stop = threading.Event()

        def feed():
            sent = 0
            while not stop.is_set() and sent < len(pcm):
                piece = pcm[sent:sent + 1001]
                try:
                    sock.sendall(piece)
                except OSError:
                    return
                sent += len(piece)
                time.sleep(len(piece) / 2 / 22050.0)
        feeder = threading.Thread(target=feed, daemon=True)
        feeder.start()
        try:
            self.assertTrue(wait_for(lambda: "buffer 2" in read_text(out_file), 15), helper.log)
        finally:
            stop.set()
            feeder.join(2)
            sock.close()
        text = read_text(out_file)
        self.assertIn("header channels=1 rate=22050 bits=16 byteRate=44100 blockAlign=2 dataSize=4294967295", text)
        for index in range(3):
            self.assertIn("buffer %d samples=22050" % index, text)
        self.assertNotIn("short", text)
        self.assertNotIn("error", text)
        peaks = [float(line.split("peak=")[1]) for line in text.splitlines() if line.startswith("buffer")]
        self.assertGreater(max(peaks), 0.3, text)   # the tone arrived, and in step (a shifted byte would be loud noise or silence)
        self.assertLess(max(peaks), 0.55, text)


# --------------------------------------------------------------------------------------------------------------------
# The ring (what the audio client sent, waiting for the pump)
# --------------------------------------------------------------------------------------------------------------------

class RingTests(unittest.TestCase):
    def block(self, value, n=fm.TICK_BYTES):
        return struct.pack("<h", value) * (n // 2)

    def test_silence_when_nobody_is_connected(self):
        ring = fm.Ring()
        ring.push(self.block(1000, 4410))
        self.assertEqual(ring.take(), bytes(fm.TICK_BYTES))
        self.assertEqual(ring.snapshot()[2], 0)  # no underrun counted without a client

    def test_waits_for_100ms_then_plays_in_order(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(self.block(1000, 882))
        self.assertEqual(ring.take(), bytes(882))            # not enough yet: silence, and not an underrun
        self.assertEqual(ring.snapshot()[2], 0)
        ring.push(self.block(2000, 4410 - 882 + 882))
        self.assertEqual(ring.take(), self.block(1000))      # 5292 waiting: plays, oldest first
        self.assertEqual(ring.snapshot()[2], 0)

    def test_underrun_writes_silence_counts_once_and_waits_again(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(self.block(1000, 4410))
        for _ in range(5):
            self.assertEqual(ring.take(), self.block(1000))
        self.assertEqual(ring.snapshot()[2], 0)
        self.assertEqual(ring.take(), bytes(882))            # ran dry
        self.assertEqual(ring.snapshot()[2], 1)
        self.assertEqual(ring.take(), bytes(882))            # waiting for 100 ms again: not another underrun
        self.assertEqual(ring.snapshot()[2], 1)

    def test_overflow_drops_the_oldest_and_counts_it(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(self.block(1, 17640))
        dropped = ring.push(self.block(2, 882))
        self.assertEqual(dropped, 882)
        self.assertEqual(ring.snapshot()[3], 882)
        taken = [ring.take() for _ in range(20)]
        self.assertEqual(taken[-1], self.block(2))           # the newest survived
        self.assertEqual(taken[0], self.block(1))

    def test_nothing_ever_exceeds_400ms_and_samples_stay_whole(self):
        ring = fm.Ring()
        ring.set_connected(True)
        for size in (2, 10, 882, 1000, 5000, 20000, 100000, 4):
            ring.push(bytes(size))
            self.assertLessEqual(len(ring._buf), 17640)
            self.assertEqual(len(ring._buf) % 2, 0)

    def test_drop_oldest_is_always_an_even_number_of_bytes_and_keeps_the_newest(self):
        for length in range(0, 40):
            for limit in (0, 1, 8, 9, 20, 39):
                buf = bytearray(range(length))
                before = bytes(buf)
                dropped = fm.drop_oldest(buf, limit)
                self.assertEqual(dropped % 2, 0, (length, limit))
                self.assertEqual(bytes(buf), before[dropped:], (length, limit))
                if length > limit:
                    self.assertLessEqual(len(buf), limit)
                else:
                    self.assertEqual(dropped, 0)

    def test_a_push_of_an_odd_size_still_drops_whole_samples(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(bytes(17640))
        for size in (1, 3, 17, 4411):
            before = ring.snapshot()[3]
            dropped = ring.push(bytes(size))
            self.assertEqual(dropped % 2, 0, size)
            self.assertEqual((ring.snapshot()[3] - before) % 2, 0)
            ring.clear()
            ring.push(bytes(17640))

    def test_the_level_follows_the_loudest_sample_and_decays(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(self.block(16384, 4410) + self.block(0, 882 * 10))
        levels = []
        for _ in range(8):
            ring.take()
            levels.append(ring.snapshot()[1])
        self.assertAlmostEqual(levels[0], 0.5, places=3)
        self.assertTrue(all(b < a for a, b in zip(levels[4:], levels[5:])))   # falling once the loud part is over
        full = fm.Ring()
        full.set_connected(True)
        full.push(self.block(-32768, 4410))
        full.take()
        self.assertEqual(full.snapshot()[1], 1.0)

    def test_set_connected_starts_clean(self):
        ring = fm.Ring()
        ring.set_connected(True)
        ring.push(self.block(1000, 8820))
        ring.set_connected(True)
        self.assertEqual(ring.take(), bytes(882))

    def test_peak_of(self):
        self.assertEqual(fm.peak_of(struct.pack("<hhh", 5, -300, 100)), 300)
        self.assertEqual(fm.peak_of(struct.pack("<hh", -32768, 1)), 32768)
        self.assertEqual(fm.peak_of(b""), 0)


class TokenCheckTests(unittest.TestCase):
    def node(self):
        values, warnings = fm.parse_config_text("TOKEN=" + TOKEN)
        return fm.Node(fm.build_config(values, warnings))

    def test_the_password_is_compared_in_constant_time(self):
        node = self.node()
        calls = []
        real = fm.hmac.compare_digest
        fm.hmac.compare_digest = lambda a, b: calls.append((a, b)) or real(a, b)
        try:
            self.assertTrue(node.check_token(TOKEN.encode()))
            self.assertFalse(node.check_token(WRONG.encode()))
            self.assertFalse(node.check_token(b""))
            self.assertFalse(node.check_token(TOKEN.encode() + b"x"))
        finally:
            fm.hmac.compare_digest = real
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(len(a) == len(b) == 32 for a, b in calls), "equal-length digests are compared, whatever length was sent")

    def test_bearer_parsing(self):
        self.assertEqual(fm.bearer_token("Bearer abc"), b"abc")
        self.assertEqual(fm.bearer_token("bearer abc"), b"abc")
        for header in (None, "", "Bearer", "Basic abc", "abc", "Bearerabc", "Bearer  "):
            token = fm.bearer_token(header)
            self.assertTrue(token is None or token == b"", header)


class FakeConn:
    """Hands out the chunks it was given, one per recv(), then reports the end of the stream."""

    def __init__(self, chunks):
        self.chunks = list(chunks)

    def settimeout(self, _):
        pass

    def recv(self, _):
        return self.chunks.pop(0) if self.chunks else b""


class AudioStreamTests(unittest.TestCase):
    def node(self):
        quiet_log(self)
        values, warnings = fm.parse_config_text("TOKEN=" + TOKEN)
        node = fm.Node(fm.build_config(values, warnings))
        node.ring.set_connected(True)
        return node

    def test_only_whole_samples_reach_the_ring_and_an_odd_byte_waits_for_the_next_read(self):
        node = self.node()
        fm.AudioHandler(node)._stream(FakeConn([b"\x01", b"\x02\x03\x04", b"\x05", b"\x06\x07"]), node, b"\x00")
        # 0 1 | 2 3 4 | 5 | 6 7  ->  bytes 0..7 are four whole samples; the end of the stream leaves nothing odd behind
        self.assertEqual(bytes(node.ring._buf), bytes(range(8)))

    def test_an_odd_end_of_stream_is_not_pushed_half_a_sample(self):
        node = self.node()
        fm.AudioHandler(node)._stream(FakeConn([b"\x01\x02", b"\x03"]), node, b"")
        self.assertEqual(bytes(node.ring._buf), b"\x01\x02")

    def test_hearing_sound_counts_as_hearing_from_the_head_unit(self):
        node = self.node()
        node.last_heard = time.monotonic() - 1000
        fm.AudioHandler(node)._stream(FakeConn([b"\x01\x02"]), node, b"")
        self.assertLess(time.monotonic() - node.last_heard, 5)


class SourceTests(unittest.TestCase):
    def test_python_3_9_syntax_and_no_third_party_imports(self):
        with open(FM_NODE) as handle:
            source = handle.read()
        tree = ast.parse(source, feature_version=(3, 9))
        stdlib = set(getattr(sys, "stdlib_module_names", ()))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names = [node.module]
            for name in names:
                top = name.split(".")[0]
                if stdlib:
                    self.assertIn(top, stdlib, name)
                self.assertNotIn(top, ("requests", "yaml", "numpy", "psutil"))

    def test_no_invisible_characters_in_the_source_or_the_tests(self):
        for path in (FM_NODE, os.path.abspath(__file__), os.path.join(HERE, "fm-node.conf.example"), os.path.join(HERE, "headunit-fm-node.service")):
            with open(path, encoding="utf-8") as handle:
                source = handle.read()
            for char in source:
                if char in "\n\t ":
                    continue
                self.assertTrue(char.isprintable() and ord(char) < 128, "%s has %r" % (os.path.basename(path), char))
            for bad in ("\u2028", "\u2029", "\u200b", "\ufeff", "\x00", "\r"):
                self.assertNotIn(bad, source)

    def test_the_tests_themselves_are_python_3_9_syntax(self):
        with open(os.path.abspath(__file__)) as handle:
            ast.parse(handle.read(), feature_version=(3, 9))

    def test_nothing_runs_a_shell_or_reads_the_password_into_a_message(self):
        with open(FM_NODE) as handle:
            source = handle.read()
        self.assertEqual(source.count("subprocess.Popen("), 1)
        for forbidden in ("shell=True", "os.system", "os.popen", "eval(", "exec("):
            self.assertNotIn(forbidden, source)
        self.assertNotRegex(source, r"log\([^\n]*(token|TOKEN)")


# --------------------------------------------------------------------------------------------------------------------
# The helper as a program
# --------------------------------------------------------------------------------------------------------------------

class StartupTests(unittest.TestCase):
    def run_helper(self, config_text, *extra):
        tmp = tempfile.mkdtemp(prefix="fm-node-start-")
        self.addCleanup(shutil.rmtree, tmp, True)
        path = os.path.join(tmp, "c.conf")
        with open(path, "w") as handle:
            handle.write(config_text)
        os.chmod(path, 0o600)
        return subprocess.run([sys.executable, "-B", FM_NODE, "--config", path, "--control-port", "0", "--audio-port", "0", *extra],
                              capture_output=True, timeout=20)

    def test_it_refuses_to_start_without_a_long_enough_password(self):
        for text in ("", "TOKEN=short\n", "BIND=127.0.0.1\n"):
            done = self.run_helper(text)
            self.assertEqual(done.returncode, 2)
            self.assertIn(b"TOKEN", done.stderr)
            self.assertEqual(done.stdout, b"")

    def test_it_refuses_to_start_without_a_config_file(self):
        done = subprocess.run([sys.executable, "-B", FM_NODE, "--config", "/nonexistent/x.conf"], capture_output=True, timeout=20)
        self.assertEqual(done.returncode, 2)
        self.assertIn(b"cannot be read", done.stderr)

    def test_a_bad_value_is_a_plain_sentence_not_a_traceback(self):
        done = self.run_helper("TOKEN=%s\nBIND=nope\n" % ("a" * 20))
        self.assertEqual(done.returncode, 2)
        self.assertIn(b"BIND must be an IP address", done.stderr)
        self.assertNotIn(b"Traceback", done.stderr)

    def test_one_json_line_with_both_ports_then_a_clean_exit_on_sigterm(self):
        helper = Helper(self).start()
        self.assertGreater(helper.control, 0)
        self.assertGreater(helper.audio, 0)
        self.assertNotEqual(helper.control, helper.audio)
        helper.proc.send_signal(signal.SIGTERM)
        self.assertEqual(helper.proc.wait(timeout=10), 0)

    def test_it_can_listen_on_an_ipv6_address(self):
        try:
            probe = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
            try:
                probe.bind(("::1", 0))
            finally:
                probe.close()
        except OSError:
            self.skipTest("no IPv6 loopback on this machine")
        helper = Helper(self, args=["--bind", "::1"]).start()
        sock = socket.create_connection(("::1", helper.control), timeout=5)
        self.addCleanup(sock.close)
        sock.sendall(("GET /v1/status HTTP/1.1\r\nAuthorization: Bearer %s\r\n\r\n" % TOKEN).encode())
        self.assertTrue(recv_all(sock, 5).startswith(b"HTTP/1.1 200 OK"))

    def test_it_listens_on_loopback_by_default(self):
        helper = Helper(self).start()
        out = subprocess.run(["ss", "-ltnH"], capture_output=True, text=True).stdout if shutil.which("ss") else ""
        if out:
            mine = [line for line in out.splitlines() if (":%d " % helper.control) in line or (":%d " % helper.audio) in line]
            self.assertTrue(mine)
            for line in mine:
                self.assertIn("127.0.0.1:", line)


class AuthTests(unittest.TestCase):
    def test_every_request_needs_the_password(self):
        helper = Helper(self).start()
        for method, path in (("GET", "/v1/status"), ("POST", "/v1/start"), ("POST", "/v1/stop"), ("GET", "/nothing"), ("DELETE", "/v1/status")):
            for token in (None, WRONG, TOKEN[:-1], TOKEN + "x"):
                with self.subTest(method=method, path=path, token=token):
                    code, body, headers = helper.request(method, path, {"frequency": 100.6, "bandwidth": 100} if method == "POST" else None, token=token)
                    self.assertEqual(code, 401)
                    self.assertEqual(headers.get("www-authenticate"), "Bearer")
                    self.assertIn("password", body["error"])
        self.assertEqual(helper.runs(), [])

    def test_other_ways_of_sending_it_do_not_work(self):
        helper = Helper(self).start()
        for headers in ({"Authorization": TOKEN}, {"Authorization": "Basic " + TOKEN}, {"Authorization": "Token " + TOKEN}, {"X-Token": TOKEN},
                        {"Cookie": "token=" + TOKEN}, {"Authorization": "Bearer"}, {"Authorization": "Bearer "}):
            with self.subTest(headers=headers):
                code, _, _ = helper.request("GET", "/v1/status", token=None, headers=headers)
                self.assertEqual(code, 401)
        code, _, _ = helper.request("GET", "/v1/status?token=" + TOKEN, token=None)
        self.assertEqual(code, 401)
        code, _, _ = helper.request("GET", "/v1/status", headers={"Authorization": "bearer " + TOKEN}, token=None)
        self.assertEqual(code, 200)   # the scheme name is case-insensitive

    def test_a_wrong_password_is_slowed_down_but_the_right_one_is_not(self):
        helper = Helper(self).start()
        started = time.monotonic()
        helper.request("GET", "/v1/status", token=WRONG)
        self.assertGreaterEqual(time.monotonic() - started, 0.15)
        # while a queue of wrong guesses is being slowed down one by one (about 1.2 s), a request with the right password goes straight through
        done = {}

        def guess(index):
            helper.request("GET", "/v1/status", token=WRONG)
            done["wrong%d" % index] = time.monotonic()
        guesses = [threading.Thread(target=guess, args=(i,)) for i in range(6)]
        for t in guesses:
            t.start()
        time.sleep(0.3)
        helper.request("GET", "/v1/status")
        done["right"] = time.monotonic()
        for t in guesses:
            t.join()
        last_wrong = max(v for k, v in done.items() if k.startswith("wrong"))
        self.assertLess(done["right"], last_wrong - 0.5, "the right password must not wait in the queue of wrong ones")

    def test_guessing_is_limited_however_many_connections_are_used(self):
        helper = Helper(self).start()
        started = time.monotonic()
        results = []

        def guess():
            results.append(helper.request("GET", "/v1/status", token=WRONG)[0])
        threads = [threading.Thread(target=guess) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results, [401] * 6)
        self.assertGreaterEqual(time.monotonic() - started, 6 * 0.2 * 0.8)  # one at a time

    def test_the_password_is_not_in_the_log_even_after_wrong_attempts(self):
        helper = Helper(self).start()
        helper.request("GET", "/v1/status", token=WRONG)
        helper.request("GET", "/v1/status")
        self.assertIn("wrong or missing password", helper.log)   # it is logged, without the password
        # close() asserts that neither TOKEN nor WRONG is in the log

    def test_a_wrong_password_does_not_keep_the_transmitter_alive(self):
        helper = Helper(self, config="DEADMAN_S=2").start()
        self.assertEqual(helper.start_tx()[0], 200)
        end = time.monotonic() + 3.5
        while time.monotonic() < end:
            helper.request("GET", "/v1/status", token=WRONG)
        self.assertEqual(helper.status()["state"], "idle")


class BoardRefusalTests(unittest.TestCase):
    def assert_never_executed(self, helper):
        time.sleep(0.3)
        self.assertEqual(helper.runs(), [], "the transmitter program was started on a board that is not supported")

    def test_a_pi_5_never_reaches_the_binary(self):
        helper = Helper(self, model=PI5, ranges=PI5_RANGES).start()
        status = helper.status()
        self.assertFalse(status["supported"])
        self.assertEqual(status["board"], "Raspberry Pi 5 Model B Rev 1.0")
        self.assertIn("Pi 5", status["reason"])
        self.assertEqual(status["state"], "idle")
        for body in ({"frequency": 100.6, "bandwidth": 100}, {"frequency": 100.6}, {"frequency": 87.5, "bandwidth": 25}):
            code, answer, _ = helper.request("POST", "/v1/start", body)
            self.assertEqual(code, 403)
            self.assertIn("Pi 5", answer["error"])
        self.assertEqual(helper.status()["state"], "idle")
        self.assert_never_executed(helper)

    def test_unknown_unreadable_and_mismatched_boards_never_reach_the_binary(self):
        cases = [(None, None), (b"Orange Pi 5\x00", PI4_RANGES), (PI4, None), (PI4, PI3_RANGES), (PI3, PI4_RANGES), (b"\x00", PI4_RANGES),
                 (b"Raspberry Pi 4 Model B Rev 1.4; touch /tmp/x", PI4_RANGES)]
        for model, ranges in cases:
            with self.subTest(model=model, ranges=ranges):
                helper = Helper(self, model=model, ranges=ranges).start()
                self.assertFalse(helper.status()["supported"])
                code, answer, _ = helper.request("POST", "/v1/start", {"frequency": 100.6, "bandwidth": 100})
                self.assertEqual(code, 403, answer)
                self.assertTrue(answer["error"])
                self.assert_never_executed(helper)
                helper.close()

    def test_a_board_that_stops_being_recognised_is_refused_at_the_next_start(self):
        helper = Helper(self).start()
        self.assertTrue(helper.status()["supported"])
        with open(helper.model, "wb") as handle:
            handle.write(PI5)
        code, answer, _ = helper.request("POST", "/v1/start", {"frequency": 100.6, "bandwidth": 100})
        self.assertEqual(code, 403, answer)
        self.assertEqual(helper.runs(), [])
        self.assertFalse(helper.status()["supported"])

    def test_audio_is_refused_on_an_unsupported_board(self):
        helper = Helper(self, model=PI5, ranges=PI5_RANGES).start()
        sock = helper.audio_connect()
        self.assertTrue(recv_line(sock).startswith(b"ERR "))
        sock.close()

    def test_a_supported_board_does_start_it(self):
        for model, ranges in ((PI4, PI4_RANGES), (PI3, PI3_RANGES), (PI_ZERO, PI_ZERO_RANGES)):
            with self.subTest(model=model):
                helper = Helper(self, model=model, ranges=ranges).start()
                self.assertEqual(helper.start_tx()[0], 200)
                self.assertEqual(len(helper.runs()), 1)
                helper.close()


class ControlProtocolTests(unittest.TestCase):
    def test_status_shape(self):
        helper = Helper(self).start()
        status = helper.status()
        self.assertEqual(status, {
            "protocol": 1, "version": "1.0.0", "board": "Raspberry Pi 4 Model B Rev 1.4", "supported": True, "reason": None, "state": "idle",
            "frequency": None, "bandwidth": None, "audio": {"connected": False, "level": 0.0, "underruns": 0}, "error": None,
            "limits": {"min": 87.5, "max": 108.0, "maxBandwidth": 150}, "deadmanS": 30})

    def test_routes_and_methods(self):
        helper = Helper(self).start()
        self.assertEqual(helper.request("GET", "/")[0], 404)
        self.assertEqual(helper.request("GET", "/v1")[0], 404)
        self.assertEqual(helper.request("GET", "/v1/status/")[0], 404)
        self.assertEqual(helper.request("GET", "/v2/status")[0], 404)
        code, _, headers = helper.request("POST", "/v1/status", {})
        self.assertEqual((code, headers.get("allow")), (405, "GET"))
        code, _, headers = helper.request("GET", "/v1/start")
        self.assertEqual((code, headers.get("allow")), (405, "POST"))
        for method in ("PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"):
            self.assertEqual(helper.request(method, "/v1/stop")[0], 405, method)
        self.assertEqual(helper.runs(), [])

    def test_start_validates_everything(self):
        helper = Helper(self).start()
        bad = [{"frequency": 5}, {"frequency": 200}, {"frequency": "100.6"}, {"frequency": None}, {}, {"frequency": 100.6, "bandwidth": 0},
               {"frequency": 100.6, "bandwidth": 151}, {"frequency": 100.6, "bandwidth": 24}, {"frequency": 100.6, "bandwidth": "x"}, [], "x", 5, b"null",
               {"frequency": 87.49}, {"frequency": 108.01}, {"frequency": True}, {"frequency": 1e999}]
        for body in bad:
            with self.subTest(body=body):
                code, answer, _ = helper.request("POST", "/v1/start", body)
                self.assertEqual(code, 400)
                self.assertTrue(answer["error"].endswith("."))
        for raw in (b"", b"{", b'{"frequency": NaN}', b'{"frequency": Infinity, "bandwidth": 100}', b"\xff", b"[" * 1000):
            with self.subTest(raw=raw[:10]):
                self.assertEqual(helper.request("POST", "/v1/start", raw)[0], 400)
        self.assertEqual(helper.runs(), [], "a refused request must never start the program")
        self.assertEqual(helper.status()["state"], "idle")

    def test_start_needs_a_json_content_type_and_a_length(self):
        helper = Helper(self).start()
        body = json.dumps({"frequency": 100.6, "bandwidth": 100}).encode()
        for content_type in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonx", ""):
            with self.subTest(content_type=content_type):
                code, _, _ = helper.request("POST", "/v1/start", body, content_type=content_type)
                self.assertEqual(code, 415)
        self.assertEqual(helper.runs(), [])
        code, _, _ = helper.request("POST", "/v1/start", body, content_type="application/json; charset=utf-8")
        self.assertEqual(code, 200)

    def test_start_reports_the_new_status(self):
        helper = Helper(self).start()
        code, status, _ = helper.start_tx(100.63, 90)
        self.assertEqual(code, 200)
        self.assertEqual((status["state"], status["frequency"], status["bandwidth"], status["error"]), ("transmitting", 100.65, 90, None))
        self.assertEqual(helper.status()["frequency"], 100.65)

    def test_the_program_gets_exactly_this_argument_list_and_an_empty_environment(self):
        helper = Helper(self, config="DMA=7").start()
        self.assertEqual(helper.start_tx(100.6, 100)[0], 200)
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        self.assertEqual(run.argv, ["-f", "100.60", "-b", "100", "-d", "7", "-"])
        self.assertEqual(json.loads(wait_for(lambda: run.read("env.json"), 5)), [])
        self.assertEqual(run.read("cwd"), "/")

    def test_a_shell_in_a_value_cannot_reach_the_program(self):
        helper = Helper(self).start()
        for value in ("100.6; touch /tmp/fm-pwned", "$(touch /tmp/fm-pwned)", "`id`", "100.6 -r"):
            code, _, _ = helper.request("POST", "/v1/start", {"frequency": value, "bandwidth": 100})
            self.assertEqual(code, 400)
            code, _, _ = helper.request("POST", "/v1/start", {"frequency": 100.6, "bandwidth": value})
            self.assertEqual(code, 400)
        self.assertEqual(helper.runs(), [])
        self.assertFalse(os.path.exists("/tmp/fm-pwned"))

    def test_start_twice_with_the_same_values_does_not_restart(self):
        helper = Helper(self).start()
        helper.start_tx(100.6, 100)
        first = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = first.pid
        self.assertEqual(helper.start_tx(100.6, 100)[0], 200)
        self.assertEqual(helper.start_tx(100.62, 100)[0], 200)  # rounds to the same 100.60
        self.assertEqual(len(helper.runs()), 1)
        self.assertTrue(pid_alive(pid))

    def test_retune_restarts_with_a_fresh_header(self):
        helper = Helper(self).start()
        helper.start_tx(100.6, 100)
        first = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        time.sleep(0.3)
        code, status, _ = helper.start_tx(101.1, 100)
        self.assertEqual((code, status["state"], status["frequency"]), (200, "transmitting", 101.1))
        self.assertFalse(pid_alive(first.pid), "the old program must be gone before the answer")
        self.assertTrue(first.exists("term"))
        runs = helper.runs()
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[1].argv[:2], ["-f", "101.10"])
        self.assertTrue(wait_for(lambda: runs[1].stdin.startswith(EXPECTED_HEADER), 5))
        self.assertEqual(runs[0].stdin[:44], EXPECTED_HEADER)

    def test_stop_switches_the_carrier_off_and_reaps_the_program_before_answering(self):
        helper = Helper(self).start()
        helper.start_tx()
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = wait_for(lambda: run.pid, 5)
        self.assertTrue(pid_alive(pid))
        code, status, _ = helper.request("POST", "/v1/stop")
        self.assertEqual(code, 200)
        self.assertEqual((status["state"], status["frequency"], status["bandwidth"]), ("idle", None, None))
        self.assertFalse(pid_alive(pid), "the program must be gone (reaped) when the answer arrives")
        self.assertTrue(run.exists("term"), "it must be asked to stop with SIGTERM so that it can release the GPIO")
        code, status, _ = helper.request("POST", "/v1/stop")  # stopping twice is fine
        self.assertEqual((code, status["state"]), (200, "idle"))
        self.assertEqual(len(helper.runs()), 1)

    def test_a_program_that_ignores_sigterm_is_killed_after_two_seconds(self):
        helper = Helper(self, fake_mode="ignore_term").start()
        helper.start_tx()
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = wait_for(lambda: run.pid, 5)
        started = time.monotonic()
        code, status, _ = helper.request("POST", "/v1/stop")
        took = time.monotonic() - started
        self.assertEqual((code, status["state"]), (200, "idle"))
        self.assertGreaterEqual(took, 1.8)
        self.assertLess(took, 6.0)
        self.assertFalse(pid_alive(pid))
        self.assertIn("killed", helper.log)

    def test_sigterm_to_the_helper_stops_the_program_first(self):
        helper = Helper(self).start()
        helper.start_tx()
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = wait_for(lambda: run.pid, 5)
        helper.proc.send_signal(signal.SIGTERM)
        self.assertEqual(helper.proc.wait(timeout=10), 0)
        self.assertFalse(pid_alive(pid))
        self.assertTrue(run.exists("term"))


class StdinContractTests(unittest.TestCase):
    """What the program reads: its header, then a stream that never stops and never runs ahead of real time."""

    def started(self, helper):
        self.assertEqual(helper.start_tx()[0], 200)
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        wait_for(lambda: len(run.stdin) >= 44, 5)
        return run

    def test_header_then_silence_in_real_time_with_nobody_connected(self):
        helper = Helper(self).start()
        run = self.started(helper)
        time.sleep(2.5)
        data = run.stdin
        self.assertEqual(data[:44], EXPECTED_HEADER)
        self.assertEqual(data[44:], bytes(len(data) - 44), "with no audio client it must be silence")
        self.assertFalse(run.exists("starved"), "the program would have taken a silent second for the end of the stream")
        self.assertFalse(run.exists("eof"))
        times = [line.split() for line in (run.read("times.log") or "").splitlines()]
        elapsed = float(times[-1][0]) - float(times[0][0])
        expected = 8820 + 44100 * elapsed   # 200 ms of lead, then real time
        self.assertGreater(elapsed, 1.5)
        self.assertLess(abs((len(data) - 44) - expected), 44100 * 1.2, "%d bytes in %.2f s" % (len(data) - 44, elapsed))
        self.assertEqual((len(data) - 44) % 2, 0)

    def test_the_stream_never_runs_far_ahead_of_real_time(self):
        helper = Helper(self).start()
        started = time.monotonic()
        run = self.started(helper)
        time.sleep(2.0)
        seconds = time.monotonic() - started
        sent = len(run.stdin) - 44
        self.assertLess(sent, 44100 * (seconds + 0.6), "%d bytes in %.2f s" % (sent, seconds))   # a pump that is not paced would send megabytes
        self.assertGreater(sent, 44100 * (seconds - 1.6))

    def test_the_clients_sound_arrives_whole_in_order_and_in_step(self):
        helper = Helper(self).start()
        run = self.started(helper)
        sock = helper.audio_ok()
        ramp = b"".join(struct.pack("<h", 1000 + i) for i in range(14 * 441))   # 14 blocks of 20 ms, every sample different
        sock.sendall(ramp[:1])                      # odd pieces: a sample split across sends must be put back together
        time.sleep(0.05)
        sock.sendall(ramp[1:4001])
        time.sleep(0.05)
        sock.sendall(ramp[4001:])
        found = wait_for(lambda: ramp in run.stdin, 8)
        self.assertTrue(found, "the sound did not reach the program intact (%d bytes seen)" % len(run.stdin))
        data = run.stdin
        at = data.index(ramp)
        self.assertEqual((at - 44) % 2, 0, "the sound must start on a sample boundary")
        self.assertEqual(data[:44], EXPECTED_HEADER)
        self.assertTrue(helper.status()["audio"]["connected"])
        sock.close()
        self.assertTrue(wait_for(lambda: not helper.status()["audio"]["connected"], 5))

    def test_the_clients_bytes_are_never_forwarded_as_they_are(self):
        """A client that sends its own WAV header, or any text, gets it treated as sound: the program's stream starts with our header only."""
        helper = Helper(self).start()
        run = self.started(helper)
        sock = helper.audio_ok()
        sock.sendall(b"RIFF" + b"\xff" * 4 + b"WAVEfmt " + b"\x00" * 100)
        time.sleep(0.8)
        data = run.stdin
        self.assertEqual(data[:44], EXPECTED_HEADER)
        self.assertEqual(data.count(b"RIFF"), 1)
        self.assertEqual(len(data[44:]) % 2, 0)
        sock.close()

    def test_a_flood_from_the_client_is_bounded_and_does_not_break_the_stream(self):
        helper = Helper(self).start()
        run = self.started(helper)
        sock = helper.audio_ok()
        blob = tone(1.0)
        started = time.monotonic()
        total = 0
        while time.monotonic() - started < 2.0:
            sock.sendall(blob)
            total += len(blob)
        time.sleep(0.5)
        self.assertGreater(total, 44100 * 3, "the flood should have been much faster than real time")
        sent = len(run.stdin) - 44
        self.assertLess(sent, 44100 * (time.monotonic() - started + 1.0), "what the program reads must still be paced")
        self.assertFalse(run.exists("starved"))
        self.assertEqual(sent % 2, 0)
        self.assertTrue(helper.proc.poll() is None)
        sock.close()

    def test_a_program_that_stops_reading_does_not_block_the_helper_or_break_the_stream(self):
        """The real program can be slow to start. The pump must not block, must keep the header, and must drop whole samples only."""
        helper = Helper(self, fake_mode="stall:5").start()
        self.assertEqual(helper.start_tx()[0], 200)
        sock = helper.audio_ok()
        ramp = b"".join(struct.pack("<h", 1000 + (i % 20000)) for i in range(22050))   # one second, every sample inside 1000..20999
        started = time.monotonic()
        while time.monotonic() - started < 4.5:
            sock.sendall(ramp)   # the client runs at about real time with a bit to spare, while the program reads nothing
            time.sleep(0.9)
        self.assertEqual(helper.status()["state"], "transmitting", "the helper must stay responsive while the program is not reading")
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        self.assertTrue(wait_for(lambda: run.exists("stdin.bin") and len(run.stdin) > 200000, 15), "the program should read on once its stall is over")
        self.assertIn("not reading fast enough", helper.log)
        data = run.stdin
        self.assertEqual(data[:44], EXPECTED_HEADER, "the header must survive whatever is dropped")
        body = data[44:len(data) - (len(data) - 44) % 2]
        samples = struct.unpack("<%dh" % (len(body) // 2), body)
        stray = [v for v in samples if v != 0 and not 1000 <= v < 21000]
        self.assertEqual(stray, [], "a sample was cut in two: %r" % stray[:5])
        sock.close()

    def test_the_level_meter_and_underruns(self):
        helper = Helper(self).start()
        self.started(helper)
        sock = helper.audio_ok()
        pcm = tone(2.0, amplitude=0.5)
        level = 0.0
        for i in range(0, len(pcm), 4410):   # in real time, 100 ms at a time
            sock.sendall(pcm[i:i + 4410])
            time.sleep(0.1)
            level = max(level, helper.status()["audio"]["level"])
        self.assertGreater(level, 0.2)
        self.assertLessEqual(level, 1.0)
        sock.close()
        time.sleep(0.8)
        self.assertLess(helper.status()["audio"]["level"], 0.05, "silence must bring the meter down")
        sock = helper.audio_ok()
        sock.sendall(tone(0.3))
        time.sleep(1.0)
        self.assertGreaterEqual(helper.status()["audio"]["underruns"], 1)   # it ran dry
        sock.close()


class AudioProtocolTests(unittest.TestCase):
    def test_hello_ok_and_replies(self):
        helper = Helper(self).start()
        sock = helper.audio_connect()
        self.assertEqual(recv_line(sock), b"OK\n")
        sock.close()

    def test_a_hello_ended_with_a_carriage_return_is_fine(self):
        helper = Helper(self).start()
        sock = helper.audio_connect(line=("AUDIO 1 %s\r\n" % TOKEN).encode())
        self.assertEqual(recv_line(sock), b"OK\n")

    def test_sound_sent_in_the_same_packet_as_the_hello_is_not_lost(self):
        helper = Helper(self).start()
        self.assertEqual(helper.start_tx()[0], 200)
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        ramp = b"".join(struct.pack("<h", 2000 + i) for i in range(14 * 441))
        sock = helper.audio_connect(line=("AUDIO 1 %s\n" % TOKEN).encode() + ramp)
        self.assertEqual(recv_line(sock), b"OK\n")
        self.assertTrue(wait_for(lambda: ramp in run.stdin, 8), "the sound that came with the hello must be played")

    def test_wrong_and_malformed_hellos(self):
        helper = Helper(self).start()
        cases = [
            ("AUDIO 1 %s\n" % WRONG, b"ERR wrong password\n"),
            ("AUDIO 2 %s\n" % TOKEN, b"ERR unsupported protocol version\n"),
            ("AUDIO 0 %s\n" % TOKEN, b"ERR unsupported protocol version\n"),
            ("AUDIO %s\n" % TOKEN, b"ERR expected: AUDIO 1 <password>\n"),
            ("AUDIO 1 %s extra\n" % TOKEN, b"ERR expected: AUDIO 1 <password>\n"),
            ("audio 1 %s\n" % TOKEN, b"ERR expected: AUDIO 1 <password>\n"),
            ("GET / HTTP/1.1\n", b"ERR expected: AUDIO 1 <password>\n"),
            ("AUDIO 1 %s\n" % (TOKEN + "x"), b"ERR wrong password\n"),
            ("AUDIO 1 \n", b"ERR wrong password\n"),
        ]
        for line, expect in cases:
            with self.subTest(line=line):
                sock = helper.audio_connect(line=line.encode())
                self.assertEqual(recv_all(sock, 5), expect)
                sock.close()
        self.assertFalse(helper.status()["audio"]["connected"])

    def test_a_wrong_password_waits_before_answering(self):
        helper = Helper(self).start()
        started = time.monotonic()
        sock = helper.audio_connect(token=WRONG)
        recv_all(sock, 5)
        self.assertGreaterEqual(time.monotonic() - started, 0.15)

    def test_an_oversized_first_line_is_refused_without_reading_on(self):
        helper = Helper(self).start()
        sock = helper.audio_connect(line=b"AUDIO 1 " + b"a" * 5000)
        answer = recv_all(sock, 5)
        self.assertTrue(answer.startswith(b"ERR "), answer)
        self.assertLess(len(answer), 100)
        sock = helper.audio_connect(line=b"A" * 127 + b"\n")   # exactly fits: an error, but of the other kind
        self.assertTrue(recv_all(sock, 5).startswith(b"ERR expected"))
        sock = helper.audio_connect(line=b"A" * 128 + b"\n")   # one more: too long
        self.assertTrue(recv_all(sock, 5).startswith(b"ERR first line too long"))

    def test_no_hello_within_three_seconds_closes_the_connection(self):
        helper = Helper(self).start()
        sock = connect(self, helper.audio, 10)
        started = time.monotonic()
        answer = recv_all(sock, 8)
        took = time.monotonic() - started
        self.assertTrue(answer.startswith(b"ERR "), answer)
        self.assertGreater(took, 2.5)
        self.assertLess(took, 5.0)

    def test_a_dribbled_hello_is_cut_off_at_three_seconds_in_total(self):
        helper = Helper(self).start()
        sock = connect(self, helper.audio, 10)
        started = time.monotonic()
        closed = False
        sock.settimeout(0.05)
        for byte in b"AUDIO 1 %s" % TOKEN.encode():
            try:
                sock.sendall(bytes([byte]))
            except OSError:
                closed = True
                break
            try:
                sock.recv(100)   # an answer (the error) or the end of the stream: either way it was cut off
                closed = True
                break
            except socket.timeout:
                pass
            except OSError:
                closed = True
                break
            time.sleep(0.35)
            if time.monotonic() - started > 7:
                break
        took = time.monotonic() - started
        self.assertTrue(closed, "still connected after %.1f s" % took)
        self.assertGreater(took, 2.0)
        self.assertLess(took, 5.5)

    def test_a_new_client_replaces_the_old_one(self):
        helper = Helper(self).start()
        first = helper.audio_ok()
        second = helper.audio_ok()
        self.assertTrue(closed_by_peer(first, 5), "the first client must be closed")
        self.assertTrue(helper.status()["audio"]["connected"])
        second.sendall(bytes(100))
        time.sleep(0.2)
        self.assertTrue(helper.status()["audio"]["connected"])
        second.close()
        self.assertTrue(wait_for(lambda: not helper.status()["audio"]["connected"], 5))

    def test_a_wrong_password_does_not_replace_the_good_client(self):
        helper = Helper(self).start()
        good = helper.audio_ok()
        bad = helper.audio_connect(token=WRONG)
        recv_all(bad, 5)
        time.sleep(0.2)
        self.assertTrue(helper.status()["audio"]["connected"])
        good.sendall(bytes(10))
        good.close()

    def test_audio_and_the_dead_man(self):
        """Sound from the head unit counts as hearing from it."""
        helper = Helper(self, config="DEADMAN_S=2").start()
        helper.start_tx()
        sock = helper.audio_ok()
        end = time.monotonic() + 3.5
        while time.monotonic() < end:
            sock.sendall(bytes(882))
            time.sleep(0.02)
        self.assertEqual(helper.status()["state"], "transmitting")
        sock.close()


class DeadManTests(unittest.TestCase):
    def test_silence_from_the_head_unit_switches_the_transmitter_off(self):
        helper = Helper(self, config="DEADMAN_S=2").start()
        helper.start_tx()
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = wait_for(lambda: run.pid, 5)
        started = time.monotonic()
        self.assertTrue(wait_for(lambda: not pid_alive(pid), 8, 0.1), "the program is still running")
        took = time.monotonic() - started
        self.assertGreater(took, 1.0)
        self.assertLess(took, 6.0)
        self.assertTrue(run.exists("term"))
        status = helper.status()
        self.assertEqual((status["state"], status["frequency"], status["error"]), ("idle", None, None))
        self.assertIn("dead-man", helper.log)
        self.assertEqual(len(helper.runs()), 1, "it must not start again by itself")
        self.assertEqual(status["deadmanS"], 2)

    def test_polling_keeps_it_on_the_air(self):
        helper = Helper(self, config="DEADMAN_S=2").start()
        helper.start_tx()
        end = time.monotonic() + 3.5
        while time.monotonic() < end:
            self.assertEqual(helper.status()["state"], "transmitting")
            time.sleep(0.25)
        self.assertEqual(len(helper.runs()), 1)

    def test_the_timer_counts_from_the_last_request_not_from_the_start(self):
        helper = Helper(self, config="DEADMAN_S=3").start()
        helper.start_tx()
        time.sleep(1.8)
        helper.status()
        time.sleep(1.8)    # 3.6 s after the start, but only 1.8 s after the last request
        self.assertEqual(helper.status()["state"], "transmitting")

    def test_it_is_not_running_when_idle_so_nothing_happens(self):
        helper = Helper(self, config="DEADMAN_S=1").start()
        time.sleep(1.6)
        self.assertEqual(helper.status()["state"], "idle")
        self.assertEqual(helper.runs(), [])


class ChildFailureTests(unittest.TestCase):
    def test_a_program_that_fails_at_once_is_reported_in_the_answer(self):
        helper = Helper(self, fake_mode="fail:Error: Cannot open /dev/mem file (permission denied)").start()
        code, status, _ = helper.start_tx()
        self.assertEqual(code, 200)
        self.assertEqual(status["state"], "error")
        self.assertEqual(status["error"], "Error: Cannot open /dev/mem file (permission denied)")
        self.assertIsNone(status["frequency"])
        self.assertEqual(helper.status()["state"], "error")

    def test_it_is_not_restarted_by_itself_and_a_new_attempt_waits_five_seconds(self):
        helper = Helper(self, fake_mode="fail:boom").start()
        helper.start_tx()
        code, answer, _ = helper.start_tx()
        self.assertEqual(code, 409)
        self.assertIn("Wait", answer["error"])
        time.sleep(1.5)
        self.assertEqual(len(helper.runs()), 1, "no automatic restart")
        helper.set_mode("")
        started = time.monotonic()
        code = 409
        while code == 409 and time.monotonic() - started < 8:
            time.sleep(0.25)
            code, status, _ = helper.start_tx()
        self.assertEqual(code, 200)
        self.assertEqual(status["state"], "transmitting")
        self.assertGreater(time.monotonic() - started + 1.5, 4.0)
        self.assertEqual(len(helper.runs()), 2)

    def test_stop_clears_the_error(self):
        helper = Helper(self, fake_mode="fail:boom").start()
        helper.start_tx()
        code, status, _ = helper.request("POST", "/v1/stop")
        self.assertEqual((code, status["state"], status["error"]), (200, "idle", None))

    def test_a_program_that_dies_later_is_reported_as_an_error_with_its_last_line(self):
        helper = Helper(self).start()
        helper.start_tx()
        run = wait_for(lambda: helper.runs() and helper.runs()[0], 5)
        pid = wait_for(lambda: run.pid, 5)
        os.kill(pid, signal.SIGKILL)
        status = wait_for(lambda: helper.status()["state"] == "error" and helper.status(), 5)
        self.assertTrue(status, helper.log)
        self.assertEqual(status["error"], "The transmitter program was stopped by signal 9.")
        time.sleep(1.0)
        self.assertEqual(len(helper.runs()), 1, "no automatic restart")

    def test_a_program_that_ends_by_itself_is_an_error_even_with_exit_code_0(self):
        """The real program ends quietly (code 0) when it thinks the stream is over; for us that is still a failure to report."""
        helper = Helper(self, fake_mode="exit0").start()
        code, status, _ = helper.start_tx()
        self.assertEqual((code, status["state"]), (200, "error"))
        self.assertEqual(status["error"], "The transmitter program stopped by itself (exit code 0).")

    def test_a_missing_program_is_a_plain_error(self):
        helper = Helper(self).start(binary=os.path.join(tempfile.gettempdir(), "no-such-fm-transmitter"))
        code, status, _ = helper.start_tx()
        self.assertEqual(code, 200)
        self.assertEqual(status["state"], "error")
        self.assertIn("missing", status["error"])
        self.assertIn("setup-fm.sh", status["error"])

    def test_a_program_other_users_can_change_is_not_run_as_root(self):
        for mode in (0o777, 0o775, 0o757, 0o722):
            with self.subTest(mode=oct(mode)):
                helper = Helper(self, binary_mode=mode).start()
                code, status, _ = helper.start_tx()
                self.assertEqual((code, status["state"]), (200, "error"))
                self.assertIn("can be changed by other users", status["error"])
                self.assertEqual(helper.runs(), [])
                helper.close()

    def test_a_program_in_a_folder_other_users_can_change_is_not_run_as_root(self):
        helper = Helper(self)
        os.chmod(helper.tmp, 0o777)
        helper.start()
        code, status, _ = helper.start_tx()
        self.assertEqual((code, status["state"]), (200, "error"))
        self.assertIn("or its folder can be changed by other users", status["error"])
        self.assertEqual(helper.runs(), [])

    def test_a_program_that_is_not_executable_is_not_run(self):
        helper = Helper(self, binary_mode=0o644).start()
        code, status, _ = helper.start_tx()
        self.assertEqual(status["state"], "error")
        self.assertIn("not a program", status["error"])

    def test_a_directory_is_not_a_program(self):
        helper = Helper(self).start(binary=helper_dir(self))
        code, status, _ = helper.start_tx()
        self.assertEqual(status["state"], "error")

    def test_the_error_text_is_one_clean_short_line(self):
        helper = Helper(self, fake_mode="fail:" + "x" * 1000).start()
        _, status, _ = helper.start_tx()
        self.assertEqual(status["error"], "x" * 300)


def helper_dir(test):
    path = tempfile.mkdtemp(prefix="fm-node-dir-")
    test.addCleanup(shutil.rmtree, path, True)
    return path


class NodeGuardTests(unittest.TestCase):
    """The program is started from one place only, which checks again whatever it is given: the HTTP layer is not the only guard."""

    def node(self, **kwargs):
        quiet_log(self)
        helper = Helper(self, **kwargs)
        cfg, _ = fm.load_config(helper.config, {"model_file": helper.model, "ranges_file": helper.ranges, "binary": helper.binary})
        node = fm.Node(cfg)
        self.addCleanup(node.close)
        return helper, node

    def test_values_that_slipped_past_validation_are_refused_before_the_program_is_started(self):
        for frequency, bandwidth in ((200.0, 100), (75.0, 100), (100.6, 5), (100.6, 500), (float("nan"), 100), (100.6, 100.5), (100, 100), ("100.6", 100)):
            with self.subTest(frequency=frequency, bandwidth=bandwidth):
                helper, node = self.node()
                code, answer = node.start(frequency, bandwidth)
                self.assertEqual(code, 200)
                self.assertEqual(answer["state"], "error")
                self.assertIn("outside what this helper allows", answer["error"])
                self.assertEqual(helper.runs(), [])

    def test_a_pi_5_is_refused_by_the_node_itself(self):
        helper, node = self.node(model=PI5, ranges=PI5_RANGES)
        code, answer = node.start(100.6, 100)
        self.assertEqual(code, 403)
        self.assertEqual(helper.runs(), [])
        self.assertFalse(node.status()["supported"])
        # and even if something called the inner step directly
        node._spawn(100.6, 100)
        self.assertEqual(node.status()["state"], "error")
        self.assertEqual(helper.runs(), [])


class RolloverTests(unittest.TestCase):
    def test_it_restarts_the_program_with_a_fresh_header_before_the_stream_limit(self):
        helper = Helper(self, args=["--rollover-bytes", "100000"]).start()
        helper.start_tx()
        runs = wait_for(lambda: len(helper.runs()) >= 2 and helper.runs(), 12)
        self.assertTrue(runs, "no restart happened: " + helper.log)
        self.assertTrue(runs[0].exists("term"))
        self.assertTrue(wait_for(lambda: runs[1].stdin[:44] == EXPECTED_HEADER, 5))
        self.assertEqual(runs[1].argv, runs[0].argv)
        self.assertLess(len(runs[0].stdin), 100000 + 45000)   # it was not left running to the 4 GB end
        self.assertEqual(helper.status()["state"], "transmitting")
        self.assertIn("restarting the transmitter program before its stream limit", helper.log)


class LimitTests(unittest.TestCase):
    def raw(self, helper, payload, timeout=8):
        sock = connect(self, helper.control, timeout)
        try:
            try:
                sock.sendall(payload)
            except OSError:
                pass   # the helper may answer and hang up before a big payload is all sent
            return recv_all(sock, timeout)
        finally:
            sock.close()

    def status_line(self, answer):
        return answer.split(b"\r\n", 1)[0] if answer else b""

    def test_an_oversized_body_is_refused(self):
        helper = Helper(self).start()
        head = ("POST /v1/start HTTP/1.1\r\nAuthorization: Bearer %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n")
        answer = self.raw(helper, (head % (TOKEN, 1025)).encode() + b"{" * 1025)
        self.assertTrue(self.status_line(answer).startswith(b"HTTP/1.1 413"), answer[:100])
        answer = self.raw(helper, (head % (TOKEN, 10 ** 9)).encode())
        self.assertTrue(self.status_line(answer).startswith(b"HTTP/1.1 413"), answer[:100])
        big = json.dumps({"frequency": 100.6, "bandwidth": 100, "pad": "x" * 2000}).encode()
        self.assertEqual(helper.request("POST", "/v1/start", big)[0], 413)
        self.assertEqual(helper.runs(), [])

    def test_oversized_lines_and_header_blocks_are_refused(self):
        helper = Helper(self).start()
        answer = self.raw(helper, b"GET /" + b"a" * 20000 + b" HTTP/1.1\r\n\r\n")
        self.assertRegex(self.status_line(answer), rb"HTTP/1.1 (400|431)")
        answer = self.raw(helper, b"GET /v1/status HTTP/1.1\r\nX-Pad: " + b"a" * 20000 + b"\r\n\r\n")
        self.assertTrue(self.status_line(answer).startswith(b"HTTP/1.1 431"), answer[:100])
        many = b"".join(b"X-%d: y\r\n" % i for i in range(100))
        answer = self.raw(helper, b"GET /v1/status HTTP/1.1\r\n" + many + b"\r\n")
        self.assertTrue(self.status_line(answer).startswith(b"HTTP/1.1 431"), answer[:100])
        answer = self.raw(helper, b"GET /v1/status HTTP/1.1\r\n" + b"X-A: b\r\n" * 5000)   # no end of headers, endless
        self.assertRegex(self.status_line(answer), rb"HTTP/1.1 (400|431)")

    def test_malformed_requests_get_a_400_and_never_a_traceback(self):
        helper = Helper(self).start()
        for payload in (b"\x00\x01\x02\r\n\r\n", b"GET\r\n\r\n", b"GET / HTTP/9\r\n\r\n", b"get / HTTP/1.1\r\n\r\n", b"GET /v1/status HTTP/1.1\nHost: x\n\n",
                        b"GET /v1/status HTTP/1.1\r\n bad: fold\r\n\r\n", b"GET /v1/status HTTP/1.1\r\nBad Header: x\r\n\r\n",
                        b"POST /v1/start HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
                        b"POST /v1/start HTTP/1.1\r\nContent-Length: abc\r\n\r\n", b"POST /v1/start HTTP/1.1\r\nContent-Length: -5\r\n\r\n",
                        b"POST /v1/start HTTP/1.1\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\n",
                        b"GET /v1/status HTTP/1.1\r\nAuthorization: Bearer a\r\nAuthorization: Bearer b\r\n\r\n"):
            with self.subTest(payload=payload[:40]):
                answer = self.raw(helper, payload)
                self.assertRegex(self.status_line(answer), rb"HTTP/1.1 4\d\d", answer[:100])
                self.assertNotIn(b"Traceback", answer)
        self.assertTrue(helper.proc.poll() is None)
        self.assertEqual(helper.status()["state"], "idle")

    def test_a_request_that_stops_half_way_is_dropped_after_five_seconds(self):
        helper = Helper(self).start()
        sock = connect(self, helper.control, 12)
        sock.sendall(b"POST /v1/start HTTP/1.1\r\nAuthorization: Bearer " + TOKEN.encode() + b"\r\nContent-Length: 50\r\n\r\n{")
        started = time.monotonic()
        answer = recv_all(sock, 10)
        took = time.monotonic() - started
        self.assertTrue(self.status_line(answer).startswith(b"HTTP/1.1 408"), answer[:80])
        self.assertGreater(took, 4.0)
        self.assertLess(took, 7.5)
        sock.close()

    def test_a_dribbling_client_cannot_hold_a_connection_beyond_five_seconds(self):
        helper = Helper(self).start()
        sock = connect(self, helper.control, 12)
        started = time.monotonic()
        request = b"GET /v1/status HTTP/1.1\r\nAuthorization: Bearer " + TOKEN.encode() + b"\r\nX-Slow: " + b"a" * 200 + b"\r\n\r\n"
        sent = 0
        closed = False
        sock.settimeout(0.5)
        while time.monotonic() - started < 9 and sent < len(request):
            try:
                sock.sendall(request[sent:sent + 1])
                sent += 1
            except OSError:
                closed = True
                break
            try:
                if sock.recv(1) == b"":
                    closed = True
                    break
            except socket.timeout:
                pass
            except OSError:
                closed = True
                break
            time.sleep(0.3)
        took = time.monotonic() - started
        self.assertTrue(closed or sent < len(request), "the connection should have been cut off")
        self.assertLess(took, 8.0)
        self.assertGreater(took, 3.5)
        sock.close()

    def test_many_connections_are_capped_and_the_helper_stays_up(self):
        helper = Helper(self).start()
        idle = []
        try:
            for _ in range(60):
                idle.append(connect(self, helper.control, 5))
            time.sleep(0.5)
            turned_away = 0
            for sock in idle:
                sock.settimeout(0.05)
                try:
                    if sock.recv(1) == b"":
                        turned_away += 1
                except socket.timeout:
                    pass
                except OSError:
                    turned_away += 1
            self.assertGreaterEqual(turned_away, 60 - 8 - 1, "at most 8 connections from one address may be held")
            if os.path.exists("/proc/%d/status" % helper.proc.pid):
                with open("/proc/%d/status" % helper.proc.pid) as handle:
                    threads = int([line for line in handle if line.startswith("Threads:")][0].split()[1])
                self.assertLess(threads, 40, "threads: %d" % threads)
        finally:
            for sock in idle:
                sock.close()
        # once they are gone, the helper answers again
        self.assertTrue(wait_for(lambda: self.try_status(helper), 8))

    def try_status(self, helper):
        try:
            return helper.request("GET", "/v1/status", timeout=3)[0] == 200
        except OSError:
            return False

    def test_many_audio_connections_are_capped_too(self):
        helper = Helper(self).start()
        idle = [connect(self, helper.audio, 5) for _ in range(30)]
        try:
            time.sleep(0.5)
            closed = 0
            for sock in idle:
                sock.settimeout(0.05)
                try:
                    if sock.recv(1) == b"":
                        closed += 1
                except socket.timeout:
                    pass
                except OSError:
                    closed += 1
            self.assertGreaterEqual(closed, 30 - 4 - 1)
        finally:
            for sock in idle:
                sock.close()

    def test_a_client_that_never_reads_its_answer_does_not_stall_the_helper(self):
        helper = Helper(self).start()
        socks = []
        for _ in range(5):
            sock = connect(self, helper.control, 5)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
            sock.sendall(("GET /v1/status HTTP/1.1\r\nAuthorization: Bearer %s\r\n\r\n" % TOKEN).encode())
            socks.append(sock)
        self.assertEqual(helper.status()["state"], "idle")
        for sock in socks:
            sock.close()

    def test_a_flood_of_garbage_does_not_stop_a_good_client_on_another_connection(self):
        helper = Helper(self).start()
        stop = threading.Event()

        def noise():
            while not stop.is_set():
                try:
                    sock = socket.create_connection(("127.0.0.1", helper.control), timeout=2)
                    sock.sendall(b"\x00" * 50 + b"\r\n\r\n")
                    sock.close()
                except OSError:
                    pass
        threads = [threading.Thread(target=noise, daemon=True) for _ in range(3)]
        for t in threads:
            t.start()
        try:
            ok = 0
            for _ in range(10):
                try:
                    if helper.request("GET", "/v1/status", timeout=5)[0] == 200:
                        ok += 1
                except OSError:
                    pass
                time.sleep(0.1)
        finally:
            stop.set()
            for t in threads:
                t.join(3)
        self.assertGreaterEqual(ok, 5)
        self.assertTrue(helper.proc.poll() is None)

    def test_output_from_the_program_is_bounded(self):
        """A program that prints a lot cannot make the helper grow or stall; only its last line is kept."""
        helper = Helper(self)
        spam = os.path.join(helper.tmp, "spam.py")
        with open(spam, "w") as handle:
            handle.write("#!%s\nimport sys, time\nfor i in range(20000):\n    sys.stderr.write('line %%d ' %% i + 'y' * 500 + '\\n')\n"
                         "sys.stderr.write('x' * 200000)\nsys.stderr.flush()\nsys.exit(3)\n" % sys.executable)
        os.chmod(spam, 0o755)
        helper.start(binary=spam)
        code, status, _ = helper.start_tx()
        self.assertEqual(code, 200)
        status = wait_for(lambda: helper.status()["state"] == "error" and helper.status(), 10)
        self.assertTrue(status)
        self.assertLessEqual(len(status["error"]), 300)
        self.assertTrue(helper.proc.poll() is None)


if __name__ == "__main__":
    unittest.main()
