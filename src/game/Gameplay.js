/**
 * Gameplay.js — the match engine for 11-v-11, 4-4-2.
 *
 * Team shape (the important bit): off-ball players hold an ELASTIC formation
 * slot — they follow the ball partially (line height + lateral compactness),
 * push up in possession and drop when defending — so the team keeps its shape
 * instead of everyone chasing the ball. Exactly one player per team presses the
 * ball; one teammate offers support; an AI carrier dribbles, passes or shoots.
 *
 * You control one HOME outfielder (a yellow ring marks them); control auto-
 * switches to the carrier, a pass receiver, or the nearest player when defending
 * (held >= 1s; Q switches manually). Keyboard: WASD move, Shift sprint; with the
 * ball Space = pass (hold for power), J = shoot (held, capped), K = cross;
 * defending Space = tackle, X = slide. No fouls. R resets.
 */

import * as THREE from 'three';
import { Physics } from './Physics.js';
import { TEAMS, FIELD, GOAL, BALL } from '../config.js';
import { ATTACK_SIGN } from './formations.js';

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

// formation elasticity
const LINE_FACTOR = 0.32; // how much each player follows the ball up/down the pitch
const SIDE_FACTOR = 0.34; // lateral compactness toward the ball
const PUSH = { DF: 3, MF: 6, FW: 10 }; // extra metres forward in possession
const DROP = { DF: 6, MF: 5, FW: 3 }; // metres dropped when defending

const HL = FIELD.HALF_LENGTH;
const HW = FIELD.HALF_WIDTH;
const HOME_ATTACK_X = ATTACK_SIGN.HOME * HL; // +X goal HOME attacks

