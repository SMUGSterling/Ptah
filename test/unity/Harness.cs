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
    return Go("level").Add(root);                     // the imported asset's top object
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
    Ok(M(gate) != null && M(gate).kind == PtahMarkerKind.Trigger && gate.TryGetComponent(out BoxCollider b) && b.isTrigger, "Gate trigger gets a trigger BoxCollider");
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
