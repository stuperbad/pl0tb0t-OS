"""Remove features (holes, fillets, rims) from a STEP solid by deleting their faces and letting OCCT heal the surrounding
surfaces (BRepAlgoAPI_Defeaturing) -- no filler cylinders, so no seams or leftover rims."""
import cadquery as cq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
from OCP.TopTools import TopTools_ListOfShape
from OCP.BRepAdaptor import BRepAdaptor_Surface


def defeature(solid, faces):
    lst = TopTools_ListOfShape()
    for f in faces:
        lst.Append(f.wrapped)
    op = BRepAlgoAPI_Defeaturing()
    op.SetShape(solid.wrapped)
    op.AddFacesToRemove(lst)
    op.SetRunParallel(False)
    op.SetToFillHistory(False)
    op.Build()
    if not op.IsDone():
        raise RuntimeError("defeaturing failed")
    out = cq.Shape.cast(op.Shape())
    sol = out.Solids()
    return sol[0] if len(sol) == 1 else out


def cyl_info(f):
    c = BRepAdaptor_Surface(f.wrapped).Cylinder()
    a = c.Axis().Direction(); o = c.Axis().Location()
    return c.Radius(), (a.X(), a.Y(), a.Z()), (o.X(), o.Y(), o.Z())


def faces_near_axes(solid, axes_xz, y0, y1, max_ext=7.2, window=4.3, types=("CYLINDER", "CONE", "TORUS", "PLANE"), max_plane_area=60):
    """Faces whose bbox sits inside a window around any (x, z) axis, Y-range [y0, y1], and are small (a hole feature)."""
    out = []
    for f in solid.Faces():
        bb = f.BoundingBox()
        if bb.ymin < y0 - 1e-6 or bb.ymax > y1 + 1e-6:
            continue
        if (bb.xmax - bb.xmin) > max_ext or (bb.zmax - bb.zmin) > max_ext:
            continue
        t = f.geomType()
        if t not in types or (t == "PLANE" and f.Area() > max_plane_area):
            continue
        for (x, z) in axes_xz:
            if bb.xmin >= x - window and bb.xmax <= x + window and bb.zmin >= z - window and bb.zmax <= z + window:
                out.append(f)
                break
    return out


def hole_feature_faces(solid, holes_xz, radii=(1.75, 3.0), z_tol=0.35, win=4.15):
    """Faces that belong to the old magnet pockets / bores: Y-axis cylinders of the given radii located at a hole axis, plus the
    planar floors and toroidal fillet rings centred on the same axes (edge fillets elsewhere on the part are left alone)."""
    sel = []
    for f in solid.Faces():
        t = f.geomType()
        bb = f.BoundingBox()
        xc, zc = (bb.xmin + bb.xmax) / 2, (bb.zmin + bb.zmax) / 2
        if t == "CYLINDER":
            r, a, o = cyl_info(f)
            if abs(a[1]) > 0.9 and any(abs(r - rr) < 0.02 for rr in radii) and any(abs(o[0] - x) < 0.05 and abs(o[2] - z) < 0.05 for x, z in holes_xz):
                sel.append(f)
        elif t in ("TORUS", "PLANE", "CONE"):
            if t == "PLANE" and f.Area() > 40:
                continue
            for x, z in holes_xz:
                if abs(zc - z) < z_tol and bb.xmin >= x - win and bb.xmax <= x + win and bb.zmin >= z - win and bb.zmax <= z + win:
                    sel.append(f)
                    break
    return sel


# ---------------------------------------------------------------- exact filling of bores (for holes the defeaturing op cannot heal)
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.BRep import BRep_Tool


