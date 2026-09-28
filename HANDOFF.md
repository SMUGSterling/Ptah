# Ptah: Handoff Notes

Everything needed to keep going is in this repository. This file is the orientation for maintainers. `README.md` is the user guide, and `CONTRIBUTING.md` covers setup, tests, releases, architecture and the file format.

The web build is live at <https://levi-sterling.com/Ptah/> and <https://smugsterling.github.io/Ptah/>; installers are on the [Releases page](https://github.com/SMUGSterling/Ptah/releases).

## What's here

```
HANDOFF.md            this file
README.md             user guide: opening Ptah, features, shortcuts, engine import, known limitations
CONTRIBUTING.md       setup, tests, building, releasing, signing, architecture, file format
CHANGELOG.md          what changed in each version
LICENSE               MIT
package.json          scripts, Electron/electron-builder config
main.js, preload.js   Electron main process and bridge
renderer/             the app (also the web build): index.html, style.css, js/, vendor/
test/                 unit tests, shared E2E scenario, browser + Electron runners, usd-core validator, samples
tools/                Unreal (Python) and Unity (C#) scripts that turn exported markers into engine actors
build/                icon and macOS entitlements
docs/                 importing.md (engine notes), level-designer-gap-analysis.md (the v0.3 brief), README screenshots
.github/workflows/    ci.yml (tests), pages.yml (web build to GitHub Pages), release.yml (tagged installers),
                      build-windows.yml (manual Windows installer build)
```

`node_modules` is not included. Regenerate it with `npm ci`.

## Getting running again

1. Node.js 22 or newer (24 LTS recommended; on Linux use nvm, not the distro package), then `npm ci`.
2. `npm start` opens the desktop editor. `npm run web` serves the browser build on `http://localhost:8123`. On Ubuntu 24.04+ the first `npm start` will stop and print a `sudo chown`/`chmod` fix for Electron's `chrome-sandbox` helper; run it and start again (details in CONTRIBUTING.md, Set up).
3. Sanity-check before trusting the environment:
   - `npm run test:unit` (prints `ALL TESTS PASSED`)
   - `npx playwright install --with-deps chromium` once, then `npm run test:browser` (prints `BROWSER E2E PASS`)
   - `npm run test:smoke` (prints `SMOKE PASS`)
   - `pip install usd-core && npm run test:usd-core` (prints `ALL USD FILES VALID`)

If you are handing this to Claude on another account, say something like "continue work on Ptah, project files attached" and upload the repo (or just the zip). README, CONTRIBUTING and this file are enough context to pick up without re-deriving decisions.

## Where things stand: v0.9.3

0.9.3 fixes the top of a skeptical review of 0.9.2 (quality only, no features).
- **Profile picker (`renderer/js/app.js`):** `levelUntouched()` (not dirty, no file, no objects) decides both whether the picker is offered (at launch, after a failed restore, on Dismiss) and whether `pickProfile` treats the level as fresh. Only a fresh level skips the undo record and is marked clean.
- **Import (`usd.js`):**
  - `opValues()` indexes a prim's `xformOp:*` values once (string-aware, cached per attribute text), so reading N listed ops is linear.
  - `opMatrix4()` bracket-matches a `matrix4d` value before reading rows; the old regex backtracked on runs of spaces.
  - `selectedVariant()` parses a frame's `variants = { ... }` selections once into `frame.sel`.
  - `parseBlocks` counts variant nesting and throws past `MAX_DEPTH`.
  - `importUsda` wraps `readUsda` and resets the op and string-span caches when it finishes, so neither keeps the file or a prim's attribute text alive.
  - `opMatrix4()` accepts exactly four rows of four numbers, comma-separated; trailing text, a fifth row or an empty field refuses the value.
- **Walk (`walk.js`):**
  - `sweepHits()`: a body already within its radius of a slice may not `crosses()` it, as well as not get closer; one starting exactly on a one-sided face may not end behind it. The slice takes an on-height vertex once, from itself, and spans the two farthest points if there are three.
  - `WALKABLE` is cos 45° − 1e-9.
  - Airborne feet are `y0 + vy0·t − g·t²/2` at `airT`, not a per-frame velocity step.
