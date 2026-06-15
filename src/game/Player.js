/**
 * Player.js — the controllable outfield player.
 *
 * Loads the baked character art (src/assets/player.glb — a rigged, skinned mesh
 * with the authored idle / walk / run clips, exported as standard glTF) and
 * drives it: smooth acceleration, turning to face the run, and a speed-based
 * cross-fade between the clips with stride-synced playback. If the asset can't
 * be loaded it falls back to building the identical rig in-engine.
 *
 * The animation is played back by an AnimationMixer from the designed clips —
 * the motion is authored art, not per-frame procedural code.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import playerAssetUrl from '../assets/player.glb';
import { buildPlayerRig } from './player/PlayerRig.js';
import { buildPlayerClips } from './player/PlayerAnimations.js';

const WALK_SPEED = 2.2; // m/s — top of the walk blend
const RUN_SPEED = 7.0; // m/s — full sprint
const ACCEL = 16; // how briskly we reach target speed
const TURN_RATE = 11; // facing lerp toward the heading
const WALK_REF = 1.5; // ground speed the walk clip reads natural at
const RUN_REF = 6.0; // ground speed the run clip reads natural at

export class Player {
  constructor() {
    this.object = new THREE.Group(); // wrapper we translate / turn
    this.position = new THREE.Vector3(); // feet origin in world space
    this.velocity = new THREE.Vector3();
    this.heading = 0; // facing angle (radians); 0 → +Z
    this.weights = { idle: 1, walk: 0, run: 0 };
    this.ready = false;
    this._tmp = new THREE.Vector3();
  }

  /** Load the baked art asset; fall back to building the rig in-engine. */
  async load() {
    try {
      const gltf = await new GLTFLoader().loadAsync(playerAssetUrl);
      this._setup(gltf.scene, gltf.animations);
    } catch (e) {
      console.warn('player.glb load failed — building rig in-engine:', e);
      const rig = buildPlayerRig();
      const clips = buildPlayerClips();
      this._setup(rig.mesh, [clips.idle, clips.walk, clips.run]);
    }
    return this;
  }

  _setup(root, animations) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // skinned bounds shift as it animates/moves
      }
    });
    this.object.add(root);

    this.mixer = new THREE.AnimationMixer(root);
    const byName = Object.fromEntries(animations.map((c) => [c.name, c]));
    this.actions = {
      idle: this.mixer.clipAction(byName.idle),
      walk: this.mixer.clipAction(byName.walk),
      run: this.mixer.clipAction(byName.run)
    };
    for (const [name, a] of Object.entries(this.actions)) {
      a.play();
      a.setEffectiveWeight(this.weights[name]);
    }
    this.ready = true;
    this._apply();
  }

  reset(x = 0, z = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  _apply() {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.heading;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3|null} moveDir  desired horizontal direction (any length)
   * @param {boolean} sprint              hold to run, otherwise jog/walk
   */
  update(dt, moveDir, sprint) {
    if (!this.ready) return;

    const wants = moveDir && moveDir.lengthSq() > 1e-4;
    const topSpeed = sprint ? RUN_SPEED : WALK_SPEED * 1.6;

    // velocity: ease toward the target on the XZ plane
    const target = this._tmp.set(0, 0, 0);
    if (wants) target.copy(moveDir).setY(0).normalize().multiplyScalar(topSpeed);
    const blend = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (target.x - this.velocity.x) * blend;
    this.velocity.z += (target.z - this.velocity.z) * blend;
    if (this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // face the direction of travel
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.15) {
      const desired = Math.atan2(this.velocity.x, this.velocity.z);
      let d = desired - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest arc
      this.heading += d * Math.min(1, TURN_RATE * dt);
    }
    this._apply();

    this._updateAnimation(dt, speed);
  }

  _updateAnimation(dt, speed) {
    let w;
    if (speed <= 0.06) {
      w = { idle: 1, walk: 0, run: 0 };
    } else if (speed < WALK_SPEED) {
      const t = speed / WALK_SPEED;
      w = { idle: 1 - t, walk: t, run: 0 };
    } else {
      const t = Math.min(1, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
      w = { idle: 0, walk: 1 - t, run: t };
    }

    const k = 1 - Math.exp(-10 * dt); // smooth the cross-fade
    for (const name of ['idle', 'walk', 'run']) {
      this.weights[name] += (w[name] - this.weights[name]) * k;
      this.actions[name].setEffectiveWeight(this.weights[name]);
    }

    // sync stride length to ground speed
    this.actions.walk.timeScale = THREE.MathUtils.clamp(speed / WALK_REF, 0.6, 1.7);
    this.actions.run.timeScale = THREE.MathUtils.clamp(speed / RUN_REF, 0.75, 1.5);

    this.mixer.update(dt);
  }
}
