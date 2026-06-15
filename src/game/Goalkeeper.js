/**
 * Goalkeeper.js — a smart keeper that defends one goal (chosen by `side`).
 *
 *   side = +1 → defends the +X goal (faces −X);  side = −1 → defends −X.
 *
 * Behaviour: holds its line and shuffles onto the ball→goal angle, comes off the
 * line to narrow the angle, predicts a shot's crossing point and only reacts when
 * it's ON TARGET — diving the correct way for corners, jumping for high central
 * balls, ignoring balls going wide. Catches soft shots (then punts upfield),
 * parries hard ones, stays solid so the ball can't pass through, and in a 1-v-1
 * smothers the ball off an attacker. Saves are read from the live glove/chest
 * positions, so good positioning and big dives are rewarded.
 */

import * as THREE from 'three';
import { buildPlayerRig } from './player/PlayerRig.js';
import { buildKeeperClips } from './player/GoalkeeperAnimations.js';
import { FIELD, GOAL, BALL } from '../config.js';

const LINE_DEPTH = 0.9;
const GOAL_HALF = GOAL.WIDTH / 2;
const COVER_Z = GOAL_HALF + 0.3;
const SET_SPEED = 6.0; // quicker to get set
const REACH = 0.82; // generous glove/body reach
const DIVE_RANGE = 5.0; // can dive right into the corners
const G = 12;

const DEFAULT_KIT = {
  longSleeves: true,
  kit: { shirt: 0x16a085, shorts: 0x0b1f3a, socks: 0x16a085, glove: 0xeef1f4, boot: 0x15151a, hair: 0x1a1614 }
};

export class Goalkeeper {
  constructor({ side = 1, team = 'AWAY', name = '', kit, hairStyle } = {}) {
    this.side = side;
    this.team = team;
    this.name = name;
    this.label = 'GK';
    this.roleType = 'GK';
    this.goalX = side * FIELD.HALF_LENGTH;

    const rig = buildPlayerRig(kit ? { longSleeves: true, kit, hairStyle } : { ...DEFAULT_KIT, hairStyle });
    this.mesh = rig.mesh;
    this.mesh.name = 'Goalkeeper';
    this.bones = rig.bones;

    this.object = new THREE.Group();
    this.object.add(this.mesh);
    this.object.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // face the field
    this.position = this.object.position;

    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clips = buildKeeperClips();
    this.actions = {};
    for (const [n, c] of Object.entries(clips)) this.actions[n] = this.mixer.clipAction(c);
    for (const n of ['divePos', 'diveNeg', 'jump']) {
      this.actions[n].setLoop(THREE.LoopOnce);
      this.actions[n].clampWhenFinished = true;
    }
    this.weights = { idle: 1, shuffle: 0, divePos: 0, diveNeg: 0, jump: 0 };
    for (const [n, a] of Object.entries(this.actions)) {
      a.play();
      a.setEffectiveWeight(this.weights[n]);
    }

    this._h1 = new THREE.Vector3();
    this._h2 = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this.diveVel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.state = 'set';
    this.stateT = 0;
    this.activeDive = null;
    this.saved = false;
    this.holdT = 0;
    this.reactCooldown = 0;
    this.moveSpeed = 0;
    this.diveDur = 1.1;
    this.diveVel.set(0, 0, 0);
    this.position.set(this.goalX - this.side * LINE_DEPTH, 0, 0);
  }

  // mode: 'loose' (react + save), 'home' (smother an attacker), 'own' (just hold)
  update(dt, ball, mode = 'loose') {
    this.stateT += dt;
    this.reactCooldown = Math.max(0, this.reactCooldown - dt);
    const result = { tookPossession: false, saved: false };

    if (this.state === 'hold') {
      this.holdT -= dt;
    } else if (this.state === 'dive' || this.state === 'jump') {
      this._integrateLaunch(dt);
      if (this.stateT > this.diveDur) this._toRecover();
    } else if (this.state === 'recover') {
      if (this.stateT > 0.45) this._toSet();
    } else {
      this._setPositioning(dt, ball);
    }

    this._updateAnimation(dt);
    this.mixer.update(dt);
    this.object.updateMatrixWorld(true);

    if (this.state === 'hold') {
      this._holdBall(ball);
      if (this.holdT <= 0) {
        this._punt(ball);
        this._toSet();
      }
    } else if (this.state === 'set') {
      if (mode === 'home') {
        if (this._ballWithin(ball, 0.78)) this._smother(ball, result);
      } else if (mode === 'loose') {
        this._maybeReact(ball);
        this._tryHandSave(ball, result, dt);
        if (this.state === 'set') this._blockBody(ball);
      }
    } else if (this.state === 'dive' || this.state === 'jump') {
      if (!this.saved) this._tryHandSave(ball, result, dt);
    } else if (this.state === 'recover' && mode === 'loose') {
      this._blockBody(ball);
    }
    return result;
  }

