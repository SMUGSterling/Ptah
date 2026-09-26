# Developing Ptah

This page is for people changing Ptah. For using it, see [README.md](README.md). For the project's state, decisions and backlog, see [HANDOFF.md](HANDOFF.md).

Ptah is built with Three.js (vendored, r168) and runs two ways from the same renderer code:
- **Desktop app** (Electron): native file dialogs, an unsaved-changes guard, and installers for Windows, macOS and Linux.
- **Web build:** the `renderer/` folder served as static files. GitHub Pages publishes it after CI passes on `main`.

Both builds work fully offline: there is no server and no network access at runtime.

## Set up

```bash
npm ci             # Electron, electron-builder, Playwright
npm start          # desktop app
npm run web        # web build at http://localhost:8123

# once per machine, before running the tests
npx playwright install --with-deps chromium   # browser for the E2E tests
pip install usd-core                          # Pixar USD, for npm run test:usd-core
sudo apt-get install mono-mcs mono-runtime    # Linux, for npm run test:unity (brew install mono on a Mac)
```

You need Node.js 22 or newer. `.nvmrc` pins 22, which is what CI runs; the current LTS (24) works too. On Linux, prefer [nvm](https://github.com/nvm-sh/nvm) over the distro package: `nvm install` in the repo picks up `.nvmrc`.

**Linux and the Electron sandbox.** Ubuntu 24.04 and later restrict unprivileged user namespaces, so Electron falls back to its SUID helper, which npm cannot install with the right ownership. `npm start` detects this (`tools/check-electron-sandbox.mjs`) and prints the fix instead of crashing with a SIGTRAP:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Repeat this after every `npm ci` or Electron upgrade, since `node_modules` is recreated. Don't reach for `--no-sandbox`, and don't disable the AppArmor restriction system-wide. The web build is unaffected.

## Test

```bash
npm test                   # unit + browser E2E (CI also runs smoke and usd-core)
npm run test:unit          # USD layer: geometry manifolds, round trips, fixtures
npm run test:browser       # web build in headless Chromium, screenshot in test/.out/
npm run test:smoke         # the same scenario under Electron (desktop)
npm run test:smoke:headless  # ... under xvfb on Linux
npm run test:usd-core      # Pixar's usd-core opens every .usda; also checks the Unreal marker placement
npm run test:unity         # compiles the Unity marker script with mono and runs it on an exported level
```

The browser and Electron runners share one scripted session, `test/scenario.mjs`, which drives the real UI rather than mocks: every primitive, groups, reparenting, selection, intents, notes, markers, walk mode, metrics, presets, snapping, extrude, the reference underlay and a full export → import round trip, with undo and redo checked after structural changes. The browser runner also reloads the page to test autosave recovery, and checks the idle frame rate and a narrow window.

`test/usd-validate.py` is the check Ptah's own parser cannot give: Pixar's reference implementation opening what Ptah writes. Run it after any change to `usd.js`.

Hold the same bar when adding features: extend `scenario.mjs` for new interactions and `usd.test.mjs` for anything that touches the file format.

## Build installers

```bash
npm run dist           # current platform
npm run dist:win       # Windows (NSIS installer + portable)
npm run dist:mac       # macOS (dmg + zip); needs a Mac
npm run dist:linux     # Linux (AppImage + deb)
```

electron-builder cross-compiles Linux and Windows from Linux.

## Release

1. Bump `version` in `package.json`, run `npm install --package-lock-only`, and set `APP_VERSION` in `renderer/js/app.js` to match.
2. Run `npm run samples` to regenerate `test/sample.usda`. The unit tests check that all three version numbers agree.
3. Add the version's section to `CHANGELOG.md`, and update "Where things stand" in `HANDOFF.md`.
4. Open a PR and merge it with **Rebase and merge**.
5. In GitHub, go to **Actions → Release desktop builds → Run workflow** on `main` with `tag` set to `vX.Y.Z`. The workflow:
   - checks the tag against `package.json`;
   - builds on Windows, macOS and Linux;
   - creates the tag and the GitHub Release with the installers attached.

   Pushing a `v*` tag does the same.

### Signing

Without signing secrets the installers are unsigned. Windows then shows SmartScreen, and macOS needs right-click → Open the first time. To sign, add repository secrets and the release workflow picks them up:
- **Windows:** `CSC_LINK` (a base64 `.pfx` or an https URL) and `CSC_KEY_PASSWORD`, or Azure Trusted Signing under `build.win.azureSignOptions` in `package.json`.
- **macOS:** `CSC_LINK` / `CSC_KEY_PASSWORD` for a Developer ID Application certificate, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. The hardened runtime and entitlements are already in `build/`.

Certificates for a university-owned app usually come through the institution's developer program; check with the office that holds SMU's Apple Developer and Microsoft accounts before buying one.

## Architecture

```
main.js                  Electron main: window, file dialogs (IPC), atomic save with .bak, close guard,
                         macOS menu, permission handler (pointer lock only)
preload.js               contextBridge: saveUsd / openUsd / confirmDiscard / setTitle / setDirty / onMenu
renderer/
  index.html             UI shell, import map for the vendored Three.js, CSP
  style.css              editor chrome
  js/app.js              scene graph, tools, selection, hierarchy, inspector, files
  js/usd.js              .usda writer and reader, primitive geometry (pure JS, no DOM)
  js/metrics.js          engine profiles, derived sizes, presets, intents, marker kinds (pure JS)
  js/snap.js             face-to-face snapping math (pure JS)
  js/history.js          undo / redo stack
  js/autosave.js         per-tab IndexedDB recovery snapshots
  js/platform.js         host seam: Electron IPC or browser file APIs
  js/walk.js             first- and third-person walk mode
  js/character.js        the walk-mode mannequin
  js/gltf.js             minimal glTF 2.0 reader for the skinned mannequin
  js/reference.js        reference image underlay
  assets/                mannequin.glb(.js), generated by tools/mannequin; see assets/README.md
  vendor/                Three.js r168 + OrbitControls + TransformControls; see vendor/VENDORED.md
test/                    unit tests, the shared scenario, browser and Electron runners, usd-core validator,
                         samples and fixtures, the static server behind npm run web
tools/
  unreal/ptah_import.py  turns markers into PlayerStart / TargetPoint / TriggerBox actors (UE Python)
  unity/                 Editor menu + PtahMarker component that convert imported markers
  mannequin/             build-mannequin.mjs: generates the walk-mode mannequin (npm run mannequin)
  mixamo/fbx2ptah.py     binary FBX → skinned glTF converter, to use a Mixamo character instead
  prepare-pages.mjs      packages renderer/ for Pages: scripts, three.js, assets and CSS under one v-<sha>/ folder
  check-electron-sandbox.mjs  Linux pre-flight before npm start
docs/                    engine import guide, the v0.3 level-designer brief, README screenshots
.github/workflows/       CI, Pages deploy, releases, manual Windows build
```

Every object is a record whose Three.js node *is* the USD `Xform`: a `Mesh` for geometry, a `Group` for groups, notes and markers. Parenting is the Three.js parent/child relation, so the editor, the export and the engines compose transforms the same way. The renderer runs sandboxed with context isolation; the only privileged surface is the IPC in `preload.js`.

## File format

Ptah writes plain-text `.usda`:
- **Units and rotation:** 1 unit = 1 cm (`metersPerUnit = 0.01`), Y-up. Rotation is USD/Maya `rotateXYZ`: X, then Y, then Z, about the parent's axes.
- **Objects:** each object is an `Xform` with translate / rotateXYZ / scale, and geometry sits in a child `Mesh "Geom"`. Children are nested `Xform`s.
- **Why baked meshes:** Ptah writes meshes rather than `Cube` / `Sphere` gprims because `Mesh` is the one prim type every importer handles the same way. Stairs are watertight with no T-junctions, so engine collision generation stays clean.
- **Groups, notes and markers** are empty `Xform`s.
  - Markers carry `custom string ptah:marker` (`PlayerStart`, `Spawn`, `Cover`, `Objective`, `Trigger`) and optional `custom string[] ptah:tags`.
  - A trigger volume's box size is its scale.
- **Intent** is `custom string ptah:intent` on the `Xform`, and the same colour is in the mesh's `displayColor`.
- **Attributes vs customData:** marker, intent and tags are attributes because they are data for engines. Ptah's own bookkeeping (`ptah:type`, `ptah:id`, `ptah:name`, `ptah:steps`, `ptah:text`, `ptah:color`) is in `customData`.
- **Layer data:** the stage's `customLayerData` holds three dictionaries, all ignored by engines:
  - `ptah:metrics`: `string profile`, `string base` (a Custom profile's template), and one `double` per metric;
  - `ptah:reference`: the embedded underlay;
  - `ptah:ground`: `double size`, written only when it isn't the default.
- **Round trips:** exporting an imported Ptah file reproduces it byte for byte (a unit test checks this).
- **Foreign files:**
  - `Cube` / `Sphere` / `Cylinder` gprims become primitives, other `Mesh` prims generic meshes, and `Xform`s and `SkelRoot`s with children become groups. `Scope` and `Material` prims are skipped.
  - Every standard xform op is composed in `xformOpOrder` order; only a sheared result is approximate.
  - Only one layer is read: references, payloads, sublayers, `class` / `over` prims and unselected variants are not composed.
  - Animated values import as their defaults.
  - Groups nest at most 62 levels deep, so every saved level reopens.

## Project

- **Owner:** SMU Guildhall Academic Technology. **Maintainer role:** Guildhall Academic Technology Service Director.
- **Why the project is public:** the web build is a static client-side tool with no accounts, no data collection and no runtime network requests. Its Content-Security-Policy sets `connect-src 'none'` and loads code only from the app itself. Public hosting exposes no SMU data.
- **Retirement:** retire the project if no course uses it for two consecutive semesters; review that each fall.
