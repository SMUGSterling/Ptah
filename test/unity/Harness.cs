// Runs the real PtahMarkers.ConvertSelected() against a GameObject tree shaped like
// the USD importer's output for test/unity/make-level.mjs.

using System; using System.Linq; using UnityEngine; using UnityEditor; using Ptah;
static class Harness {
  static GameObject Go(string n) => new GameObject(n);
  static int fails = 0;
  static void Ok(bool c, string m) { Console.WriteLine((c ? "  pass  " : "  FAIL  ") + m); if (!c) fails++; }
  static GameObject roomSpawn;
  static GameObject Build(out GameObject arenaSpawn, out GameObject yardSpawn, out GameObject gate, out GameObject start) {
    arenaSpawn = Go("Spawn_01"); yardSpawn = Go("Spawn_01"); gate = Go("Gate"); start = Go("PlayerStart_01"); roomSpawn = Go("Spawn_02");
    var arena = Go("Arena").Add(arenaSpawn).Add(Go("Wall").Add(Go("Geom")));
    var yard = Go("Yard").Add(yardSpawn).Add(gate);
    var room = Go("Room__A___v2_").Add(roomSpawn);   // "Room (A) {v2}", sanitised the way Ptah names the prim
    var root = Go("Root").Add(start).Add(arena).Add(yard).Add(room).Add(Go("Note__tricky_"));
    // the older USD package: positions as in the file (x = 10, 20, 30, 40), the root scaled to metres
    // positions from make-level.mjs, Z mirrored as the USD package's basis change does
    arenaSpawn.transform.localPosition = new Vector3(10, 0, -5); yardSpawn.transform.localPosition = new Vector3(20, 0, 7);
    gate.transform.localPosition = new Vector3(30, 0, -9); roomSpawn.transform.localPosition = new Vector3(40, 0, 0);
    return Go("level").Add(root);                     // the imported asset's top object
  }
  // Unity 6.3's USD Importer: no "Root" object; the prims under Root sit directly under the asset's object
  static GameObject BuildImporter63(out GameObject arenaSpawn, out GameObject yardSpawn, out GameObject gate, out GameObject start, bool mirrorX = false) {
    var old = Build(out arenaSpawn, out yardSpawn, out gate, out start);
    if (mirrorX) foreach (var g in new[] { arenaSpawn, yardSpawn, gate, roomSpawn }) { var p = g.transform.localPosition; g.transform.localPosition = new Vector3(-p.x, p.y, -p.z); }
    var root = old.transform.children[0];
    var asset = Go("blockout");
    foreach (var c in root.children.ToArray()) asset.Add(c.gameObject);
    // Unity 6.3's USD Importer: positions converted to metres, scales left as they are
    foreach (var g in new[] { arenaSpawn, yardSpawn, gate, roomSpawn }) g.transform.localPosition = g.transform.localPosition * 0.01f;
    return asset;
  }
  static void Run(GameObject sel) {
    Selection.activeGameObject = sel; UnityEngine.Debug.log.Clear();
    typeof(PtahMarkers).GetMethod("ConvertSelected", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static).Invoke(null, null);
  }
  static PtahMarker M(GameObject g) { g.TryGetComponent(out PtahMarker m); return m; }
  static void Main(string[] a) {
    EditorUtility.path = a[0];
    // 1: the imported top object selected
    var top = Build(out var s1, out var s2, out var gate, out var start);
    Run(top);
    Ok(M(s1) != null && M(s1).kind == PtahMarkerKind.Spawn && M(s1).tags.SequenceEqual(new[] { "wave 1", "say \"hi\"", "br]acket \"q\"", "it's \"x\"", "back\\slash", "two\nlines" }), "Arena/Spawn_01 converted with its own tags, quoted the ways usd-core writes them: " + (M(s1) == null ? "none" : string.Join("|", M(s1).tags)));
    Ok(M(s2) != null && M(s2).tags.SequenceEqual(new[] { "wave 2" }), "Yard/Spawn_01 (same name) converted with its own tags");
    Ok(M(gate) != null && M(gate).kind == PtahMarkerKind.Trigger && gate.TryGetComponent(out BoxCollider b) && b.isTrigger && b.size.x == 1 && M(gate).volume.x == 1,
      "Gate trigger gets a trigger BoxCollider, size 1 under the older package's scaled root");
    Ok(M(start).facingLocal.z == 1 && UnityEngine.Debug.log.Any(l => l.Contains("1 Ptah unit became 1 Unity units and the importer mirrored Z")),
      "the older package: 1:1 units, Z mirrored, markers face Unity's forward: " + string.Join(" / ", UnityEngine.Debug.log));
    Ok(M(start) != null && start.tag == "Respawn", "PlayerStart tagged Respawn");
    Ok(M(roomSpawn) != null && M(roomSpawn).tags.SequenceEqual(new[] { "room" }), "a marker in a group named \"Room (A) {v2}\" is found at its full path and converted");
    Ok(UnityEngine.Debug.log.Any(l => l.Contains("converted 5 of 5")), "no fake marker read from note text or an attribute quoted in a string: " + string.Join(" / ", UnityEngine.Debug.log));
    // 2: selecting the Yard group (below Root): only Yard's markers, each with its own data;
    // Arena's Spawn_01 must not land on Yard's same-named object
    top = Build(out s1, out s2, out gate, out start);
    Run(top.transform.children[0].children[2].gameObject);
    Ok(M(s2) != null && M(s1) == null && M(s2).tags.SequenceEqual(new[] { "wave 2" }), "selecting Yard converts Yard/Spawn_01 with its own tags: " + (M(s2) == null ? "none" : string.Join("|", M(s2).tags)));
    Ok(M(gate) != null && M(start) == null, "selecting Yard converts the Yard trigger, not the PlayerStart outside it");
    Ok(UnityEngine.Debug.log.Any(l => l.Contains("converted 2 of 5") && l.Contains("3 are outside the selection")) && !UnityEngine.Debug.log.Any(l => l.StartsWith("WARN")), "reports the markers outside the selection without warnings: " + string.Join(" / ", UnityEngine.Debug.log));
    // 3: selecting Root: both spawns resolve by full path
    top = Build(out s1, out s2, out gate, out start);
    Run(top.transform.children[0].gameObject);
    Ok(M(s1) != null && M(s2) != null, "selecting Root resolves both same-named spawns by path");
    // 3b: the same level as Unity 6.3's USD Importer lays it out (the asset's object stands for Root)
    top = BuildImporter63(out s1, out s2, out gate, out start);
    Run(top);
    Ok(M(s1) != null && M(s2) != null && M(gate) != null && M(start) != null && M(roomSpawn) != null && UnityEngine.Debug.log.Any(l => l.Contains("converted 5 of 5")),
      "Unity 6.3 importer layout (no Root object): all 5 markers converted: " + string.Join(" / ", UnityEngine.Debug.log));
    Ok(M(s1).tags.SequenceEqual(new[] { "wave 1", "say \"hi\"", "br]acket \"q\"", "it's \"x\"", "back\\slash", "two\nlines" }) && M(s2).tags.SequenceEqual(new[] { "wave 2" }),
      "Unity 6.3 importer layout: same-named spawns keep their own tags");
    Ok(M(s1).facingLocal.z == 1 && M(gate).facingLocal.z == 1 && UnityEngine.Debug.log.Any(l => l.Contains("1 Ptah unit became 0.01 Unity units and the importer mirrored Z")),
      "Unity 6.3 importer layout mirroring Z: markers face local +Z (Unity's forward), and the Console says how the importer converted: " + string.Join(" / ", UnityEngine.Debug.log));
    Ok(gate.TryGetComponent(out BoxCollider b63) && Math.Abs(b63.size.x - 0.01f) < 1e-6 && Math.Abs(M(gate).volume.y - 0.01f) < 1e-6,
      $"Unity 6.3 importer layout: the trigger box is 0.01 (positions in metres, scale left in cm), so 200 x 100 x 50 cm stays 2 x 1 x 0.5 m (size {(gate.TryGetComponent(out BoxCollider bb) ? bb.size.x : -1)})");
    top = BuildImporter63(out s1, out s2, out gate, out start);
    Run(top.transform.children.First(c => c.name == "Yard").gameObject);
    Ok(M(s2) != null && M(gate) != null && M(s1) == null && M(start) == null && UnityEngine.Debug.log.Any(l => l.Contains("converted 2 of 5")),
      "Unity 6.3 importer layout: selecting Yard converts only Yard's markers: " + string.Join(" / ", UnityEngine.Debug.log));
    // an importer that mirrors X instead: Ptah's arrow (local -Z) stays -Z
    top = BuildImporter63(out s1, out s2, out gate, out start, mirrorX: true);
    Run(top);
    Ok(M(s1).facingLocal.z == -1 && M(start).facingLocal.z == -1 && UnityEngine.Debug.log.Any(l => l.Contains("mirrored X")),
      "an importer mirroring X: markers face local -Z: " + string.Join(" / ", UnityEngine.Debug.log));
    // 3c: an importer that leaves one of Root's prims out (here the note): the asset's object still stands for Root
    top = BuildImporter63(out s1, out s2, out gate, out start);
    var noteGo = top.transform.children.First(c => c.name == "Note__tricky_");
    top.transform.children.Remove(noteGo);
    Run(top);
    Ok(M(s1) != null && M(s2) != null && M(gate) != null && M(start) != null && UnityEngine.Debug.log.Any(l => l.Contains("converted 5 of 5")),
      "Unity 6.3 importer layout with a prim left out: all 5 markers still converted: " + string.Join(" / ", UnityEngine.Debug.log));
    // 3d: the wrong file picked (none of its prims are in the scene): nothing converted, and the Console says what was looked for
    var wrong = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ptah-wrong.usda");
    System.IO.File.WriteAllText(wrong, "#usda 1.0\ndef Xform \"Root\"\n{\n    def Xform \"Elsewhere\" (\n        customData = {\n            string \"ptah:type\" = \"marker\"\n        }\n    )\n    {\n        custom string ptah:marker = \"Spawn\"\n    }\n}\n");
    EditorUtility.path = wrong;
    top = BuildImporter63(out s1, out s2, out gate, out start);
    Run(top);
    Ok(UnityEngine.Debug.log.Any(l => l.Contains("converted 0 of 1")) && UnityEngine.Debug.log.Any(l => l.StartsWith("WARN") && l.Contains("no object under or above 'blockout' has any of the level's 1 top objects") && l.Contains("'Elsewhere'")),
      "the wrong .usda picked: the Console says which objects it looked for: " + string.Join(" / ", UnityEngine.Debug.log));
    EditorUtility.path = a[0];
    // 3e: every marker at its parent's origin (each one grouped on its own, say): no marker tells the unit,
    // so the level's other objects do. Before 0.13.2 this fell back to 1, a 100x trigger under Unity 6.3.
    var src = System.IO.File.ReadAllText(a[0]);
    Func<string, string[], string> Zero = (t, at) => { foreach (var p in at) { var line = "xformOp:translate = " + p; if (!t.Contains(line)) { Ok(false, "setup: no translate " + p); Environment.Exit(1); } t = t.Replace(line, "xformOp:translate = (0, 0, 0)"); } return t; };
    var centred = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ptah-centred.usda");
    System.IO.File.WriteAllText(centred, Zero(src, new[] { "(20, 0, -7)", "(30, 0, 9)", "(10, 0, 5)", "(40, 0, 0)" }));
    var bare = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ptah-bare.usda");
    System.IO.File.WriteAllText(bare, Zero(src, new[] { "(20, 0, -7)", "(30, 0, 9)", "(10, 0, 5)", "(40, 0, 0)", "(100, 0, 0)", "(200, 0, 0)", "(5, 0, 0)" }));
    // the markers at their parents' origins in the scene too; the groups and the wall where the importer puts them
    Action<GameObject, float, bool> Centre = (lvl, k, placeOthers) => {
      foreach (var t in lvl.GetComponentsInChildren<Transform>(true)) {
        var x = t.name == "Yard" ? 100 : t.name == "Room__A___v2_" ? 200 : t.name == "Wall" ? 5 : 0;
        t.localPosition = placeOthers ? new Vector3(x * k, 0, 0) : new Vector3(0, 0, 0);   // markers: 0
      }
    };
    Func<float> Box = () => { BoxCollider bx; return gate.TryGetComponent(out bx) ? bx.size.x : -1; };
    EditorUtility.path = centred;
    top = BuildImporter63(out s1, out s2, out gate, out start); Centre(top, 0.01f, true);
    Run(top);
    Ok(Math.Abs(Box() - 0.01f) < 1e-6 && UnityEngine.Debug.log.Any(l => l.Contains("0.01 Unity units (measured from the level's other objects")) && !UnityEngine.Debug.log.Any(l => l.StartsWith("WARN")),
      $"Unity 6.3 importer, every marker at its parent's origin: the unit is measured from the groups, trigger box 0.01 (size {Box()}): " + string.Join(" / ", UnityEngine.Debug.log));
    top = Build(out s1, out s2, out gate, out start); Centre(top, 1f, true);
    Run(top);
    Ok(Box() == 1 && UnityEngine.Debug.log.Any(l => l.Contains("became 1 Unity units (measured from the level's other objects")),
      $"older package, every marker at its parent's origin: measured from the groups, trigger box 1 (size {Box()})");
    // 3f: nothing in the level is off its parent's origin: the unit is assumed from the importer's layout, and the Console says so
    EditorUtility.path = bare;
    top = BuildImporter63(out s1, out s2, out gate, out start); Centre(top, 0.01f, false);
    Run(top);
    Ok(Math.Abs(Box() - 0.01f) < 1e-6 && UnityEngine.Debug.log.Any(l => l.StartsWith("WARN") && l.Contains("could not be measured") && l.Contains("0.01")),
      $"Unity 6.3 importer, nothing to measure: 0.01 from the layout (no Root object), with a warning (size {Box()}): " + string.Join(" / ", UnityEngine.Debug.log));
    top = Build(out s1, out s2, out gate, out start); Centre(top, 1f, false);
    Run(top);
    Ok(Box() == 1 && UnityEngine.Debug.log.Any(l => l.StartsWith("WARN") && l.Contains("could not be measured")),
      $"older package, nothing to measure: 1 from the layout (a Root object), with a warning (size {Box()})");
    // 3g: the file named as its top prim (Root.usda): Unity 6.3's asset object is then called Root too, which
    // must not pass for the older package's Root object (that one sits under an object of the file's name)
    var rootFile = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ptah-root", "Root.usda");
    System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(rootFile));
    System.IO.File.Copy(bare, rootFile, true);
    EditorUtility.path = rootFile;
    top = BuildImporter63(out s1, out s2, out gate, out start); top.name = "Root"; Centre(top, 0.01f, false);
    Run(top);
    Ok(Math.Abs(Box() - 0.01f) < 1e-6 && UnityEngine.Debug.log.Any(l => l.Contains("converted 5 of 5")),
      $"Unity 6.3 importer, Root.usda, nothing to measure: still 0.01 (size {Box()}): " + string.Join(" / ", UnityEngine.Debug.log));
    top = Build(out s1, out s2, out gate, out start); top.name = "Root"; Centre(top, 1f, false);
    Run(top);
    Ok(Box() == 1 && UnityEngine.Debug.log.Any(l => l.Contains("converted 5 of 5")), $"older package, Root.usda, nothing to measure: still 1 (size {Box()})");
    EditorUtility.path = a[0];
    // 4: the real runtime component draws its gizmos (a box for a trigger, a sphere and a facing line otherwise)
    var draw = typeof(PtahMarker).GetMethod("OnDrawGizmos", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
    top = Build(out s1, out s2, out gate, out start);
    Run(top);
    Gizmos.drawn.Clear(); draw.Invoke(M(gate), null);
    var trigger = string.Join(",", Gizmos.drawn);
    Gizmos.drawn.Clear(); draw.Invoke(M(s1), null);
    var spawn = string.Join(",", Gizmos.drawn);
    Ok(trigger == "cube" && spawn == "sphere,line", $"PtahMarker gizmos: trigger {trigger}, spawn {spawn}");
    // 5: a marker kind that is not one of Ptah's (a number, a misspelling) is left alone with a warning, not made a Spawn
    var odd = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ptah-odd-kind.usda");
    var text = System.IO.File.ReadAllText(a[0]);
    if (!text.Contains("custom string ptah:marker = \"Trigger\"")) { Ok(false, "setup: the Gate trigger's kind was not found"); Environment.Exit(1); }
    System.IO.File.WriteAllText(odd, text.Replace("custom string ptah:marker = \"Trigger\"", "custom string ptah:marker = \"7\""));
    EditorUtility.path = odd;
    top = Build(out s1, out s2, out gate, out start);
    Run(top);
    Ok(M(gate) == null && UnityEngine.Debug.log.Any(l => l.StartsWith("WARN") && l.Contains("unknown marker kind '7'")), "an unknown marker kind is skipped with a warning: " + string.Join(" / ", UnityEngine.Debug.log));
    Environment.Exit(fails == 0 ? 0 : 1);
  }
}
