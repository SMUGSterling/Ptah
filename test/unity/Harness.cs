// Runs the real PtahMarkers.ConvertSelected() against a GameObject tree shaped like
// the USD importer's output for test/unity/make-level.mjs.

using System; using System.Linq; using UnityEngine; using UnityEditor; using Ptah;
static class Harness {
  static GameObject Go(string n) => new GameObject(n);
  static int fails = 0;
  static void Ok(bool c, string m) { Console.WriteLine((c ? "  pass  " : "  FAIL  ") + m); if (!c) fails++; }
  static GameObject Build(out GameObject arenaSpawn, out GameObject yardSpawn, out GameObject gate, out GameObject start) {
    arenaSpawn = Go("Spawn_01"); yardSpawn = Go("Spawn_01"); gate = Go("Gate"); start = Go("PlayerStart_01");
    var arena = Go("Arena").Add(arenaSpawn).Add(Go("Wall").Add(Go("Geom")));
    var yard = Go("Yard").Add(yardSpawn).Add(gate);
    var root = Go("Root").Add(start).Add(arena).Add(yard).Add(Go("Note__tricky_"));
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
    Ok(M(s1) != null && M(s1).kind == PtahMarkerKind.Spawn && M(s1).tags.SequenceEqual(new[] { "wave 1", "say \"hi\"" }), "Arena/Spawn_01 converted with its own tags: " + (M(s1) == null ? "none" : string.Join("|", M(s1).tags)));
    Ok(M(s2) != null && M(s2).tags.SequenceEqual(new[] { "wave 2" }), "Yard/Spawn_01 (same name) converted with its own tags");
    Ok(M(gate) != null && M(gate).kind == PtahMarkerKind.Trigger && gate.TryGetComponent(out BoxCollider b) && b.isTrigger, "Gate trigger gets a trigger BoxCollider");
    Ok(M(start) != null && start.tag == "Respawn", "PlayerStart tagged Respawn");
    Ok(UnityEngine.Debug.log.Any(l => l.Contains("converted 4 of 4")), "no fake marker read from note text: " + string.Join(" / ", UnityEngine.Debug.log));
    // 2: selecting the Yard group (below Root): only Yard's markers, each with its own data;
    // Arena's Spawn_01 must not land on Yard's same-named object
    top = Build(out s1, out s2, out gate, out start);
    Run(top.transform.children[0].children[2].gameObject);
    Ok(M(s2) != null && M(s1) == null && M(s2).tags.SequenceEqual(new[] { "wave 2" }), "selecting Yard converts Yard/Spawn_01 with its own tags: " + (M(s2) == null ? "none" : string.Join("|", M(s2).tags)));
    Ok(M(gate) != null && M(start) == null, "selecting Yard converts the Yard trigger, not the PlayerStart outside it");
    Ok(UnityEngine.Debug.log.Any(l => l.Contains("converted 2 of 4") && l.Contains("2 are outside the selection")) && !UnityEngine.Debug.log.Any(l => l.StartsWith("WARN")), "reports the markers outside the selection without warnings: " + string.Join(" / ", UnityEngine.Debug.log));
    // 3: selecting Root: both spawns resolve by full path
    top = Build(out s1, out s2, out gate, out start);
    Run(top.transform.children[0].gameObject);
    Ok(M(s1) != null && M(s2) != null, "selecting Root resolves both same-named spawns by path");
    Environment.Exit(fails == 0 ? 0 : 1);
  }
}
