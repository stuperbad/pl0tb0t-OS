"""Bushing-pin coupler fitted to the user's existing carriage + pen holder (Onshape STEP export).

What the STEP is (solids, as exported):  s2 = carriage (rides on 8 mm rods at X +/-22 with 15 mm bearings),
s0 = hex pen holder, s3 = cup under it, s1 = dock/base, s4 = a small cylinder.  Today s0 mates to the carriage face at
Y = -10 with horizontal pegs.  Here that is replaced:

  * the carriage's lower stem (X +/-15, Y -28..-10, Z 0..20 -- it only carried the old pegs) is rebuilt solid and gets
    the vertical pin holes + one magnet pocket in its underside (seat plane Z = 0)
  * the pen holder (and cup, dock ghost) move DOWN 30 mm so the holder's top is at the seat plane, and a new tab under
    the carriage stem (Y -28..-10) is fused to the holder's rear face: 2 x 2 stacked bushings, funnels, one magnet.

Everything is in the STEP's own frame.  Run:  python fit.py
"""
import math, os
import cadquery as cq

V = cq.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = r"C:\Users\evanf\Downloads\Pen Holder assembly.step"

# ------------------------------------------------------------------ parameters
CY = -19.0                          # coupler centre Y (middle of the 18 mm deep stem)
STEM_X, STEM_Y0, STEM_Y1 = 15.0, -28.0, -10.0
STEM_TOP = 20.0                     # stem is rebuilt up to the carriage's wide section
DROP = 30.0                         # pen holder / cup / dock move down by this
PIN_SP = 16.0                       # stem is 30 wide: mouth R4.5 at +/-8 leaves 2.5 mm side walls
PINS_X = (-PIN_SP / 2, PIN_SP / 2)
PIN_D, PIN_L, PIN_EMBED, TIP_CH = 3.0, 20.0, 6.5, 0.5
PIN_P = PIN_L - PIN_EMBED
PIN_HOLE_D = 3.05
BUSH_ID, BUSH_OD, BUSH_L, BUSH_N = 3.0, 5.0, 5.0, 2
BUSH_POCKET_D = BUSH_OD + 0.1
BUSH_STACK = BUSH_L * BUSH_N
FUN_R_MOUTH, FUN_R_BOT = 4.5, 2.0
FUN_DEPTH = FUN_R_MOUTH - FUN_R_BOT
RELIEF_D, RELIEF_L, FLOOR = 3.4, 1.5, 1.2
T_T = FUN_DEPTH + BUSH_STACK + RELIEF_L + FLOOR
MAG_D, MAG_L, MAG_CL, SKIN = 6.0, 6.0, 0.2, 1.0
UP, DOWN = (0, 0, 1), (0, 0, -1)


def cyl(r, h, pos, d):
    return cq.Solid.makeCylinder(r, h, V(*pos), V(*d))


def cone(r1, r2, h, pos, d):
    return cq.Solid.makeCone(r1, r2, h, V(*pos), V(*d))


def vol(a, b):
    try:
        return a.intersect(b).Volume()
    except Exception:
        return 0.0


def load():
    return cq.importers.importStep(STEP).solids().vals()


def shifted(s, dz):
    return s.moved(cq.Location(V(0, 0, dz)))


# ------------------------------------------------------------------ carriage
def carriage_new(s2):
    top = s2.cut(cq.Solid.makeBox(120, 120, 40, V(-60, -80, -20)))        # keep everything at Z >= 20
    stem = (cq.Workplane("XY").box(2 * STEM_X, STEM_Y1 - STEM_Y0, STEM_TOP + 0.4, centered=False)
            .translate((-STEM_X, STEM_Y0, 0)))
    stem = stem.edges("|Z and <Y").fillet(3.0).faces("<Z").edges().chamfer(1.0).val()
    body = top.fuse(stem).clean()
    for x in PINS_X:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (x, CY, PIN_EMBED), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, SKIN), UP))
    return body


# ------------------------------------------------------------------ tool
def tool_new(s0_moved):
    tab = (cq.Workplane("XY").box(2 * STEM_X, STEM_Y1 - STEM_Y0, T_T, centered=False).translate((-STEM_X, STEM_Y0, -T_T)))
    tab = tab.edges("|Z and <Y").fillet(3.0).faces("<Z").edges("not >Y").fillet(1.5).faces(">Z").edges("not >Y").chamfer(1.0).val()
    body = s0_moved.fuse(tab).clean()
    for x in PINS_X:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (x, CY, 0.2), DOWN))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, CY, -FUN_DEPTH), DOWN))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (x, CY, -FUN_DEPTH - BUSH_STACK), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, -SKIN), DOWN))
    return body


