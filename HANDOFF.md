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

## Where things stand: v0.13.0

0.13.0 adds a mobile web page at `/Ptah/mobile/`. The owner chose "viewer + light editing" for phones and tablets.
- **One app, two layouts:**
  - `renderer/mobile/index.html` is generated from `index.html` by `tools/build-mobile.mjs` (`npm run mobile`). It adds `class="mobile"`, `../` paths, `mobile.css`, and the import map's CSP hash.
  - `test/mobile.test.mjs` checks that the page is current, that every element id is present, that zoom is allowed, and that `mobile.css` uses no literal colour.
  - `prepare-pages.mjs` rewrites both pages into `v-<sha>/`, and `pages.test.mjs` covers the mobile page.
- **`app.js` (`MOBILE` flag):**
  - `orbit.touches.TWO = DOLLY_PAN`.
  - A touch marquee on empty space in the select tool becomes `orbitByPixels`, and a tap still clears the selection.
  - `transformCtl.setSize(1.5)`.
  - `createWalkMode({ pointerLock: false })`: a lock taken under emulation reported every touch at x = 0.
  - It loads `js/mobile.js` with `{ walk, canvas, frameSelection, setView }`.
  - The hierarchy's empty text is worded for touch.
  - A `ResizeObserver` (0.12.0) keeps the canvas right as the sheet opens.
- **`mobile.js`:**
  - `#sheet-tabs` (role tablist) shows one sidebar section at a time on phones; a phone is narrower than 768 px or shorter than 500 px.
  - `#more` collects New, Save As, the theme, preset and marker pickers, the grid, snap and opacity group, Ticks, and view buttons. `arrange()` moves them back in reverse order when a phone becomes tablet-sized.
  - The walk stick drives `walk.stick(x, y)`, where length sets the speed; `walk.lookBy`, `walk.press` and `walk.release` do the rest. A MutationObserver on `#walk-hud` resets the toggles.
- **`walk.js`:** new public `stick`, `lookBy`, `press` and `release`. `pointerLock` is optional.
- **`platform.js`:** no `accept` filter on the mobile page, since iOS and Android grey out `.usda`.
- **The desktop page:** a coarse pointer under 900 px gets `#mobile-offer`, once per session.
- **Tests:** `test/mobile.e2e.mjs` runs on emulated iPhone 13, Pixel 7 and iPad, plus 360 px and 844×390, sending real touches through CDP `Input.dispatchTouchEvent`. It covers:
  - touch targets and sideways scroll;
  - placing, orbit, pinch, tap-select and Inspector edits with undo;
  - a finger gizmo drag;
  - More;
  - walk: stick, jump, crouch, look and exit;
  - rotation;
  - Open and Save on a phone;
  - the desktop offer.

  Playwright's own `tap` on the walk buttons reports the top bar as intercepting, although a raw touch reaches them, so those steps tap with `touchscreen.tap`.
