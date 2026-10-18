"""Pickup-motion clearance sweep for rev 3b.

Pickup (as modelled): the carriage is lowered so the ledge top sits Z_CLR below the pin tips, slides in along +Y to its target
(with a sideways/Y error), then rises in Z until the ledge meets the overhang.  The holder, pins, pen insert and pen base stay put.
For every error case (dx, dy) we step along the path and report the first overlap between the moving carriage and each static part.
Pins are ignored while the ledge is below their tips (the funnels handle the pin/ledge contact, checked separately)."""
import itertools, sys
import cadquery as cq
import fit as F

V = cq.Vector
Z_CLR = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
ERRS = (-2.0, 0.0, 2.0)

s = F.load()
cn, hn = F.carriage_new(s[2]), F.holder_new(s[0])
statics = {"holder": hn, "pen insert (s3)": s[3], "pen base (s1)": s[1]}
pin_tip_z = F.PIN_TIP_Z
cz_app = (pin_tip_z - Z_CLR) - F.SEAT_Z          # carriage Z offset so the ledge top is Z_CLR under the pin tips (negative)


def moved(dx, dy, dz):
    return cn.moved(cq.Location(V(dx, dy, dz)))


def hit(m):
    out = []
    for name, st in statics.items():
        try:
            v = m.intersect(st).Volume()
        except Exception:
            v = 0.0
        if v > 0.05:
            out.append((name, round(v, 1)))
    return out


print("ledge top sits %.1f mm below the pin tips while sliding in (carriage dz = %.1f)" % (Z_CLR, cz_app))
bad_cases = {}
for dx, dy in itertools.product(ERRS, ERRS):
    first = None
    # Y approach at low Z
    for y in [-30 + 2 * i for i in range(0, 16)] + [dy]:
        if y > dy + 1e-9:
            continue
        h = hit(moved(dx, y, cz_app))
        if h:
            first = ("slide-in at y=%.1f" % y, h); break
    if first is None:
        # rise with the error still present (pins excluded)
        for k in range(0, 7):
            z = cz_app + (0 - cz_app) * k / 6
            h = hit(moved(dx, dy, z))
            if h:
                first = ("rise at dz=%.1f" % z, h); break
    print("error dx=%+.0f dy=%+.0f : %s" % (dx, dy, "clear" if first is None else "COLLIDES %s %s" % first))
