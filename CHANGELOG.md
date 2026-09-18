# Changelog

## 0.4.0 (2026-09-18)

### Added
- **Extrude a face** (`X`, rail button): hover any axis-aligned face of a primitive, drag it along its normal. The opposite face stays put, so a wall gets longer from its end and a floor thicker from its top. Grid snap lands the face on grid planes (world-aligned faces) or snaps the travel to whole cells (rotated objects). One undo step. Sloped and curved faces are refused with a status note. This is a size change on the unit primitive, not polygonal extrusion, so exports are unchanged in shape.
- **Walk from the Player start**: `Tab` now starts at the selected PlayerStart marker (else the first one in the scene, else the camera target as before), facing its −Z, standing on whatever is under it. The marker's capsule hides while you walk; the HUD names the start.
- **Ticks** (`H`, replaces the Player toggle): height ticks for player height, eye, crouch, full cover, half cover and step on every PlayerStart and Spawn capsule. Drop a capsule beside a block and read the heights. Default on.
- **Grid opacity** slider in the topbar (0–100%), remembered per browser. Dim the grid to trace a reference underlay.

### Changed
- The fixed player figure at the origin is gone. It could not be moved and had nothing to do with where walk mode began; the PlayerStart marker is the player now. Files are unaffected (the figure was never saved).

## 0.3.0 (2026-09-17)

Built against the studio level designer use case in `docs/level-designer-gap-analysis.md`: a blockout is geometry plus gameplay data, designed to fixed metrics and exported cleanly.

### Added
- **Metrics profile** (Metrics panel): player, eye, crouch and step heights, walk/run speed, jump height and distance, half/full cover, door and corridor sizes. Saved in the file (`customLayerData "ptah:metrics"`), undoable, defaults for files that have none. Drives the `H` marker (now with metric ticks), PlayerStart capsules, presets and walk mode.
- **Presets** (topbar picker): Half cover, Full cover, Doorway (grouped posts + lintel), Corridor (grouped floor + walls), Step run (risers = step height). Sized from the profile, tagged with the matching intent, placed with a click.
- **Intent palette** replaces the six decorative colors: Floor, Wall, Cover, Blocker, Water, Hazard, Interactive, Placeholder. Exported as `custom string ptah:intent` plus `displayColor`. New objects default to an intent by type (cube/cylinder wall, plane/wedge/stairs floor, sphere placeholder).
- **Gameplay markers** (topbar picker, `K` re-arms the last kind): PlayerStart and Spawn (player-sized capsules with facing arrow and eye line), Cover point, Objective, Trigger volume (box; Size is the volume). Exported as empty Xforms with `custom string ptah:marker`; volumes carry their size in the scale op. Kind and free-form **tags** (`custom string[] ptah:tags`) edit in the Inspector; tags work on geometry too.
- **Engine scripts**: `tools/unreal/ptah_import.py` (spawns PlayerStart / TargetPoint / TriggerBox actors from the markers, folder per kind, tags carried over; `--dry-run` works with plain usd-core) and `tools/unity/` (Editor menu that converts markers to tagged objects, trigger colliders and `PtahMarker` components). `docs/importing.md` covers both engines, coordinates, pivots and naming.
- **Multi-object numeric edits**: with several objects selected the Position / Rotation / Size fields show the shared value or an em-dash when mixed; typing sets every top-level object; `+=`, `-=`, `*=`, `/=` apply relative changes per object. One compound undo. Relative entry also works on a single object.
- **Face-to-face snapping** (`Shift+G`, Faces button): while dragging, a face within half a grid cell of another object's facing or coplanar face snaps flush (butt joints, alignment, stacking), highlighted with a plane. Each axis snaps independently so pushing into a corner closes both gaps. Off by default.
- **Walk mode**: `Space` jumps (apex = jump height, reach at run speed = jump distance), `C` or `Ctrl` crouches to crouch height. Eye height, step height and speeds come from the profile.
- **Autosave and recovery**: a snapshot of the level is written to IndexedDB a few seconds after each edit and at least once a minute while dirty. On launch, unsaved work is offered back in a bar over the viewport; Save and New discard it. Works in the browser build and Electron alike.
- Persistent per-object id (`ptah:id` in customData) so identity survives save/load.
- Measure tool shows meters beside units.
- Tests: 136 unit assertions (v0.3 format round trips including escaped tags and marker volumes, preset sizing against the profile, face-snap cases) and an E2E scenario extended with metrics, crouch/jump, presets, markers, multi-edit and face snap; the browser runner also reloads the page and recovers the autosave snapshot.

### Changed
- Default colors are the intent palette: cylinders are now wall slate (was clay), spheres placeholder magenta (was sage), wedge and stairs floor slate (was wall slate). Loaded files keep their colors.
- The topbar player-height field moved into the Metrics panel.
- `test/sample.usda` now carries a metrics profile, intents, tags and two markers.

### Fixed
- Nothing user-visible; v0.2 open items (unverified Electron smoke, `dist`, usd-core, lockfile) are unchanged and listed in `HANDOFF.md`.

## 0.2.0 (2026-09-17)

