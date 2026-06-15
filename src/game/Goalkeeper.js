/**
 * Goalkeeper.js — a smart keeper for the AWAY side, defending the +X goal.
 *
 * Behaviour:
 *   • Holds its line and shuffles to stay on the ball→goal angle, coming off
 *     the line to narrow the angle as the ball approaches.
 *   • Predicts a shot's crossing point and only reacts when it's ON TARGET:
 *     dives to the correct side for corners, jumps for high central balls, and
 *     ignores anything going wide.
 *   • Catches soft shots (then punts upfield) and parries hard ones; in a 1‑v‑1
 *     it smothers the ball off the dribbler.
 *
 * It reuses the shared rig (PlayerRig) in a keeper kit and its own authored
 * clips (GoalkeeperAnimations). Saves are detected from the live world position
 * of the gloves and chest, so good positioning and big dives are rewarded.
 */

import * as THREE from 'three';
import { buildPlayerRig } from './player/PlayerRig.js';
import { buildKeeperClips } from './player/GoalkeeperAnimations.js';
import { FIELD, GOAL, BALL } from '../config.js';

const GOAL_X = FIELD.HALF_LENGTH; // the goal line the keeper defends (+X)
const LINE_DEPTH = 0.9; // how far off the line it sets by default
const GOAL_HALF = GOAL.WIDTH / 2; // 3.66
const COVER_Z = GOAL_HALF + 0.3; // lateral coverage limit
const SET_SPEED = 4.5; // positioning speed
const REACT_SPEED = 7.5; // quick step to cover a near shot
const REACH = 0.6; // save radius around each glove / chest
const DIVE_RANGE = 3.3; // max lateral distance it will dive
const G = 12;

const KEEPER_OPTS = {
  longSleeves: true,
  kit: {
    shirt: 0x16a085, // teal keeper top, distinct from both teams
    shorts: 0x0b1f3a,
    socks: 0x16a085,
    glove: 0xeef1f4,
    boot: 0x15151a,
    hair: 0x1a1614
  }
};

export class Goalkeeper {
  constructor() {
    const rig = buildPlayerRig(KEEPER_OPTS);
    this.mesh = rig.mesh;
    this.mesh.name = 'Goalkeeper';
    this.bones = rig.bones;

    this.object = new THREE.Group();
    this.object.add(this.mesh);
    this.object.rotation.y = -Math.PI / 2; // face −X, toward the field
    this.position = this.object.position;

    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clips = buildKeeperClips();
    this.actions = {};
    for (const [name, c] of Object.entries(clips)) this.actions[name] = this.mixer.clipAction(c);
    for (const name of ['divePos', 'diveNeg', 'jump']) {
      this.actions[name].setLoop(THREE.LoopOnce);
      this.actions[name].clampWhenFinished = true;
    }
    this.weights = { idle: 1, shuffle: 0, divePos: 0, diveNeg: 0, jump: 0 };
    for (const [name, a] of Object.entries(this.actions)) {
      a.play();
      a.setEffectiveWeight(this.weights[name]);
    }

    this._h1 = new THREE.Vector3();
    this._h2 = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this.diveVel = new THREE.Vector3();

    this.reset();
  }

  reset() {
    this.state = 'set'; // set | dive | jump | recover | hold
    this.stateT = 0;
    this.activeDive = null;
    this.saved = false;
    this.holdT = 0;
    this.reactCooldown = 0;
    this.moveSpeed = 0;
    this.diveDur = 0.72;
    this.diveVel.set(0, 0, 0);
    this.position.set(GOAL_X - LINE_DEPTH, 0, 0);
  }

  // --- main update --------------------------------------------------------

