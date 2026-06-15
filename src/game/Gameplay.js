/**
 * Gameplay.js — input, ball control and match state.
 *
 *   • Hold-and-release the mouse to take a charged shot toward the cursor.
 *   • WASD / arrows dribble the ball (camera-relative).
 *   • Space lofts the ball, R resets, kickoff happens after every goal.
 */

import * as THREE from 'three';
import { Physics } from './Physics.js';
import { BALL, TEAMS } from '../config.js';

export class Gameplay {
  constructor(ball, cameraRig, dom, hud) {
    this.ball = ball;
    this.rig = cameraRig;
    this.dom = dom;
    this.hud = hud;
    this.physics = new Physics();

    this.score = { HOME: 0, AWAY: 0 };
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pointer = new THREE.Vector2();
    this.charging = false;
    this.charge = 0;
    this.celebrateT = 0;

    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'r') this.kickoff();
      if (k === ' ') {
        this.ball.velocity.y += 6.5;
        this.ball.velocity.x += this.forwardKick().x * 4;
        this.ball.velocity.z += this.forwardKick().z * 4;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.rig.mode === 'orbit') return;
      this.charging = true;
      this.charge = 0;
      this.updatePointer(e);
    });
    addEventListener('pointermove', (e) => this.updatePointer(e));
    addEventListener('pointerup', (e) => {
      if (!this.charging || e.button !== 0) return;
      this.charging = false;
      this.shoot();
      this.hud.setPower(0);
    });
  }

  updatePointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  forwardKick() {
    // ground-projected camera forward
    const dir = new THREE.Vector3();
    this.rig.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    return dir.normalize();
  }

  shoot() {
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return;
    const dir = hit.sub(this.ball.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    const power = THREE.MathUtils.lerp(9, 34, this.charge);
    this.ball.velocity.x = dir.x * power;
    this.ball.velocity.z = dir.z * power;
    this.ball.velocity.y = Math.max(this.ball.velocity.y, power * 0.22);
  }

  dribble(dt) {
    const f = this.forwardKick();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const accel = new THREE.Vector3();
    if (this.keys.has('w') || this.keys.has('arrowup')) accel.add(f);
    if (this.keys.has('s') || this.keys.has('arrowdown')) accel.sub(f);
    if (this.keys.has('d') || this.keys.has('arrowright')) accel.sub(right);
    if (this.keys.has('a') || this.keys.has('arrowleft')) accel.add(right);
    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(24 * dt);
      this.ball.velocity.x += accel.x;
      this.ball.velocity.z += accel.z;
    }
  }

  kickoff() {
    this.ball.reset(0, 0);
    this.celebrateT = 0;
    this.hud.hideGoal();
  }

  update(dt) {
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt * 0.9);
      this.hud.setPower(this.charge);
    }
    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      if (this.celebrateT <= 0) this.kickoff();
    } else {
      this.dribble(dt);
    }

    const event = this.physics.step(this.ball, dt);
    if (event && this.celebrateT <= 0) this.onGoal(event.scorer);

    this.hud.setSpeed(this.ball.velocity.length());
  }

  onGoal(scorer) {
    this.score[scorer]++;
    this.hud.setScore(this.score.HOME, this.score.AWAY);
    const team = scorer === 'HOME' ? TEAMS.HOME : TEAMS.AWAY;
    this.hud.showGoal(team);
    this.celebrateT = 2.6;
  }
}
