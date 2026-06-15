/**
 * PlayerRig.js — the character "model + skeleton".
 *
 * Builds a fully articulated humanoid the way a DCC tool (Blender / Maya) would
 * for a game engine: a bone hierarchy (the skeleton), a single skinned mesh
 * whose vertices are bound to those bones, and a kit-coloured material. Every
 * body part — pelvis, spine, chest, neck, head, both clavicles, upper/lower
 * arms, hands, thighs, shins and feet — is its own rigged bone, so the
 * animation clips can pose the whole body.
 *
 * The mesh uses rigid skin weights (each vertex follows exactly one bone) with
 * overlapping capsule limbs and rounded joint caps, which keeps the deformation
 * clean while exporting as a standard glTF skin (openable in Blender / Unity).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAMS } from '../../config.js';

// Pelvis height (m) — tuned so the boots rest on the pitch (y ≈ 0).
const HIP_Y = 1.0;

const KIT = {
  skin: new THREE.Color(0xe8b48c),
  shirt: new THREE.Color(TEAMS.HOME.primary),
  shorts: new THREE.Color(0xf2f3f5),
  socks: new THREE.Color(TEAMS.HOME.primary),
  boot: new THREE.Color(0x15151a),
  hair: new THREE.Color(0x241812)
};

// Skeleton definition: [name, parent, x, y, z] — positions are local offsets
// from the parent bone, in metres, in the model's rest (bind) pose. The model
// faces +Z, with +Y up.
const SKELETON = [
  ['hips', null, 0, HIP_Y, 0],
  ['spine', 'hips', 0, 0.16, 0],
  ['chest', 'spine', 0, 0.2, 0],
  ['neck', 'chest', 0, 0.21, 0],
  ['head', 'neck', 0, 0.09, 0],

  ['shoulderL', 'chest', 0.04, 0.15, 0],
  ['upperArmL', 'shoulderL', 0.15, 0, 0],
  ['lowerArmL', 'upperArmL', 0, -0.27, 0],
  ['handL', 'lowerArmL', 0, -0.25, 0],

  ['shoulderR', 'chest', -0.04, 0.15, 0],
  ['upperArmR', 'shoulderR', -0.15, 0, 0],
  ['lowerArmR', 'upperArmR', 0, -0.27, 0],
  ['handR', 'lowerArmR', 0, -0.25, 0],

  ['thighL', 'hips', 0.1, -0.06, 0],
  ['shinL', 'thighL', 0, -0.44, 0],
  ['footL', 'shinL', 0, -0.42, 0],

  ['thighR', 'hips', -0.1, -0.06, 0],
  ['shinR', 'thighR', 0, -0.44, 0],
  ['footR', 'shinR', 0, -0.42, 0]
];

// ---- small geometry helpers (authored in each bone's local space) ----------

// A capsule running down (-Y) from the bone origin, length `len`.
function limbDown(len, r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 12);
  g.translate(0, -len / 2, 0);
  return g;
}
// A capsule running up (+Y) from the bone origin (torso segments).
function limbUp(len, r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 12);
  g.translate(0, len / 2, 0);
  return g;
}
function sphere(r, y = 0, z = 0) {
  const g = new THREE.SphereGeometry(r, 14, 12);
  if (y || z) g.translate(0, y, z);
  return g;
}
function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Each visible body part: [boneName, geometry, colour].
function bodyParts() {
  return [
    // torso
    ['hips', boxAt(0.3, 0.2, 0.21, 0, -0.02, 0), KIT.shorts],
    ['spine', boxAt(0.31, 0.22, 0.21, 0, 0.09, 0), KIT.shirt],
    ['chest', boxAt(0.37, 0.25, 0.22, 0, 0.1, 0), KIT.shirt],
    ['neck', limbUp(0.1, 0.05), KIT.skin],
    ['head', sphere(0.125, 0.05, 0.01), KIT.skin],
    ['head', boxAt(0.27, 0.12, 0.26, 0, 0.12, -0.02), KIT.hair], // hair cap

    // left arm
    ['upperArmL', sphere(0.075), KIT.shirt], // shoulder/deltoid
    ['upperArmL', limbDown(0.27, 0.055), KIT.shirt], // short sleeve
    ['lowerArmL', sphere(0.05), KIT.skin], // elbow
    ['lowerArmL', limbDown(0.25, 0.046), KIT.skin], // forearm
    ['handL', sphere(0.06, -0.05, 0.005), KIT.skin],

    // right arm
    ['upperArmR', sphere(0.075), KIT.shirt],
    ['upperArmR', limbDown(0.27, 0.055), KIT.shirt],
    ['lowerArmR', sphere(0.05), KIT.skin],
    ['lowerArmR', limbDown(0.25, 0.046), KIT.skin],
    ['handR', sphere(0.06, -0.05, 0.005), KIT.skin],

    // left leg
    ['thighL', sphere(0.088), KIT.shorts], // hip
    ['thighL', limbDown(0.44, 0.085), KIT.shorts],
    ['shinL', sphere(0.07), KIT.socks], // knee
    ['shinL', limbDown(0.42, 0.063), KIT.socks],
    ['footL', boxAt(0.11, 0.08, 0.26, 0, -0.025, 0.06), KIT.boot],

    // right leg
    ['thighR', sphere(0.088), KIT.shorts],
    ['thighR', limbDown(0.44, 0.085), KIT.shorts],
    ['shinR', sphere(0.07), KIT.socks],
    ['shinR', limbDown(0.42, 0.063), KIT.socks],
    ['footR', boxAt(0.11, 0.08, 0.26, 0, -0.025, 0.06), KIT.boot]
  ];
}

function paintAndSkin(geo, color, boneIdx) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    si[i * 4] = boneIdx; // rigid bind: 100% weight to one bone
    sw[i * 4] = 1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

export function buildPlayerRig() {
  // ---- build the bone hierarchy ----
  const bones = {};
  const order = [];
  for (const [name, parent, x, y, z] of SKELETON) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) bones[parent].add(b);
    bones[name] = b;
    order.push(b);
  }
  const root = bones.hips;
  root.updateMatrixWorld(true); // resolve the rest-pose world matrices

  const boneIndex = new Map(order.map((b, i) => [b.name, i]));

  // ---- bake each part into the mesh (bind) space ----
  const parts = [];
  for (const [boneName, geo, color] of bodyParts()) {
    paintAndSkin(geo, color, boneIndex.get(boneName));
    geo.applyMatrix4(bones[boneName].matrixWorld); // bone-local -> bind space
    parts.push(geo);
  }
  const merged = mergeGeometries(parts, false);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.0
  });

  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.name = 'Player';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(root);
  mesh.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(order);
  mesh.bind(skeleton, mesh.matrixWorld);

  return { mesh, skeleton, bones, boneOrder: order };
}
