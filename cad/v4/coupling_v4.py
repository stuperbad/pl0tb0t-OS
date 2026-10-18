"""pl0tb0t tool coupling v4 -- two steel pins into two bronze bushings, one magnet, big printed funnels.

No actuator, no latch.  Pins locate XY, the flat faces locate the seat plane, ONE D6x6 magnet per part holds it.
Mating axis is Y (carriage behind Y=0, tool in front); mount it with Y pointing wherever the machine needs.

  carriage block : 2 x 3 mm hardened dowel (14 mm, 6 mm glued in, 8 mm sticking out) + 1 magnet behind a skin
  tool block     : 2 x bushing 3 ID x 5 OD x 5 L (glued in) with 45-degree printed funnels + 1 magnet behind a skin

Assembly trick: glue the bushings while the tool block is plugged onto the pins, so tolerances cancel.
All dimensions mm.  Run to rebuild the STEP/STL files and print the self-check.
"""
import math, os
import cadquery as cq

V = cq.Vector

# ------------------------------------------------------------------ parameters
W, H = 28.0, 40.0                  # face size (X across, Z along the pin line)
CX, CZ = 0.0, 20.0                 # centre of the face
T_C, T_T = 14.0, 10.0              # carriage / tool block thickness
PIN_SP = 20.0                      # pin spacing along Z
PIN_D, PIN_L, PIN_EMBED, TIP_CH = 3.0, 14.0, 6.0, 0.5
PIN_P = PIN_L - PIN_EMBED          # protrusion past the carriage face = 8.0
PIN_HOLE_D = 3.05                  # glued pin hole in the carriage
BUSH_ID, BUSH_OD, BUSH_L = 3.0, 5.0, 5.0
BUSH_POCKET_D = BUSH_OD + 0.1
FUN_R_MOUTH, FUN_R_BOT = 4.5, 2.0  # funnel: mouth radius 4.5 -> 2.0 at 45 deg
FUN_DEPTH = FUN_R_MOUTH - FUN_R_BOT
RELIEF_D, RELIEF_L = 3.4, 1.2      # blind relief behind each bushing for the pin tip
MAG_D, MAG_L, MAG_CL = 6.0, 6.0, 0.2
SKIN = 1.0                         # printed skin over each magnet -> 2 x SKIN air gap
EDGE_FILLET, FACE_CH, BACK_FILLET = 3.0, 1.0, 1.5

PINS_Z = (CZ - PIN_SP / 2, CZ + PIN_SP / 2)


def cyl(r, h, pos, d=(0, 1, 0)):
    return cq.Solid.makeCylinder(r, h, V(*pos), V(*d))


def cone(r1, r2, h, pos, d=(0, 1, 0)):
    return cq.Solid.makeCone(r1, r2, h, V(*pos), V(*d))


def vol(a, b):
    try:
        return a.intersect(b).Volume()
    except Exception:
        return 0.0


def block(y0, t, rear_is_neg):
    b = cq.Workplane("XY").box(W, t, H, centered=False).translate((CX - W / 2, y0, CZ - H / 2))
    b = b.edges("|Y").fillet(EDGE_FILLET)
    rear = "<Y" if rear_is_neg else ">Y"
    face = ">Y" if rear_is_neg else "<Y"
    b = b.faces(rear).edges().fillet(BACK_FILLET)
    b = b.faces(face).edges().chamfer(FACE_CH)
    return b.val()


# ------------------------------------------------------------------ printed parts
def carriage_block():
    body = block(-T_C, T_C, True)
    for z in PINS_Z:
        body = body.cut(cyl(PIN_HOLE_D / 2, PIN_EMBED + 0.2, (CX, -PIN_EMBED, z)))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (CX, -SKIN - MAG_L - MAG_CL, CZ)))
    return body


def tool_block():
    body = block(0.0, T_T, False)
    for z in PINS_Z:
        body = body.cut(cone(FUN_R_MOUTH + 0.2, FUN_R_BOT, FUN_DEPTH + 0.2, (CX, -0.2, z)))
        body = body.cut(cyl(BUSH_POCKET_D / 2, BUSH_L, (CX, FUN_DEPTH, z)))
        body = body.cut(cyl(RELIEF_D / 2, RELIEF_L + 0.01, (CX, FUN_DEPTH + BUSH_L, z)))
    body = body.cut(cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (CX, SKIN, CZ)))
    return body


# ------------------------------------------------------------------ hardware
def pin(z, dx=0.0, dz=0.0, dy=0.0):
    p = cyl(PIN_D / 2, PIN_L - TIP_CH, (CX + dx, -PIN_EMBED + dy, z + dz))
    t = cone(PIN_D / 2, PIN_D / 2 - TIP_CH, TIP_CH, (CX + dx, PIN_P - TIP_CH + dy, z + dz))
    return p.fuse(t)


def pins():
    return [pin(z) for z in PINS_Z]


