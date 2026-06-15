/**
 * GoalkeeperAnimations.js — the keeper's authored clip set (the "art").
 *
 * A keeper moves nothing like an outfield player, so it gets its own poses:
 *   • idle    — low, square ready stance, weight forward, arms spread and out
 *   • shuffle — quick square side-steps along the line
 *   • divePos — explosive dive toward +Z (the model's local +X side)
 *   • diveNeg — the mirror dive toward −Z
 *   • jump    — vertical leap, arms thrust overhead for crosses / lobs
 *
 * One-shot clips (dive / jump) are played LoopOnce + clamped; the get-up is the
 * mixer blending that clamped pose back to the ready stance. Pose convention:
 * model faces +Z, +Y up. Arm abduction is a Z rotation; a body tip toward +X is
 * a negative Z roll of the hips; arms overhead is a negative X rotation.
 */

import * as THREE from 'three';

const HIP_Y = 1.0;

function q(bone, times, eulers, off = [0, 0, 0]) {
  const vals = [];
  const e = new THREE.Euler();
  const qq = new THREE.Quaternion();
  for (let i = 0; i < times.length; i++) {
    e.set(eulers[i][0] + off[0], eulers[i][1] + off[1], eulers[i][2] + off[2], 'XYZ');
    qq.setFromEuler(e);
    vals.push(qq.x, qq.y, qq.z, qq.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, vals);
}
function p(bone, times, positions) {
  const vals = [];
  for (const v of positions) vals.push(v[0], v[1], v[2]);
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, vals);
}
const k = (bone, e) => q(bone, [0], [e]); // constant pose
const clip = (name, D, tracks) => new THREE.AnimationClip(name, D, tracks);

function idleClip() {
  const D = 2.4;
  return clip('idle', D, [
    p('hips', [0, 0.8, 1.6, 2.4], [
      [0.012, HIP_Y - 0.13, 0], [0, HIP_Y - 0.11, 0],
      [-0.012, HIP_Y - 0.13, 0], [0.012, HIP_Y - 0.13, 0]
    ]),
    q('hips', [0, 1.2, 2.4], [[0, 0.03, 0], [0, -0.03, 0], [0, 0.03, 0]]),
    q('spine', [0, 1.2, 2.4], [[0.27, 0.03, 0], [0.3, 0, 0], [0.27, 0.03, 0]]),
    k('chest', [0.08, 0, 0]),
    q('head', [0, 1.2, 2.4], [[-0.22, 0.04, 0], [-0.22, -0.03, 0], [-0.22, 0.04, 0]]),
    k('thighL', [0.42, 0, 0.16]),
    k('thighR', [0.42, 0, -0.16]),
    k('shinL', [0.66, 0, 0]),
    k('shinR', [0.66, 0, 0]),
    k('footL', [-0.2, 0, 0]),
    k('footR', [-0.2, 0, 0]),
    q('upperArmL', [0, 1.2, 2.4], [[-0.28, 0, 0.72], [-0.22, 0, 0.66], [-0.28, 0, 0.72]]),
    q('upperArmR', [0, 1.2, 2.4], [[-0.28, 0, -0.72], [-0.22, 0, -0.66], [-0.28, 0, -0.72]]),
    k('lowerArmL', [-0.7, 0, 0]),
    k('lowerArmR', [-0.7, 0, 0])
  ]);
}

function shuffleClip() {
  const D = 0.5;
  const T = [0, 0.25, 0.5];
  return clip('shuffle', D, [
    p('hips', T, [[0.03, HIP_Y - 0.12, 0], [-0.03, HIP_Y - 0.1, 0], [0.03, HIP_Y - 0.12, 0]]),
    k('spine', [0.26, 0, 0]),
    k('chest', [0.08, 0, 0]),
    k('head', [-0.2, 0, 0]),
    q('thighL', T, [[0.5, 0, 0.16], [0.34, 0, 0.16], [0.5, 0, 0.16]]),
    q('thighR', T, [[0.34, 0, -0.16], [0.5, 0, -0.16], [0.34, 0, -0.16]]),
    q('shinL', T, [[0.72, 0, 0], [0.5, 0, 0], [0.72, 0, 0]]),
    q('shinR', T, [[0.5, 0, 0], [0.72, 0, 0], [0.5, 0, 0]]),
    k('footL', [-0.2, 0, 0]),
    k('footR', [-0.2, 0, 0]),
    k('upperArmL', [-0.3, 0, 0.78]),
    k('upperArmR', [-0.3, 0, -0.78]),
    k('lowerArmL', [-0.75, 0, 0]),
    k('lowerArmR', [-0.75, 0, 0])
  ]);
}

