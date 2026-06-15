/**
 * Ball.js — the match ball: a sphere wearing a procedurally drawn classic
 * 32‑panel (truncated‑icosahedron) texture with seam shading and a glossy
 * clearcoat, plus the physics state the Physics module integrates each frame.
 */

import * as THREE from 'three';
import { BALL } from '../config.js';

export class Ball {
  constructor() {
    const tex = this.makeTexture();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 0.34,
      metalness: 0.0,
      clearcoat: 0.55, // subtle glossy lacquer like a real match ball
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.8
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.RADIUS, 64, 48), mat);
    this.mesh.castShadow = true;
    this.mesh.name = 'Ball';

    this.position = new THREE.Vector3(0, BALL.RADIUS, 0);
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.syncMesh();
  }

  makeTexture() {
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    // soft off-white base
    ctx.fillStyle = '#f4f5f2';
    ctx.fillRect(0, 0, W, H);

    // gentle large-scale shading so the panels read with some form
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0.06)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0.07)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // classic black pentagon centres (icosahedral arrangement)
    const centres = [[90, 0], [-90, 0]];
    for (let i = 0; i < 5; i++) {
      centres.push([26.57, i * 72]);
      centres.push([-26.57, i * 72 + 36]);
    }

    const PEN = '#15161b';
    const pentaPath = (u, v, r, distort) => {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const px = u + Math.cos(a) * r * distort;
        const py = v + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const drawPenta = (lat, lon, r) => {
      const u = ((lon + 180) / 360) * W;
      const v = ((90 - lat) / 180) * H;
      const distort = 1 / Math.max(0.32, Math.cos(THREE.MathUtils.degToRad(lat)));
      // soft seam ambient-occlusion halo around the panel
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.32)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = PEN;
      pentaPath(u, v, r, distort);
      ctx.fill();
      ctx.restore();
      // crisp seam outline
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(44,46,54,0.55)';
      pentaPath(u, v, r * 1.06, distort);
      ctx.stroke();
    };

    // draw pole pentagons as caps so they don't smear across the seam
    ctx.fillStyle = PEN;
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 12, W, 12);
    for (const [lat, lon] of centres) {
      if (Math.abs(lat) === 90) continue;
      drawPenta(lat, lon, 34);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this._q);
  }

  /** Apply rolling rotation from angular velocity. */
  spin(dt) {
    const w = this.angularVelocity;
    const angle = w.length() * dt;
    if (angle > 1e-6) {
      const axis = w.clone().normalize();
      const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      this._q.premultiply(dq);
    }
  }

  reset(x = 0, z = 0) {
    this.position.set(x, BALL.RADIUS, z);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.syncMesh();
  }

  get object() {
    return this.mesh;
  }
}