export class Gameplay {
  constructor(teams, ball, cameraRig, dom, hud) {
    this.home = teams.home; // 10 outfielders
    this.away = teams.away; // 10 outfielders
    this.homeKeeper = teams.homeKeeper;
    this.awayKeeper = teams.awayKeeper;
    this.field = [...this.home, ...this.away];
    this.keepers = [this.homeKeeper, this.awayKeeper];
    this.ball = ball;
    this.rig = cameraRig;
    this.dom = dom;
    this.hud = hud;
    this.physics = new Physics();

    this.score = { HOME: 0, AWAY: 0 };
    this.keys = new Set();
    this.controlled = 0;
    this.ballOwner = null;
    this.kickCooldown = 0;
    this.celebrateT = 0;
    this.passTarget = null;
    this.passTimer = 0;
    this.switchLock = 0;
    this.passCharging = false;
    this.passCharge = 0;
    this.shotCharging = false;
    this.shotCharge = 0;
    this.presser = {};
    this.support = {};

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
      else if (k === 'q') this.manualSwitch();
      else this.actionDown(k);
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      this.actionUp(k);
    });
  }

  actionDown(k) {
    if (this.celebrateT > 0) return;
    const me = this.controlledPlayer();
    if (me.busy) return;
    if (this.ballOwner === me) {
      if (k === ' ') { this.passCharging = true; this.passCharge = 0; }
      else if (k === 'j') { this.shotCharging = true; this.shotCharge = 0; }
      else if (k === 'k') this.cross(me);
    } else {
      if (k === ' ') me.startTackle();
      else if (k === 'x') me.startSlide();
    }
  }

  actionUp(k) {
    const me = this.controlledPlayer();
    if (k === ' ' && this.passCharging) {
      this.passCharging = false;
      if (this.ballOwner === me && !me.busy) this.pass(me, this.passCharge);
      this.passCharge = 0;
    } else if (k === 'j' && this.shotCharging) {
      this.shotCharging = false;
      if (this.ballOwner === me && !me.busy) this.shoot(me, this.shotCharge);
      this.shotCharge = 0;
    }
  }

  manualSwitch() {
    if (this.celebrateT > 0) return;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.home.length; i++) {
      if (i === this.controlled) continue;
      const d = this.horiz(this.home[i].position, this.ball.position);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      this.controlled = best;
      this.switchLock = 1.0;
      this.passTarget = null;
      this.passTimer = 0;
    }
  }

  controlledPlayer() {
    return this.home[this.controlled];
  }

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
    if (this.passCharging) this.passCharge = Math.min(1, this.passCharge + dt / 0.6);
    if (this.shotCharging) this.shotCharge = Math.min(1, this.shotCharge + dt / 0.75);

    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      for (const a of this.field) a.update(dt, null, false);
      for (const k of this.keepers) k.update(dt, this.ball, 'loose');
      this.physics.step(this.ball, dt);
      if (this.celebrateT <= 0) this.kickoff();
      return;
    }

    this.precomputeRoles();
    this.resolveControl(dt);

    const me = this.controlledPlayer();
    if ((this.passCharging || this.shotCharging) && this.ballOwner !== me) {
      this.passCharging = false;
      this.shotCharging = false;
      this.passCharge = 0;
      this.shotCharge = 0;
    }
    for (const a of this.field) a.carrying = a === this.ballOwner; // 15% slower on the ball
    me.update(dt, this.inputDir(), this.keys.has('shift'));
    for (const a of this.field) {
      if (a === me) continue;
      const intent = this.aiIntent(a);
      a.update(dt, intent.dir, intent.sprint);
    }

    for (const keeper of this.keepers) {
      const owner = this.ballOwner;
      const mode = owner === keeper ? 'own'
        : owner && owner.team === keeper.team ? 'own'
          : owner ? 'home' : 'loose';
      const kr = keeper.update(dt, this.ball, mode);
      if (kr.tookPossession) this.setOwner(keeper);
      if (keeper.holding) this.setOwner(keeper);
      else if (this.ballOwner === keeper) this.setOwner(null);
    }

    const owner = this.ballOwner;
    if (this.keepers.includes(owner)) {
      // the keeper positioned the ball
    } else if (owner) {
      this.carry(dt, owner);
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

  // --- roles & control ----------------------------------------------------

  precomputeRoles() {
    const owner = this.ballOwner;
    for (const team of ['HOME', 'AWAY']) {
      const arr = this.teamArr(team);
      let pn = null;
      let pd = Infinity;
      let sn = null;
      let sd = Infinity;
      for (const a of arr) {
        const d = this.horiz(a.position, this.ball.position);
        if (d < pd) { pd = d; pn = a; }
        if (a !== owner && d < sd) { sd = d; sn = a; }
      }
      this.presser[team] = pn;
      this.support[team] = sn;
    }
  }

  resolveControl(dt) {
    this.switchLock = Math.max(0, this.switchLock - dt);
    const owner = this.ballOwner;
    if (owner && owner.team === 'HOME' && this.home.includes(owner)) {
      this.controlled = this.home.indexOf(owner);
    } else if (this.passTarget && this.passTimer > 0) {
      this.controlled = this.home.indexOf(this.passTarget);
    } else if (this.switchLock <= 0) {
      const n = this.nearestIndex(this.home, this.ball.position);
      if (n !== this.controlled) {
        this.controlled = n;
        this.switchLock = 1.0;
      }
    }
  }

  // --- AI -----------------------------------------------------------------

  aiIntent(a) {
    const owner = this.ballOwner;
    const team = a.team;
    const teamHas = owner && owner.team === team;

    if (owner === a) return this.carrierAI(a);

    if (!teamHas && a === this.presser[team]) {
      const d = this.horiz(a.position, this.ball.position);
      const tackleable = owner && owner.team !== team && owner.roleType !== 'GK';
      if (tackleable && d < 1.6 && !a.busy && a.captureCooldown <= 0) {
        a.heading = this.headingTo(a, this.ball.position);
        const fast = Math.hypot(owner.velocity.x, owner.velocity.z) > 4;
        if (fast && d > 0.9) a.startSlide();
        else a.startTackle();
        a.captureCooldown = 0.8;
        return { dir: null, sprint: false };
      }
      return this.steer(a, this.ball.position, true);
    }

    if (teamHas && a === this.support[team] && owner.roleType !== 'GK') {
      return this.steer(a, this.supportTarget(a, owner), true);
    }

    return this.steer(a, this.formationTarget(a, teamHas));
  }

  formationTarget(a, teamHas) {
    const s = ATTACK_SIGN[a.team];
    const b = this.ball.position;
    let tx = a.homePos.x + (b.x - a.homePos.x) * LINE_FACTOR;
    let tz = a.homePos.z + (b.z - a.homePos.z) * SIDE_FACTOR;
    tx += teamHas ? s * PUSH[a.roleType] : -s * DROP[a.roleType];
    tx = THREE.MathUtils.clamp(tx, -HL + 2, HL - 2);
    tz = THREE.MathUtils.clamp(tz, -HW + 2, HW - 2);
    return this._t.set(tx, 0, tz);
  }

  supportTarget(a, carrier) {
    const s = ATTACK_SIGN[a.team];
    const tx = THREE.MathUtils.clamp(carrier.position.x + s * 8, -HL + 4, HL - 4);
    const finalThird = carrier.position.x * s > 18;
    const tz = finalThird
      ? (carrier.position.z > 0 ? -5 : 5)
      : THREE.MathUtils.clamp(carrier.position.z + (carrier.position.z > 0 ? -8 : 8), -24, 24);
    return this._t.set(tx, 0, tz);
  }

  carrierAI(a) {
    const s = ATTACK_SIGN[a.team];
    const goalX = s * HL;
    const distToGoal = Math.abs(goalX - a.position.x);
    if (distToGoal < 24 && Math.abs(a.position.z) < 18 && a.captureCooldown <= 0 && this.kickCooldown <= 0) {
      this.aiShoot(a);
      return { dir: null, sprint: false };
    }
    if (this.nearbyEnemy(a, 2.4)) {
      const mate = this.bestPassTarget(a);
      if (mate) {
        this.aiPass(a, mate);
        return { dir: null, sprint: false };
      }
    }
    return this.steer(a, this._t.set(goalX, 0, a.position.z * 0.7), true);
  }

  bestPassTarget(a) {
    const s = ATTACK_SIGN[a.team];
    let best = null;
    let bestScore = -Infinity;
    for (const m of this.teamArr(a.team)) {
      if (m === a) continue;
      const ahead = (m.position.x - a.position.x) * s;
      if (ahead < -3) continue;
      const d = this.horiz(a.position, m.position);
      if (d < 3 || d > 35) continue;
      let open = true;
      for (const e of this.field) {
        if (e.team === a.team) continue;
        if (this.horiz(e.position, m.position) < 2.2) { open = false; break; }
      }
      if (!open) continue;
      const score = ahead - d * 0.1;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  aiShoot(a) {
    const s = ATTACK_SIGN[a.team];
    const goalX = s * HL;
    const oppKeeper = a.team === 'HOME' ? this.awayKeeper : this.homeKeeper;
    const aimZ = oppKeeper.position.z >= 0 ? -2.4 : 2.4;
    const dx = goalX - this.ball.position.x;
    const dz = aimZ - this.ball.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const power = 20;
    this.releaseBall(a, (dx / dist) * power, power * 0.12, (dz / dist) * power);
  }

  aiPass(a, mate) {
    const power = 14;
    const lead = this.horiz(a.position, mate.position) / power;
    const tx = mate.position.x + mate.velocity.x * lead;
    const tz = mate.position.z + mate.velocity.z * lead;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.releaseBall(a, (dx / d) * power, 0.5, (dz / d) * power);
  }

  steer(a, target, sprint = false) {
    const dx = target.x - a.position.x;
    const dz = target.z - a.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) return { dir: null, sprint: false };
    this._dir.set(dx, 0, dz);
    return { dir: this._dir, sprint: sprint || d > 6 };
  }

  // --- carrying / loose ---------------------------------------------------

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
    if (Math.abs(pos.x) > HL + OUT_MARGIN || Math.abs(pos.z) > HW + OUT_MARGIN) {
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
      if (d < CAPTURE_RADIUS && this.ball.position.y < CAPTURE_MAX_Y && d < bd) { best = a; bd = d; }
    }
    if (best) this.gainPossession(best);
  }

  gainPossession(agent) {
    this.setOwner(agent);
    this.ball.velocity.multiplyScalar(0.25);
    this.ball.position.y = BALL.RADIUS;
  }

  bodyCollide(a) {
    if (a.captureCooldown > 0) return;
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

  resolveTackles() {
    const owner = this.ballOwner;
    if (!owner || this.keepers.includes(owner)) return;
    for (const t of this.field) {
      if (t.team === owner.team || !t.isLunging() || t._won) continue;
      if (this.horiz(t.position, this.ball.position) < t.actionReach()) {
        t._won = true;
        if (t.state === 'tackle') {
          this.gainPossession(t);
          owner.captureCooldown = 0.6;
        } else {
          this.setOwner(null);
          const f = t.forward();
          this.ball.velocity.set(f.x * 5, 1.5, f.z * 5);
          owner.captureCooldown = 0.5;
          t.captureCooldown = 0.45;
        }
      }
    }
  }

  // --- actions ------------------------------------------------------------

  releaseBall(kicker, vx, vy, vz) {
    this.ballOwner = null;
    this.kickCooldown = KICK_COOLDOWN;
    kicker.captureCooldown = KICK_COOLDOWN;
    this.ball.velocity.set(vx, vy, vz);
    this.ball.position.y = Math.max(this.ball.position.y, BALL.RADIUS);
  }

  pass(me, charge = 0.5) {
    let mate = this.bestPassTarget(me);
    if (!mate) {
      let bd = Infinity;
      for (const m of this.home) {
        if (m === me) continue;
        const d = this.horiz(me.position, m.position);
        if (d < bd) { bd = d; mate = m; }
      }
    }
    if (!mate) return;
    const power = THREE.MathUtils.lerp(7, 18, charge);
    const lead = this.horiz(this.ball.position, mate.position) / Math.max(6, power);
    const tx = mate.position.x + mate.velocity.x * lead;
    const tz = mate.position.z + mate.velocity.z * lead;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.releaseBall(me, (dx / d) * power, 0.5, (dz / d) * power);
    this.handOverTo(mate);
  }

  shoot(me, charge = 1) {
    const aimZ = this.awayKeeper.position.z >= 0 ? -2.4 : 2.4;
    const dx = HOME_ATTACK_X - this.ball.position.x;
    const dz = aimZ - this.ball.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const power = THREE.MathUtils.lerp(9, 23, charge);
    this.releaseBall(me, (dx / dist) * power, power * 0.12, (dz / dist) * power);
  }

  cross(me) {
    let mate = null;
    let bestAhead = -Infinity;
    for (const m of this.home) {
      if (m === me) continue;
      if (m.position.x > 25 && m.position.x > bestAhead) { bestAhead = m.position.x; mate = m; }
    }
    let tx;
    let tz;
    if (mate) {
      tx = mate.position.x;
      tz = mate.position.z;
    } else {
      tx = HOME_ATTACK_X - 9;
      tz = me.position.z > 0 ? -3.5 : 3.5;
    }
    tx = THREE.MathUtils.clamp(tx, HOME_ATTACK_X - 16, HOME_ATTACK_X - 4);
    tz = THREE.MathUtils.clamp(tz, -18, 18);
    const T = 1.15;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    this.releaseBall(me, dx / T, 0.5 * GRAVITY * T, dz / T);
    if (mate) this.handOverTo(mate);
  }

  handOverTo(mate) {
    this.passTarget = mate;
    this.passTimer = 2.0;
    this.controlled = this.home.indexOf(mate);
  }

  // --- helpers ------------------------------------------------------------

  setOwner(o) {
    this.ballOwner = o;
    if (o) {
      this.passTarget = null;
      this.passTimer = 0;
    }
  }

  teamArr(team) {
    return team === 'HOME' ? this.home : this.away;
  }

  horiz(p, q) {
    return Math.hypot(p.x - q.x, p.z - q.z);
  }

  headingTo(a, pos) {
    return Math.atan2(pos.x - a.position.x, pos.z - a.position.z);
  }

  nearestIndex(arr, pos) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = this.horiz(arr[i].position, pos);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
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
      if (prevX < HL && pos.x >= HL) { this.onGoal('HOME'); return true; }
      if (prevX > -HL && pos.x <= -HL) { this.onGoal('AWAY'); return true; }
    }
    return false;
  }

  loseOut(owner) {
    this.setOwner(null);
    const pos = this.ball.position;
    pos.x = THREE.MathUtils.clamp(pos.x, -(HL - 0.4), HL - 0.4);
    pos.z = THREE.MathUtils.clamp(pos.z, -(HW - 0.4), HW - 0.4);
    pos.y = BALL.RADIUS;
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
    owner.captureCooldown = OUT_COOLDOWN;
  }

  // --- match flow ---------------------------------------------------------

  kickoff() {
    this.ball.reset(0, 0);
    for (const a of this.field) {
      a.reset(a.homePos.x, a.homePos.z, ATTACK_SIGN[a.team] > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.homeKeeper.reset();
    this.awayKeeper.reset();
    // a HOME forward kicks off from the centre spot
    this.controlled = this.home.length - 2;
    const taker = this.home[this.controlled];
    taker.reset(-1, 0, Math.PI / 2);
    this.setOwner(taker);
    this.passTarget = null;
    this.passTimer = 0;
    this.switchLock = 0;
    this.passCharging = false;
    this.shotCharging = false;
    this.passCharge = 0;
    this.shotCharge = 0;
    this.kickCooldown = 0.3;
    this.celebrateT = 0;
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
