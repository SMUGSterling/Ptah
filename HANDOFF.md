# Ptah: Handoff Notes

Everything needed to keep going is in this repository. This file is the orientation; `README.md` is the reference.

## What's here

```
HANDOFF.md            this file
README.md             setup, features, shortcuts, USD conventions, architecture, testing, signing
CHANGELOG.md          what changed in each version
LICENSE               MIT
package.json          scripts, Electron/electron-builder config
main.js, preload.js   Electron main process and bridge
renderer/             the app (also the web build): index.html, style.css, js/, vendor/
test/                 unit tests, shared E2E scenario, browser + Electron runners, usd-core validator, samples
tools/                Unreal (Python) and Unity (C#) scripts that turn exported markers into engine actors
build/                icon and macOS entitlements
docs/                 importing.md (engine notes), level-designer-gap-analysis.md (the v0.3 brief), README screenshots
.github/workflows/    ci.yml (tests), pages.yml (web build to GitHub Pages), release.yml (tagged installers)
```

`node_modules` is not included. Regenerate it with `npm install`.

## Getting running again

1. `npm install`
2. Commit the resulting `package-lock.json`. The repo shipped without one because the machine that produced v0.2 had no registry access; once it exists, switch the workflows from `npm install` to `npm ci` (the comments in `.github/workflows/*.yml` mark the lines).
3. `npm start` opens the desktop editor. `npm run web` serves the browser build on `http://localhost:8123`.
4. Sanity-check before trusting the environment:
   - `npm run test:unit` (prints `ALL TESTS PASSED`)
   - `npx playwright install --with-deps chromium` once, then `npm run test:browser` (prints `BROWSER E2E PASS`)
   - `npm run test:smoke` (prints `SMOKE PASS`)
   - `pip install usd-core && npm run test:usd-core` (prints `ALL USD FILES VALID`)

If you are handing this to Claude on another account, say something like "continue work on Ptah, project files attached" and upload the repo (or just the zip). README plus this file are enough context to pick up without re-deriving decisions.

## Where things stand: v0.4.0

v0.4 answered four requests from the first hands-on review: a face **extrude** tool (`X`; a size change with the opposite face pinned, not polygonal extrusion), walk mode **starting at the PlayerStart** marker (the fixed player figure is gone; the marker is the player), **height ticks** on capsule markers (`H`), and a **grid opacity** slider (remembered per browser). 57 E2E steps cover all four. Nothing about the file format changed.

## v0.3.0

v0.3 was built against a studio level designer use case (`docs/level-designer-gap-analysis.md`): a blockout is geometry plus gameplay data, designed to fixed metrics, exported so the engine gets both. Everything on that document's v0.3 list shipped except the standalone ruler item, which turned out to exist already (the `M` tool; it now reads meters too):

- a metrics profile (Metrics panel, saved in the file as `customLayerData "ptah:metrics"`) that drives capsule markers, presets and walk mode (v0.4: the H figure is gone, ticks live on the capsules)
- presets sized from the profile: half/full cover, doorway, corridor, step run
- an eight-color intent palette exported as `ptah:intent` + `displayColor`
- gameplay markers (PlayerStart, Spawn, Cover, Objective, Trigger volume) exported as `ptah:marker` / `ptah:tags` attributes, with `tools/unreal` and `tools/unity` scripts and `docs/importing.md`
- multi-object numeric edits with relative expressions, one compound undo
- face-to-face snapping (`Shift+G`, off by default)
- walk mode crouch and jump from the profile
- autosave to IndexedDB with a recovery bar
- persistent `ptah:id` per object

