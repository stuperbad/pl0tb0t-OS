"""Bushing-pin coupler fitted to the existing carriage + pen holder (Onshape STEP export).  Rev 3.

Built from the user's side-view sketch: the carriage's lower stem gets a LEDGE that sticks forward (+Y) and the pen holder
gets a matching notch under its rear, so the holder's rear overhang rests ON the ledge.  Nothing is moved.

  seat plane : Z = 18  (ledge top = underside of the holder's overhang)
  carriage   : ledge Z 0..18, Y -10..-1.5 in the middle (|X|<5), Y -10..-2.5 on the wings, X +/-15
               top face carries 2 funnels + 2 x 2 stacked bushings (opening UP) and ONE magnet pocket
  holder     : notch cut under the rear (Z 0..18); overhang Z 18..30 keeps its rear face flat on the carriage face (Y = -10)
               carries 2 steel pins pointing DOWN + ONE magnet pocket
  old coupling: the five D6 magnet pockets (+ small bores) on both mating faces are filled, rims included

Pickup: the carriage slides in at a low Z so the ledge goes under the overhang, then rises; pins drop into the funnels
and bushings; the holder rests on the ledge (gravity helps, the magnet only stops it lifting off).
Drop: lower the carriage (ledge leaves the pins), then back away.

Run:  python fit.py   (needs 'Pen Holder assembly.step' in Downloads)
"""
import math, os
import cadquery as cq

V = cq.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = r"C:\Users\evanf\Downloads\Pen Holder assembly.step"

# ------------------------------------------------------------------ parameters
SEAT_Z = 18.0                       # ledge top / underside of holder overhang
FACE_Y = -10.0                      # carriage front face / holder rear face
LEDGE_X = 15.0
LEDGE_BACK = -10.4                  # ledge starts a little inside the carriage so it fuses
LEDGE_Y1 = -1.5                     # centre part ends where the holder's hex-pocket wall ends at X=0
LOBE_X0, LOBE_Y1 = 5.0, -2.5        # side wings (|X| 5..15) stop here: the dock's side features start at Y -2.2
NOTCH_CL = 0.3                      # clearance between ledge and holder notch
CY_PIN, CY_MAG = -6.4, -5.8
PIN_SP = 19.0
PINS_X = (-PIN_SP / 2, PIN_SP / 2)
PIN_D, PIN_L, PIN_EMBED, TIP_CH = 3.0, 20.0, 7.5, 0.5
PIN_HOLE_D = 3.05
BUSH_ID, BUSH_OD, BUSH_L, BUSH_N = 3.0, 5.0, 5.0, 2
BUSH_POCKET_D = BUSH_OD + 0.1
BUSH_STACK = BUSH_L * BUSH_N
FUN_R_MOUTH, FUN_R_BOT = 3.5, 2.0
FUN_DEPTH = FUN_R_MOUTH - FUN_R_BOT
RELIEF_D, RELIEF_L = 3.4, 1.5
MAG_D, MAG_L, MAG_CL, SKIN = 6.0, 6.0, 0.2, 1.0
OLD_HOLES = [(-10, 5), (0, 5), (10, 5), (-10, 25), (10, 25)]     # (X, Z) of the old D6 pockets
UP, DOWN = (0, 0, 1), (0, 0, -1)
PIN_TIP_Z = SEAT_Z + PIN_EMBED - PIN_L


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


# ------------------------------------------------------------------ old coupling removal
def fill_old_holes(body, face_side):
    """face_side 'carriage': pockets run Y -28..-10 (D6 + D3.5 bores).  'holder': pockets run Y -10..-3.2 (centre bore to -1.4).
    A wider plug at the face removes the countersink/fillet rim as well."""
    for (x, z) in OLD_HOLES:
        if face_side == "carriage":
            body = body.fuse(cyl(3.35, 18.1, (x, -28.1, z), (0, 1, 0)))
            body = body.fuse(cyl(3.95, 1.0, (x, FACE_Y - 1.0, z), (0, 1, 0)))        # rim plug (stays behind the face)
        else:
            body = body.fuse(cyl(3.35, -3.2 - FACE_Y, (x, FACE_Y, z), (0, 1, 0)))
            if (x, z) == (0, 5):
                body = body.fuse(cyl(1.85, -1.4 - FACE_Y, (x, FACE_Y, z), (0, 1, 0)))
            body = body.fuse(cyl(3.95, 1.2, (x, FACE_Y, z), (0, 1, 0)))
    return body.clean()


