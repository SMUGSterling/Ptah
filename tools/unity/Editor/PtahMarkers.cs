// PtahMarkers.cs -- Unity Editor tool that turns a Ptah blockout's gameplay
// markers into usable scene objects after the .usda has been imported: with the
// USD Importer (com.unity.importer.usd, Unity 6.3 LTS) or, on older Unity, the
// USD package (com.unity.formats.usd).
//
// Install: copy tools/unity/Editor/PtahMarkers.cs into any Editor/ folder and
// tools/unity/Runtime/PtahMarker.cs anywhere outside Editor/.
//
// Use: import the .usda (copy it into Assets with the USD Importer, or Assets >
// Import USD with the older package), drop the result in a scene, select its root, then Tools > Ptah > Convert Markers in
// Selection... and pick the same .usda file. The tool reads `ptah:marker` and
// `ptah:tags` straight from the text file (the .usda is plain text and the
// importer does not surface custom attributes), matches each marker prim to the
// imported GameObject at the same path (Root/Arena/Spawn_01), and then (with a
// group selected, only the markers inside that group):
//     PlayerStart -> tag "Respawn" + PtahMarker(PlayerStart)
//     Spawn / Cover / Objective -> PtahMarker(kind) with tags
//     Trigger -> BoxCollider (isTrigger, size 1: the transform scale is the box) + PtahMarker(Trigger)
//
// Coordinates: Ptah writes Y-up, 1 unit = 1 cm; the importer converts to
// meters and (the USD package's default basis change) flips Z, so a marker's
// arrow (Ptah local -Z) becomes the GameObject's +Z forward.
//
// Status: written against Unity 2022.3 / USD package 3.x. It reads the .usda
// itself, so the importer only has to name and nest the GameObjects as the
// prims are (the USD Importer in Unity 6.3 does). Compiled and run against
// stand-ins for the Unity API in CI (test/unity/run.sh), not yet inside a Unity
// Editor: treat the first run as a smoke test, and check a marker's facing.

