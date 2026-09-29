#!/usr/bin/env python3
"""
pl0tb0t_probe.py -- pen-tip probing and live pen offsets.

Shared by pl0tb0t_daemon.py (which runs it mid-stream) and pl0tb0t_OS.py
(which emits the directives and owns the settings panel). No Qt, no serial:
everything talks through a `send(line) -> (response_lines, error)` callable
so it can be unit-tested against a fake GRBL.

THE IDEA
--------
Pen offsets used to be BAKED into the G-code by vpype (Z via the layer
contact/lift heights, XY via `translate`). That makes a .gcode file only
correct for the exact pens that were loaded when it was generated.

With "live offsets" on, the G-code is generated NEUTRAL (every layer as if the
zero/reference pen were loaded) and each layer carries a directive right after
its pickup block:

    ;@PL0T {"op":"pen","tool":"Test Pen 2","type":"micron","pred":[0,0.4,11.25]}

and a clear before its drop block:

    ;@PL0T {"op":"clear"}

The daemon turns those into a per-layer offset that it adds to every X/Y/Z
word it streams (absolute-mode, non-G53 lines only). The offset comes from:

  * the probe, if probing is enabled: measured tip position minus the
    reference pen's measured tip position (+ an optional per-pen-type Z trim);
  * otherwise the prediction `pred` -- exactly the numbers that would have been
    baked in (pen-type offsets, V-groove Y, holder trims).

Nothing is written into GRBL's coordinate systems, so an aborted plot can't
leave the machine with a stale offset. Old G-code with no directives streams
exactly as before.

SIGN CONVENTION (all mm, machine axes)
--------------------------------------
correction = where the carriage must be for THIS pen
           - where the carriage is for the REFERENCE pen
to put the tip on the same spot. A longer pen touches the probe with the
carriage higher up, so dz > 0 raises the whole layer -- the same sign as the
existing pen_offsets Z column. XY matches vpype's gcode-space translate.
"""

import json
import math
import re
import time

DIRECTIVE_PREFIX = "@PL0T"
COMMENT_PREFIX = ";@PL0T"

# Defaults for every probe setting. OSConfig stores these as probe_<key>.
PROBE_DEFAULTS = {
    "enabled":     False,   # probe at every pen pickup (needs a reference)
    "x":           0.0,     # taught machine X of the carriage with the ref pen over the stylus
    "y":           0.0,     # taught machine Y  (only used until a reference is measured)
    "travel_z":    -5.0,    # machine Z that clears the stylus with any pen loaded
    "travel_feed": 800,     # mm/min for positioning moves
    "z_search":    30.0,    # Z search distance when there is no reference yet
    "z_clear":     4.0,     # start this far above the predicted contact
    "xy_clear":    4.0,     # start XY probes this far from the stylus centre
    "xy_depth":    1.0,     # drop this far below Z contact before XY probing (≈ ball radius)
    "xy_lift":     2.0,     # hop this far above Z contact to get over the stylus
    "search_step": 0.8,     # grid pitch if the first Z plunge misses the stylus crown
    "search_rings": 2,      # grid half-size (2 -> 5x5 points, ±1.6 mm)
    "retract":     1.0,     # back-off before each slow sample
    "fast_feed":   150,     # first (search) touch, mm/min
    "slow_feed":   30,      # measuring touches, mm/min
    "samples":     2,       # slow touches per surface
    "tol":         0.03,    # max spread between slow touches before it's a failure
    "max_corr_xy": 5.0,     # sanity limit on a measured XY correction
    "max_corr_z":  40.0,    # sanity limit on a measured Z correction
    "on_fail":     "stop",  # "stop" the plot, or "predicted" = warn and use the prediction
    "ref":         None,    # [x, y, z] machine coords measured with the reference pen
    "z_trim":      {},      # {pen_type: mm} added to Z after probing (tip squash etc.)
}


def probe_cfg_from(obj, prefix="probe_"):
    """Collect probe settings from an object/dict with probe_<key> attributes."""
    out = {}
    for k, v in PROBE_DEFAULTS.items():
        name = prefix + k
        if isinstance(obj, dict):
            out[k] = obj.get(name, v)
        else:
            out[k] = getattr(obj, name, v)
    return out


