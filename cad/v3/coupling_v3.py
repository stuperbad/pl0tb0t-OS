"""pl0tb0t tool coupling v3 -- kinematic seats + spring-closed keyhole latch, solenoid release.

Builds on v2 (three V-grooves of hardened dowels, steel balls on the tool).  v3 adds:

  * a LATCH that holds the tool against pull-off in steel/plastic SHEAR, not by magnet force:
        tool side   : M3 button-head screw (the "stud"), head toward the carriage
        carriage    : a 1.0 mm keyhole TONGUE sliding along Z in a channel under the surface,
                      pushed CLOSED by a spring, pulled OPEN by a solenoid rod
  * a pilot funnel + bore around the stud (captures the same +/-2.7 mm lateral error as the seats)
  * the magnets are demoted to PRELOAD ONLY: Ø6 x 6 (the ones already in the drawer), embedded
    behind a 0.5 mm printed skin (pause the print, drop them in, resume) so nothing is press-fit
    and nothing can be pulled out.

Sequence (software-timed, fail-secure while plotting):
    pickup : unlock ON -> carriage moves in along Y (stud passes through the open keyhole, seats settle)
             -> unlock OFF (spring closes the tongue under the stud head) -> Z lift
    drop   : lower Z -> unlock ON -> carriage retracts -> unlock OFF
    plotting / power loss / alarm / e-stop : unpowered = LOCKED.

Mating frame as v2: Y = insertion axis, carriage surface Y = 0, tool face Y = +GAP (1.8).
X across the 30 mm face, Z up it, face centre (0, 15).  All mm.  Run to rebuild + self-check.
"""
import math, os, sys
import cadquery as cq

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "v2"))
import coupling_v2 as C

V = cq.Vector
cyl, box, sph = C.cyl, C.box, C.sph

# ------------------------------------------------------------------ parameters
CX, CZ = C.CX, C.CZ
GAP = C.GAP                       # 1.8 tool face above carriage surface
W = C.W
T_C = 16.2                        # carriage nose block (surface -> rear), keeps the existing rear face
NOSE_H = 50.0                     # nose block height (Z 0..50), as the existing carriage
T_T = 8.5                         # tool plate thickness

# stud = M3 ISO 7380 button head screw, head toward the carriage
HEAD_D, HEAD_H, HEAD_CH = 5.7, 1.65, 0.8
NECK_D = 3.0
# carriage pilot
BORE_D, FUN_D = 6.8, 11.2
FUN_DEPTH = (FUN_D - BORE_D) / 2          # 45 deg funnel
# tongue (steel shim or printed)
TT = 1.0                                  # tongue thickness
TONGUE_TOP = -3.3                         # tongue top Y (must sit below the funnel: -FUN_DEPTH - margin)
TONGUE_BOT = TONGUE_TOP - TT
CH_CL = 0.15                              # channel clearance each side
HEAD_GAP = 0.2                            # head retaining face sits this far below the tongue
HEAD_TOP = TONGUE_BOT - HEAD_GAP
HEAD_BOT = HEAD_TOP - HEAD_H
BORE_FLOOR = -7.0
TONGUE_W = 8.0                            # across X
HOLE_D = 7.4                              # open keyhole: lets the head through with +/-0.85 clearance
SLOT_W = 3.8                              # closed keyhole slot (neck 3.0 + 0.8)
TRAVEL = 3.6                              # tongue stroke along Z
SLOT_LEN = TRAVEL + 2.6
TONGUE_BELOW, TONGUE_ABOVE = 4.8, 14.0    # tongue extent below / above its hole centre
ROD_D = 2.4                               # pull rod attached to the tongue top end
WALL_Z = 36.5                             # fixed end wall the spring reacts against
SPRING_OD = 5.6
# magnets (preload only)
MAG_D, MAG_L = 6.0, 6.0
SKIN = 0.5
PAD_TOP = 1.2                             # carriage magnet boss top
RHO_M = 11.0
BOSS_R = MAG_D / 2 + 1.2
MAG_ANG = (30.0, 150.0)   # 270 deg removed: the tongue channel runs through it
MAG_POS = [(CX + RHO_M * math.cos(math.radians(a)), CZ + RHO_M * math.sin(math.radians(a))) for a in MAG_ANG]

