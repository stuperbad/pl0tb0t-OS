#!/usr/bin/env python3
"""End-to-end: real pl0tb0t_daemon.py <-> fake GRBL on a pty.

    python3 tests/test_daemon_live.py

Starts the daemon on a spare port, connects it to a pseudo-terminal where a
fake GRBL (with a stylus and a pen tip) answers, streams a two-layer file
with ;@PL0T directives the way the OS runner writes it, and checks:
  * layer 1 (reference pen): probe runs, offset ~0, lines unchanged
  * layer 2 (long leaning pen): probe runs, drawing lines shifted by the
    measured correction, G53 tool-change lines untouched
  * with probing off, the predicted offsets are applied instead
  * a legacy file (no directives) streams byte-for-byte as before
"""
import json, math, os, pty, re, socket, subprocess, sys, threading, time, tempfile, tty

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
import pl0tb0t_probe as P
from fake_grbl import FakeGrbl  # noqa: E402

BALL = (-300.0, -560.0, -75.0)


class PtyGrbl(FakeGrbl):
    """FakeGrbl + plain absolute moves + a serial front end."""

    def __init__(self, fd, tip):
        super().__init__(BALL, tip)
        self.fd = fd
        self.received = []
        self.tip_now = tip

    def send(self, line, timeout=30):
        u = line.upper().strip()
        g = [float(v) for v in re.findall(r"G([\d.]+)", u)]
        if u.startswith("F") or u.startswith("G4") or u == "M2" or u.startswith("G21"):
            return ["ok"], None
        if 53 not in g and 38.3 not in g and any(a in u for a in "XYZ") and self.absolute and not (91 in g):
            words = dict((a, float(v)) for a, v in re.findall(r"([XYZ])([-+]?[\d.]+)", u))
            for i, a in enumerate("XYZ"):
                if a in words:
                    self.pos[i] = words[a]
            return ["ok"], None
        return super().send(line, timeout)

    def loop(self):
        buf = b""
        while True:
            try:
                data = os.read(self.fd, 1024)
            except OSError:
                return
            for ch in data:
                if ch == ord("?"):
                    pn = "|Pn:P" if self._contact(self.pos) else ""
                    st = f"<Idle|MPos:{self.pos[0]:.3f},{self.pos[1]:.3f},{self.pos[2]:.3f}|FS:0,0{pn}>\r\n"
                    os.write(self.fd, st.encode())
                    continue
                if ch in (ord("!"), ord("~"), 0x18):
                    continue
                buf += bytes([ch])
                while b"\n" in buf:
                    raw, buf = buf.split(b"\n", 1)
                    line = raw.decode().strip()
                    if not line:
                        continue
                    self.received.append(line)
                    lines, err = self.send(line)
                    out = [l for l in lines if l != "ok"]
                    for l in out:
                        os.write(self.fd, (l + "\r\n").encode())
                    os.write(self.fd, ((err if err else "ok") + "\r\n").encode())


def client(port):
    s = socket.create_connection(("127.0.0.1", port))
    f = s.makefile("rwb")
    events = []
    resp = []
    lock = threading.Condition()

    def reader():
        for raw in f:
            d = json.loads(raw)
            with lock:
                (events if "event" in d else resp).append(d)
                lock.notify_all()
    threading.Thread(target=reader, daemon=True).start()
    # the daemon greets every client with a status dict -- swallow it
    t0 = time.time()
    with lock:
        while not resp and time.time() - t0 < 5:
            lock.wait(0.1)
        resp.clear()

    def cmd(obj, timeout=10):
        with lock:
            n = len(resp)
        f.write((json.dumps(obj) + "\n").encode()); f.flush()
        t = time.time() + timeout
        with lock:
            while len(resp) <= n and time.time() < t:
                lock.wait(0.1)
            return resp[n] if len(resp) > n else {"ok": False, "error": "timeout"}

    def wait_event(pred, timeout=300):
        t = time.time() + timeout
        seen = 0
        while time.time() < t:
            with lock:
                for e in events[seen:]:
                    if pred(e):
                        return e
                seen = len(events)
                lock.wait(0.2)
        return None
    return cmd, wait_event, events


