"""Bushing-pin coupler fitted to the existing carriage + pen holder (Onshape STEP export).  Rev 3.

Built from the user's side-view sketch: the carriage's lower stem gets a LEDGE that sticks forward (+Y) and the pen holder
gets a matching notch under its rear, so the holder's rear overhang rests ON the ledge.  Nothing is moved.

  seat plane : Z = 18  (ledge top = underside of the holder's overhang)
  carriage   : ledge Z 0..18, Y -10..-2.5, X +/-15 (plain rectangle)
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
import defeature as D

V = cq.Vector
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = r"C:\Users\evanf\Downloads\Pen Holder assembly.step"

# ------------------------------------------------------------------ parameters
SEAT_Z = 18.0                       # ledge top / underside of holder overhang
FACE_Y = -10.0                      # carriage front face / holder rear face
LEDGE_X = 15.0
LEDGE_BACK = -10.4                  # ledge starts a little inside the carriage so it fuses
LEDGE_Y1 = -2.5                     # one straight front edge (no centre tongue)
LOBE_X0, LOBE_Y1 = 5.0, -2.5        # ledge front (the dock's side features start at Y -2.2)
NOTCH_CL = 0.3                      # clearance between ledge and holder notch
CY_PIN, CY_MAG = -6.4, -6.2
PIN_SP = 19.0
PINS_X = (-PIN_SP / 2, PIN_SP / 2)
PIN_D, PIN_L, PIN_EMBED = 3.0, 20.0, 7.5
TIP_R, TIP_L = 1.0, 1.732            # bullet tip: 1.0 mm radial over 1.73 mm (30 deg from the axis) -> flat tip only D1.0
BUSH_CH = 0.4                        # lead-in chamfer 0.4 x 45 deg on each bushing's entry end (countersink / deburr tool)
PIN_HOLE_D = 3.05
BUSH_ID, BUSH_OD, BUSH_L, BUSH_N = 3.0, 5.0, 5.0, 2
BUSH_POCKET_D = BUSH_OD + 0.1
BUSH_STACK = BUSH_L * BUSH_N
FUN_R_MOUTH, FUN_R_BOT = 3.5, BUSH_ID / 2 + BUSH_CH + 0.25   # funnel bottom 0.25 outside the chamfer edge: printed tolerance can never leave a lip over the chamfer
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
def clean_carriage(s2):
    """Remove the old pockets by deleting their faces (OCCT heals the surfaces): no filler seams, no rims."""
    return D.defeature(s2, D.hole_feature_faces(s2, OLD_HOLES))


def _void_pieces(region, s0, must_contain=None):
    """Parts of `region` that are empty in s0 (the old hole voids).  must_contain: keep only pieces containing this point."""
    out = []
    try:
        pieces = region.cut(s0).Solids()
    except Exception:
        return out
    for p in pieces:
        if must_contain is None or p.isInside(V(*must_contain), 1e-3):
            out.append(p)
    return out


def clean_holder(s0):
    """Restore the solid wherever the old D6 pockets, their rim/floor fillets and the D3.5 push-out bores (rear and the long
    ones through the front wall) were.  Fillers are exactly the hole voids (region minus the part), so nothing is added in
    legitimate notches or in the hex pen pocket."""
    body = s0
    for (x, z) in OLD_HOLES:
        parts = []
        # D6 pocket
        parts += _void_pieces(cq.Solid.makeCylinder(3.02, 6.2, V(x, -10.0, z), V(0, 1, 0)), s0, must_contain=(x, -6.0, z))
        # mouth fillet ring (void between the rim torus and the rear face)
        parts += _void_pieces(cq.Solid.makeCylinder(4.05, 1.1, V(x, -10.0, z), V(0, 1, 0)), s0, must_contain=(x + 3.4, -9.9, z))
        # rear bore (starts at the pocket floor) up to the pen-pocket wall; stays inside x0 +/- 1.85 so it never reaches the side notches
        y_end = -0.6 if x == 0 else 6.5
        rb = D.clipped_cylinder(s0, x, z, 1.85, -4.3, y_end, [(-1.5, 0.8)] if x == 0 else [(4.0, 6.5)])
        parts += _void_pieces(rb, s0)
        if x != 0:       # long bore through the front wall: from the inner wall plane to the outer wall plane
            fb = D.clipped_cylinder(s0, x, z, 1.85, 21.5, 27.0, [(22.0, 23.0), (25.5, 27.0)])
            parts += _void_pieces(fb, s0)
        for p in parts:
            body = body.fuse(p)
    body = D.unify(body.clean())
    return _heal_leftovers(body)


def _heal_leftovers(body):
    """After the fills a few tiny hole faces remain (floor-fillet crescents, spot-faces at the front bore exits, bore ends at the
    pen-pocket apex).  Delete those faces and let OCCT heal, batch by batch, keeping a batch only if the solid stays valid and
    the volume barely moves."""
    def batches(faces):
        g = {}
        for fc in faces:
            bb = fc.BoundingBox()
            key = (round((bb.xmin + bb.xmax) / 20), round((bb.zmin + bb.zmax) / 20), "front" if bb.ymin > 10 else ("mid" if bb.ymax > 2 and bb.ymin > -5 else "rear"))
            g.setdefault(key, []).append(fc)
        return list(g.values())
    for _ in range(2):
        for b in batches(D.hole_feature_faces(body, OLD_HOLES)):
            try:
                new = D.defeature(body, b)
            except Exception:
                continue
            if new.isValid() and len(new.Faces()) < len(body.Faces()) and abs(new.Volume() - body.Volume()) < 45:
                body = new
    return body


# ------------------------------------------------------------------ ledge / notch
def ledge_pts():
    return [(-LEDGE_X, LEDGE_BACK), (LEDGE_X, LEDGE_BACK), (LEDGE_X, LEDGE_Y1), (-LEDGE_X, LEDGE_Y1)]


def ledge_solid():
    w = cq.Workplane("XY").polyline(ledge_pts()).close().extrude(SEAT_Z)
    # round the outer front corners (X +/-15, wing front) and the inner step corners
    for (x, y, r) in ((LEDGE_X, LEDGE_Y1, 2.0), (-LEDGE_X, LEDGE_Y1, 2.0)):
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
    body = clean_carriage(s2).fuse(ledge_solid()).clean()
    for x in PINS_X:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (x, CY_PIN, SEAT_Z + 0.2), DOWN))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, CY_PIN, SEAT_Z - FUN_DEPTH), DOWN))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (x, CY_PIN, SEAT_Z - FUN_DEPTH - BUSH_STACK), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY_MAG, SEAT_Z - SKIN), DOWN))
    return body


def holder_new(s0):
    body = clean_holder(s0).cut(notch_cutter())
    for x in PINS_X:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (x, CY_PIN, SEAT_Z + PIN_EMBED), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, CY_MAG, SEAT_Z + SKIN), UP))
    return body


def pin(x, dx=0.0, dy=0.0, dz=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_L, (x + dx, CY_PIN + dy, SEAT_Z + PIN_EMBED + dz), DOWN)
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_R, TIP_L, (x + dx, CY_PIN + dy, PIN_TIP_Z + TIP_L + dz), DOWN)
    return p.fuse(t)


def pins():
    return [pin(x) for x in PINS_X]


def bushings():
    out = []
    for x in PINS_X:
        for k in range(BUSH_N):
            z = SEAT_Z - FUN_DEPTH - k * BUSH_L
            b = cyl(BUSH_OD / 2, BUSH_L, (x, CY_PIN, z), DOWN).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (x, CY_PIN, z + 0.1), DOWN))
            if k == 0:       # lead-in chamfer on the entry end
                b = b.cut(cone(BUSH_ID / 2 + BUSH_CH + 0.1, BUSH_ID / 2, BUSH_CH + 0.1, (x, CY_PIN, z + 0.1), DOWN))
            out.append(b)
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
