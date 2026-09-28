// PtahMarker.cs -- component that PtahMarkers.ConvertSelected() attaches to
// converted gameplay markers so designers and scripts can find them. Part of the
// Ptah Markers package (tools/unity); its assembly builds for players too.

using System.Collections.Generic;
using UnityEngine;

namespace Ptah
{
    public enum PtahMarkerKind { PlayerStart, Spawn, Cover, Objective, Trigger }

    [DisallowMultipleComponent]
    public class PtahMarker : MonoBehaviour
    {
        public PtahMarkerKind kind;
        public List<string> tags = new List<string>();
        /// A Trigger's box in local units (the BoxCollider's size): 1 when the importer scaled the level's
        /// root to metres, 0.01 when it converted positions but left the scale in Ptah's centimetres.
        public Vector3 volume = Vector3.one;

        /// Ptah's facing arrow in the object's local space. It is local -Z in the USD file; importers mirror
        /// one axis to reach Unity's left-handed space, and Convert Markers measures which: mirroring Z (the
        /// USD package, and the default) makes it +Z, Unity's forward; mirroring X leaves it at -Z.
        public Vector3 facingLocal = new Vector3(0, 0, 1);
        public Vector3 Facing => transform.TransformDirection(facingLocal);

        public bool HasTag(string tag) => tags.Contains(tag);

        // a switch statement, not a switch expression: compiles with any Unity C# version (and mono's mcs, which the test harness uses)
        static Color GizmoColor(PtahMarkerKind k)
        {
            switch (k)
            {
                case PtahMarkerKind.PlayerStart: return new Color(0.30f, 0.68f, 0.35f);
                case PtahMarkerKind.Spawn: return new Color(0.75f, 0.22f, 0.17f);
                case PtahMarkerKind.Cover: return new Color(0.85f, 0.51f, 0.18f);
                case PtahMarkerKind.Objective: return new Color(0.85f, 0.64f, 0.25f);
                default: return new Color(0.44f, 0.56f, 0.94f);
            }
        }

        void OnDrawGizmos()
        {
            Gizmos.color = GizmoColor(kind);
            var p = transform.position;
            if (kind == PtahMarkerKind.Trigger)
            {
                var was = Gizmos.matrix;
                Gizmos.matrix = transform.localToWorldMatrix;
                Gizmos.DrawWireCube(Vector3.zero, volume);
                Gizmos.matrix = was;             // the next gizmo drawn this frame is in world space again
                return;
            }
            Gizmos.DrawWireSphere(p, 0.15f);
            Gizmos.DrawLine(p, p + Facing * 0.6f);
        }
    }
}