# ------------------------------------------------------------------ ledge / notch
def ledge_pts():
    return [(-LEDGE_X, LEDGE_BACK), (LEDGE_X, LEDGE_BACK), (LEDGE_X, LOBE_Y1), (LOBE_X0, LOBE_Y1), (LOBE_X0, LEDGE_Y1),
            (-LOBE_X0, LEDGE_Y1), (-LOBE_X0, LOBE_Y1), (-LEDGE_X, LOBE_Y1)]


def ledge_solid():
    w = cq.Workplane("XY").polyline(ledge_pts()).close().extrude(SEAT_Z)
    # round the outer front corners (X +/-15, wing front) and the inner step corners
    for (x, y, r) in ((LEDGE_X, LOBE_Y1, 2.0), (-LEDGE_X, LOBE_Y1, 2.0), (LOBE_X0, LEDGE_Y1, 1.0), (-LOBE_X0, LEDGE_Y1, 1.0)):
        try:
            t = w.edges("|Z").edges(cq.selectors.BoxSelector((x - 0.3, y - 0.3, -1), (x + 0.3, y + 0.3, SEAT_Z + 1))).fillet(r)
            if t.val().isValid():
                w = t
        except Exception:
            pass
    try:
        t = w.faces("<Z").edges(cq.selectors.BoxSelector((-LEDGE_X - 1, -9.5, -0.5), (LEDGE_X + 1, 5, 0.5))).chamfer(0.8)
        if t.val().isValid() and t.val().BoundingBox().zmin > -1e-6:
            w = t
    except Exception:
        pass
    return w.val()


def notch_cutter():
    pts = ledge_pts()
    w = cq.Workplane("XY").workplane(offset=-1.0).polyline(pts).close().offset2D(NOTCH_CL).extrude(SEAT_Z + 1.0)
    return w.val()


# ------------------------------------------------------------------ parts
def carriage_new(s2):
    body = fill_old_holes(s2, "carriage").fuse(ledge_solid()).clean()
    for x in PINS_X:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (x, CY_PIN, SEAT_Z + 0.2), DOWN))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, CY_PIN, SEAT_Z - FUN_DEPTH), DOWN))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (x, CY_PIN, SEAT_Z - FUN_DEPTH - BUSH_STACK), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY_MAG, SEAT_Z - SKIN), DOWN))
    return body


def holder_new(s0):
    body = fill_old_holes(s0, "holder").cut(notch_cutter())
    for x in PINS_X:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (x, CY_PIN, SEAT_Z + PIN_EMBED), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY_MAG, SEAT_Z + SKIN), UP))
    return body


def pin(x, dx=0.0, dy=0.0, dz=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_CH, (x + dx, CY_PIN + dy, SEAT_Z + PIN_EMBED + dz), DOWN)
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_CH, TIP_CH, (x + dx, CY_PIN + dy, PIN_TIP_Z + TIP_CH + dz), DOWN)
    return p.fuse(t)


def pins():
    return [pin(x) for x in PINS_X]


def bushings():
    out = []
    for x in PINS_X:
        for k in range(BUSH_N):
            z = SEAT_Z - FUN_DEPTH - k * BUSH_L
            out.append(cyl(BUSH_OD / 2, BUSH_L, (x, CY_PIN, z), DOWN).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (x, CY_PIN, z + 0.1), DOWN)))
    return out


def magnet_carriage():
    return cyl(MAG_D / 2, MAG_L, (0, CY_MAG, SEAT_Z - SKIN), DOWN)


def magnet_holder():
    return cyl(MAG_D / 2, MAG_L, (0, CY_MAG, SEAT_Z + SKIN), UP)


magnet_tool = magnet_holder


