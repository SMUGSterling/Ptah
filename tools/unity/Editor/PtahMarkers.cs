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
// importer does not surface custom attributes), matches prims to the imported
// GameObjects by name, and then:
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
        struct MarkerInfo { public string prim; public string kind; public List<string> tags; }

        [MenuItem("Tools/Ptah/Convert Markers in Selection...")]
        static void ConvertSelected()
        {
            var root = Selection.activeGameObject;
            if (root == null) { EditorUtility.DisplayDialog("Ptah", "Select the imported USD root first.", "OK"); return; }
            var path = EditorUtility.OpenFilePanel("Ptah blockout (.usda)", "", "usda");
            if (string.IsNullOrEmpty(path)) return;
            var markers = ReadMarkers(File.ReadAllText(path));
            var byName = new Dictionary<string, Transform>();
            foreach (var t in root.GetComponentsInChildren<Transform>(true)) byName[t.name] = t;

            int converted = 0;
            Undo.SetCurrentGroupName("Ptah: convert markers");
            int group = Undo.GetCurrentGroup();
            foreach (var m in markers)
            {
                if (!byName.TryGetValue(m.prim, out var t)) { Debug.LogWarning($"Ptah: no GameObject named '{m.prim}' under {root.name}"); continue; }
                Undo.RegisterFullObjectHierarchyUndo(t.gameObject, "Ptah marker");
                var comp = t.GetComponent<PtahMarker>() ?? Undo.AddComponent<PtahMarker>(t.gameObject);
                comp.kind = ParseKind(m.kind);
                comp.tags = new List<string>(m.tags);
                if (comp.kind == PtahMarkerKind.PlayerStart) t.gameObject.tag = "Respawn";
                if (comp.kind == PtahMarkerKind.Trigger)
                {
                    var box = t.GetComponent<BoxCollider>() ?? Undo.AddComponent<BoxCollider>(t.gameObject);
                    box.isTrigger = true;
                    box.size = Vector3.one;          // the importer put Ptah's box size on the transform scale
                    box.center = Vector3.zero;
                }
                converted++;
            }
            Undo.CollapseUndoOperations(group);
            Debug.Log($"Ptah: converted {converted} of {markers.Count} markers from {Path.GetFileName(path)}");
        }

        static PtahMarkerKind ParseKind(string s) =>
            System.Enum.TryParse(s, out PtahMarkerKind k) ? k : PtahMarkerKind.Spawn;

        // Minimal .usda reader for the two attributes Ptah writes on marker
        // prims. The prim name is the Xform identifier, which is also the
        // imported GameObject name.
        static readonly Regex PrimRe = new Regex(@"def\s+Xform\s+""([^""]+)""\s*(\([\s\S]*?\))?\s*\{", RegexOptions.Compiled);
        static readonly Regex MarkerRe = new Regex(@"custom\s+string\s+ptah:marker\s*=\s*""([^""\\]*(?:\\.[^""\\]*)*)""", RegexOptions.Compiled);
        static readonly Regex TagsRe = new Regex(@"custom\s+string\[\]\s+ptah:tags\s*=\s*\[([^\]]*)\]", RegexOptions.Compiled);
        static readonly Regex StrRe = new Regex(@"""((?:[^""\\]|\\.)*)""", RegexOptions.Compiled);

        static List<MarkerInfo> ReadMarkers(string usda)
        {
            var list = new List<MarkerInfo>();
            var prims = PrimRe.Matches(usda);
            for (int i = 0; i < prims.Count; i++)
            {
                int start = prims[i].Index + prims[i].Length;
                int end = i + 1 < prims.Count ? prims[i + 1].Index : usda.Length;
                var body = usda.Substring(start, end - start);      // attributes before the next prim: markers have no children
                var mm = MarkerRe.Match(body);
                if (!mm.Success) continue;
                var info = new MarkerInfo { prim = prims[i].Groups[1].Value, kind = Unescape(mm.Groups[1].Value), tags = new List<string>() };
                var tm = TagsRe.Match(body);
                if (tm.Success) foreach (Match s in StrRe.Matches(tm.Groups[1].Value)) info.tags.Add(Unescape(s.Groups[1].Value));
                list.Add(info);
            }
            return list;
        }

        static string Unescape(string s) => s.Replace("\\\"", "\"").Replace("\\n", "\n").Replace("\\t", "\t").Replace("\\\\", "\\");
    }
}