  _setPositioning(dt, ball) {
    const s = this.side;
    const onField = (ball.position.x - this.goalX) * s < 0; // ball in front of goal
    const distToGoal = Math.abs(this.goalX - ball.position.x);
    const advance = onField && Math.abs(ball.position.z) < 16
      ? THREE.MathUtils.clamp(1 - distToGoal / 22, 0, 1) * 1.7
      : 0;
    const targetX = this.goalX - s * (LINE_DEPTH + advance);
    // stand on the ball -> goal-centre line so the shooting angle is covered,
    // instead of drifting onto the near post
    const denom = ball.position.x - this.goalX;
    let targetZ = Math.abs(denom) > 0.5
      ? ball.position.z * ((targetX - this.goalX) / denom)
      : ball.position.z * 0.4;
    targetZ = THREE.MathUtils.clamp(targetZ, -(GOAL_HALF - 0.2), GOAL_HALF - 0.2);
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const step = Math.min(d, SET_SPEED * dt);
      this.position.x += (dx / d) * step;
      this.position.z += (dz / d) * step;
      this.moveSpeed = step / dt;
    } else {
      this.moveSpeed = 0;
    }
  }

  _maybeReact(ball) {
    if (this.reactCooldown > 0) return;
    const s = this.side;
    const vx = ball.velocity.x;
    if (vx * s < 3) return; // not driven toward our goal
    if ((ball.position.x - this.goalX) * s > 0) return; // already past the line
    if ((ball.position.x - this.position.x) * s > 0.5) return; // already past us
    const t = (this.goalX - ball.position.x) / vx;
    if (t <= 0 || t > 0.95) return;

    const predZ = ball.position.z + ball.velocity.z * t;
    const predY = ball.position.y + ball.velocity.y * t - 0.5 * G * t * t;
    if (Math.abs(predZ) > GOAL_HALF + 0.7) return; // going wide — stay put

    const reachNeed = predZ - this.position.z; // at the goal line, for the in-range test
    // where the ball will actually be as it reaches the keeper's plane
    const tArrive = Math.max(0, (this.position.x - ball.position.x) / vx);
    const zAtKeeper = ball.position.z + ball.velocity.z * tArrive;
    if (predY > 1.35 && Math.abs(reachNeed) < 1.4) this._launchJump(predZ);
    else if (Math.abs(reachNeed) > 0.4 && Math.abs(reachNeed) < DIVE_RANGE) this._launchDive(zAtKeeper, tArrive);
  }

  _diveClipFor(zSign) {
    return zSign * this.side > 0 ? 'divePos' : 'diveNeg';
  }

  _launchJump(predZ) {
    this.state = 'jump';
    this.stateT = 0;
    this.saved = false;
    this.diveDur = 0.8;
    const drift = THREE.MathUtils.clamp((predZ - this.position.z) * 1.5, -3, 3);
    this.diveVel.set(-this.side * 0.8, 5.0, drift);
    this.activeDive = 'jump';
    this.actions.jump.reset();
  }

  // Dive so the GLOVE (which extends ~0.5 m past the body) meets the ball at the
  // moment it reaches the keeper — timed to arrival so it doesn't overshoot.
  _launchDive(zAtKeeper, tArrive) {
    const s = this.side;
    const diveSign = Math.sign(zAtKeeper - this.position.z) || 1;
    const targetBodyZ = zAtKeeper - 0.5 * diveSign; // glove reach offset
    const need = targetBodyZ - this.position.z;
    this.state = 'dive';
    this.stateT = 0;
    this.saved = false;
    this.diveDur = 1.1;
    this.diveVel.set(-s * 1.2, 2.7, THREE.MathUtils.clamp(need / Math.max(0.26, tArrive), -11, 11));
    this.activeDive = this._diveClipFor(diveSign);
    this.actions[this.activeDive].reset();
  }

  _integrateLaunch(dt) {
    this.diveVel.y -= G * dt;
    this.position.x += this.diveVel.x * dt;
    this.position.y += this.diveVel.y * dt;
    this.position.z += this.diveVel.z * dt;
    if (this.position.y < 0) {
      this.position.y = 0;
      this.diveVel.y = 0;
      this.diveVel.x *= 0.6;
      this.diveVel.z *= 0.6;
    }
  }

  _toRecover() {
    this.state = 'recover';
    this.stateT = 0;
    this.position.y = 0;
    this.diveVel.set(0, 0, 0);
    this.reactCooldown = 0.6;
  }

  _toSet() {
    this.state = 'set';
    this.stateT = 0;
    this.activeDive = null;
    this.saved = false;
    this.position.y = 0;
  }

  _ballSegDist(pt, ball, dt) {
    const ax = ball.position.x, ay = ball.position.y, az = ball.position.z;
    const dx = ball.velocity.x * dt, dy = ball.velocity.y * dt, dz = ball.velocity.z * dt;
    const len2 = dx * dx + dy * dy + dz * dz;
    let tt = 0;
    if (len2 > 1e-9) {
      tt = ((pt.x - ax) * dx + (pt.y - ay) * dy + (pt.z - az) * dz) / len2;
      tt = Math.max(0, Math.min(1, tt));
    }
    return Math.hypot(pt.x - (ax + dx * tt), pt.y - (ay + dy * tt), pt.z - (az + dz * tt));
  }

  _ballSegDistXZ(px, pz, ball, dt) {
    const ax = ball.position.x, az = ball.position.z;
    const dx = ball.velocity.x * dt, dz = ball.velocity.z * dt;
    const len2 = dx * dx + dz * dz;
    let tt = 0;
    if (len2 > 1e-9) {
      tt = ((px - ax) * dx + (pz - az) * dz) / len2;
      tt = Math.max(0, Math.min(1, tt));
    }
    return Math.hypot(px - (ax + dx * tt), pz - (az + dz * tt));
  }

  _tryHandSave(ball, result, dt = 1 / 60) {
    const s = this.side;
    if ((ball.position.x - this.goalX) * s > 0.4) return; // behind the line
    if ((ball.position.x - this.position.x) * s < -2.5) return; // too far in front
    this.bones.handL.getWorldPosition(this._h1);
    this.bones.handR.getWorldPosition(this._h2);
    this.bones.chest.getWorldPosition(this._c);
    const dHands = Math.min(this._ballSegDist(this._h1, ball, dt), this._ballSegDist(this._h2, ball, dt));
    const dBody = this._ballSegDist(this._c, ball, dt);
    const dBlock = this._ballSegDistXZ(this.position.x, this.position.z, ball, dt);
    const blocked = dBlock < 0.48 && ball.position.y < 1.95;
    if (dHands < REACH || dBody < REACH * 0.85 || blocked) {
      this.saved = true;
      result.saved = true;
      if (ball.velocity.length() < 16) this._catch(ball);
      else this._parry(ball);
    }
  }

  _blockBody(ball) {
    if (ball.position.y > 2.0) return;
    const minD = BALL.RADIUS + 0.4;
    const dx = ball.position.x - this.position.x;
    const dz = ball.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < minD && d > 1e-4) {
      const nx = dx / d, nz = dz / d;
      ball.position.x = this.position.x + nx * minD;
      ball.position.z = this.position.z + nz * minD;
      const vn = ball.velocity.x * nx + ball.velocity.z * nz;
      if (vn < 0) {
        ball.velocity.x -= 1.6 * vn * nx;
        ball.velocity.z -= 1.6 * vn * nz;
      }
      ball.syncMesh();
    }
  }

  _catch(ball) {
    this.state = 'hold';
    this.stateT = 0;
    this.holdT = 0.9;
    this.diveVel.set(0, 0, 0);
    this.position.y = 0;
    ball.velocity.set(0, 0, 0);
    ball.angularVelocity.set(0, 0, 0);
  }

  _parry(ball) {
    const s = this.side;
    const zside = this._c.z >= ball.position.z ? -1 : 1;
    ball.velocity.set(-s * (Math.abs(ball.velocity.x) * 0.45 + 3), 3.5, zside * 4 + ball.velocity.z * 0.2);
    ball.angularVelocity.set(0, 0, 0);
    if (s > 0) ball.position.x = Math.min(ball.position.x, this.goalX - BALL.RADIUS - 0.05);
    else ball.position.x = Math.max(ball.position.x, this.goalX + BALL.RADIUS + 0.05);
  }

  _smother(ball, result) {
    result.tookPossession = true;
    this._catch(ball);
  }

  _ballWithin(ball, r) {
    return Math.hypot(ball.position.x - this.position.x, ball.position.z - this.position.z) < r;
  }

  _holdBall(ball) {
    ball.position.set(this.position.x - this.side * 0.32, 0.75, this.position.z);
    ball.velocity.set(0, 0, 0);
    ball.syncMesh();
  }

  _punt(ball) {
    ball.position.set(this.position.x - this.side * 0.4, 0.6, this.position.z);
    ball.velocity.set(-this.side * 16, 7, (Math.random() - 0.5) * 6);
    ball.angularVelocity.set(0, 0, 0);
    ball.syncMesh();
  }

  _updateAnimation(dt) {
    const w = { idle: 0, shuffle: 0, divePos: 0, diveNeg: 0, jump: 0 };
    if (this.state === 'dive' || this.state === 'jump') {
      w[this.activeDive] = 1;
    } else if (this.state === 'set' || this.state === 'hold') {
      const sh = THREE.MathUtils.clamp(this.moveSpeed / 2.5, 0, 1);
      w.idle = 1 - sh;
      w.shuffle = sh;
    } else {
      w.idle = 1;
    }
    const kk = 1 - Math.exp(-16 * dt);
    for (const name of Object.keys(this.weights)) {
      this.weights[name] += (w[name] - this.weights[name]) * kk;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }
  }

  get holding() {
    return this.state === 'hold';
  }
}
