/**
 * Gameplay.js — the match engine: input, possession, control-switching, the
 * pass/shoot/cross + tackle/slide actions, and the team AI.
 *
 * Teams: HOME has two outfielders (you control one at a time) attacking the +X
 * goal; AWAY has a defender and a keeper. Control auto-switches — to the HOME
 * carrier, to a pass receiver, or to the HOME player nearest the ball when you
 * are defending. Controls (all keyboard): WASD/arrows move, Shift sprints; with
 * the ball Space = pass, J = shoot, K = cross; without it Space = tackle,
 * X = slide. No fouls. R resets.
 */

import * as THREE from 'three';
import { Physics } from './Physics.js';
import { TEAMS, FIELD, GOAL, BALL } from '../config.js';

const CAPTURE_RADIUS = 0.85;
const CAPTURE_MAX_Y = 0.55;
const KICK_COOLDOWN = 0.35;
const OUT_COOLDOWN = 0.6;
const DRIBBLE_NEAR = 0.5;
const DRIBBLE_FAR = 0.95;
const DRIBBLE_SPRING = 13;
const SPRINT_REF = 7;
const BODY_RADIUS = 0.32;
const OUT_MARGIN = 0.25;
const GRAVITY = 12;
const AWAY_GOAL_X = FIELD.HALF_LENGTH; // HOME attacks +X (a ball over it scores HOME)

export class Gameplay {
  constructor(teams, ball, cameraRig, dom, hud) {
    this.home = teams.home; // [fp0, fp1]
    this.defender = teams.defender;
    this.keeper = teams.keeper;
    this.field = [...this.home, this.defender]; // all outfielders
    this.ball = ball;
    this.rig = cameraRig;
    this.dom = dom;
    this.hud = hud;
    this.physics = new Physics();

    this.score = { HOME: 0, AWAY: 0 };
    this.keys = new Set();
    this.controlled = 0; // index into home
    this.ballOwner = null; // FieldPlayer | keeper | null
    this.kickCooldown = 0;
    this.celebrateT = 0;
    this.passTarget = null;
    this.passTimer = 0;
    this.defenderClear = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._t = new THREE.Vector3();

    this.bind();
    this.kickoff();
  }

  // --- input --------------------------------------------------------------