def bushings():
    out = []
    for z in PINS_Z:
        out.append(cyl(BUSH_OD / 2, BUSH_L, (CX, FUN_DEPTH, z)).cut(cyl(BUSH_ID / 2, BUSH_L + 0.2, (CX, FUN_DEPTH - 0.1, z))))
    return out


def magnet_carriage():
    return cyl(MAG_D / 2, MAG_L, (CX, -SKIN - MAG_L, CZ))


def magnet_tool():
    return cyl(MAG_D / 2, MAG_L, (CX, SKIN, CZ))


# ------------------------------------------------------------------ check
def self_check():
    cb, tb = carriage_block(), tool_block()
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print("  [%s] %s %s" % ("PASS" if cond else "FAIL", label, detail))

    print("SEATED:")
    chk("pins clear the tool block (only inside the bushings)",
        all(vol(p, tb) < 1e-3 for p in pins()), "%s" % ["%.4f" % vol(p, tb) for p in pins()])
    chk("pins sit in the carriage holes", all(vol(p, cb) < 1e-3 for p in pins()))
    chk("bushings clear the printed pockets", all(vol(b, tb) < 1e-3 for b in bushings()))
    chk("pin tip stays clear of the pocket floor", PIN_P < FUN_DEPTH + BUSH_L + RELIEF_L - 0.3,
        "(tip %.1f, floor %.1f)" % (PIN_P, FUN_DEPTH + BUSH_L + RELIEF_L))
    chk("magnets clear their cavities", vol(magnet_carriage(), cb) < 1e-3 and vol(magnet_tool(), tb) < 1e-3)
    chk("carriage block / tool block do not overlap", vol(cb, tb) < 1e-3)
    print("  magnet air gap = 2 x skin = %.2f mm" % (2 * SKIN))

    print("FUNNEL CAPTURE (tip 0.2 mm inside the face, pins offset together):")
    cap = FUN_R_MOUTH - PIN_D / 2
    print("  mouth R %.1f - pin R %.1f = %.2f mm lateral capture (you asked for 2.0)" % (FUN_R_MOUTH, PIN_D / 2, cap))
    for e in (1.0, 2.0, 2.5):
        worst = 0.0
        for a in range(0, 360, 45):
            dx, dz = e * math.cos(math.radians(a)), e * math.sin(math.radians(a))
            # pins carried by the carriage; carriage pulled back so the tip is 0.2 mm inside the tool face
            worst = max(worst, max(vol(pin(z, dx, dz, dy=0.2 - PIN_P), tb) for z in PINS_Z))
        chk("%.1f mm error: pin tips enter the mouth freely" % e, worst < 1e-3, "(%.4f)" % worst)
    worst = max(vol(pin(z, 3.6, 0, dy=0.2 - PIN_P), tb) for z in PINS_Z)
    chk("negative control: 3.6 mm error DOES hit the face", worst > 1e-3, "(%.4f)" % worst)
    print("  pin-to-bushing centring play after the cone: %.2f mm (bore entry R %.1f vs tip flat R %.1f)"
          % (FUN_R_BOT - PIN_D / 2, PIN_D / 2, PIN_D / 2 - TIP_CH))

    print("PRINTED WALLS (mm):")
    mag_c = cyl(MAG_D / 2 + MAG_CL / 2, MAG_L + MAG_CL, (CX, SKIN, CZ))
    funs = [cone(FUN_R_MOUTH, FUN_R_BOT, FUN_DEPTH, (CX, 0, z)) for z in PINS_Z]
    pocks = [cyl(BUSH_POCKET_D / 2, BUSH_L, (CX, FUN_DEPTH, z)) for z in PINS_Z]
    print("  magnet cavity to funnels      : %.2f" % min(mag_c.distance(f) for f in funs))
    print("  magnet cavity to bushing seats: %.2f" % min(mag_c.distance(p) for p in pocks))
    print("  funnel mouth to block edge (X): %.2f" % (W / 2 - FUN_R_MOUTH))
    print("  funnel mouth to block end (Z) : %.2f" % (PINS_Z[0] - FUN_R_MOUTH - (CZ - H / 2)))
    print("  bushing seat to back face     : %.2f" % (T_T - (FUN_DEPTH + BUSH_L + RELIEF_L)))
    print("  carriage: pin hole end to back: %.2f" % (T_C - PIN_EMBED))
    print("\nALL CHECKED ITEMS PASS" if ok else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    out = os.path.dirname(os.path.abspath(__file__))
    parts = {"carriage_block": carriage_block(), "tool_block": tool_block()}
    for name, obj in parts.items():
        obj.exportStep(os.path.join(out, name + ".step"))
        obj.exportStl(os.path.join(out, name + ".stl"))
        print("wrote %-15s volume %.0f mm3" % (name, obj.Volume()))
    cq.Compound.makeCompound(pins() + bushings() + [magnet_carriage(), magnet_tool()]).exportStep(os.path.join(out, "hardware.step"))
    self_check()