def self_check(s, cn, hn):
    s1, s3 = s[1], s[3]
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("OLD COUPLING REMOVED (solid fraction of probes where the old pockets / rims were):")
    for (x, z) in OLD_HOLES:
        tag = []
        if z == 25 or True:
            pr = cyl(3.9, 0.6, (x, FACE_Y - 0.7, z), (0, 1, 0)); tag.append("carriage rim %.0f%%" % (100 * vol(pr, cn) / pr.Volume()))
            pr2 = cyl(3.9, 0.6, (x, FACE_Y + 0.1, z), (0, 1, 0)); tag.append("holder rim %.0f%%" % (100 * vol(pr2, hn) / pr2.Volume()))
        print("   (%3d,%3d): %s%s" % (x, z, " | ".join(tag), "   <- inside the notch/ledge now" if z == 5 else ""))
    print("SEATED:")
    chk("pins clear both bodies (only inside their holes / bushings)",
        all(vol(p, hn) < 1e-3 for p in pins()) and all(vol(p, cn) < 1e-3 for p in pins()))
    chk("bushings clear the ledge pockets", all(vol(b, cn) < 1e-3 for b in bushings()))
    chk("magnets clear their cavities", vol(magnet_carriage(), cn) < 1e-3 and vol(magnet_holder(), hn) < 1e-3)
    chk("carriage and holder do not overlap (ledge in notch, 0.3 mm clearance)", vol(cn, hn) < 1e-3, "(%.3f)" % vol(cn, hn))
    chk("pin tip stays in the relief", SEAT_Z - FUN_DEPTH - BUSH_STACK - RELIEF_L + 0.2 < PIN_TIP_Z < SEAT_Z - FUN_DEPTH - BUSH_STACK,
        "(tip Z %.1f, bushings end %.1f, relief ends %.1f)" % (PIN_TIP_Z, SEAT_Z - FUN_DEPTH - BUSH_STACK, SEAT_Z - FUN_DEPTH - BUSH_STACK - RELIEF_L))
    print("FUNNEL CAPTURE (carriage rising: pin tips 0.2 mm below the funnel mouth plane, offset sideways):")
    shift = (SEAT_Z - 0.2) - PIN_TIP_Z
    for e in (1.0, 1.5, 2.0):
        worst = 0.0
        for a in range(0, 360, 45):
            dx, dy = e * math.cos(math.radians(a)), e * math.sin(math.radians(a))
            worst = max(worst, max(vol(pin(x, dx, dy, dz=shift + 0.4), cn) for x in PINS_X))
        chk("%.1f mm error: pin tips enter the funnel mouth freely" % e, worst < 1e-3, "(%.4f)" % worst)
    print("CLEARANCE (overlap mm3, want 0): new carriage vs dock %.2f | vs cup %.2f | holder vs dock %.2f"
          % (vol(cn, s1), vol(cn, s3), vol(hn, s1)))
    print("   original STEP for comparison: carriage vs dock %.2f | holder vs dock %.2f" % (vol(s[2], s1), vol(s[0], s1)))
    mag_c = cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY_MAG, SEAT_Z - SKIN), DOWN)
    funs = [cone(FUN_R_MOUTH, FUN_R_BOT, FUN_DEPTH, (x, CY_PIN, SEAT_Z), DOWN) for x in PINS_X]
    print("WALLS (mm): magnet cavity to funnel %.2f | ledge front to magnet cavity %.2f | pin funnel mouth to ledge side %.2f | floor under relief %.2f"
          % (min(mag_c.distance(f) for f in funs), LEDGE_Y1 - (CY_MAG + MAG_D / 2 + MAG_CL / 2), LEDGE_X - PIN_SP / 2 - FUN_R_MOUTH,
             SEAT_Z - FUN_DEPTH - BUSH_STACK - RELIEF_L))
    print("   holder: overhang wall behind the magnet pocket %.2f | slab in front of it %.2f"
          % ((CY_MAG - MAG_D / 2 - MAG_CL / 2) - FACE_Y, -1.5 - (CY_MAG + MAG_D / 2 + MAG_CL / 2)))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    s = load()
    cn, hn = carriage_new(s[2]), holder_new(s[0])
    for name, obj in {"carriage_new": cn, "holder_new": hn}.items():
        obj.exportStep(os.path.join(HERE, name + ".step"))
        print("wrote %-13s volume %.0f mm3  valid=%s" % (name, obj.Volume(), obj.isValid()))
    cq.Compound.makeCompound(pins() + bushings() + [magnet_carriage(), magnet_holder()]).exportStep(os.path.join(HERE, "hardware.step"))
    self_check(s, cn, hn)
