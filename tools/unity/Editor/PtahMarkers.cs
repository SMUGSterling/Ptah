// PtahMarkers.cs -- Unity Editor tool that turns a Ptah blockout's gameplay
// markers into usable scene objects after the .usda has been imported with the
// USD package (com.unity.formats.usd).
//
// Install: copy tools/unity/Editor/PtahMarkers.cs into any Editor/ folder and
// tools/unity/Runtime/PtahMarker.cs anywhere outside Editor/.
//
// Use: import the .usda (Assets > Import USD, or the USD menu), drop the
// result in a scene, select its root, then Tools > Ptah > Convert Markers in
// Selection... and pick the same .usda file. The tool reads `ptah:marker` and
// `ptah:tags` straight from the text file (the .usda is plain text and the
// importer does not surface custom attributes), matches each marker prim to the
// imported GameObject at the same path (Root/Arena/Spawn_01), and then (with a
// group selected, only the markers inside that group):
//     PlayerStart -> tag "Respawn" + PtahMarker(PlayerStart)
//     Spawn / Cover / Objective -> PtahMarker(kind) with tags
//     Trigger -> BoxCollider (isTrigger, size 1: the transform scale is the box) + PtahMarker(Trigger)
//
// Coordinates: Ptah writes Y-up, 1 unit = 1 cm; the USD package converts to
// meters and (with the default basis change) flips Z, so a marker's arrow
// (Ptah local -Z) becomes the GameObject's +Z forward.
//
// Status: written against Unity 2022.3 / USD package 3.x; not executed inside
// a Unity Editor as part of Ptah's CI. Treat the first run as a smoke test.

