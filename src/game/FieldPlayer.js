/**
 * FieldPlayer.js — a reusable outfield player (either user-controlled or AI).
 *
 * Wraps the shared rig (PlayerRig) in a team kit and the shared clips
 * (idle/walk/run + tackle/slide) behind an AnimationMixer. Exposes simple
 * locomotion (ease to target, face the run, blend clips by speed) plus one-shot
 * tackle and slide states with a brief recovery, so the same class powers your
 * controlled player, your teammate and the opponent defender.
 */

import * as THREE from 'three';
import { buildPlayerRig } from './player/PlayerRig.js';
import { buildPlayerClips } from './player/PlayerAnimations.js';

const WALK_SPEED = 2.2;
const RUN_SPEED = 7.0;
const ACCEL = 16;
const TURN_RATE = 11;
const WALK_REF = 1.5;
const RUN_REF = 6.0;

const TACKLE_DUR = 0.5;
const SLIDE_DUR = 0.9;
const DOWN_DUR = 0.4;

export class FieldPlayer {
  constructor({ team = 'HOME', role = 'MF', kit, hairStyle, name = '', label = '', number = 0, homePos } = {}) {
    const rig = buildPlayerRig({ kit, hairStyle });
    this.mesh = rig.mesh;
    this.bones = rig.bones;
    this.object = new THREE.Group();
    this.object.add(this.mesh);

    this.team = team;
    this.roleType = role; // 'DF' | 'MF' | 'FW'
    this.name = name;
    this.label = label;
    this.number = number;
    this.homePos = new THREE.Vector3(homePos ? homePos.x : 0, 0, homePos ? homePos.z : 0);
    this.position = this.object.position; // feet origin
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.captureCooldown = 0;
    this.carrying = false; // dribbling the ball slows you down a touch

    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clips = buildPlayerClips();
    this.actions = {};
    for (const [name, c] of Object.entries(clips)) this.actions[name] = this.mixer.clipAction(c);
    for (const name of ['tackle', 'slide']) {
      this.actions[name].setLoop(THREE.LoopOnce);
      this.actions[name].clampWhenFinished = true;
    }
    this.weights = { idle: 1, walk: 0, run: 0, tackle: 0, slide: 0 };
    for (const [name, a] of Object.entries(this.actions)) {
      a.play();
      a.setEffectiveWeight(this.weights[name]);
    }

    this.state = 'loco'; // loco | tackle | slide | down
    this.stateT = 0;
    this._won = false; // has this tackle already won the ball?
    this._tmp = new THREE.Vector3();
  }

  reset(x = 0, z = 0, heading = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this.state = 'loco';
    this.stateT = 0;
    this.captureCooldown = 0;
    this.object.rotation.y = heading;
  }

  forward() {
    return this._tmp.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  startTackle() {
    if (this.state !== 'loco') return false;
    this.state = 'tackle';
    this.stateT = 0;
    this._won = false;
    this.actions.tackle.reset();
    const f = this.forward();
    this.velocity.set(f.x * 4.5, 0, f.z * 4.5); // a committed lunge at the ball
    return true;
  }

  startSlide() {
    if (this.state !== 'loco') return false;
    this.state = 'slide';
    this.stateT = 0;
    this._won = false;
    this.actions.slide.reset();
    const f = this.forward();
    this.velocity.set(f.x * 9, 0, f.z * 9);
    return true;
  }

  // is the tackle/slide in its active ball-winning window?
  isLunging() {
    if (this.state === 'tackle') return this.stateT > 0.04 && this.stateT < 0.4;
    if (this.state === 'slide') return this.stateT > 0.04 && this.stateT < 0.72;
    return false;
  }
  actionReach() {
    return this.state === 'slide' ? 1.25 : 1.1;
  }
  get busy() {
    return this.state !== 'loco';
  }

  update(dt, moveDir, sprint) {
    this.stateT += dt;
    this.captureCooldown = Math.max(0, this.captureCooldown - dt);

    if (this.state === 'tackle') {
      this._coast(dt, 0.86);
      if (this.stateT > TACKLE_DUR) this._toLoco();
    } else if (this.state === 'slide') {
      this._coast(dt, 0.95);
      if (this.stateT > SLIDE_DUR) { this.state = 'down'; this.stateT = 0; }
    } else if (this.state === 'down') {
      this._coast(dt, 0.8);
      if (this.stateT > DOWN_DUR) this._toLoco();
    } else {
      this._loco(dt, moveDir, sprint);
    }

    this.object.rotation.y = this.heading;
    this._animate(dt);
    this.mixer.update(dt);
  }

  _toLoco() {
    this.state = 'loco';
    this.stateT = 0;
  }

  _coast(dt, damp) {
    const k = Math.pow(damp, dt * 60);
    this.velocity.x *= k;
    this.velocity.z *= k;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
  }

  _loco(dt, moveDir, sprint) {
    const wants = moveDir && moveDir.lengthSq() > 1e-4;
    let top = sprint ? RUN_SPEED : WALK_SPEED * 1.7;
    if (this.carrying) top *= 0.85; // a player on the ball runs 15% slower
    const target = this._tmp.set(0, 0, 0);
    if (wants) target.copy(moveDir).setY(0).normalize().multiplyScalar(top);
    const blend = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (target.x - this.velocity.x) * blend;
    this.velocity.z += (target.z - this.velocity.z) * blend;
    if (this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.15) {
      const desired = Math.atan2(this.velocity.x, this.velocity.z);
      let d = desired - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, TURN_RATE * dt);
    }
  }

  _animate(dt) {
    const w = { idle: 0, walk: 0, run: 0, tackle: 0, slide: 0 };
    if (this.state === 'tackle') {
      w.tackle = 1;
    } else if (this.state === 'slide') {
      w.slide = 1;
    } else if (this.state === 'down') {
      w.idle = 1; // blends the clamped slide pose back to standing — the get-up
    } else {
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      if (sp <= 0.06) {
        w.idle = 1;
      } else if (sp < WALK_SPEED) {
        const t = sp / WALK_SPEED;
        w.idle = 1 - t;
        w.walk = t;
      } else {
        // reach a full run a bit before top speed so it doesn't read as a jog
        const t = Math.min(1, (sp - WALK_SPEED) / (5.6 - WALK_SPEED));
        w.walk = 1 - t;
        w.run = t;
      }
      this.actions.walk.timeScale = THREE.MathUtils.clamp(sp / WALK_REF, 0.6, 1.7);
      this.actions.run.timeScale = THREE.MathUtils.clamp(sp / RUN_REF, 0.75, 1.5);
    }
    const k = 1 - Math.exp(-14 * dt);
    for (const name of Object.keys(this.weights)) {
      this.weights[name] += (w[name] - this.weights[name]) * k;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }
  }
}
