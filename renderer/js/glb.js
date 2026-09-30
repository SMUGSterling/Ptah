// glb.js — the level as binary glTF 2.0 (.glb), an open format that Blender, Unity (glTFast),
// Unreal (its glTF importer) and web viewers read. One way only: the .usda stays the file Ptah saves
// and opens; a .glb is a handoff to another tool, like the engine scripts.
//
// What goes in, from the same object tree the .usda export writes (app.js serializeObjects):
//  - Units: glTF is metres, Ptah centimetres. Every node's translation and every mesh point is
//    scaled by 0.01 and scales stay as they are, which is exact at any depth of the hierarchy
//    (S·L1·…·Ln = L1'·…·Ln'·S with each Lk' = Lk, translation × 0.01). A 64 cm cube is scale 64 over a
//    1 cm unit mesh, as the USD export's scaled unit meshes are, and as Unity 6.3's USD Importer
//    brings them in. Y-up and right-handed like Ptah, so no axis changes; rotations go out as
//    quaternions from the same rotateXYZ angles (three.js order 'ZYX').
//  - Objects: one "Root" node, then the level's tree. Primitives and imported meshes are triangle
//    meshes; primitives carry the USD export's face-varying normals (hard box edges, smooth cylinder
//    sides and spheres); imported meshes carry none, and glTF readers then compute flat ones.
//    One material per colour (the intent colours), double-sided for planes and double-sided meshes.
//  - Groups, notes and markers are empty nodes (a trigger's box size is its scale, as in the .usda).
//  - Gameplay data: node extras under the USD export's names (ptah:type, ptah:id, ptah:intent,
//    ptah:marker, ptah:tags, ptah:text, ptah:steps). glTF has no visibility, so a hidden object still
//    draws and says ptah:visible false. Blender shows extras as custom properties.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FORMAT_VERSION, PRIMITIVE_GEOMETRY, STAIRS_MAX_STEPS, faceVaryingNormals } from './usd.js';
import { triangulateCorners } from './triangulate.js';

export const GLB_METRES_PER_UNIT = 0.01;   // Ptah's centimetre, in glTF's metres
const K = GLB_METRES_PER_UNIT;

/** A three.js scene of the level, laid out for GLTFExporter as the header describes. */
export function buildGlbScene(objects, opts = {}) {
  const scene = new THREE.Scene();
  scene.userData = { 'ptah:format': FORMAT_VERSION, 'ptah:units': 'metres (Ptah centimetres × 0.01)' };
  if (opts.appVersion) scene.userData['ptah:version'] = opts.appVersion;
  if (opts.metrics) scene.userData['ptah:metrics'] = { ...opts.metrics };
  const root = new THREE.Object3D();
  root.name = 'Root';
  scene.add(root);
  const materials = new Map();
  for (const obj of objects) addNode(root, obj, materials);
  return scene;
}

/** The level as .glb bytes. */
export async function exportGlb(objects, opts = {}) {
  const scene = buildGlbScene(objects, opts);
  try {
    // trs: each node as translation, rotation and scale, which is what the engines show; a matrix would be decomposed on import
    return await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, trs: true });
  } finally {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of new Set(collectMaterials(scene))) m.dispose();
  }
}

function collectMaterials(scene) {
  const out = [];
  scene.traverse((o) => { if (o.material) out.push(o.material); });
  return out;
}

function addNode(parent, obj, materials) {
  const isGeom = obj.type !== 'group' && obj.type !== 'note' && obj.type !== 'marker';
  const geo = isGeom
    ? (obj.meshData || (Object.hasOwn(PRIMITIVE_GEOMETRY, obj.type) ? PRIMITIVE_GEOMETRY[obj.type](obj.params) : null))
    : null;
  if (isGeom && !geo) return;                // as the .usda export: a type it cannot build is left out
  const geometry = geo ? meshGeometry(geo, !obj.meshData) : null;
  const node = geometry
    ? new THREE.Mesh(geometry, material(materials, obj.color, obj.intent, !!geo.doubleSided))
    : new THREE.Object3D();
  node.name = obj.name || 'Object';
  const p = obj.position || { x: 0, y: 0, z: 0 };
  const r = obj.rotation || { x: 0, y: 0, z: 0 };
  const s = obj.scale || { x: 1, y: 1, z: 1 };
  node.position.set(p.x * K, p.y * K, p.z * K);
  node.rotation.set(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z), 'ZYX');
  node.scale.set(s.x, s.y, s.z);

  const extras = { 'ptah:type': obj.meshData ? 'mesh' : obj.type };
  if (obj.uid) extras['ptah:id'] = obj.uid;
  if (obj.intent && geo) extras['ptah:intent'] = obj.intent;
  if (obj.type === 'marker') extras['ptah:marker'] = obj.marker || 'Spawn';
  if (obj.tags && obj.tags.length) extras['ptah:tags'] = [...obj.tags];
  if (obj.type === 'note') extras['ptah:text'] = obj.text || '';
  if (obj.type === 'stairs' && obj.params && obj.params.steps) extras['ptah:steps'] = Math.min(STAIRS_MAX_STEPS, Math.max(1, Math.round(obj.params.steps) || 1));
  if (obj.visible === false) extras['ptah:visible'] = false;
  node.userData = extras;

  parent.add(node);
  for (const child of obj.children || []) addNode(node, child, materials);
}

/** Non-indexed triangles, in metres; with the USD export's face-varying normals for a primitive. null: no triangles. */
function meshGeometry(geo, withNormals) {
  const corners = triangulateCorners(geo);
  if (!corners.length) return null;
  const normals = withNormals ? faceVaryingNormals(geo, '', () => {}) : null;   // a face with no area gets (0, 1, 0) quietly
  const pos = new Float32Array(corners.length * 3), nor = normals ? new Float32Array(corners.length * 3) : null;
  corners.forEach((c, i) => {
    const pt = geo.points[geo.faceVertexIndices[c]];
    pos[i * 3] = pt[0] * K; pos[i * 3 + 1] = pt[1] * K; pos[i * 3 + 2] = pt[2] * K;
    if (nor) nor.set(normals[c], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** One material per colour and side, named after the intent that gave it the colour. */
function material(materials, color, intent, doubleSided) {
  const c = color || [0.5, 0.5, 0.5];      // linear RGB, as serialized
  const key = c.map(v => v.toFixed(5)).join(',') + (doubleSided ? ',2' : '');
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    m.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
    m.name = (intent || 'color') + (doubleSided ? ' (double-sided)' : '');
    materials.set(key, m);
  }
  return m;
}
