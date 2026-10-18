import os, trimesh, cadquery as cq, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
sol = cq.importers.importStep(r"C:\Users\evanf\Downloads\Pen Holder assembly.step").solids().vals()
def mesh(s):
    s.exportStl("_t.stl", tolerance=0.04, angularTolerance=0.2); m = trimesh.load("_t.stl"); os.remove("_t.stl"); return m
c = mesh(sol[2]); t = mesh(sol[0])
fig, ax = plt.subplots(2, 3, figsize=(21, 13))
def cut(a, m, n, o, ix, iy, col, title):
    s = m.section(plane_origin=o, plane_normal=n)
    if s is not None:
        for l in s.discrete: a.plot(l[:, ix], l[:, iy], color=col, lw=1)
    a.set_aspect("equal"); a.grid(alpha=.3); a.set_title(title, fontsize=9)
for a, (n, o, ix, iy, ttl) in zip(ax.flat, [((0,1,0),(0,-19,0),0,2,"carriage Y=-19 (XZ)"),((1,0,0),(10,0,0),1,2,"carriage X=10 (YZ)"),((1,0,0),(-10,0,0),1,2,"carriage X=-10"),
        ((0,0,1),(0,0,5),0,1,"carriage Z=5 (XY)"),((0,0,1),(0,0,10),0,1,"carriage Z=10"),((0,0,1),(0,0,1.5),0,1,"carriage Z=1.5")]):
    cut(a, c, n, o, ix, iy, "#e8963a", ttl)
    if n == (0,0,1):
        cut(a, t, n, o, ix, iy, "#1b9e8a", ttl)
fig.tight_layout(); fig.savefig("carriage_sections.png", dpi=70); print("ok")
