# Ptah vs. a studio Level Designer

Use case, gap analysis, and change list. Written against v0.2.0 (2026-09-17); section 5 records what v0.3.0 shipped against it.

Correction to the first draft: the v0.2 status summary this was written from omitted three features the code already had (measure tool `M`, player height marker `H`, orthographic views `1/3/7`). The table below reflects the code.

## 1. The user

**Dana Okafor, Level Designer II.** Six years in, two shipped titles. Works at a 500-person studio shipping a co-op looter-shooter on Unreal Engine 5. Twelve level designers, twenty environment artists, four technical designers. Dana owns three combat arenas and the connective spaces between them.

**Pipeline.** Encounter brief and 2D top-down → blockout → weekly playtest → environment art pass → polish. The blockout is the contract with environment art: if a cover piece is 120 cm in the blockout, it ships at 120 cm. Everything lives in Perforce. Tasks in Jira.

**Tools today.** Blockout happens in UE5 directly (modeling tools, a modular greybox kit) with occasional detours to Maya for odd shapes. An external blockout tool has to earn its place by being faster to think in than the engine, and cheap to get out of.

**Metrics bible.** Dana designs to invariants, not to taste:

Dana's studio started from Unreal's Third Person template and kept its character numbers; the level-side sizes are derived from them (Ptah's v0.5 rules, which match what her team does by hand):

| Metric | Value |
|---|---|
| Player capsule (height × radius) / eye height | 176 × 34 cm / 152 cm |
| Crouch height | 80 cm |
| Half cover / full cover | 100 cm / 200 cm |
| Jump: up / across (run speed 500) | 143 cm / 408 cm |
| Doorway (h × w), corridor width | 340 × 140 cm (clears a jumping player), 280 cm |
| Step height / walkable slope | ≤ 45 cm / ≤ 44.8° (UE walkable floor angle) |
| Engagement ranges | 15–40 m |
| Grid | 100 / 50 / 25 / 12.5 cm |

(The first draft of this document used real-world architecture numbers here, 180/165 and 240 × 120 doors; they matched no engine template and made the first plan's doors read as too thin. v0.5 fixed the defaults and this table.)

### A week in the tool

1. **Monday.** New arena. Drops the paper map in as an underlay, sets grid to 100, blocks floor plates, walls, verticality (stairs, ramps), then cover. Places player start, enemy spawns, an objective volume, and cover markers with facing.
2. **Tuesday–Wednesday.** Walks it in first person at true capsule and speed. Measures sightlines (is that lane 35 m or 55 m?). Selects thirty cover pieces and sets height to 120 in one edit. Snaps a wall flush against another wall without nudging.
3. **Thursday.** Playtest. Exports, imports into UE5, and the level is playable in ten minutes: correct scale, axis, pivots, names, colors by intent, collision. After notes, re-exports; re-import replaces rather than duplicates.
4. **Friday.** Handoff review with environment art. The blockout is annotated: notes pinned to geometry, intent tags on every piece, measurements visible, a top-down image for the wiki.

### Acceptance criteria

- **A. Metrics-driven.** Player-scale reference, cover/door/step presets, walk mode uses real capsule and speeds.
- **B. Fast bulk editing.** Multi-object numeric edits, grid and face-to-face snapping, duplicate/array, cutouts for doors and windows.
- **C. Gameplay intent, not just geometry.** Markers (player start, spawn, cover, objective, trigger volumes), intent colors, tags.
- **D. Engine round-trip.** One-step UE5 and Unity import; correct scale/axis/pivot/naming; stable IDs so re-import replaces.
- **E. Analysis.** Ruler, line-of-sight check, orthographic views, top-down export.
- **F. Durability and collaboration.** Text-diffable files, autosave, crash recovery, deterministic output for source control.
- **G. Ergonomics.** Engine-familiar shortcuts, camera bookmarks, layers and lock, holds 2–5k objects.

## 2. Ptah v0.2.0 against the criteria

| Criterion | Ptah v0.2.0 | Gap | Severity |
|---|---|---|---|
| A. Metrics | Walk mode and an `H` player marker (height editable) exist. No metrics profile beyond that one number; speeds, step and jump are hard-coded. No sized presets. | Large | High |
| B. Bulk editing | Multi-select + pivot gizmo, grid snap (`G`), duplicate (`Ctrl+D`). Multi-object numeric edits and face-to-face snapping are listed as open. No cutouts. | Large | High |
| C. Intent | Pinned notes only. No markers, volumes, intent colors, or tags. Blockout is treated as geometry; a studio treats it as geometry plus gameplay data. | Large | High |
| D. Round-trip | `.usda`, cm, Y-up, baked Mesh, rotation convention fixed and tested. UE5 is Z-up and converts via stage metadata: verify `upAxis` and `metersPerUnit` are written explicitly. Prim path stability across exports: verify. Pivot convention undocumented. usd-core validation still unverified. No glTF/FBX fallback. | Medium | High |
| E. Analysis | Measure tool (`M`, two points, per-axis deltas) and front/right/top views exist. No line-of-sight check, no top-down image export. | Small | Low |
| F. Durability | Undo everywhere, text export (good for Perforce and diffs). No autosave or crash recovery mentioned. Deterministic export order: verify. | Medium | Medium |
| G. Ergonomics | Browser build, scene tree, groups. Shortcuts unknown, no camera bookmarks, no lock/visibility layers, no instancing; untested past a few hundred objects. | Medium | Low–Med |

**Where Ptah already wins.** Zero-install browser build. Undo on every structural op. Embedded references (no broken paths in Perforce). A text export a reviewer can diff. A rotation convention that is tested against the engine rather than assumed.

**Where to push back on the framing.** Dana blocks out in-engine and will keep doing so. Ptah's job is not parity with UE5's modeling tools; it is teaching students the habits Dana already has: design to metrics, encode intent, measure, ship a clean export. The change list below is filtered on that. Items that serve only studio scale are marked as such.

## 3. Changes

Each item has a definition of done. "Teaches" marks items that serve the student mission directly.

### v0.3 — do now

1. **Metrics profile.** *Teaches.* Per-scene `metrics` block (capsule, eye, crouch, walk/sprint speed, jump up/across, step, slope, grid sizes) with the defaults above, editable in a panel, saved as `customLayerData` in the `.usda`. Walk mode reads it. New primitive: **Player Reference** (capsule at profile size). Preset primitives: Half Cover, Full Cover, Doorway, Corridor Segment, Step Run. *Done:* unit tests that presets track the profile; E2E that walk-mode eye height changes when the profile does.
2. **Multi-object numeric edits.** *Teaches.* Properties panel shows a value when shared, an em-dash when mixed; typing sets all; `+=`/`*=` relative entry. One compound undo. *Done:* unit tests on mixed/shared resolution and undo.
3. **Face-to-face snapping.** *Teaches.* While dragging, snap the nearest face of the moved selection to the nearest face of any other object within threshold; highlight the snap plane. Toggle key. *Done:* E2E step that snaps two boxes flush and asserts the gap is zero.
4. **Gameplay markers.** *Teaches.* PlayerStart, Spawn, Cover (with facing arrow), Objective, TriggerVolume (box, editor-only render). Exported as `Xform` prims named `GP_<Type>_<nn>` with `custom string ptah:marker` and `custom string[] ptah:tags`. Ship `tools/unreal/ptah_import.py` and `tools/unity/PtahImportPostprocessor.cs` that replace them with engine actors. *Done:* export fixture; scripts run against the fixture in CI where the runtime allows, otherwise documented manual check.
5. **Intent palette.** *Teaches.* Eight named intents (Floor, Wall, Cover, Blocker, Water, Hazard, Interactive, Placeholder) as the only colors; each exports `displayColor` and `custom string ptah:intent`. *Done:* every exported Mesh prim carries both.
6. **Ruler.** Already present as the `M` tool. Add a meters readout beside units. *Done:* status bar shows both.
7. **Autosave and recovery.** IndexedDB in the browser, `userData` in Electron; every 60 s and after structural ops; restore prompt on launch. *Done:* E2E that kills and reloads the page and recovers.
8. **UE5/Unity export hardening.** Write `upAxis = "Y"` and `metersPerUnit = 0.01` explicitly. Prim paths derived from persistent object IDs so re-import replaces. Document the pivot convention (current: object center; consider base-center for Floor/Wall/Cover). Add `docs/importing.md` for UE5 and Unity. *Done:* rotation and axis fixtures pass usd-core validation in CI; an actual UE5 import screenshot in the doc.

### v0.4 — next

9. Orthographic top/front/side views with quick keys; top-down PNG export. *Teaches.*
10. Camera bookmarks 1–9.
11. Box cutout (subtract) for doorways and windows via `three-bvh-csg`. Result stays a baked Mesh. *Teaches.*
12. Lock and hide on groups (layers by another name).
13. glTF/GLB as a second export via `GLTFExporter`. UE5 and Unity both import it natively; covers studios and labs with the USD plugin off. FBX from JS is not worth the cost.
14. Optional Unreal-style shortcut set (W/E/R/Q, F, G, Ctrl+D, End to drop to floor).
15. `InstancedMesh` for repeated primitives; test at 5k objects. *Studio scale.*

### Out of scope

- Perforce or git integration. The text `.usda` is the integration.
- Terrain sculpting, splines, roads. Different tool.
- In-tool playtesting beyond walk mode. The engine does that.
- Feature parity with UE5 modeling tools.

## 4. Execution order

Items 1, 4, 5 first: they change the data model and export format, so everything else builds on them. Then 2 and 3 (already scoped). Then 6, 7, 8. Open items 1–3 from the v0.2 status (unverified checks, lockfile, distribution, license wording) stay as they are and should close before v0.3 tags.

## 5. What v0.3.0 shipped against this list

| Item | Status |
|---|---|
| 1. Metrics profile, presets, player reference | Done. 13-field profile saved in the file; five presets (half/full cover, doorway, corridor, step run); `H` marker shows metric ticks; PlayerStart markers draw the capsule. |
| 2. Multi-object numeric edits | Done, with `+=` `-=` `*=` `/=` relative entry and one compound undo. |
| 3. Face-to-face snapping | Done (`Shift+G`), butt joints and flush alignment with a highlight plane. Off by default. |
| 4. Gameplay markers + engine scripts | Done. Five kinds exported as `ptah:marker` / `ptah:tags` attributes; `tools/unreal/ptah_import.py`, `tools/unity/`. Scripts not yet run in an engine. |
| 5. Intent palette | Done. Eight intents, exported as `ptah:intent` + `displayColor`. |
| 6. Ruler | Meters added to the existing tool. |
| 7. Autosave and recovery | Done. IndexedDB snapshot, restore bar on launch, covered by the browser E2E. |
| 8. Export hardening | `upAxis` and `metersPerUnit` were already explicit. Added persistent `ptah:id`. Pivot convention documented in `docs/importing.md`. usd-core validation of the new attributes still runs only in CI. |
| Walk mode extras | Crouch (`C`) and jump (`Space`) from the profile, so cover heights and gaps can be checked in first person. |

Remaining from the v0.4 list: ortho PNG export, camera bookmarks, box cutouts, lock/hide layers, glTF export, Unreal-style shortcut set, instancing for large scenes.
