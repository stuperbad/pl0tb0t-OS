import base64, json, os, io
import trimesh, cadquery as cq
import fit as F

here = os.path.dirname(os.path.abspath(__file__))


def mesh(shape, tol=0.05, ang=0.3):
    p = os.path.join(here, "_t.stl")
    shape.exportStl(p, tolerance=tol, angularTolerance=ang)
    m = trimesh.load(p); os.remove(p); return m


def entry(shape, label, color, group="scene", opacity=1.0, metal=0.1, rough=0.55, on=True, tol=0.05):
    m = mesh(shape, tol)
    return dict(b64=base64.b64encode(m.export(file_type="stl")).decode("ascii"), label=label, color=color, group=group,
                opacity=opacity, metal=metal, rough=rough, on=on)


s = F.load()
s2, s0, s1, s3 = s[2], s[0], s[1], s[3]
s0m, s1m, s3m = F.shifted(s0, -F.DROP), F.shifted(s1, -F.DROP), F.shifted(s3, -F.DROP)
cn, tn = F.carriage_new(s2), F.tool_new(s0m)
M = {}
M["carriage_new"] = entry(cn, "Carriage (modified underside)", 0xE8963A)
M["pins"] = entry(cq.Compound.makeCompound(F.pins()), "Dowel pins 3x20 x2", 0x8FB0D6, metal=0.85, rough=0.3)
M["carriage_magnet"] = entry(F.magnet_carriage(), "Carriage magnet D6x6", 0xA32B2B, metal=0.5)
M["tool_new"] = entry(tn, "Pen holder + new tab", 0x3AA89A, group="tool")
M["bushings"] = entry(cq.Compound.makeCompound(F.bushings()), "Bushings 3x5x5 x4", 0xC8893B, group="tool", metal=0.7, rough=0.4)
M["tool_magnet"] = entry(F.magnet_tool(), "Tool magnet D6x6", 0xC24545, group="tool", metal=0.5)
M["cup"] = entry(s3m, "Cup (your part, moved down)", 0x4A7FC0, group="tool", opacity=0.5, tol=0.12)
M["dock"] = entry(s1m, "Dock/base (your part, moved down)", 0x999999, opacity=0.25, on=False, tol=0.12)
params = dict(capture=F.FUN_R_MOUTH - F.PIN_D / 2, funDepth=F.FUN_DEPTH, gap=2 * F.SKIN, pinP=F.PIN_P)
lib = os.path.join(here, "_lib")
rd = lambda n: io.open(os.path.join(lib, n), encoding="utf-8").read()
html = io.open(os.path.join(here, "viewer_template.html"), encoding="utf-8").read()
for t, x in (("/*__THREE__*/", rd("three.min.js")), ("/*__ORBIT__*/", rd("OrbitControls.js")), ("/*__STL__*/", rd("STLLoader.js")),
             ("/*__MESHES__*/", json.dumps(M)), ("/*__PARAMS__*/", json.dumps(params))):
    assert html.count(t) == 1, t
    html = html.replace(t, x, 1)
io.open(os.path.join(here, "viewer.html"), "w", encoding="utf-8").write(html)
print("wrote viewer.html %.2f MB" % (os.path.getsize(os.path.join(here, "viewer.html")) / 1e6))