- **Tests:** usd.test times each import cliff. The browser E2E has a step for the picker over work. walk.test adds tunnelling at 20–60 fps, the jump arc at 20–144 fps, the exact 45° ramp, slice vertex order, knee width, one-sided floors, the clip's own jump keys, the landing absorb, cache invalidation, thin-floor landing at 20 fps and the run speed. A mutation check of walk.js (the review's 13 behaviour changes, plus 4 for this release's fixes) now fails a test for each but one, which is equivalent: the farthest-pair step covers a vertex taken twice.

Next up (proposed): 0.9.4 with the review's medium USD items (nested variant strength, over/def inside variants, silent references and payloads, inf/nan points), the Unity tool's single-quoted names, and a release gate on full CI.

## Where things stand: v0.9.2

0.9.2 finishes the 0.8.9 review.
- **Editor input (`renderer/js/app.js`):**
  - The capture-phase shortcut handler stops a Ctrl+S / Ctrl+O it has handled, so the bubble handler cannot run it again.
  - Placing a note cancels the pointerdown's default action, so `mousedown` cannot take focus off `insp-text`.
  - `orbit.touches` maps one finger to nothing (the tools own it) and two fingers to `DOLLY_ROTATE`.
  - A Hierarchy row treats a second click (`e.detail === 2`) as rename, because the first click rebuilds the list and the browser's `dblclick` lands on a detached row.
  - Scale snapping moved out of TransformControls into `snapSize()`, which snaps only the axes a drag changed and floors at `MIN_SIZE`.
  - The Size field goes through `clampScale()`.
  - `detachSubtree()` untints selected records before removing them from `state.objects`.
- **`reference.js`:** the slider captures the opacity before a change on its first `input` event, not only on pointerdown.
- **Import (`usd.js`):**
  - Variant frames keep their metadata and the enclosing variant (`outer`); a set's selection is looked up on the prim first, then outwards through them.
  - `INACTIVE_RE` skips `active = false` prims with their subtree.
  - `leftHanded` meshes have each face reversed.
  - `HEAD_RE`, `VSET_RE` and `VARIANT_RE` accept single-quoted names.
  - `isInvisible()` reads `visibility` string-aware and is applied to a folded mesh too.
- **Unity (`PtahMarkers.cs`):** `PrimHeads()` finds each prim's body brace by skipping its metadata string-aware.
- **Releases (`release.yml`):** each platform gets only its own certificate secrets.

The browser E2E has a real-input step (Playwright mouse and keyboard, CDP touch) covering the editor fixes.

## Where things stand: v0.9.1

0.9.1 reworks walk-mode collision in `renderer/js/walk.js` (the review findings for walk mode). `support()` casts down at the body's centre and at 8 points on 0.9 × the capsule radius; the edge samples count only near-flat surfaces (within 5°). The feet snap to the highest of them, and `viewFeet` eases the camera and mannequin. `blocked()` is a swept-circle test, not rays. `sweepHits()` slices every non-walkable face (steeper than 45°) that the body is in front of at two heights: `feetY + stepHeight + 0.01` (a hair above step height, so a riser of exactly `stepHeight` is a step and anything taller is a wall), with the capsule's narrower radius there, and `feetY + radius` at full radius. The move is refused if the circle, swept along the frame's move, comes within its radius of a slice; a body already overlapping may still move away. Faces are cached in world space per mesh (`worldTris`) and skipped by bounding box. Meshes with more than 64 triangles also get an x/z grid (`buildGrid`, `eachTri`). The floor queries (`floorAt`) use the same cache instead of `THREE.Raycaster`, with the raycaster's one-sided-face rules. A frame costs about 0.2 ms with a 100k-triangle terrain nearby, against 88 ms in 0.9.0. Back faces are ignored unless the material is double-sided, so a ramp's far side and a box the body starts inside do not block. More than a step down starts a fall; on a slope the threshold allows for the frame's travel times the floor's grade. Walking *down* a slope steeper than 45° is allowed (the engines slide you down it). The jump clip is driven from the physics: its `takeoff`/`touchdown` keys are glTF extras written by `tools/mannequin/build-mannequin.mjs`, estimated for converted Mixamo clips. `onView(view, chosen)` tells app.js whether V picked the view. `test/walk.test.mjs` (part of `npm run test:unit`) covers every profile: stairs, the Step run preset, step-height boxes, ramps, slits, posts, the Doorway preset, falls, held Space and the jump clip timing. Next up: 0.9.2 (editor input bugs, smaller import gaps, Windows signing variables).

