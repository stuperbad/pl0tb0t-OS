"""Before/after sections through the old magnet-pocket rows, to check the cleanup (grey = original STEP, colour = rev 3)."""
import os, numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import fit as F

here = os.path.dirname(os.path.abspath(__file__))


def mesh(shape, tol=0.03):
    p = os.path.join(here, "_t.stl"); shape.exportStl(p, tolerance=tol, angularTolerance=0.15)
    m = trimesh.load(p); os.remove(p); return m


s = F.load()
h_old, c_old = mesh(s[0]), mesh(s[2])
h_new, c_new = mesh(F.clean_holder(s[0])), mesh(F.clean_carriage(s[2]))
fig, axs = plt.subplots(2, 2, figsize=(18, 14))
for ax, (old, new, z, title, xr, yr) in zip(axs.flat, [
        (h_old, h_new, 25.0, "holder, cut Z = 25 (old pocket row + front bores)", (-17, 17), (-12, 34)),
        (h_old, h_new, 5.0, "holder, cut Z = 5 (before the notch removes this part)", (-17, 17), (-12, 34)),
        (c_old, c_new, 25.0, "carriage, cut Z = 25", (-17, 17), (-30, -8)),
        (c_old, c_new, 5.0, "carriage, cut Z = 5", (-17, 17), (-30, -8))]):
    for m, col, lw, lab in ((old, "#bbbbbb", 3.0, "original"), (new, "#c0392b", 1.0, "cleaned")):
        sec = m.section(plane_origin=(0, 0, z), plane_normal=(0, 0, 1))
        for l in sec.discrete:
            ax.plot(l[:, 0], l[:, 1], color=col, lw=lw, label=lab)
    h, l = ax.get_legend_handles_labels(); d = dict(zip(l, h)); ax.legend(d.values(), d.keys())
    ax.set_xlim(*xr); ax.set_ylim(*yr); ax.set_aspect("equal"); ax.grid(alpha=.3); ax.set_title(title); ax.set_xlabel("X"); ax.set_ylabel("Y")
fig.tight_layout(); fig.savefig(os.path.join(here, "cleanup_check.png"), dpi=70); print("ok")
