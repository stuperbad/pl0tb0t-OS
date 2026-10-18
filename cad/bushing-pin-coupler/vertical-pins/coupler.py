"""Bushing-pin coupler, VERTICAL pins (tool hangs below the carriage).

Carriage block sits on top; two 3 mm hardened dowels point DOWN out of it.  The tool block under it holds
the same 5 mm bronze bushings (3 ID x 5 OD x 5 L, two stacked per pin = 10 mm of bearing), each with a big
printed 45-degree funnel.  The flat faces set the height, ONE D6x6 magnet per part pulls them together.

Z is up.  Seat plane Z = 0.  Carriage block above it, tool block below it.  Run to rebuild + self-check.
Footprint (X x Y) is a placeholder until it is fitted to the real carriage and pen holder.
"""
import math, os
import cadquery as cq

V = cq.Vector

# ------------------------------------------------------------------ parameters
LX, LY = 40.0, 24.0                # footprint: X holds the pin line, Y is the short side
T_C = 14.0                         # carriage block height (above the seat plane)
PIN_SP = 20.0                      # pin spacing along X
PIN_D, PIN_L, PIN_EMBED, TIP_CH = 3.0, 20.0, 6.5, 0.5
PIN_P = PIN_L - PIN_EMBED          # protrusion below the seat plane = 13.5
PIN_HOLE_D = 3.05
BUSH_ID, BUSH_OD, BUSH_L, BUSH_N = 3.0, 5.0, 5.0, 2   # BUSH_N bushings stacked per pin
BUSH_POCKET_D = BUSH_OD + 0.1
BUSH_STACK = BUSH_L * BUSH_N
FUN_R_MOUTH, FUN_R_BOT = 4.5, 2.0
FUN_DEPTH = FUN_R_MOUTH - FUN_R_BOT
RELIEF_D, RELIEF_L = 3.4, 1.5
FLOOR = 1.2
T_T = FUN_DEPTH + BUSH_STACK + RELIEF_L + FLOOR       # tool block height (below the seat plane)
MAG_D, MAG_L, MAG_CL = 6.0, 6.0, 0.2
SKIN = 1.0
EDGE_FILLET, FACE_CH, BACK_FILLET = 3.0, 1.0, 1.5
PINS_X = (-PIN_SP / 2, PIN_SP / 2)


def cyl(r, h, pos, d):
    return cq.Solid.makeCylinder(r, h, V(*pos), V(*d))


def cone(r1, r2, h, pos, d):
    return cq.Solid.makeCone(r1, r2, h, V(*pos), V(*d))


UP, DOWN = (0, 0, 1), (0, 0, -1)


def vol(a, b):
    try:
        return a.intersect(b).Volume()
    except Exception:
        return 0.0


def block(z0, t, rear, face):
    b = cq.Workplane("XY").box(LX, LY, t, centered=False).translate((-LX / 2, -LY / 2, z0))
    b = b.edges("|Z").fillet(EDGE_FILLET)
    b = b.faces(rear).edges().fillet(BACK_FILLET)
    b = b.faces(face).edges().chamfer(FACE_CH)
    return b.val()


def carriage_block():
    body = block(0.0, T_C, ">Z", "<Z")
    for x in PINS_X:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (x, 0, PIN_EMBED), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, 0, SKIN), UP))
    return body


def tool_block():
    body = block(-T_T, T_T, "<Z", ">Z")
    for x in PINS_X:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (x, 0, 0.2), DOWN))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, 0, -FUN_DEPTH), DOWN))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (x, 0, -FUN_DEPTH - BUSH_STACK), DOWN))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, 0, -SKIN), DOWN))
    return body


# ------------------------------------------------------------------ hardware
def pin(x, dx=0.0, dy=0.0, dz=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_CH, (x + dx, dy, PIN_EMBED + dz), DOWN)
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_CH, TIP_CH, (x + dx, dy, -(PIN_P - TIP_CH) + dz), DOWN)
    return p.fuse(t)


def pins():
    return [pin(x) for x in PINS_X]


def bushings():
    out = []
    for x in PINS_X:
        for k in range(BUSH_N):
            z = -FUN_DEPTH - k * BUSH_L
            out.append(cyl(BUSH_OD / 2, BUSH_L, (x, 0, z), DOWN).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (x, 0, z + 0.1), DOWN)))
    return out


