#!/usr/bin/env python3
"""Validate .usda files with Pixar's reference implementation (usd-core).

    pip install usd-core
    python3 test/usd-validate.py [files...]     # default: test/*.usda

Opens each stage, walks every prim, checks Mesh topology (index bounds,
faceVertexCounts vs faceVertexIndices) and that the stage declares the units
and up-axis Ptah promises. Exit code 1 on any failure. This is the check that
catches what our own round-trip parser cannot: our reader accepting our own
mistakes.
"""
import glob
import os
import sys

try:
    from pxr import Usd, UsdGeom, Sdf  # noqa: F401
except ImportError:
    print("usd-core is not installed: pip install usd-core")
    sys.exit(2)

here = os.path.dirname(os.path.abspath(__file__))
files = sys.argv[1:] or sorted(glob.glob(os.path.join(here, "*.usda")) + glob.glob(os.path.join(here, ".out", "*.usda")))
failures = 0


def check(cond, msg):
    global failures
    print(("  pass  " if cond else "  FAIL  ") + msg)
    if not cond:
        failures += 1


for f in files:
    print(f"\n[{os.path.relpath(f)}]")
    stage = Usd.Stage.Open(f)
    check(stage is not None, "stage opens")
    if stage is None:
        continue
    check(abs(UsdGeom.GetStageMetersPerUnit(stage) - 0.01) < 1e-9, "metersPerUnit = 0.01")
    check(UsdGeom.GetStageUpAxis(stage) == UsdGeom.Tokens.y, "upAxis = Y")
    check(stage.GetDefaultPrim() and stage.GetDefaultPrim().GetName() == "Root", "defaultPrim = Root")
    prims = list(stage.Traverse())
    meshes = [p for p in prims if p.IsA(UsdGeom.Mesh)]
    xforms = [p for p in prims if p.IsA(UsdGeom.Xform)]
    check(len(prims) > 0, f"{len(prims)} prims, {len(xforms)} Xforms, {len(meshes)} Meshes")
    bad = 0
    for p in meshes:
        m = UsdGeom.Mesh(p)
        pts = m.GetPointsAttr().Get() or []
        counts = m.GetFaceVertexCountsAttr().Get() or []
        idx = m.GetFaceVertexIndicesAttr().Get() or []
        if sum(counts) != len(idx) or any(i < 0 or i >= len(pts) for i in idx) or len(pts) == 0:
            bad += 1
            print(f"        bad topology: {p.GetPath()}")
    check(bad == 0, "all Mesh prims have consistent topology")
    for p in xforms:
        xf = UsdGeom.Xformable(p)
        ops = xf.GetOrderedXformOps()
        # every Ptah Xform composes translate/rotateXYZ/scale (or nothing)
        names = [op.GetOpName() for op in ops]
        if names and names != ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]:
            print(f"        note: {p.GetPath()} xformOpOrder = {names}")
    # world-space bounds must be computable (composition works end to end)
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])
    box = cache.ComputeWorldBound(stage.GetDefaultPrim()).ComputeAlignedRange()
    check(not box.IsEmpty() or len(meshes) == 0, f"world bounds computable: {box.GetSize() if not box.IsEmpty() else 'empty'}")
    layer_data = stage.GetRootLayer().customLayerData
    if "ptah:reference" in layer_data:
        ref = layer_data["ptah:reference"]
        check(isinstance(ref.get("image"), str) and ref["image"].startswith("data:image/"), "ptah:reference customLayerData readable")

print("\nALL USD FILES VALID" if failures == 0 else f"\n{failures} FAILURES")
sys.exit(1 if failures else 0)
