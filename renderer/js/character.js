// character.js — the walk-mode mannequin.
//
// A Mixamo character converted by tools/mixamo/fbx2ptah.py into a skinned glTF
// with idle / walking / jump / strafe / turn clips, embedded as a base64 module
// (renderer/assets/mannequin.glb.js) so it loads under the strict CSP in both
// the browser build and Electron. It is scaled to the profile's player height
// each time walk mode starts, lives in the scene (not the level), and is never
// picked, saved or exported.

import * as THREE from 'three';
import { parseGlb, base64ToArrayBuffer } from './gltf.js';

const MANNEQUIN_COLOR = 0x8d93a1;

/** Resolves to { root, mixer, actions, clips, sourceHeight, setHeight, name } or null if the asset failed to load. */
export async function loadMannequin() {
  const asset = await import('../assets/mannequin.glb.js');
  const g = parseGlb(base64ToArrayBuffer(asset.glbBase64), {
    material: () => new THREE.MeshLambertMaterial({ color: MANNEQUIN_COLOR })
  });
  const root = new THREE.Group();
  root.name = 'Mannequin';
  root.add(g.scene);
  root.visible = false;
  root.traverse(o => { o.userData.helper = true; o.userData.mannequin = true; o.raycast = () => {}; });
  const mixer = new THREE.AnimationMixer(g.scene);
  const actions = {};
  for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
  const sourceHeight = asset.height;
  return {
    name: asset.name, root, mixer, actions, clips: g.animations, sourceHeight,
    /** Uniform scale so the mannequin stands `h` units tall. */
    setHeight(h) { g.scene.scale.setScalar(h / sourceHeight); },
    /** Natural forward speed of a locomotion clip in units/s (from its root motion before it was stripped). */
    clipSpeed(name) { const c = g.animations.find(x => x.name === name); return c ? (c.userData.rootSpeed || 0) * g.scene.scale.x : 0; }
  };
}
