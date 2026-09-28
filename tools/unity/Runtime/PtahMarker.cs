// PtahMarker.cs -- component that PtahMarkers.ConvertSelected() attaches to
// converted gameplay markers so designers and scripts can find them.
// Put this file in a Runtime folder (or anywhere outside Editor/).

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

        /// Ptah's facing arrow is the object's local -Z in the Y-up USD file. The
        /// Unity USD importer's default basis change (SlowAndSafe) flips Z, so the
        /// arrow ends up along +Z, which is Unity's forward.
        public Vector3 Facing => transform.forward;

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
