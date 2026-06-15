/**
 * PlayerAnimations.js — the authored animation clips (the "art").
 *
 * Each clip is a set of keyframed bone poses, exactly how an animator keys a
 * locomotion cycle: canonical poses at contact / mid-stance / toe-off / swing,
 * with the engine interpolating between them. The opposite limb reuses the same
 * pose curve shifted by half a cycle (`half`), which guarantees a clean,
 * symmetrical gait. These clips are played back by an AnimationMixer — the
 * motion comes from the designed keyframes, not from per-frame code.
 *
 * Pose convention: model faces +Z, +Y up. A forward leg/arm swing is a negative
 * X rotation; knee/elbow flexion is positive X; a forward torso lean is positive
 * X. Angles are radians.
 */

import * as THREE from 'three';

const HIP_Y = 1.0;
const KEYS = [0, 0.25, 0.5, 0.75, 1];

// Expand a 4-pose cycle (phases 0/.25/.5/.75) into a looping 5-key list.
const full = (a) => [a[0], a[1], a[2], a[3], a[0]];
// Same cycle shifted half a period — used for the opposite arm/leg.
const half = (a) => [a[2], a[3], a[0], a[1], a[2]];

function quatTrack(bone, D, eulers, offset = [0, 0, 0]) {
  const times = [];
  const values = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (let i = 0; i < eulers.length; i++) {
    times.push(KEYS[i] * D);
    e.set(eulers[i][0] + offset[0], eulers[i][1] + offset[1], eulers[i][2] + offset[2], 'XYZ');
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function posTrack(bone, D, positions) {
  const times = [];
  const values = [];
  for (let i = 0; i < positions.length; i++) {
    times.push(KEYS[i] * D);
    values.push(positions[i][0], positions[i][1], positions[i][2]);
  }
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, values);
}

// Build a clip from a motion spec. Every clip drives the SAME bone+property set
// so the mixer can cross-fade them without leaving a stray limb posed.
function clip(name, D, s) {
  return new THREE.AnimationClip(name, D, [
    quatTrack('thighL', D, full(s.thigh)),
    quatTrack('thighR', D, half(s.thigh)),
    quatTrack('shinL', D, full(s.knee)),
    quatTrack('shinR', D, half(s.knee)),
    quatTrack('footL', D, full(s.foot)),
    quatTrack('footR', D, half(s.foot)),
    // arms swing contralaterally: the right arm leads with the LEFT leg, so it
    // takes the opposite half-cycle to the right leg (thighR = half).
    quatTrack('upperArmR', D, half(s.arm), [0, 0, -s.abduct]),
    quatTrack('upperArmL', D, full(s.arm), [0, 0, s.abduct]),
    quatTrack('lowerArmR', D, half(s.elbow)),
    quatTrack('lowerArmL', D, full(s.elbow)),
    quatTrack('spine', D, full(s.spine)),
    quatTrack('chest', D, full(s.chest)),
    quatTrack('head', D, full(s.head)),
    quatTrack('hips', D, full(s.hipsRot)),
    posTrack('hips', D, full(s.hipsPos))
  ]);
}

const WALK = {
  thigh: [[-0.45, 0, 0], [0.05, 0, 0], [0.38, 0, 0], [-0.2, 0, 0]],
  knee: [[0.12, 0, 0], [0.22, 0, 0], [0.34, 0, 0], [0.98, 0, 0]],
  foot: [[0.06, 0, 0], [-0.02, 0, 0], [0.34, 0, 0], [-0.04, 0, 0]],
  arm: [[0.34, 0, 0], [0.1, 0, 0], [-0.34, 0, 0], [-0.1, 0, 0]],
  // elbow bends the forearm FORWARD (negative X), deepest on the forward swing
  elbow: [[-0.3, 0, 0], [-0.35, 0, 0], [-0.5, 0, 0], [-0.35, 0, 0]],
  abduct: 0.1,
  spine: [[0.06, 0.05, 0], [0.06, 0, 0], [0.06, -0.05, 0], [0.06, 0, 0]],
  chest: [[0.02, -0.05, 0], [0.02, 0, 0], [0.02, 0.05, 0], [0.02, 0, 0]],
  head: [[-0.05, -0.03, 0], [-0.05, 0, 0], [-0.05, 0.03, 0], [-0.05, 0, 0]],
  hipsRot: [[0, 0.07, 0.035], [0, 0, 0], [0, -0.07, -0.035], [0, 0, 0]],
  hipsPos: [
    [0.014, HIP_Y - 0.022, 0],
    [0, HIP_Y + 0.012, 0],
    [-0.014, HIP_Y - 0.022, 0],
    [0, HIP_Y + 0.012, 0]
  ]
};

const RUN = {
  thigh: [[-0.9, 0, 0], [0.12, 0, 0], [0.68, 0, 0], [-0.55, 0, 0]],
  knee: [[0.4, 0, 0], [0.45, 0, 0], [0.6, 0, 0], [1.5, 0, 0]],
  foot: [[0.12, 0, 0], [-0.05, 0, 0], [0.5, 0, 0], [-0.12, 0, 0]],
  arm: [[0.8, 0, 0], [0.2, 0, 0], [-0.85, 0, 0], [-0.2, 0, 0]],
  // strong forward elbow bend (hands pump up in front), deepest on the drive
  elbow: [[-1.0, 0, 0], [-1.2, 0, 0], [-1.5, 0, 0], [-1.2, 0, 0]],
  abduct: 0.12,
  spine: [[0.22, 0.09, 0], [0.22, 0, 0], [0.22, -0.09, 0], [0.22, 0, 0]],
  chest: [[0.05, -0.08, 0], [0.05, 0, 0], [0.05, 0.08, 0], [0.05, 0, 0]],
  head: [[-0.18, -0.05, 0], [-0.18, 0, 0], [-0.18, 0.05, 0], [-0.18, 0, 0]],
  hipsRot: [[0, 0.13, 0.05], [0, 0, 0], [0, -0.13, -0.05], [0, 0, 0]],
  hipsPos: [
    [0.02, HIP_Y - 0.03, 0],
    [0, HIP_Y + 0.045, 0],
    [-0.02, HIP_Y - 0.03, 0],
    [0, HIP_Y + 0.045, 0]
  ]
};

const IDLE = {
  thigh: [[0.03, 0, 0], [0.04, 0, 0], [0.03, 0, 0], [0.035, 0, 0]],
  knee: [[0.08, 0, 0], [0.1, 0, 0], [0.08, 0, 0], [0.09, 0, 0]],
  foot: [[0.0, 0, 0], [0.0, 0, 0], [0.0, 0, 0], [0.0, 0, 0]],
  arm: [[0.04, 0, 0], [0.06, 0, 0], [0.04, 0, 0], [0.05, 0, 0]],
  elbow: [[-0.18, 0, 0], [-0.2, 0, 0], [-0.18, 0, 0], [-0.19, 0, 0]],
  abduct: 0.14,
  spine: [[0.04, 0, 0], [0.06, 0.01, 0], [0.04, 0, 0], [0.05, -0.01, 0]],
  chest: [[0.0, 0, 0], [0.0, 0, 0], [0.0, 0, 0], [0.0, 0, 0]],
  head: [[-0.02, 0.02, 0], [-0.02, 0, 0], [-0.02, -0.02, 0], [-0.02, 0, 0]],
  hipsRot: [[0, 0.02, 0], [0, 0, 0], [0, -0.02, 0], [0, 0, 0]],
  hipsPos: [
    [0.008, HIP_Y - 0.004, 0],
    [0, HIP_Y - 0.014, 0],
    [-0.008, HIP_Y - 0.004, 0],
    [0, HIP_Y - 0.012, 0]
  ]
};

// ---- one-shot action clips (explicit keyframes, not cyclic) ----------------

function qT(bone, times, eulers) {
  const values = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const [ex, ey, ez] of eulers) {
    e.set(ex, ey, ez, 'XYZ');
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}
function pT(bone, times, positions) {
  const values = [];
  for (const v of positions) values.push(v[0], v[1], v[2]);
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, values);
}
const kC = (bone, e) => qT(bone, [0], [e]); // constant pose

