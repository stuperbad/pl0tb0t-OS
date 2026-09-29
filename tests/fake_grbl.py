"""Fake GRBL with an upturned stylus and a pen tip, for offline probe tests."""
import math, re, random

RB = 1.0      # stylus ball radius
RT = 0.6      # pen tip radius at the contact height


class FakeGrbl:
    def __init__(self, ball, tip, start=(-120.0, -540.0, -5.0), noise=0.0):
        self.ball = ball            # (x, y, z_top) of stylus crown, machine coords
        self.tip = tip              # tip offset from carriage (dx, dy, dz), dz < 0 = below
        self.pos = list(start)
        self.absolute = True
        self.noise = noise
        self.log = []

    def _tip(self, p):
        return (p[0] + self.tip[0], p[1] + self.tip[1], p[2] + self.tip[2])

    def _contact(self, p):
        tx, ty, tz = self._tip(p)
        bx, by, bz = self.ball
        r = math.hypot(tx - bx, ty - by)
        # Z: tip point lands on the crown (flat-ish top within RB)
        if r <= RB and tz <= bz:
            return True
        # side: tip cylinder hits ball equator region when below the crown
        if tz < bz and r <= RB + RT and tz > bz - 2 * RB:
            return True
        return False

    def send(self, line, timeout=30):
        self.log.append(line)
        u = line.upper()
        words = dict((a, float(v)) for a, v in re.findall(r"([A-Z])([-+]?[\d.]+)", u))
        g = [float(v) for v in re.findall(r"G([\d.]+)", u)]
        if 90 in g and len(g) == 1 and not any(k in words for k in "XYZ"):
            self.absolute = True
            return ["ok"], None
        if 91 in g and len(g) == 1:
            self.absolute = False
        if 91 in g:
            self.absolute = False
        target = list(self.pos)
        for i, a in enumerate("XYZ"):
            if a in words:
                target[i] = (self.pos[i] + words[a]) if not self.absolute else words[a]
        if 53 in g:
            if not self.absolute:
                return [], "error:G53 in G91"
            if self._contact(target) and self._contact(self.pos) is False:
                pass  # positioning through the stylus would be a crash; check below
            # crash check: sample the path
            if self._path_hits(self.pos, target):
                return [], f"CRASH moving {self.pos} -> {target}"
            self.pos = target
            return ["ok"], None
        if 38.3 in g:
            if self._contact(self.pos):
                return [], "ALARM:4"
            hit = self._first_contact(self.pos, target)
            if hit is None:
                self.pos = target
                return [f"[PRB:{target[0]:.3f},{target[1]:.3f},{target[2]:.3f}:0]", "ok"], None
            n = [c + random.uniform(-self.noise, self.noise) for c in hit]
            self.pos = hit
            return [f"[PRB:{n[0]:.3f},{n[1]:.3f},{n[2]:.3f}:1]", "ok"], None
        if 1 in g and not self.absolute:
            if self._path_hits(self.pos, target, allow_start=True):
                return [], f"CRASH nudging {self.pos} -> {target}"
            self.pos = target
            return ["ok"], None
        return ["ok"], None

    def _first_contact(self, a, b, step=0.0005):
        d = math.dist(a, b)
        n = max(1, int(d / step))
        for k in range(1, n + 1):
            p = [a[i] + (b[i] - a[i]) * k / n for i in range(3)]
            if self._contact(p):
                return p
        return None

    def _path_hits(self, a, b, allow_start=False):
        d = math.dist(a, b)
        n = max(1, int(d / 0.01))
        for k in range(1, n + 1):
            p = [a[i] + (b[i] - a[i]) * k / n for i in range(3)]
            if self._contact(p):
                return True
        return False