def pin(x, dx=0.0, dy=0.0, dz=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_CH, (x + dx, CY + dy, PIN_EMBED + dz), DOWN)
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_CH, TIP_CH, (x + dx, CY + dy, -(PIN_P - TIP_CH) + dz), DOWN)
    return p.fuse(t)


def pins():
    return [pin(x) for x in PINS_X]


def bushings():
    out = []
    for x in PINS_X:
        for k in range(BUSH_N):
            z = -FUN_DEPTH - k * BUSH_L
            out.append(cyl(BUSH_OD / 2, BUSH_L, (x, CY, z), DOWN).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (x, CY, z + 0.1), DOWN)))
    return out


def magnet_carriage():
    return cyl(MAG_D / 2, MAG_L, (0, CY, SKIN), UP)


def magnet_tool():
    return cyl(MAG_D / 2, MAG_L, (0, CY, -SKIN), DOWN)


def self_check(s, cn, tn, cup, dock):
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("SEATED:")
    chk("pins only inside the bushings (clear of tool)", all(vol(p, tn) < 1e-3 for p in pins()))
    chk("pins sit in the carriage holes", all(vol(p, cn) < 1e-3 for p in pins()))
    chk("bushings clear the printed pockets", all(vol(b, tn) < 1e-3 for b in bushings()))
    chk("magnets clear their cavities", vol(magnet_carriage(), cn) < 1e-3 and vol(magnet_tool(), tn) < 1e-3)
    chk("new carriage and new tool do not overlap", vol(cn, tn) < 1e-3, "(%.3f)" % vol(cn, tn))
    chk("pin tip stays in the relief", FUN_DEPTH + BUSH_STACK < PIN_P < FUN_DEPTH + BUSH_STACK + RELIEF_L - 0.2)
    print("FUNNEL CAPTURE (tip 0.2 mm inside the face):")
    for e in (2.0, 2.5):
        worst = 0.0
        for a in range(0, 360, 45):
            dx, dy = e * math.cos(math.radians(a)), e * math.sin(math.radians(a))
            worst = max(worst, max(vol(pin(x, dx, dy, dz=PIN_P - 0.2), tn) for x in PINS_X))
        chk("%.1f mm error enters freely" % e, worst < 1e-3, "(%.4f)" % worst)
    print("CLEARANCE TO OTHER PARTS (seated; overlap volume mm3, want 0):")
    print("  new tool vs cup/dock (moved with it)      : cup %.2f  dock %.2f" % (vol(tn, cup), vol(tn, dock)))
    print("  new carriage vs dock                      : %.2f" % vol(cn, dock))
    print("  new carriage vs cup                       : %.2f" % vol(cn, cup))
    mag_c = cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, -SKIN), DOWN)
    funs = [cone(FUN_R_MOUTH, FUN_R_BOT, FUN_DEPTH, (x, CY, 0), DOWN) for x in PINS_X]
    print("WALLS (mm): magnet cavity-funnel %.2f | funnel mouth to stem side %.2f | to front/back %.2f | floor %.2f"
          % (min(mag_c.distance(f) for f in funs), STEM_X - PIN_SP / 2 - FUN_R_MOUTH, 9 - FUN_R_MOUTH, FLOOR))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    s = load()
    s2, s0, s1, s3 = s[2], s[0], s[1], s[3]
    s0m, s1m, s3m = shifted(s0, -DROP), shifted(s1, -DROP), shifted(s3, -DROP)
    cn, tn = carriage_new(s2), tool_new(s0m)
    for name, obj in {"carriage_new": cn, "tool_new": tn}.items():
        obj.exportStep(os.path.join(HERE, name + ".step"))
        print("wrote %-13s volume %.0f mm3  valid=%s" % (name, obj.Volume(), obj.isValid()))
    cq.Compound.makeCompound(pins() + bushings() + [magnet_carriage(), magnet_tool()]).exportStep(os.path.join(HERE, "hardware.step"))
    self_check(s, cn, tn, s3m, s1m)