// Standing tackle — plant, lunge and poke a leg out at the ball, then recover.
function tackleClip() {
  const D = 0.5;
  const T = [0, 0.18, 0.5];
  return new THREE.AnimationClip('tackle', D, [
    pT('hips', T, [[0, HIP_Y - 0.05, 0], [0, HIP_Y - 0.12, 0.05], [0, HIP_Y - 0.05, 0]]),
    qT('spine', T, [[0.15, 0, 0], [0.35, 0, 0], [0.2, 0, 0]]),
    kC('chest', [0.05, 0, 0]),
    qT('head', T, [[-0.1, 0, 0], [0.05, 0, 0], [-0.05, 0, 0]]),
    // right leg pokes out at the ball
    qT('thighR', T, [[0, 0, 0], [-0.95, 0, 0.06], [-0.3, 0, 0]]),
    qT('shinR', T, [[0.2, 0, 0], [0.05, 0, 0], [0.3, 0, 0]]),
    qT('footR', T, [[0, 0, 0], [-0.25, 0, 0], [0, 0, 0]]),
    // left leg plants and bends
    qT('thighL', T, [[0.1, 0, 0], [0.45, 0, 0.06], [0.2, 0, 0]]),
    qT('shinL', T, [[0.2, 0, 0], [0.75, 0, 0], [0.4, 0, 0]]),
    kC('footL', [-0.1, 0, 0]),
    // arms out for balance
    qT('upperArmL', T, [[-0.2, 0, 0.45], [-0.35, 0, 0.6], [-0.2, 0, 0.45]]),
    qT('upperArmR', T, [[-0.2, 0, -0.45], [-0.35, 0, -0.6], [-0.2, 0, -0.45]]),
    kC('lowerArmL', [-0.4, 0, 0]),
    kC('lowerArmR', [-0.4, 0, 0])
  ]);
}

