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
build/                icon and macOS entitlements
docs/                 README screenshots (regenerate with node test/screenshots.mjs)
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

## Where things stand: v0.2.0

v0.1 shipped the core editor with a flat hierarchy. v0.2 rebuilt the object model around a real scene tree and added the classroom features the roadmap asked for:

- groups and parenting (Ctrl+G, drag and drop in the Hierarchy), preserving world transforms, exported as nested Xforms and re-imported without flattening
- multi-select (Shift+click, marquee, Ctrl+A) with a centroid pivot gizmo; gizmo scale snap on single objects
- wedge and stairs primitives (stairs are watertight with a per-object step count)
- notes pinned in the scene, exported as named empties with their text
- first-person walk mode at player eye height with wall blocking and stair/ramp following
- reference image underlay embedded in the file
- a browser build that shares every line of renderer code with Electron (`renderer/js/platform.js` is the seam)
- Electron 44 / electron-builder 26, unsaved-changes close guard, signing and notarization config, app icon, LICENSE, CI, Pages deploy, tagged releases

**Verified in this build:** unit tests, and the browser E2E under headless Chromium (the same scripted session the Electron smoke test runs). **Not verified in this build, because the build machine could not download Electron or usd-core:** the Electron smoke test on Electron 44, `npm run dist`, and the usd-core validation of the v0.2 file format. All three run in CI on the first push; run them locally first (step 4 above). The Electron API surface Ptah uses (BrowserWindow, dialog, ipcMain, contextBridge) has been stable for years, so a 31 → 44 bump is low risk, but the smoke test is there to prove it.

**Key decisions already made. Don't re-litigate these without a reason:**

- 1 scene unit = 1 cm (`metersPerUnit = 0.01`), Y-up. Matches Unreal directly; Unity's USD importer converts.
- Objects export as baked `Mesh` prims (not USD gprims) for cross-importer consistency.
- Object "Size" in the inspector = its scale = its dimensions in units. Children inherit parent scale, exactly like the engines; groups exist so students can organize without stretching.
- The Three.js scene graph is the single source of truth for hierarchy and ordering. Records have no parent/children fields; helpers read `node.parent` and `node.children`. This removed a whole class of two-sources-of-truth bugs.
- Every structural operation returns an undo command; multi-object operations are compounds. Keep that pattern.
- Helper visuals (note pins and labels, group markers) sit under their node for picking and visibility but get an exact world-aligned matrix each frame so they never inherit rotation or scale. Anything new that must keep a constant on-screen size should use `markHelper()`.
- The reference image is embedded (downscaled, JPEG unless a small PNG) rather than referenced by path. Files stay self-contained across desktop and browser at the cost of a few hundred KB.
- Shortcuts: C/Y/S/P/V/T place primitives, N notes, W/E/R transform modes, G snap, M measure, H player marker, Tab walk, numpad 1/3/7/0 views, Ctrl+G / Ctrl+Shift+G group / ungroup.

**Known v0.2 limitations** (also in `README.md`): numeric inspector fields edit one object at a time; walk mode is a sightline check, not a character controller; non-uniform parent scale plus rotated children shears (standard scene-graph behavior).

## Suggested next priorities

1. **Run the unverified checks** (Electron smoke, `dist`, usd-core) and commit the lockfile. Half a day at most, and it closes the gap between "tested here" and "tested everywhere".
2. **Distribution decision.** The web build on GitHub Pages is the cheapest path to students. If desktop builds are needed, sort out certificates through the office that holds SMU's Apple Developer and Microsoft accounts; the workflow already signs when the secrets exist.
3. **Snapping to other objects** (face-to-face placement) is the most requested blockout feature after grouping and is a natural next architecture step now that bounds are computed per object.
4. **Multi-object numeric edits** (set Y for many, align, distribute) once students ask for them.

## A note on testing rigor

If you or Claude add features, hold the same bar the original build did:

- `npm run test:unit` after any change to `usd.js`. It checks every closed primitive as a watertight, consistently oriented manifold with the analytic signed volume (valid for concave stairs), string escaping, hierarchy round trips, and that `export(import(x))` is byte-identical.
- `npm run test:browser` and `npm run test:smoke` exercise the actual UI, not mocks, through one shared `test/scenario.mjs`. Extend the scenario when you add interactions; both runners pick it up.
- Re-validate exports against real USD tooling: `pip install usd-core && npm run test:usd-core`. This caught a real bug during the original build (unquoted namespaced customData keys) that our own parser's round-trip test missed entirely, and v0.2's comment-stripping bug (base64 data URLs contain `//`) was the same species: our reader accepting our writer's mistake.