### Added
- Scene tree: groups and parenting. `Ctrl+G` / `Ctrl+Shift+G`, drag and drop in the Hierarchy (before, after, into), collapse carets, child counts. World transforms are preserved on every regroup; all of it is undoable.
- Multi-select: Shift/Ctrl+click in the viewport and Hierarchy, marquee box select, `Ctrl+A`. Centroid pivot gizmo for moving, rotating and scaling several objects; colors, duplicate and delete apply to the whole selection.
- Gizmo scale snapping on single objects (sizes snap to whole grid cells, 1u minimum).
- Wedge (ramp, `V`) and stairs (`T`) primitives. Stairs are watertight with no T-junctions and carry a per-object step count (`ptah:steps`).
- Notes (`N`): pinned annotations with title and text, exported as empty Xforms with `ptah:text`.
- Walk mode (`Tab`): first-person camera at 93% of player height, WASD + Shift, pointer-lock look, wall blocking at knee height, floor following over stairs and ramps.
- Reference image underlay: load or drop an image, set width, rotation, offset and opacity; embedded (downscaled) in the `.usda` as `customLayerData`.
- Browser build: `renderer/` runs from any static host. `renderer/js/platform.js` wraps the host differences (File System Access API with download fallback, `beforeunload` guard). Web manifest and icon.
- Unsaved-changes guard on Electron window close.
- Import of foreign USD keeps hierarchy (plain Xforms become groups, empties survive) instead of flattening with a warning.
- Tests: manifold + analytic volume checks for all primitives, escaping, hierarchy/notes/stairs/reference round trips, byte-identical re-export, comment stripping, checked-in fixtures (v0.1 and current). Shared E2E scenario run by both Playwright/Chromium and Electron, covering every new interaction. `test/usd-validate.py` for Pixar usd-core.
- GitHub Actions: CI (unit, browser E2E, Electron smoke, usd-core), GitHub Pages deploy of the web build, tagged releases for Windows/macOS/Linux with optional signing and notarization.
- `LICENSE` (MIT), app icon, `.editorconfig`, `.nvmrc`, `CHANGELOG.md`.

### Changed
- Electron `^31.3.0` → `^44.4.1`, electron-builder `^24.13` → `^26.16`, Playwright added as a dev dependency.
- Hierarchy ordering and parenting are read from the Three.js scene graph (single source of truth); `state.order` is gone.
- Opening a file frames the whole level.
- Second directional fill light so faces away from the key light stay readable in walk mode.
- `test/sample.usda` is generated by `npm run samples`; the v0.1 sample is kept as `test/sample-v0.1.usda` for backward-compatibility tests.

### Fixed
- **Rotation convention.** three.js Euler `'XYZ'` is not USD `rotateXYZ` (they differ in application order), so any object rotated about two or more axes looked different in Unreal, Unity and usdview than in Ptah. Every node now uses Euler order `'ZYX'`, which is exactly USD/Maya `rotateXYZ` (X first). Verified against the vendored three.js in unit tests and against Pixar usd-core in CI (`test/fixtures/rotation.usda`). Files written by v0.1 with compound rotations were wrong in-engine; reopening and saving them in v0.2 fixes them to match what the editor shows.
- A string ending in a backslash (a Windows path in a note) made the whole file import as empty; bracket matching now tracks escapes properly.
- `//` inside string literals (base64 data URLs) and `@asset@` paths was stripped as a comment.
- A value typed into an inspector field was applied to whatever object was clicked next; the field is committed before the selection changes.
- Undoing a multi-object delete restored siblings in the wrong order.
- Dropping a file on the viewport navigated the window away from the editor (Electron had no way back). Drops are now intercepted: `.usda` opens, images load as the reference, everything else is ignored. Electron denies navigation and new windows; a Content Security Policy is set.
- Placement and measure clicks could land on the transform gizmo and start a drag; the gizmo is now hidden outside the select tool.
- Save and Open errors surface as toasts instead of failing silently.
- Scale can no longer be dragged to zero or negative (which produced NaN transforms after a regroup).
- Three.js geometries, materials and textures are disposed when objects, grid labels, measurements and the player marker are rebuilt or removed; grid label count is capped for tiny grid sizes.
- Loading a large file no longer rebuilds the hierarchy panel once per object.
- Name counters advance past names present in a loaded file; Save As suggests the current file name.
- A pointer lock granted after leaving walk mode is released instead of blocking pointer capture for the session.
- Foreign USD with `xformOp:orient`, `xformOp:transform` or non-XYZ rotate orders imports correctly instead of at the origin; pivot ops warn that the transform is approximate. USD `Cylinder` gprims honor their `axis` (default Z).
- The reference image in a file must be embedded image data; the editor never fetches a URL from a file.
- Camera matrices are refreshed before picking and projection, so input arriving between frames hits the right thing.
- Removed dead `topLevelOnly()` in `usd.js`.

## 0.1.0

Initial release: cube/cylinder/sphere/plane placement, move/rotate/scale gizmo with grid snapping, measure tool, player height marker, hierarchy and inspector, undo/redo, `.usda` export and tolerant import, Electron packaging.
