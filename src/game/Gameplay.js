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

// Couch-play control schemes (one per human). Keys are distinct so two players
// share a keyboard: P1 on the left (WASD + space/J/K/X/Q), P2 on the right
// (arrows + a right-hand cluster). Movement is camera-relative for both.
export const SCHEMES = {
  P1: { up: 'w', down: 's', left: 'a', right: 'd', sprint: 'shift', action: ' ', shoot: 'j', cross: 'k', slide: 'x', switch: 'q' },
  P2: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', sprint: '/', action: '.', shoot: 'l', cross: 'o', slide: ',', switch: 'p' }
};
export const RING_COLORS = { P1: 0xffe14d, P2: 0x34e0ff };

const HL = FIELD.HALF_LENGTH;
const HW = FIELD.HALF_WIDTH;

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
    // team identity (code + banner colour); the team-select screen overrides it
    this.teamId = {
      HOME: { short: TEAMS.HOME.short, name: TEAMS.HOME.name, primary: TEAMS.HOME.primary },
      AWAY: { short: TEAMS.AWAY.short, name: TEAMS.AWAY.name, primary: TEAMS.AWAY.primary }
    };
    this.active = false; // match input/clock are off until the menu kicks off
    this.keys = new Set();
    this.humans = []; // 1 or 2 human controllers, set up at kickoff
    this.ballOwner = null;
    this.lastTouchTeam = 'HOME'; // who touched it last (for throw-ins)
    this.kickCooldown = 0;
    this.celebrateT = 0;
    this.shotCam = 0; // briefly follow the ball after a shot
    this.kickoffT = 0; // brief lined-up pause before play starts
    this.kickoffTaker = null;
    this.setPiece = null; // active corner / goal kick
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

    this.setupHumans([{ id: 'P1', side: 'HOME', scheme: SCHEMES.P1 }]); // default solo
    this.bind();
    this.kickoff();
  }

  // Build the human controllers from a list of { id, side, scheme }. Each owns
  // its own side, control index, switch/charge state and ring colour. Two on the
  // same side is co-op (they control different players); opposite sides is
  // versus. Everything that used to be "the user" is now per-controller, keyed
  // off the controlled player's team — so scoring/restarts stay physical.
  setupHumans(configs) {
    const list = configs && configs.length ? configs : [{ id: 'P1', side: 'HOME', scheme: SCHEMES.P1 }];
    const self = this;
    this.humans = list.map((c) => ({
      id: c.id,
      side: c.side,
      scheme: c.scheme,
      team: c.side === 'HOME' ? self.home : self.away,
      sign: ATTACK_SIGN[c.side],
      attackX: ATTACK_SIGN[c.side] * HL,
      ringColor: RING_COLORS[c.id] != null ? RING_COLORS[c.id] : 0xffe14d,
      controlled: 0,
      switchLock: 0,
      switchRank: 0,
      lastSwitchT: 0,
      passTarget: null,
      passTimer: 0,
      passCharging: false,
      passCharge: 0,
      shotCharging: false,
      shotCharge: 0,
      player() { return this.team[this.controlled]; }
    }));
  }

  // back-compat convenience: the "primary" human (used by the single-player
  // camera lean and the controlledPlayer() helper).
  get userSide() { return this.humans[0] ? this.humans[0].side : 'HOME'; }

  // --- input --------------------------------------------------------------

  bind() {
    addEventListener('keydown', (e) => {
      if (!this.active) return; // the menu owns input until kickoff
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'r') { this.kickoff(); return; }
      for (const h of this.humans) {
        const s = h.scheme;
        if (k === s.switch) { this.manualSwitch(h); return; }
        if (k === s.action) { this.onAction(h, 'action', true); return; }
        if (k === s.shoot) { this.onAction(h, 'shoot', true); return; }
        if (k === s.cross) { this.onAction(h, 'cross', true); return; }
        if (k === s.slide) { this.onAction(h, 'slide', true); return; }
      }
    });
    addEventListener('keyup', (e) => {
      if (!this.active) return;
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      for (const h of this.humans) {
        const s = h.scheme;
        if (k === s.action) { this.onAction(h, 'action', false); return; }
        if (k === s.shoot) { this.onAction(h, 'shoot', false); return; }
      }
    });
  }

  // One controller pressed/released an action key.
  onAction(h, kind, down) {
    if (this.celebrateT > 0 || this.kickoffT > 0) return;
    if (this.setPiece) {
      if (this.setPiece.controller === h && (kind === 'action' || kind === 'shoot')) {
        if (down) { this.setPiece.charging = true; this.setPiece.charge = 0; }
        else if (this.setPiece.charging) this.takeSetPiece(this.setPiece.aim, this.setPiece.charge);
      }
      return;
    }
    const me = h.player();
    if (me.busy) return;
    if (this.ballOwner === me) {
      if (kind === 'action') {
        if (down) { h.passCharging = true; h.passCharge = 0; }
        else if (h.passCharging) { h.passCharging = false; this.pass(me, h.passCharge, h); h.passCharge = 0; }
      } else if (kind === 'shoot') {
        if (down) { h.shotCharging = true; h.shotCharge = 0; }
        else if (h.shotCharging) { h.shotCharging = false; this.shoot(me, h.shotCharge); h.shotCharge = 0; }
      } else if (kind === 'cross' && down) {
        this.cross(me, h);
      }
    } else if (down) {
      if (kind === 'action') me.startTackle();
      else if (kind === 'slide') me.startSlide();
    }
  }

  // A fresh press picks the player nearest the ball; pressing again quickly
  // (insisting) steps to the next-nearest, so you only reach far players if you
  // really keep asking for them. A co-op partner's player is never offered.
  manualSwitch(h) {
    if (this.celebrateT > 0) return;
    const mates = this.partnerHeld(h);
    const order = h.team
      .map((p, i) => i)
      .filter((i) => !mates.has(i))
      .sort((a, b) => this.horiz(h.team[a].position, this.ball.position)
        - this.horiz(h.team[b].position, this.ball.position));
    if (!order.length) return;
    const now = Date.now() / 1000;
    let rank = now - h.lastSwitchT < 0.7 ? h.switchRank + 1 : 0;
    rank = THREE.MathUtils.clamp(rank, 0, order.length - 1);
    if (order[rank] === h.controlled) rank = Math.min(rank + 1, order.length - 1);
    h.controlled = order[rank];
    h.switchRank = rank;
    h.lastSwitchT = now;
    h.switchLock = 1.0;
    h.passTarget = null;
    h.passTimer = 0;
  }

  // indices controlled by this human's co-op partner(s) on the same side
  partnerHeld(h) {
    const set = new Set();
    for (const o of this.humans) if (o !== h && o.side === h.side) set.add(o.controlled);
    return set;
  }

  controlledPlayer() {
    return this.humans[0].player();
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

  // Camera-relative movement for one controller. When a single human is playing,
  // they also get the arrow keys (so solo play keeps WASD + arrows as before).
  inputDir(h) {
    this.rig.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-4) this._fwd.set(0, 0, 1);
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();
    this._dir.set(0, 0, 0);
    const s = h.scheme;
    const solo = this.humans.length === 1;
    const k = this.keys;
    const up = k.has(s.up) || (solo && k.has('arrowup'));
    const down = k.has(s.down) || (solo && k.has('arrowdown'));
    const right = k.has(s.right) || (solo && k.has('arrowright'));
    const left = k.has(s.left) || (solo && k.has('arrowleft'));
    if (up) this._dir.add(this._fwd);
    if (down) this._dir.sub(this._fwd);
    if (right) this._dir.add(this._right);
    if (left) this._dir.sub(this._right);
    return this._dir;
  }

  sprintHeld(h) {
    return this.keys.has(h.scheme.sprint);
  }

  // --- main update --------------------------------------------------------

  update(dt) {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.shotCam = Math.max(0, this.shotCam - dt);
    for (const h of this.humans) {
      if (h.passTimer > 0) h.passTimer = Math.max(0, h.passTimer - dt);
      if (h.passCharging) h.passCharge = Math.min(1, h.passCharge + dt / 0.6);
      if (h.shotCharging) h.shotCharge = Math.min(1, h.shotCharge + dt / 0.75);
    }

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

    // cancel a charge if that controller no longer has the ball
    for (const h of this.humans) {
      if ((h.passCharging || h.shotCharging) && this.ballOwner !== h.player()) {
        h.passCharging = false; h.shotCharging = false; h.passCharge = 0; h.shotCharge = 0;
      }
    }
    for (const a of this.field) a.carrying = a === this.ballOwner; // 15% slower on the ball

    // each human drives their player; everyone else is AI
    const driven = new Set();
    for (const h of this.humans) {
      const me = h.player();
      if (driven.has(me)) continue; // safety: never drive one player from two pads
      driven.add(me);
      me.update(dt, this._assistDir(me, this.inputDir(h)), this.sprintHeld(h));
    }
    for (const a of this.field) {
      if (driven.has(a)) continue;
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
    for (const h of this.humans) h.switchLock = Math.max(0, h.switchLock - dt);
    for (const side of ['HOME', 'AWAY']) {
      const hs = this.humans.filter((h) => h.side === side);
      if (hs.length) this.assignTeamControl(side, hs);
    }
  }

  // Decide which player each human on a side controls. With one controller
  // (solo / versus) this is the classic auto-switch. With two (co-op) it follows
  // eFootball: the human "in the action" controls the ball / presser, the other
  // keeps their own player (continuity) — so a pass hands the ball to whichever
  // team-mate's pad is nearer, never always P1, and they never share a player.
  assignTeamControl(side, hs) {
    const team = this.teamArr(side);
    const owner = this.ballOwner;
    const ownerOnTeam = owner && owner.team === side && team.includes(owner);

    // ---- single controller (solo / versus): classic behaviour --------------
    if (hs.length === 1) {
      const h = hs[0];
      if (ownerOnTeam) { h.controlled = team.indexOf(owner); return; }
      if (h.passTarget && h.passTimer > 0) { h.controlled = team.indexOf(h.passTarget); return; }
      if (h.switchLock <= 0) {
        const n = this.nearestIndex(team, this.ball.position);
        if (n !== h.controlled) { h.controlled = n; h.switchLock = 1.0; }
      }
      return;
    }

    // ---- co-op: two controllers on one side --------------------------------
    // Our own ball in flight (e.g. a pass): nobody chases it — hold shape, so the
    // receiver is collected and taken over by whoever's nearest, not the passer.
    if (!owner && this.lastTouchTeam === side) { this.coopDistinct(hs, team); return; }

    let focusIdx;
    let respectLock;
    if (ownerOnTeam) { focusIdx = team.indexOf(owner); respectLock = false; } // follow the ball
    else { focusIdx = this.nearestIndex(team, this.ball.position); respectLock = true; } // press the ball

    // the human "in the action" is whoever already controls the focus player,
    // else whoever's current player is nearest the ball
    let focus = hs.find((h) => h.controlled === focusIdx);
    if (!focus) {
      focus = hs.slice().sort((a, b) =>
        this.horiz(a.player().position, this.ball.position) - this.horiz(b.player().position, this.ball.position))[0];
    }
    if (focus.controlled !== focusIdx && (!respectLock || focus.switchLock <= 0)) {
      focus.controlled = focusIdx;
      focus.switchLock = 1.0;
    }
    this.coopDistinct(hs, team, focus);
  }

  // Two co-op controllers must hold different players: if they collide, the
  // non-"keep" controller steps to the nearest free team-mate to their position.
  coopDistinct(hs, team, keep = null) {
    if (hs.length < 2 || hs[0].controlled !== hs[1].controlled) return;
    const collide = hs[0].controlled;
    const mover = keep ? (keep === hs[0] ? hs[1] : hs[0]) : hs[1];
    const idx = this.nearestIndexExcluding(team, mover.player().position, new Set([collide]));
    if (idx >= 0) mover.controlled = idx;
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
    const human = new Set(this.humans.map((h) => h.player()));
    let best = null;
    let bd = Infinity;
    for (const a of this.field) {
      if (a.captureCooldown > 0 || a.busy) continue;
      const cap = human.has(a) ? CAPTURE_RADIUS + CONTROLLED_CAPTURE_BONUS : CAPTURE_RADIUS;
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
    // hand the throw to a human on that side (the nearest, in co-op)
    const hs = this.humans.filter((h) => h.side === team);
    if (hs.length) {
      const h = hs.sort((a, b) => this.horiz(a.player().position, thrower.position)
        - this.horiz(b.player().position, thrower.position))[0];
      h.controlled = team === 'HOME' ? this.home.indexOf(thrower) : this.away.indexOf(thrower);
      h.switchLock = 1.0;
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
    for (const m of this.teamArr(me.team)) {
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

  pass(me, charge = 0.5, h = null) {
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
    this.handOverTo(mate, h);
  }

  // Goes where the PLAYER faces — only a small goal-assist that fades with
  // distance — and the further out the more it can spray, so long-range shots
  // only go in if you're aimed well (and a little lucky).
  shoot(me, charge = 1) {
    const bx = this.ball.position.x;
    const bz = this.ball.position.z;
    const dx = ATTACK_SIGN[me.team] * HL - bx; // toward the goal me's team attacks
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
    const vy = 2.5 + charge * 8.0; // strength decides how high it lifts — even a measured shot rises off the turf, but over-hit it for the distance and it sails over the bar
    this.releaseBall(me, (ax * ce - az * se) * power, vy, (ax * se + az * ce) * power);
    this.shotCam = 1.6; // watch the ball, not the shooter
  }

  // The camera always keeps the ball in frame. Solo, it leans toward your
  // player (capped at CAM_LEAN). With two controllers (especially versus, where
  // they can be far apart) it centres on the ball instead — the one focal point
  // both players' action revolves around — so neither gets pushed off-screen.
  cameraTarget() {
    const ball = this.ball.position;
    if (this.humans.length >= 2) {
      this._camTarget.position.set(ball.x, 0, ball.z);
      this._camTarget.velocity.set(this.ball.velocity.x, 0, this.ball.velocity.z);
      return this._camTarget;
    }
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

  // Power-bar state per controller (and the set-piece taker) for the on-screen
  // charge bars; each entry knows the player to draw under.
  chargeInfos() {
    const out = [];
    if (this.setPiece && this.setPiece.charging) {
      out.push({ value: this.setPiece.charge, kind: 'shot', player: this.setPiece.taker });
    }
    for (const h of this.humans) {
      if (h.shotCharging) out.push({ value: h.shotCharge, kind: 'shot', player: h.player() });
      else if (h.passCharging) out.push({ value: h.passCharge, kind: 'pass', player: h.player() });
    }
    return out;
  }

  keeperOf(team) {
    return team === 'HOME' ? this.homeKeeper : this.awayKeeper;
  }

  // The player each human follows / rings — the set-piece taker if they're
  // taking one, otherwise their controlled player.
  humanActivePlayer(h) {
    if (this.setPiece && this.setPiece.controller === h) return this.setPiece.taker;
    return h.player();
  }

  // back-compat single-player accessor (camera lean / ring fallback)
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

  cross(me, h = null) {
    const s = ATTACK_SIGN[me.team]; // toward me's attacking half
    const attackX = s * HL;
    let mate = null;
    let bestAhead = -Infinity;
    for (const m of this.teamArr(me.team)) {
      if (m === me) continue;
      const ahead = m.position.x * s; // how far up your attacking half they are
      if (ahead > 25 && ahead > bestAhead) { bestAhead = ahead; mate = m; }
    }
    let tx;
    let tz;
    if (mate) {
      tx = mate.position.x;
      tz = mate.position.z;
    } else {
      tx = attackX - s * 9;
      tz = me.position.z > 0 ? -3.5 : 3.5;
    }
    const near = attackX - s * 4; // edge nearest the goal line
    const far = attackX - s * 16; // edge of the box
    tx = THREE.MathUtils.clamp(tx, Math.min(near, far), Math.max(near, far));
    tz = THREE.MathUtils.clamp(tz, -18, 18);
    const T = 1.15;
    const dx = tx - this.ball.position.x;
    const dz = tz - this.ball.position.z;
    this.releaseBall(me, dx / T, 0.5 * GRAVITY * T, dz / T);
    if (mate) this.handOverTo(mate, h);
  }

  // Switch the passing controller's control to the receiver while the pass is
  // in flight (so you follow your pass) — but only when that controller is the
  // sole human on their side. In co-op the passer does NOT follow; the receiver
  // is taken over by whichever team-mate's pad is nearest (handled in control).
  handOverTo(mate, h = null) {
    if (!h) return;
    if (this.humans.filter((x) => x.side === h.side).length > 1) return; // co-op
    h.passTarget = mate;
    h.passTimer = 2.0;
    h.controlled = h.team.indexOf(mate);
  }

  // --- helpers ------------------------------------------------------------

  setOwner(o) {
    this.ballOwner = o;
    if (o) {
      for (const h of this.humans) { h.passTarget = null; h.passTimer = 0; }
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

  // nearest player index to pos, skipping any indices in `exclude` (so two
  // co-op controllers never land on the same player). -1 if all excluded.
  nearestIndexExcluding(arr, pos, exclude) {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (exclude.has(i)) continue;
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
    const controller = this.humans.find((h) => h.side === team) || null;
    this.setPiece = {
      type: 'goalkick', team, taker: keeper, aim, aimMin: aim - 1.0, aimMax: aim + 1.0,
      charge: 0, charging: false, userControlled: !!controller, controller, t: 0
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
    const controller = this.humans.find((h) => h.side === team) || null;
    this.setPiece = {
      type: 'corner', team, taker, aim, aimMin: aim - 0.9, aimMax: aim + 0.9,
      charge: 0, charging: false, userControlled: !!controller, controller, t: 0
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
    if (sp.userControlled && sp.controller) {
      // aim with the taking controller's own left/right keys (so in versus the
      // correct side's angle is used, not always P1's)
      const s = sp.controller.scheme;
      if (this.keys.has(s.left)) sp.aim += AIM_RATE * dt;
      if (this.keys.has(s.right)) sp.aim -= AIM_RATE * dt;
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
    for (const h of this.humans) h.switchLock = 0; // snap back to normal control
  }

  kickoff() {
    this.setPiece = null;
    this.ball.reset(0, 0);
    for (const a of this.field) {
      a.reset(a.homePos.x, a.homePos.z, ATTACK_SIGN[a.team] > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.homeKeeper.reset();
    this.awayKeeper.reset();
    // the kicking side is the first human's team; one of their forwards stands
    // over the spot (just inside their half, facing the way they attack)
    const koSide = this.humans[0] ? this.humans[0].side : 'HOME';
    const koSign = ATTACK_SIGN[koSide];
    const koTeam = this.teamArr(koSide);
    const takerIdx = koTeam.length - 2;
    this.kickoffTaker = koTeam[takerIdx];
    this.kickoffTaker.reset(-koSign * 1.2, 0, koSign > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.ball.position.set(0, BALL.RADIUS, 0);
    this.ball.velocity.set(0, 0, 0);
    this.ball.angularVelocity.set(0, 0, 0);
    this.ball.syncMesh();
    this.setOwner(null); // dead until the brief kickoff pause ends
    this.kickoffT = 1.2;
    // reset each controller and seat them on distinct players (the kicking
    // side's first human takes the spot-kicker)
    for (const h of this.humans) {
      h.passTarget = null; h.passTimer = 0; h.switchLock = 0;
      h.passCharging = false; h.shotCharging = false; h.passCharge = 0; h.shotCharge = 0;
      h.controlled = h.side === koSide ? takerIdx : h.team.length - 1;
    }
    for (const side of ['HOME', 'AWAY']) {
      const used = new Set();
      for (const h of this.humans.filter((x) => x.side === side)) {
        let idx = h.controlled;
        while (used.has(idx)) idx = (idx + 1) % h.team.length;
        h.controlled = idx; used.add(idx);
      }
    }
    this.kickCooldown = 0.3;
    this.celebrateT = 0;
    this.lastTouchTeam = koSide;
    this.shotCam = 0;
    this.hud.hideGoal();
  }

  // Keeps the scene alive behind the main menu: players idle in their kickoff
  // lineup, keepers settle, the ball waits on the spot — no clock, no input.
  menuIdle(dt) {
    for (const a of this.field) a.update(dt, null, false);
    for (const k of this.keepers) k.update(dt, this.ball, 'own');
    this.ball.position.set(0, BALL.RADIUS, 0);
    this.ball.syncMesh();
  }

  // Apply the picked national teams: repaint each side's kit and point the
  // scoreboard / goal banner at the new identities. The +X goal stays a HOME
  // goal, so scoring is unaffected — only colours and labels change.
  applyTeams(homeNation, awayNation) {
    if (homeNation) {
      this.teamId.HOME = { short: homeNation.id, name: homeNation.name, primary: homeNation.colors.shirt };
      for (const p of this.home) p.setKitColors(homeNation.colors);
    }
    if (awayNation) {
      this.teamId.AWAY = { short: awayNation.id, name: awayNation.name, primary: awayNation.colors.shirt };
      for (const p of this.away) p.setKitColors(awayNation.colors);
    }
    this.hud.setTeams(this.teamId.HOME, this.teamId.AWAY);
  }

  // Called from the menu flow: set up the human controllers (1 or 2), apply the
  // picked teams, enable input and start a fresh kickoff.
  startMatch(humanConfigs = null, homeNation = null, awayNation = null) {
    this.setupHumans(humanConfigs);
    this.applyTeams(homeNation, awayNation);
    this.active = true;
    this.kickoff();
  }

  onGoal(scorer) {
    this.setOwner(null);
    this.score[scorer]++;
    this.hud.setScore(this.score.HOME, this.score.AWAY);
    this.hud.showGoal({ primary: this.teamId[scorer].primary });
    this.celebrateT = 2.6;
  }
}
