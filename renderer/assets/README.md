# renderer/assets

`mannequin.glb.js` (and the reference `mannequin.glb`) is the walk-mode mannequin:
an original, segmented figure in the style of a wooden drawing mannequin, with a
dark visor at eye height so you can tell which way it faces and where its eyes
are. It is generated entirely by code, `tools/mannequin/build-mannequin.mjs`:

- **Body:** 17 bones, rigid rounded parts (about 8,000 triangles), 180 cm tall
  with adult proportions; the app scales it to each profile's character height.
- **Clips:** `idle` (breathing, a slow look around), `walking` (140 u/s natural
  speed), `running` (400 u/s, with a flight phase) and `jump` (crouch, take-off,
  tuck, land). In both gaits the legs are solved with two-bone IK so the planted
  foot stays on the ground, rolling heel, flat, ball. Each gait's natural speed
  is in its extras as `rootSpeed`; walk mode plays whichever is nearer the
  player's speed. Root motion is not in the clips.

Regenerate after changing the script:

    npm run mannequin

The `.js` module is the GLB as base64 so the app can import it under its
content-security policy without `fetch`; both builds use it.

**Licence.** Everything here is original work, released with Ptah under the MIT
licence. No third-party models or animation are used.

**Using a Mixamo character instead.** `tools/mixamo/fbx2ptah.py` converts a
Mixamo character and its clips to the same format, for teams that want one and
have their own Mixamo licence (Mixamo assets may not be redistributed as
standalone files, so do not commit the FBX files):

    python3 tools/mixamo/fbx2ptah.py Ch36_nonPBR.fbx idle.fbx walking.fbx jump.fbx \
        -o renderer/assets/mannequin.glb --js renderer/assets/mannequin.glb.js --name Mannequin

The controller needs a `walking` clip; `idle`, `running` and `jump` are used when present.
