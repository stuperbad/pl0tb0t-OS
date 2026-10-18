"""Section drawings of the v2 coupling, cut straight from the CAD (not hand-drawn).

  coupling_face.png    face-on cut through the carriage plate at Y=+0.6 (above the plate surface,
                       through the dowels) with the tool-side balls overlaid
  coupling_section.png cut ACROSS the top V-groove (plane Z = ball Z): dowels, ball, both plates,
                       seated, plus the ball shown at the +2.5 mm lateral-error pickup position
"""
import os, math
import numpy as np
import trimesh
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cadquery as cq
import kinematic_seats as C

out = os.path.dirname(os.path.abspath(__file__))


def mesh_of(shape, name, tol=0.03):
    p = os.path.join(out, "_tmp_" + name + ".stl")
    shape.exportStl(p, tolerance=tol, angularTolerance=0.1)
    m = trimesh.load(p)
    os.remove(p)
    return m


def section_lines(mesh, origin, normal):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None:
        return []
    return [np.asarray(l) for l in sec.discrete]


carriage = mesh_of(C.carriage_plate(), "c")
tool = mesh_of(C.tool_plate(), "t")
dow = [mesh_of(d, "d%d" % i) for i, d in enumerate(C.dowels())]
bal = [mesh_of(b, "b%d" % i) for i, b in enumerate(C.balls())]


def poly(ax, lines, xi, yi, **kw):
    for l in lines:
        ax.plot(l[:, xi], l[:, yi], **kw)


# ------------------------------------------------ face-on, Y = +0.6
fig, ax = plt.subplots(figsize=(7.2, 7.2))
Y0 = 0.6
poly(ax, section_lines(carriage, (0, Y0, 0), (0, 1, 0)), 0, 2, color="#555", lw=1.2)
for d in dow:
    poly(ax, section_lines(d, (0, Y0, 0), (0, 1, 0)), 0, 2, color="#1b5fa8", lw=1.6)
# balls are on the tool side: draw their footprint at the seated height as dashed circles
for g in C.GR:
    ax.add_patch(plt.Circle((g["X"], g["Z"]), C.rb, fill=False, ec="#d9731a", lw=1.6, ls="--"))
    ax.annotate("ball", (g["X"], g["Z"]), ha="center", va="center", fontsize=7, color="#d9731a")
    # groove axis
    ax.plot([g["X"] - g["d"][0] * 4, g["X"] + g["d"][0] * 4], [g["Z"] - g["d"][1] * 4, g["Z"] + g["d"][1] * 4],
            color="#bbb", lw=0.8, ls=":")
ax.add_patch(plt.Circle((C.CX, C.CZ), C.MAG_D / 2, fill=False, ec="#9a1c1c", lw=1.6))
ax.annotate("magnet\nØ10×3", (C.CX, C.CZ), ha="center", va="center", fontsize=8, color="#9a1c1c")
for (x, z) in C.MOUNT_HOLES:
    ax.add_patch(plt.Circle((x, z), 1.7, fill=False, ec="#777", lw=1.0))
ax.plot([-15, 15, 15, -15, -15], [0, 0, 30, 30, 0], color="#999", lw=0.8)
ax.set_aspect("equal"); ax.set_xlim(-17, 17); ax.set_ylim(-2, 32)
ax.set_xlabel("X across the 30 mm face (mm)"); ax.set_ylabel("Z up the face (mm)")
ax.set_title("Carriage plate, face-on (cut at Y=+0.6, through the dowels)\n"
             "blue = 6 dowels, dashed = tool-side balls, red = magnet", fontsize=10)
fig.tight_layout(); fig.savefig(os.path.join(out, "coupling_face.png"), dpi=150); plt.close(fig)

# ------------------------------------------------ section across the top V-groove
g0 = C.GR[0]
Z0 = g0["Z"]
fig, ax = plt.subplots(figsize=(8.2, 6.2))
poly(ax, section_lines(carriage, (0, 0, Z0), (0, 0, 1)), 0, 1, color="#444", lw=1.3)
poly(ax, section_lines(tool, (0, 0, Z0), (0, 0, 1)), 0, 1, color="#2e7d32", lw=1.3)
for d in dow[:2]:
    poly(ax, section_lines(d, (0, 0, Z0), (0, 0, 1)), 0, 1, color="#1b5fa8", lw=2.0)
for b, gg in zip(bal, C.GR):
    if abs(gg["Z"] - Z0) < 1e-6:
        poly(ax, section_lines(b, (0, 0, Z0), (0, 0, 1)), 0, 1, color="#d9731a", lw=2.0)
# the same ball at the pickup position with +2.5 mm lateral error and 1.25 mm above seated
e = 2.5
yfirst = -C.DELTA + math.sqrt((C.rb + C.rd) ** 2 - (C.S / 2 - e) ** 2)
th = np.linspace(0, 2 * np.pi, 200)
ax.plot(g0["X"] + e * g0["n"][0] + C.rb * np.cos(th), yfirst + C.rb * np.sin(th),
        color="#d9731a", lw=1.2, ls="--")
ax.annotate("ghost ball: first contact at 2.5 mm lateral\nerror (the tool plate is higher then)", (-8.6, 5.4), fontsize=8, color="#d9731a")
ax.annotate("seated", (0, C.Y_BALL + 0.0), ha="center", va="center", fontsize=8, color="#d9731a")
ax.set_aspect("equal"); ax.set_xlim(-9, 9); ax.set_ylim(-4.5, 6.5)
ax.axhline(0, color="#aaa", lw=0.6)
ax.set_xlabel("across the groove (mm)"); ax.set_ylabel("insertion axis Y (mm)   carriage surface = 0")
ax.set_title("Cut across the top V-groove: Ø4 ball seated on two Ø3 dowels\n"
             "grey = carriage plate, green = tool plate, blue = dowels, orange = ball")
fig.tight_layout(); fig.savefig(os.path.join(out, "coupling_section.png"), dpi=150); plt.close(fig)
print("wrote coupling_face.png, coupling_section.png")