Z_CLOSED = CZ - TRAVEL                    # tongue hole-centre Z when closed (slot sits on the axis)
Z_OPEN = CZ                               # ... when open (hole sits on the axis)
CH_Z0 = Z_CLOSED - TONGUE_BELOW - 0.3
CH_Z1 = WALL_Z - 1.0                      # channel / spring pocket top


# ------------------------------------------------------------------ carriage nose
def carriage_nose():
    body = box(W, T_C, NOSE_H, (-W / 2, -T_C, 0))
    t = C.slot_tool()
    for g in C.GR:
        body = body.cut(C.place_groove_tool(t, g))
    # magnet bosses (raised pads) then embedded pockets
    for (x, z) in MAG_POS:
        body = body.fuse(cyl(BOSS_R, PAD_TOP, (x, 0.0, z), (0, 1, 0)))
    for (x, z) in MAG_POS:
        top = PAD_TOP - SKIN
        body = body.cut(cyl(MAG_D / 2 + 0.1, MAG_L, (x, top - MAG_L, z), (0, 1, 0)))
    # pilot funnel + bore
    body = body.cut(cq.Solid.makeCone(BORE_D / 2, FUN_D / 2, FUN_DEPTH, V(CX, -FUN_DEPTH, CZ), V(0, 1, 0)))
    body = body.cut(cyl(BORE_D / 2, -BORE_FLOOR - FUN_DEPTH + 0.02, (CX, BORE_FLOOR, CZ), (0, 1, 0)))
    # tongue channel (runs up Z) + spring pocket + rod hole through the end wall
    cx = TONGUE_W / 2 + CH_CL
    body = body.cut(box(2 * cx, TT + 2 * CH_CL, CH_Z1 - CH_Z0, (-cx, TONGUE_BOT - CH_CL, CH_Z0)))
    body = body.cut(cyl(ROD_D / 2 + 0.2, 6.0, (CX, TONGUE_BOT + TT / 2 - 0.0 - 0, WALL_Z - 0.5), (0, 0, 1)))
    for (x, z) in C.MOUNT_HOLES:
        body = body.cut(cyl(1.7, T_C + 1, (x, -T_C - 0.5, z), (0, 1, 0)))
        body = body.cut(cq.Solid.makeCone(1.7, 3.2, 1.5, V(x, -1.5, z), V(0, 1, 0)))
    return body


# ------------------------------------------------------------------ tool plate
def tool_plate():
    body = box(W, T_T, C.H, (-W / 2, GAP, 0))
    for g in C.GR:
        c = (g["X"], C.Y_BALL, g["Z"])
        r = C.rb + C.BALL_CL
        body = body.cut(sph(r, c))
        body = body.cut(cyl(r, C.Y_BALL - GAP + 0.2, (c[0], GAP - 0.2, c[2]), (0, 1, 0)))
    # embedded magnets behind a skin
    for (x, z) in MAG_POS:
        body = body.cut(cyl(MAG_D / 2 + 0.1, MAG_L + 0.1, (x, GAP + SKIN, z), (0, 1, 0)))
    # stud pilot (M3 self-tapping) through the plate
    body = body.cut(cyl(1.3, T_T + 0.4, (CX, GAP - 0.2, CZ), (0, 1, 0)))
    for (x, z) in C.MOUNT_HOLES:
        body = body.cut(cyl(1.7, T_T + 1, (x, GAP - 0.5, z), (0, 1, 0)))
        body = body.cut(cq.Solid.makeCone(3.2, 1.7, 1.5, V(x, GAP, z), V(0, 1, 0)))
    return body


# ------------------------------------------------------------------ latch hardware
def stud(dx=0.0, dz=0.0, dy=0.0):
    x, z = CX + dx, CZ + dz
    neck = cyl(NECK_D / 2, (GAP + 6.5) - HEAD_TOP + dy, (x, HEAD_TOP, z), (0, 1, 0))
    head = cyl(HEAD_D / 2, HEAD_H - HEAD_CH, (x, HEAD_BOT + HEAD_CH + dy, z), (0, 1, 0))
    dome = cq.Solid.makeCone(HEAD_D / 2 - HEAD_CH, HEAD_D / 2, HEAD_CH, V(x, HEAD_BOT + dy, z), V(0, 1, 0))
    return neck.fuse(head).fuse(dome)


