# Importing a Ptah blockout into Unreal Engine 5 and Unity

Ptah writes plain-text `.usda`. Everything below assumes a file saved by Ptah 0.3 or later; older files import the same way but carry no metrics, intents or markers.

## What is in the file

| Ptah object | USD prim | How engines see it |
|---|---|---|
| Cube, cylinder, sphere, plane, wedge, stairs | `Xform` + child `Mesh "Geom"` | Static mesh with `displayColor` |
| Group | empty `Xform` (`ptah:type = "group"`) | Empty actor / GameObject with children |
| Note | empty `Xform` with `ptah:text` in customData | Named empty (text is Ptah-only) |
| Marker | empty `Xform` with `custom string ptah:marker` | Named empty, until `tools/` converts it |
| Trigger volume | marker whose Xform scale is the box size | Empty scaled to the box |

Per-object gameplay data is written as **attributes** (visible in usdview's property panel and readable from engine scripting):

- `custom string ptah:intent` on geometry: `floor`, `wall`, `cover`, `blocker`, `water`, `hazard`, `interactive`, `placeholder`. The same color is in `primvars:displayColor`.
- `custom string ptah:marker` on markers: `PlayerStart`, `Spawn`, `Cover`, `Objective`, `Trigger`.
- `custom string[] ptah:tags` on anything: free-form, comma-separated in the Inspector.

Ptah-internal bookkeeping (`ptah:type`, `ptah:id`, `ptah:name`, `ptah:steps`, `ptah:text`) lives in `customData` and can be ignored by engines. The stage's `customLayerData` holds the metrics profile (`ptah:metrics`) and the embedded reference image (`ptah:reference`); engines ignore both.

## Coordinates

- 1 unit = 1 cm (`metersPerUnit = 0.01`), **Y-up**, right-handed. Both values are written explicitly in the stage header.
- Rotation is `rotateXYZ`: X first, then Y, then Z, about the parent's axes. The Inspector shows the same three numbers the file holds.
- **Facing** for markers is the object's local **−Z** (the direction the walk camera looks at rotation 0). The engine scripts convert it.
- **Pivot** of every primitive is its center. Floors, walls and cover do not have base-center pivots; if your kit convention needs them, offset on import or ask for it as a Ptah option.
- Prim names are the object names, sanitized to identifiers and made unique per parent (`Wall 01` becomes `Wall_01`; a duplicate gets `_2`). Keep names unique and stable if you want re-import to replace rather than duplicate: UE's USD Stage actor and Unity's USD asset both match by prim path.

## Unreal Engine 5

1. **Edit → Plugins**: enable *USD Importer* (and *Python Editor Script Plugin* if you will use the marker script). Restart.
2. Either **import as assets** (Content Browser → Import → pick the `.usda`; each `Mesh` becomes a Static Mesh, the hierarchy becomes a Blueprint or level actors depending on the options) or **place a USD Stage actor** (Place Actors → USD Stage, set *Root Layer* to the file). The stage actor reloads when the file changes on disk, which is the fastest loop while blocking out.
3. Unreal is Z-up. The importer converts the declared Y-up stage by swapping Y and Z; nothing to do.
4. Scale: 1 cm in Ptah is 1 cm in Unreal. A 180 u player start is 180 cm tall.
5. **Markers**: run `tools/unreal/ptah_import.py`:

   ```python
   import ptah_import
   ptah_import.convert("D:/levels/arena.usda")            # add replace=True on re-runs
   ```

   It spawns a `PlayerStart` for each player start, `TargetPoint`s tagged with the marker kind and its tags for spawns, cover and objectives, and a `TriggerBox` sized from the volume. Actors land in the outliner folder `Ptah/<Kind>` with the prim name as label. Outside the editor, `python ptah_import.py --dry-run file.usda` (with `pip install usd-core`) prints what would be spawned.
6. **Collision**: baked meshes are watertight; use *Use Complex Collision as Simple* on the imported static meshes for a playable greybox, or let the importer generate simple collision.

## Unity

1. Package Manager → add by name `com.unity.formats.usd` (the *USD* package).
2. **Assets → Import USD** (or the *USD* menu) and pick the `.usda`. The importer converts cm to meters and, with the default *Slow and Safe* basis change, flips Z for Unity's left-handed space.
3. Drag the imported prefab into a scene. Meshes carry `displayColor` as vertex color; a simple vertex-color material shows the intents.
4. **Markers**: copy `tools/unity/Editor/PtahMarkers.cs` into any `Editor/` folder and `tools/unity/Runtime/PtahMarker.cs` anywhere else. Select the imported root, then **Tools → Ptah → Convert Markers in Selection…** and pick the same `.usda`. Player starts get the `Respawn` tag, triggers get an `isTrigger` `BoxCollider`, and every marker gets a `PtahMarker` component with its kind and tags (`GetComponentsInChildren<PtahMarker>()` to find them; `Facing` is `transform.forward`).
5. **Collision**: add `MeshCollider` to the imported meshes (the importer has an option to do this), or replace floor and wall intents with primitives in a post-process step.

## Checking a round trip

- Open the file in **usdview** (`pip install usd-core` gives you `usdview`) to confirm geometry, colors and the custom attributes before touching an engine.
- `npm run test:usd-core` validates every checked-in sample and fixture with Pixar's implementation.
- The walk camera in Ptah is at `eyeHeight` from the metrics profile; the same profile is in the file header, so an engine character controller can be configured from it.

## Known gaps

- Markers are empties until a script runs; there is no USD standard for gameplay markers.
- Notes do not carry their text into engines (it is in `customData`); use tags on geometry or markers for anything an engine script needs to read.
- Neither engine script has run in a CI engine build. Both are written against current APIs and documented as smoke-test-first.
