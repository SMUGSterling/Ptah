// snap.js — face-to-face snapping between world axis-aligned boxes.
//
// While a selection is dragged, its world bounds are compared with every other
// object's bounds. When a face of the moving box comes within `threshold` of a
// facing (butt joint) or coplanar (flush alignment) face of another box, and
// the two boxes overlap in the other two axes, the selection is shifted so the
// faces meet exactly. Each axis snaps independently, so pushing a block into a
// corner closes both gaps. Pure JS; unit-tested under Node.
//
// Boxes are { min: [x, y, z], max: [x, y, z] }.

const OTHER = [[1, 2], [0, 2], [0, 1]];

function overlaps(a, b, axes, slack) {
  for (const k of axes) {
    if (a.max[k] < b.min[k] - slack || a.min[k] > b.max[k] + slack) return false;
  }
  return true;
}

/**
 * Best snap per axis. Returns { delta: [dx, dy, dz], planes: [] } where each
 * plane is { axis, value, min, max } describing the shared face to highlight
 * (min/max span the other two axes of the target face). delta is zero on axes
 * with no candidate inside the threshold.
 */
export function faceSnapDelta(box, others, threshold) {
  const delta = [0, 0, 0];
  const planes = [];
  if (!(threshold > 0)) return { delta, planes };
  for (let a = 0; a < 3; a++) {
    let best = null;
    for (const o of others) {
      if (!overlaps(box, o, OTHER[a], threshold)) continue;
      // Butt joints: moving.min meets other.max, moving.max meets other.min.
      // Flush: moving.min meets other.min, moving.max meets other.max.
      const pairs = [
        [box.min[a], o.max[a]], [box.max[a], o.min[a]],
        [box.min[a], o.min[a]], [box.max[a], o.max[a]]
      ];
      for (const [mine, theirs] of pairs) {
        const d = theirs - mine;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) {
          best = { d, value: theirs, other: o };
        }
      }
    }
    if (!best || Math.abs(best.d) < 1e-9) continue;   // already flush: nothing to move or show
    delta[a] = best.d;
    // Highlight the overlap of the two faces rather than the whole target face.
    const min = [0, 0, 0], max = [0, 0, 0];
    min[a] = max[a] = best.value;
    for (const k of OTHER[a]) {
      min[k] = Math.max(box.min[k], best.other.min[k]);
      max[k] = Math.min(box.max[k], best.other.max[k]);
      if (max[k] - min[k] < 1e-6) { min[k] = best.other.min[k]; max[k] = best.other.max[k]; }
    }
    planes.push({ axis: a, value: best.value, min, max });
  }
  return { delta, planes };
}
