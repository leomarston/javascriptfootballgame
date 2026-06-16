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

// Visual size multiplier applied by the player wrappers (FieldPlayer/Goalkeeper)
// to the whole rig group. Scaling the group keeps the feet planted and leaves
// gameplay spacing (body radius, dribble offsets) untouched.
export const PLAYER_SCALE = 1.12;

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
// An ellipsoid placed anywhere (rounded muscle / head / boot block).
function ellipsoidAt(rx, ry, rz, x = 0, y = 0, z = 0, wseg = 18, hseg = 14) {
  const g = new THREE.SphereGeometry(1, wseg, hseg);
  g.scale(rx, ry, rz);
  if (x || y || z) g.translate(x, y, z);
  return g;
}
// A tapered limb segment spanning yTop→yBot (yTop above yBot) with radii
// rTop→rBot — gives limbs real muscle taper instead of uniform tubes.
function taperSeg(rTop, rBot, yTop, yBot, seg = 16) {
  const len = Math.max(0.001, yTop - yBot);
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1);
  g.translate(0, (yTop + yBot) / 2, 0);
  return g;
}

// Hair geometry by style (bound to the head bone; the head's eyes sit lower on
// the front so caps on top/back never cover the face).
function hairParts(style, hair) {
  switch (style) {
    case 'bald':
      return [];
    case 'buzz':
      return [['head', ellipsoid(0.12, 0.08, 0.122, 0.085, -0.008), hair]];
    case 'afro':
      return [['head', ellipsoid(0.155, 0.142, 0.135, 0.1, -0.05), hair]];
    case 'mohawk':
      return [['head', ellipsoid(0.028, 0.09, 0.14, 0, 0.155, -0.005), hair]];
    case 'bun':
      return [
        ['head', ellipsoid(0.122, 0.098, 0.126, 0.092, -0.022), hair],
        ['head', ballAt(0.052, 0, 0.2, -0.05), hair]
      ];
    case 'long':
      return [
        ['head', ellipsoid(0.128, 0.12, 0.135, 0.082, -0.035), hair],
        ['head', ellipsoid(0.105, 0.11, 0.055, -0.02, -0.1), hair]
      ];
    case 'short':
    default:
      return [['head', ellipsoid(0.125, 0.105, 0.128, 0.1, -0.03), hair]];
  }
}

