// triangulate.js — USD polygon faces as triangles, for the editor's meshes and the GLB export.
//
// An imported mesh keeps its faces as the file has them (rec.meshData, which is
// what Ptah writes back); only the geometry the editor draws, picks and walks on
// is made of triangles. A convex face is fanned from its first corner. Any other
// face (an L, a U, a notched wall) is ear-clipped in the plane it faces: a fan
// across a concave face covers its notch, so the notch drew, took clicks and
// blocked walk mode.

import { ShapeUtils, Vector2 } from 'three';
import { newellNormal } from './usd.js';

/**
 * The faces' triangles as corner numbers: corner k is entry k of faceVertexIndices, so anything
 * given per face corner (the USD export's face-varying normals) goes with it. Front faces CCW, as in USD.
 */
export function triangulateCorners({ points, faceVertexCounts, faceVertexIndices }) {
  const out = [];
  let cursor = 0;
  for (const count of faceVertexCounts) {
    const face = [];
    for (let i = 0; i < count; i++) face.push(points[faceVertexIndices[cursor + i]]);
    const n = count > 3 && face.every(Boolean) ? newellNormal(face) : null;
    const tris = n && !convex(face, n) ? earClip(face, n) : null;
    if (tris && tris.length) { for (const t of tris) for (const k of t) out.push(cursor + k); }
    else {
      // a triangle, a convex face, or one ear clipping can't take whole (no area, or it crosses itself): a fan,
      // skipping the triangles that name a point the file doesn't have
      for (let i = 1; i < count - 1; i++) {
        if (!face[0] || !face[i] || !face[i + 1]) continue;
        out.push(cursor, cursor + i, cursor + i + 1);
      }
    }
    cursor += count;
  }
  return out;
}

/** Flat [x, y, z, ...] triangle positions for { points, faceVertexCounts, faceVertexIndices }, front faces CCW as in USD. */
export function triangulateFaces(md) {
  const pos = [];
  for (const c of triangulateCorners(md)) pos.push(...md.points[md.faceVertexIndices[c]]);
  return pos;
}

/** Does every corner of `face` turn the same way about its normal `n`? */
function convex(face, n) {
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length], c = face[(i + 2) % face.length];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
    // the turn's sine, against its own edges: the same answer whatever units the file is in
    const turn = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (turn < -1e-9 * Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)) return false;
  }
  return true;
}

/**
 * Corner triples of `face`, ear-clipped in the plane across its normal's largest axis, each wound
 * as the face is; null unless every corner made it in (n - 2 triangles): a face that crosses itself
 * can come back part-done, which would drop part of it, so it takes the fan instead.
 */
function earClip(face, n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const [u, v] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [2, 0] : [0, 1];
  const contour = face.map(p => new Vector2(p[u], p[v]));
  const tris = ShapeUtils.triangulateShape(contour, []);   // drops a last corner that repeats the first
  if (tris.length !== contour.length - 2) return null;
  for (const t of tris) {
    const [a, b, c] = t.map(k => face[k]);
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) [t[1], t[2]] = [t[2], t[1]];   // the projection can mirror it
  }
  return tris;
}
