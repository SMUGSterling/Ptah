"""
ptah_import.py -- turn Ptah gameplay markers into Unreal actors.

Run inside the Unreal Editor (Edit > Plugins: enable "Python Editor Script
Plugin" and "USD Importer", then Tools > Execute Python Script, or paste into
the Output Log's Python console):

    import ptah_import
    ptah_import.convert("D:/levels/arena.usda")

What it does
  * Opens the .usda with the pxr Python bindings shipped by the USD Importer
    plugin (no re-import; the stage is only read).
  * For every prim carrying a `custom string ptah:marker` attribute it spawns
    the matching actor at the marker's world position, facing the marker's
    arrow (Ptah's local -Z), tagged with `ptah:tags`:
        PlayerStart -> PlayerStart
        Spawn       -> TargetPoint      (actor tag "Spawn")
        Cover       -> TargetPoint      (actor tag "Cover")
        Objective   -> TargetPoint      (actor tag "Objective")
        Trigger     -> TriggerBox sized from the Xform scale
    Actors go in the outliner folder "Ptah/<Marker>" and are labelled with the
    prim name, so a re-run after a re-export can be diffed by eye or replaced
    (pass replace=True to delete the previous run's actors first).
  * Prints a summary of `ptah:intent` values so the environment art handoff
    can be checked against the blockout (intents also arrive on the imported
    meshes as displayColor).

Coordinates
  Ptah writes Y-up, 1 unit = 1 cm. Unreal converts Y-up stages by swapping
  Y and Z, which also converts the handedness: (x, y, z)_usd -> (x, z, y)_ue.
  This script applies the same mapping so actors land exactly on the geometry
  the USD importer produces.

Status: written against the UE 5.3-5.5 Python API (EditorActorSubsystem) and
pxr 23.x. It has not been executed in an Unreal Editor as part of the Ptah CI
(no engine in the pipeline); treat the first run as a smoke test and read the
Output Log.
"""

import math

try:
    import unreal
except ImportError:  # allows `python ptah_import.py --dry-run file.usda` outside the editor
    unreal = None

from pxr import Usd, UsdGeom, Gf

MARKER_CLASSES = {
    "PlayerStart": "PlayerStart",
    "Spawn": "TargetPoint",
    "Cover": "TargetPoint",
    "Objective": "TargetPoint",
    "Trigger": "TriggerBox",
}

FOLDER_ROOT = "Ptah"


def _to_ue(v):
    """USD Y-up (x, y, z) in cm -> Unreal Z-up (x, z, y) in cm."""
    return (float(v[0]), float(v[2]), float(v[1]))


def read_markers(usda_path):
    """Yield dicts describing each marker prim in the stage (pure pxr; usable without Unreal)."""
    stage = Usd.Stage.Open(usda_path)
    if stage is None:
        raise RuntimeError("could not open " + usda_path)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
    to_cm = mpu * 100.0
    up = UsdGeom.GetStageUpAxis(stage)
    xcache = UsdGeom.XformCache(Usd.TimeCode.Default())
    intents = {}
    markers = []
    for prim in stage.Traverse():
        intent_attr = prim.GetAttribute("ptah:intent")
        if intent_attr and intent_attr.HasAuthoredValue():
            intents[intent_attr.Get()] = intents.get(intent_attr.Get(), 0) + 1
        attr = prim.GetAttribute("ptah:marker")
        if not attr or not attr.HasAuthoredValue():
            continue
        kind = attr.Get()
        tags_attr = prim.GetAttribute("ptah:tags")
        tags = list(tags_attr.Get()) if tags_attr and tags_attr.HasAuthoredValue() else []
        m = xcache.GetLocalToWorldTransform(prim)          # Gf.Matrix4d, row-vector convention
        pos = m.ExtractTranslation()
        # facing: Ptah's local -Z as a world direction (rotation only)
        fwd = m.TransformDir(Gf.Vec3d(0, 0, -1))
        # size for volumes: the world scale of the Xform (Ptah stores box size in the scale op)
        scale = Gf.Vec3d(m.GetRow3(0).GetLength(), m.GetRow3(1).GetLength(), m.GetRow3(2).GetLength())
        markers.append({
            "path": str(prim.GetPath()),
            "name": prim.GetName(),
            "kind": kind,
            "tags": tags,
            "pos_cm": tuple(c * to_cm for c in pos),
            "fwd": tuple(fwd),
            "size_cm": tuple(c * to_cm for c in scale),
            "up_axis": up,
        })
    return markers, intents


