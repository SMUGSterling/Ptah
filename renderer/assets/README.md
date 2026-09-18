# renderer/assets

`mannequin.glb.js` (and the reference `mannequin.glb`) is the walk-mode mannequin:
the Adobe Mixamo character **Ch36** with the **Basic Locomotion Pack** clips
(idle, walking, jump, left/right strafe walking, left/right turn 90), converted by
`tools/mixamo/fbx2ptah.py` into a skinned glTF with textures removed (flat
grey), root motion stripped from locomotion clips, and the clips' natural speeds
recorded in their extras. The `.js` module is the GLB as base64 so the app can
import it under its content-security policy without `fetch`; both builds use it.

Regenerate from the Mixamo FBX pack (binary FBX, "with skin" for the character,
"without skin" is fine for the clips):

    python3 tools/mixamo/fbx2ptah.py Ch36_nonPBR.fbx idle.fbx walking.fbx jump.fbx \
        "left strafe walking.fbx" "right strafe walking.fbx" "left turn 90.fbx" "right turn 90.fbx" \
        -o renderer/assets/mannequin.glb --js renderer/assets/mannequin.glb.js --name Mannequin

Any other Mixamo character works the same way; the converter needs one skinned
mesh and clips exported for that character's skeleton. A `walking` clip is the
only one the controller requires (`idle` and `jump` are used when present).

**Licence.** Mixamo assets are royalty-free for use in personal and commercial
projects, including games and tools, but may not be redistributed as standalone
assets. Embedding a converted, texture-less mannequin inside Ptah is use within
a project; confirm this reading with whoever handles university IP alongside the
open LICENSE item in HANDOFF.md, and keep the raw Mixamo FBX files out of the repo.
