// gltf.js — a small glTF 2.0 (.glb) reader for skinned, animated characters.
//
// three.js core ships no glTF loader and Ptah vendors no addons beyond the two
// controls, so this covers exactly what tools/mixamo/fbx2ptah.py writes and
// what a Blender export of a similar character would contain: a node tree with
// TRS or matrix transforms, meshes with POSITION / NORMAL / JOINTS_0 / WEIGHTS_0
// and indices, one skin per mesh, materials reduced to a flat base colour, and
// animations with translation / rotation / scale channels (LINEAR or STEP;
// CUBICSPLINE is read as LINEAR). No textures, no sparse accessors, no
// extensions, no external buffers. Node names are sanitised the way three's
// own loader does so animation tracks can address them.

import * as THREE from 'three';

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const PATH_PROP = { translation: 'position', rotation: 'quaternion', scale: 'scale' };

/** Split a .glb ArrayBuffer into { json, bin }. */
export function parseGlbContainer(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB version must be 2');
  const length = dv.getUint32(8, true);
  let offset = 12, json = null, bin = null;
  while (offset < length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const data = buffer.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (chunkType === 0x004e4942) bin = data;
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function accessorArray(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const Type = COMPONENT[acc.componentType];
  const n = SIZE[acc.type];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride;
  if (stride && stride !== n * Type.BYTES_PER_ELEMENT) {
    // interleaved: copy out element by element
    const out = new Type(acc.count * n);
    for (let i = 0; i < acc.count; i++) {
      const src = new Type(bin, start + i * stride, n);
      out.set(src, i * n);
    }
    return { array: out, itemSize: n, normalized: !!acc.normalized };
  }
  // typed arrays need an aligned offset; copy when the chunk isn't aligned
  const bytes = acc.count * n * Type.BYTES_PER_ELEMENT;
  const array = start % Type.BYTES_PER_ELEMENT === 0
    ? new Type(bin, start, acc.count * n)
    : new Type(bin.slice(start, start + bytes));
  return { array, itemSize: n, normalized: !!acc.normalized };
}

/**
 * Build a three.js scene from a .glb ArrayBuffer.
 * Returns { scene, animations, skinnedMeshes, nodes, json }.
 * opts.material(baseColor: THREE.Color, gltfMaterial) → THREE.Material lets the caller pick shading.
 */
export function parseGlb(buffer, opts = {}) {
  const { json, bin } = parseGlbContainer(buffer);
  const jointSet = new Set();
  for (const skin of json.skins || []) for (const j of skin.joints) jointSet.add(j);

  // nodes
  const nodes = (json.nodes || []).map((n, i) => {
    const obj = jointSet.has(i) ? new THREE.Bone() : new THREE.Group();
    obj.name = THREE.PropertyBinding.sanitizeNodeName(n.name || ('node_' + i));
    if (n.matrix) obj.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
    if (n.translation) obj.position.fromArray(n.translation);
    if (n.rotation) obj.quaternion.fromArray(n.rotation);
    if (n.scale) obj.scale.fromArray(n.scale);
    return obj;
  });
  (json.nodes || []).forEach((n, i) => { for (const c of n.children || []) nodes[i].add(nodes[c]); });

  const scene = new THREE.Group();
  scene.name = 'glTF';
  const sceneDef = json.scenes ? json.scenes[json.scene || 0] : { nodes: nodes.map((_, i) => i).filter(i => !nodes[i].parent) };
  for (const i of sceneDef.nodes) scene.add(nodes[i]);
  scene.updateMatrixWorld(true);

  const makeMaterial = opts.material || ((color) => new THREE.MeshLambertMaterial({ color }));
  const skinnedMeshes = [];
  (json.nodes || []).forEach((n, i) => {
    if (n.mesh === undefined) return;
    const meshDef = json.meshes[n.mesh];
    const skinDef = n.skin !== undefined ? json.skins[n.skin] : null;
    for (const prim of meshDef.primitives) {
      const geo = new THREE.BufferGeometry();
      for (const [semantic, accIndex] of Object.entries(prim.attributes)) {
        const a = accessorArray(json, bin, accIndex);
        const name = { POSITION: 'position', NORMAL: 'normal', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight', TEXCOORD_0: 'uv', COLOR_0: 'color' }[semantic];
        if (name) geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
      }
      if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(accessorArray(json, bin, prim.indices).array, 1));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const matDef = prim.material !== undefined ? json.materials[prim.material] : {};
      const bc = (matDef.pbrMetallicRoughness && matDef.pbrMetallicRoughness.baseColorFactor) || [0.8, 0.8, 0.8, 1];
      const material = makeMaterial(new THREE.Color(bc[0], bc[1], bc[2]), matDef);
      let mesh;
      if (skinDef) {
        mesh = new THREE.SkinnedMesh(geo, material);
        const bones = skinDef.joints.map(j => nodes[j]);
        const inverses = [];
        if (skinDef.inverseBindMatrices !== undefined) {
          const ibm = accessorArray(json, bin, skinDef.inverseBindMatrices).array;
          for (let k = 0; k < bones.length; k++) inverses.push(new THREE.Matrix4().fromArray(ibm, k * 16));
        }
        nodes[i].add(mesh);
        mesh.updateMatrixWorld(true);
        mesh.bind(new THREE.Skeleton(bones, inverses.length ? inverses : undefined), mesh.matrixWorld);
        mesh.normalizeSkinWeights();
        skinnedMeshes.push(mesh);
      } else {
        mesh = new THREE.Mesh(geo, material);
        nodes[i].add(mesh);
      }
      mesh.name = meshDef.name || nodes[i].name;
      mesh.frustumCulled = false;             // skinned bounds move with the animation
    }
  });

  // animations
  const animations = (json.animations || []).map((a, ai) => {
    const tracks = [];
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const target = nodes[ch.target.node];
      const prop = PATH_PROP[ch.target.path];
      if (!target || !prop) continue;
      const times = accessorArray(json, bin, s.input).array;
      let values = accessorArray(json, bin, s.output).array;
      if (s.interpolation === 'CUBICSPLINE') {          // keep only the value of each (in-tangent, value, out-tangent) triple
        const n = SIZE[json.accessors[s.output].type];
        const v = new Float32Array(times.length * n);
        for (let k = 0; k < times.length; k++) for (let c = 0; c < n; c++) v[k * n + c] = values[(k * 3 + 1) * n + c];
        values = v;
      }
      const interp = s.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      const Track = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new Track(`${target.name}.${prop}`, Array.from(times), Array.from(values), interp));
    }
    const clip = new THREE.AnimationClip(a.name || ('clip_' + ai), -1, tracks);
    clip.userData = a.extras || {};
    return clip;
  });

  return { scene, animations, skinnedMeshes, nodes, json };
}

/** Decode a base64 string to an ArrayBuffer (works in browsers and Node). */
export function base64ToArrayBuffer(b64) {
  if (typeof Buffer !== 'undefined' && typeof atob === 'undefined') {
    const b = Buffer.from(b64, 'base64');
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
