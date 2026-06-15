/**
 * Gameplay.js — input, player control, ball possession and match state.
 *
 * Possession model:
 *   • A loose ball runs on the physics sim.
 *   • The player TRAPS a low ball that comes within reach (first touch), then
 *     keeps it glued to a dribble spot just ahead of the boots — tighter when
 *     slow / turning, pushed further ahead at a sprint.
 *   • The ball is only lost by kicking it on purpose (pass / charged shot /
 *     cross / aimed shot), by going out of play, or — once opponents exist — by
 *     being tackled. A short cooldown after a kick stops it re-sticking, and a
 *     ball above head height can't be trapped (lofted crosses fly over).
 *
 * Controls: WASD/arrows move (camera-relative), Shift sprints, Space passes
 * (hold to drive it harder), F crosses (lofted), hold+release Left Mouse shoots
 * toward the cursor, R resets.
 */

import * as THREE from 'three';
import { Physics } from './Physics.js';
import { BALL, TEAMS, FIELD, GOAL } from '../config.js';

const CAPTURE_RADIUS = 0.85; // reach for trapping a loose ball
const CAPTURE_MAX_Y = 0.55; // can't trap a ball flying overhead
const KICK_COOLDOWN = 0.35; // no re-capture right after a kick
const OUT_COOLDOWN = 0.6;
const DRIBBLE_NEAR = 0.5; // ball distance ahead at walking pace
const DRIBBLE_FAR = 0.95; // ball distance ahead at a sprint
const DRIBBLE_SPRING = 13; // how firmly the ball tracks the dribble spot
const SPRINT_REF = 7; // player run speed, for distance scaling
const PLAYER_RADIUS = 0.3; // body radius for loose-ball collisions
const OUT_MARGIN = 0.25; // grace beyond the lines before it's "out"

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

    this.owned = false; // does the player have the ball?
    this.kickCooldown = 0; // blocks recapture right after a kick
    this.celebrateT = 0;

    this.mouseCharging = false;
    this.mouseCharge = 0;
    this.spaceCharging = false;
    this.spaceCharge = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._face = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'r') this.kickoff();
      else if (k === 'f' && this.owned) this.kickCross();
      else if (k === ' ' && this.owned && !this.spaceCharging) {
        this.spaceCharging = true;
        this.spaceCharge = 0;
      }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' && this.spaceCharging) {
        this.spaceCharging = false;
        if (this.owned) this.kickGround(this.spaceCharge);
        this.spaceCharge = 0;
      }
    });

    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.rig.mode === 'orbit') return;
      this.mouseCharging = true;
      this.mouseCharge = 0;
      this.updatePointer(e);
    });
    addEventListener('pointermove', (e) => this.updatePointer(e));
    addEventListener('pointerup', (e) => {
      if (!this.mouseCharging || e.button !== 0) return;
      this.mouseCharging = false;
      this.shootAtCursor(this.mouseCharge);
      this.mouseCharge = 0;
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

  playerFacing() {
    return this._face.set(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
  }

  update(dt) {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    if (this.spaceCharging) this.spaceCharge = Math.min(1, this.spaceCharge + dt * 0.85);
    if (this.mouseCharging) this.mouseCharge = Math.min(1, this.mouseCharge + dt * 0.9);

    const sprint = this.keys.has('shift');
    const moveDir = this.celebrateT <= 0 ? this.moveDirection() : null;
    this.player.update(dt, moveDir, sprint);

    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      this.physics.step(this.ball, dt); // let the ball roll dead in the net
      if (this.celebrateT <= 0) this.kickoff();
      return;
    }

    if (this.owned) {
      this.dribble(dt);
    } else {
      const event = this.physics.step(this.ball, dt);
      if (event) this.onGoal(event.scorer);
      else if (!this.tryCapture()) this.collideWithPlayer();
    }
  }

  // --- possession ---------------------------------------------------------

  // Keep the ball sprung to a dribble spot just ahead of the boots.
  dribble(dt) {
    const r = BALL.RADIUS;
    const pos = this.ball.position;
    const vel = this.ball.velocity;
    const prevX = pos.x;

    const f = this.playerFacing();
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const dist = THREE.MathUtils.lerp(DRIBBLE_NEAR, DRIBBLE_FAR, Math.min(1, speed / SPRINT_REF));
    const tx = this.player.position.x + f.x * dist;
    const tz = this.player.position.z + f.z * dist;

    // velocity-matched spring: travels with the player, springs to the offset
    vel.x = this.player.velocity.x + (tx - pos.x) * DRIBBLE_SPRING;
    vel.z = this.player.velocity.z + (tz - pos.z) * DRIBBLE_SPRING;
    vel.y = 0;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y = r;

    if (this.detectGoal(prevX)) return;

    if (Math.abs(pos.x) > FIELD.HALF_LENGTH + OUT_MARGIN ||
        Math.abs(pos.z) > FIELD.HALF_WIDTH + OUT_MARGIN) {
      this.goOut();
      return;
    }

    // rolling spin: ω = (up × v) / r
    this.ball.angularVelocity.set(vel.z / r, 0, -vel.x / r);
    this.ball.spin(dt);
    this.ball.syncMesh();
  }

  // Trap a loose, low ball that comes within reach.
  tryCapture() {
    if (this.kickCooldown > 0) return false;
    const dx = this.ball.position.x - this.player.position.x;
    const dz = this.ball.position.z - this.player.position.z;
    if (Math.hypot(dx, dz) < CAPTURE_RADIUS && this.ball.position.y < CAPTURE_MAX_Y) {
      this.owned = true;
      this.ball.velocity.multiplyScalar(0.25); // first-touch cushion
      this.ball.position.y = BALL.RADIUS;
      return true;
    }
    return false;
  }

  // Stop a loose ball passing through the player's body (lets you shield it).
  collideWithPlayer() {
    if (this.kickCooldown > 0) return;
    const pos = this.ball.position;
    if (pos.y > 1.1) return; // ball is over the player's head
    const dx = pos.x - this.player.position.x;
    const dz = pos.z - this.player.position.z;
    const d = Math.hypot(dx, dz);
    const minD = BALL.RADIUS + PLAYER_RADIUS;
    if (d < minD && d > 1e-4) {
      const nx = dx / d;
      const nz = dz / d;
      pos.x = this.player.position.x + nx * minD;
      pos.z = this.player.position.z + nz * minD;
      const vn = this.ball.velocity.x * nx + this.ball.velocity.z * nz;
      if (vn < 0) {
        this.ball.velocity.x -= 1.5 * vn * nx;
        this.ball.velocity.z -= 1.5 * vn * nz;
      }
      this.ball.syncMesh();
    }
  }

  detectGoal(prevX) {
    const r = BALL.RADIUS;
    const pos = this.ball.position;
    const hw = GOAL.WIDTH / 2 - r * 0.5;
    const underBar = pos.y < GOAL.HEIGHT - r;
    if (Math.abs(pos.z) < hw && underBar) {
      if (prevX < FIELD.HALF_LENGTH && pos.x >= FIELD.HALF_LENGTH) {
        this.onGoal('HOME');
        return true;
      }
      if (prevX > -FIELD.HALF_LENGTH && pos.x <= -FIELD.HALF_LENGTH) {
        this.onGoal('AWAY');
        return true;
      }
    }
    return false;
  }

  // Ball left the field while dribbling — drop it loose just inside the line.
  goOut() {
    this.owned = false;
    this.kickCooldown = OUT_COOLDOWN;
    const pos = this.ball.position;
    pos.x = THREE.MathUtils.clamp(pos.x, -(FIELD.HALF_LENGTH - 0.4), FIELD.HALF_LENGTH - 0.4);
    pos.z = THREE.MathUtils.clamp(pos.z, -(FIELD.HALF_WIDTH - 0.4), FIELD.HALF_WIDTH - 0.4);
    pos.y = BALL.RADIUS;
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
  }

  // --- kicks (all release possession) -------------------------------------

  releaseBall(vx, vy, vz) {
    this.owned = false;
    this.kickCooldown = KICK_COOLDOWN;
    this.ball.velocity.set(vx, vy, vz);
    this.ball.position.y = Math.max(this.ball.position.y, BALL.RADIUS);
  }

  // Space: a grounded pass that drives harder the longer it's held.
  kickGround(charge) {
    const f = this.playerFacing();
    const power = THREE.MathUtils.lerp(7, 27, charge);
    this.releaseBall(f.x * power, 1.2 + charge * 2.5, f.z * power);
  }

  // F: a lofted cross / clearance forward.
  kickCross() {
    const f = this.playerFacing();
    const power = 15;
    this.releaseBall(f.x * power, 8.5, f.z * power);
  }

  // Mouse: an aimed shot toward the cursor, charged by how long it's held.
  shootAtCursor(charge) {
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return;
    const dir = hit.sub(this.ball.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    const power = THREE.MathUtils.lerp(11, 33, charge);
    this.releaseBall(dir.x * power, power * 0.18, dir.z * power);
  }

  // --- match flow ---------------------------------------------------------

  kickoff() {
    this.ball.reset(0, 0);
    this.player.reset(-2.2, 0);
    this.player.heading = Math.PI / 2; // face the pitch (+X)
    this.owned = false;
    this.kickCooldown = 0.3;
    this.spaceCharging = false;
    this.spaceCharge = 0;
    this.mouseCharging = false;
    this.mouseCharge = 0;
    this.celebrateT = 0;
    this.hud.hideGoal();
  }

  onGoal(scorer) {
    this.owned = false;
    this.score[scorer]++;
    this.hud.setScore(this.score.HOME, this.score.AWAY);
    const team = scorer === 'HOME' ? TEAMS.HOME : TEAMS.AWAY;
    this.hud.showGoal(team);
    this.celebrateT = 2.6;
  }
}
