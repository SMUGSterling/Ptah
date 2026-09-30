# Changelog

## 0.13.2 (2026-09-30)

Fixes from an outside review of 0.13.1.

### Fixed
- **Ungrouping no longer changes an object's shape.** A turned object inside a group scaled unevenly is skewed in the world, and a position, rotation and scale can't hold that under another parent. Ungrouping, moving the object out, or moving a turned object into such a group changed its shape: a 45° cube in a group stretched 2× on X went from 283 × 100 × 141 to 222 × 100 × 222. Ptah now refuses the move and says why. Even scales, quarter turns and unturned objects move as before.
- **Imported concave faces are no longer filled in.** Every polygon was fanned from its first corner, so an L- or U-shaped face drew a surface across its notch. You could click on it, and walk mode treated it as solid. Concave faces are now ear-clipped. Convex faces keep the same triangles as before, and saved files keep the file's original faces.
- **Unity: trigger sizes when every marker sits at its parent's origin.** The converter measures the importer's unit from marker positions. With none to measure (after grouping each marker on its own, say), it assumed 1, which made triggers 100× too big under Unity 6.3's USD Importer. It now measures the level's other objects. If nothing in the level is off its parent's origin, it takes the unit from the importer's layout and prints a warning saying the unit was assumed.

## 0.13.1 (2026-09-29)

Fixes from a code review of the changes since 0.10.0 (`v0.10.0..v0.13.0`).

