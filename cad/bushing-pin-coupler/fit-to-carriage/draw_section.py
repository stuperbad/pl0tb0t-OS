"""Section drawing of rev 2: cut through the pin plane (X = 8) and the magnet plane (X = 0), seated and dropped 14 mm."""
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
cn, hn = F.carriage_new(s[2]), F.holder_new(s[0])
parts = [(mesh(cn), "#e8963a", "carriage + shelf"), (mesh(hn), "#1b9e8a", "pen holder"),
         (mesh(cq.Compound.makeCompound(F.pins())), "#2b4c7e", "pins"), (mesh(cq.Compound.makeCompound(F.bushings())), "#b8741f", "bushings"),
         (mesh(F.magnet_carriage()), "#a32b2b", "magnets"), (mesh(F.magnet_tool()), "#a32b2b", None), (mesh(s[1]), "#999999", "dock")]
fig, axs = plt.subplots(1, 3, figsize=(21, 9))
for ax, (xc, title) in zip(axs, [(8.0, "cut X = 8: through a pin + its two bushings"), (0.0, "cut X = 0: through the magnet pair"), (8.0, "same cut, holder dropped 14 mm")]):
    drop = 14.0 if "dropped" in title else 0.0
    for m, col, lab in parts:
        sec = m.section(plane_origin=(xc, 0, 0), plane_normal=(1, 0, 0))
        if sec is None: continue
        tool_part = lab in ("pen holder", "pins") or lab is None
        for l in sec.discrete:
            ax.plot(l[:, 1], l[:, 2] - (drop if (tool_part or lab == "dock") and drop else 0), color=col, lw=1.3, label=lab if lab else None)
    h, l = ax.get_legend_handles_labels(); d = dict(zip(l, h)); ax.legend(d.values(), d.keys(), fontsize=8, loc="upper left")
    ax.set_xlim(-30, 12); ax.set_ylim(0, 52); ax.set_aspect("equal"); ax.grid(alpha=.3)
    ax.set_xlabel("Y (carriage face at -10, holder in front to the right)"); ax.set_ylabel("Z (seat plane at 30)"); ax.set_title(title)
    ax.axhline(30, color="#999", lw=0.6, ls="--")
fig.tight_layout(); fig.savefig(os.path.join(here, "rev2_section.png"), dpi=75); print("ok")
