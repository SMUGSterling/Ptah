# Ptah — Handoff Notes

You're picking this project up on a new account. Everything you need to keep going is in this folder.

## What's here

```
HANDOFF.md          this file
ptah/                the full project source
  README.md          setup, keyboard shortcuts, USD conventions, architecture
  main.js, preload.js, package.json
  renderer/           app code (app.js, usd.js, history.js), vendored Three.js
  test/
    usd.test.mjs       headless unit tests
    smoke.js           scripted end-to-end Electron test
    smoke.png           screenshot from the last passing smoke run
    sample.usda          sample export, already validated against Pixar's usd-core
```

`node_modules` is not included — it's ~300 packages of Electron/electron-builder and isn't worth shipping. Regenerate it with `npm install`.

## Getting running again

1. Unzip this folder somewhere on the new machine/account.
2. `cd ptah && npm install`
3. `npm start` — should open straight into the editor.
4. Sanity-check before you trust the environment: `node test/usd.test.mjs` (should print `ALL TESTS PASSED`).

If you're handing this to Claude on the new account, just say something like "continue work on Ptah, project files attached" and upload this whole folder (or just the `ptah/` subfolder) — the README plus this file give enough context to pick up cleanly without re-deriving decisions.

## Where things stand — v0.1.0, shipped

All spec'd features are implemented and tested three ways: unit tests on the USD read/write layer, a scripted headless Electron session driving the actual UI end-to-end, and export validation against Pixar's official `usd-core` parser (not just our own round-trip logic).

**Key decisions already made — don't re-litigate these without a reason:**
- 1 scene unit = 1 cm (`metersPerUnit = 0.01`), Y-up. Matches Unreal directly; Unity's USD importer converts.
- Objects export as baked `Mesh` prims (not USD gprims) for cross-importer consistency.
- Object "Size" in the inspector = its scale = its dimensions in units.
- Shortcuts: C/Y/S/P place primitives, W/E/R transform modes, G snap, M measure, H player marker, numpad 1/3/7/0 for views.

**Known v0.1 limitations** (also in `ptah/README.md`):
- Flat hierarchy — no parenting/grouping. Imported nested Xforms flatten with a warning.
- Single selection only.
- Gizmo has no scale-snap; scale is precision-only via the inspector fields.

**Identified next priority:** grouping/parenting. That's a real architecture change (reparenting UI, matrix composition on import/export), not a quick patch — plan for it as its own pass rather than bolting it on.

## A note on testing rigor

If you or Claude add features, hold the same bar the original build did:
- `node test/usd.test.mjs` after any change to `usd.js` — it catches winding/topology bugs, not just "does it look right."
- `xvfb-run -a npx electron --no-sandbox test/smoke.js` (Linux headless) exercises the actual UI, not mocks. Extend the script in `test/smoke.js` when you add new interactions.
- Worth re-validating exports against real USD tooling periodically: `pip install usd-core` and `Usd.Stage.Open()` your file. This caught a real bug during the original build (unquoted namespaced customData keys) that our own parser's round-trip test missed entirely.