using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace Ptah
{
    public static class PtahMarkers
    {
        struct MarkerInfo { public string prim; public string path; public string kind; public List<string> tags; }

        [MenuItem("Tools/Ptah/Convert Markers in Selection...")]
        static void ConvertSelected()
        {
            var root = Selection.activeGameObject;
            if (root == null) { EditorUtility.DisplayDialog("Ptah", "Select the imported USD root first.", "OK"); return; }
            var path = EditorUtility.OpenFilePanel("Ptah blockout (.usda)", "", "usda");
            if (string.IsNullOrEmpty(path)) return;
            var markers = ReadMarkers(File.ReadAllText(path), out var primPaths);
            // every GameObject under the selection, with its path from the top of the scene
            // ("level/Root/Arena/Spawn_01"): the importer rebuilds the whole prim tree, so a
            // marker's object is the one whose scene path ends with the marker's prim path
            var all = new List<KeyValuePair<string, Transform>>();
            foreach (var t in root.GetComponentsInChildren<Transform>(true)) all.Add(new KeyValuePair<string, Transform>(PathFrom(null, t), t));
            // the prim the selection is, when it is inside the level ("Root/Yard"); markers
            // outside it are skipped rather than matched to a same-named object inside it
            string scope = Scope(PathFrom(null, root.transform), primPaths);

            int converted = 0, outside = 0;
            Undo.SetCurrentGroupName("Ptah: convert markers");
            int group = Undo.GetCurrentGroup();
            foreach (var m in markers)
            {
                if (scope != null && m.path != scope && !m.path.StartsWith(scope + "/")) { outside++; continue; }
                var t = Find(all, m.path, out bool ambiguous);
                if (t == null)
                {
                    Debug.LogWarning(ambiguous
                        ? $"Ptah: more than one GameObject under {root.name} matches '{m.path}' (is the level imported twice?); select one imported level and run again"
                        : $"Ptah: no GameObject under {root.name} matches '{m.path}'");
                    continue;
                }
                Undo.RegisterFullObjectHierarchyUndo(t.gameObject, "Ptah marker");
                // not ??: a missing component is a "fake null" UnityEngine.Object that ?? treats as present
                if (!t.TryGetComponent(out PtahMarker comp)) comp = Undo.AddComponent<PtahMarker>(t.gameObject);
                comp.kind = ParseKind(m.kind);
                comp.tags = new List<string>(m.tags);
                if (comp.kind == PtahMarkerKind.PlayerStart) t.gameObject.tag = "Respawn";
                if (comp.kind == PtahMarkerKind.Trigger)
                {
                    if (!t.TryGetComponent(out BoxCollider box)) box = Undo.AddComponent<BoxCollider>(t.gameObject);
                    box.isTrigger = true;
                    box.size = Vector3.one;          // the importer put Ptah's box size on the transform scale
                    box.center = Vector3.zero;
                }
                converted++;
            }
            Undo.CollapseUndoOperations(group);
            Debug.Log($"Ptah: converted {converted} of {markers.Count} markers from {Path.GetFileName(path)}"
                + (outside > 0 ? $"; {outside} are outside the selection" : ""));
        }

        // "level/Root/Arena"; a null root gives the path from the top of the scene
        static string PathFrom(Transform root, Transform t)
        {
            var parts = new List<string>();
            for (var n = t; n != null; n = n.parent) { parts.Insert(0, n.name); if (n == root) break; }
            return string.Join("/", parts);
        }

        // The one GameObject whose scene path ends with the marker's full prim
        // path. Several matches (the level imported twice under the selection)
        // convert nothing: a guess could convert the wrong object.
        static Transform Find(List<KeyValuePair<string, Transform>> all, string primPath, out bool ambiguous)
        {
            Transform hit = null;
            int count = 0;
            foreach (var kv in all)
                if (kv.Key == primPath || kv.Key.EndsWith("/" + primPath)) { hit = kv.Value; count++; }
            ambiguous = count > 1;
            return count == 1 ? hit : null;
        }

        // The longest prim path the selection's scene path ends with, or null
        // when the selection is above the level (or not part of it).
        static string Scope(string selectionPath, IEnumerable<string> primPaths)
        {
            string best = null;
            foreach (var p in primPaths)
                if ((selectionPath == p || selectionPath.EndsWith("/" + p)) && (best == null || p.Length > best.Length)) best = p;
            return best;
        }

        static PtahMarkerKind ParseKind(string s) =>
            System.Enum.TryParse(s, out PtahMarkerKind k) ? k : PtahMarkerKind.Spawn;

        // Minimal .usda reader for the two attributes Ptah writes on marker
        // prims. The prim name is the Xform identifier, which is also the
        // imported GameObject name.
        static readonly Regex PrimRe = new Regex(@"def\s+Xform\s+""([^""]+)""\s*(\([\s\S]*?\))?\s*\{", RegexOptions.Compiled);
        static readonly Regex MarkerRe = new Regex(@"custom\s+string\s+ptah:marker\s*=\s*""([^""\\]*(?:\\.[^""\\]*)*)""", RegexOptions.Compiled);
        static readonly Regex TagsRe = new Regex(@"custom\s+string\[\]\s+ptah:tags\s*=\s*\[((?:""(?:[^""\\]|\\.)*""|[^""\]])*)\]", RegexOptions.Compiled);
        static readonly Regex StrRe = new Regex(@"""((?:[^""\\]|\\.)*)""", RegexOptions.Compiled);

        static List<MarkerInfo> ReadMarkers(string usda, out string[] paths)
        {
            var list = new List<MarkerInfo>();
            var prims = PrimRe.Matches(usda);
            paths = PrimPaths(usda, prims);
            for (int i = 0; i < prims.Count; i++)
            {
                int start = prims[i].Index + prims[i].Length;
                int end = i + 1 < prims.Count ? prims[i + 1].Index : usda.Length;
                var body = usda.Substring(start, end - start);      // attributes before the next prim: markers have no children
                var mm = MarkerRe.Match(body);
                if (!mm.Success) continue;
                var info = new MarkerInfo { prim = prims[i].Groups[1].Value, path = paths[i], kind = Unescape(mm.Groups[1].Value), tags = new List<string>() };
                var tm = TagsRe.Match(body);
                if (tm.Success) foreach (Match s in StrRe.Matches(tm.Groups[1].Value)) info.tags.Add(Unescape(s.Groups[1].Value));
                list.Add(info);
            }
            return list;
        }

        // "Root/Arena/Spawn_01" for each Xform prim: one pass over the text that
        // skips strings and keeps a stack of open braces, noting which of them
        // open a prim's body (other braces are dictionaries and metadata).
        static string[] PrimPaths(string usda, MatchCollection prims)
        {
            var paths = new string[prims.Count];
            var bodyOf = new Dictionary<int, int>();            // index of a prim's opening { -> prim
            for (int i = 0; i < prims.Count; i++) bodyOf[prims[i].Index + prims[i].Length - 1] = i;
            var stack = new List<int>();                        // prim per open brace, -1 for other braces
            int next = 0;
            for (int c = 0; c < usda.Length; c++)
            {
                while (next < prims.Count && prims[next].Index <= c)
                {
                    var names = new List<string>();
                    foreach (int open in stack) if (open >= 0) names.Add(prims[open].Groups[1].Value);
                    names.Add(prims[next].Groups[1].Value);
                    paths[next] = string.Join("/", names);
                    next++;
                }
                char ch = usda[c];
                if (ch == '"')
                {
                    for (c++; c < usda.Length && usda[c] != '"'; c++) if (usda[c] == '\\') c++;
                }
                else if (ch == '{') stack.Add(bodyOf.TryGetValue(c, out int p) ? p : -1);
                else if (ch == '}' && stack.Count > 0) stack.RemoveAt(stack.Count - 1);
            }
            for (int i = 0; i < paths.Length; i++) if (paths[i] == null) paths[i] = prims[i].Groups[1].Value;
            return paths;
        }

        static string Unescape(string s) => Regex.Replace(s ?? "", @"\\(n|t|""|\\)", m =>
        {
            switch (m.Groups[1].Value)
            {
                case "n": return "\n";
                case "t": return "\t";
                case "\"": return "\"";
                default: return "\\";
            }
        });
    }
}
