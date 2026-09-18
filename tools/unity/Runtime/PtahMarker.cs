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

        /// Ptah's facing arrow is the object's local -Z in the Y-up USD file. The
        /// Unity USD importer's default basis change (SlowAndSafe) flips Z, so the
        /// arrow ends up along +Z, which is Unity's forward.
        public Vector3 Facing => transform.forward;

        public bool HasTag(string tag) => tags.Contains(tag);

        void OnDrawGizmos()
        {
            Gizmos.color = kind switch
            {
                PtahMarkerKind.PlayerStart => new Color(0.30f, 0.68f, 0.35f),
                PtahMarkerKind.Spawn => new Color(0.75f, 0.22f, 0.17f),
                PtahMarkerKind.Cover => new Color(0.85f, 0.51f, 0.18f),
                PtahMarkerKind.Objective => new Color(0.85f, 0.64f, 0.25f),
                _ => new Color(0.44f, 0.56f, 0.94f)
            };
            var p = transform.position;
            if (kind == PtahMarkerKind.Trigger)
            {
                Gizmos.matrix = transform.localToWorldMatrix;
                Gizmos.DrawWireCube(Vector3.zero, Vector3.one);
                return;
            }
            Gizmos.DrawWireSphere(p, 0.15f);
            Gizmos.DrawLine(p, p + Facing * 0.6f);
        }
    }
}
