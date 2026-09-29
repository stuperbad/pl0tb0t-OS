#!/usr/bin/env python3
"""Offline tests for pl0tb0t_probe.py against a fake GRBL + stylus.

    python3 tests/test_probe.py

The fake machine models an upturned touch-probe stylus (ball of radius RB on
a thin stem) and a pen tip as a short cylinder of radius RT whose lowest point
is `tip` below/beside the carriage reference. It understands exactly the
G-code the prober emits: G90/G91, G53 G1 moves, G91 G1 nudges and G91 G38.3.
"""
import math, os, sys, re, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pl0tb0t_probe as P

from fake_grbl import FakeGrbl, RB, RT  # noqa: E402


def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        global FAILED
        FAILED = True


FAILED = False
BALL = (-300.0, -560.0, -75.0)
CFG = dict(P.PROBE_DEFAULTS, x=-300.0 - 0.0, y=-560.0, travel_z=-5.0)


def measure(tip, pred=(0, 0, 0), cfg=None, noise=0.0):
    g = FakeGrbl(BALL, tip, noise=noise)
    pr = P.Prober(g.send, cfg or CFG)
    start = tuple(g.pos)
    m, info = pr.measure(pred)
    pr.go_back(start)
    return m, info, g, start


# 1. reference pen: tip straight below the carriage, 55 mm down
ref_tip = (0.0, 0.0, -55.0)
m_ref, info, g, start = measure(ref_tip)
exp = (BALL[0] - ref_tip[0], BALL[1] - ref_tip[1], BALL[2] - ref_tip[2])
ok(all(abs(m_ref[i] - exp[i]) < 0.01 for i in range(3)), f"reference measured {tuple(round(v,3) for v in m_ref)} ~ {exp}")
ok(all(abs(g.pos[i] - start[i]) < 1e-6 for i in range(3)), "carriage returned to where the stream left it")

cfg = dict(CFG, ref=list(m_ref))

# 2. a longer pen that leans: tip 11.25 lower, +0.4 in X, -0.7 in Y
tip2 = (0.4, -0.7, -66.25)
m2, _, _, _ = measure(tip2, pred=(0, 0, 11.0), cfg=cfg)
corr = P.correction_from(m2, cfg)
ok(abs(corr[0] - (-0.4)) < 0.01 and abs(corr[1] - 0.7) < 0.01 and abs(corr[2] - 11.25) < 0.01,
   f"long leaning pen correction {tuple(round(v,3) for v in corr)} ~ (-0.4, +0.7, +11.25)")
# a pen whose tip sits +0.4 X must be DRAWN with the carriage 0.4 further -X:
# carriage at P+corr puts the tip at P+corr+tipoff = P + ref tipoff. check:
ok(abs((corr[0] + tip2[0]) - ref_tip[0]) < 0.01, "sign: carriage+correction puts the tip where the reference tip would be")

# 3. aiming off by 1.5 mm (bad prediction) still finds the centre
m3, _, _, _ = measure(tip2, pred=(1.2, -0.8, 8.0), cfg=cfg)
ok(math.dist(m3, m2) < 0.02, "bad aim (~2 mm off the crown, 3 mm Z) still finds it via the grid")

# 4. noise within tolerance passes, beyond tolerance fails
random.seed(1)
try:
    measure(tip2, pred=(0, 0, 11.0), cfg=cfg, noise=0.005)
    ok(True, "5 µm noise passes")
except P.ProbeError as e:
    ok(False, f"5 µm noise passes ({e})")
try:
    measure(tip2, pred=(0, 0, 11.0), cfg=dict(cfg, tol=0.001), noise=0.02)
    ok(False, "20 µm noise vs 1 µm tolerance fails")
except P.ProbeError:
    ok(True, "20 µm noise vs 1 µm tolerance fails")

# 5. no pen / missing stylus -> clean error, not a hang
try:
    measure((0, 0, -20.0), cfg=cfg)
    ok(False, "short pen out of Z search range raises")
except P.ProbeError as e:
    ok("no contact" in str(e), f"short pen out of Z search range raises: {e}")

# 6. sanity limit
try:
    P.correction_from((m_ref[0] + 9, m_ref[1], m_ref[2]), cfg)
    ok(False, "9 mm XY correction rejected")
except P.ProbeError:
    ok(True, "9 mm XY correction rejected")

# 7. per-type Z trim
c7 = P.correction_from(m2, dict(cfg, z_trim={"micron": -0.3}), "micron")
ok(abs(c7[2] - (corr[2] - 0.3)) < 1e-9, "per-pen-type Z trim applied")

# 8. offset transformer
t = P.OffsetTransformer()
t.set(0.5, -0.25, 2.0)
cases = [
    ("G0 X10 Y20", "G0 X10.5000 Y19.7500"),
    ("G0 Z3.500", "G0 Z5.5000"),
    ("G1 X1.0000 Y2.0000 F3000", "G1 X1.5000 Y1.7500 F3000"),
    ("G53 G1 Z-5.000 F800", "G53 G1 Z-5.000 F800"),
    ("G10 L20 P1 X0", "G10 L20 P1 X0"),
    ("M2", "M2"),
    ("$H", "$H"),
]
for src, want in cases:
    got = t.apply(src)
    ok(got == want, f"offset {src!r} -> {got!r}")
t.apply("G91")
ok(t.apply("G1 X1") == "G1 X1", "G91 lines untouched")
t.apply("G90")
t.clear()
ok(t.apply("G0 X10") == "G0 X10", "cleared offset leaves lines alone")
ok(t.last_f == 800.0, "last modal feed tracked (any F word, G53 included)")

# 9. directives round-trip
c = P.directive_comment({"op": "pen", "tool": "Test Pen 2", "type": "micron", "pred": [0, 0.4, 11.25]})
d = P.comment_to_directive(c)
ok(d.startswith("@PL0T") and P.parse_directive(d)["tool"] == "Test Pen 2", "directive round-trip")
ok(P.comment_to_directive("; === PICK UP: x ===") is None, "ordinary comments are not directives")

print("\nALL PASS" if not FAILED else "\nSOME FAILED")
sys.exit(1 if FAILED else 0)