# ── Directives ────────────────────────────────────────────────────────────

def directive_comment(obj: dict) -> str:
    """The G-code comment line the generator writes."""
    return COMMENT_PREFIX + " " + json.dumps(obj, separators=(",", ":"))


def comment_to_directive(raw: str):
    """';@PL0T {...}' -> '@PL0T {...}' (what the daemon receives), else None."""
    s = (raw or "").strip()
    if s.startswith(COMMENT_PREFIX):
        return DIRECTIVE_PREFIX + s[len(COMMENT_PREFIX):]
    return None


def parse_directive(line: str):
    """'@PL0T {...}' -> dict, or None if the line isn't a directive."""
    if not line.startswith(DIRECTIVE_PREFIX):
        return None
    try:
        d = json.loads(line[len(DIRECTIVE_PREFIX):].strip())
        return d if isinstance(d, dict) else {"op": "invalid"}
    except Exception:
        return {"op": "invalid"}


# ── Live offset rewriting ─────────────────────────────────────────────────

_WORD = re.compile(r"([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
_AXIS = re.compile(r"([XYZ])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
# G-codes whose X/Y/Z words are NOT work-coordinate targets.
_NO_OFFSET_G = {53, 10, 28, 30, 92, 38, 43}


class OffsetTransformer:
    """Adds (dx, dy, dz) to X/Y/Z words of absolute, work-coordinate lines.

    Tracks G90/G91 and the last feed so the prober can restore it. Lines with
    G53/G10/G28/G30/G92/G38/G43 are left untouched, as is anything in G91.
    """

    def __init__(self):
        self.off = (0.0, 0.0, 0.0)
        self.absolute = True
        self.last_f = None

    def set(self, dx, dy, dz):
        self.off = (float(dx), float(dy), float(dz))

    def clear(self):
        self.off = (0.0, 0.0, 0.0)

    @property
    def active(self):
        return any(abs(v) > 1e-9 for v in self.off)

    def apply(self, line: str) -> str:
        u = line.strip().upper()
        if not u or u.startswith("$") or u.startswith(DIRECTIVE_PREFIX):
            return line
        words = _WORD.findall(u)
        gcodes = []
        for letter, val in words:
            if letter == "G":
                g = float(val)
                gcodes.append(g)
                if g == 90:
                    self.absolute = True
                elif g == 91:
                    self.absolute = False
            elif letter == "F":
                self.last_f = float(val)
        if not self.active or not self.absolute:
            return line
        if any(int(math.floor(g)) in _NO_OFFSET_G for g in gcodes):
            return line
        dx, dy, dz = self.off
        add = {"X": dx, "Y": dy, "Z": dz}

        def _sub(m):
            return f"{m.group(1)}{float(m.group(2)) + add[m.group(1)]:.4f}"

        return _AXIS.sub(_sub, u)


# ── GRBL helpers ──────────────────────────────────────────────────────────

_PRB = re.compile(r"\[PRB:([-\d.]+),([-\d.]+),([-\d.]+)(?:,[-\d.]+)*:(\d)\]")


def parse_prb(lines):
    """Return ((x, y, z), hit) from a probe response, or (None, False)."""
    for l in lines or []:
        m = _PRB.search(l.strip())
        if m:
            return (float(m.group(1)), float(m.group(2)), float(m.group(3))), m.group(4) == "1"
    return None, False


class ProbeError(Exception):
    pass


class ProbeStopped(ProbeError):
    pass


_AXIS_IDX = {"X": 0, "Y": 1, "Z": 2}


class Prober:
    """Measures the loaded pen's tip on the fixed stylus.

    send(line, timeout) -> (lines, err)   one GRBL line, waits for ok
    log(msg)                              optional progress messages
    stop_evt                              optional threading.Event to abort

    All positioning uses G53 (machine coords); probe moves use G91 G38.3 so
    they're independent of whatever work offset is active. G38.3 doesn't alarm
    on a miss, so a miss becomes a clean ProbeError instead of a locked-up
    controller. (A probe that is ALREADY triggered at the start of a move still
    alarms in GRBL -- that's a wiring/$6 problem and should stop everything.)
    """

    def __init__(self, send, cfg: dict, log=None, stop_evt=None):
        self._send = send
        self.c = dict(PROBE_DEFAULTS)
        self.c.update({k: v for k, v in (cfg or {}).items() if v is not None or k == "ref"})
        self._log = log or (lambda m: None)
        self._stop = stop_evt

    # low level
    def _cmd(self, line, timeout=90.0):
        if self._stop is not None and self._stop.is_set():
            raise ProbeStopped("stopped")
        lines, err = self._send(line, timeout)
        if err:
            raise ProbeError(f"{line} -> {err}")
        return lines

    def _move(self, **axes):
        parts = " ".join(f"{a}{float(v):.4f}" for a, v in axes.items())
        self._cmd("G90")
        self._cmd(f"G53 G1 {parts} F{int(self.c['travel_feed'])}")

    def _probe(self, axis, dist, feed):
        lines = self._cmd(f"G91 G38.3 {axis}{dist:.4f} F{int(feed)}")
        self._cmd("G90")
        pos, hit = parse_prb(lines)
        if pos is None:
            raise ProbeError(f"no [PRB:] report after probing {axis}")
        return pos if hit else None

    def _nudge(self, axis, dist):
        self._cmd(f"G91 G1 {axis}{dist:.4f} F{int(self.c['travel_feed'])}")
        self._cmd("G90")

    def touch(self, axis, direction, search):
        """Fast touch, then `samples` slow touches. Returns the mean contact
        coordinate on `axis` (machine coords) and leaves the stylus released."""
        i = _AXIS_IDX[axis]
        sign = "+" if direction > 0 else "-"
        first = self._probe(axis, direction * search, self.c["fast_feed"])
        if first is None:
            raise ProbeError(f"no contact probing {axis}{sign} within {search:.1f} mm")
        back = float(self.c["retract"])
        vals = []
        for _ in range(max(1, int(self.c["samples"]))):
            self._nudge(axis, -direction * back)
            p = self._probe(axis, direction * (back + 0.5), self.c["slow_feed"])
            if p is None:
                raise ProbeError(f"lost contact on slow {axis}{sign} touch "
                                 f"(something moved -- pen loose in its seat?)")
            vals.append(p[i])
        self._nudge(axis, -direction * back)
        spread = max(vals) - min(vals)
        if spread > float(self.c["tol"]):
            raise ProbeError(f"{axis}{sign} touches disagree by {spread:.3f} mm "
                             f"(tolerance {self.c['tol']})")
        return sum(vals) / len(vals)

    # the routine
    def measure(self, pred=(0.0, 0.0, 0.0)):
        """Probe the loaded pen. `pred` is the predicted correction (used only
        to aim). Returns ((x, y, z), info) in machine coords."""
        c = self.c
        ref = c.get("ref")
        tz = float(c["travel_z"])
        if ref:
            ex = ref[0] + pred[0]
            ey = ref[1] + pred[1]
            ez = ref[2] + pred[2]
        else:
            ex, ey, ez = float(c["x"]), float(c["y"]), None

        self._log(f"probe: aiming at X{ex:.3f} Y{ey:.3f}")
        self._move(Z=tz)
        self._move(X=ex)          # along the lane first...
        self._move(Y=ey)          # ...then over to the stylus

        # 1. rough Z over the expected centre
        if ez is not None:
            zs = min(tz, ez + float(c["z_clear"]))
            search = max(1.0, zs - (ez - float(c["z_clear"])))
        else:
            zs, search = tz, float(c["z_search"])
        # The stylus crown is small (2 mm ball stock), so if the prediction is
        # off by more than ~1 mm the first plunge can slide past it. Walk a
        # small grid, nearest points first, before giving up.
        step = float(c["search_step"])
        rings = max(0, int(c["search_rings"]))
        grid = sorted(((i * step, j * step) for i in range(-rings, rings + 1)
                       for j in range(-rings, rings + 1)),
                      key=lambda p: (math.hypot(*p), p))
        z0 = None
        for k, (ox, oy) in enumerate(grid):
            if k:
                self._log(f"probe: missed the crown, trying {ox:+.1f},{oy:+.1f}")
                self._move(Z=tz)
                self._move(X=ex + ox, Y=ey + oy)
            self._move(Z=zs)
            try:
                z0 = self.touch("Z", -1, search)
            except ProbeStopped:
                raise
            except ProbeError as e:
                if "no contact" not in str(e):
                    raise
                continue
            ex, ey = ex + ox, ey + oy
            break
        if z0 is None:
            self._move(Z=tz)
            raise ProbeError(f"no contact probing Z- within {search:.1f} mm over a "
                             f"{2 * rings + 1}x{2 * rings + 1} grid -- is a pen loaded? "
                             f"is the reference / probe XY right?")
        self._log(f"probe: rough Z {z0:.3f}")

        # 2. X then Y: touch both sides below the crown, centre = midpoint
        hi = z0 + float(c["xy_lift"])
        lo = z0 - float(c["xy_depth"])
        cl = float(c["xy_clear"])
        cx, cy = ex, ey
        widths = {}
        for axis in ("X", "Y"):
            ctr = cx if axis == "X" else cy
            hits = []
            for d in (+1, -1):
                self._move(Z=hi)
                if axis == "X":
                    self._move(X=ctr - d * cl, Y=cy)
                else:
                    self._move(X=cx, Y=ctr - d * cl)
                self._move(Z=lo)
                hits.append(self.touch(axis, d, 2 * cl))
            width = hits[1] - hits[0]
            if width <= 0.2 or width >= 2 * cl:
                raise ProbeError(f"{axis} contact width {width:.3f} mm is implausible "
                                 f"(missed the stylus? check xy_clear / xy_depth)")
            widths[axis] = width
            mid = (hits[0] + hits[1]) / 2.0
            if axis == "X":
                cx = mid
            else:
                cy = mid
            self._log(f"probe: {axis} centre {mid:.3f} (width {width:.3f})")

        # 3. final Z, now centred on the crown
        self._move(Z=hi)
        self._move(X=cx, Y=cy)
        zt = self.touch("Z", -1, float(c["xy_lift"]) + 1.0)
        self._move(Z=tz)
        self._log(f"probe: Z {zt:.3f}")
        return (cx, cy, zt), {"z_rough": z0, "width_x": widths["X"], "width_y": widths["Y"]}

    def go_back(self, start):
        """Return to where the stream left the carriage: up, lane, column, down."""
        if not start:
            return
        sx, sy, sz = start
        self._move(Z=max(float(self.c["travel_z"]), sz))
        self._move(Y=sy)
        self._move(X=sx)
        self._move(Z=sz)


def correction_from(measured, cfg: dict, pen_type: str = ""):
    """measured - reference (+ per-type Z trim), with sanity limits."""
    c = dict(PROBE_DEFAULTS)
    c.update(cfg or {})
    ref = c.get("ref")
    if not ref:
        raise ProbeError("no probe reference set -- probe the reference pen first")
    trim = 0.0
    try:
        trim = float((c.get("z_trim") or {}).get(pen_type, 0.0) or 0.0)
    except (TypeError, ValueError):
        trim = 0.0
    dx = measured[0] - ref[0]
    dy = measured[1] - ref[1]
    dz = measured[2] - ref[2] + trim
    if abs(dx) > c["max_corr_xy"] or abs(dy) > c["max_corr_xy"]:
        raise ProbeError(f"XY correction ({dx:+.3f}, {dy:+.3f}) exceeds "
                         f"{c['max_corr_xy']} mm -- wrong pen or stylus moved?")
    if abs(dz) > c["max_corr_z"]:
        raise ProbeError(f"Z correction {dz:+.3f} exceeds {c['max_corr_z']} mm")
    return (dx, dy, dz)