  // mode: 'loose' (react + save), 'home' (smother a dribbler), 'own' (just hold)
  update(dt, ball, mode = 'loose') {
    this.stateT += dt;
    this.reactCooldown = Math.max(0, this.reactCooldown - dt);
    const result = { tookPossession: false, saved: false };

    // 1) move the keeper / advance the active action
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

    // 2) blend + advance the animation, then refresh world matrices
    this._updateAnimation(dt);
    this.mixer.update(dt);
    this.object.updateMatrixWorld(true);

    // 3) interact with the ball using the freshly posed gloves
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
        if (this.state === 'set') this._blockBody(ball); // still up: stay solid
      }
    } else if (this.state === 'dive' || this.state === 'jump') {
      if (!this.saved) this._tryHandSave(ball, result, dt);
    } else if (this.state === 'recover' && mode === 'loose') {
      this._blockBody(ball);
    }
    return result;
  }

  // The keeper's torso/legs are solid — a loose ball can never pass through it.
  _blockBody(ball) {
    if (ball.position.y > 2.0) return; // ball is over the keeper's head
    const minD = BALL.RADIUS + 0.4; // body radius
    const dx = ball.position.x - this.position.x;
    const dz = ball.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < minD && d > 1e-4) {
      const nx = dx / d;
      const nz = dz / d;
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

  // --- positioning --------------------------------------------------------

  _setPositioning(dt, ball) {
    const onTarget = ball.position.x < GOAL_X && ball.position.x > 2;
    const distToGoal = GOAL_X - ball.position.x;
    // come off the line a touch to narrow the angle only when the ball is close
    // and central — otherwise hold the line so it stands planted in the goal
    const advance = onTarget && Math.abs(ball.position.z) < 12
      ? THREE.MathUtils.clamp(1 - distToGoal / 18, 0, 1) * 1.4
      : 0;
    const targetX = GOAL_X - (LINE_DEPTH + advance);
    const targetZ = THREE.MathUtils.clamp(ball.position.z * 0.85, -COVER_Z, COVER_Z);

    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const d = Math.hypot(dx, dz);
    const speed = SET_SPEED;
    if (d > 1e-3) {
      const step = Math.min(d, speed * dt);
      this.position.x += (dx / d) * step;
      this.position.z += (dz / d) * step;
      this.moveSpeed = step / dt;
    } else {
      this.moveSpeed = 0;
    }
  }

  // --- shot reaction ------------------------------------------------------

  _maybeReact(ball) {
    if (this.reactCooldown > 0) return;
    const vx = ball.velocity.x;
    if (vx < 3) return; // not driven toward our goal (which is at +X)
    // attackers come from lower X; ignore balls already past the keeper
    if (ball.position.x > GOAL_X || ball.position.x > this.position.x + 0.5) return;
    const t = (GOAL_X - ball.position.x) / vx;
    // react only once the ball is close enough that the dive meets it
    if (t <= 0 || t > 0.85) return;

    const predZ = ball.position.z + ball.velocity.z * t;
    const predY = ball.position.y + ball.velocity.y * t - 0.5 * G * t * t;
    if (Math.abs(predZ) > GOAL_HALF + 0.7) return; // going wide — stay put (smart)

    const need = predZ - this.position.z;
    if (predY > 1.35 && Math.abs(need) < 1.3) {
      this._launch('jump', 0, predZ);
    } else if (Math.abs(need) > 0.55 && Math.abs(need) < DIVE_RANGE) {
      this._launch(need > 0 ? 'divePos' : 'diveNeg', Math.sign(need), predZ);
    }
    // otherwise it's reachable standing — positioning already tracks predZ-ish
  }

  _launch(kind, side, predZ) {
    this.stateT = 0;
    this.saved = false;
    if (kind === 'jump') {
      this.state = 'jump';
      this.diveDur = 0.8;
      // a real leap: apex (~0.42s) lines up with the clip's overhead reach,
      // drifting toward the ball if it's a touch off-centre
      const drift = THREE.MathUtils.clamp((predZ - this.position.z) * 1.5, -3, 3);
      this.diveVel.set(-0.8, 5.0, drift);
      this.activeDive = 'jump';
      this.actions.jump.reset();
    } else {
      this.state = 'dive';
      this.diveDur = 0.95; // stay extended long enough to meet the ball
      // launch to roughly reach the predicted spot over the dive (don't overshoot)
      const need = predZ - this.position.z;
      this.diveVel.set(-1.2, 2.6, THREE.MathUtils.clamp(need * 2.2, -7, 7));
      this.activeDive = kind;
      this.actions[kind].reset();
    }
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

  // --- saves / possession -------------------------------------------------

  // Distance from point `pt` to the ball's swept segment this frame.
  _ballSegDist(pt, ball, dt) {
    const ax = ball.position.x;
    const ay = ball.position.y;
    const az = ball.position.z;
    const bx = ax + ball.velocity.x * dt;
    const by = ay + ball.velocity.y * dt;
    const bz = az + ball.velocity.z * dt;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let tt = 0;
    if (len2 > 1e-9) {
      tt = ((pt.x - ax) * dx + (pt.y - ay) * dy + (pt.z - az) * dz) / len2;
      tt = Math.max(0, Math.min(1, tt));
    }
    return Math.hypot(pt.x - (ax + dx * tt), pt.y - (ay + dy * tt), pt.z - (az + dz * tt));
  }

  // Horizontal (XZ) distance from a point to the ball's swept path this frame.
  _ballSegDistXZ(px, pz, ball, dt) {
    const ax = ball.position.x;
    const az = ball.position.z;
    const dx = ball.velocity.x * dt;
    const dz = ball.velocity.z * dt;
    const len2 = dx * dx + dz * dz;
    let tt = 0;
    if (len2 > 1e-9) {
      tt = ((px - ax) * dx + (pz - az) * dz) / len2;
      tt = Math.max(0, Math.min(1, tt));
    }
    return Math.hypot(px - (ax + dx * tt), pz - (az + dz * tt));
  }

  _tryHandSave(ball, result, dt = 1 / 60) {
    // only threats in front of the goal
    if (ball.position.x > GOAL_X + 0.4 || ball.position.x < this.position.x - 2.5) return;
    this.bones.handL.getWorldPosition(this._h1);
    this.bones.handR.getWorldPosition(this._h2);
    this.bones.chest.getWorldPosition(this._c);
    const dHands = Math.min(this._ballSegDist(this._h1, ball, dt), this._ballSegDist(this._h2, ball, dt));
    const dBody = this._ballSegDist(this._c, ball, dt);
    // the torso / legs block a ball that reaches the keeper at any height
    const dBlock = this._ballSegDistXZ(this.position.x, this.position.z, ball, dt);
    const blocked = dBlock < 0.48 && ball.position.y < 1.95;
    if (dHands < REACH || dBody < REACH * 0.85 || blocked) {
      this.saved = true;
      result.saved = true;
      const speed = ball.velocity.length();
      if (speed < 16) {
        this._catch(ball);
      } else {
        this._parry(ball);
      }
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
    // push the ball back into play, away from goal and out to the nearer side
    const side = this._c.z >= ball.position.z ? -1 : 1;
    ball.velocity.set(-Math.abs(ball.velocity.x) * 0.45 - 3, 3.5, side * 4 + ball.velocity.z * 0.2);
    ball.angularVelocity.set(0, 0, 0);
    ball.position.x = Math.min(ball.position.x, GOAL_X - BALL.RADIUS - 0.05);
  }

  _smother(ball, result) {
    result.tookPossession = true;
    this._catch(ball);
  }

  _ballWithin(ball, r) {
    return Math.hypot(ball.position.x - this.position.x, ball.position.z - this.position.z) < r;
  }

  _holdBall(ball) {
    // tuck the ball in front of the keeper (it faces −X)
    ball.position.set(this.position.x - 0.32, 0.75, this.position.z);
    ball.velocity.set(0, 0, 0);
    ball.syncMesh();
  }

  _punt(ball) {
    ball.position.set(this.position.x - 0.4, 0.6, this.position.z);
    ball.velocity.set(-16, 7, (Math.random() - 0.5) * 6);
    ball.angularVelocity.set(0, 0, 0);
    ball.syncMesh();
  }

  // --- animation blend ----------------------------------------------------

  _updateAnimation(dt) {
    const w = { idle: 0, shuffle: 0, divePos: 0, diveNeg: 0, jump: 0 };
    if (this.state === 'dive' || this.state === 'jump') {
      w[this.activeDive] = 1;
    } else if (this.state === 'set' || this.state === 'hold') {
      const sh = THREE.MathUtils.clamp(this.moveSpeed / 2.5, 0, 1);
      w.idle = 1 - sh;
      w.shuffle = sh;
    } else {
      // recover — blend the clamped dive/jump pose back to the ready stance
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
