"""Bushing-pin coupler fitted to the existing carriage + pen holder (Onshape STEP export).  Rev 2.

Nothing is moved: carriage (s2), hex pen holder (s0), cup (s3), dock (s1) stay where the STEP has them.
The holder's rear face (Y = -10) already sits flat against the carriage's front face.  Changes:

  * the old coupling is removed: the five D6 magnet pockets (+ their small screw/push-out holes) on BOTH mating faces are filled
  * the carriage gets a SHELF protruding forward off its front face, over the holder's rear slab
    (X +/-15, Y -10..0, Z 30..44.5).  Its underside (Z = 30 = the holder's top) carries 2 funnels + 2 stacked bushings
    and ONE magnet pocket.
  * the holder gets 2 steel pins pointing UP out of its top (Z = 30) plus ONE magnet pocket, so the holder just falls
    straight off the carriage when the carriage is lifted and the dock holds the holder back.

Run:  python fit.py   (needs 'Pen Holder assembly.step' in Downloads)
"""
import math, os
import cadquery as cq

V = cq.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = r"C:\Users\evanf\Downloads\Pen Holder assembly.step"

# ------------------------------------------------------------------ parameters
SEAT_Z = 30.0                       # top of the pen holder = underside of the shelf
FACE_Y = -10.0                      # carriage front face / holder rear face
CY = -6.0                           # pin + magnet line (Y)
SHELF_X, SHELF_Y1 = 15.0, 0.0       # shelf spans X +/-15, Y -10..0
PIN_SP = 16.0
PINS_X = (-PIN_SP / 2, PIN_SP / 2)
PIN_D, PIN_L, PIN_EMBED, TIP_CH = 3.0, 20.0, 7.5, 0.5
PIN_P = PIN_L - PIN_EMBED
PIN_HOLE_D = 3.05
BUSH_ID, BUSH_OD, BUSH_L, BUSH_N = 3.0, 5.0, 5.0, 2
BUSH_POCKET_D = BUSH_OD + 0.1
BUSH_STACK = BUSH_L * BUSH_N
FUN_R_MOUTH, FUN_R_BOT = 3.8, 2.0
FUN_DEPTH = FUN_R_MOUTH - FUN_R_BOT
RELIEF_D, RELIEF_L, FLOOR = 3.4, 1.5, 1.2
T_SHELF = FUN_DEPTH + BUSH_STACK + RELIEF_L + FLOOR
MAG_D, MAG_L, MAG_CL, SKIN = 6.0, 6.0, 0.2, 1.0
# old magnet pockets (X, Z): five per face, D6 pockets, small bores behind
OLD_HOLES = [(-10, 5), (0, 5), (10, 5), (-10, 25), (10, 25)]
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


# ------------------------------------------------------------------ patches
def patched_carriage(s2):
    body = s2
    for (x, z) in OLD_HOLES:     # D6 pockets + D3.5 bores run Y -28 .. -10 (open at the rear)
        body = body.fuse(cyl(3.35, 18.1, (x, -28.1, z), (0, 1, 0)))
    return body.clean()


def patched_holder(s0):
    body = s0
    for (x, z) in OLD_HOLES:     # D6 pockets to Y -4.3, D3.5-3.8 bores to -3.2 (centre one to -1.5)
        centre = (x, z) == (0, 5)
        end = -1.4 if centre else -3.2
        body = body.fuse(cyl(1.85 if centre else 3.35, end - FACE_Y, (x, FACE_Y, z), (0, 1, 0)))
        if centre:
            body = body.fuse(cyl(3.35, -3.2 - FACE_Y, (x, FACE_Y, z), (0, 1, 0)))
    return body.clean()


# ------------------------------------------------------------------ new interface
def shelf_block():
    sh = (cq.Workplane("XY").box(2 * SHELF_X, SHELF_Y1 - FACE_Y + 0.4, T_SHELF, centered=False)
          .translate((-SHELF_X, FACE_Y - 0.4, SEAT_Z)))
    sh = sh.edges("|Z and >Y").fillet(3.0).faces("<Z").edges("not <Y").chamfer(1.0).faces(">Z").edges("not <Y").fillet(1.5)
    return sh.val()


def carriage_new(s2):
    body = patched_carriage(s2).fuse(shelf_block()).clean()
    for x in PINS_X:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (x, CY, SEAT_Z - 0.2), UP))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, CY, SEAT_Z + FUN_DEPTH), UP))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (x, CY, SEAT_Z + FUN_DEPTH + BUSH_STACK), UP))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, SEAT_Z + SKIN), UP))
    return body


def holder_new(s0):
    body = patched_holder(s0)
    for x in PINS_X:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (x, CY, SEAT_Z - PIN_EMBED), UP))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, SEAT_Z - SKIN - MAG_L - MAG_CL), UP))
    return body


def pin(x, dx=0.0, dy=0.0, dz=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_CH, (x + dx, CY + dy, SEAT_Z - PIN_EMBED + dz), UP)
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_CH, TIP_CH, (x + dx, CY + dy, SEAT_Z - PIN_EMBED + PIN_L - TIP_CH + dz), UP)
    return p.fuse(t)