## Where things stand: v0.9.0

0.9.0 is the first release from a code review of 0.8.9, covering the findings that could lose work or hang an import. Autosave (`renderer/js/autosave.js`): `peek()` moves the tab's own snapshot to a held key (`session:<id>:offered:<n>`) before offering it, so work begun behind the recovery bar autosaves beside it; `keep(extra)` writes a snapshot of a clean level, which `saveFileNow` uses after a download save until `localStorage['ptah.downloadsConfirmed']` is set by dismissing such a copy; and `onError` fires once on the first storage failure. The Restore handler calls `platform.forgetFile()`, which in Electron clears `knownPaths` in `main.js` (`ptah:forget-paths`), and `adopt(key)`, which copies the restored snapshot under the tab's key; if that copy fails, the offered key stays linked to the level and `clear()` deletes it with the tab's own. An offered snapshot the user has not chosen on stays until Restore or Dismiss, including through Save, New, Open and Discard on close. Electron: `main.js` takes `requestSingleInstanceLock()` (a second launch focuses the first window), and "Discard changes" on close sends `ptah:discard-snapshot` with a request id and waits up to 1 s for `ptah:snapshot-discarded` with the same id before closing (preload `onDiscardRequest`). Import (`renderer/js/usd.js`): the layer dictionary, variant selection and `xformOpOrder` lookups use `findKey` plus `matchBracket` instead of lazy or negated-class regexes, which were quadratic; stage `upAxis`/`metersPerUnit` are read from `topLevel(head)`, which blanks nested brackets; `faceVertexCounts` counts against `MAX_FACES`; `displayColor` goes through `readFirstTuple`. The smoke test now covers the single-instance lock (`test/fixtures/second-instance.js`) and Discard-on-close. Next up: 0.9.1 (walk-mode collision and animation) and 0.9.2 (editor input bugs, smaller import gaps, Windows signing variables).

0.8.9 makes the web build forget its file handle whenever a write falls back to a download, so a refused Save As to a same-named file in another folder can no longer lead the next Save into the old file. 0.8.8 stops treating a refused file permission (`NotAllowedError`) as a cancelled picker in the web build: a refused write falls back to a download, a refused read reports an error. 0.8.7 makes Ptah Levi Sterling's project (LICENSE, package metadata and docs; the app identifier is now `com.levi-sterling.ptah`) and keeps the walk-mode hint bar inside the viewport. 0.8.6 replaces the Mixamo mannequin with an original one generated by `tools/mannequin/build-mannequin.mjs`, adds a run clip that walk mode picks by speed, and so closes the Mixamo licence question. 0.8.5 fixes one more file-handling bug from the same review: in Chrome and Edge, an Open whose import failed left Ptah holding the other file, so Save could overwrite it; the web platform's `openUsd` now returns an `adopt()` the app calls only after a successful import. 0.8.4 fixes three races found by an external review of 0.8.3: a save finishing after New or Open no longer renames or cleans the new level, Save As pressed during a save is queued instead of dropped, and a reference image still decoding is dropped when the level or the image choice changes. 0.8.3 versions everything the web build loads per deploy, matches Unity markers by prim path (and compiles the Unity script in CI with mono), frees GPU memory held by objects that drop out of undo history, and reframes the docs for level designers generally. 0.8.2 fixes what a full code review of 0.8.1 found (about 40 items across the editor, the USD reader, the Electron shell, the engine scripts and CI) plus the first/third-person switch; `CHANGELOG.md` has the list. 0.8.1 was a fix release on top of 0.8.0: walk-mode collision with markers, the origin capsule during a walk, ground-size edge cases, test hardening, and a release workflow that can create its own tag. `CHANGELOG.md` has the list. Everything below about 0.8.0 still holds.

