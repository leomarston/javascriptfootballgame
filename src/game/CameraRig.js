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

  update(dt, ball) {
    const bp = ball.position;

    if (this.mode === 'orbit') {
      this.controls.update();
      this._curTarget.copy(this.controls.target);
      return;
    }

    // keep a smoothed "forward" from the ball's motion
    const v = ball.velocity;
    if (v.lengthSq() > 4) {
      this.forward.lerp(new THREE.Vector3(v.x, 0, v.z).normalize(), 0.05);
      this.forward.normalize();
    }

    if (this.mode === 'broadcast') {
      // elevated TV camera on the main (+Z) stand, looking across the pitch
      this._desiredPos.set(bp.x * 0.35, 25, 56);
      this._desiredTarget.set(bp.x * 0.28, 0.5, bp.z * 0.3 - 3);
    } else if (this.mode === 'follow') {
      const back = this.forward.clone().multiplyScalar(-11);
      this._desiredPos.set(bp.x + back.x, bp.y + 6.5, bp.z + back.z);
      const ahead = this.forward.clone().multiplyScalar(8);
      this._desiredTarget.set(bp.x + ahead.x, 1.2, bp.z + ahead.z);
    } else if (this.mode === 'aerial') {
      this._desiredPos.set(bp.x * 0.25, 74, 44);
      this._desiredTarget.set(bp.x * 0.2, 0, -2);
    }

    const k = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing
    this.camera.position.lerp(this._desiredPos, k);
    this._curTarget.lerp(this._desiredTarget, k);
    this.camera.lookAt(this._curTarget);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
