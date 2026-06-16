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
// gentle assist that steers YOUR player onto a loose ball (only when you're
// already heading for it) so imprecise input doesn't just miss it.
const ASSIST_RADIUS = 4.0;
const ASSIST_MAX = 0.55;
const ASSIST_ALIGN = 0.25; // must be moving within ~75° of the ball
const CONTROLLED_CAPTURE_BONUS = 0.18;
const CAM_LEAN = 7; // camera centre may lean this far from the ball (keeps it in frame)
const AIM_RATE = 1.1; // radians/sec the set-piece aim swings with left/right
const SP_POWER_MIN = 8;
const SP_POWER_MAX = 27;
const SP_LOFT_MAX = 9; // extra vertical launch at full charge

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
    this.lastTouchTeam = 'HOME'; // who touched it last (for throw-ins)
    this.kickCooldown = 0;
    this.celebrateT = 0;
    this.passTarget = null;
    this.passTimer = 0;
    this.switchLock = 0;
    this.passCharging = false;
    this.passCharge = 0;
    this.shotCharging = false;
    this.shotCharge = 0;
    this.shotCam = 0; // briefly follow the ball after a shot
    this.kickoffT = 0; // brief lined-up pause before play starts
    this.kickoffTaker = null;
    this.setPiece = null; // active corner / goal kick
    this.switchRank = 0; // how far down the proximity list Q has stepped
    this.lastSwitchT = 0;
    this.presser = {};
    this.cover = {};
    this.support = {};

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._t = new THREE.Vector3();
    this._assist = new THREE.Vector3();
    this._camTarget = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };

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
    if (this.celebrateT > 0 || this.kickoffT > 0) return;
    if (this.setPiece) {
      if (this.setPiece.userControlled && (k === ' ' || k === 'j')) {
        this.setPiece.charging = true;
        this.setPiece.charge = 0;
      }
      return;
    }
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
    if (this.setPiece) {
      if (this.setPiece.userControlled && (k === ' ' || k === 'j') && this.setPiece.charging) {
        this.takeSetPiece(this.setPiece.aim, this.setPiece.charge);
      }
      return;
    }
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

  // A fresh press picks the player nearest the ball; pressing again quickly
  // (insisting) steps to the next-nearest, so you only reach far players if you
  // really keep asking for them.
  manualSwitch() {
    if (this.celebrateT > 0) return;
    const order = this.home
      .map((p, i) => i)
      .sort((a, b) => this.horiz(this.home[a].position, this.ball.position)
        - this.horiz(this.home[b].position, this.ball.position));
    const now = Date.now() / 1000;
    let rank = now - this.lastSwitchT < 0.7 ? this.switchRank + 1 : 0;
    rank = THREE.MathUtils.clamp(rank, 0, order.length - 1);
    if (order[rank] === this.controlled) rank = Math.min(rank + 1, order.length - 1);
    this.controlled = order[rank];
    this.switchRank = rank;
    this.lastSwitchT = now;
    this.switchLock = 1.0;
    this.passTarget = null;
    this.passTimer = 0;
  }

  controlledPlayer() {
    return this.home[this.controlled];
  }

  // Subtly bend the player's run toward a nearby loose ball — but only while
  // they're already moving roughly toward it, and stronger the closer they get,
  // so it reads as "good control" rather than the game taking over.
  _assistDir(me, dir) {
    if (this.ballOwner !== null || me.busy || dir.lengthSq() < 1e-4) return dir;
    const bx = this.ball.position.x - me.position.x;
    const bz = this.ball.position.z - me.position.z;
    const dist = Math.hypot(bx, bz);
    if (dist > ASSIST_RADIUS || dist < 0.4 || this.ball.position.y > 0.6) return dir;
    const tbx = bx / dist;
    const tbz = bz / dist;
    const dl = Math.hypot(dir.x, dir.z) || 1;
    const mx = dir.x / dl;
    const mz = dir.z / dl;
    const align = mx * tbx + mz * tbz; // are they heading toward the ball?
    if (align < ASSIST_ALIGN) return dir; // clearly going elsewhere — leave them
    const prox = THREE.MathUtils.clamp(1 - dist / ASSIST_RADIUS, 0, 1);
    const alignF = THREE.MathUtils.clamp((align - ASSIST_ALIGN) / (1 - ASSIST_ALIGN), 0, 1);
    const k = Math.min(ASSIST_MAX, prox * alignF);
    return this._assist.set(mx * (1 - k) + tbx * k, 0, mz * (1 - k) + tbz * k);
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
    this.shotCam = Math.max(0, this.shotCam - dt);
    if (this.passTimer > 0) this.passTimer = Math.max(0, this.passTimer - dt);
    if (this.passCharging) this.passCharge = Math.min(1, this.passCharge + dt / 0.6);
    if (this.shotCharging) this.shotCharge = Math.min(1, this.shotCharge + dt / 0.75);

    if (this.kickoffT > 0) {
      this.kickoffT -= dt;
      for (const a of this.field) a.update(dt, null, false); // teams hold the lineup
      for (const k of this.keepers) k.update(dt, this.ball, 'own');
      this.ball.position.set(0, BALL.RADIUS, 0); // ball waits on the centre spot
      this.ball.syncMesh();
      if (this.kickoffT <= 0) this.setOwner(this.kickoffTaker); // kickoff is taken
      return;
    }

    if (this.setPiece) {
      this.updateSetPiece(dt);
      return;
    }

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
    me.update(dt, this._assistDir(me, this.inputDir()), this.keys.has('shift'));
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
      if (kr.saved || kr.tookPossession) this.lastTouchTeam = keeper.team;
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
      if (Math.abs(this.ball.position.z) > HW) { // out over a touchline
        this.throwIn(this.lastTouchTeam);
        return;
      }
      if (Math.abs(this.ball.position.x) > HL) { // out over a goal line
        this.goalLineOut();
        return;
      }
      this.resolveLoose();
    }

    this.resolveTackles();
  }

  // --- roles & control ----------------------------------------------------

  precomputeRoles() {
    const owner = this.ballOwner;
    const b = this.ball.position;
    for (const team of ['HOME', 'AWAY']) {
      const arr = this.teamArr(team).slice()
        .sort((x, y) => this.horiz(x.position, b) - this.horiz(y.position, b));
      const teamHas = owner && owner.team === team;
      if (teamHas) {
        this.presser[team] = null;
        this.cover[team] = null;
        this.support[team] = arr.find((p) => p !== owner) || null;
      } else {
        this.presser[team] = arr[0] || null; // nearest engages the ball
        this.cover[team] = arr[1] || null; // second man covers behind
        this.support[team] = null;
      }
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

    if (teamHas) {
      if (a === this.support[team] && owner.roleType !== 'GK') {
        return this.steer(a, this.supportTarget(a, owner), true);
      }
      return this.steer(a, this.formationTarget(a, true));
    }

    // --- defending ---
    if (a === this.presser[team]) {
      const d = this.horiz(a.position, this.ball.position);
      const tackleable = owner && owner.roleType !== 'GK';
      if (tackleable && d < 1.6 && !a.busy && a.captureCooldown <= 0) {
        a.heading = this.headingTo(a, this.ball.position);
        const fast = owner.velocity && Math.hypot(owner.velocity.x, owner.velocity.z) > 4;
        if (fast && d > 0.9) a.startSlide();
        else a.startTackle();
        a.captureCooldown = 0.8;
        return { dir: null, sprint: false };
      }
      return this.steer(a, this.ball.position, true); // close the carrier down
    }
    if (a === this.cover[team]) return this.steer(a, this.coverTarget(a), true);
    return this.steer(a, this.defendTarget(a), true); // collapse with the unit
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

  // The covering defender drops a few metres goal-side of the ball, backing up
  // the presser in case they're beaten.
  coverTarget(a) {
    const s = ATTACK_SIGN[a.team];
    const tx = THREE.MathUtils.clamp(this.ball.position.x - s * 5, -HL + 2, HL - 2);
    const tz = THREE.MathUtils.clamp(this.ball.position.z * 0.5, -HW + 2, HW - 2);
    return this._t.set(tx, 0, tz);
  }

  // Off-ball defenders collapse toward (goal-side of) the ball as the attack
  // gets closer to our goal — the whole unit shrinks the space, not just one.
  defendTarget(a) {
    const s = ATTACK_SIGN[a.team];
    const ownGoalX = -s * HL;
    const distFromGoal = Math.abs(this.ball.position.x - ownGoalX);
    const danger = THREE.MathUtils.clamp(1 - distFromGoal / 35, 0, 1);
    const base = this.formationTarget(a, false); // elastic slot (drops with the line)
    const bx = base.x;
    const bz = base.z;
    const goalSideX = this.ball.position.x - s * 4;
    const collapse = danger * 0.65;
    let tx = THREE.MathUtils.lerp(bx, goalSideX, collapse);
    let tz = THREE.MathUtils.lerp(bz, this.ball.position.z * 0.55, collapse);
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
    let ax = dx / dist;
    let az = dz / dist;
    const spread = THREE.MathUtils.lerp(0.02, 0.2, THREE.MathUtils.clamp((dist - 8) / 20, 0, 1));
    const e = (Math.random() * 2 - 1) * spread;
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const power = 30;
    this.releaseBall(a, (ax * ce - az * se) * power, power * 0.12, (ax * se + az * ce) * power);
  }

  aiPass(a, mate) {
    const power = 21;
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
    if (Math.abs(pos.z) > HW) { // dribbled out over a touchline
      this.throwIn(owner.team);
      return;
    }
    if (Math.abs(pos.x) > HL) { // dribbled out over a goal line
      this.goalLineOut();
      return;
    }
    this.ball.angularVelocity.set(vel.z / r, 0, -vel.x / r);
    this.ball.spin(dt);
    this.ball.syncMesh();
  }

  resolveLoose() {
    for (const a of this.field) this.bodyCollide(a);
    const ctrl = this.controlledPlayer();
    let best = null;
    let bd = Infinity;
    for (const a of this.field) {
      if (a.captureCooldown > 0 || a.busy) continue;
      const cap = a === ctrl ? CAPTURE_RADIUS + CONTROLLED_CAPTURE_BONUS : CAPTURE_RADIUS;
      const d = this.horiz(a.position, this.ball.position);
      if (d < cap && this.ball.position.y < CAPTURE_MAX_Y && d < bd) { best = a; bd = d; }
    }
    if (best) this.gainPossession(best);
  }

  gainPossession(agent) {
    this.setOwner(agent);
    this.lastTouchTeam = agent.team;
    this.ball.velocity.multiplyScalar(0.25);
    this.ball.position.y = BALL.RADIUS;
  }

  // The ball went out over a touchline — restart with a throw-in for the team
  // that didn't touch it last (placed at the point it crossed the line).
  throwIn(lastTeam) {
    const side = this.ball.position.z >= 0 ? 1 : -1;
    const spotX = THREE.MathUtils.clamp(this.ball.position.x, -HL + 1, HL - 1);
    const team = lastTeam === 'HOME' ? 'AWAY' : 'HOME';
    const arr = this.teamArr(team);
    let thrower = arr[0];
    let bd = Infinity;
    for (const p of arr) {
      const d = Math.hypot(p.position.x - spotX, p.position.z - side * HW);
      if (d < bd) { bd = d; thrower = p; }
    }
    thrower.reset(spotX, side * (HW + 0.3), side > 0 ? Math.PI : 0); // just off the line, facing in
    this.ball.position.set(spotX, BALL.RADIUS, side * HW);
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
    this.setOwner(thrower);
    thrower.captureCooldown = 0;
    this.lastTouchTeam = team;
    if (team === 'HOME') {
      this.controlled = this.home.indexOf(thrower);
      this.switchLock = 1.0;
    }
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
        this.lastTouchTeam = a.team; // a deflection counts as a touch
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
    this.lastTouchTeam = kicker.team;
    this.kickCooldown = KICK_COOLDOWN;
    kicker.captureCooldown = KICK_COOLDOWN;
    this.ball.velocity.set(vx, vy, vz);
    this.ball.position.y = Math.max(this.ball.position.y, BALL.RADIUS);
  }

  // Pass to the teammate that's both nearby and in the direction you're facing.
  choosePassTarget(me) {
    const fx = Math.sin(me.heading);
    const fz = Math.cos(me.heading);
    let best = null;
    let bestScore = -Infinity;
    let nearest = null;
    let nd = Infinity;
    for (const m of this.home) {
      if (m === me) continue;
      const dx = m.position.x - me.position.x;
      const dz = m.position.z - me.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < nd) { nd = d; nearest = m; }
      const align = (dx / d) * fx + (dz / d) * fz; // how much they're in front of you
      if (align < 0.2) continue; // not in the direction you're facing
      const score = align - d * 0.05; // in your direction, and the closer the better
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best || nearest;
  }

  pass(me, charge = 0.5) {
    const mate = this.choosePassTarget(me);
    if (!mate) return;
    const power = THREE.MathUtils.lerp(10.5, 27, charge);
    const lead = this.horiz(this.ball.position, mate.position) / Math.max(6, power);
    const tx = mate.position.x + mate.velocity.x * lead;
    const tz = mate.position.z + mate.velocity.z * lead;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.releaseBall(me, (dx / d) * power, 0.5, (dz / d) * power);
    this.handOverTo(mate);
  }

  // Goes where the PLAYER faces — only a small goal-assist that fades with
  // distance — and the further out the more it can spray, so long-range shots
  // only go in if you're aimed well (and a little lucky).
  shoot(me, charge = 1) {
    const bx = this.ball.position.x;
    const bz = this.ball.position.z;
    const dx = HOME_ATTACK_X - bx;
    const dz = 0 - bz;
    const dist = Math.hypot(dx, dz) || 1;
    const near = THREE.MathUtils.clamp((dist - 6) / 26, 0, 1); // 0 close, 1 far
    const assist = THREE.MathUtils.lerp(0.5, 0.05, near); // less help the further out
    const fx = Math.sin(me.heading);
    const fz = Math.cos(me.heading);
    let ax = fx * (1 - assist) + (dx / dist) * assist;
    let az = fz * (1 - assist) + (dz / dist) * assist;
    const al = Math.hypot(ax, az);
    if (al < 0.05) { ax = fx; az = fz; } // facing dead away from goal: go where you face
    else { ax /= al; az /= al; }
    const spread = THREE.MathUtils.lerp(0.03, 0.5, near); // distance-based spray
    const e = (Math.random() * 2 - 1) * spread;
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const power = THREE.MathUtils.lerp(13.5, 34.5, charge);
    const vy = 0.5 + charge * 6.5; // strength decides how high it goes
    this.releaseBall(me, (ax * ce - az * se) * power, vy, (ax * se + az * ce) * power);
    this.shotCam = 1.6; // watch the ball, not the shooter
  }

  // The camera always keeps the ball in frame: it centres near the ball, leaning
  // toward your player, but never further than CAM_LEAN from the ball. Right
  // after a shot it sits almost fully on the ball so you can watch the effort.
  cameraTarget() {
    const ball = this.ball.position;
    const me = this.controlledPlayer().position;
    const f = this.shotCam > 0 ? 0.15 : 0.5;
    let ox = (me.x - ball.x) * f;
    let oz = (me.z - ball.z) * f;
    const len = Math.hypot(ox, oz);
    if (len > CAM_LEAN) {
      ox *= CAM_LEAN / len;
      oz *= CAM_LEAN / len;
    }
    this._camTarget.position.set(ball.x + ox, 0, ball.z + oz);
    this._camTarget.velocity.copy(this.controlledPlayer().velocity);
    return this._camTarget;
  }

  // Charge state for the on-screen power bar while passing / shooting / set-piece.
  chargeInfo() {
    if (this.setPiece && this.setPiece.charging) return { active: true, value: this.setPiece.charge, kind: 'shot' };
    if (this.shotCharging) return { active: true, value: this.shotCharge, kind: 'shot' };
    if (this.passCharging) return { active: true, value: this.passCharge, kind: 'pass' };
    return { active: false, value: 0, kind: '' };
  }

  keeperOf(team) {
    return team === 'HOME' ? this.homeKeeper : this.awayKeeper;
  }

  // The player to follow / ring / name — the set-piece taker if you're taking one.
  activePlayer() {
    if (this.setPiece && this.setPiece.userControlled) return this.setPiece.taker;
    return this.controlledPlayer();
  }

  setPieceActive() {
    return this.setPiece;
  }

  // Behind-the-taker camera info while taking a set-piece (aim direction included).
  setPieceCamInfo() {
    const sp = this.setPiece;
    return { pos: sp.taker.position, dx: Math.sin(sp.aim), dz: Math.cos(sp.aim) };
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

  // --- set pieces (corner / goal kick) ------------------------------------

  // A ball out over a goal line: corner if the defenders put it out, else goal kick.
  goalLineOut() {
    const side = this.ball.position.x >= 0 ? 1 : -1; // which goal line it crossed
    const defendingTeam = side > 0 ? 'AWAY' : 'HOME'; // AWAY defends +X, HOME defends -X
    if (this.lastTouchTeam === defendingTeam) {
      const cz = this.ball.position.z >= 0 ? 1 : -1;
      this.startCorner(defendingTeam === 'HOME' ? 'AWAY' : 'HOME', side, cz);
    } else {
      this.startGoalKick(defendingTeam, side);
    }
  }

  startGoalKick(team, side) {
    const keeper = this.keeperOf(team);
    this.placeGoalKick(team, side);
    keeper.reset();
    keeper.position.set(side * (HL - 5.5), 0, 0); // out of the goal area to take it
    const aim = Math.atan2(-side, 0); // face up the pitch, away from our own goal
    this.setPiece = {
      type: 'goalkick', team, taker: keeper, aim, aimMin: aim - 1.0, aimMax: aim + 1.0,
      charge: 0, charging: false, userControlled: team === 'HOME', t: 0
    };
    this.ballOwner = null;
    this.positionSetPieceBall();
  }

  startCorner(team, side, cz) {
    const gx = side * HL;
    const att = this.teamArr(team);
    const taker = att[8]; // a forward takes the corner
    this.placeCorner(team, side, cz, taker);
    taker.reset(side * (HL - 0.5), cz * (HW - 0.5), 0);
    const aim = Math.atan2(gx - taker.position.x, 0 - taker.position.z); // toward the goal mouth
    taker.heading = aim;
    this.setPiece = {
      type: 'corner', team, taker, aim, aimMin: aim - 0.9, aimMax: aim + 0.9,
      charge: 0, charging: false, userControlled: team === 'HOME', t: 0
    };
    this.ballOwner = null;
    this.positionSetPieceBall();
  }

  placeGoalKick(team, side) {
    const gx = side * HL;
    const def = this.teamArr(team);
    const att = this.teamArr(team === 'HOME' ? 'AWAY' : 'HOME');
    const faceUp = Math.atan2(-side, 0);
    const faceGoal = Math.atan2(side, 0);
    def.forEach((p, i) => {
      const row = Math.floor(i / 4);
      p.reset(gx - side * (13 + row * 7), -22 + (i % 5) * 11, faceUp);
    });
    att.forEach((p, i) => {
      p.reset(gx - side * (24 + (i % 3) * 5), -20 + (i % 5) * 10, faceGoal);
    });
    this.keeperOf(team === 'HOME' ? 'AWAY' : 'HOME').reset();
  }

  placeCorner(team, side, cz, taker) {
    const gx = side * HL;
    const att = this.teamArr(team);
    const def = this.teamArr(team === 'HOME' ? 'AWAY' : 'HOME');
    const faceGoal = Math.atan2(side, 0);
    const faceOut = Math.atan2(-side, 0);
    att.filter((p) => p !== taker).forEach((p, i) => {
      p.reset(gx - side * (5 + (i % 3) * 3), -10 + (i * 4) % 20, faceGoal);
    });
    def.forEach((p, i) => {
      p.reset(gx - side * (3 + (i % 3) * 2.5), -11 + (i * 3) % 22, faceOut);
    });
    this.keeperOf(team).reset();
    this.keeperOf(team === 'HOME' ? 'AWAY' : 'HOME').reset();
  }

  positionSetPieceBall() {
    const sp = this.setPiece;
    const dx = Math.sin(sp.aim);
    const dz = Math.cos(sp.aim);
    this.ball.position.set(sp.taker.position.x + dx * 0.45, BALL.RADIUS, sp.taker.position.z + dz * 0.45);
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
  }

  updateSetPiece(dt) {
    const sp = this.setPiece;
    sp.t += dt;
    if (sp.userControlled) {
      if (this.keys.has('a') || this.keys.has('arrowleft')) sp.aim += AIM_RATE * dt;
      if (this.keys.has('d') || this.keys.has('arrowright')) sp.aim -= AIM_RATE * dt;
      sp.aim = THREE.MathUtils.clamp(sp.aim, sp.aimMin, sp.aimMax);
      if (sp.charging) sp.charge = Math.min(1, sp.charge + dt / 0.85);
    } else if (sp.t > 1.2) {
      this.takeSetPiece(sp.aim, 0.6); // AI takes it
      return;
    }
    // taker faces the aim; ball sits at the kicking spot
    sp.taker.heading = sp.aim;
    if (sp.taker.roleType === 'GK') sp.taker.object.rotation.y = sp.aim;
    this.positionSetPieceBall();
    // advance everyone's mixers (held in their set-piece spots)
    for (const a of this.field) if (a !== sp.taker) a.update(dt, null, false);
    for (const k of this.keepers) if (k !== sp.taker) k.update(dt, this.ball, 'own');
    if (sp.taker.roleType === 'GK') sp.taker.mixer.update(dt);
    else sp.taker.update(dt, null, false);
  }

  takeSetPiece(aim, charge) {
    const sp = this.setPiece;
    const power = THREE.MathUtils.lerp(SP_POWER_MIN, SP_POWER_MAX, charge);
    const vy = 1 + charge * SP_LOFT_MAX; // strength sets both pace and height
    this.lastTouchTeam = sp.team;
    this.ballOwner = null;
    this.kickCooldown = KICK_COOLDOWN;
    sp.taker.captureCooldown = KICK_COOLDOWN;
    this.ball.velocity.set(Math.sin(aim) * power, vy, Math.cos(aim) * power);
    this.ball.position.y = Math.max(this.ball.position.y, BALL.RADIUS);
    this.setPiece = null;
    this.switchLock = 0; // snap back to normal control + camera
  }

  kickoff() {
    this.setPiece = null;
    this.ball.reset(0, 0);
    for (const a of this.field) {
      a.reset(a.homePos.x, a.homePos.z, ATTACK_SIGN[a.team] > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.homeKeeper.reset();
    this.awayKeeper.reset();
    // both teams line up in their halves; a HOME forward stands over the spot
    this.controlled = this.home.length - 2;
    this.kickoffTaker = this.home[this.controlled];
    this.kickoffTaker.reset(-1.2, 0, Math.PI / 2);
    this.ball.position.set(0, BALL.RADIUS, 0);
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
    this.setOwner(null); // dead until the brief kickoff pause ends
    this.kickoffT = 1.2;
    this.passTarget = null;
    this.passTimer = 0;
    this.switchLock = 0;
    this.passCharging = false;
    this.shotCharging = false;
    this.passCharge = 0;
    this.shotCharge = 0;
    this.kickCooldown = 0.3;
    this.celebrateT = 0;
    this.lastTouchTeam = 'HOME';
    this.shotCam = 0;
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
