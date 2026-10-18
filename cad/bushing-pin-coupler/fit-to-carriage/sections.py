import os, numpy as np, trimesh, cadquery as cq, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
here = os.path.dirname(os.path.abspath(__file__))
sol = cq.importers.importStep(r"C:\Users\evanf\Downloads\Pen Holder assembly.step").solids().vals()
ms = []
for i, s in enumerate(sol):
    p = os.path.join(here, "_t.stl"); s.exportStl(p, tolerance=0.05, angularTolerance=0.2)
    ms.append(trimesh.load(p)); os.remove(p)
cols = ["#1b9e8a", "#888888", "#e8963a", "#4a7fc0", "#c24545"]
names = ["s0", "s1", "s2 carriage", "s3", "s4"]


def cut(ax, normal, origin, ix, iy, xl, yl, title):
    for i, m in enumerate(ms):
        sec = m.section(plane_origin=origin, plane_normal=normal)
        if sec is None: continue
        for l in sec.discrete:
            ax.plot(l[:, ix], l[:, iy], color=cols[i], lw=1.0, label=names[i])
    h, l = ax.get_legend_handles_labels(); d = dict(zip(l, h)); ax.legend(d.values(), d.keys(), fontsize=7, loc="upper right")
    ax.set_aspect("equal"); ax.grid(alpha=.3); ax.set_xlabel(xl); ax.set_ylabel(yl); ax.set_title(title, fontsize=9)

fig, axs = plt.subplots(2, 3, figsize=(20, 13))
cut(axs[0, 0], (0, 0, 1), (0, 0, 40), 0, 1, "X", "Y", "top-down cut Z=40 (carriage: rails/bearings)")
cut(axs[0, 1], (0, 0, 1), (0, 0, 15), 0, 1, "X", "Y", "top-down cut Z=15")
cut(axs[0, 2], (0, 0, 1), (0, 0, -20), 0, 1, "X", "Y", "top-down cut Z=-20")
cut(axs[1, 0], (1, 0, 0), (0, 0, 0), 1, 2, "Y", "Z", "side cut X=0")
cut(axs[1, 1], (0, 1, 0), (0, 0, 0), 0, 2, "X", "Z", "front cut Y=0")
cut(axs[1, 2], (0, 1, 0), (0, 15, 0), 0, 2, "X", "Z", "front cut Y=15")
fig.tight_layout(); fig.savefig(os.path.join(here, "step_sections.png"), dpi=75)
print("done")
