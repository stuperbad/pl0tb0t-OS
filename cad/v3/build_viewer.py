"""Assemble viewer.html: one standalone file (three.js + the CAD meshes embedded, works offline).

The meshes come straight from coupling_v2.py, so the viewer always matches the parametric model.
Run:  python build_viewer.py      then open viewer.html in any browser.
"""
import base64, json, os, io
import numpy as np
import trimesh
import cadquery as cq
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'v2'))
import coupling_v2 as C
import coupling_v3 as L

here = os.path.dirname(os.path.abspath(__file__))
V = cq.Vector


def to_mesh(shape, tol=0.03, ang=0.1):
    tmp = os.path.join(here, "_tmp.stl")
    shape.exportStl(tmp, tolerance=tol, angularTolerance=ang)
    m = trimesh.load(tmp)
    os.remove(tmp)
    return m


def b64(mesh):
    return base64.b64encode(mesh.export(file_type="stl")).decode("ascii")


def entry(mesh, label, color, group="scene", opacity=1.0, metal=0.1, rough=0.55, on=True):
    return dict(b64=b64(mesh), label=label, color=color, group=group, opacity=opacity,
                metal=metal, rough=rough, on=on)


meshes = {}
meshes["carriage_nose"] = entry(to_mesh(L.carriage_nose()), "Carriage nose (printed)", 0xB9BFCA)
meshes["dowels"] = entry(to_mesh(cq.Compound.makeCompound(C.dowels())), "Hardened dowels x6", 0x8FB0D6, metal=0.85, rough=0.3)
meshes["carriage_magnet"] = entry(to_mesh(cq.Compound.makeCompound(L.magnets_carriage())), "Carriage magnets x2 (preload)", 0xA32B2B, metal=0.5, rough=0.4)
tg, rod = L.tongue(L.Z_OPEN)
meshes["tongue"] = entry(to_mesh(tg), "Latch tongue (keyhole, steel shim)", 0xF2C94C, metal=0.8, rough=0.35)
meshes["rod"] = entry(to_mesh(rod), "Pull rod to solenoid", 0xD9A93A, metal=0.8, rough=0.35)
meshes["spring"] = entry(to_mesh(L.spring(L.Z_OPEN)), "Return spring (envelope)", 0x6FD08C, opacity=0.55)
meshes["tool_plate"] = entry(to_mesh(L.tool_plate()), "Tool plate (ball sockets)", 0x3AA89A, group="tool")
meshes["balls"] = entry(to_mesh(cq.Compound.makeCompound(C.balls())), "Steel balls x3", 0xE8963A, group="tool", metal=0.9, rough=0.25)
meshes["tool_magnet"] = entry(to_mesh(cq.Compound.makeCompound(L.magnets_tool())), "Tool magnets x2", 0xC24545, group="tool", metal=0.5, rough=0.4)
meshes["stud"] = entry(to_mesh(L.stud()), "M3 button-head stud", 0xE8E8EE, group="tool", metal=0.9, rough=0.25)

# ---- context: the user's existing parts, shifted into the mating frame (host Y + 11.8)
step = r"C:\Users\evanf\Downloads\Pen Holder assembly.step"
if os.path.exists(step):
    solids = cq.importers.importStep(step).solids().vals()
    parts = []
    for i in (0, 1, 2, 3):
        m = to_mesh(solids[i], tol=0.25, ang=0.5)
        m.apply_translation([0, 11.8, 0])
        parts.append(m)
    ctx = trimesh.util.concatenate(parts)
    meshes["context"] = entry(ctx, "Your current parts (ghost, for scale)", 0x9AA0AA, opacity=0.16, on=False)

params = dict(S=C.S, rb=C.rb, rd=C.rd, delta=C.DELTA, yBall=C.Y_BALL, dowelL=C.DOWEL_L, gap=C.GAP,
              magGap=1.6, angles=list(C.ANGLES), topZ=C.CZ + C.RHO, travel=L.TRAVEL, wallZ=L.WALL_Z, zOpen=L.Z_OPEN, tongueAbove=L.TONGUE_ABOVE, headGap=L.HEAD_GAP)

lib = os.path.join(here, "_lib")
read = lambda n: io.open(os.path.join(lib, n), encoding="utf-8").read()
html = io.open(os.path.join(here, "viewer_template.html"), encoding="utf-8").read()
for token, text in (("/*__THREE__*/", read("three.min.js")),
                    ("/*__ORBIT__*/", read("OrbitControls.js")),
                    ("/*__STL__*/", read("STLLoader.js")),
                    ("/*__MESHES__*/", json.dumps(meshes)),
                    ("/*__PARAMS__*/", json.dumps(params))):
    assert html.count(token) == 1, token
    html = html.replace(token, text, 1)

out = os.path.join(here, "viewer.html")
io.open(out, "w", encoding="utf-8").write(html)
print("wrote", out, "%.2f MB" % (os.path.getsize(out) / 1e6))
for k, v in meshes.items():
    print("  %-16s %7.0f KB" % (k, len(v["b64"]) / 1024))
