import sys, math, cadquery as cq
from collections import defaultdict
from OCP.BRepAdaptor import BRepAdaptor_Surface
import fit as F

def holes(s, name):
    rows = defaultdict(list)
    for f in s.Faces():
        if f.geomType() != "CYLINDER":
            continue
        sf = BRepAdaptor_Surface(f.wrapped); c = sf.Cylinder()
        r = c.Radius(); a = c.Axis().Direction(); o = c.Axis().Location()
        d = (a.X(), a.Y(), a.Z())
        ax = max(range(3), key=lambda i: abs(d[i])); name_ax = "XYZ"[ax]
        # point on the face + outward normal
        bb = f.BoundingBox(); ctr = f.Center()
        try:
            n = f.normalAt(ctr)
        except Exception:
            continue
        p = ctr + n * 0.05
        # distance of p from the axis
        v = p - cq.Vector(o.X(), o.Y(), o.Z()); dot = v.dot(cq.Vector(*d)); perp = (v - cq.Vector(*d) * dot).Length
        is_hole = perp < r
        perp_pos = tuple(round(x, 1) for x in (o.X(), o.Y(), o.Z()))
        # position in the two perpendicular coordinates
        pos = [round(v_, 1) for i, v_ in enumerate((o.X(), o.Y(), o.Z())) if i != ax]
        lo = [bb.xmin, bb.ymin, bb.zmin][ax]; hi = [bb.xmax, bb.ymax, bb.zmax][ax]
        rows[(name_ax, round(r, 2), tuple(pos), "hole" if is_hole else "boss")].append((round(lo, 1), round(hi, 1)))
    print("==", name)
    for k in sorted(rows, key=lambda k: (k[0], k[1], k[2])):
        if k[1] < 0.9: continue
        spans = rows[k]; lo = min(a for a, b in spans); hi = max(b for a, b in spans)
        print("  axis %s  R=%.2f  at %s  %s  span %.1f..%.1f (%d face(s))" % (k[0], k[1], k[2], k[3], lo, hi, len(spans)))

s = F.load()
holes(s[0], "holder s0")
holes(s[2], "carriage s2")