**Verified in this build:** unit tests (136 assertions), the browser E2E (57 scenario steps plus the runner's web-save and reload-recovery checks) under headless Chromium. **Not verified in this build** (no npm registry or PyPI): the Electron smoke test, `npm run dist`, usd-core validation of the new attributes and the `ptah:metrics` dictionary (`test/sample.usda` carries all of them, so `npm run test:usd-core` covers it), and both engine scripts. `tools/unreal/ptah_import.py --dry-run test/sample.usda` needs only `pip install usd-core` and is the cheapest first check; the Unity scripts compile against the Unity 2022 LTS Editor API and were written from documentation, not run. Treat both scripts as drafts until someone has run them once.

v0.2 recap, still accurate: the object model is a real scene tree with the classroom features the roadmap asked for:

- groups and parenting (Ctrl+G, drag and drop in the Hierarchy), preserving world transforms, exported as nested Xforms and re-imported without flattening
- multi-select (Shift+click, marquee, Ctrl+A) with a centroid pivot gizmo; gizmo scale snap on single objects
- wedge and stairs primitives (stairs are watertight with a per-object step count)
- notes pinned in the scene, exported as named empties with their text
- first-person walk mode at player eye height with wall blocking and stair/ramp following
- reference image underlay embedded in the file
- a browser build that shares every line of renderer code with Electron (`renderer/js/platform.js` is the seam)
- Electron 44 / electron-builder 26, unsaved-changes close guard, signing and notarization config, app icon, LICENSE, CI, Pages deploy, tagged releases

v0.2's own verification notes are in the 0.2.0 section of `CHANGELOG.md`; its three unverified checks (Electron 44 smoke, `dist`, usd-core) are still the first item under next priorities.

**Key decisions already made. Don't re-litigate these without a reason:**

- Gameplay data (`ptah:marker`, `ptah:intent`, `ptah:tags`) goes out as `custom` **attributes** on the Xform, not `customData`: attributes are what engine importers and `usdview` expose. Ptah-internal metadata (`ptah:type`, `ptah:name`, `ptah:steps`, `ptah:text`, `ptah:id`) stays in `customData`.
- The metrics profile is per file, always written, and defaulted (not errored) when a file lacks it. Presets are generated from it at click time; changing the profile does not resize existing objects (that would be a surprising retroactive edit; markers and the `H` figure do redraw).
- Marker facing is local −Z (the walk camera's look direction at rotation 0). The conversion to UE (+X forward, Z-up) and Unity (+Z forward, left-handed) lives in the scripts, not the file.
- Intent is the only color. Defaults by type (cube/cylinder wall, plane/wedge/stairs floor, sphere placeholder) so a fresh scene already speaks the vocabulary.
- Face snapping uses world AABBs and is off by default; it snaps each axis independently.
- Multi-object numeric fields edit local values.
- Autosave is a plain export text in IndexedDB, so recovery is an ordinary file load. It never throws into the editor.
- There is no standalone player figure. The PlayerStart marker is where walk mode starts (selected first, else the first in the scene, else the camera target) and capsule markers carry the height ticks. Don't reintroduce a fixed figure.
- Extrude is a TRS edit (scale along one axis, position by half the delta). It keeps every primitive a scaled unit mesh, which is what the export, the manifold tests and face snapping rely on. True mesh editing (cutouts, extruding sloped faces) needs a mesh type with real editing, not a change to extrude.

- 1 scene unit = 1 cm (`metersPerUnit = 0.01`), Y-up. Matches Unreal directly; Unity's USD importer converts.
- Rotation is USD/Maya `rotateXYZ` (X first) everywhere: every node has three.js Euler order `'ZYX'`. v0.1 used three's default `'XYZ'` and wrote those angles as `rotateXYZ`, which is a different rotation for compound angles. Do not change the order back; the unit tests and the usd-core fixture will fail if anyone does.
- Objects export as baked `Mesh` prims (not USD gprims) for cross-importer consistency.
- Object "Size" in the inspector = its scale = its dimensions in units. Children inherit parent scale, exactly like the engines; groups exist so students can organize without stretching.
- The Three.js scene graph is the single source of truth for hierarchy and ordering. Records have no parent/children fields; helpers read `node.parent` and `node.children`. This removed a whole class of two-sources-of-truth bugs.
- Every structural operation returns an undo command; multi-object operations are compounds. Keep that pattern.
- Helper visuals (note pins and labels, group markers) sit under their node for picking and visibility but get an exact world-aligned matrix each frame so they never inherit rotation or scale. Anything new that must keep a constant on-screen size should use `markHelper()`.
- The reference image is embedded (downscaled, JPEG unless a small PNG) rather than referenced by path. Files stay self-contained across desktop and browser at the cost of a few hundred KB.
- Shortcuts: C/Y/S/P/V/T place primitives, N notes, K markers, X extrude, W/E/R transform modes, G snap, Shift+G face snap, M measure, H ticks, Tab walk, numpad 1/3/7/0 views, Ctrl+G / Ctrl+Shift+G group / ungroup.

**Known v0.3 limitations** (also in `README.md`): face snapping is bounding-box based; walk mode has no head collision; multi-edits are local-space; non-uniform parent scale plus rotated children shears (standard scene-graph behavior).

## Suggested next priorities

1. **Run the unverified checks** (Electron smoke, `dist`, usd-core, the two engine scripts) and commit the lockfile. Half a day plus one UE5 and one Unity session; screenshots of a real import belong in `docs/importing.md`.
2. **Distribution decision.** Unchanged from v0.2: the web build on GitHub Pages is the cheapest path to students; desktop builds need certificates through the office that holds SMU's Apple Developer and Microsoft accounts.
3. **v0.4 from the gap analysis, in order of teaching value:** orthographic top-down PNG export for reviews; box cutouts (doorways in walls) via CSG, keeping the baked-Mesh export; camera bookmarks; lock/hide on groups; glTF as a second export for pipelines with the USD plugin off; an optional Unreal-style shortcut set; instancing for large scenes.
4. **Confirm the LICENSE copyright holder wording** with whoever handles university IP (open since v0.2).

## A note on testing rigor

If you or Claude add features, hold the same bar the original build did:

- `npm run test:unit` after any change to `usd.js`, `metrics.js` or `snap.js`. It checks every closed primitive as a watertight, consistently oriented manifold with the analytic signed volume (valid for concave stairs), string escaping, hierarchy round trips, that `export(import(x))` is byte-identical, that preset sizes track the profile, and the face-snap cases.
- `npm run test:browser` and `npm run test:smoke` exercise the actual UI, not mocks, through one shared `test/scenario.mjs`. Extend the scenario when you add interactions; both runners pick it up.
- Re-validate exports against real USD tooling: `pip install usd-core && npm run test:usd-core`. This caught a real bug during the original build (unquoted namespaced customData keys) that our own parser's round-trip test missed entirely, and v0.2's comment-stripping bug (base64 data URLs contain `//`) was the same species: our reader accepting our writer's mistake.