- **Not verified:** real iOS Safari (no WebKit here; it needs 15.4+ for `:has` and `dvh`) and real Android hardware.
- **Not done:** multi-select on phones (there's no box select or Ctrl-click).

Next up (proposed): 0.14.0. The candidates:
- a real-device pass on iOS and Android;
- multi-select on phones (a "select several" toggle);
- head collision for crouching;
- marker visuals in the engines;
- the gap-analysis items.

## Where things stand: v0.12.0

0.12.0 adds interface themes. The owner's brief: five highly accessible, MIT-licensed themes, a top-bar picker, and **the viewport never changes, only the tools on the edge**.
- **The themes:**
  - Ptah, the default;
  - Catppuccin Mocha;
  - Rosé Pine;
  - Primer Light, Primer Light High Contrast and Primer Dark High Contrast (GitHub's palettes).

  Colours were taken from the published packages: `@catppuccin/palette` 1.8.0, `@rose-pine/palette` 4.0.1 and `@primer/primitives` 11.10.0. The notices are in `docs/theme-licenses.md`.
- **Rejected, measured:**
  - Dracula: its comment grey is 3.0:1.
  - Catppuccin Latte: body text is 6.0:1.
  - Tokyo Night: its grey is 4.2:1.
  - Solarized: its red is 2.8:1.
  - Night Owl: its red is on the 4.5:1 line.
  - Nord: Apache-2.0.
  - Modus: GPL-3.0.
- **Mechanism:**
  - `style.css` declares Ptah's tokens on `:root, #viewport`, and each theme is a `:root[data-theme]` block. Because `#viewport` re-declares the tokens, a theme stops there.
  - `themes.js` holds the list; `app.js` fills `#theme-select` and saves the choice as `ptah.theme` in localStorage.
  - `theme-boot.js` is a classic script in `<head>` (the CSP allows no inline script). `prepare-pages.mjs` rewrites its path.
- **Tests:**
  - `test/themes.test.mjs` (in `test:unit`) checks the contrast of every pair the chrome draws. It also checks that every theme defines every token and that no chrome rule writes a literal colour; only viewport overlays and the axis marks may.
  - A scenario step switches themes and checks that the chrome changes while the viewport chips, the toast and the scene background don't.
  - An e2e step checks that the theme is restored before `app.js` runs, and that no top-bar control is clipped and the status bar keeps its right edge from 1024 to 1920 px.
- **Top bar room:**
  - The picker is 104 px, like the other pickers, with short labels (full names in option tooltips).
  - The bar wraps at 1460 px and below, up from 1320. On these Linux fonts 1440 still fits on one row.
  - The file name is its own flex item (`flex: 1 1 0; min-width: 8ch`), so a long name shrinks rather than wrapping the bar.
- **Also:**
  - A `ResizeObserver` on `#viewport` keeps the canvas and camera in step with layout changes.
  - The status bar's `.tb-spacer` is no longer hidden by the top bar's wrap rule.
  - Ptah's `--muted` is now `#9095a4`.
- **Not done:** the Electron window's `backgroundColor` stays Ptah's dark, so a light theme shows a dark frame for a moment at launch.


## Where things stand: v0.11.0

0.11.0 gives walk mode a real crouch. Before it, holding C lowered the first-person eye but the third-person camera and the mannequin stayed standing.
- **Clips (`tools/mannequin/build-mannequin.mjs`):**
  - `crouch`: an idle held low (hips 40 u, lean 50°).
  - `crouchWalking`: the gait engine at hips 45 u, 70 u/s, with short flat steps. A higher heel or a longer stride pushed the trailing knee through the floor at these hip heights.
  - The figure stands about 64% (`crouch`) and 66% (`crouchWalking`) of its idle height.
- **Walk (`renderer/js/walk.js`):**
  - `st.crouchBlend` runs 0 to 1 over `CROUCH_TIME` (0.2 s).
  - `bodyHeight()` lerps `playerHeight` to `crouchHeight` through a smoothstep. The eye (`bodyHeight − crownToEye`) and the boom target (`bodyHeight × 0.55`) follow it.
  - Crouched, the mannequin plays `crouch` or `crouchWalking`. A mannequin without those clips idles and walks as before.
- **The body is not squashed to the profile's crouch height.** UE's crouch capsule is 80 u against a 192 u standing capsule, which would need a 0.65 vertical squash on the 180 u mannequin. That is lower than a person can crouch. So the camera and collision follow `crouchHeight` and the body crouches naturally. In a tunnel sized to the capsule, the head pokes through the ceiling, which is worth seeing before a real character is dropped in.
- **Not done:** head collision. Letting go of C under a low ceiling stands up through it. Scope this separately.
- **Hint bar and README:** "hold C" to crouch.


## Where things stand: v0.10.0

0.10.0 comes from the first run of the Unity marker tool in a real editor: Unity 6.3 LTS with `com.unity.importer.usd` 1.0.0-pre.2.
- **Package (`tools/unity/`):**
  - `package.json`: `com.levi-sterling.ptah`, with the same version as Ptah.
  - Assemblies `Ptah.Markers` (runtime, every platform) and `Ptah.Markers.Editor` (Editor only).
  - A `.meta` with a fixed GUID for every file and folder. Unity ignores a Git package's files that have none.
  - Install with `https://github.com/SMUGSterling/Ptah.git?path=/tools/unity#v<version>`.
  - `test/unity-package.test.mjs` (part of `test:unit`) checks the metas, GUIDs, assemblies, version and install URLs.
- **What Unity 6.3's importer does, as measured:**
  - **No `Root` object:** the prims under Root are children of the asset's object, named after the file.
  - **Units:** positions and mesh points are ×0.01, and `xformOp:scale` is left as authored.
  - **Axes:** Z is mirrored (the older package mirrors Z too).
- **`PtahMarkers.cs`:**
  - `LevelRoot` treats the object with the most of Root's prims as children as Root, so paths read `Root/…` with both importers.
  - `Measure()` takes the unit (the median of |Unity position| / |file translate|) and the mirrored axis (a sign vote over the markers) from the markers.
  - A trigger's `BoxCollider.size` and `PtahMarker.volume` are the measured unit. `PtahMarker.facingLocal` is +Z when Z is mirrored and −Z when X is.
  - The Console reports all of it. When nothing converts, `LevelRoot.report` says where the tool looked.
- **Harness (`test/unity`):** both importers' layouts, a prim the importer left out, the wrong file, and an importer that mirrors X. The level's markers have Z offsets.
- **Removed:** `tools/mixamo/fbx2ptah.py` and its mentions.
- **Also:** a light-import test (a SphereLight with a child).
- **Still unverified:** a real Unreal import. The Unreal script has never run inside Unreal.


## Where things stand: v0.9.9

0.9.9 closes the low-priority findings from the 0.9.2 review, adds a format version, and makes Unity 6.3 LTS the recommended Unity.
- **Versioning:** after 0.9.9 comes **0.10.0**, then 0.11.0 and so on. 1.0.0 is a deliberate decision by the owner, not the number after 0.9.9. The readiness notes are: a format version (done here), signing or a web-first decision, the manual engine checks, the ownership check, and a pilot.
- **Format version (`renderer/js/usd.js`):**
  - `FORMAT_VERSION = 1`, written first in `customLayerData` as `int "ptah:format"`. Every export now has a `customLayerData` block.
  - `readFormat` returns `format` from `importUsda`. Newer formats warn.
  - `customLayerData()` and `topLevelKey()` read only the dictionary's own keys, which also fixes a `ptah:ground` nested in another dictionary being read.
- **Walk (`renderer/js/walk.js`):**
  - `floorAt` has no lower bound. The grid (0) is the floor only when nothing is found and the query starts at or above it. Below the grid with nothing under you it returns `-Infinity`.
  - Falling below `killY()` (the lowest geometry minus `KILL_DEPTH`, 1000) calls `respawn()` to `st.entry`, which `enter` records.
  - The boom's grid clamp applies only where the grid is the floor under the camera (`floorAt` at the camera's x/z returns 0). Over a pit, a basement or terrain below the grid, the level's faces stop it.
  - The landing test's always-true half is gone.
- **Import (`usd.js`):**
  - `INACTIVE_RE` matches usd-core's false spellings.
  - The cylinder axis goes through `readString(topLevel(...))`.
  - Hoisted children of an invisible Scope, and children of an invisible unwrapped Root, are hidden.
  - `declaredSets(frame)` parses `variantSets` list-ops. A variant set's rank is its list index; variants go to `extra`/`nested` as `{ rank, parts }` and are flattened strongest first.
  - Stats `undeclared` (skipped) and `unlisted` (no list: applied, warned).
  - An Xform with any children goes through `childObjects`. A Camera or light with children becomes a group.
  - The units tolerance is 1e-5 relative (`UsdGeomLinearUnitsAre`).
  - `meshData.doubleSided`, and app.js renders such meshes double-sided.
  - `headCache` is released after import.
  - `METRIC_KEYS` is `METRIC_NUMBER_KEYS` from metrics.js.
- **Tools and CI:**
  - The Unity script uses an exact `TryParseKind`: unknown kinds are skipped with a warning, and the dead `MarkerInfo.prim` is gone.
  - `PtahMarker.cs` uses a switch statement, so mono's `mcs` compiles it.
  - `test/unity/run.sh` compiles the real runtime component; the stubs lost their copy and gained `Gizmos`/`Color`/`Matrix4x4`.
  - `fbx2ptah.py` reports unmatched bones. It was only compiled and read: no FBX was available.
  - `usd-validate.py` reports a stage that fails to open, and fails a Ptah file with a non-standard op order.
  - CI pins `usd-core==26.8`, every checkout uses `persist-credentials: false`, and `package.json` has `homepage` and `repository`, so the deb builds from a ZIP copy.
- **Docs:** `docs/importing.md` recommends Unity 6.3 LTS with `com.unity.importer.usd`, adds `docs/unity-import.png`, and explains that markers are empties until the script runs. The older `com.unity.formats.usd` path is a footnote. CONTRIBUTING's file format section covers normals and `ptah:format`.
- **Tests:**
  - `walk.test.mjs [below the grid]`: 5 of 7 checks fail on 0.9.8; the other 2 guard unchanged behaviour.
  - `usd.test.mjs [format version and 0.9.9 import fixes]`.
  - The Unity harness adds gizmos and an unknown kind.
- **Checked afterwards (0.10.0):** the Unity marker script in a real Unity 6.3 editor. Still unverified: a real Unreal import.

## Where things stand: v0.9.8

0.9.8 writes normals on exported primitives.
- **Export (`renderer/js/usd.js`):**
  - `writePrim` writes `normal3f[] normals` with `interpolation = "faceVarying"` directly after `faceVertexIndices`, for primitives only. Imported meshes (`obj.meshData`) have no smoothing information and export without normals, as before.
  - `faceVaryingNormals(geo, primPath)` writes one normal per face-vertex in index order. A flat face writes its Newell normal (`newellNormal`) at every corner.
  - A face flagged in `geo.smooth` writes the average of the smooth faces' normals around each point. `facesToMesh` takes the flags: the cylinder flags its sides (caps stay flat) and the sphere flags every face. A future curved primitive (an arch) does the same. There's a TODO for imported meshes.
  - A face with no area writes `(0, 1, 0)` and `console.warn`s with the prim path. `writePrim` now carries the path.
  - Normals use `num6`: 6 decimal places, no trailing zeros, no `-0`. Every other number keeps `num` (5 places).
- **Tests:**
  - A `[normals]` section in `test/usd.test.mjs` covers:
    - the cube golden values and the attribute's position;
    - the count, unit length, formatting and outward side for every primitive, stairs at 1, 8, 12 and 64 steps included;
    - the signed volume from both the winding and the normals (divergence theorem);
    - flat faces, radial cylinder sides with ±Y caps, and the sphere following its radius;
    - no normals on imported meshes;
    - byte-identical exports, and the degenerate-face warning path.
  - `test/usd-validate.py` checks the normals through usd-core: faceVarying, one per face-vertex, unit length.
- **Checked:** a fresh export with every primitive in Unity 6.3 LTS with `com.unity.importer.usd` 1.0.0-pre.2. Hard edges on the boxes, wedge and stairs, round cylinders and spheres, intent colours.

## Where things stand: v0.9.7

0.9.7 fixes the platform findings from the 0.9.2 review: saving, closing and autosave.
- **Desktop (`main.js`):**
  - `closeWaiting` is checked before anything else in the close handler. Any close while an earlier one waits (for the save, then for the dirty report) is dropped, so there is one prompt.
  - `writeAtomicNow` runs `chmod` on the temporary file with the original file's mode, since `open()` applies the umask.
- **Web (`renderer/js/platform.js`):**
  - A save picker that fails with `SecurityError` or `NotAllowedError` returns `{ error }`. `saveFileNow` toasts it, and nothing is written or forgotten. Other picker failures still download.
  - A failed `createWritable` stream is aborted.
  - A download keeps a `.usd` or `.usda` name as it is and returns the name it used.
- **Reference (`renderer/js/reference.js`):** `load()` resets the placement to the defaults before applying the file's values. `newScene` calls `load(null)`.
- **Autosave (`renderer/js/autosave.js`):**
  - Each tab holds the Web Lock `ptah-session:<id>` while open. `releaseLock()` both aborts the request and resolves the callback's promise, because aborting alone does not release a granted lock. A duplicated tab releases its claim on the original's lock when it rotates.
  - `liveSessions()` unions the roll call with `navigator.locks.query().held`. Duplicate detection stays roll-call-only, because a reload's old page can hold the lock a moment longer.
  - When `peek` cannot move the offered snapshot to its held key, it leaves the snapshot where it is and calls `newSession({ keepLock: true })`. The tab keeps the old session's lock until it closes, so no other tab offers that snapshot meanwhile. This is not reported as "autosave unavailable".
- **Tests:**
  - The smoke test covers the double close and the kept mode. It delays `.tmp` opens and uses umask 022.
  - A browser E2E step covers the download name, the reference reset, a failed offer move (IndexedDB `put` patched to throw) and a busy tab. The File System Access step covers a blocked picker and the abort.
  - Each check fails on 0.9.6.

## Where things stand: v0.9.6

0.9.6 fixes the remaining editor and walk items from the 0.9.2 review.
- **Editor (`renderer/js/app.js`):**
  - `gizmoLockedBy()` maps the gizmo mode to the inspector's field group (`MODE_FIELDS`). `attachGizmo` attaches nothing while a top-level selected object has that group locked (`fieldLocked`), and `setTransformMode` toasts why.
  - `walkPending` is a ticket for a walk waiting on the mannequin. A capture listener drops it on any other key or pointer press (Tab and the Walk button excepted). A second request cancels it. It fires only on the same `sceneGen`, with no picker and no gesture; a ticket from another `sceneGen` is replaced, not toggled. `__ptah.walkPending()` exposes it to tests.
  - The inspector's compound command passes `{ undo: ids, redo: ids }`.
  - `movesNothing()` simulates `moveRecs` on the container's node order and returns early before recording.
  - `setSelection(ids, { restyle: true })` calls `restyleHierarchy()`, which updates classes, aria-selected and the roving tabindex in place. It falls back to `refreshHierarchy()` when a selected object has a row missing for any reason other than a collapsed ancestor (`collapsedAway`). Only selection-only callers pass it: row click, toggle, viewport pick, marquee, select all, Esc, arrow keys.
- **Walk (`renderer/js/walk.js`):**
  - `update()` sets `frameCaches` (every mesh's `worldTris`) once and runs `step()`. `floorAt`, `sweepHits` and the boom read `caches()`.
  - The boom calls `rayDistance()`, a Möller–Trumbore test over the grid cells under the ray, with the raycaster's face-side rules. It matches `THREE.Raycaster` on 300 test directions.
  - `st.airs` counts take-offs. `animate` resets the jump action when `clipAir` is behind, plays the absorb only while the jump action is current, and zeroes `landing` when locomotion takes over.
  - In the air `viewFeet = feetY + lag·(1 − ease)`.
  - `st.jumpQueued` is set on keydown and consumed by the next frame.
- **Tests:** a browser E2E step covers each editor fix, with the mannequin held back by a route; it fails five ways on 0.9.5. walk.test adds boom parity, one mesh query per frame, the third-person frame and mouse-move cost, both jump-clip cases, the mid-slope jump and the tap.

## Where things stand: v0.9.5

0.9.5 finishes the review's medium findings.
- **Import (`usd.js`, `parseBlocks`):**
  - A variant frame collects the bodies of the variants nested in it (`nested`). When it closes, it hands its own body and then theirs to its enclosing variant, or to the owner's `extra`. So attributes read local first, then the outer variant, then inner ones. Every reader takes the first match.
  - Prim frames carry `spec`, `typed` and `rank` (`variantDepth` at the head). An `over` inside a variant is no longer skipped.
  - `composeSiblings()` runs once over the tree after parsing. It merges same-named siblings in rank order: `attrsText`, `meta` and children are concatenated, the type comes from the strongest typed spec, and a group with no `def` is dropped and counted as skipped. So a look variant's `over "C"` colors the local `C`, and a `def` of the same name no longer duplicates it.
  - `refersOut()` counts prims whose own metadata has `references` or `payload`, but not a `delete`, a `None`, or a quoted mention, and warns once.
  - `parseTuples` reads any three comma-separated tokens with `Number`, so `inf` and `nan` fail `validPoints`.
  - Checked against usd-core: a nested variant, an over and a def merged into a local prim, and 0/300 on the random xform stacks.
  - Still open, low: sibling variant sets ranked by text order rather than the `variantSets` list; unlisted variant sets are still composed.
- **Unity (`PtahMarkers.cs`):** one `Lit` pattern covers `"..."`, `'...'`, `"""..."""` and `'''...'''`, with the text in group `v`. `MarkerRe`, `TagsRe` and `StrRe` are built on it. `FirstOutsideStrings()` rejects a match that starts inside a literal, and `Unescape` handles `\'`. The harness level is rewritten with usd-core's own re-save of tricky tags, plus a group body that quotes a marker attribute.
- **CI and releases:**
  - `ci.yml` also runs as a reusable workflow (`workflow_call`). `release.yml` runs it as its `ci` job, and `build` needs it.
  - The release downloads only `ptah-*` artifacts.
  - `pages.yml` uses `cancel-in-progress: false`.
  - A build-only dispatch on the branch exercised the gate before merge.

## Where things stand: v0.9.4

0.9.4 is touch controls (`renderer/js/app.js`).
- **Decided:** one finger is the tool, two fingers orbit, pinch zooms, and three fingers pan. Two fingers stay on orbit, not pan, which the user confirmed after 0.9.3.
- **`touchPan`:** OrbitControls has no three-finger mode (it goes idle at three touches), so app.js tracks touch pointers itself. With exactly three down, it moves the camera and `orbit.target` by the centroid's movement, at right-drag's rate (`panByPixels`, the same formula as OrbitControls' screen-space pan). The map is cleared on each primary touch, so a lost pointerup cannot leave a ghost finger behind.
- **Multi-finger cancel:** the tool's pointerdown ignores non-primary touches. When a second finger lands, `cancelGesture()` takes back what the first one began, and a marquee is dropped.
- **Gizmo during multi-touch:** TransformControls starts a drag from any pointer on a handle. A window capture listener therefore disables it at the first non-primary touch and re-enables it (`!walk.active`) when the last finger lifts, or on the next primary pointer if a pointerup was lost.
- **Clean flag on cancel:** a cancelled placement restores the dirty flag it started from (`placeWasDirty`), but only if `editGen` is still where it was once the object existed (`placeGen`). An inspector or metrics edit made while the placement was held therefore stays unsaved. The check runs before `removeCommand().redo()`, which bumps `editGen` itself. This is safe because `saveFile` first ends any gesture with `endStrayGesture()`, so a file never holds an unrecorded placement. The keyboard already held Ctrl+S during a gesture; the Save button and the desktop menu did not.
- **Gizmo restore:** it is re-enabled only by a primary *touch*. `isPrimary` is per pointer type, so a mouse or pen press says nothing about the fingers.
- **Test:** the browser E2E lands fingers one after another, as real ones do, and checks the following. Two fingers with the cube tool place nothing. Three fingers pan without changing the view direction, measured once the orbit's damping has settled. A third finger on the gizmo moves nothing. One finger still places. A separate context starts from a saved level: two- and three-finger gestures and Esc leave it clean with no recovery snapshot written, and Save tapped mid-placement records the placement first. The test fails on 0.9.3.

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

**CI and releases.** CI (`ci.yml`) runs on every pull request and push to `main`: unit tests, the browser E2E, the Electron smoke test and usd-core validation. Pages deploys only after CI passes on `main`. **Installers are not built by CI.** `release.yml` builds them when a `v*` tag is pushed, or when it is run by hand with a `tag` input (it then creates the tag and the Release on the built commit, after checking the tag matches `package.json`). It first runs the whole CI suite on that commit (`ci.yml` as a reusable workflow), so no installer is built from a commit that fails any of it; `build-windows.yml` builds a Windows installer on manual dispatch only. Desktop installers still need hands-on validation on their target platforms and the signing / notarization decisions. Double-click launchers remain the lowest-friction offline path because they only need Node.js and a browser.

## v0.7.1

Scale fix from review: the mannequin is scaled to a new **characterHeight** metric (visible mesh: 180 in every template; UE's 192 is the capsule) and walk mode uses a new **fov** metric (horizontal: UE 90, Unity 66). Both are profile numbers, saved in the file. The Unity 66° comes from Cinemachine's default 40° vertical at 16:9 and is not confirmed against the Starter Assets prefabs; the UE 90 is the template default.

## v0.7.0

Third-person walk. `V` switches views; third-person profiles start in third person. The mannequin is original: a segmented drawing-mannequin figure generated by `tools/mannequin/build-mannequin.mjs` (`npm run mannequin`), with idle, walking and running (two-bone IK, planted stance foot rolling heel to ball) and jump clips authored as motion functions, so no third-party asset or licence is involved. It is a skinned glTF read by `renderer/js/gltf.js`, a minimal glTF loader (three.js core has none); unit tests check that the rest pose reproduces the bind pose, the clips bind, the stance foot is planted and no clip pushes the mesh below the floor. It is embedded as a base64 module (`renderer/assets/mannequin.glb.js`, about 450 KB) because the CSP forbids fetch and Electron's file:// cannot be fetched anyway. Until this change it was a Mixamo character; `tools/mixamo/fbx2ptah.py`, a from-scratch binary-FBX reader, converted one to the same format for teams with their own Mixamo licence (removed in 0.10.0). 66 E2E steps.

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