0.8.0 comes out of a full code review of 0.7.3 (the commits cite review item codes such as E1 and F3). It adds one level setting, makes the editor keyboard-usable, and hardens import, saving and the Electron shell. `CHANGELOG.md` has the full list. The parts a maintainer needs to know:

- **Ground size** is a per-level setting (`customLayerData "ptah:ground"`, written only when it differs from 4096). The drawn grid is at least that wide and doubles to cover anything built past it. Fog, far plane and zoom-out follow it.
- **Keyboard access.** The Hierarchy is an ARIA tree with one tab stop. Tab enters walk mode only when nothing has focus, so it is no longer a keyboard trap.
- **Gestures.** While a gizmo drag, placement or extrude is in progress, only Esc acts: it cancels and puts everything back. Undo, Delete, Group and Hierarchy moves wait until the gesture ends.
- **Autosave is per tab** (`sessionStorage` key, `BroadcastChannel` roll call to find closed tabs). Open or a dropped file discards the old scene's snapshot.
- **Saving.** Desktop saves are atomic (temp file, flush, rename) and keep `<name>.bak`. A save marks clean only what it wrote; an edit made mid-save stays dirty.
- **Foreign `.usda`** honors `xformOpOrder` and wraps a Z-up or metre-based file in one converting group. It skips `class`/`over` prims and unselected variants. Nesting is capped at 62 levels (`MAX_NESTING` in `usd.js`) on import and in the editor.
- **Electron shell.** Explicit macOS menu with display-only accelerators. Permissions denied except pointer lock. The smoke test boots the real `main.js`.
- **Rendering** idles at four frames a second after 1.5 s without input, and recovers from a lost WebGL context.
- **Pages** publishes the scripts, three.js, the mannequin and the stylesheet under one `v-<commit>/` folder (`tools/prepare-pages.mjs`, which also rewrites the import map and its CSP hash) so a browser never pairs a new `index.html` with old modules.
- `ptah:id` is 64 random bits for new objects; existing ids are kept.

**CI and releases.** CI (`ci.yml`) runs on every pull request and push to `main`: unit tests, the browser E2E, the Electron smoke test and usd-core validation. Pages deploys only after CI passes on `main`. **Installers are not built by CI.** `release.yml` builds them when a `v*` tag is pushed, or when it is run by hand with a `tag` input (it then creates the tag and the Release on the built commit, after checking the tag matches `package.json`); `build-windows.yml` builds a Windows installer on manual dispatch only. Desktop installers still need hands-on validation on their target platforms and the signing / notarization decisions. Double-click launchers remain the lowest-friction offline path because they only need Node.js and a browser.

## v0.7.1