def pins():
    return [pin(x) for x in PINS_X]


def bushings():
    out = []
    for x in PINS_X:
        for k in range(BUSH_N):
            z = SEAT_Z + FUN_DEPTH + k * BUSH_L
            out.append(cyl(BUSH_OD / 2, BUSH_L, (x, CY, z), UP).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (x, CY, z - 0.1), UP)))
    return out


def magnet_carriage():
    return cyl(MAG_D / 2, MAG_L, (0, CY, SEAT_Z + SKIN), UP)


def magnet_tool():
    return cyl(MAG_D / 2, MAG_L, (0, CY, SEAT_Z - SKIN - MAG_L), UP)


def self_check(s, cn, hn):
    s1, s3 = s[1], s[3]
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("PATCHES (solid fraction of a D5.8 x 8 mm probe where each old hole was):")
    for (x, z) in OLD_HOLES:
        pc = vol(cyl(2.9, 8, (x, -17.5, z), (0, 1, 0)), cn) / cyl(2.9, 8, (x, -17.5, z), (0, 1, 0)).Volume()
        ph = vol(cyl(2.9, 5, (x, -9.8, z), (0, 1, 0)), hn) / cyl(2.9, 5, (x, -9.8, z), (0, 1, 0)).Volume()
        print("   old hole (%3d,%3d): carriage %.0f%%  holder %.0f%%" % (x, z, 100 * pc, 100 * ph))
    print("SEATED:")
    chk("pins clear both bodies (only inside holes/bushings)",
        all(vol(p, hn) < 1e-3 for p in pins()) and all(vol(p, cn) < 1e-3 for p in pins()))
    chk("bushings clear the shelf pockets", all(vol(b, cn) < 1e-3 for b in bushings()))
    chk("magnets clear their cavities", vol(magnet_carriage(), cn) < 1e-3 and vol(magnet_tool(), hn) < 1e-3)
    chk("carriage and holder do not overlap", vol(cn, hn) < 1e-3, "(%.3f)" % vol(cn, hn))
    chk("pin tip stays in the relief",
        SEAT_Z + FUN_DEPTH + BUSH_STACK < SEAT_Z - PIN_EMBED + PIN_L < SEAT_Z + FUN_DEPTH + BUSH_STACK + RELIEF_L - 0.2)
    print("FUNNEL CAPTURE (pins with tip 0.2 mm into the funnel mouth plane, offset sideways):")
    for e in (1.5, 2.0, 2.3):
        worst = 0.0
        for a in range(0, 360, 45):
            dx, dy = e * math.cos(math.radians(a)), e * math.sin(math.radians(a))
            # tip currently at SEAT_Z - PIN_EMBED + PIN_L; move it down so the tip sits 0.2 mm above the seat plane
            shift = (SEAT_Z - 0.2) - (SEAT_Z - PIN_EMBED + PIN_L) + 0.4
            worst = max(worst, max(vol(pin(x, dx, dy, dz=shift), cn) for x in PINS_X))
        chk("%.1f mm error: pin tips enter the funnel mouth freely" % e, worst < 1e-3, "(%.4f)" % worst)
    print("CLEARANCE (overlap mm3, want 0): new carriage vs dock %.2f | vs cup %.2f | holder vs dock %.2f"
          % (vol(cn, s1), vol(cn, s3), vol(hn, s1)))
    print("   original STEP for comparison: carriage vs dock %.2f | holder vs dock %.2f" % (vol(s[2], s1), vol(s[0], s1)))
    mag_c = cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY, SEAT_Z + SKIN), UP)
    funs = [cone(FUN_R_MOUTH, FUN_R_BOT, FUN_DEPTH, (x, CY, SEAT_Z), UP) for x in PINS_X]
    print("WALLS (mm): magnet cavity to funnel %.2f | shelf front to funnel mouth %.2f | funnel mouth to shelf side %.2f | roof %.2f"
          % (min(mag_c.distance(f) for f in funs), SHELF_Y1 - (CY + FUN_R_MOUTH), SHELF_X - PIN_SP / 2 - FUN_R_MOUTH, FLOOR))
    print("   holder: wall behind magnet pocket %.2f | in front of it %.2f (slab at X=0 ends near Y -1.5)"
          % ((CY - MAG_D / 2 - MAG_CL / 2) - FACE_Y, -1.5 - (CY + MAG_D / 2 + MAG_CL / 2)))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    s = load()
    cn, hn = carriage_new(s[2]), holder_new(s[0])
    for name, obj in {"carriage_new": cn, "holder_new": hn}.items():
        obj.exportStep(os.path.join(HERE, name + ".step"))
        print("wrote %-13s volume %.0f mm3  valid=%s" % (name, obj.Volume(), obj.isValid()))
    cq.Compound.makeCompound(pins() + bushings() + [magnet_carriage(), magnet_tool()]).exportStep(os.path.join(HERE, "hardware.step"))
    self_check(s, cn, hn)
