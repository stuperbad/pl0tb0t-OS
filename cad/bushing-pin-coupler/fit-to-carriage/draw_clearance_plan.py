"""Plan view at Z = 5 (through the slide-in height): holder + pen base outline, the ledge seated, and the ledge at the +/-2 mm error extremes."""
import os, numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cadquery as cq
import fit as F

here = os.path.dirname(os.path.abspath(__file__))


def mesh(shape, tol=0.04):
    p = os.path.join(here, "_t.stl"); shape.exportStl(p, tolerance=tol, angularTolerance=0.2)
    m = trimesh.load(p); os.remove(p); return m


s = F.load()
hn = mesh(F.holder_new(s[0])); base = mesh(s[1])
pts = F.ledge_pts()
fig, ax = plt.subplots(figsize=(11, 10))
for m, col, lab in ((hn, "#1b9e8a", "pen holder (with notch)"), (base, "#888888", "pen base")):
    sec = m.section(plane_origin=(0, 0, 5.0), plane_normal=(0, 0, 1))
    for l in sec.discrete:
        ax.plot(l[:, 0], l[:, 1], color=col, lw=1.6, label=lab)
poly = np.array(pts + [pts[0]])
ax.plot(poly[:, 0], poly[:, 1], color="#e8963a", lw=2.4, label="ledge, seated")
for dx, dy in ((-2, -2), (2, -2), (-2, 2), (2, 2)):
    ax.plot(poly[:, 0] + dx, poly[:, 1] + dy, color="#e8963a", lw=1.0, ls="--", label="ledge at +/-2 mm error")
for x in F.PINS_X:
    ax.add_patch(plt.Circle((x, F.CY_PIN), F.FUN_R_MOUTH, fill=False, ec="#2b4c7e", lw=1.2, label="funnel mouth (3.5 R)"))
ax.add_patch(plt.Circle((0, F.CY_MAG), F.MAG_D / 2, fill=False, ec="#a32b2b", lw=1.2, label="magnet pocket"))
ax.axhline(F.FACE_Y, color="#aaa", lw=0.6, ls=":"); ax.text(-24, F.FACE_Y + 0.3, "holder rear face", fontsize=8, color="#777")
ax.axhline(F.FACE_Y - F.GAP_F, color="#aaa", lw=0.6, ls=":"); ax.text(-24, F.FACE_Y - F.GAP_F - 1.0, "carriage face (seated)", fontsize=8, color="#777")
h, l = ax.get_legend_handles_labels(); d = dict(zip(l, h)); ax.legend(d.values(), d.keys(), loc="upper right", fontsize=8)
ax.set_xlim(-25, 25); ax.set_ylim(-20, 12); ax.set_aspect("equal"); ax.grid(alpha=.3)
ax.set_title("Plan view at Z = 5: the ledge (orange) at its seated position and at the four +/-2 mm corner errors\n(dashed never touches the holder or base)")
fig.tight_layout(); fig.savefig(os.path.join(here, "clearance_plan.png"), dpi=70); print("ok")