### Fixed
- **A finger dragged from an object on the desktop page selects it again,** and draws no selection box. Since 0.13.0 it drew a box, then selected nothing.
- **A note placed on a phone opens the Inspector** so its text takes the typing. Before, the focus went to a text box hidden in the closed sheet. The tap that places the note no longer also presses a sheet button that slides under the finger.
- **A view squeezed to nothing** (a phone's sheet and keyboard together) keeps its last camera shape. Before, the camera's projection became NaN until the next resize.
- **A tap that lifts off the canvas no longer leaves a held tap behind.** While it was held, the canvas ignored finger moves. A mouse or pen released on a touchscreen laptop while a finger holds a tap no longer sets the tap off early.
- **Walk mode's Run and Crouch buttons** now show as released when a hardware keyboard's Shift or C is released. The key had already let go of the action, but the button stayed lit.
- **The mobile page's one-finger orbit** does nothing while rotation is off, as the desktop's orbit does.

### Changed
- `tools/build-mobile.mjs` and `tools/prepare-pages.mjs` share one import-map rewrite (`rewriteImportMap`), which also recomputes the CSP hash. A missing manifest link in `renderer/index.html` now fails the build rather than being silently skipped.
- The viewport follows its own size through one `ResizeObserver`. The window's resize event is kept only as a fallback for browsers without it.

## 0.13.0 (2026-09-29)

A mobile version of the web editor, at `/Ptah/mobile/`.

### Added
- **Ptah on phones and tablets.** <https://levi-sterling.com/Ptah/mobile/> is the same editor, laid out for touch:
  - **Phones:** the tools sit in a scrolling bar under the view. The panels are tabs in a sheet below it: Inspector, Hierarchy, Metrics, Reference, and More, which holds what the top bar has no room for (New, Save As, theme, presets and markers, grid and snap, ticks, and view buttons). A phone on its side keeps this layout.
  - **Tablets:** the desktop arrangement with bigger buttons.
- **Touch camera:** drag one finger on empty space to orbit, use two fingers to pan and pinch, and tap to select or deselect. Placing, the move, rotate and scale gizmo, the Inspector's fields, Undo and Redo work as on the desktop.
- **Walk mode by touch:** an on-screen stick (a small push creeps, a full one walks), a look drag, and Jump, Crouch, Run, View and Exit buttons. On a phone the view takes the whole screen while you walk; a tablet keeps its panels.
- **Files on a phone:** Open accepts any file, because iOS and Android grey out `.usda` under a type filter. Save downloads the level.
- **An offer on the desktop page:** a phone-sized touch screen opening the desktop page gets a bar offering the mobile version. That includes a phone on its side. More links back to the desktop layout.
- **Install it as an app:** the mobile page has its own web-app manifest, so an installed icon opens the mobile page.
- **Accessibility:** touch targets are at least 44 px, sliders included. Inputs use 16 px text, so iOS doesn't zoom when one gets focus. The page can still be zoomed. All six themes apply.

### Fixed
- **A two-finger gesture that starts on an object no longer changes the selection,** on both pages. A finger now selects when it lifts as a tap. Before, the first finger selected at once, even when the second made it a pinch or pan.
- **A two-finger gesture no longer leaves a marker, preset, note or measure point behind,** on both pages. With one of those tools armed, a finger now acts when it lifts as a tap. A drag or a second finger cancels it.

### Things to know
- A phone has no box select or Ctrl-click, so you select one object at a time.
- It is tested on emulated iPhone 13, Pixel 7, 360 px Android and iPad screens, in Chromium. Real iOS Safari has not been tried and needs iOS 15.4 or newer.

## 0.12.0 (2026-09-28)

Interface themes, chosen for accessibility.

### Added
- **Themes.** The picker at the right end of the top bar recolours the bars, panels and dialogs. The themes:
  - **Ptah:** the default.
  - **Catppuccin:** Catppuccin Mocha.
  - **Rosé Pine.**
  - **Light:** GitHub's Primer Light.
  - **Light HC** and **Dark HC:** Primer's high-contrast themes.

  Ptah remembers your choice and applies it before the page first draws, so there is no flash of the default colours.
- **Every theme passes WCAG 2.2:** AAA contrast for body text, AA for all other text, and 3:1 for focus rings, focused-field borders and drop outlines. A focused field or picker now draws its border in the full accent colour, which is its only sign of focus after a click. A unit test checks each text-on-background and outline pair the interface draws. All five palettes are MIT-licensed, and their notices are in `docs/theme-licenses.md`.
- **Themes that didn't make it:**
  - Dracula: its only grey is 3.0:1 on its background.
  - Catppuccin Latte: body text is 6.0:1.
  - Tokyo Night: its grey is 4.2:1.
  - Solarized: its red is 2.8:1.
  - Nord: Apache-2.0, not MIT.

### Changed
- **The viewport never changes with the theme.** The 3D view, the chips and hints over it, the walk HUD and toasts keep Ptah's colours in every theme. So do intent and marker colours, which are saved in the file and exported to the engine.
- **Ptah's own grey text is slightly lighter** (`#9095a4`). The old grey measured 4.4:1 on a hovered button, just under AA. The version number in the status bar is no longer dimmed below AA either.
- **Hidden objects' Hierarchy rows are grey and italic instead of faded.** Fading took their names to 1.8 to 3.7:1, and they are still clickable. The eye icon still shows ○.
- **The unsaved-changes dot now comes before the file name** (`• level.usda`). A long name is cut short with an ellipsis, and the dot must stay visible. The full name is in the tooltip.

### Fixed
- **Opening or saving a file with a long name no longer wraps the top bar and shifts the viewport** on windows around 1440 px wide. The file name now shrinks to fit instead.
- **The viewport follows every change in its size,** not only window resizes. Before, a top bar that wrapped left the 3D view stretched and walk mode's field of view wrong until the window was resized.
- **Below 1320 px, the status bar no longer pulls its right-hand readouts to the left.**

## 0.11.0 (2026-09-28)

Walk mode gets a real crouch, in both views.

### Added
- **The mannequin crouches.** Hold `C` and it drops into a crouch. Move while holding `C` and it creeps forward in a crouched walk at half walk speed. Both clips are generated from code like the mannequin's other animations.

### Changed
- **The third-person camera follows the crouch.** It lowers to the profile's crouch height, as the first-person eye always did. Both views now ease down and back up over 0.2 s instead of snapping.
- **The hint bar and README say "hold C" to crouch.** A tap does nothing you can see.

### Things to know
- The mannequin crouches as a person would. It is not squashed to the profile's crouch height. The camera and collision still use the crouch height, so in a tunnel exactly that tall, the mannequin's head shows through the ceiling. Ptah's Unreal profiles use UE's 80 u crouch capsule, which is lower than a person crouches.
- Letting go of `C` under a low ceiling stands you up through it. Head collision is planned separately.

## 0.10.0 (2026-09-28)

The Unity marker tool, run in a real Unity 6.3 editor for the first time, becomes an installable package, with the three bugs that run found.

### Added
- **The Ptah Markers package for Unity.** Install it once per project from Package Manager with a Git URL, instead of copying two scripts into the right folders:

      https://github.com/SMUGSterling/Ptah.git?path=/tools/unity#v0.10.0

  If you copied the scripts in by hand before, delete those copies, then convert your markers again.

### Fixed
- **Unity marker tool, with Unity 6.3's USD Importer:**
  - **No markers were found.** The new importer has no `Root` object: the level sits directly under the object named after the file. The tool now finds the level either way, even if the importer leaves an object out.
  - **Trigger boxes came out 100 times too big.** A 256 cm trigger became 256 m, because the new importer converts positions to metres but leaves each object's scale in centimetres. The tool now measures how the importer converted units and sizes each trigger's collider and gizmo to match.
  - **Marker facing was assumed, not checked.** The tool now measures which axis the importer mirrored and sets each marker's facing to match. Unity 6.3 mirrors Z, so markers face the way their arrows point in Ptah. The Console says what it found.
  - When nothing converts, the Console now says where the tool looked, which helps when the wrong `.usda` was picked.

### Removed
- **The Mixamo converter** (`tools/mixamo/fbx2ptah.py`). Ptah has used its own mannequin since 0.8.6, and nothing used the converter.

## 0.9.9 (2026-09-28)

The last low-priority items from the review of 0.9.2, a version number in the file format, and Unity 6.3 LTS as the recommended Unity.

### Added
- **Files now say which version of Ptah's format they use.** A file saved by a newer Ptah still opens, with a warning that some of it may be missing.

### Changed
- **Unity:** the guide now recommends Unity 6.3 LTS with the USD Importer package (`com.unity.importer.usd`), and shows a level imported with it. It also explains that markers, triggers included, stay empty objects until the marker script converts them.

### Fixed
- **Walk mode can go below the grid.** You can walk into a pit or a basement built below the grid, and a Player start on a floor below it starts there. The grid is still the floor wherever nothing is built beneath it. Falling past everything returns you to where the walk started, and the third-person camera follows you below ground.
- **Importing other tools' USD files:**
  - Objects inside a hidden Scope or a hidden root now come in hidden.
  - `active = False` in other spellings (`FALSE`, `no`, `0.0`) skips the prim, as USD does.
  - A cylinder's axis written in single quotes is read.
  - When a prim has several variant sets, the one listed first in its `variantSets` wins, as in USD. Sets missing from the list are skipped. A hand-written file with no list keeps its sets, with a warning that USD ignores them.
  - Objects under a camera or light are imported, and unsupported shapes beside them are reported.
  - A file whose units are centimetres written as a float (`0.009999999776482582`) no longer gets a conversion group.
  - Meshes keep `doubleSided` when saved again.
- **Unity marker tool:** a marker kind it does not know (a number, a misspelling) is now left alone with a warning. Before, it became a Spawn.
- **Building a Linux installer from a downloaded ZIP of the source** no longer fails.
- **Mixamo converter:** animation bones the character does not have are now reported, not silently dropped.

## 0.9.8 (2026-09-28)

Exported blocks keep their hard edges in other tools.

### Fixed
- **Blocks imported into Unity looked soft and blobby.** Ptah exported meshes without normals, so importers such as Unity's averaged them at every corner. Each primitive now carries its own normals in the file:
  - Boxes, ramps, stairs and planes have flat faces and hard edges.
  - Cylinders and spheres shade round, with a hard edge where a cylinder's side meets its caps.
  - Meshes imported into Ptah from other files export as before, without normals, since their original normals are not kept.

## 0.9.7 (2026-09-28)

The saving, closing and autosave findings still open from the review of 0.9.2.

### Fixed
- **Desktop:**
  - **Closing the window twice during a save asked twice** whether to discard changes. It now asks once.
  - **Saving over a file dropped its group write permission** on Linux and macOS. The file keeps its permissions.
- **Web:**
  - **A Save As the browser blocked turned into a download** under the old name, and the level forgot its file. This happens when the dialog opens too long after the click, for example after a long save. The editor now asks you to click Save As again, and nothing changes.
  - **A failed save left a temporary file** next to the one being saved. It is now removed.
  - **A `.usd` level downloaded as `level.usd.usda`** while the editor said `level.usd`. It now downloads under the name the editor shows.
- **A new or opened level kept the last level's reference-image placement** (width, position, rotation, opacity). It now starts from the defaults.
- **Autosave:**
  - **Work in a tab too busy to answer could be offered to another tab** as abandoned work. Each open tab now also holds a browser lock that other tabs check.
  - **If the storage was full when unsaved work was offered, the work could be lost.** Work done behind the recovery bar was saved over the offered copy, and Dismiss then deleted it. The new work now gets a snapshot of its own. The false "Autosave is unavailable" notice is gone too.

## 0.9.6 (2026-09-28)

The editor and walk-mode findings still open from the review of 0.9.2.

### Fixed
- **The gizmo could rotate a note and scale a PlayerStart,** although the inspector locks those fields and they would then be saved. Rotate and scale now have no gizmo while such an object is selected, and a message says why. Moving still works.
- **A walk asked for while the mannequin loaded started whenever it arrived,** even behind the profile picker or mid-drag. Pressing anything else now cancels it, and pressing Tab or Walk again turns it off.
- **Undoing an edit typed for several objects reselected only one.** It reselects them all, as undoing a gizmo drag does.
- **Dropping a Hierarchy row where it already was** added an undo step and marked the level unsaved. It now does nothing.
- **Selecting objects in large levels was slow:** the Hierarchy rebuilt every row on each click (about a quarter of a second at 4,000 objects). A selection change now only updates the rows.
- **Walk mode:**
  - **Third person was far slower than first person near large imported meshes.** The camera boom now uses walk mode's own collision data. Next to a 100,000-triangle terrain, a frame went from 4.6 ms to 0.03 ms, and a mouse move from 4 ms to almost nothing.
  - **Every frame searched the level's objects a dozen times.** It now does so once.
  - **The jump animation could freeze on landing,** when you jumped again just as the previous landing ended. It could also replay the crouch when you stopped right after landing on the move.
  - **The camera jolted up when a jump started on stairs or a slope.** It now carries its easing into the jump.
  - **A very quick tap on Space could be missed** when it fell between two frames.

## 0.9.5 (2026-09-28)

The rest of the review's medium findings: reading variants and overrides the way USD does, files that bring in other files, invalid points, the Unity marker tool, and the release workflow.

### Fixed
- **Importing other tools' USD files:**
  - **A variant nested in another variant won over it.** An outer variant's values now win over those of a variant nested inside it, as in USD.
  - **Variants that override a prim now apply to it.** A "look" variant that colors a cube defined beside it was dropped, and one that redefined the cube imported a second copy. They now merge into one object, and the prim's own values win over the variant's, as in USD.
  - **Prims that bring in other files said nothing.** A prim with a reference or payload imported as an empty group. The import now warns that those files aren't loaded.
  - **A mesh with an `inf` or `nan` point imported with the wrong shape.** The point was skipped, which moved every later face onto the wrong vertex. Such a mesh is now reported as invalid and skipped.
- **The Unity marker tool misread tags after a re-save by USD tools.** usd-core writes a tag that contains `"` in single quotes, and a multi-line one in triple quotes. A tag such as `br]acket "q"` ended the list early and dropped the tags after it. The tool now reads every quoting style, and ignores marker attributes that only appear inside another string.

### Changed
- **Releases run the full test suite first.** Before, only the unit tests ran before a release. Now installers are built only after the browser, Electron, usd-core and Unity checks pass on the same commit.
- **A web deploy is never cancelled partway.** A CI run on an unrelated `main` branch, such as a fork's, could stop a deploy that was under way.

## 0.9.4 (2026-09-28)

Touch controls.

### Added
- **Three fingers pan the camera** on touch screens, the way right-drag does with a mouse. Two fingers still orbit, and pinching still zooms.

### Fixed
- **Orbiting with two fingers dropped an object** when a placement tool was active, because the first finger to land placed it. A second finger now takes back whatever the first one started (a placement, extrude, gizmo drag or box select) and records nothing.
- **A finger landing on the gizmo mid-gesture dragged the selection.** The gizmo now ignores touches while more than one finger is down.
- **Saving while a placement was still held wrote it to the file.** This could happen from the Save button or the desktop menu, since the keyboard already waits. If the placement was then cancelled, the level showed as saved while the file still had the object. A save now finishes the gesture first.
- **Cancelling a placement marked the level unsaved** even though nothing changed. This happened with Esc, and now also happens on every multi-finger gesture. A saved level stays saved.

## 0.9.3 (2026-09-28)

Fixes from a skeptical review of 0.9.2: work marked saved that wasn't, USD files that hung the import, and walk-mode physics.

### Fixed
- **Picking a profile could mark unsaved work as saved.** The launch profile picker opened over work started right after launch, or behind a recovery bar whose restore failed, and picking a profile then cleared the unsaved flag, so closing lost that work without a prompt. The picker now opens only on a level with nothing in it, and a profile change on a level with work is undoable and leaves it unsaved.
- **Some USD files hung the import for seconds to minutes.** A transform matrix with long runs of spaces took 20 s to read; a prim listing many transform ops it never authors, or with thousands of variant sets, took minutes. Each now imports in milliseconds. Variants nested more than 64 levels deep are refused with a message instead of stalling.
- **Walk mode:**
  - **You could walk through thin walls, and through whole blocks, from close up.** A body already touching a wall was allowed any move that ended farther from it, including one that carried it through to the other side. It can now move away from or along a wall it touches, never across it.
  - **Jumps went 4–12% higher and farther than the profile says,** more at low frame rates. A jump now follows its arc exactly at any frame rate: apex at the profile's jump height, landing at its jump distance.
  - **A ramp of exactly 45° was a wall.** A rounding error put it a hair over the limit. It is walkable, as in Unreal and Unity.
  - **Some wall triangles let you through, depending on the order of their corners.** A corner exactly at knee or waist height hid the rest of the face from the collision test.

## 0.9.2 (2026-09-27)

The rest of the 0.8.9 review: editor input, smaller gaps in reading other tools' USD files, the Unity marker tool and release signing.

### Fixed
- **Save As and Open fired twice from the Grid and Ground fields.** Pressing Ctrl+Shift+S or Ctrl+O while typing in either field opened the dialog twice, or asked twice about unsaved changes.
- **Typing after placing a note ran shortcuts.** The note's text box lost focus as soon as the click finished, so typing "cover" armed the cube tool, the wedge tool and so on. The text now goes into the note.
- **One-finger touch drags also orbited the camera** while placing an object or drawing a selection box. On touch screens, one finger now uses the current tool, as the left mouse button does; two fingers orbit and pinch zooms.
- **Double-clicking a row in the Hierarchy did not rename it.** It does now, as `Enter` and `F2` already did.
- **Snapped scaling turned a 1u-thin plane into a 64u slab.** Scale snapping now changes only the sizes you drag: whole grid cells from one cell up, whole units below that, never under 1u.
- **Typing a negative Size squashed a group to 0.01.** Groups and imported meshes now mirror, as they do with the gizmo; primitives keep their 1u minimum.
- **A child stayed highlighted after undoing its group's deletion,** although it was no longer selected.
- **Changing the reference image's opacity with the arrow keys** was neither undoable nor marked as unsaved.
- **Importing other tools' USD files:**
  - Variant sets nested inside a variant now use the selection usd-core writes inside that variant.
  - Prims with `active = false` are skipped, as USD does, with a note in the import warnings.
  - Left-handed meshes (`orientation = "leftHanded"`) no longer import inside-out.
  - Prim and variant names in single quotes are read.
  - An invisible mesh inside an Xform stays hidden, and a tag that merely mentions `visibility = "invisible"` no longer hides its object.
- **The Unity marker tool missed markers inside groups with `) {` in their names,** such as "Room (A) {v2}".

### Changed
- **Release signing:** the Windows build now reads its certificate from `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`. `CSC_LINK` / `CSC_KEY_PASSWORD` are for the macOS Developer ID certificate only. With one pair shared, one platform was always signed with the other's certificate.

## 0.9.1 (2026-09-27)

Walk mode now checks scale the way the engines do.

### Fixed
- **Stairs and ramps stopped the player in the Unity profiles.** Collision looked a full body-radius ahead from the current feet, so two low risers together, or a ramp steeper than 20°, counted as a wall. The player now stands on the highest floor under their whole body, the way a capsule rests on a step's edge, and climbs one riser at a time. Ramps up to 45° (Unity's and Unreal's default slope limit) are walkable in every profile; steeper ones can't be walked up. You can still walk down them, where the engines would slide you down.
- **A riser exactly as tall as the step height blocked the player,** so the Step run preset couldn't be climbed in any profile. A riser up to the step height is now a step.
- **The player walked through gaps narrower than their body.** Collision checked one line through the centre of the body. The body is now a circle as wide as the profile's capsule, tested against the level's actual wall faces at knee height and at the capsule's widest point. Posts and walls block however thin they are, a gap narrower than the capsule stops you, and the Doorway preset still lets you through.
- **Walking off a ledge glided down to the floor.** A drop of more than a step height is now a fall.
- **Walk mode slowed to a crawl near large imported meshes.** Every frame tested every triangle of a mesh near the player. Collision now looks up only the triangles around the body, so a frame beside a 100,000-triangle terrain drops from about 88 ms to under 1 ms.
- **Pressing V twice left the running animation blended into the idle pose.**
- **The jump animation was out of step with the jump.** The crouch before take-off played while rising, and the landing never played. The animation now follows the jump: take-off as the feet leave the ground, touchdown as they land. Landing on the spot plays the landing absorb; landing on the move blends straight into the walk or run, as in Unreal's template, so the feet never slide through a crouch.
- **Holding Space jumped again on every landing.** One press, one jump.
- **The first walk's view stuck for the whole session.** A first-person walk made later walks start in first person even after switching to a third-person profile. Each walk now follows the profile until you press V; a view picked with V still sticks.

## 0.9.0 (2026-09-27)

Work you haven't saved is harder to lose, and a malformed file can no longer freeze the importer.

### Fixed
- **Dismissing the recovery bar could delete work done behind it.** The bar doesn't block the editor. If you started building before choosing, the new work autosaved over the copy on offer, and Dismiss then deleted it. The offered copy now has its own slot: Dismiss removes only that copy, and a reload before you choose offers both, one at a time.
- **Restoring could lead the next Save into a different file with the same name** (Chrome and Edge). If you opened a file behind the recovery bar and then restored work from a file with the same name, Save wrote the restored level into the opened file. After a Restore, the next Save now asks where to save.
- **A Save that was only downloaded deleted the recovery copy.** Without a Save dialog (Firefox, Safari, or when Chrome refuses permission), Save hands a download to the browser, which may still ask, block or fail it. Ptah now keeps a labelled recovery copy after a download. Dismissing that copy once tells Ptah your downloads arrive, and later download saves stop keeping one.
- **"Discard changes" on closing the desktop app didn't discard.** The next launch offered the discarded work back. Closing with Discard now deletes the recovery copy. The web build can't tell a discarding tab close from a crash, so it still offers the work back.
- **Quitting the Mac app while a save was still being written, or through "Discard changes", left it running** with no window. The quit now completes.
- **A second copy of the desktop app ran without autosave.** The two copies shared storage, and the second silently couldn't use it. Launching Ptah again now brings the open window to the front. If autosave can't store anything (a locked profile, a full disk, a private window), Ptah now says so once.
- **Certain malformed files froze the importer.** A layer dictionary full of blank lines, or text repeating an unclosed `variants = {` or `xformOpOrder = [`, took seconds to minutes to read, growing with the square of the file size. These lookups now take linear time: a file that used to take 30 seconds imports in milliseconds.
- **Settings nested in `customLayerData` were read as the stage's own.** An `upAxis` or `metersPerUnit` entry inside a dictionary could turn a Y-up centimetre file into a Z-up metre one. Only the layer's own keys count now, and single-quoted values are accepted. A nested dictionary inside Ptah's metrics no longer cuts the metrics short, and an `xformOpOrder` quoted inside a note is no longer taken for the prim's.
- **Face counts and colours weren't size-checked.** `faceVertexCounts` is now counted against a limit of 2,000,000 faces before it is parsed, like points and indices, and a per-vertex `displayColor` is read only for the first colour Ptah uses.

## 0.8.9 (2026-09-27)

### Fixed
- **After a refused Save As, the next Save could overwrite the original file** (Chrome and Edge). With `A/level.usda` open, a Save As to `B/level.usda` that the browser refused downloaded a copy, but Ptah kept pointing at A; because both files share a name, the next Save wrote into A. The same happened when the Save As dialog itself failed. Ptah now forgets the file whenever it falls back to a download, for either reason, so the next Save asks where to save.

## 0.8.8 (2026-09-26)

### Fixed
- **Save could silently do nothing in Chrome and Edge.** If the browser refused permission to write the file (for example you declined its "allow editing" prompt), Ptah treated that like closing the Save dialog: nothing was saved and nothing was said. It now downloads a copy instead and tells you so. A refused read when opening a file now shows an error instead of doing nothing.

## 0.8.7 (2026-09-26)

### Fixed
- **The walk-mode hint bar ran under the Inspector.** On a normal-width window its one long line spilled past the 3D view and covered the top of the right-hand panel. It now wraps inside the view.

### Changed
- **Ptah is now Levi Sterling's project.** The licence (still MIT), the app's copyright and author metadata and the docs name Levi Sterling as owner and maintainer; references to the previous institutional owner are removed. The desktop app's identifier changes from `edu.smu.guildhall.ptah` to `com.levi-sterling.ptah`. The Windows installer keeps its previous installation ID, so it upgrades an existing copy in place as before; nothing to uninstall. Saved files and autosaves are unaffected.

## 0.8.6 (2026-09-26)

### Changed
- **A new, original walk-mode mannequin.** The third-person character is now a segmented drawing-mannequin figure generated by Ptah's own code instead of an Adobe Mixamo character, so there are no third-party assets or licence questions in the app. It has idle, walk, run and jump animations and a dark visor at eye height that shows where it is looking. The app download is about 1 MB smaller. `tools/mixamo/fbx2ptah.py` still converts a Mixamo character for teams that prefer one.
- **The mannequin runs at run speed.** Walk mode picks the walk or the run animation by how fast you move, so the feet no longer slide at Unreal's 500 u/s; crouching always walks. The planted foot stays on the ground in both.

## 0.8.5 (2026-09-26)

### Fixed
- **A failed Open could make the next Save overwrite the file you tried to open** (Chrome and Edge). If the file couldn't be imported, your level stayed on screen, but Ptah had already switched to the other file; when both files had the same name, Save wrote your level into it. Ptah now switches files only after the import succeeds.

## 0.8.4 (2026-09-26)

### Fixed
- **A save finishing after New or Open could rename the new level and mark it saved.** The file picked for the old level became the new level's file, and edits made since could look saved when they weren't. A save now only updates the level it wrote; if you have moved on, it just reports that the previous level was saved. In Chrome and Edge, New or Open during a save could also make the save fail and download a second copy instead, and a Save pressed while a file was still being opened went to that file instead of the level on screen.
- **Save As pressed while a save was running did nothing.** It now opens its dialog as soon as that save finishes. A Save pressed at the same time is covered by the Save As.
- **A reference image could land in the wrong level.** An image still being read when you chose another image, cleared it, undid it, or started or opened a level was added anyway, or replaced the newer choice. It is now dropped.

## 0.8.3 (2026-09-26)

### Fixed
- **The web build could load a new app with an old three.js.** After a deploy, GitHub Pages can serve cached files for up to 10 minutes, and only the app's own scripts had per-deploy URLs. Now the scripts, three.js, the walk-mode mannequin and the stylesheet all load from one folder per deploy.
- **Unity: markers that shared a name with another object were skipped.** Names are unique only within a group, so two groups could each hold a `Spawn_01`. The marker converter now follows each marker's path in the file (`Root/Arena/Spawn_01`) and converts the matching GameObject, and only warns when a match is genuinely ambiguous. With a group selected, only the markers inside that group are converted; the rest are counted as outside the selection instead of landing on a same-named object inside it.
- **Deleted objects kept their GPU memory until reload.** They are kept for undo; once no undo step can bring them back (the history passes 200 steps, a new edit replaces the redo steps, or New / Open), their GPU buffers are freed.

### Changed
- **Ptah is for level designers generally,** not only students: the README, engine import guide, app description and web page metadata say so.

### Tests
- **The Unity marker script is compiled and run in CI.** `npm run test:unity` builds `PtahMarkers.cs` with mono against small stand-ins for the Unity API and converts a level exported by Ptah, including same-named markers in different groups. The first compile caught a variable declared twice in overlapping scopes, which Unity would also have rejected.
- The Pages packaging test runs against a copy of the real site: every file the page references exists and the rewritten import map matches its CSP hash. Unit tests cover the history's drop notifications.

## 0.8.2 (2026-09-25)

### Fixed
- **Switching between first and third person (V) looked broken.** When pointer lock engaged, the browser reported the cursor's jump to the lock point as one large mouse movement, and walk mode sometimes counted it: the view snapped to looking straight up, so first person showed empty sky and third person looked up at the character from under the floor. Such jumps are now ignored, and the third-person camera stops above the grid floor when you look up (it used to swing underground).
- **Walk mode froze the editor** when the mannequin had failed to load and the profile was third person. It now walks in first person.
- **Gizmo moves changed the scale of groups and imported meshes.** Every drag forced the scale to at least 1: a millimetre import's conversion group (scale 0.1) grew 10x on the first move, and mirrored imports lost their mirror. Only unit primitives are clamped now.
- **Scaling an imported mesh with snapping on jumped it to 64x,** and extruding one ballooned it: both treated its scale as a size. Scale snapping and extrude now apply to primitives only.
- **Bulk edits at a few thousand objects froze the editor** (select all + Delete, Duplicate, and their undo and redo): each object rebuilt the hierarchy and the selection. They now refresh once.
- **Web: Save could overwrite the wrong file.** After opening a file and then dropping a different file with the same name, Save wrote in place to the first one. Dropping a file now makes the next Save ask where.
- **Desktop: typing a name without .usda in Save As replaced an existing file without asking**, and closing the window during a save could leave the file half-written. Both are handled.
- **Ctrl/Cmd+S and Ctrl/Cmd+O did nothing while typing** in the Inspector, tags, notes, metrics and most other fields.
- **Undoing a metrics, ground-size or marker-kind change did not mark the level unsaved,** so closing could lose it without a prompt.
- **A Custom profile forgot its template.** After editing one number, Reset loaded Unreal Third Person whatever you started from, and Unity Third Person started walking in first person. The template is kept (and saved as `base` in `ptah:metrics`).
- **The recovery bar could discard work:** Restore replaced unsaved changes without asking, and Dismiss opened the profile picker over work already started.
- **Files re-saved by Pixar's USD tools lost note text, names and tags** that contain quotes, line breaks or control characters (usd-core writes those as `'...'`, `'''...'''` or `\xNN`). All USD string forms are read now, and a note whose text mentions an attribute (`ptah:color = (1, 0, 0)`) no longer changes its own colour.
- **Foreign files:** a layer header with an indented or one-line closing parenthesis was ignored (a Z-up metre file came in on its side at 1/100 scale); SkelRoot characters lost their meshes or transform; unsupported prims (Cone, Capsule, PointInstancer ...) vanished silently and are now counted in one warning. A file with `ptah:type = "constructor"` made every later save fail.
- **Levels over 10,000 objects saved but would not reopen** (the prim limit is now 100,000), and a save over the 50 MB open limit warns. Stair step counts are capped at 64 everywhere.
- **Unreal import:** trigger boxes were rotated 90 degrees (extent in the wrong axis order) and Player starts spawned half in the floor. **Unity import:** markers were never converted (`??` on a Unity component), and markers sharing a name with another object are skipped with a warning instead of converting the wrong one.
- **Windows releases shipped only one of the two .exe files** (the installer and the portable build had the same name). They are now `-setup.exe` and `-portable.exe`.
- Smaller: Ctrl crouches only in the desktop app (Ctrl+W closes a browser tab); markers and notes are placed on geometry, not on trigger volumes or labels; a rebuilt marker or note keeps its selection highlight; Duplicate's redo keeps the original order; a second touch during a placement is ignored; a reference image from a file is size-limited and its values checked; undoing an image swap restores its name; a late image load no longer lands after the underlay was cleared; renaming by whitespace alone is not an edit; overflowing Inspector expressions are ignored; an undo that throws clears the history instead of leaving it inconsistent; idle frames skip the scene traversal; the profile picker blocks everything behind it.

### Changed
- **Release workflow:** the tag check runs before the three platform builds, and Pages deploys only when the CI run's commit is still the newest on `main`.

### Tests
- New scenario steps: the pointer-lock jump and looking up in third person; a conversion group's scale and an imported mesh under the gizmo. Each fails on 0.8.1.
- `test/usd-validate.py` checks the Unreal marker placement (trigger extent, yaw, Player start height) with usd-core.
- Unit tests cover single- and triple-quoted strings, escapes, keys inside strings, stage headers, SkelRoot, unsupported prims, `ptah:type` lookup keys, step caps, the prim limit, the Custom profile's base template, and history after a throwing command. Timing limits are wider, and the smoke test waits for events instead of sleeping.

## 0.8.1 (2026-09-25)

### Fixed
- **Markers blocked the player in walk mode.** Spawn, Cover and Objective markers stopped the player about 100 u short and shortened the third-person camera. Walk collision now uses object geometry only; marker and note visuals never block.
- **The Player start's capsule reappeared mid-walk.** Editing a metric, switching profile or toggling ticks (`H`) during a walk rebuilt the capsule you were standing in, visible. It now stays hidden until the walk ends. This was the "mannequin still visible in first person" report.
- **Hidden objects half-counted toward the auto-grown ground,** and the reference underlay did not count at all, so a large floorplan could run past the grid into the fog. Hidden objects no longer grow the grid; the underlay does.
- **A file's out-of-range ground size was rewritten without a word.** Opening a file whose `ptah:ground` is outside 512 to 102400 u now warns that it was clamped.
- **The Select rail tooltip said Esc drops the gizmo.** Only Q does; Esc returns to Select with the current gizmo.

### Changed
- **The release workflow can create its own tag.** Actions → Release desktop builds → Run workflow with a `tag` (such as `v0.8.1`) builds the branch, checks the tag against `package.json`, and creates the tag and the Release on the built commit. Only the release job can write to the repository.
- **CI cancels superseded runs on a pull request;** every push to `main` still runs, and deploys, on its own.
- Saving no longer schedules a ground rescan. The import-size message comes from one constant in `usd.js`. Dead code removed from `usd.js` and `walk.js`.

### Tests
- **New scenario step:** walk through a Spawn marker, and edit the metrics mid-walk with the start capsule hidden. It fails on 0.8.0.
- **The sample file's embedded PNG was corrupt** (bad CRC, truncated data), which logged `texSubImage2D: bad image data` in the Electron smoke test. Both runners now fail on WebGL warnings.
- **The smoke test holds the Save As dialog open** so its "edit during a save" check is guaranteed to edit mid-save, the menu undo/redo checks assert their condition, and its screenshot goes to `test/.out/` instead of overwriting a committed file.
- The ground step calls the ground check directly instead of sleeping past its debounce, and checks that a hidden object no longer grows the grid. The browser runner checks that the topbar fits at 1024 px. Cube placement for the runners lives in `test/page-helpers.mjs`.

### Docs
- README: Quick start installs Playwright's Chromium and `usd-core`; the feature list, keyboard table, architecture tree and CSP sentence match the code. `ptah:ground` is documented in README and `docs/importing.md`. The gap analysis uses the current UE Third Person numbers.

## 0.8.0 (2026-09-25)

### Added
- **Ground size.** A **Ground** field next to Grid sets the minimum width of the drawn grid (default 4096 u, 512 u to 102400 u), undoable and saved with the level (`customLayerData` `ptah:ground`, written only when it differs from the default). The grid also doubles automatically to cover anything built past it, and shrinks back when that is undone or deleted; the distance fog, far plane and zoom-out limit follow it. Very fine grids over a large ground draw coarser line spacing (noted in the grid legend) instead of millions of lines.
- **The Hierarchy works from the keyboard.** It is an ARIA tree with one tab stop: arrows move and select, Left/Right collapse, expand or walk the tree, Space toggles membership, Enter/F2 renames, Shift+H hides, and Alt+arrows reorder and reparent (undoable). Global shortcuts (Delete, Ctrl+G, W/E/R) act on the selection as before. Touch devices, which have no HTML5 drag and drop, get the same reparenting path with a keyboard.
- **Rail buttons have accessible names and announce their shortcut** (`aria-label`, `aria-keyshortcuts`); the glyphs are hidden from screen readers.
- **Linux Electron sandbox pre-flight.** On Ubuntu 24.04+ (AppArmor's unprivileged user-namespace restriction) Electron needs its SUID `chrome-sandbox` helper owned by root with mode 4755, which npm cannot arrange, and `npm start` died with a SIGTRAP. `tools/check-electron-sandbox.mjs` now runs before `npm start` and `npm run test:smoke`, detects the case and prints the exact `chown`/`chmod` fix. It is a no-op elsewhere; `PTAH_SKIP_SANDBOX_CHECK=1` bypasses it.

### Changed
- **The editor idles.** It rendered every frame at display rate even with nothing happening. It now renders at full rate while there is input, camera damping, a drag, walk mode or an edit, and drops to four frames a second after 1.5 s idle.
- **A lost WebGL context is survivable.** GPU switches, sleep and driver resets used to leave a black canvas; Ptah now says so and renders again when the browser restores the context.
- **Housekeeping.** `build-windows.yml` is manual-only (`release.yml` builds installers; the old workflow built NSIS on every push to `main`) with a timeout and npm cache; every action is pinned to a commit SHA (Dependabot keeps them current); CI has `permissions: contents: read`; the installer and the Pages site no longer ship the unused 1.2 MB `mannequin.glb`; the CSP drops `style-src 'unsafe-inline'`; a committed `.pyc` is gone and ignored; `test/serve.mjs` uses a separator-safe path check.
- **`ptah:id` is 64 bits instead of 32.** New objects get a 16-hex-digit id, so ids from separately built levels are far less likely to collide in an engine that keys on them. Ids already in older files are read and kept unchanged.
- **Foreign `.usda` import is exact where it used to guess.** `xformOpOrder` is honored: ops compose in listed order, unlisted ops are ignored, and suffixed and `!invert!` ops (Maya pivots) compose exactly instead of warning "approximate". Mirrored matrices keep the mirror as a negative scale instead of a folded 180° rotation. A Z-up or metre-based file (Blender, Houdini, Unreal) is wrapped in one converting group instead of landing on its side at 1/100 scale. Only sheared transforms are still approximate.
- **The `.usda` reader is one linear pass.** Prim heads are found by a bracket-aware scanner rather than re-scanning each level's body, and comment stripping copies slices rather than characters, so a deeply nested file parses in time proportional to its size (a 20 MB, 62-deep file took 18 s before). Point and index budgets are counted before the arrays are parsed, so an oversized mesh is refused in milliseconds.
- **Desktop saves are atomic.** The file is written to a temporary sibling, flushed, and renamed over the target, so a crash, full disk or power loss mid-write leaves the previous version intact; the previous version is also kept as `<name>.bak`.
- **Explicit macOS application menu.** Electron's default menu (Edit > Undo calling the browser's text undo, View > Reload, Toggle DevTools, Cmd+R) is replaced by a minimal File / Edit / View menu whose items forward to Ptah. Its accelerators are display-only, so Cmd shortcuts still go through the editor's own keyboard handler once. Needs a hands-on pass on a Mac (see `HANDOFF.md`).
- **Permission requests are denied except pointer lock** (Electron grants everything by default).
- **Raised the supported Node.js floor to 22.** `package.json`, the launchers and the docs now consistently require Node.js 22 or newer.

### Fixed
- **The topbar clipped Snap, Faces, Ticks and Walk off the right edge** below about 1200 px (Electron's minimum window is 1024). It wraps to two rows on narrow windows.
- **An edit made while a save was in flight was marked as saved.** A save now only marks clean what it wrote, and a Save pressed during a save runs afterwards.
- **Undoing a multi-object delete, duplicate or move left one object selected.** The whole set is reselected.
- **Duplicating a copy produced a second object with the same name.** Copies are now `_copy`, `_copy2`, `_copy3`...
- **Inline `#` comments aborted the file.** `double size = 2 # a 6" cube` left a stray quote that unbalanced everything after it. `#` now starts a comment anywhere outside a string, and single-quoted and triple-quoted strings are recognized.
- **`class`, `over` and every variant of a `variantSet` imported as live prims** (duplicate siblings, prototypes at the origin). They are skipped now, apart from the selected variant, and skipped class/over prims are reported.
- **Animated (`timeSamples`) values were ignored silently;** one warning now says only static values are imported. A skipped mesh inside an Xform no longer warns (and counts toward the budgets) twice.
- **A level nested deeper than the importer accepts could be saved and then not reopened.** The limit is 62 levels on both sides: grouping and moving in the hierarchy stop there with a message, and foreign files nested deeper (including via the Z-up conversion group) are refused on import.
- **macOS: a spurious unsaved-changes prompt** after "Discard changes" and reopening from the Dock (the main process's dirty flag was never reset for a new window).
- **Tab was a keyboard trap.** It entered walk mode whenever focus was not in a text field, so a keyboard user could not tab past the first toolbar button. Tab now enters walk mode only when nothing has focus (after a viewport click); otherwise it moves focus. Closing the profile picker no longer leaves focus on a hidden card.
- **Focus on numeric fields, the name field, pickers and profile cards was a subtle border change only.** They now show the same gold `:focus-visible` outline as buttons.
- **Tags containing `]` vanished on reload.** The `.usda` reader captured arrays up to the first `]`, so `ptah:tags = ["[wip]", "lane-a"]` imported with no tags at all. Array bodies are now found with the same string-aware bracket matcher the prim parser uses. The Unity marker importer (`tools/unity/Editor/PtahMarkers.cs`) had the same bug and also mis-decoded a backslash followed by a quote; both are fixed.
- **Text ending in `def` could swallow the next prim.** Prim heads were matched anywhere, including inside a tag such as `"see def "`, which ate the cube's `Geom` child (lost color) or a mesh's geometry. Prim heads must now start a statement, and attribute names must not be the tail of a longer name (`points` no longer matches `primvars:points`).
- **X-axis Cylinder gprims imported with height and diameter swapped.** A 10-long rod along X came in as a 2-long, 10-wide disc.
- **A UTF-8 BOM dropped the metrics profile and reference image.** Files re-saved by Notepad now keep their stage metadata.
- **Coordinates near `Number.MAX_VALUE` could be written as `Infinity`,** which is not valid USDA.
- **A gizmo drag interrupted by Esc, Delete or Undo dropped out of history.** The end-of-drag handler looked at the (possibly emptied) selection before the drag's own record, so the move was never recorded and the next Undo removed the previous command instead. The drag now ends from its own record; while a drag, placement or extrude is in progress only Esc acts, and it cancels the gesture and puts everything back.
- **Ctrl+G or a hierarchy move during a placement drag left an unselectable ghost after Undo.** Group, move and delete wait until the placement is recorded, and a reparent never re-attaches a node whose record is gone.
- **Renaming a marker left its floating label showing the old name** until the next metrics change.
- **Extrude could get stuck** if pointer capture threw (it now uses the guarded helper), and a placement or extrude whose `pointerup` never reached the canvas (`pointercancel`, lost capture) left the editor in that mode.
- **A gizmo that appeared under a still cursor** (W/E/R, Undo) could start a marquee and a drag from one click.
- **The Group button kept focus after a click,** so Space or Enter re-grouped once per press.
- **Autosave offered the wrong work.** There was one shared snapshot, never cleared on Open: after discarding A and opening B, the next launch offered A; and two tabs of the web build overwrote each other's snapshot. Snapshots are now kept per tab (reload-stable via `sessionStorage`), a tab offers its own snapshot first and otherwise the newest one whose tab has closed (open tabs answer a `BroadcastChannel` roll call), and Open or a dropped file discards the old scene's snapshot. Snapshots older than 30 days are pruned; a shared snapshot from before 0.8.0 is still offered once.
- **"Restore" reported success when the snapshot failed to load,** then marked the empty scene dirty, which overwrote the only copy three seconds later. It now keeps the snapshot and returns to the profile picker.
- **`test/sample.usda` still said v0.7.0.** Regenerated; the unit tests now assert that `APP_VERSION` and the sample both match `package.json`.
- **The web build could pair a new page with old scripts.** GitHub Pages caches every file for up to 10 minutes, so right after a deploy a browser could load the new `index.html` with the previous `usd.js` (a field present with no handler behind it). The deploy now publishes the scripts under a per-commit folder (`js-<commit>/`), so a page only ever loads the scripts it shipped with.

### Tests
- **The Electron smoke test boots the real `main.js`.** It used its own window with no preload, so the IPC handlers, `knownPaths`, the dialogs, the title and the close guard had no coverage. Dialogs are stubbed; the test checks Save As, Save without a dialog, the `.bak` and no leftover temp file, that a renderer-supplied path never picked is not written, the close guard, menu forwarding, Open and the permission handler.
- **The browser E2E checks both render rates** (full rate under input, four frames a second when idle).
- **`test/pages.test.mjs`** checks the Pages packaging: scripts move to the versioned folder together and `index.html` points at it.

## 0.7.3 (2026-09-23)

### Changed
- **First desktop release version bump.** Ptah is now version 0.7.3 in the app and package metadata.
- **Windows CI install uses `npm ci`.** The Windows build workflow now installs from the lockfile the same way as the other workflows.

## 0.7.2 (2026-09-21)

### Fixed
- **Profile picker overflowed its dialog.** v0.6.0 made every button `white-space: nowrap` for the topbar; the picker cards are buttons, so their numbers line could not wrap and pushed the grid past the dialog's edge. Cards wrap again and the numbers are laid out on two lines. The E2E now asserts every card sits inside the dialog.

### Added
- **Launchers.** `Launch Ptah.command` (macOS), `Launch Ptah.bat` (Windows), `launch-ptah.sh` and `Ptah.desktop` (Linux) start the built-in server and open the editor in the default browser, no terminal commands needed. They check for Node.js and say where to get it. `test/serve.mjs --open` is what they run; it also falls back to a free port when 8123 is taken.

## 0.7.1 (2026-09-18)

### Fixed
- **The mannequin was too big, twice.** It was scaled to the collision capsule (192 in Unreal), but the templates' visible mannequins are about 180 cm inside that capsule; and the walk camera used the editor's 50° vertical lens where the templates use 90° horizontal (about 59° vertical at 16:9). Together she filled a quarter more of the frame than she would in Unreal. Two profile numbers fix it: **Character height** (visible mesh; UE 180, Unity 180) scales the mannequin, while ticks, markers, collision and the derived sizes keep the capsule; **Camera FOV** (horizontal; UE 90, Unity 66, from Cinemachine's 40° vertical) applies for the walk and is restored on exit. Both are editable, saved in the file, and shown on the picker cards.

## 0.7.0 (2026-09-18)

### Added
- **Third-person walk.** Walk mode now has two views, `V` switches: first person as before, or third person with a mannequin on a boom camera the way the Unreal and Unity third-person templates do it: the mouse orbits, input is camera-relative, the character turns to face where it moves, the boom shortens against walls (400 u, the UE template's arm length). The mannequin is scaled to the profile's player height, plays idle / walking / jump (walking time-scaled to the real speed from the clip's own root motion), and is never picked, saved or exported. Third-person profiles start in third person, first-person profiles in first; `V` sticks for the session.
- **Mannequin pipeline.** `tools/mixamo/fbx2ptah.py` reads binary FBX directly (no SDK, no Blender) and writes a skinned glTF with clips: one Mixamo character plus any of its animation files. `renderer/js/gltf.js` is a small glTF 2.0 reader (three.js core ships none) covering skinned, animated characters. The mannequin ships as a base64 module so it loads under the CSP in both builds. See `renderer/assets/README.md` for provenance and licence notes.
- Version shown in the status bar as well as the brand.

### Changed
- Walk mode keeps the player position separately from the camera (needed for the boom); no behaviour change in first person.
- Topbar tightened so every control fits at 1440 px; the brand subtitle and the opacity percentage hide below 1500 px.
- `npm run test:unit` runs with a resolver hook so app modules that import `three` can be unit-tested under Node.

### Tests
- 163 unit assertions: the glTF reader on the mannequin (rest pose reproduces the bind pose to 1e-3, seven clips bind with no warnings, root motion stripped, natural walking speed 160 u/s). 66 E2E steps: third-person entry, scale, boom length, walking and facing, jump clip, `V` both ways, mannequin hidden on exit.

## 0.6.0 (2026-09-18)

Closes the second hands-on review.

### Changed
- **Tool rail regrouped**: Q W E R X (select and manipulation), then C Y S P V T (primitives), then M N K (measure, note, marker).
- **One mode at a time.** Q, W, E and R are a radio group: Q is select with no gizmo, W / E / R are select with that gizmo. Placement, measure and extrude light only their own button. Escape returns to select with the gizmo you had; Q drops the gizmo but keeps the selection.
- **Position Y readout**: a `center` / `base` toggle beside the Position label. In base mode the Y field shows and sets the bottom of the object (a 64 cube on the ground reads 0, not 32). Display convention only; the file keeps the center transform. Remembered per browser.

### Fixed
- **`K` and other letter shortcuts died after using a topbar picker.** The Preset and Marker menus kept focus when closed without a choice and swallowed every key. They now keep only the keys a menu needs and hand letters back to the editor.
- Clicked buttons no longer keep keyboard focus, so Space or Enter cannot re-fire them (clicking Walk, then pressing Space to jump, used to leave walk mode).

### Tests
- 65 E2E steps: rail order, exclusive modes, K with a focused picker, pivot readout, and a snapping stress step (45°-rotated cube, odd-height block).

## 0.5.1 (2026-09-18)

### Fixed
- **Falling through floors when jumping.** Landing tested for a floor under the feet's *new* position, so any surface passed within one frame of fall was missed and the player dropped to the ground below. Landing is now a sweep from where the feet were: the highest surface between the previous and current position is where you land. Frame time is also clamped to 50 ms, so a hidden tab or a hitch cannot become a two-second free fall. Regression step in the E2E: a 32 u slab at 20 fps.
- **Unreal capsule sizes.** The profiles used the Character class defaults (34 / 88). The templates set their own: Third Person `InitCapsuleSize(42, 96)`, First Person `InitCapsuleSize(55, 96)`, so 192 tall, 84 / 110 wide. Eye heights follow (160 / 156), as do derived sizes: UE Third Person doors 360 × 170, corridor 340, full cover 220; UE First Person doors 310 × 220, corridor 440.

### Changed
- **Snapping snaps edges, not centers.** A 64 u cube whose center sat on a grid intersection straddled the lines and never tiled with its neighbours. Placement and gizmo translation now snap the selection's world bounding box (min corner and bottom) to grid multiples, so blocks land on grid lines and stack on each other; notes and markers snap their point. Rotation still snaps in 15° steps and size in whole cells.
- **Shift inverts snapping while held**: with Snap off, hold Shift to snap a placement, move, rotation or extrude; with Snap on, hold Shift to move freely. The status bar shows the live state.
- Version 0.5.1.

## 0.5.0 (2026-09-18)

### Added
- **Profile picker on startup.** Before a new level can be touched, Ptah asks what you are building for: Unreal Engine Third Person, Unreal Engine First Person, Unity Third Person (Starter Assets) or Unity First Person (Starter Assets). Each card shows its capsule, eye height, walk speed, jump and the door/cover sizes it implies. Shown on launch (after any recovery offer), on New, and from Metrics → Change (undoable, cancellable). Opening a file never asks: files carry their profile.
- **Engine template metrics.** The four profiles use the templates' own numbers (UE: capsule 176 × 34, walk 500/600, jump 143/90, step 45, crouch 80; Unity: controller 180 × 28/50, walk 200/400, sprint 534/600, jump 120, step 25). Cover, door and corridor sizes are derived by stated rules (door height = height + jump + 20 so a jumping player clears the lintel; door width = 4 × radius, at least 120; corridor = 2 × door; half cover = crouch + 20; full cover = height + 20) and stay editable. Editing any number marks the profile Custom; Reset returns to the template.
- **Capsule radius** is a metric. PlayerStart and Spawn markers, walk-mode collision and the derived door width all read it. The old hard-coded 20 drew a figure thinner than any engine's default.
- Marker placement is on the tool rail (`◎`, `K`), beside the primitives; the topbar menu still picks the kind.
- Turning Ticks on in a scene with no capsule marker says where ticks appear and how to place one.
- Version shown in the brand and in the picker.

### Changed
- Default profile (files without one, unit tests, `make-samples`) is Unreal Third Person: player 176 × 34, eye 152, step 45, door 340 × 140, corridor 280. Previous defaults (180 / 165 / 40 / 240 × 120 / 300) were real-world architecture numbers and mismatched every engine template.
- Preset wall and post thickness 16 → 32 u.
- The file's `ptah:metrics` dictionary gains `string profile` and `double capsuleRadius`. v0.3/v0.4 files load with their numbers and profile Custom.

## 0.4.0 (2026-09-18)

### Added
- **Extrude a face** (`X`, rail button): hover any axis-aligned face of a primitive, drag it along its normal. The opposite face stays put, so a wall gets longer from its end and a floor thicker from its top. Grid snap lands the face on grid planes (world-aligned faces) or snaps the travel to whole cells (rotated objects). One undo step. Sloped and curved faces are refused with a status note. This is a size change on the unit primitive, not polygonal extrusion, so exports are unchanged in shape.
- **Walk from the Player start**: `Tab` now starts at the selected PlayerStart marker (else the first one in the scene, else the camera target as before), facing its −Z, standing on whatever is under it. The marker's capsule hides while you walk; the HUD names the start.
- **Ticks** (`H`, replaces the Player toggle): height ticks for player height, eye, crouch, full cover, half cover and step on every PlayerStart and Spawn capsule. Drop a capsule beside a block and read the heights. Default on.
- **Grid opacity** slider in the topbar (0–100%), remembered per browser. Dim the grid to trace a reference underlay.

### Changed
- The fixed player figure at the origin is gone. It could not be moved and had nothing to do with where walk mode began; the PlayerStart marker is the player now. Files are unaffected (the figure was never saved).

## 0.3.0 (2026-09-17)

Built against the studio level designer use case in `docs/level-designer-gap-analysis.md`: a blockout is geometry plus gameplay data, designed to fixed metrics and exported cleanly.

### Added
- **Metrics profile** (Metrics panel): player, eye, crouch and step heights, walk/run speed, jump height and distance, half/full cover, door and corridor sizes. Saved in the file (`customLayerData "ptah:metrics"`), undoable, defaults for files that have none. Drives the `H` marker (now with metric ticks), PlayerStart capsules, presets and walk mode.
- **Presets** (topbar picker): Half cover, Full cover, Doorway (grouped posts + lintel), Corridor (grouped floor + walls), Step run (risers = step height). Sized from the profile, tagged with the matching intent, placed with a click.
- **Intent palette** replaces the six decorative colors: Floor, Wall, Cover, Blocker, Water, Hazard, Interactive, Placeholder. Exported as `custom string ptah:intent` plus `displayColor`. New objects default to an intent by type (cube/cylinder wall, plane/wedge/stairs floor, sphere placeholder).
- **Gameplay markers** (topbar picker, `K` re-arms the last kind): PlayerStart and Spawn (player-sized capsules with facing arrow and eye line), Cover point, Objective, Trigger volume (box; Size is the volume). Exported as empty Xforms with `custom string ptah:marker`; volumes carry their size in the scale op. Kind and free-form **tags** (`custom string[] ptah:tags`) edit in the Inspector; tags work on geometry too.
- **Engine scripts**: `tools/unreal/ptah_import.py` (spawns PlayerStart / TargetPoint / TriggerBox actors from the markers, folder per kind, tags carried over; `--dry-run` works with plain usd-core) and `tools/unity/` (Editor menu that converts markers to tagged objects, trigger colliders and `PtahMarker` components). `docs/importing.md` covers both engines, coordinates, pivots and naming.
- **Multi-object numeric edits**: with several objects selected the Position / Rotation / Size fields show the shared value or an em-dash when mixed; typing sets every top-level object; `+=`, `-=`, `*=`, `/=` apply relative changes per object. One compound undo. Relative entry also works on a single object.
- **Face-to-face snapping** (`Shift+G`, Faces button): while dragging, a face within half a grid cell of another object's facing or coplanar face snaps flush (butt joints, alignment, stacking), highlighted with a plane. Each axis snaps independently so pushing into a corner closes both gaps. Off by default.
- **Walk mode**: `Space` jumps (apex = jump height, reach at run speed = jump distance), `C` or `Ctrl` crouches to crouch height. Eye height, step height and speeds come from the profile.
- **Autosave and recovery**: a snapshot of the level is written to IndexedDB a few seconds after each edit and at least once a minute while dirty. On launch, unsaved work is offered back in a bar over the viewport; Save and New discard it. Works in the browser build and Electron alike.
- Persistent per-object id (`ptah:id` in customData) so identity survives save/load.
- Measure tool shows meters beside units.
- Tests: 136 unit assertions (v0.3 format round trips including escaped tags and marker volumes, preset sizing against the profile, face-snap cases) and an E2E scenario extended with metrics, crouch/jump, presets, markers, multi-edit and face snap; the browser runner also reloads the page and recovers the autosave snapshot.

### Changed
- Default colors are the intent palette: cylinders are now wall slate (was clay), spheres placeholder magenta (was sage), wedge and stairs floor slate (was wall slate). Loaded files keep their colors.
- The topbar player-height field moved into the Metrics panel.
- `test/sample.usda` now carries a metrics profile, intents, tags and two markers.

### Fixed
- Nothing user-visible; v0.2 open items (unverified Electron smoke, `dist`, usd-core, lockfile) are unchanged and listed in `HANDOFF.md`.

## 0.2.0 (2026-09-17)

### Added
- Scene tree: groups and parenting. `Ctrl+G` / `Ctrl+Shift+G`, drag and drop in the Hierarchy (before, after, into), collapse carets, child counts. World transforms are preserved on every regroup; all of it is undoable.
- Multi-select: Shift/Ctrl+click in the viewport and Hierarchy, marquee box select, `Ctrl+A`. Centroid pivot gizmo for moving, rotating and scaling several objects; colors, duplicate and delete apply to the whole selection.
- Gizmo scale snapping on single objects (sizes snap to whole grid cells, 1u minimum).
- Wedge (ramp, `V`) and stairs (`T`) primitives. Stairs are watertight with no T-junctions and carry a per-object step count (`ptah:steps`).
- Notes (`N`): pinned annotations with title and text, exported as empty Xforms with `ptah:text`.
- Walk mode (`Tab`): first-person camera at 93% of player height, WASD + Shift, pointer-lock look, wall blocking at knee height, floor following over stairs and ramps.
- Reference image underlay: load or drop an image, set width, rotation, offset and opacity; embedded (downscaled) in the `.usda` as `customLayerData`.
- Browser build: `renderer/` runs from any static host. `renderer/js/platform.js` wraps the host differences (File System Access API with download fallback, `beforeunload` guard). Web manifest and icon.
- Unsaved-changes guard on Electron window close.
- Import of foreign USD keeps hierarchy (plain Xforms become groups, empties survive) instead of flattening with a warning.
- Tests: manifold + analytic volume checks for all primitives, escaping, hierarchy/notes/stairs/reference round trips, byte-identical re-export, comment stripping, checked-in fixtures (v0.1 and current). Shared E2E scenario run by both Playwright/Chromium and Electron, covering every new interaction. `test/usd-validate.py` for Pixar usd-core.
- GitHub Actions: CI (unit, browser E2E, Electron smoke, usd-core), GitHub Pages deploy of the web build, tagged releases for Windows/macOS/Linux with optional signing and notarization.
- `LICENSE` (MIT), app icon, `.editorconfig`, `.nvmrc`, `CHANGELOG.md`.

### Changed
- Electron `^31.3.0` → `^44.4.1`, electron-builder `^24.13` → `^26.16`, Playwright added as a dev dependency.
- Hierarchy ordering and parenting are read from the Three.js scene graph (single source of truth); `state.order` is gone.
- Opening a file frames the whole level.
- Second directional fill light so faces away from the key light stay readable in walk mode.
- `test/sample.usda` is generated by `npm run samples`; the v0.1 sample is kept as `test/sample-v0.1.usda` for backward-compatibility tests.

### Fixed
- **Rotation convention.** three.js Euler `'XYZ'` is not USD `rotateXYZ` (they differ in application order), so any object rotated about two or more axes looked different in Unreal, Unity and usdview than in Ptah. Every node now uses Euler order `'ZYX'`, which is exactly USD/Maya `rotateXYZ` (X first). Verified against the vendored three.js in unit tests and against Pixar usd-core in CI (`test/fixtures/rotation.usda`). Files written by v0.1 with compound rotations were wrong in-engine; reopening and saving them in v0.2 fixes them to match what the editor shows.
- A string ending in a backslash (a Windows path in a note) made the whole file import as empty; bracket matching now tracks escapes properly.
- `//` inside string literals (base64 data URLs) and `@asset@` paths was stripped as a comment.
- A value typed into an inspector field was applied to whatever object was clicked next; the field is committed before the selection changes.
- Undoing a multi-object delete restored siblings in the wrong order.
- Dropping a file on the viewport navigated the window away from the editor (Electron had no way back). Drops are now intercepted: `.usda` opens, images load as the reference, everything else is ignored. Electron denies navigation and new windows; a Content Security Policy is set.
- Placement and measure clicks could land on the transform gizmo and start a drag; the gizmo is now hidden outside the select tool.
- Save and Open errors surface as toasts instead of failing silently.
- Scale can no longer be dragged to zero or negative (which produced NaN transforms after a regroup).
- Three.js geometries, materials and textures are disposed when objects, grid labels, measurements and the player marker are rebuilt or removed; grid label count is capped for tiny grid sizes.
- Loading a large file no longer rebuilds the hierarchy panel once per object.
- Name counters advance past names present in a loaded file; Save As suggests the current file name.
- A pointer lock granted after leaving walk mode is released instead of blocking pointer capture for the session.
- Foreign USD with `xformOp:orient`, `xformOp:transform` or non-XYZ rotate orders imports correctly instead of at the origin; pivot ops warn that the transform is approximate. USD `Cylinder` gprims honor their `axis` (default Z).
- The reference image in a file must be embedded image data; the editor never fetches a URL from a file.
- Camera matrices are refreshed before picking and projection, so input arriving between frames hits the right thing.
- Removed dead `topLevelOnly()` in `usd.js`.

## 0.1.0

Initial release: cube/cylinder/sphere/plane placement, move/rotate/scale gizmo with grid snapping, measure tool, player height marker, hierarchy and inspector, undo/redo, `.usda` export and tolerant import, Electron packaging.
