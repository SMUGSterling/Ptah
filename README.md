# Ptah

A 3D level blockout editor for game design students. Sketch layouts fast, measure them accurately, and export USD (`.usda`) for Unity and Unreal.

Built with Electron + Three.js. Fully offline — Three.js is vendored, no network access at runtime, no Node server.

## Quick start

```bash
npm install        # downloads Electron (dev machines only)
npm start          # run the editor
```

Build standalone executables:

```bash
npm run dist           # current platform
npm run dist:win       # Windows (NSIS installer + portable)
npm run dist:mac       # macOS (dmg + zip)
npm run dist:linux     # Linux (AppImage + deb)
```

Note: electron-builder cross-compiles Linux/Windows from Linux; macOS builds require a Mac.

## Keyboard reference

| Key | Action |
| --- | --- |
| Q / Esc | Select tool (Esc also deselects) |
| C / Y / S / P | Place cube / cylinder / sphere / plane — click or drag in viewport |
| W / E / R | Move / rotate / scale gizmo |
| G | Toggle grid snapping |
| M | Measure tool — click two points |
| H | Toggle player height reference |
| F | Frame selection (or whole scene) |
| 1 / 3 / 7 / 0 | Front / right / top / free camera (numpad or number row) |
| F2 | Rename selected (or double-click in Hierarchy) |
| Del | Delete selected |
| Ctrl+D | Duplicate |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+O / Ctrl+N | Open / New |
| MMB drag | Orbit camera |
| RMB drag | Pan camera |
| Scroll | Zoom |

## Units and scale

- 1 scene unit = 1 cm (`metersPerUnit = 0.01`, Y-up in the file). This matches Unreal units directly; Unity's USD importer converts to meters automatically.
- Default grid: 64 units, with major lines every 4 cells and distance labels along both axes.
- Player reference marker defaults to 180 units (1.8 m). Toggle with H, set the height in the top bar.
- An object's **Size** in the inspector is its dimensions in units (base geometry is unit-sized; dimensions live in the scale op). Bounds shows the world axis-aligned box, which differs from Size once an object is rotated.

## USD pipeline notes

- Export writes plain-text `.usda`: an `Xform` per object carrying translate / rotateXYZ / scale, with a child `Mesh` holding baked primitive geometry. Baked meshes were chosen over `Cube`/`Sphere` gprims because Mesh is the one prim type every importer handles identically.
- `displayColor` is written per object so blocks stay visually distinct in Unreal/Unity/usdview.
- A `customData` tag (`ptah:type`) makes re-import lossless. Import also accepts foreign files: `Cube` / `Sphere` / `Cylinder` gprims map onto Ptah primitives, and unknown `Mesh` prims load as generic meshes.
- Exports validate against Pixar's official `usd-core` parser (see Testing).
- **Unreal:** enable the *USD Importer* plugin, then import or use a USD Stage actor. Unreal is Z-up; the stage's declared Y-up is converted on import.
- **Unity:** install the *USD* package (com.unity.formats.usd), then Assets → Import USD.

## Architecture

```
main.js                  Electron main — window + native file dialogs (IPC)
preload.js               contextBridge: saveUsd / openUsd / confirmDiscard
renderer/
  index.html             UI shell + import map for vendored Three.js
  style.css              editor chrome
  js/app.js              scene, grid, tools, selection, hierarchy, inspector
  js/usd.js              .usda writer/reader — pure JS, no DOM (unit-testable)
  js/history.js          undo/redo command stack
  vendor/                three.module.js + OrbitControls + TransformControls
test/
  usd.test.mjs           headless unit tests (node test/usd.test.mjs)
  smoke.js               scripted end-to-end session under Electron
```

Renderer runs sandboxed with context isolation; the only privileged surface is the three file-dialog calls in `preload.js`.

## Testing

```bash
node test/usd.test.mjs                                   # USD unit tests
xvfb-run -a npx electron --no-sandbox test/smoke.js      # E2E (Linux headless)
npx electron test/smoke.js                               # E2E (desktop)
```

Optional third check, using Pixar's reference implementation:

```bash
pip install usd-core
python -c "from pxr import Usd; assert Usd.Stage.Open('yourfile.usda')"
```

## Known limitations (v0.1)

- Flat hierarchy: no grouping/parenting yet. Imported nested Xforms are flattened; parents with rotation/scale compose translation only (a warning is shown).
- Rotation round-trips exactly for our own files; multi-axis euler conventions from other DCCs may need checking against usdview.
- Single selection only.
- Scale snapping is via the inspector's numeric fields, not the gizmo.