// Slide tackle — drop low, lean back and slide in feet-first, leading leg out.
function slideClip() {
  const D = 0.9;
  const T = [0, 0.22, 0.55, 0.9];
  return new THREE.AnimationClip('slide', D, [
    pT('hips', T, [[0, HIP_Y - 0.08, 0], [0, 0.42, 0], [0, 0.38, 0], [0, HIP_Y - 0.18, 0]]),
    qT('hips', T, [[0, 0, 0], [-0.7, 0, 0], [-0.85, 0, 0], [-0.45, 0, 0]]),
    qT('spine', T, [[0.05, 0, 0], [-0.1, 0, 0], [-0.15, 0, 0], [0.15, 0, 0]]),
    kC('chest', [0.04, 0, 0]),
    qT('head', T, [[-0.05, 0, 0], [-0.2, 0, 0], [-0.15, 0, 0], [0.05, 0, 0]]),
    // leading (right) leg extends forward
    qT('thighR', T, [[0.2, 0, 0], [-0.5, 0, 0.05], [-0.45, 0, 0.05], [0.3, 0, 0]]),
    qT('shinR', T, [[0.4, 0, 0], [0.1, 0, 0], [0.1, 0, 0], [0.6, 0, 0]]),
    kC('footR', [-0.15, 0, 0]),
    // trailing (left) leg tucks under
    qT('thighL', T, [[0.2, 0, 0], [0.7, 0, -0.05], [0.9, 0, -0.05], [0.4, 0, 0]]),
    qT('shinL', T, [[0.4, 0, 0], [1.3, 0, 0], [1.4, 0, 0], [0.8, 0, 0]]),
    kC('footL', [0.1, 0, 0]),
    // arms back/out for balance
    qT('upperArmL', T, [[0.3, 0, 0.5], [0.6, 0, 0.55], [0.7, 0, 0.55], [0.2, 0, 0.5]]),
    qT('upperArmR', T, [[0.3, 0, -0.5], [0.6, 0, -0.55], [0.7, 0, -0.55], [0.2, 0, -0.5]]),
    kC('lowerArmL', [-0.4, 0, 0]),
    kC('lowerArmR', [-0.4, 0, 0])
  ]);
}

export function buildPlayerClips() {
  return {
    idle: clip('idle', 3.4, IDLE),
    walk: clip('walk', 1.0, WALK),
    run: clip('run', 0.62, RUN),
    tackle: tackleClip(),
    slide: slideClip()
  };
}
