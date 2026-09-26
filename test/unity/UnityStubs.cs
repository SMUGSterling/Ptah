// Minimal stand-ins for the Unity API used by tools/unity/Editor/PtahMarkers.cs, so
// the script can be compiled and exercised outside Unity (test/unity/run.sh).

using System; using System.Collections.Generic;
namespace UnityEngine {
  public class Object { public string name; public static implicit operator bool(Object o) => o != null; }
  public class Component : Object {
    public GameObject gameObject; public Transform transform => gameObject.transform;
    public bool TryGetComponent<T>(out T c) where T : Component { return gameObject.TryGetComponent(out c); }
  }
  public class Behaviour : Component {} public class MonoBehaviour : Behaviour {}
  public class Collider : Component {}
  public class BoxCollider : Collider { public bool isTrigger; public Vector3 size; public Vector3 center; }
  public struct Vector3 { public float x, y, z; public static Vector3 one => new Vector3 { x = 1, y = 1, z = 1 }; public static Vector3 zero => new Vector3(); }
  public class Transform : Component {
    public Transform parent; public List<Transform> children = new List<Transform>();
    public new string name { get => gameObject.name; }
  }
  public class GameObject : Object {
    public string tag = "Untagged"; public Transform transform; public List<Component> comps = new List<Component>();
    public GameObject(string n) { name = n; transform = new Transform { gameObject = this }; }
    public GameObject Add(GameObject child) { child.transform.parent = transform; transform.children.Add(child.transform); return this; }
    public bool TryGetComponent<T>(out T c) where T : Component { foreach (var x in comps) if (x is T t) { c = t; return true; } c = null; return false; }
    public T[] GetComponentsInChildren<T>(bool inactive) where T : Component {
      var list = new List<T>(); var todo = new List<Transform> { transform };
      while (todo.Count > 0) { var t = todo[0]; todo.RemoveAt(0); if (t is T tt) list.Add(tt); todo.InsertRange(0, t.children); }
      return list.ToArray(); }
  }
  public static class Debug { public static List<string> log = new List<string>(); public static void Log(object m) => log.Add("LOG " + m); public static void LogWarning(object m) => log.Add("WARN " + m); }
  public class DisallowMultipleComponentAttribute : Attribute {}
}
namespace UnityEditor {
  using UnityEngine;
  public class MenuItem : Attribute { public MenuItem(string s) {} }
  public static class Selection { public static GameObject activeGameObject; }
  public static class EditorUtility { public static string path; public static bool DisplayDialog(string a, string b, string c) => true; public static string OpenFilePanel(string a, string b, string c) => path; }
  public static class Undo {
    public static void SetCurrentGroupName(string s) {} public static int GetCurrentGroup() => 0; public static void CollapseUndoOperations(int g) {}
    public static void RegisterFullObjectHierarchyUndo(Object o, string s) {}
    public static T AddComponent<T>(GameObject g) where T : Component, new() { var c = new T { gameObject = g }; g.comps.Add(c); return c; }
  }
}
namespace Ptah {
  public enum PtahMarkerKind { PlayerStart, Spawn, Cover, Objective, Trigger }
  public class PtahMarker : UnityEngine.MonoBehaviour { public PtahMarkerKind kind; public List<string> tags = new List<string>(); }
}
