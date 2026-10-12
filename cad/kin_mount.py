"""Parametric kinematic pen-holder mount (first draft, NOT yet fitted to the real parts).

Coordinates: carriage seat plate top face is z = 0, solid below it.  The holder
approaches from +z moving in -z (this is the machine's Y insertion axis, drawn as
z here so the face lies in XY).  Three steel-ball-ended pins on the holder land in
a Kelvin seat set on the carriage:

    P1  cone      3 DOF   (captures lateral error in any direction)
    P2  V-groove  2 DOF   (groove axis runs P2 -> P1)
    P3  flat      1 DOF   (flat-bottomed pocket, captures by its size)

Every number below is a parameter.  Run this file to rebuild and self-check.
"""
import math
import cadquery as cq

# ---- parameters (mm) -------------------------------------------------------
FACE = 30.0            # square tool face
PLATE_T = 8.0          # carriage seat plate thickness
HOLDER_T = 6.0         # holder pin plate thickness
BALL_D = 3.0           # pin tip ball diameter (steel)
MOUTH_D = 8.0          # cone / V mouth diameter at the face
HALF_ANGLE = 45.0      # seat half-angle
PIN_L = 2.2            # hemisphere centre -> holder face (sets seated face gap)
FLAT_D = 12.0          # flat pocket diameter
TRI_R = 9.0            # pins sit on a circle of this radius about the face centre
POCKET_D = BALL_D + 0.15   # pin hole in the holder (glue fit)
V_HALF_LEN = 8.0        # V-groove half length along its axis (P2 sits in the middle)

r = BALL_D / 2.0
R = MOUTH_D / 2.0
a = math.radians(HALF_ANGLE)
DEPTH = R / math.tan(a)                       # apex depth below the face
CENTRE_Z = r / math.sin(a) - DEPTH            # seated ball-centre z (negative)
GAP = CENTRE_Z + PIN_L                        # seated face-to-face gap

# pin positions on a triangle (P1 cone at 90 deg, P2 V at 210, P3 flat at 330)
def pt(deg):
    return (TRI_R * math.cos(math.radians(deg)), TRI_R * math.sin(math.radians(deg)))
P1, P2, P3 = pt(90), pt(210), pt(330)


def seat_plate():
    body = cq.Workplane("XY").box(FACE, FACE, PLATE_T, centered=(True, True, False)) \
        .translate((0, 0, -PLATE_T))
    # P1 cone: apex at z=-DEPTH, mouth radius R at z=0
    cone = cq.Solid.makeCone(0.0, R, DEPTH, pnt=cq.Vector(P1[0], P1[1], -DEPTH), dir=cq.Vector(0, 0, 1))
    body = body.cut(cq.Workplane("XY").add(cone))
    # P2 V-groove: 2*HALF_ANGLE included, axis from P2 toward P1
    ang = math.degrees(math.atan2(P1[1] - P2[1], P1[0] - P2[0]))
    vee = (cq.Workplane("XZ").polyline([(-R, 0), (R, 0), (0, -DEPTH)]).close()
           .extrude(V_HALF_LEN, both=True))                # short groove centred on P2; it must
    #                                                  never reach the cone seat at P1
    vee = vee.rotate((0, 0, 0), (0, 0, 1), ang - 90.0).translate((P2[0], P2[1], 0))
    body = body.cut(vee)
    # P3 flat: counterbore down to the ball-bottom plane
    flat_z = CENTRE_Z - r
    pocket = cq.Workplane("XY").circle(FLAT_D / 2).extrude(-flat_z).translate((P3[0], P3[1], flat_z))
    body = body.cut(pocket)
    return body


def pin(x, y, dz=0.0, dx=0.0, dy=0.0):
    """Ball-ended pin, tip-ball centre at the seated height + offsets."""
    cz = CENTRE_Z + dz
    ball = cq.Workplane("XY").sphere(r).translate((x + dx, y + dy, cz))
    stem = cq.Workplane("XY").circle(r).extrude(PIN_L).translate((x + dx, y + dy, cz))
    return ball.union(stem)


def holder_plate():
    face_z = CENTRE_Z + PIN_L
    plate = cq.Workplane("XY").box(FACE, FACE, HOLDER_T, centered=(True, True, False)).translate((0, 0, face_z))
    for (x, y) in (P1, P2, P3):
        hole = cq.Workplane("XY").circle(POCKET_D / 2).extrude(HOLDER_T).translate((x, y, face_z))
        plate = plate.cut(hole)
    return plate


def overlap(a_, b_):
    try:
        return a_.intersect(b_).val().Volume()
    except Exception:
        return 0.0


def self_check():
    seat = seat_plate()
    print("seat depth (apex below face): %.3f   seated ball-centre z: %.3f   seated face gap: %.3f mm"
          % (DEPTH, CENTRE_Z, GAP))
    assert GAP > 0.1, "faces would touch when seated - raise PIN_L"
    seated = [pin(*p) for p in (P1, P2, P3)]
    vols = [overlap(s, seat) for s in seated]
    print("seated pin/plate interference volumes (should be ~0): %s" % ["%.4f" % v for v in vols])

    # lateral capture: descend the cone pin at offset d; find height where the ball first hits the plate
    import itertools
    def first_hit(d, direction):
        dx, dy = d * math.cos(direction), d * math.sin(direction)
        z = 3.0
        while z > CENTRE_Z - 0.01:
            p = pin(P1[0], P1[1], dz=z - CENTRE_Z, dx=dx, dy=dy)
            if overlap(p, seat) > 1e-4:
                return z
            z -= 0.05
        return None
    for d in (1.0, 2.0, 2.4):
        hits = [first_hit(d, math.radians(k)) for k in (0, 90, 180, 270)]
        print("cone pin offset %.1f mm: ball centre first touches at z = %s  (rim is z=0)" % (d, hits))
    print("capture (conservative clear-entry) = mouth radius - ball radius = %.2f mm" % (R - r))


if __name__ == "__main__":
    import os
    out = os.path.dirname(os.path.abspath(__file__))
    seat = seat_plate()
    holder = holder_plate()
    pins = pin(*P1).union(pin(*P2)).union(pin(*P3))
    for name, obj in (("seat_plate", seat), ("holder_plate", holder), ("pins", pins)):
        cq.exporters.export(obj, os.path.join(out, name + ".step"))
        cq.exporters.export(obj, os.path.join(out, name + ".stl"))
        print("wrote", name, ".step/.stl   volume %.1f mm^3" % obj.val().Volume())
    self_check()