using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace Ptah
{
    public static class PtahMarkers
    {
        struct MarkerInfo { public string path; public string kind; public List<string> tags; public bool hasT; public Vector3 t; }   // t: xformOp:translate in the file

        [MenuItem("Tools/Ptah/Convert Markers in Selection...")]
        static void ConvertSelected()
        {
            var root = Selection.activeGameObject;
            if (root == null) { EditorUtility.DisplayDialog("Ptah", "Select the imported USD root first.", "OK"); return; }
            var path = EditorUtility.OpenFilePanel("Ptah blockout (.usda)", "", "usda");
            if (string.IsNullOrEmpty(path)) return;
            var markers = ReadMarkers(File.ReadAllText(path), out var primPaths);
            // The object that stands for the level's top prim ("Root"): the older USD package imports it
            // as a "Root" child of the asset's object, Unity 6.3's USD Importer as the asset's object itself
            // (named after the file). Either way it is the object holding the most of the prims under Root
            // as children, and its paths are read as "Root/..." so markers match exactly with both importers.
            var level = new LevelRoot(primPaths, root.transform);
            // every GameObject under the selection, with its path from the top of the scene
            // ("level/Root/Arena/Spawn_01"): the importer rebuilds the whole prim tree, so a
            // marker's object is the one whose scene path ends with the marker's prim path
            var all = new List<KeyValuePair<string, Transform>>();
            foreach (var t in root.GetComponentsInChildren<Transform>(true)) all.Add(new KeyValuePair<string, Transform>(level.PathOf(t), t));
            // the prim the selection is, when it is inside the level ("Root/Yard"); markers
            // outside it are skipped rather than matched to a same-named object inside it
            string scope = Scope(level.PathOf(root.transform), primPaths);

            int converted = 0, outside = 0;
            // Which marker is which object, first: their positions tell how the importer converted units.
            var found = new List<KeyValuePair<MarkerInfo, Transform>>();
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
                found.Add(new KeyValuePair<MarkerInfo, Transform>(m, t));
            }
            // Ptah's units are centimetres. The older USD package scales the level's root to metres, so a
            // unit box under it is already right; Unity 6.3's USD Importer instead shrinks every position and
            // mesh point 100x but keeps each object's scale, so a trigger (no mesh, its box size in its scale)
            // needs a 0.01 box. Measured from the markers themselves: their position in Unity over the file's.
            var map = Measure(found);
            float unit = map.unit;
            Undo.SetCurrentGroupName("Ptah: convert markers");
            int group = Undo.GetCurrentGroup();
            foreach (var kv in found)
            {
                var m = kv.Key; var t = kv.Value;
                if (!TryParseKind(m.kind, out var kind))
                {
                    Debug.LogWarning($"Ptah: unknown marker kind '{m.kind}' on {m.path}; left as it is");
                    continue;
                }
                Undo.RegisterFullObjectHierarchyUndo(t.gameObject, "Ptah marker");
                // not ??: a missing component is a "fake null" UnityEngine.Object that ?? treats as present
                if (!t.TryGetComponent(out PtahMarker comp)) comp = Undo.AddComponent<PtahMarker>(t.gameObject);
                comp.kind = kind;
                comp.tags = new List<string>(m.tags);
                comp.facingLocal = new Vector3(0, 0, map.mirrorZ ? 1 : -1);   // Ptah's arrow, local -Z in the file
                if (comp.kind == PtahMarkerKind.PlayerStart) t.gameObject.tag = "Respawn";
                if (comp.kind == PtahMarkerKind.Trigger)
                {
                    if (!t.TryGetComponent(out BoxCollider box)) box = Undo.AddComponent<BoxCollider>(t.gameObject);
                    box.isTrigger = true;
                    box.size = Vector3.one * unit;   // the importer put Ptah's box size (in cm) on the transform scale
                    box.center = Vector3.zero;
                    comp.volume = box.size;          // the gizmo draws the same box
                }
                converted++;
            }
            Undo.CollapseUndoOperations(group);
            Debug.Log($"Ptah: converted {converted} of {markers.Count} markers from {Path.GetFileName(path)}"
                + (outside > 0 ? $"; {outside} are outside the selection" : "")
                + (found.Count > 0 ? $" ({map.how})" : ""));
            if (converted == 0 && markers.Count > outside)
                Debug.LogWarning($"Ptah: {level.report}. Check that you picked the .usda this level was imported from.");
        }

        // Scene paths from the top of the scene ("level/Root/Arena"), with the object that stands for the
        // level's top prim named as that prim.
        class LevelRoot
        {
            readonly string rootName;                       // the top prim ("Root")
            readonly HashSet<string> under = new HashSet<string>();   // the prims directly under it
            readonly HashSet<Transform> roots = new HashSet<Transform>();
            public readonly string report;                  // what was looked for and found, for the Console when nothing matches
            public LevelRoot(IList<string> primPaths, Transform selection)
            {
                if (primPaths.Count == 0) { report = "the file has no prims"; return; }
                rootName = primPaths[0].Split('/')[0];
                foreach (var p in primPaths)
                {
                    var parts = p.Split('/');
                    if (parts.Length == 2 && parts[0] == rootName) under.Add(parts[1]);
                }
                // The candidates: the selection, everything under it, and everything above it. The one with
                // the most of Root's prims as children stands for Root (an importer may leave a prim out, so
                // not all of them are required); a tie is the level imported more than once.
                var candidates = new List<Transform>(selection.gameObject.GetComponentsInChildren<Transform>(true));
                for (var n = selection.parent; n != null; n = n.parent) candidates.Add(n);
                int best = 0;
                string bestName = null;
                var scores = new Dictionary<Transform, int>();
                foreach (var n in candidates)
                {
                    int score = 0;
                    for (int i = 0; i < n.childCount; i++) if (under.Contains(n.GetChild(i).name)) score++;
                    scores[n] = score;
                    if (score > best) { best = score; bestName = n.name; }
                }
                if (best > 0) foreach (var kv in scores) if (kv.Value == best) roots.Add(kv.Key);
                var expect = new List<string>(under);
                report = best > 0
                    ? $"the level's top objects are under '{bestName}' ({best} of the {under.Count} the file has)"
                    : $"no object under or above '{selection.name}' has any of the level's {under.Count} top objects as a child (for example '{string.Join("', '", expect.GetRange(0, System.Math.Min(3, expect.Count)))}')";
            }
            bool StandsForRoot(Transform n) => roots.Contains(n) && n.name != rootName;   // named Root already: nothing to rename
            public string PathOf(Transform t)
            {
                var parts = new List<string>();
                for (var n = t; n != null; n = n.parent) parts.Insert(0, StandsForRoot(n) ? rootName : n.name);
                return string.Join("/", parts);
            }
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

        // How the importer turned the file's coordinates into Unity's, measured from the markers
        // themselves (their position in Unity against xformOp:translate in the file):
        //  - unit: how many Unity units one Ptah unit became. 1 when the importer scaled the level's root
        //    (the older USD package), 0.01 when it converted positions and points instead (Unity 6.3's USD
        //    Importer). The median over markers not at their parent's origin; 1 when none can tell.
        //  - mirrorZ: USD is right-handed, Unity left-handed, so an importer mirrors one axis. Mirroring Z
        //    turns Ptah's facing (local -Z) into Unity's forward (+Z); mirroring X leaves it at -Z. A vote
        //    over the markers off the Z (or X) axis; with no evidence, Z, as the USD package does.
        struct ImportMap { public float unit; public bool mirrorZ; public string how; }
        static ImportMap Measure(List<KeyValuePair<MarkerInfo, Transform>> found)
        {
            var ratios = new List<float>();
            int zSame = 0, zFlip = 0, xSame = 0, xFlip = 0;
            foreach (var kv in found)
            {
                if (!kv.Key.hasT) continue;
                Vector3 f = kv.Key.t, u = kv.Value.localPosition;
                if (f.magnitude > 1e-3f) ratios.Add(u.magnitude / f.magnitude);
                if (Mathf.Abs(f.z) > 1e-3f && Mathf.Abs(u.z) > 1e-9f) { if ((f.z > 0) == (u.z > 0)) zSame++; else zFlip++; }
                if (Mathf.Abs(f.x) > 1e-3f && Mathf.Abs(u.x) > 1e-9f) { if ((f.x > 0) == (u.x > 0)) xSame++; else xFlip++; }
            }
            var map = new ImportMap { unit = 1f, mirrorZ = true };
            if (ratios.Count > 0)
            {
                ratios.Sort();
                float r = ratios[ratios.Count / 2];
                map.unit = Mathf.Abs(r - 0.01f) < 0.001f ? 0.01f : Mathf.Abs(r - 1f) < 0.1f ? 1f : r;
            }
            string axis;
            if (zFlip + zSame > 0) { map.mirrorZ = zFlip > zSame; axis = map.mirrorZ ? "mirrored Z" : (xFlip > xSame ? "mirrored X" : "kept Z"); }
            else if (xFlip + xSame > 0) { map.mirrorZ = xFlip <= xSame; axis = map.mirrorZ ? "mirrored Z (assumed: no marker is off the Z axis)" : "mirrored X"; }
            else axis = "mirrored Z (assumed: no marker position to measure)";
            map.how = $"1 Ptah unit became {map.unit:0.####} Unity units and the importer {axis}, so markers face local {(map.mirrorZ ? "+Z (transform.forward)" : "-Z")}";
            return map;
        }

        // Exactly one of Ptah's kind names, as ptah_import.py reads them: Enum.TryParse would also
        // take "7" (an undefined value) and turn a misspelt kind into a Spawn without a word.
        static bool TryParseKind(string s, out PtahMarkerKind kind)
        {
            foreach (PtahMarkerKind k in System.Enum.GetValues(typeof(PtahMarkerKind)))
                if (k.ToString() == s) { kind = k; return true; }
            kind = default;
            return false;
        }

        // Minimal .usda reader for the two attributes Ptah writes on marker
        // prims. The prim name is the Xform identifier, which is also the
        // imported GameObject name.
        static readonly Regex PrimHeadRe = new Regex(@"\Gdef\s+Xform\s+""([^""]+)""", RegexOptions.Compiled);
        // A string as usd-core writes it: "..." (with \" escapes), '...' when the text holds a
        // double quote, and """...""" or '''...''' when it spans lines. The text is group v.
        const string Lit = @"(?:""""""(?<v>[\s\S]*?)""""""|'''(?<v>[\s\S]*?)'''|""(?<v>(?:[^""\\]|\\.)*)""|'(?<v>(?:[^'\\]|\\.)*)')";
        static readonly Regex MarkerRe = new Regex(@"custom\s+string\s+ptah:marker\s*=\s*" + Lit, RegexOptions.Compiled);
        static readonly Regex TagsRe = new Regex(@"custom\s+string\[\]\s+ptah:tags\s*=\s*\[(?<list>(?:" + Lit + @"|[^""'\]])*)\]", RegexOptions.Compiled);
        static readonly Regex StrRe = new Regex(Lit, RegexOptions.Compiled);
        const string Num = @"\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*";
        static readonly Regex TranslateRe = new Regex(@"double3\s+xformOp:translate\s*=\s*\(" + Num + "," + Num + "," + Num + @"\)", RegexOptions.Compiled);

        struct PrimHead { public string name; public int index; public int open; }

        // Each Xform prim's name, where its head starts, and the brace that opens
        // its body. The metadata in between is skipped string-aware, so a name
        // like "Room (A) {v2}" in ptah:name cannot pass for the end of the head.
        static List<PrimHead> PrimHeads(string usda)
        {
            var list = new List<PrimHead>();
            // one pass that steps over strings and comments, so text that only
            // looks like a prim (a note reading 'def Xform "Fake" {...}') is not one
            for (int c = 0; c < usda.Length; c++)
            {
                int skip = SkipLiteral(usda, c);
                if (skip > c) { c = skip - 1; continue; }
                if (usda[c] != 'd' || (c > 0 && (char.IsLetterOrDigit(usda[c - 1]) || usda[c - 1] == '_'))) continue;
                var m = PrimHeadRe.Match(usda, c);
                if (!m.Success) continue;
                c = m.Index + m.Length - 1;
                int j = SkipWs(usda, m.Index + m.Length);
                if (j < usda.Length && usda[j] == '(')
                {
                    j = CloseParen(usda, j);
                    if (j < 0) continue;
                    j = SkipWs(usda, j + 1);
                }
                if (j < usda.Length && usda[j] == '{') list.Add(new PrimHead { name = m.Groups[1].Value, index = m.Index, open = j });
            }
            return list;
        }
        // If s[i] starts a string ("...", '...', """...""", '''...''') or a # comment,
        // the index just past it; otherwise i. The #usda header line counts as a comment.
        static int SkipLiteral(string s, int i)
        {
            char ch = s[i];
            if (ch == '#') { int e = s.IndexOf('\n', i); return e < 0 ? s.Length : e + 1; }
            if (ch != '"' && ch != '\'') return i;
            bool triple = i + 2 < s.Length && s[i + 1] == ch && s[i + 2] == ch;
            for (int j = i + (triple ? 3 : 1); j < s.Length; j++)
            {
                if (s[j] == '\\') { j++; continue; }
                if (s[j] != ch) continue;
                if (!triple) return j + 1;
                if (j + 2 < s.Length && s[j + 1] == ch && s[j + 2] == ch) return j + 3;
            }
            return s.Length;
        }
        // The first match of re that starts outside every string: an attribute quoted in
        // another string (a note reading 'custom string ptah:marker = "Spawn"') is not one.
        static Match FirstOutsideStrings(Regex re, string s)
        {
            for (var m = re.Match(s); m.Success; m = m.NextMatch())
            {
                bool inside = false;
                for (int i = 0; i < m.Index; )
                {
                    int e = SkipLiteral(s, i);
                    if (e == i) { i++; continue; }
                    if (e > m.Index) { inside = true; break; }
                    i = e;
                }
                if (!inside) return m;
            }
            return Match.Empty;
        }
        static int SkipWs(string s, int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; return i; }
        // Index of the ')' closing the '(' at `open`, skipping "..." and '...' strings; -1 if unbalanced.
        static int CloseParen(string s, int open)
        {
            int depth = 0;
            for (int i = open; i < s.Length; i++)
            {
                char ch = s[i];
                int skip = SkipLiteral(s, i);
                if (skip > i) { i = skip - 1; continue; }
                if (ch == '(') depth++;
                else if (ch == ')' && --depth == 0) return i;
            }
            return -1;
        }

        static List<MarkerInfo> ReadMarkers(string usda, out string[] paths)
        {
            var list = new List<MarkerInfo>();
            var prims = PrimHeads(usda);
            paths = PrimPaths(usda, prims);
            for (int i = 0; i < prims.Count; i++)
            {
                int start = prims[i].open + 1;
                int end = i + 1 < prims.Count ? prims[i + 1].index : usda.Length;
                var body = usda.Substring(start, end - start);      // attributes before the next prim: markers have no children
                var mm = FirstOutsideStrings(MarkerRe, body);
                if (!mm.Success) continue;
                var tr = FirstOutsideStrings(TranslateRe, body);
                var t = new Vector3();
                if (tr.Success)
                {
                    var inv = System.Globalization.CultureInfo.InvariantCulture;
                    t = new Vector3(float.Parse(tr.Groups[1].Value, inv), float.Parse(tr.Groups[2].Value, inv), float.Parse(tr.Groups[3].Value, inv));
                }
                var info = new MarkerInfo { hasT = tr.Success, t = t, path = paths[i], kind = Unescape(mm.Groups["v"].Value), tags = new List<string>() };
                var tm = FirstOutsideStrings(TagsRe, body);
                if (tm.Success) foreach (Match s in StrRe.Matches(tm.Groups["list"].Value)) info.tags.Add(Unescape(s.Groups["v"].Value));
                list.Add(info);
            }
            return list;
        }

        // "Root/Arena/Spawn_01" for each Xform prim: one pass over the text that
        // skips strings and keeps a stack of open braces, noting which of them
        // open a prim's body (other braces are dictionaries and metadata).
        static string[] PrimPaths(string usda, List<PrimHead> prims)
        {
            var paths = new string[prims.Count];
            var bodyOf = new Dictionary<int, int>();            // index of a prim's opening { -> prim
            for (int i = 0; i < prims.Count; i++) bodyOf[prims[i].open] = i;
            var stack = new List<int>();                        // prim per open brace, -1 for other braces
            int next = 0;
            for (int c = 0; c < usda.Length; c++)
            {
                while (next < prims.Count && prims[next].index <= c)
                {
                    var names = new List<string>();
                    foreach (int open in stack) if (open >= 0) names.Add(prims[open].name);
                    names.Add(prims[next].name);
                    paths[next] = string.Join("/", names);
                    next++;
                }
                int skip = SkipLiteral(usda, c);                // strings (either quote, triple too) and comments hold no braces
                if (skip > c) { c = skip - 1; continue; }
                char ch = usda[c];
                if (ch == '{') stack.Add(bodyOf.TryGetValue(c, out int p) ? p : -1);
                else if (ch == '}' && stack.Count > 0) stack.RemoveAt(stack.Count - 1);
            }
            for (int i = 0; i < paths.Length; i++) if (paths[i] == null) paths[i] = prims[i].name;
            return paths;
        }

        static string Unescape(string s) => Regex.Replace(s ?? "", @"\\(n|t|""|'|\\)", m =>
        {
            switch (m.Groups[1].Value)
            {
                case "n": return "\n";
                case "t": return "\t";
                case "\"": return "\"";
                case "'": return "'";
                default: return "\\";
            }
        });
    }
}