def run_daemon(port):
    env = dict(os.environ)
    code = ("import sys; sys.path.insert(0, %r); import pl0tb0t_daemon as d; d.DAEMON_PORT=%d; "
            "d.POLL_INTERVAL=0.2; x=d.GrblDaemon(); x.run()" % (ROOT, port))
    p = subprocess.Popen([sys.executable, "-c", code], cwd=tempfile.mkdtemp(),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port)).close()
            return p
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("daemon didn't start")


def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        global FAILED
        FAILED = True


FAILED = False

LAYER = ["G0 Z3.5000", "G0 X10.0000 Y20.0000", "G0 Z0.0000",
         "G1 X30.0000 Y20.0000 F3000", "G1 X30.0000 Y40.0000 F3000", "G0 Z3.5000"]


def plot_file(path, pens, live=True):
    out = ["G21 G90", "G53 G0 Z-5.000", "G1 F3000"]
    for name, pred in pens:
        out += ["G53 G1 Z-5.000 F800", "G53 G1 Y-540.000 F800", "G53 G1 X-200.000 F800",
                "G53 G1 Z-43.000 F800", "G53 G1 Y-582.000 F450", "G53 G1 Z-5.000 F800",
                "G53 G1 Y-540.000 F800"]
        if live:
            out.append(P.comment_to_directive(P.directive_comment(
                {"op": "pen", "tool": name, "type": "t", "pred": pred})))
        out += ["G0 X10.0000", "G0 Y20.0000"] + LAYER
        if live:
            out.append(P.comment_to_directive(P.directive_comment({"op": "clear"})))
        out += ["G53 G1 Z-5.000 F800", "G53 G1 Y-540.000 F800", "G53 G1 X-200.000 F800"]
    out += ["M2"]
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")
    return out


def session(tip_seq, probe_cfg, pens, live=True, port=5102):
    """One daemon + fake grbl; tip_seq[i] = pen tip while layer i runs."""
    master, slave = pty.openpty()
    tty.setraw(slave)
    fake = PtyGrbl(master, tip_seq[0])
    threading.Thread(target=fake.loop, daemon=True).start()
    d = run_daemon(port)
    try:
        cmd, wait_event, events = client(port)
        r = cmd({"cmd": "connect", "port": os.ttyname(slave), "baud": 115200}, timeout=15)
        assert r.get("ok"), r
        path = tempfile.mktemp(suffix=".gcode")
        plot_file(path, pens, live)
        # swap the "pen" in the carriage at every pickup (the Y-582 dock move)
        def swapper():
            k = 0
            seen = 0
            while k < len(tip_seq):
                rec = fake.received[seen:]
                seen += len(rec)
                for l in rec:
                    if l.startswith("G53 G1 Y-582"):
                        fake.tip = tip_seq[k]
                        k += 1
                time.sleep(0.01)
        threading.Thread(target=swapper, daemon=True).start()
        r = cmd({"cmd": "stream", "path": path, "probe": probe_cfg})
        assert r.get("ok"), r
        done = wait_event(lambda e: e.get("event") in ("gcode_done",), timeout=900)
        errs = [e for e in events if e.get("event") == "gcode_error"]
        return fake, events, errs, r
    finally:
        d.terminate()
        d.wait()
        os.close(master)


REF_TIP = (0.0, 0.0, -55.0)
LONG_TIP = (0.4, -0.7, -66.25)
base = dict(P.PROBE_DEFAULTS, x=-300.0, y=-560.0, travel_z=-5.0)

# 0. measure reference via the manual command
master, slave = pty.openpty(); tty.setraw(slave)
fake = PtyGrbl(master, REF_TIP)
threading.Thread(target=fake.loop, daemon=True).start()
d = run_daemon(5101)
cmd, wait_event, events = client(5101)
assert cmd({"cmd": "connect", "port": os.ttyname(slave)}, timeout=15).get("ok")
r = cmd({"cmd": "probe", "cfg": base, "tag": {"set_ref": True}})
ok(r.get("ok") and r.get("started"), f"manual probe starts async: {r}")
e = wait_event(lambda e: e.get("event") == "probe" and e.get("kind") == "manual", timeout=600)
ok(e and e.get("ok"), f"manual reference probe result: {e and (e.get('measured'), e.get('error'))}")
ok(e and e.get("tag", {}).get("set_ref") is True, "tag echoed back")
ref = e["measured"]
d.terminate(); d.wait(); os.close(master)