def neighbour_planes(solid, cyl_face, min_area=40):
    """Big planar faces that share an edge with cyl_face -> [(origin, outward normal)]."""
    m = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(solid.wrapped, TopAbs_EDGE, TopAbs_FACE, m)
    out = []
    for e in cyl_face.Edges():
        for i in range(1, m.Extent() + 1):
            if m.FindKey(i).IsSame(e.wrapped):
                for fw in m.FindFromIndex(i):
                    f = cq.Face(fw)
                    if f.geomType() == "PLANE" and f.Area() > min_area and not f.wrapped.IsSame(cyl_face.wrapped):
                        n = f.normalAt(f.Center())
                        out.append((f.Center(), n))
    return out


def halfspace(origin, normal, size=300.0):
    """Big block on the NEGATIVE side of the plane (origin, normal) = the solid side when normal points outward."""
    pl = cq.Plane(origin=cq.Vector(origin.x, origin.y, origin.z), xDir=None, normal=cq.Vector(normal.x, normal.y, normal.z)) if False else \
        cq.Plane(origin=(origin.x, origin.y, origin.z), normal=(normal.x, normal.y, normal.z))
    return cq.Workplane(pl).rect(size, size).extrude(-size).val()


def end_plane(solid, x0, z0, y_a, y_b, min_area=40):
    """Planar face (non-Y-normal, i.e. a slanted wall) crossed by the line (x0, y, z0) for y in [y_a, y_b] -> (face, y_cross)."""
    best = None
    for f in solid.Faces():
        if f.geomType() != "PLANE" or f.Area() < min_area:
            continue
        n = f.normalAt(f.Center()); c = f.Center()
        if abs(n.y) < 0.2:
            continue
        y = c.y - (n.x * (x0 - c.x) + n.z * (z0 - c.z)) / n.y
        if y_a - 0.8 <= y <= y_b + 0.8:
            bb = f.BoundingBox()
            if bb.xmin - 0.1 <= x0 <= bb.xmax + 0.1 and bb.zmin - 0.1 <= z0 <= bb.zmax + 0.1:
                if best is None or abs(y - (y_a + y_b) / 2) < abs(best[1] - (y_a + y_b) / 2):
                    best = (f, y)
    return best


def planes_at(solid, x0, z0, y_a, y_b, min_area=40):
    """All slanted planar walls crossed by the line (x0, y, z0) with y in [y_a, y_b] (apex edges give two)."""
    out = []
    for f in solid.Faces():
        if f.geomType() != "PLANE" or f.Area() < min_area:
            continue
        n = f.normalAt(f.Center()); c = f.Center()
        if abs(n.y) < 0.2:
            continue
        y = c.y - (n.x * (x0 - c.x) + n.z * (z0 - c.z)) / n.y
        bb = f.BoundingBox()
        if y_a <= y <= y_b and bb.xmin - 0.1 <= x0 <= bb.xmax + 0.1 and bb.zmin - 0.1 <= z0 <= bb.zmax + 0.1:
            out.append((f, y))
    return out


def clipped_cylinder(solid, x0, z0, r, y_lo, y_hi, clip_y_ranges):
    """Cylinder along Y at (x0, z0) from y_lo to y_hi, clipped by the solid's slanted walls found near each y-range."""
    c = cq.Solid.makeCylinder(r, y_hi - y_lo, cq.Vector(x0, y_lo, z0), cq.Vector(0, 1, 0))
    for (a, b) in clip_y_ranges:
        for f, y in planes_at(solid, x0, z0, a, b):
            c = c.intersect(halfspace(f.Center(), f.normalAt(f.Center())))
    return c


from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain


def unify(shape, lin=2e-3, ang=2e-3):
    """Merge neighbouring coplanar / co-cylindrical faces (with looser tolerances than CadQuery's clean())."""
    u = ShapeUpgrade_UnifySameDomain(shape.wrapped, True, True, True)
    u.SetLinearTolerance(lin)
    u.SetAngularTolerance(ang)
    u.Build()
    out = cq.Shape.cast(u.Shape())
    sol = out.Solids()
    return sol[0] if len(sol) == 1 else out
