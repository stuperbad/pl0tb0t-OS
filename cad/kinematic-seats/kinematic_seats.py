"""pl0tb0t tool coupling v2 -- three-groove kinematic coupling, steel contacts, screw-retained magnet.

WHY THIS DESIGN
  * Printed seats cannot take point contact.  3-5 N through a 4 mm ball onto PLA/PETG is
    ~175 MPa Hertz pressure against a ~50 MPa yield, so printed cones/Vs dent on the first
    few cycles.  Every one of the six contacts here is hardened steel on hardened steel.
  * The magnet only PRELOADS the coupling; the geometry locates it.  The magnet is a
    countersunk disc held by an M3 screw into the plate, so no pocket press fit ever has
    to resist the pull-off load -- the failure that started this redesign.
  * Three radial V-grooves (each = two Ø3 hardened dowel pins) on the carriage, three Ø4
    steel balls on the tool: the classic Kelvin / Slocum three-groove coupling.

Frame ("mating frame"):  Y = insertion axis.  Carriage plate surface at Y = 0, body Y < 0.
Tool face at Y = +GAP, body Y > GAP.  X across the 30 mm face, Z up it (0..30).
All dimensions mm.  Run the file to rebuild the parts and run the self-checks.
"""
import math, os
import cadquery as cq

V = cq.Vector

# ---------------------------------------------------------------- parameters
BALL_D = 4.0          # chrome steel ball (tool side), glued into a spherical socket
DOWEL_D = 3.0         # hardened ground dowel pin, ISO 8734 (carriage side)
DOWEL_L = 6.0          # ISO 8734 3x6; ball travel along the groove +/-2.5 stays on the pin
THETA = 50.0          # contact-normal angle from the insertion axis (V half-angle)
RHO = 10.0            # radius of the ball circle about the face centre (walls checked >=1.4 mm)
CX, CZ = 0.0, 15.0    # face centre
W, H = 30.0, 30.0     # face size
DELTA = 0.3           # dowel axis sits this far BELOW the carriage surface
SLOT_CL = 0.08        # radial clearance for glue around each dowel
BALL_CL = 0.03        # radial clearance for glue around each ball
TOOL_CLEAR = 0.6      # tool face clearance above the dowel tops
MAG_D, MAG_T = 10.0, 3.0   # countersunk disc magnet, M3
MAG_GAP = 0.5         # air gap between the two magnet faces when seated
T_C, T_T = 8.0, 9.0   # plate thicknesses
ANGLES = (90.0, 210.0, 330.0)

rb, rd = BALL_D / 2, DOWEL_D / 2
th = math.radians(THETA)
S = 2 * (rb + rd) * math.sin(th)       # dowel centre spacing across a groove
HC = (rb + rd) * math.cos(th)          # ball centre height above the dowel-axis plane
GAP = (rd - DELTA) + TOOL_CLEAR        # tool face height above carriage surface
Y_BALL = -DELTA + HC                   # seated ball-centre Y
CAPTURE_ACROSS = S / 2                 # lateral error a groove can swallow
MAG_FACE_C = GAP - MAG_GAP             # carriage magnet face Y


def groove_frames():
    out = []
    for a in ANGLES:
        ar = math.radians(a)
        d = (math.cos(ar), math.sin(ar))           # along the groove (radial), in XZ
        n = (-math.sin(ar), math.cos(ar))          # across the groove
        out.append(dict(a=a, d=d, n=n, X=CX + RHO * d[0], Z=CZ + RHO * d[1]))
    return out


GR = groove_frames()


def cyl(r, h, p, d):
    return cq.Solid.makeCylinder(r, h, V(*p), V(*d))


def box(lx, ly, lz, p):
    return cq.Solid.makeBox(lx, ly, lz, V(*p))


def sph(r, c):
    """Full sphere. cq.Solid.makeSphere defaults to angle1=0..90, i.e. a HEMISPHERE."""
    return cq.Solid.makeSphere(r, V(*c), V(0, 1, 0), -90, 90, 360)


# ---------------------------------------------------------------- carriage plate
def slot_tool():
    """Cutter for ONE groove in a local frame: x along the dowels, y insertion, z across."""
    L = DOWEL_L + 0.3
    r = rd + SLOT_CL
    parts = []
    for sgn in (-1, 1):
        zc = sgn * S / 2
        parts.append(cyl(r, L, (-L / 2, -DELTA, zc), (1, 0, 0)))
        parts.append(box(L, DELTA + 0.6, 2 * r, (-L / 2, -DELTA, zc - r)))
    # relief between the dowels so the ball never touches the plate
    parts.append(box(L, 1.2 + DELTA + 0.6, S, (-L / 2, -DELTA - 1.2, -S / 2)))
    t = parts[0]
    for p in parts[1:]:
        t = t.fuse(p)
    return t


def place_groove_tool(t, g):
    return t.rotate(V(0, 0, 0), V(0, 1, 0), -g["a"]).translate(V(g["X"], 0, g["Z"]))


