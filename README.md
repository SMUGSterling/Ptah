# Ptah

Ptah is a 3D level blockout editor for level designers, in a studio, a classroom or on your own. You block out a level to your engine's real player metrics, mark what every piece is for, drop in spawns and triggers, walk it at player height, and export a `.usda` file that opens in Unreal Engine or Unity with the geometry and the gameplay data intact.

![Ptah editor with a grouped tower, stairs, ramp and notes](docs/editor.png)

## Open Ptah

**In your browser (nothing to install):**

- **<https://levi-sterling.com/Ptah/>**
- **<https://smugsterling.github.io/Ptah/>** (the same app)

Chrome and Edge save your level straight back to the file you opened. Firefox and Safari download a copy each time you save instead.

**As a desktop app:** download the latest release from the [Releases page](https://github.com/SMUGSterling/Ptah/releases/latest).

| Your computer | Download |
| --- | --- |
| Windows | `Ptah-<version>-win-x64-setup.exe` to install, or `…-portable.exe` to run without installing |
| Mac (Apple Silicon) | `Ptah-<version>-mac-arm64.dmg`. On an Intel Mac, use the browser version |
| Linux | `Ptah-<version>-linux-x86_64.AppImage`, or the `.deb` for Ubuntu and Debian |

The desktop builds are not code-signed yet, so the first launch shows a warning:
- **Windows:** "Windows protected your PC". Click **More info → Run anyway**.
- **Mac:** right-click the app and choose **Open**, then **Open** again.

**Without the internet:** if you have a copy of this repository (**Code → Download ZIP** on GitHub) and [Node.js](https://nodejs.org) 22 or newer, double-click the launcher in the folder:
- **Mac:** `Launch Ptah.command`
- **Windows:** `Launch Ptah.bat`
- **Linux:** `launch-ptah.sh` or `Ptah.desktop`

It opens Ptah in your browser. Leave the small terminal window open while you work.

Ptah never sends anything anywhere. There are no accounts, no tracking and no network requests; your level stays on your computer.

## Your first level

1. **Pick the template you are building for.** Ptah asks once per new level: Unreal Engine Third Person or First Person, or Unity Third Person or First Person (Starter Assets). It loads that template's player size, eye height, speeds, jump and step height, and sizes cover, doorways and corridors from them. The file remembers your choice; **Metrics → Change** switches it later.

   ![Profile picker](docs/picker.png)

2. **Block out.**
   - Press `C` and click the grid to place a cube. `Y`, `S`, `P`, `V` and `T` place a cylinder, sphere, plane, wedge (ramp) and stairs.
   - `W`, `E` and `R` move, rotate and scale.
   - Type exact sizes and positions in the **Inspector** on the right.
   - The **Presets** menu places cover, doorways, corridors and step runs already sized to your template.
3. **Say what each piece is.** Pick an **intent** swatch in the Inspector: Floor, Wall, Cover, Blocker, Water, Hazard, Interactive or Placeholder. The colour is the intent, and it travels with the file.
4. **Add gameplay markers.** Press `K` (choose the kind in the **Marker** menu) to place a Player start, enemy Spawn, Cover point, Objective or Trigger volume. Add tags in the Inspector.
5. **Walk it.** Click an empty spot in the viewport, then press `Tab`:
   - `WASD` walk, `Shift` run, `Space` jump, `C` crouch, the mouse looks around.
   - `V` switches between first and third person.
   - `Esc` returns to the editor.
6. **Save** with `Ctrl+S` (`Cmd+S` on a Mac). The file is a `.usda`; see [Taking your level into an engine](#taking-your-level-into-an-engine).

![Walk mode at the foot of a staircase](docs/walk.png)

## What you can do

**Building**
- **Primitives:** cube, cylinder, sphere, plane, wedge (ramp) and stairs. Click to stamp one, or drag to place it. Stairs have an editable step count.
- **Extrude** (`X`): drag a face of a block to lengthen it from one end; the opposite face stays put.
- **Groups:** `Ctrl+G` groups the selection and `Ctrl+Shift+G` ungroups. Drag rows in the **Hierarchy** to reorder or nest them; objects stay where they are in the world.
- **Selecting several objects:** `Shift+click`, `Ctrl+click`, drag a box on empty space, or `Ctrl+A`. The gizmo then moves, rotates or scales them together.
- **Editing numbers:** with several objects selected, the Inspector shows the shared value (or a dash when they differ). Type `+=64`, `-=8`, `*=2` or `/=2` to change each one relative to its own value. The **center / base** toggle beside Position makes the Y field read the bottom of the object.
- **Snapping:** `G` snaps to the grid, and holding `Shift` flips snapping while you drag. `Shift+G` snaps faces flush against neighbouring blocks.
- **Measure** (`M`): click two points to read the distance in units and metres.

**Designing to metrics**
- **Metrics panel:** the numbers your level is built to: player height and width, eye, crouch and step heights, camera field of view, speeds, jump height and distance, and the cover, door and corridor sizes. Change any of them and the profile becomes *Custom*; **Reset** goes back to the template you started from.
- **Height ticks** (`H`): every Player start and Spawn capsule shows marks for player, eye, crouch, cover and step height, so you can drop one beside a block and read it like a ruler.
- **Third person** (`V` while walking): a mannequin at your template's character height, with a camera behind it like the engine templates. Third-person templates start in third person.

**Planning**
- **Notes** (`N`): pin a note to a surface. Its title and text are saved in the file.
- **Reference image:** load a floor plan or paper sketch in the **Reference** panel (or drop an image on it), set its width, rotate, move and dim it. It is saved inside the level file.
- **Grid:** the **Grid** field sets the cell size; the **Ground** field sets how wide the grid is drawn (it grows on its own if you build past it). The slider dims the grid so a reference image shows through.

**Safety nets**
- **Undo everything** with `Ctrl+Z`: placing, moving, grouping, metrics and reference changes alike.
- **Autosave:** Ptah keeps a recovery copy a few seconds after every change. If the browser or computer crashes, reopen Ptah and a bar offers your work back.
- **Safe saves (desktop):** the previous version of your file is kept next to it as `<name>.bak`, and a crash during a save never leaves a half-written file.

![Third-person walk: the mannequin climbing the same staircase](docs/walk3p.png)

## Keyboard reference

| Key | Action |
| --- | --- |
| Q | Select, with no gizmo |
| W / E / R | Select with the move / rotate / scale gizmo |
| Esc | Back to Select (keeps the current gizmo) and clear the selection. Cancels a drag or placement in progress, and leaves walk mode |
| C / Y / S / P | Place cube / cylinder / sphere / plane |
| V / T | Place wedge (ramp) / stairs |
| N | Place a note |
| K | Place a marker (the kind last picked in the Marker menu) |
| X | Extrude: drag a face |
| M | Measure between two points |
| G | Grid snapping on / off |
| Shift (held) | Flip snapping while dragging |
| Shift+G | Face-to-face snapping on / off |
| H | Height ticks on marker capsules |
| F | Frame the selection (or the whole level) |
| 1 / 3 / 7 / 0 | Front / right / top / free camera |
| Tab | Walk mode, starting at the selected Player start. Works when nothing else has keyboard focus; otherwise use the **Walk** button |
| In walk mode | `WASD` move, `Shift` run, `Space` jump, `C` crouch (also `Ctrl` in the desktop app), mouse look, `V` first / third person, `Esc` or `Tab` to leave |
| Shift+click or Ctrl/Cmd+click | Add to or remove from the selection |
| Drag on empty space | Box select |
| Ctrl+A | Select all |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Ctrl+D | Duplicate |
| Del / Backspace | Delete |
| F2 | Rename (or double-click a Hierarchy row) |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / redo |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+O | Open |
| Ctrl+N | New (desktop app; in a browser use the **New** button, because browsers keep Ctrl+N for a new window) |
| Middle mouse drag / right mouse drag / scroll | Orbit / pan / zoom the camera |

On a Mac, use `Cmd` wherever this table says `Ctrl`.

**Hierarchy panel:** the arrow keys move through the list (`Shift` extends the selection). Left and Right collapse or expand a group. `Space` adds or removes a row from the selection, `Enter` renames, and `Shift+H` hides or shows. `Alt` plus the arrow keys reorders, and `Alt+Right` moves an object into the group above it.

## Units and scale

- **1 unit = 1 cm.** A 180-unit capsule is a 180 cm player. Unreal uses the same scale; Unity converts to metres on import.
- The default grid cell is 64 units, with a heavier line every 4 cells.
- An object's **Size** in the Inspector is its width, height and depth in units. **Bounds** is the box around it and its children, which differs from Size once something is rotated.
- A child inherits its parent's scale. To organise objects without stretching them, group them (`Ctrl+G`) rather than parenting them under a scaled block.

## Taking your level into an engine

Save your level, then import the `.usda` file:
- **Unreal Engine 5:** enable the **USD Importer** plugin, then import the file or place a **USD Stage** actor.
- **Unity:** install the **USD** package (`com.unity.formats.usd`), then **Assets → Import USD**.

The geometry arrives with its intent colours. Markers arrive as named empty objects. A script in `tools/` turns them into real Player starts, spawn points and trigger boxes in either engine.

[docs/importing.md](docs/importing.md) walks through both engines step by step.

## Things to know

- **Saving in the browser:** Chrome and Edge save in place. Firefox and Safari download a copy each time. The first download in Safari may ask for permission, so check your downloads folder after your first save.
- **Opening other people's USD files:** Ptah reads files from Blender, Maya, Houdini and the engines, but only the geometry and transforms from a single file. References, payloads and animation are not imported. A file that is Z-up or not in centimetres comes in inside one group that converts it; ungroup it (`Ctrl+Shift+G`) to apply the conversion to the objects.
- **Walk mode is a scale check, not a game:** you collide at knee height (walls stop you, stairs and ramps carry you up), but there is no head collision, and the jump shows height and distance rather than game-feel.
- **Snapping uses bounding boxes,** so a rotated block snaps by the box around it, not its tilted faces.
- **Extrude changes a block's size.** It cannot cut a doorway out of a wall or extrude a sloped face; build doorways from blocks or use the Doorway preset.
- **Scale and rotation together:** a rotated child under a group that is stretched unevenly will shear. Unreal and Unity do the same.
- **Keyboard-only use:** placing a new object and orbiting or panning the camera need a mouse or trackpad. Once objects exist, selecting, editing (through the Inspector's fields), renaming, grouping and organising the Hierarchy all work from the keyboard, with the camera presets `1`, `3`, `7`, `0` and `F`.

## Help and feedback

Found a bug or have an idea? Open an issue on [GitHub](https://github.com/SMUGSterling/Ptah/issues). What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

Ptah is maintained by SMU Guildhall Academic Technology and released under the [MIT licence](LICENSE). Developers: building, testing and releasing are covered in [CONTRIBUTING.md](CONTRIBUTING.md).
