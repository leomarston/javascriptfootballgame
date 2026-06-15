/**
 * Gameplay.js — input, player control and match state.
 *
 *   • WASD / arrows move the player (camera-relative); hold Shift to sprint.
 *   • The player dribbles the ball on contact and can kick it with Space.
 *   • Hold + release the mouse for a charged shot toward the cursor.
 *   • R resets to kickoff; kickoff happens after every goal.
 */

import * as THREE from 'three';
import { Physics } from './Physics.js';
import { BALL, TEAMS } from '../config.js';

const CONTACT = 0.55; // how close the player must be to touch the ball

export class Gameplay {
  constructor(player, ball, cameraRig, dom, hud) {
    this.player = player;
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

    this._dir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'r') this.kickoff();
      if (k === ' ') this.kickBall(16, 5.5); // chip / pass
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
    });
  }

  updatePointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  // Camera-relative movement direction from the held keys.
  moveDirection() {
    this.rig.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-4) this._fwd.set(0, 0, 1);
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();

    this._dir.set(0, 0, 0);
    if (this.keys.has('w') || this.keys.has('arrowup')) this._dir.add(this._fwd);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this._dir.sub(this._fwd);
    if (this.keys.has('d') || this.keys.has('arrowright')) this._dir.add(this._right);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this._dir.sub(this._right);
    return this._dir;
  }

  playerFacing(out) {
    return out.set(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
  }

  // Push the ball away from the player along their facing, with optional loft.
  kickBall(power, lift = 0) {
    const d = this.toBallDistance();
    if (d > CONTACT + 0.2) return;
    const f = this.playerFacing(this._fwd);
    this.ball.velocity.x = f.x * power;
    this.ball.velocity.z = f.z * power;
    if (lift) this.ball.velocity.y = Math.max(this.ball.velocity.y, lift);
  }

  toBallDistance() {
    const dx = this.ball.position.x - this.player.position.x;
    const dz = this.ball.position.z - this.player.position.z;
    return Math.hypot(dx, dz);
  }

  // Light touch: while running into the ball, carry it ahead at the player's pace.
  dribble() {
    if (this.toBallDistance() > CONTACT) return;
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (speed < 0.3) return;
    const f = this.playerFacing(this._fwd);
    const push = Math.max(speed * 1.25, 1.8);
    this.ball.velocity.x = f.x * push;
    this.ball.velocity.z = f.z * push;
    // keep the ball just ahead of the boots
    this.ball.position.x = this.player.position.x + f.x * CONTACT;
    this.ball.position.z = this.player.position.z + f.z * CONTACT;
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

  kickoff() {
    this.ball.reset(0, 0);
    this.player.reset(-2.2, 0);
    this.player.heading = Math.PI / 2; // face the pitch (+X)
    this.celebrateT = 0;
    this.hud.hideGoal();
  }

  update(dt) {
    const sprint = this.keys.has('shift');
    const moving = this.celebrateT <= 0 ? this.moveDirection() : null;
    this.player.update(dt, moving, sprint);

    if (this.charging) this.charge = Math.min(1, this.charge + dt * 0.9);

    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      if (this.celebrateT <= 0) this.kickoff();
    } else {
      this.dribble();
    }

    const event = this.physics.step(this.ball, dt);
    if (event && this.celebrateT <= 0) this.onGoal(event.scorer);
  }

  onGoal(scorer) {
    this.score[scorer]++;
    this.hud.setScore(this.score.HOME, this.score.AWAY);
    const team = scorer === 'HOME' ? TEAMS.HOME : TEAMS.AWAY;
    this.hud.showGoal(team);
    this.celebrateT = 2.6;
  }
}