  bind() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'r') this.kickoff();
      else this.onAction(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  onAction(k) {
    if (this.celebrateT > 0) return;
    const me = this.controlledPlayer();
    if (me.busy) return;
    if (this.ballOwner === me) {
      if (k === ' ') this.pass(me);
      else if (k === 'j') this.shoot(me);
      else if (k === 'k') this.cross(me);
    } else {
      if (k === ' ') me.startTackle();
      else if (k === 'x') me.startSlide();
    }
  }

  controlledPlayer() {
    return this.home[this.controlled];
  }

  // Camera-relative movement direction from the held keys.
  inputDir() {
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

  // --- main update --------------------------------------------------------

  update(dt) {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    if (this.passTimer > 0) this.passTimer = Math.max(0, this.passTimer - dt);

    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      for (const a of this.field) a.update(dt, null, false);
      this.keeper.update(dt, this.ball, 'loose');
      this.physics.step(this.ball, dt);
      if (this.celebrateT <= 0) this.kickoff();
      return;
    }

    this.resolveControl();

    // drive the controlled player from input, everyone else from AI
    const me = this.controlledPlayer();
    me.update(dt, this.inputDir(), this.keys.has('shift'));
    for (const a of this.field) {
      if (a === me) continue;
      const intent = a.team === 'HOME' ? this.homeAI(a) : this.awayAI(a);
      a.update(dt, intent.dir, intent.sprint);
    }

    // keeper
    const mode = this.ballOwner === this.keeper ? 'own'
      : this.ballOwner && this.ballOwner.team === 'HOME' ? 'home'
        : this.ballOwner && this.ballOwner.team === 'AWAY' ? 'own' : 'loose';
    const kr = this.keeper.update(dt, this.ball, mode);
    if (kr.tookPossession) this.setOwner(this.keeper);
    if (this.keeper.holding) this.setOwner(this.keeper);
    else if (this.ballOwner === this.keeper) this.setOwner(null); // punted -> loose

    // ball authority
    const owner = this.ballOwner;
    if (owner === this.keeper) {
      // keeper already positioned the ball
    } else if (owner) {
      this.carry(dt, owner);
      if (this.ballOwner === this.defender) {
        this.defenderClear -= dt;
        if (this.defenderClear <= 0 || this.nearbyEnemy(this.defender, 1.5)) {
          const f = this.defender.forward();
          this.releaseBall(this.defender, f.x * 15, 6.5, f.z * 15 + (Math.random() - 0.5) * 4);
        }
      }
    } else {
      const ev = this.physics.step(this.ball, dt);
      if (ev) {
        this.onGoal(ev.scorer);
        return;
      }
      this.resolveLoose();
    }

    this.resolveTackles();
  }

  // --- control ------------------------------------------------------------

  resolveControl() {
    const owner = this.ballOwner;
    if (owner && owner.team === 'HOME') {
      this.controlled = this.home.indexOf(owner);
    } else if (this.passTarget && this.passTimer > 0) {
      this.controlled = this.home.indexOf(this.passTarget);
    } else {
      this.controlled = this.nearestHomeIndex(this.ball.position);
    }
  }

  nearestHomeIndex(pos) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < this.home.length; i++) {
      const d = this.horiz(this.home[i].position, pos);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }

  // --- carrying / loose ball ---------------------------------------------

  carry(dt, owner) {
    const r = BALL.RADIUS;
    const pos = this.ball.position;
    const vel = this.ball.velocity;
    const prevX = pos.x;
    const f = this._t.set(Math.sin(owner.heading), 0, Math.cos(owner.heading));
    const speed = Math.hypot(owner.velocity.x, owner.velocity.z);
    const dist = THREE.MathUtils.lerp(DRIBBLE_NEAR, DRIBBLE_FAR, Math.min(1, speed / SPRINT_REF));
    const tx = owner.position.x + f.x * dist;
    const tz = owner.position.z + f.z * dist;
    vel.x = owner.velocity.x + (tx - pos.x) * DRIBBLE_SPRING;
    vel.z = owner.velocity.z + (tz - pos.z) * DRIBBLE_SPRING;
    vel.y = 0;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y = r;

    if (this.detectGoal(prevX)) return;
    if (Math.abs(pos.x) > FIELD.HALF_LENGTH + OUT_MARGIN ||
        Math.abs(pos.z) > FIELD.HALF_WIDTH + OUT_MARGIN) {
      this.loseOut(owner);
      return;
    }
    this.ball.angularVelocity.set(vel.z / r, 0, -vel.x / r);
    this.ball.spin(dt);
    this.ball.syncMesh();
  }

  resolveLoose() {
    for (const a of this.field) this.bodyCollide(a);
    let best = null;
    let bd = Infinity;
    for (const a of this.field) {
      if (a.captureCooldown > 0 || a.busy) continue;
      const d = this.horiz(a.position, this.ball.position);
      if (d < CAPTURE_RADIUS && this.ball.position.y < CAPTURE_MAX_Y && d < bd) {
        best = a;
        bd = d;
      }
    }
    if (best) this.gainPossession(best);
  }

  gainPossession(agent) {
    this.setOwner(agent);
    this.ball.velocity.multiplyScalar(0.25); // first touch
    this.ball.position.y = BALL.RADIUS;
    if (agent === this.defender) this.defenderClear = 0.8;
  }

  bodyCollide(a) {
    if (a.captureCooldown > 0) return; // let a just-kicked ball leave its kicker
    const pos = this.ball.position;
    if (pos.y > 1.8) return;
    const dx = pos.x - a.position.x;
    const dz = pos.z - a.position.z;
    const d = Math.hypot(dx, dz);
    const minD = BALL.RADIUS + BODY_RADIUS;
    if (d < minD && d > 1e-4) {
      const nx = dx / d;
      const nz = dz / d;
      pos.x = a.position.x + nx * minD;
      pos.z = a.position.z + nz * minD;
      const vn = this.ball.velocity.x * nx + this.ball.velocity.z * nz;
      if (vn < 0) {
        this.ball.velocity.x -= 1.4 * vn * nx;
        this.ball.velocity.z -= 1.4 * vn * nz;
      }
    }
  }

  // A lunging tackle/slide wins or knocks the ball off an opponent carrier.
  resolveTackles() {
    const owner = this.ballOwner;
    if (!owner || owner === this.keeper) return;
    for (const t of this.field) {
      if (t.team === owner.team || !t.isLunging() || t._won) continue;
      if (this.horiz(t.position, this.ball.position) < t.actionReach()) {
        t._won = true;
        if (t.state === 'tackle') {
          this.gainPossession(t);
          owner.captureCooldown = 0.6;
        } else {
          // a slide knocks it loose ahead of the tackler
          this.setOwner(null);
          const f = t.forward();
          this.ball.velocity.set(f.x * 5, 1.5, f.z * 5);
          owner.captureCooldown = 0.5;
          t.captureCooldown = 0.45;
        }
      }
    }
  }

  // --- actions (all release possession) -----------------------------------

  releaseBall(kicker, vx, vy, vz) {
    this.ballOwner = null;
    this.kickCooldown = KICK_COOLDOWN;
    kicker.captureCooldown = KICK_COOLDOWN;
    this.ball.velocity.set(vx, vy, vz);
    this.ball.position.y = Math.max(this.ball.position.y, BALL.RADIUS);
  }

  pass(me) {
    const mate = this.home[1 - this.home.indexOf(me)];
    const tx = mate.position.x + mate.velocity.x * 0.25; // lead the run a touch
    const tz = mate.position.z + mate.velocity.z * 0.25;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const power = THREE.MathUtils.clamp(dist * 1.5 + 4, 6, 24);
    this.releaseBall(me, (dx / dist) * power, 0.6, (dz / dist) * power);
    this.handOverTo(mate);
  }

  shoot(me) {
    // auto-aim at the corner away from the keeper
    const aimZ = this.keeper.position.z >= 0 ? -2.6 : 2.6;
    const dx = AWAY_GOAL_X - this.ball.position.x;
    const dz = aimZ - this.ball.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const power = THREE.MathUtils.clamp(dist * 0.9 + 14, 16, 34);
    this.releaseBall(me, (dx / dist) * power, power * 0.14, (dz / dist) * power);
  }

  cross(me) {
    const mate = this.home[1 - this.home.indexOf(me)];
    let tx;
    let tz;
    if (mate.position.x > 25) {
      // a teammate is up — aim the cross onto them
      tx = mate.position.x;
      tz = mate.position.z;
    } else {
      // otherwise float it to the far post inside the box
      tx = AWAY_GOAL_X - 9;
      tz = me.position.z > 0 ? -3.5 : 3.5;
    }
    tx = THREE.MathUtils.clamp(tx, AWAY_GOAL_X - 16, AWAY_GOAL_X - 4);
    tz = THREE.MathUtils.clamp(tz, -18, 18);
    const T = 1.15; // flight time -> a real lofted arc into the area
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    this.releaseBall(me, dx / T, 0.5 * GRAVITY * T, dz / T);
    this.handOverTo(mate);
  }

  // switch control to a receiver and keep it there through the ball's flight
  handOverTo(mate) {
    this.passTarget = mate;
    this.passTimer = 2.0;
    this.controlled = this.home.indexOf(mate);
  }

  // --- AI -----------------------------------------------------------------

  homeAI(a) {
    const owner = this.ballOwner;
    const ball = this.ball.position;
    let target;
    if (owner && owner.team === 'HOME') {
      const carrier = owner;
      const finalThird = carrier.position.x > 22;
      const tz = finalThird
        ? (carrier.position.z > 0 ? -4 : 4) // run into the box, far side
        : THREE.MathUtils.clamp(carrier.position.z + (carrier.position.z > 0 ? -7 : 7), -22, 22);
      const tx = THREE.MathUtils.clamp(carrier.position.x + 9, -20, AWAY_GOAL_X - 5);
      target = this._t.set(tx, 0, tz);
    } else if (!owner) {
      if (this.nearestHomeIndex(ball) === this.home.indexOf(a)) target = this._t.copy(ball);
      else target = this._t.set(ball.x - 6, 0, ball.z * 0.5);
    } else {
      target = this._t.set(ball.x - 7, 0, ball.z * 0.5); // AWAY has it: drop goal-side
    }
    return this.steer(a, target);
  }

  awayAI(a) {
    const owner = this.ballOwner;
    const ball = this.ball.position;
    if (owner && owner.team === 'HOME') {
      const carrier = owner;
      const d = this.horiz(a.position, carrier.position);
      if (!a.busy && a.captureCooldown <= 0 && d < 1.6) {
        a.heading = this.headingTo(a, this.ball.position);
        const fast = Math.hypot(carrier.velocity.x, carrier.velocity.z) > 4;
        if (fast && d > 0.9) a.startSlide();
        else a.startTackle();
        a.captureCooldown = 0.8; // throttle attempts
        return { dir: null, sprint: false };
      }
      // jockey goal-side of the carrier, closing in to tackling range
      const gx = AWAY_GOAL_X - carrier.position.x;
      const gz = -carrier.position.z;
      const gl = Math.hypot(gx, gz) || 1;
      const target = this._t.set(carrier.position.x + (gx / gl) * 1.05, 0, carrier.position.z + (gz / gl) * 1.05);
      return this.steer(a, target, true);
    }
    if (owner === a) {
      return this.steer(a, this._t.set(a.position.x - 10, 0, a.position.z * 0.5), true);
    }
    if (!owner) {
      if (this.horiz(a.position, ball) < 9) return this.steer(a, this._t.copy(ball), true);
      return this.steer(a, this._t.set(THREE.MathUtils.clamp(ball.x + 6, 10, AWAY_GOAL_X - 2), 0, ball.z * 0.6), false);
    }
    return this.steer(a, this._t.set(28, 0, 0), false); // keeper has it
  }

  steer(a, target, sprint = false) {
    const dx = target.x - a.position.x;
    const dz = target.z - a.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) return { dir: null, sprint: false };
    this._dir.set(dx, 0, dz);
    return { dir: this._dir, sprint: sprint || d > 5 };
  }

  // --- helpers ------------------------------------------------------------

  setOwner(o) {
    this.ballOwner = o;
    if (o) {
      this.passTarget = null;
      this.passTimer = 0;
    }
  }

  horiz(p, q) {
    return Math.hypot(p.x - q.x, p.z - q.z);
  }

  headingTo(a, pos) {
    return Math.atan2(pos.x - a.position.x, pos.z - a.position.z);
  }

  nearbyEnemy(owner, r) {
    for (const a of this.field) {
      if (a.team === owner.team) continue;
      if (this.horiz(a.position, owner.position) < r) return true;
    }
    return false;
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

  loseOut(owner) {
    this.setOwner(null);
    const pos = this.ball.position;
    pos.x = THREE.MathUtils.clamp(pos.x, -(FIELD.HALF_LENGTH - 0.4), FIELD.HALF_LENGTH - 0.4);
    pos.z = THREE.MathUtils.clamp(pos.z, -(FIELD.HALF_WIDTH - 0.4), FIELD.HALF_WIDTH - 0.4);
    pos.y = BALL.RADIUS;
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
    owner.captureCooldown = OUT_COOLDOWN;
  }

  // --- match flow ---------------------------------------------------------

  kickoff() {
    this.ball.reset(0, 0);
    this.home[0].reset(-3, 0, Math.PI / 2);
    this.home[1].reset(-12, 9, Math.PI / 2);
    this.defender.reset(22, 0, -Math.PI / 2);
    this.keeper.reset();
    this.controlled = 0;
    this.passTarget = null;
    this.passTimer = 0;
    this.kickCooldown = 0.3;
    this.celebrateT = 0;
    this.setOwner(this.home[0]); // kick off with the ball at your feet
    this.hud.hideGoal();
  }

  onGoal(scorer) {
    this.setOwner(null);
    this.score[scorer]++;
    this.hud.setScore(this.score.HOME, this.score.AWAY);
    const team = scorer === 'HOME' ? TEAMS.HOME : TEAMS.AWAY;
    this.hud.showGoal(team);
    this.celebrateT = 2.6;
  }
}
