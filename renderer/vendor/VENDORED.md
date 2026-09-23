# Vendored Three.js files

Ptah vendors a small, tracked subset of Three.js rather than pulling it from a package manager at runtime.

## Current files

| Local file | Upstream source | Version | Date added to this repo (`git log --diff-filter=A`) |
| --- | --- | --- | --- |
| `renderer/vendor/three.module.js` | https://github.com/mrdoob/three.js/blob/r168/build/three.module.js | Three.js r168 (`REVISION = '168'`) | 2026-09-17 |
| `renderer/vendor/addons/controls/OrbitControls.js` | https://github.com/mrdoob/three.js/blob/r168/examples/jsm/controls/OrbitControls.js | Three.js r168 | 2026-09-17 |
| `renderer/vendor/addons/controls/TransformControls.js` | https://github.com/mrdoob/three.js/blob/r168/examples/jsm/controls/TransformControls.js | Three.js r168 | 2026-09-17 |

## Update procedure

1. Choose the upstream Three.js tag to vendor.
2. Replace `renderer/vendor/three.module.js` with `build/three.module.js` from that tag.
3. Replace `renderer/vendor/addons/controls/OrbitControls.js` with `examples/jsm/controls/OrbitControls.js` from the same tag.
4. Replace `renderer/vendor/addons/controls/TransformControls.js` with `examples/jsm/controls/TransformControls.js` from the same tag.
5. Confirm the `REVISION` constant in `renderer/vendor/three.module.js` matches the version recorded here, then update this document's version/date entries.
6. Run `npm test`.
7. Review any import-map or API breakage in `renderer/index.html`, `renderer/js/app.js`, and tests before merging.
