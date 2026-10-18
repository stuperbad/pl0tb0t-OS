"""Assemble viewer.html: one standalone file (three.js + the CAD meshes embedded, works offline).

The meshes come straight from kinematic_seats.py, so the viewer always matches the parametric model.
Run:  python build_viewer.py      then open viewer.html in any browser.
"""
import base64, json, os, io
import numpy as np
import trimesh
import cadquery as cq
import coupler as L

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
meshes["carriage_block"] = entry(to_mesh(L.carriage_block()), "Carriage block (printed)", 0xB9BFCA)
meshes["pins"] = entry(to_mesh(cq.Compound.makeCompound(L.pins())), "Hardened dowel pins x2", 0x8FB0D6, metal=0.85, rough=0.3)
meshes["carriage_magnet"] = entry(to_mesh(L.magnet_carriage()), "Carriage magnet D6x6", 0xA32B2B, metal=0.5, rough=0.4)
meshes["tool_block"] = entry(to_mesh(L.tool_block()), "Tool block (printed)", 0x3AA89A, group="tool")
meshes["bushings"] = entry(to_mesh(cq.Compound.makeCompound(L.bushings())), "Bronze bushings x2", 0xC8893B, group="tool", metal=0.7, rough=0.4)
meshes["tool_magnet"] = entry(to_mesh(L.magnet_tool()), "Tool magnet D6x6", 0xC24545, group="tool", metal=0.5, rough=0.4)
params = dict(capture=L.FUN_R_MOUTH - L.PIN_D / 2, funDepth=L.FUN_DEPTH, gap=2 * L.SKIN, pinP=L.PIN_P)

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