// side = +1 dives toward +X (world +Z), -1 mirrors toward −X (world −Z).
function diveClip(name, side) {
  const s = side;
  const D = 0.72;
  const T = [0, 0.32, 0.72];
  return clip(name, D, [
    // hips roll the body horizontal toward the dive side, dropping low
    q('hips', T, [[0, 0, -s * 0.25], [0, 0, -s * 1.15], [0, 0, -s * 1.32]]),
    p('hips', T, [[s * 0.05, HIP_Y - 0.12, 0], [s * 0.12, 0.6, 0], [s * 0.14, 0.5, 0]]),
    q('spine', T, [[0.05, 0, -s * 0.05], [0.06, 0, -s * 0.12], [0.06, 0, -s * 0.15]]),
    k('chest', [0.04, 0, 0]),
    q('head', T, [[-0.1, 0, s * 0.1], [-0.05, 0, s * 0.22], [-0.05, 0, s * 0.25]]),
    // both arms reach toward the ball (ez → s·1.5)
    q('upperArmL', T, [[-0.25, 0, 0.6], [-0.15, 0, s * 1.5], [-0.1, 0, s * 1.55]]),
    q('upperArmR', T, [[-0.25, 0, -0.6], [-0.15, 0, s * 1.4], [-0.1, 0, s * 1.45]]),
    q('lowerArmL', T, [[-0.7, 0, 0], [-0.2, 0, 0], [-0.12, 0, 0]]),
    q('lowerArmR', T, [[-0.7, 0, 0], [-0.2, 0, 0], [-0.12, 0, 0]]),
    // legs trail and extend
    q('thighL', T, [[0.4, 0, 0.16], [-0.1, 0, s * 0.05], [-0.15, 0, s * 0.05]]),
    q('thighR', T, [[0.4, 0, -0.16], [-0.1, 0, s * 0.05], [-0.15, 0, s * 0.05]]),
    q('shinL', T, [[0.65, 0, 0], [0.3, 0, 0], [0.25, 0, 0]]),
    q('shinR', T, [[0.65, 0, 0], [0.3, 0, 0], [0.25, 0, 0]]),
    k('footL', [0.1, 0, 0]),
    k('footR', [0.1, 0, 0])
  ]);
}

function jumpClip() {
  const D = 0.8;
  const T = [0, 0.22, 0.42, 0.8];
  return clip('jump', D, [
    // deep crouch -> explosive extension -> overhead reach -> land
    p('hips', T, [[0, HIP_Y - 0.2, 0], [0, HIP_Y - 0.02, 0], [0, HIP_Y + 0.06, 0], [0, HIP_Y - 0.08, 0]]),
    k('hips', [0, 0, 0]),
    q('spine', T, [[0.26, 0, 0], [0.08, 0, 0], [-0.02, 0, 0], [0.2, 0, 0]]),
    k('chest', [0.05, 0, 0]),
    q('head', T, [[-0.05, 0, 0], [-0.18, 0, 0], [-0.26, 0, 0], [-0.1, 0, 0]]),
    q('upperArmL', T, [[0.45, 0, 0.35], [-1.7, 0, 0.2], [-2.75, 0, 0.12], [-0.7, 0, 0.45]]),
    q('upperArmR', T, [[0.45, 0, -0.35], [-1.7, 0, -0.2], [-2.75, 0, -0.12], [-0.7, 0, -0.45]]),
    q('lowerArmL', T, [[-0.6, 0, 0], [-0.25, 0, 0], [-0.08, 0, 0], [-0.45, 0, 0]]),
    q('lowerArmR', T, [[-0.6, 0, 0], [-0.25, 0, 0], [-0.08, 0, 0], [-0.45, 0, 0]]),
    q('thighL', T, [[0.7, 0, 0.14], [-0.1, 0, 0.1], [0.32, 0, 0.12], [0.6, 0, 0.14]]),
    q('thighR', T, [[0.7, 0, -0.14], [-0.1, 0, -0.1], [0.32, 0, -0.12], [0.6, 0, -0.14]]),
    q('shinL', T, [[1.2, 0, 0], [0.2, 0, 0], [0.7, 0, 0], [1.0, 0, 0]]),
    q('shinR', T, [[1.2, 0, 0], [0.2, 0, 0], [0.7, 0, 0], [1.0, 0, 0]]),
    k('footL', [0.15, 0, 0]),
    k('footR', [0.15, 0, 0])
  ]);
}

export function buildKeeperClips() {
  return {
    idle: idleClip(),
    shuffle: shuffleClip(),
    divePos: diveClip('divePos', 1),
    diveNeg: diveClip('diveNeg', -1),
    jump: jumpClip()
  };
}