Scale fix from review: the mannequin is scaled to a new **characterHeight** metric (visible mesh: 180 in every template; UE's 192 is the capsule) and walk mode uses a new **fov** metric (horizontal: UE 90, Unity 66). Both are profile numbers, saved in the file. The Unity 66° comes from Cinemachine's default 40° vertical at 16:9 and is not confirmed against the Starter Assets prefabs; the UE 90 is the template default.

## v0.7.0

Third-person walk. `V` switches views; third-person profiles start in third person. The mannequin is original: a segmented drawing-mannequin figure generated by `tools/mannequin/build-mannequin.mjs` (`npm run mannequin`), with idle, walking and running (two-bone IK, planted stance foot rolling heel to ball) and jump clips authored as motion functions, so no third-party asset or licence is involved. It is a skinned glTF read by `renderer/js/gltf.js`, a minimal glTF loader (three.js core has none); unit tests check that the rest pose reproduces the bind pose, the clips bind, the stance foot is planted and no clip pushes the mesh below the floor. It is embedded as a base64 module (`renderer/assets/mannequin.glb.js`, about 450 KB) because the CSP forbids fetch and Electron's file:// cannot be fetched anyway. Until this change it was a Mixamo character; `tools/mixamo/fbx2ptah.py`, a from-scratch binary-FBX reader, still converts one to the same format for teams with their own Mixamo licence. 66 E2E steps.

**Known gaps in the controller:** no crouch clip (crouching plays the walk, and crouch is camera-only in first person); no strafe or turn clips (the character orients to movement, as the UE template does); no head collision; the boom does not smooth. All fine for a scale check.

## v0.6.0

Closes the second hands-on review: rail regrouped (Q W E R X / C Y S P V T / M N K), one mode active at a time (Q = select without gizmo; W/E/R with), the `K`-dies-after-a-picker focus bug (menus swallowed letters), clicked buttons drop focus, Position Y center/base readout, and a snapping stress step. 65 E2E steps. No file format change.

## v0.5.1

Bug-fix and snapping release from the second hands-on review. Fixed: falling through floors when jumping (landing is now a sweep between the previous and current feet position; frame time clamped to 50 ms) and the UE template capsule sizes (192 × 42 third person, 192 × 55 first person, from the templates' `InitCapsuleSize`, not the class defaults). Changed: grid snapping snaps the selection's bounding box (min corner and bottom) to grid lines instead of the object center, so blocks tile; Shift held inverts the Snap setting live (placement, move, rotate, extrude). 61 E2E steps, including a fall-through regression that fails on the old code.

The review items listed here at v0.5.1 all shipped in v0.6.0.

## v0.5.0

v0.5 replaced Ptah's invented default metrics with the four engine templates designers actually start from, chosen in a picker before a new level loads (Unreal Third/First Person, Unity Third/First Person Starter Assets). Core numbers are the templates' own; cover/door/corridor sizes are derived by rules in `metrics.js` and remain editable. Capsule radius became a metric (markers, walk body, door width). Also: marker button on the rail, ticks feedback in an empty scene, version in the UI, 32 u preset walls. 60 E2E steps. The file's metrics dictionary gained `profile` and `capsuleRadius`; older files load as Custom.

**Template numbers not confirmed from a running editor** (everything else was checked against the template sources): UE eye heights (160 = capsule center 96 + BaseEyeHeight 64; FP camera at +60 → 156), Unity controller radius 0.28/0.5, camera root 1.375 and step offset 0.25. One look in each editor settles them; they live in `PROFILES` in `renderer/js/metrics.js`.

## v0.4.0

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

**Verified in CI:** unit tests, the browser E2E (79 scenario steps plus the runner's web-save, reload-recovery, idle-rate and narrow-topbar checks), the Electron smoke test, usd-core validation of the checked-in `.usda` files (and of the Unreal marker placement), and the Unity marker script compiled with mono against Unity API stand-ins and run on an exported level (`npm run test:unity`). Installers are built on release tags, not in CI. **Still not manually verified in an engine or on target machines:** the Unreal and Unity marker-import scripts, plus hands-on installer smoke tests. `tools/unreal/ptah_import.py --dry-run test/sample.usda` remains the cheapest first check once `usd-core` is installed; the Unity script still needs one real Editor pass (the CI check uses stand-ins for the Unity API, not Unity).

v0.2 recap, still accurate: the object model is a real scene tree with the features the roadmap asked for:

- groups and parenting (Ctrl+G, drag and drop in the Hierarchy), preserving world transforms, exported as nested Xforms and re-imported without flattening
- multi-select (Shift+click, marquee, Ctrl+A) with a centroid pivot gizmo; gizmo scale snap on single objects
- wedge and stairs primitives (stairs are watertight with a per-object step count)
- notes pinned in the scene, exported as named empties with their text
- walk mode, first person at eye height or third person with the mannequin, with a capsule-wide body that walls and narrow gaps block and that climbs stairs and ramps up to 45°
- reference image underlay embedded in the file
- a browser build that shares every line of renderer code with Electron (`renderer/js/platform.js` is the seam)
- Electron 44 / electron-builder 26, unsaved-changes close guard, signing and notarization config, app icon, LICENSE, CI, Pages deploy, tagged releases

v0.2's own verification notes are in the 0.2.0 section of `CHANGELOG.md`; those old CI gaps are closed, so the remaining validation work is now the engine-side and target-machine manual checks.

**Key decisions already made. Don't re-litigate these without a reason:**

- Gameplay data (`ptah:marker`, `ptah:intent`, `ptah:tags`) goes out as `custom` **attributes** on the Xform, not `customData`: attributes are what engine importers and `usdview` expose. Ptah-internal metadata (`ptah:type`, `ptah:name`, `ptah:steps`, `ptah:text`, `ptah:id`) stays in `customData`.
- The metrics profile is per file, always written, and defaulted (not errored) when a file lacks it. Presets are generated from it at click time; changing the profile does not resize existing objects (that would be a surprising retroactive edit; markers and their height ticks do redraw).
- Marker facing is local −Z (the walk camera's look direction at rotation 0). The conversion to UE (+X forward, Z-up) and Unity (+Z forward, left-handed) lives in the scripts, not the file.
- Intent is the only color. Defaults by type (cube/cylinder wall, plane/wedge/stairs floor, sphere placeholder) so a fresh scene already speaks the vocabulary.
- Face snapping uses world AABBs and is off by default; it snaps each axis independently.
- Multi-object numeric fields edit local values.
- Autosave is a plain export text in IndexedDB, so recovery is an ordinary file load. It never throws into the editor.
- Metrics come from a picked engine profile, never from Ptah's opinion. Add a profile by adding to `PROFILES`; derived sizes follow from `deriveMetrics()`. Don't hard-code a cover or door size anywhere else.
- There is no standalone player figure. The PlayerStart marker is where walk mode starts (selected first, else the first in the scene, else the camera target) and capsule markers carry the height ticks. Don't reintroduce a fixed figure.
- Extrude is a TRS edit (scale along one axis, position by half the delta). It keeps every primitive a scaled unit mesh, which is what the export, the manifold tests and face snapping rely on. True mesh editing (cutouts, extruding sloped faces) needs a mesh type with real editing, not a change to extrude.

- 1 scene unit = 1 cm (`metersPerUnit = 0.01`), Y-up. Matches Unreal directly; Unity's USD importer converts.
- Rotation is USD/Maya `rotateXYZ` (X first) everywhere: every node has three.js Euler order `'ZYX'`. v0.1 used three's default `'XYZ'` and wrote those angles as `rotateXYZ`, which is a different rotation for compound angles. Do not change the order back; the unit tests and the usd-core fixture will fail if anyone does.
- Objects export as baked `Mesh` prims (not USD gprims) for cross-importer consistency.
- Object "Size" in the inspector = its scale = its dimensions in units. Children inherit parent scale, exactly like the engines; groups exist so designers can organize without stretching.
- The Three.js scene graph is the single source of truth for hierarchy and ordering. Records have no parent/children fields; helpers read `node.parent` and `node.children`. This removed a whole class of two-sources-of-truth bugs.
- Every structural operation returns an undo command; multi-object operations are compounds. Keep that pattern.
- Helper visuals (note pins and labels, group markers) sit under their node for picking and visibility but get an exact world-aligned matrix each frame so they never inherit rotation or scale. Anything new that must keep a constant on-screen size should use `markHelper()`.
- Only Esc acts during a gesture (drag, placement, extrude). Everything else that changes the scene waits for the gesture's own undo record. This is what keeps history consistent; don't add a shortcut that bypasses it.
- A save marks clean only the revision it wrote. Anything edited during the write stays dirty.
- Autosave snapshots are keyed per tab, never shared.
- macOS menu accelerators are display-only. The page's keydown handler is the single keyboard path in every build.
- Nesting is capped at `MAX_NESTING` (62) on both import and edit, so every saved file reopens.
- PRs merge with **Rebase and merge**, keeping each commit on `main`.
- The reference image is embedded (downscaled, JPEG unless a small PNG) rather than referenced by path. Files stay self-contained across desktop and browser at the cost of a few hundred KB.
- Shortcuts: Q select (no gizmo), W/E/R select with gizmo, X extrude, C/Y/S/P/V/T place primitives, M measure, N notes, K markers, G snap (Shift held inverts), Shift+G face snap, H ticks, Tab walk, numpad 1/3/7/0 views, Ctrl+G / Ctrl+Shift+G group / ungroup.

**Known v0.3 limitations** (current ones are in `README.md`, Things to know): face snapping is bounding-box based; walk mode has no head collision; multi-edits are local-space; non-uniform parent scale plus rotated children shears (standard scene-graph behavior).

## Backlog (reported, not yet fixed)

- **Pages cache window.** GitHub Pages serves every file with `max-age=600`. A browser holding a cached `index.html` from the previous deploy asks for that deploy's `v-<sha>/` folder, which the new deploy no longer has, so a page cached before a deploy and whose scripts are *not* cached would load blank until the page itself expires (at most 10 minutes). In practice the page and its scripts are cached together and expire together. Pages cannot set per-file headers; the fix, if it ever matters, is to keep the previous deploy's `v-<sha>/` folder in the next artifact.

- **Mac notarization** is enabled in `package.json` but no Apple credentials are configured; electron-builder skips it with a warning. Decide before distributing Mac builds widely.

Closed in 0.8.3: vendor and asset URLs are versioned on Pages; Unity markers are matched by prim path; objects that drop out of undo history free their GPU memory.

Closed in 0.8.2: *1st/3rd-person switch did not seem to work* was a pointer-lock mouse jump pinning the pitch, plus a third-person boom that went under the floor.

Closed in 0.8.1: *mannequin still visible after switching to first person* was the origin Player start's capsule, recreated visible by any marker rebuild during a walk (a metrics or profile edit, `H`). The rebuild now keeps it hidden, and a scenario step covers it.

## Suggested next priorities

1. **Do the remaining manual validation**: one Unreal session, one Unity session, and hands-on desktop installer smoke tests on the target platforms. Add screenshots of a real import to `docs/importing.md`. Checklist per platform:
   - Launchers: `Launch Ptah.bat` (Windows), `Launch Ptah.command` (macOS), `launch-ptah.sh` / `Ptah.desktop` (Linux) each open the editor, and each says where to get Node.js when it is missing.
   - Installer: install, launch, Save As, reopen the file, close with unsaved changes (the prompt appears; Cancel keeps the window).
   - **Packaged Mac app only:** Cmd+Z / Cmd+Shift+Z undo and redo exactly once per press (not twice, not the browser's text undo); Cmd+S and Cmd+O reach Ptah; Cmd+R does *not* reload the page; there is no Toggle DevTools item; File/Edit menu clicks work. The menu is built in `main.js` (`appMenu`) with display-only accelerators, so the page's keydown handler stays the single keyboard path; if a Cmd shortcut fires twice or not at all, that assumption is what to check.
2. **Distribution decision.** Unchanged from v0.2: the web build on GitHub Pages is the cheapest path to users; desktop builds need an Apple Developer ID certificate and a Windows code-signing certificate (or Azure Trusted Signing).
3. **v0.4 from the gap analysis, in order of value to designers:** orthographic top-down PNG export for reviews; box cutouts (doorways in walls) via CSG, keeping the baked-Mesh export; camera bookmarks; lock/hide on groups; glTF as a second export for pipelines with the USD plugin off; an optional Unreal-style shortcut set; instancing for large scenes.

## A note on testing rigor

If you or Claude add features, hold the same bar the original build did:

- `npm run test:unit` after any change to `usd.js`, `metrics.js`, `snap.js`, `gltf.js` or the mannequin asset (it runs with `--import ./test/register-three.mjs`, which resolves `three` to the vendored build). It checks every closed primitive as a watertight, consistently oriented manifold with the analytic signed volume (valid for concave stairs), string escaping, hierarchy round trips, that `export(import(x))` is byte-identical, that preset sizes track the profile, and the face-snap cases.
- `npm run test:browser` and `npm run test:smoke` exercise the actual UI, not mocks, through one shared `test/scenario.mjs`. Extend the scenario when you add interactions; both runners pick it up.
- Re-validate exports against real USD tooling: `pip install usd-core && npm run test:usd-core`. This caught a real bug during the original build (unquoted namespaced customData keys) that our own parser's round-trip test missed entirely, and v0.2's comment-stripping bug (base64 data URLs contain `//`) was the same species: our reader accepting our writer's mistake.