def head_only(dx=0.0, dz=0.0, dy=0.0):
    x, z = CX + dx, CZ + dz
    head = cyl(HEAD_D / 2, HEAD_H - HEAD_CH, (x, HEAD_BOT + HEAD_CH + dy, z), (0, 1, 0))
    dome = cq.Solid.makeCone(HEAD_D / 2 - HEAD_CH, HEAD_D / 2, HEAD_CH, V(x, HEAD_BOT + dy, z), V(0, 1, 0))
    return head.fuse(dome)


def tongue(z_h):
    """Keyhole tongue with its big hole centred on Z = z_h."""
    y0 = TONGUE_BOT
    body = box(TONGUE_W, TT, TONGUE_BELOW + TONGUE_ABOVE, (-TONGUE_W / 2, y0, z_h - TONGUE_BELOW))
    body = body.cut(cyl(HOLE_D / 2, TT + 0.2, (CX, y0 - 0.1, z_h), (0, 1, 0)))
    slot = box(SLOT_W, TT + 0.2, SLOT_LEN, (-SLOT_W / 2, y0 - 0.1, z_h))
    slot = slot.fuse(cyl(SLOT_W / 2, TT + 0.2, (CX, y0 - 0.1, z_h + SLOT_LEN), (0, 1, 0)))
    body = body.cut(slot)
    rod = cyl(ROD_D / 2, (WALL_Z + 8.0) - (z_h + TONGUE_ABOVE) + 1.0, (CX, y0 + TT / 2, z_h + TONGUE_ABOVE - 1.0), (0, 0, 1))
    return body, rod


def spring(z_h):
    """Visual envelope of the compression spring around the rod (tongue top end -> end wall)."""
    z0 = z_h + TONGUE_ABOVE
    return cyl(SPRING_OD / 2, WALL_Z - z0, (CX, TONGUE_BOT + TT / 2, z0), (0, 0, 1))


def magnets_carriage():
    return [cyl(MAG_D / 2, MAG_L, (x, PAD_TOP - SKIN - MAG_L, z), (0, 1, 0)) for (x, z) in MAG_POS]


def magnets_tool():
    return [cyl(MAG_D / 2, MAG_L, (x, GAP + SKIN, z), (0, 1, 0)) for (x, z) in MAG_POS]


# ------------------------------------------------------------------ checks
def vol(a, b):
    return C.vol(a, b)