// Each visible body part: [boneName, geometry, colour, kitSlot?].
// An athletic, broadcast-style build: V-taper torso, deltoids, short sleeves
// over bare arms, bare knees between shorts and socks, calf taper and a shaped
// head/boots. The 4th item tags a recolourable kit slot ('shirt'|'shorts'|
// 'socks') so a player's team colours can be repainted in place.
function bodyParts(kit, hairStyle) {
  const skin = col(kit.skin);
  const shirt = col(kit.shirt);
  const shorts = col(kit.shorts);
  const socks = col(kit.socks);
  const boot = col(kit.boot);
  const hair = col(kit.hair);
  const eye = col(0x1b1f27);
  const sole = col(0x0b0b0d);
  const brow = hair.clone().multiplyScalar(0.65);
  const long = !!kit.longSleeves; // keeper: sleeves + forearms take the shirt
  const armC = long ? shirt : skin; // bicep / forearm colour
  const armSlot = long ? 'shirt' : null;
  const hand = kit.glove != null ? col(kit.glove) : skin;
  const hr = kit.glove != null ? 0.062 : 0.05; // gloves a touch bigger

  return [
    // ---- torso: broad chest tapering to a slim waist ----
    ['hips', ellipsoidAt(0.15, 0.12, 0.115, 0, -0.02, 0), shorts, 'shorts'],
    ['spine', ellipsoidAt(0.142, 0.135, 0.106, 0, 0.05, 0), shirt, 'shirt'], // waist / abs
    ['chest', ellipsoidAt(0.205, 0.165, 0.13, 0, 0.05, 0.006), shirt, 'shirt'], // chest
    ['chest', ellipsoidAt(0.168, 0.085, 0.112, 0, 0.16, 0), shirt, 'shirt'], // clavicle line
    ['neck', ellipsoidAt(0.072, 0.03, 0.072, 0, 0, 0), shirt, 'shirt'], // collar
    ['neck', taperSeg(0.046, 0.053, 0.1, -0.01), skin],

    // ---- head: skull + jaw + nose + ears + eyes + brows ----
    ['head', ellipsoidAt(0.108, 0.125, 0.114, 0, 0.055, 0.004), skin],
    ['head', ellipsoidAt(0.083, 0.072, 0.09, 0, -0.018, 0.016), skin], // jaw / chin
    ['head', ellipsoidAt(0.02, 0.027, 0.025, 0, 0.012, 0.103), skin], // nose
    ['head', ellipsoidAt(0.016, 0.032, 0.022, 0.103, 0.03, 0), skin], // ear R
    ['head', ellipsoidAt(0.016, 0.032, 0.022, -0.103, 0.03, 0), skin], // ear L
    ['head', ballAt(0.015, 0.043, 0.062, 0.097), eye],
    ['head', ballAt(0.015, -0.043, 0.062, 0.097), eye],
    ['head', boxAt(0.034, 0.008, 0.012, 0.044, 0.09, 0.095), brow],
    ['head', boxAt(0.034, 0.008, 0.012, -0.044, 0.09, 0.095), brow],

    // ---- left arm: deltoid · sleeve · bare bicep · forearm · hand ----
    ['shoulderL', ellipsoidAt(0.072, 0.07, 0.072), shirt, 'shirt'],
    ['upperArmL', taperSeg(0.06, 0.05, 0.03, -0.11), shirt, 'shirt'], // sleeve
    ['upperArmL', taperSeg(0.047, 0.04, -0.11, -0.27), armC, armSlot], // bicep
    ['lowerArmL', ellipsoidAt(0.043, 0.043, 0.043), armC, armSlot], // elbow
    ['lowerArmL', taperSeg(0.04, 0.03, 0, -0.25), armC, armSlot], // forearm
    ['handL', ellipsoidAt(hr, 0.03, hr * 1.3, 0, -0.05, 0.012), hand],

    // ---- right arm ----
    ['shoulderR', ellipsoidAt(0.072, 0.07, 0.072), shirt, 'shirt'],
    ['upperArmR', taperSeg(0.06, 0.05, 0.03, -0.11), shirt, 'shirt'],
    ['upperArmR', taperSeg(0.047, 0.04, -0.11, -0.27), armC, armSlot],
    ['lowerArmR', ellipsoidAt(0.043, 0.043, 0.043), armC, armSlot],
    ['lowerArmR', taperSeg(0.04, 0.03, 0, -0.25), armC, armSlot],
    ['handR', ellipsoidAt(hr, 0.03, hr * 1.3, 0, -0.05, 0.012), hand],

    // ---- left leg: shorts (upper thigh) → bare knee → socks (shin) ----
    ['thighL', ellipsoidAt(0.088, 0.084, 0.088), shorts, 'shorts'], // hip
    ['thighL', taperSeg(0.09, 0.073, 0, -0.26), shorts, 'shorts'], // upper thigh (shorts)
    ['thighL', taperSeg(0.073, 0.062, -0.26, -0.44), skin], // lower thigh (bare)
    ['shinL', ellipsoidAt(0.06, 0.06, 0.06), skin], // knee (bare)
    ['shinL', taperSeg(0.064, 0.04, -0.03, -0.40), socks, 'socks'], // sock
    ['shinL', ellipsoidAt(0.05, 0.082, 0.056, 0, -0.13, -0.022), socks, 'socks'], // calf bulge
    ['footL', ellipsoidAt(0.05, 0.04, 0.142, 0, -0.02, 0.05), boot], // boot
    ['footL', ellipsoidAt(0.05, 0.046, 0.05, 0, -0.005, -0.05), boot], // heel
    ['footL', boxAt(0.094, 0.02, 0.27, 0, -0.05, 0.05), sole], // sole

    // ---- right leg ----
    ['thighR', ellipsoidAt(0.088, 0.084, 0.088), shorts, 'shorts'],
    ['thighR', taperSeg(0.09, 0.073, 0, -0.26), shorts, 'shorts'],
    ['thighR', taperSeg(0.073, 0.062, -0.26, -0.44), skin],
    ['shinR', ellipsoidAt(0.06, 0.06, 0.06), skin],
    ['shinR', taperSeg(0.064, 0.04, -0.03, -0.40), socks, 'socks'],
    ['shinR', ellipsoidAt(0.05, 0.082, 0.056, 0, -0.13, -0.022), socks, 'socks'],
    ['footR', ellipsoidAt(0.05, 0.04, 0.142, 0, -0.02, 0.05), boot],
    ['footR', ellipsoidAt(0.05, 0.046, 0.05, 0, -0.005, -0.05), boot],
    ['footR', boxAt(0.094, 0.02, 0.27, 0, -0.05, 0.05), sole]
  ].concat(hairParts(hairStyle, hair));
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
  const hairStyle = options.hairStyle || 'short';

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
  // record each recolourable slot's vertex range in the merged buffer so the
  // kit can be repainted later (mergeGeometries concatenates in push order).
  const parts = [];
  const slots = {};
  let vbase = 0;
  for (const [boneName, geo, color, slot] of bodyParts(kit, hairStyle)) {
    paintAndSkin(geo, color, boneIndex.get(boneName));
    geo.applyMatrix4(bones[boneName].matrixWorld); // bone-local -> bind space
    const count = geo.attributes.position.count;
    if (slot) (slots[slot] || (slots[slot] = [])).push([vbase, count]);
    vbase += count;
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

  return { mesh, skeleton, bones, boneOrder: order, slots };
}