MOUNT_HOLES = [(sx * 12.5, z) for sx in (-1, 1) for z in (2.5, 27.5)]   # PLACEHOLDER pattern


def carriage_plate():
    body = box(W, T_C, H, (-W / 2, -T_C, 0))
    t = slot_tool()
    for g in GR:
        body = body.cut(place_groove_tool(t, g))
    # magnet pocket + M3 pilot
    floor = MAG_FACE_C - MAG_T
    body = body.cut(cyl(MAG_D / 2 + 0.1, 0.1 + (0 - floor), (CX, floor, CZ), (0, 1, 0)))
    body = body.cut(cyl(1.3, 5.0, (CX, floor - 5.0, CZ), (0, 1, 0)))
    # placeholder mounting holes (M3 flat head, countersunk from the front)
    for (x, z) in MOUNT_HOLES:
        body = body.cut(cyl(1.7, T_C + 1, (x, -T_C - 0.5, z), (0, 1, 0)))
        body = body.cut(cq.Solid.makeCone(1.7, 3.2, 1.5, V(x, -1.5, z), V(0, 1, 0)))
    return body


def dowels():
    out = []
    L = DOWEL_L
    for g in GR:
        for sgn in (-1, 1):
            c = (g["X"] + sgn * S / 2 * g["n"][0], -DELTA, g["Z"] + sgn * S / 2 * g["n"][1])
            p0 = (c[0] - g["d"][0] * L / 2, c[1], c[2] - g["d"][1] * L / 2)
            out.append(cyl(rd, L, p0, (g["d"][0], 0, g["d"][1])))
    return out


# ---------------------------------------------------------------- tool plate
def tool_plate():
    body = box(W, T_T, H, (-W / 2, GAP, 0))
    for g in GR:
        c = (g["X"], Y_BALL, g["Z"])
        r = rb + BALL_CL
        body = body.cut(sph(r, c))
        body = body.cut(cyl(r, Y_BALL - GAP + 0.2, (c[0], GAP - 0.2, c[2]), (0, 1, 0)))
    body = body.cut(cyl(MAG_D / 2 + 0.1, MAG_T + 0.1, (CX, GAP - 0.1, CZ), (0, 1, 0)))
    body = body.cut(cyl(1.3, 5.0, (CX, GAP + MAG_T, CZ), (0, 1, 0)))
    for (x, z) in MOUNT_HOLES:
        body = body.cut(cyl(1.7, T_T + 1, (x, GAP - 0.5, z), (0, 1, 0)))
        body = body.cut(cq.Solid.makeCone(3.2, 1.7, 1.5, V(x, GAP - 0.0, z), V(0, 1, 0)))
    return body


def balls(dy=0.0, dx=0.0, dz=0.0):
    return [sph(rb, (g["X"] + dx, Y_BALL + dy, g["Z"] + dz)) for g in GR]


def magnet(face_y, up):
    """Disc magnet; up=+1 extends toward +Y from face_y?  (modelled as a plain disc)"""
    y0 = face_y - MAG_T if up < 0 else face_y
    return cyl(MAG_D / 2, MAG_T, (CX, y0, CZ), (0, 1, 0))


# ---------------------------------------------------------------- checks
def vol(a, b):
    try:
        return a.intersect(b).Volume()
    except Exception:
        return 0.0


def wall_report():
    """Printed-wall thickness between the cuts (want >= ~1 mm = 3 perimeters)."""
    t = slot_tool()
    cutters = [place_groove_tool(t, g) for g in GR]
    pocket = cyl(MAG_D / 2 + 0.1, 3.2, (CX, MAG_FACE_C - MAG_T, CZ), (0, 1, 0))
    holes = [cyl(1.7, 8.0, (x, -8.0, z), (0, 1, 0)) for (x, z) in MOUNT_HOLES]
    xs = max(max(abs(c.BoundingBox().xmin), abs(c.BoundingBox().xmax)) for c in cutters)
    zlo = min(c.BoundingBox().zmin for c in cutters)
    zhi = max(c.BoundingBox().zmax for c in cutters)
    print("\nprinted walls (mm): slot-to-magnet %.2f | slot-to-screw-hole %.2f | slot-to-plate-edge %.2f"
          % (min(c.distance(pocket) for c in cutters),
             min(c.distance(h) for c in cutters for h in holes),
             min(15 - xs, zlo, 30 - zhi)))


def hertz_note():
    # ball (R=2) on a Ø3 pin, crossed cylinders ~ treat as sphere on cylinder, R_eff ~ 1.2 mm
    def p0(F, E, R):
        a = (3 * F * R / (4 * E)) ** (1 / 3)
        return 3 * F / (2 * math.pi * a * a)
    Reff = 1.2e-3
    print("\nHertz contact pressure (R_eff 1.2 mm, 2.6 N normal force per pin):")
    for name, E in (("hardened steel on steel (E*~115 GPa)", 115e9), ("ball on PLA (E*~3.9 GPa)", 3.9e9)):
        print("   %-40s %7.0f MPa" % (name, p0(2.6, E, Reff) / 1e6))
    print("   PLA yield ~50 MPa  |  52100/100Cr6 hardened ~ 3000-4000 MPa allowable")