def self_check():
    nose, tplate = carriage_nose(), tool_plate()
    t_open, rod_o = tongue(Z_OPEN)
    t_closed, rod_c = tongue(Z_CLOSED)
    print("Y levels: funnel to %.2f | tongue %.2f..%.2f | head retaining face %.2f, dome tip %.2f | bore floor %.2f"
          % (-FUN_DEPTH, TONGUE_BOT, TONGUE_TOP, HEAD_TOP, HEAD_BOT, BORE_FLOOR))
    print("stud: head Ø%.1f, shank exposed beyond tool face %.2f mm" % (HEAD_D, (GAP - HEAD_TOP) - HEAD_H + HEAD_H - HEAD_H))

    ok = True
    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("\nSEATED (stud centred):")
    h = head_only()
    chk("head clears the carriage nose (bore/funnel)", vol(h, nose) < 1e-6, "(%.4f)" % vol(h, nose))
    chk("closed tongue does not touch the seated head (0.2 mm gap)", vol(h, t_closed) < 1e-6)
    chk("neck sits in the closed slot without touching", vol(stud(), t_closed) - vol(h, t_closed) < 1e-6)
    print("RETENTION (closed tongue):")
    for rise in (0.15, 0.25, 0.40):
        v = vol(head_only(dy=rise), t_closed)
        chk("head raised %.2f mm -> %s" % (rise, "free (inside the 0.2 gap)" if rise < HEAD_GAP else "blocked by the tongue"),
            (v < 1e-6) if rise < HEAD_GAP else (v > 1e-3), "overlap %.3f mm3" % v)
    v = vol(head_only(dy=0.3), t_closed)
    area = v / (0.3 - HEAD_GAP)
    print("      lip engagement area on the head ~ %.1f mm2 (both sides)" % area)
    print("OPEN (hole on the axis), stud passes through with centring error:")
    for e in (0.0, 0.3, 0.5):
        worst = max(vol(head_only(dx=e * math.cos(a), dz=e * math.sin(a)), t_open)
                    for a in [k * math.pi / 4 for k in range(8)])
        chk("head vs open tongue at %.1f mm error" % e, worst < 1e-6, "(%.4f)" % worst)
    worst = max(vol(head_only(dx=0.6 * math.cos(a), dz=0.6 * math.sin(a)), nose) for a in [k * math.pi / 4 for k in range(8)])
    chk("negative control: head 0.6 mm off-centre DOES hit the bore wall", worst > 1e-4, "(%.3f)" % worst)
    print("FUNNEL capture of the stud (head at the carriage surface):")
    def rim_hit(e):
        worst = 0.0
        for a in [k * math.pi / 4 for k in range(8)]:
            # head bottom just below the surface plane so a rim strike would register
            w = vol(head_only(dx=e * math.cos(a), dz=e * math.sin(a), dy=-HEAD_BOT - 0.05), nose)
            worst = max(worst, w)
        return worst
    cap = FUN_D / 2 - HEAD_D / 2
    print("      funnel capture radius = mouth R - head R = %.2f mm" % cap)
    chk("2.5 mm error: head rim inside funnel mouth", 2.5 + HEAD_D / 2 <= FUN_D / 2, "(%.2f <= %.2f)" % (2.5 + HEAD_D / 2, FUN_D / 2))

    print("\nSTRUCTURE:")
    print("  nose / tongue channel overlap with the tongue (want 0): %.4f" % vol(nose, t_closed))
    print("  tool plate vs carriage nose, seated (want 0): %.4f" % vol(tplate, nose))
    print("  tool plate vs stud head (want 0): %.4f" % vol(tplate, h))
    dow = C.dowels()
    print("  dowels vs nose (want 0): %s" % ["%.3f" % vol(d, nose) for d in dow])
    print("  carriage magnets vs nose pockets (want 0): %s" % ["%.3f" % vol(m, nose) for m in magnets_carriage()])
    print("  tool magnets vs tool plate (want 0): %s" % ["%.3f" % vol(m, tplate) for m in magnets_tool()])
    gap_mag = (GAP + SKIN) - (PAD_TOP - SKIN)
    print("  magnet air gap incl. both skins: %.2f mm  (D6x6 pair ~7 N each at ~1.6 mm, x2)" % gap_mag)

    print("\nPRINTED WALLS (mm, want >= ~1):")
    t = C.slot_tool()
    slots = [C.place_groove_tool(t, g) for g in C.GR]
    funnel = cq.Solid.makeCone(BORE_D / 2, FUN_D / 2, FUN_DEPTH, V(CX, -FUN_DEPTH, CZ), V(0, 1, 0))
    pocket = [cyl(MAG_D / 2 + 0.1, MAG_L, (x, PAD_TOP - SKIN - MAG_L, z), (0, 1, 0)) for (x, z) in MAG_POS]
    boss = [cyl(BOSS_R, PAD_TOP, (x, 0.0, z), (0, 1, 0)) for (x, z) in MAG_POS]
    chan = box(TONGUE_W + 2 * CH_CL, TT + 2 * CH_CL, CH_Z1 - CH_Z0, (-(TONGUE_W / 2 + CH_CL), TONGUE_BOT - CH_CL, CH_Z0))
    print("  funnel to dowel slots      : %.2f" % min(funnel.distance(s) for s in slots))
    print("  boss to dowel slots        : %.2f" % min(b.distance(s) for b in boss for s in slots))
    print("  boss to funnel             : %.2f" % min(b.distance(funnel) for b in boss))
    print("  boss to boss               : %.2f" % min(boss[i].distance(boss[j]) for i in range(len(boss)) for j in range(i + 1, len(boss))))
    print("  channel to dowel slots     : %.2f" % min(chan.distance(s) for s in slots))
    print("  channel to magnet pockets  : %.2f" % min(chan.distance(p) for p in pocket))
    bb = [b.BoundingBox() for b in boss]
    print("  boss to plate edges        : %.2f" % min(min(15 - max(abs(q.xmin), abs(q.xmax)), q.zmin, 30 - q.zmax) for q in bb))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    out = os.path.dirname(os.path.abspath(__file__))
    nose, tplate = carriage_nose(), tool_plate()
    to, ro = tongue(Z_OPEN)
    tc, rc = tongue(Z_CLOSED)
    parts = {"carriage_nose": nose, "tool_plate": tplate, "stud": stud(),
             "tongue_closed": tc, "tongue_open": to}
    for name, obj in parts.items():
        obj.exportStep(os.path.join(out, name + ".step"))
        obj.exportStl(os.path.join(out, name + ".stl"))
        print("wrote %-15s volume %.0f mm3" % (name, obj.Volume()))
    self_check()
