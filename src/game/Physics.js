/**
 * Physics.js — a compact, arcade-leaning rigid-ball simulation.
 *
 * Integrates gravity, aerodynamic drag, turf bounce with restitution, rolling
 * friction (with matching visual spin), reflective perimeter walls, goal-post /
 * crossbar collisions and goal-line detection. Stepped with substeps so fast
 * shots don't tunnel through posts or the goal line.
 */

import * as THREE from 'three';
import { BALL, FIELD, GOAL } from '../config.js';

const GRAVITY = 12.0; // slightly punchier than 9.81 for game feel
const WALL_X = FIELD.HALF_LENGTH + 2.4;
const WALL_Z = FIELD.HALF_WIDTH + 2.4;
const WALL_REST = 0.62;
const UP = new THREE.Vector3(0, 1, 0);

export class Physics {
  constructor() {
    this.posts = [];
    const hw = GOAL.WIDTH / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.posts.push({ x: sx * FIELD.HALF_LENGTH, z: sz * hw });
      }
    }
  }

  step(ball, dt) {
    const sub = Math.min(8, Math.max(1, Math.ceil(dt / 0.0125)));
    const h = dt / sub;
    let event = null;
    for (let s = 0; s < sub; s++) {
      const e = this.integrate(ball, h);
      if (e) event = e;
    }
    ball.spin(dt);
    ball.syncMesh();
    return event;
  }

  integrate(ball, h) {
    const r = BALL.RADIUS;
    const pos = ball.position;
    const vel = ball.velocity;
    const airborne = pos.y > r + 1e-3;

    // gravity
    vel.y -= GRAVITY * h;

    // aerodynamic drag (mostly affects flight)
    const drag = airborne ? BALL.AIR_DRAG : BALL.AIR_DRAG * 0.4;
    const damp = Math.max(0, 1 - drag * h);
    vel.x *= damp;
    vel.z *= damp;
    vel.y *= airborne ? Math.max(0, 1 - BALL.AIR_DRAG * 0.5 * h) : 1;

    const prevX = pos.x;

    // integrate position
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;

    // --- ground -----------------------------------------------------------
    if (pos.y < r) {
      pos.y = r;
      if (vel.y < 0) {
        vel.y = -vel.y * BALL.RESTITUTION;
        if (vel.y < 0.6) vel.y = 0; // settle
      }
      // rolling friction on the horizontal velocity
      const rf = Math.max(0, 1 - BALL.ROLL_FRICTION * h);
      vel.x *= rf;
      vel.z *= rf;
      // match spin to rolling motion (ω = (up × v) / r)
      const vHoriz = new THREE.Vector3(vel.x, 0, vel.z);
      ball.angularVelocity.copy(new THREE.Vector3().crossVectors(UP, vHoriz)).multiplyScalar(1 / r);
    }

    // --- goal-line detection ---------------------------------------------
    // The away goal sits at +X: putting the ball there scores for HOME.
    // The home goal sits at −X: putting the ball there scores for AWAY.
    let event = null;
    const hw = GOAL.WIDTH / 2 - r * 0.5;
    const underBar = pos.y < GOAL.HEIGHT - r;
    if (Math.abs(pos.z) < hw && underBar) {
      if (prevX < FIELD.HALF_LENGTH && pos.x >= FIELD.HALF_LENGTH) event = { scorer: 'HOME' };
      else if (prevX > -FIELD.HALF_LENGTH && pos.x <= -FIELD.HALF_LENGTH) event = { scorer: 'AWAY' };
    }

    // --- goal posts + crossbar -------------------------------------------
    this.collidePosts(ball);
    this.collideCrossbars(ball);

    // --- perimeter walls --------------------------------------------------
    // skip the X-wall reflection while the ball is inside a goal mouth
    const inMouth = Math.abs(pos.z) < hw && underBar;
    if (!inMouth) {
      if (pos.x > WALL_X) {
        pos.x = WALL_X;
        vel.x = -Math.abs(vel.x) * WALL_REST;
      } else if (pos.x < -WALL_X) {
        pos.x = -WALL_X;
        vel.x = Math.abs(vel.x) * WALL_REST;
      }
    }
    if (pos.z > WALL_Z) {
      pos.z = WALL_Z;
      vel.z = -Math.abs(vel.z) * WALL_REST;
    } else if (pos.z < -WALL_Z) {
      pos.z = -WALL_Z;
      vel.z = Math.abs(vel.z) * WALL_REST;
    }

    // speed cap
    const sp = vel.length();
    if (sp > BALL.MAX_SPEED) vel.multiplyScalar(BALL.MAX_SPEED / sp);

    return event;
  }

  collidePosts(ball) {
    const r = BALL.RADIUS;
    const pr = GOAL.POST_RADIUS;
    const minD = r + pr;
    for (const p of this.posts) {
      if (ball.position.y > GOAL.HEIGHT) continue;
      const dx = ball.position.x - p.x;
      const dz = ball.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < minD && d > 1e-4) {
        const nx = dx / d;
        const nz = dz / d;
        ball.position.x = p.x + nx * minD;
        ball.position.z = p.z + nz * minD;
        const vn = ball.velocity.x * nx + ball.velocity.z * nz;
        ball.velocity.x -= (1 + WALL_REST) * vn * nx;
        ball.velocity.z -= (1 + WALL_REST) * vn * nz;
      }
    }
  }

  collideCrossbars(ball) {
    const r = BALL.RADIUS;
    const pr = GOAL.POST_RADIUS;
    const hw = GOAL.WIDTH / 2;
    for (const sx of [-1, 1]) {
      const barX = sx * FIELD.HALF_LENGTH;
      if (Math.abs(ball.position.z) > hw + pr) continue;
      const dx = ball.position.x - barX;
      const dy = ball.position.y - GOAL.HEIGHT;
      const d = Math.hypot(dx, dy);
      if (d < r + pr && d > 1e-4) {
        const nx = dx / d;
        const ny = dy / d;
        ball.position.x = barX + nx * (r + pr);
        ball.position.y = GOAL.HEIGHT + ny * (r + pr);
        const vn = ball.velocity.x * nx + ball.velocity.y * ny;
        ball.velocity.x -= (1 + WALL_REST) * vn * nx;
        ball.velocity.y -= (1 + WALL_REST) * vn * ny;
      }
    }
  }
}