def self_check():
    cp, tp = carriage_plate(), tool_plate()
    dw, bl = dowels(), balls()
    print("S (dowel spacing) %.3f   capture across a groove +/- %.2f   seated ball-centre Y %.3f" %
          (S, CAPTURE_ACROSS, Y_BALL))
    print("tool face gap above carriage surface: %.2f   dowel tops at Y=%.2f   clearance %.2f" %
          (GAP, rd - DELTA, GAP - (rd - DELTA)))
    print("magnet faces: carriage Y=%.2f  tool Y=%.2f   air gap %.2f" % (MAG_FACE_C, GAP, GAP - MAG_FACE_C))

    # 1 dowels sit inside their slots (no overlap with the cut plate)
    print("\n[1] dowel / carriage-plate overlap (want ~0): %s" % ["%.3f" % vol(d, cp) for d in dw])
    # 2 ball touches exactly its two dowels
    bad = []
    for i, g in enumerate(GR):
        c = V(g["X"], Y_BALL, g["Z"])
        for sgn in (-1, 1):
            d = dw[2 * i + (0 if sgn < 0 else 1)]
            ctr = d.Center()
            ax = V(g["d"][0], 0, g["d"][1])
            rel = c - ctr
            perp = rel - ax * rel.dot(ax)
            bad.append(round(perp.Length - (rb + rd), 4))
    print("[2] ball-centre to dowel-axis distance minus (rb+rd) (want 0): %s" % bad)
    # 3 ball overlap with the dowels (touching only)
    print("[3] ball/dowel overlap volumes (want ~0): %s" % ["%.4f" % vol(bl[i // 2], d) for i, d in enumerate(dw)])
    # 4 inflated ball vs plate: clearance to the printed surface
    infl = [sph(rb + 0.2, (g["X"], Y_BALL, g["Z"])) for g in GR]
    print("[4] ball +0.2 mm vs carriage plate (want 0 -> >=0.2 mm clearance): %s" % ["%.3f" % vol(b, cp) for b in infl])
    # 5 tool plate vs dowels, and vs balls (balls sit in sockets)
    print("[5] tool plate vs dowels (want 0): %s" % ["%.3f" % vol(tp, d) for d in dw])
    print("    balls vs tool plate (glue sockets, want ~0): %s" % ["%.3f" % vol(b, tp) for b in bl])
    # 6 mounting holes vs groove cuts
    print("[6] M3 holes clear of dowel slots: %s" %
          all(vol(cyl(1.7, T_C, (x, -T_C, z), (0, 1, 0)), t) < 1e-6
              for (x, z) in MOUNT_HOLES for t in dw))

    # 7 capture sweep: lower the ball with an offset ACROSS groove 0 and find first contact
    g0 = GR[0]
    nvec = g0["n"]
    print("\n[7] capture sweep across the top groove (offset across the V):")
    print("    offset   first contact (ball-centre Y)   analytic   outcome")
    for e in (1.0, 2.0, 2.5, 2.6, 2.8, 3.1):
        yc = None
        y = 6.0
        while y > Y_BALL - 0.3:
            c = sph(rb, (g0["X"] + e * nvec[0], y, g0["Z"] + e * nvec[1]))
            if any(vol(c, d) > 1e-4 for d in dw[:2]):
                yc = y
                break
            y -= 0.02
        # analytic first touch against the NEAR dowel (centre at lateral S/2, axis Y = -DELTA)
        dl = S / 2 - e
        an = (-DELTA + math.sqrt(max(0.0, (rb + rd) ** 2 - dl * dl))) if abs(dl) < rb + rd else None
        outcome = "slides INTO the V" if e < S / 2 else "rides OVER the pin (no capture)"
        print("    %5.1f    %-30s %-10s %s" % (e, "%.2f" % yc if yc else "no hit", "%.2f" % an if an else "-", outcome))
    e = 2.5
    dl = S / 2 - e
    y_first = -DELTA + math.sqrt((rb + rd) ** 2 - dl * dl)
    print("    Y travel from first contact to seated at +/-%.1f mm lateral error: %.2f mm" % (e, y_first - Y_BALL))
    wall_report()
    hertz_note()


if __name__ == "__main__":
    out = os.path.dirname(os.path.abspath(__file__))
    cp, tp = carriage_plate(), tool_plate()
    parts = {"carriage_plate": cp, "tool_plate": tp}
    for name, obj in parts.items():
        obj.exportStep(os.path.join(out, name + ".step"))
        obj.exportStl(os.path.join(out, name + ".stl"))
        print("wrote %-15s volume %.0f mm3" % (name, obj.Volume()))
    # reference hardware, for the assembly picture / BOM check
    hw = cq.Compound.makeCompound(dowels() + balls())
    hw.exportStep(os.path.join(out, "hardware_dowels_balls.step"))
    self_check()