def magnet_carriage():
    return cyl(MAG_D / 2, MAG_L, (0, 0, SKIN), UP)


def magnet_tool():
    return cyl(MAG_D / 2, MAG_L, (0, 0, -SKIN), DOWN)


# ------------------------------------------------------------------ check
def self_check():
    cb, tb = carriage_block(), tool_block()
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("SEATED:")
    chk("pins clear the tool block (only inside the bushings)", all(vol(p, tb) < 1e-3 for p in pins()))
    chk("pins sit in the carriage holes", all(vol(p, cb) < 1e-3 for p in pins()))
    chk("bushings clear the printed pockets", all(vol(b, tb) < 1e-3 for b in bushings()))
    chk("pin tip stays in the relief", FUN_DEPTH + BUSH_STACK < PIN_P < FUN_DEPTH + BUSH_STACK + RELIEF_L - 0.2,
        "(tip %.1f, bushings end %.1f, relief ends %.1f)" % (PIN_P, FUN_DEPTH + BUSH_STACK, FUN_DEPTH + BUSH_STACK + RELIEF_L))
    chk("magnets clear their cavities", vol(magnet_carriage(), cb) < 1e-3 and vol(magnet_tool(), tb) < 1e-3)
    chk("carriage block / tool block do not overlap", vol(cb, tb) < 1e-3)
    print("  magnet air gap = 2 x skin = %.2f mm; bearing length per pin = %.0f mm = %.1f pin diameters"
          % (2 * SKIN, BUSH_STACK, BUSH_STACK / PIN_D))

    print("FUNNEL CAPTURE (tip 0.2 mm below the seat plane, pins offset sideways together):")
    print("  mouth R %.1f - pin R %.1f = %.2f mm lateral capture (asked: 2.0)" % (FUN_R_MOUTH, PIN_D / 2, FUN_R_MOUTH - PIN_D / 2))
    for e in (1.0, 2.0, 2.5):
        worst = 0.0
        for a in range(0, 360, 45):
            dx, dy = e * math.cos(math.radians(a)), e * math.sin(math.radians(a))
            worst = max(worst, max(vol(pin(x, dx, dy, dz=PIN_P - 0.2), tb) for x in PINS_X))
        chk("%.1f mm error: pin tips enter the mouth freely" % e, worst < 1e-3, "(%.4f)" % worst)
    worst = max(vol(pin(x, 3.6, 0, dz=PIN_P - 0.2), tb) for x in PINS_X)
    chk("negative control: 3.6 mm error DOES hit the face", worst > 1e-3, "(%.4f)" % worst)

    print("PRINTED WALLS (mm):")
    mag_c = cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (0, 0, -SKIN), DOWN)
    funs = [cone(FUN_R_MOUTH, FUN_R_BOT, FUN_DEPTH, (x, 0, 0), DOWN) for x in PINS_X]
    pocks = [cyl(BUSH_POCKET_D / 2, BUSH_STACK, (x, 0, -FUN_DEPTH), DOWN) for x in PINS_X]
    print("  magnet cavity to funnels      : %.2f" % min(mag_c.distance(f) for f in funs))
    print("  magnet cavity to bushing seats: %.2f" % min(mag_c.distance(p) for p in pocks))
    print("  funnel mouth to side wall (Y) : %.2f" % (LY / 2 - FUN_R_MOUTH))
    print("  funnel mouth to end (X)       : %.2f" % (LX / 2 - PIN_SP / 2 - FUN_R_MOUTH))
    print("  tool block floor under relief : %.2f" % FLOOR)
    print("  carriage: pin hole end to top : %.2f" % (T_C - PIN_EMBED))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    out = os.path.dirname(os.path.abspath(__file__))
    for name, obj in {"carriage_block": carriage_block(), "tool_block": tool_block()}.items():
        obj.exportStep(os.path.join(out, name + ".step"))
        obj.exportStl(os.path.join(out, name + ".stl"))
        print("wrote %-15s volume %.0f mm3" % (name, obj.Volume()))
    cq.Compound.makeCompound(pins() + bushings() + [magnet_carriage(), magnet_tool()]).exportStep(os.path.join(out, "hardware.step"))
    self_check()