def _ue_location(mk):
    p = mk["pos_cm"]
    return _to_ue(p) if mk["up_axis"] == "Y" else (p[0], -p[1], p[2])


def _ue_yaw(mk):
    f = mk["fwd"]
    fx, fy, _fz = _to_ue(f) if mk["up_axis"] == "Y" else (f[0], -f[1], f[2])
    return math.degrees(math.atan2(fy, fx))


def convert(usda_path, replace=False, folder=FOLDER_ROOT):
    if unreal is None:
        raise RuntimeError("convert() must run inside the Unreal Editor; use dry_run() elsewhere")
    markers, intents = read_markers(usda_path)
    actors_ss = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if replace:
        for a in actors_ss.get_all_level_actors():
            fp = str(a.get_folder_path())
            if fp == folder or fp.startswith(folder + "/"):
                actors_ss.destroy_actor(a)

    spawned = 0
    for mk in markers:
        cls_name = MARKER_CLASSES.get(mk["kind"])
        if not cls_name:
            unreal.log_warning("ptah_import: unknown marker kind %r on %s" % (mk["kind"], mk["path"]))
            continue
        cls = getattr(unreal, cls_name)
        loc = unreal.Vector(*_ue_location(mk))
        rot = unreal.Rotator(0.0, 0.0, _ue_yaw(mk))          # Rotator(roll, pitch, yaw)
        actor = actors_ss.spawn_actor_from_class(cls, loc, rot)
        if actor is None:
            unreal.log_warning("ptah_import: could not spawn %s for %s" % (cls_name, mk["path"]))
            continue
        actor.set_actor_label(mk["name"])
        actor.set_folder_path(unreal.Name("%s/%s" % (folder, mk["kind"])))
        tags = [mk["kind"]] + [t for t in mk["tags"] if t]
        actor.tags = [unreal.Name(t) for t in tags]
        if mk["kind"] == "Trigger":
            box = actor.get_component_by_class(unreal.BoxComponent)
            if box:
                sx, sy, sz = _to_ue(mk["size_cm"]) if mk["up_axis"] == "Y" else mk["size_cm"]
                box.set_box_extent(unreal.Vector(abs(sx) / 2.0, abs(sy) / 2.0, abs(sz) / 2.0))
        spawned += 1

    unreal.log("ptah_import: spawned %d of %d markers from %s" % (spawned, len(markers), usda_path))
    if intents:
        unreal.log("ptah_import: intents in this blockout: " + ", ".join("%s x%d" % kv for kv in sorted(intents.items())))
    return spawned


def dry_run(usda_path):
    """Print what convert() would spawn, without Unreal. Useful from a plain Python with usd-core installed."""
    markers, intents = read_markers(usda_path)
    for mk in markers:
        print("%-12s %-24s at %s yaw %.1f tags=%s%s" % (
            mk["kind"], mk["name"], tuple(round(c, 1) for c in _ue_location(mk)), _ue_yaw(mk), mk["tags"],
            "  size=%s" % (tuple(round(c, 1) for c in mk["size_cm"]),) if mk["kind"] == "Trigger" else ""))
    print("intents:", dict(sorted(intents.items())))
    return markers


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == "--dry-run":
        dry_run(sys.argv[2])
    else:
        print(__doc__)
