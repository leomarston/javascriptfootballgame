/**
 * CameraRig.js — one perspective camera driven through several modes:
 *   broadcast (TV side cam), follow (chase the ball), aerial (high wide) and
 *   orbit (free mouse-look via OrbitControls). 'C' cycles modes.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MODES = ['broadcast', 'follow', 'aerial', 'orbit'];

export class CameraRig {
  constructor(domElement, aspect) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 3000);
    this.camera.position.set(0, 25, 56);
    this.camera.lookAt(0, 0.5, -3);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 260;
    this.controls.target.set(0, 1, 0);
    this.controls.enabled = false;

    this.mode = 'broadcast';
    this.forward = new THREE.Vector3(1, 0, 0);
    this._desiredPos = new THREE.Vector3();
    this._desiredTarget = new THREE.Vector3();
    this._curTarget = new THREE.Vector3(0, 1, 0);
  }

  cycle() {
    const i = (MODES.indexOf(this.mode) + 1) % MODES.length;
    this.setMode(MODES[i]);
    return this.mode;
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') this.controls.target.copy(this._curTarget);
  }

  update(dt, target) {
    const bp = target.position;

    if (this.mode === 'orbit') {
      this.controls.update();
      this._curTarget.copy(this.controls.target);
      return;
    }

    // keep a smoothed "forward" from the target's motion
    const v = target.velocity;
    if (v.lengthSq() > 1) {
      this.forward.lerp(new THREE.Vector3(v.x, 0, v.z).normalize(), 0.08);
      this.forward.normalize();
    }

    if (this.mode === 'broadcast') {
      // high-angle cam that tracks the action from the +Z side
      this._desiredPos.set(bp.x, 18, bp.z + 26);
      this._desiredTarget.set(bp.x, 1.0, bp.z);
    } else if (this.mode === 'follow') {
      const back = this.forward.clone().multiplyScalar(-8);
      this._desiredPos.set(bp.x + back.x, 4.5, bp.z + back.z);
      const ahead = this.forward.clone().multiplyScalar(6);
      this._desiredTarget.set(bp.x + ahead.x, 1.4, bp.z + ahead.z);
    } else if (this.mode === 'aerial') {
      this._desiredPos.set(bp.x * 0.4, 60, 40);
      this._desiredTarget.set(bp.x * 0.35, 0, bp.z * 0.3 - 2);
    }

    const k = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing
    this.camera.position.lerp(this._desiredPos, k);
    this._curTarget.lerp(this._desiredTarget, k);
    this.camera.lookAt(this._curTarget);
  }

  // A behind-the-taker view looking out along the aim, used for set-pieces.
  behind(dt, pos, dx, dz) {
    this._desiredPos.set(pos.x - dx * 7, 4.6, pos.z - dz * 7);
    this._desiredTarget.set(pos.x + dx * 9, 1.2, pos.z + dz * 9);
    const k = 1 - Math.pow(0.001, dt);
    this.camera.position.lerp(this._desiredPos, k);
    this._curTarget.lerp(this._desiredTarget, k);
    this.camera.lookAt(this._curTarget);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