cfg = dict(base, enabled=True, ref=ref)

# 1. probed two-layer plot
fake, events, errs, _ = session([REF_TIP, LONG_TIP], cfg,
                                [("Ref Pen", [0, 0, 0]), ("Long Pen", [0, 0, 11.0])], port=5103)
ok(not errs, f"probed stream finished without error {errs[:1]}")
offs = [e for e in events if e.get("event") == "probe" and e.get("kind") == "offset"]
ok(len(offs) == 2 and offs[0]["source"] == "probed", f"two probed offsets: {[(o['tool'], [round(v,3) for v in o['offset']]) for o in offs]}")
if len(offs) == 2:
    o2 = offs[1]["offset"]
    ok(abs(o2[0] + 0.4) < 0.02 and abs(o2[1] - 0.7) < 0.02 and abs(o2[2] - 11.25) < 0.02,
       "layer 2 correction ≈ (-0.4, +0.7, +11.25)")
    rec = fake.received
    # the drawing moves after the 2nd pen directive
    g1 = [l for l in rec if l.startswith("G1 X")]
    ok(g1[0] == "G1 X30.0000 Y20.0000 F3000", f"layer 1 drawing unshifted: {g1[0]}")
    _m = re.match(r"G1 X([-\d.]+) Y([-\d.]+)", g1[2])
    ok(_m and abs(float(_m.group(1)) - 29.6) < 0.01 and abs(float(_m.group(2)) - 20.7) < 0.01,
       f"layer 2 drawing shifted: {g1[2]}")
    z = [l for l in rec if l.startswith("G0 Z")]
    ok("G0 Z11.2" in z[-1] or "G0 Z14.7" in z[-1], f"layer 2 Z shifted: {z[-1]}")
    ok(all(not l.startswith("@") for l in rec), "directives never reach GRBL")
    g53 = [l for l in rec if l.startswith("G53 G1 Y-582")]
    ok(g53 == ["G53 G1 Y-582.000 F450"] * 2, "tool-change G53 lines untouched")

# 2. probing off -> predicted offsets
fake, events, errs, _ = session([REF_TIP, LONG_TIP], dict(cfg, enabled=False),
                                [("Ref Pen", [0, 0, 0]), ("Long Pen", [0.1, 0.2, 11.0])], port=5104)
offs = [e for e in events if e.get("event") == "probe" and e.get("kind") == "offset"]
ok(not errs and [o["source"] for o in offs] == ["predicted"] * 2, "probe off -> predicted offsets")
ok(any(l == "G1 X30.1000 Y20.2000 F3000" for l in fake.received), "predicted shift applied")
ok(not any("G38" in l for l in fake.received), "no probing when disabled")

# 3. legacy file: identical stream
fake, events, errs, r = session([REF_TIP, REF_TIP], cfg, [("A", [0, 0, 0]), ("B", [0, 0, 0])],
                                live=False, port=5105)
want = [l for l in plot_file(tempfile.mktemp(), [("A", [0, 0, 0]), ("B", [0, 0, 0])], live=False)]
ok(not errs and fake.received[-len(want):] == want, "legacy file streams unchanged")
ok(r.get("total") == len(want), f"progress total unchanged ({r.get('total')} == {len(want)})")

# 4. probe failure stops the plot (no pen in carriage = tip far above stylus)
fake, events, errs, _ = session([REF_TIP, (0, 0, -20.0)], cfg,
                                [("Ref Pen", [0, 0, 0]), ("Missing", [0, 0, 0])], port=5106)
ok(errs and "probe failed for Missing" in errs[0].get("message", ""), f"failed probe stops the stream: {errs[:1]}")
ok(not any(l.startswith("G1 X") for l in fake.received[-20:]), "nothing drawn after the failure")

print("\nALL PASS" if not FAILED else "\nSOME FAILED")
sys.exit(1 if FAILED else 0)
