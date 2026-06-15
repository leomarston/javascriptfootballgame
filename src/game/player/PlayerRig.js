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

// Default outfield kit (home / red). A keeper passes its own overrides.
const DEFAULT_KIT = {
  skin: 0xe8b48c,
  shirt: TEAMS.HOME.primary,
  shorts: 0xf2f3f5,
  socks: TEAMS.HOME.primary,
  boot: 0x15151a,
  hair: 0x241812,
  glove: null, // gloves recolour + enlarge the hands when set
  longSleeves: false // forearms take the shirt colour when true
};

const col = (c) => new THREE.Color(c);

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
// A rounded body block: a sphere scaled to (rx,ry,rz) so the torso/head read
// as anatomy rather than LEGO boxes.
function ellipsoid(rx, ry, rz, y = 0, z = 0) {
  const g = new THREE.SphereGeometry(1, 16, 12);
  g.scale(rx, ry, rz);
  if (y || z) g.translate(0, y, z);
  return g;
}
function ballAt(r, x, y, z) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.translate(x, y, z);
  return g;
}

// Each visible body part: [boneName, geometry, colour].
function bodyParts(kit) {
  const skin = col(kit.skin);
  const shirt = col(kit.shirt);
  const shorts = col(kit.shorts);
  const socks = col(kit.socks);
  const boot = col(kit.boot);
  const hair = col(kit.hair);
  const forearm = kit.longSleeves ? shirt : skin; // long sleeves cover the forearm
  const hand = kit.glove != null ? col(kit.glove) : skin;
  const handR = kit.glove != null ? 0.065 : 0.055; // gloves are a touch bigger
  const eye = col(0x20242c);
  const sole = col(0x0c0c0e);

  return [
    // torso — rounded, wider than deep
    ['hips', ellipsoid(0.16, 0.115, 0.12, -0.01), shorts],
    ['spine', ellipsoid(0.16, 0.135, 0.115, 0.09), shirt],
    ['chest', ellipsoid(0.2, 0.16, 0.12, 0.08), shirt],
    ['neck', limbUp(0.1, 0.045), skin],

    // head: skin dome, hair cap on top/back, two eyes on the front (+Z)
    ['head', ellipsoid(0.115, 0.13, 0.12, 0.06, 0.004), skin],
    ['head', ellipsoid(0.125, 0.105, 0.13, 0.1, -0.028), hair],
    ['head', ballAt(0.02, 0.045, 0.065, 0.1), eye],
    ['head', ballAt(0.02, -0.045, 0.065, 0.1), eye],

    // left arm
    ['upperArmL', sphere(0.068), shirt], // shoulder/deltoid
    ['upperArmL', limbDown(0.27, 0.05), shirt], // sleeve
    ['lowerArmL', sphere(0.046), forearm], // elbow
    ['lowerArmL', limbDown(0.25, 0.043), forearm], // forearm
    ['handL', sphere(handR, -0.05, 0.005), hand],

    // right arm
    ['upperArmR', sphere(0.068), shirt],
    ['upperArmR', limbDown(0.27, 0.05), shirt],
    ['lowerArmR', sphere(0.046), forearm],
    ['lowerArmR', limbDown(0.25, 0.043), forearm],
    ['handR', sphere(handR, -0.05, 0.005), hand],

    // left leg
    ['thighL', sphere(0.082), shorts], // hip
    ['thighL', limbDown(0.44, 0.078), shorts],
    ['shinL', sphere(0.064), socks], // knee
    ['shinL', limbDown(0.42, 0.057), socks],
    ['footL', ellipsoid(0.055, 0.045, 0.13, -0.02, 0.05), boot],
    ['footL', boxAt(0.1, 0.022, 0.26, 0, -0.052, 0.05), sole],

    // right leg
    ['thighR', sphere(0.082), shorts],
    ['thighR', limbDown(0.44, 0.078), shorts],
    ['shinR', sphere(0.064), socks],
    ['shinR', limbDown(0.42, 0.057), socks],
    ['footR', ellipsoid(0.055, 0.045, 0.13, -0.02, 0.05), boot],
    ['footR', boxAt(0.1, 0.022, 0.26, 0, -0.052, 0.05), sole]
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

export function buildPlayerRig(options = {}) {
  const kit = { ...DEFAULT_KIT, ...(options.kit || {}) };

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
  for (const [boneName, geo, color] of bodyParts(kit)) {
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
