/**
 * Goals.js — regulation goals (7.32 × 2.44 m).
 *
 * Round posts + crossbar, two back support stanchions, a back ground bar, and a
 * draped net built from four sagging panels. The net uses a procedurally drawn
 * knotted-mesh texture; each panel gets its own texture clone so the holes stay
 * a consistent real-world size (~13 cm) regardless of the panel's dimensions.
 *
 * Geometry here is tiny (a few hundred triangles per goal), so the extra detail
 * costs nothing next to the instanced stands/crowd.
 */

import * as THREE from 'three';
import { FIELD, GOAL } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
const NET_HOLE = 0.13; // target mesh hole size in metres
const NET_CELLS = 8; // cells per texture tile

function createNetTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const step = size / NET_CELLS;
  ctx.strokeStyle = 'rgba(248,251,252,0.95)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= NET_CELLS; i++) {
    const p = i * step;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  // little knots where strands cross — reads as a real woven net up close
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  for (let i = 0; i <= NET_CELLS; i++) {
    for (let j = 0; j <= NET_CELLS; j++) {
      ctx.beginPath();
      ctx.arc(i * step, j * step, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export class Goals {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Goals';

    this.netTex = createNetTexture();
    this.postMat = new THREE.MeshStandardMaterial({
      color: 0xf3f5f7,
      roughness: 0.3,
      metalness: 0.05
    });
    this.stanchionMat = new THREE.MeshStandardMaterial({
      color: 0xeef1f4,
      roughness: 0.4,
      metalness: 0.05
    });

    this.group.add(this.buildGoal(-1)); // home (opening faces +X)
    this.group.add(this.buildGoal(1)); // away (opening faces −X)
  }

  netMaterial(realW, realH) {
    const t = this.netTex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(
      Math.max(1, realW / (NET_HOLE * NET_CELLS)),
      Math.max(1, realH / (NET_HOLE * NET_CELLS))
    );
    return new THREE.MeshStandardMaterial({
      map: t,
      transparent: true,
      alphaTest: 0.14,
      side: THREE.DoubleSide,
      color: 0xf0f4f6,
      roughness: 0.9,
      metalness: 0,
      depthWrite: true
    });
  }

  bar(a, b, radius, mat) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(vb, va);
    const len = dir.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, len, 10),
      mat
    );
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.castShadow = true;
    return mesh;
  }

  buildGoal(sign) {
    const g = new THREE.Group();
    const W = GOAL.WIDTH;
    const H = GOAL.HEIGHT;
    const r = GOAL.POST_RADIUS;
    const hw = W / 2;
    const dTop = GOAL.DEPTH_TOP;
    const dBot = GOAL.DEPTH_BOTTOM;

    // ---- frame (built facing +X, net trailing toward −X) -----------------
    const post = (z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 20), this.postMat);
      m.position.set(0, H / 2, z);
      m.castShadow = true;
      g.add(m);
    };
    post(-hw);
    post(hw);

    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, W + r * 2, 20),
      this.postMat
    );
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(0, H, 0);
    crossbar.castShadow = true;
    g.add(crossbar);

    // back support stanchions: a roof arm and an angled rear post on each side
    for (const sz of [-hw, hw]) {
      g.add(this.bar([0, H, sz], [-dTop, H, sz], r * 0.6, this.stanchionMat)); // roof arm
      g.add(this.bar([-dTop, H, sz], [-dBot, 0, sz], r * 0.55, this.stanchionMat)); // rear post
    }
    // back ground bar
    g.add(this.bar([-dBot, r * 0.6, -hw], [-dBot, r * 0.6, hw], r * 0.6, this.stanchionMat));

    // ---- net panels (own material → uniform hole size) -------------------
    const slant = Math.hypot(dBot - dTop, H);
    // roof: crossbar → back-top
    g.add(
      this.saggedPanel(
        [0, H, -hw], [0, H, hw], [-dTop, H, hw], [-dTop, H, -hw],
        this.netMaterial(W, dTop), 12, 5, 0.12
      )
    );
    // back: back-top → ground
    g.add(
      this.saggedPanel(
        [-dTop, H, -hw], [-dTop, H, hw], [-dBot, 0, hw], [-dBot, 0, -hw],
        this.netMaterial(W, slant), 12, 6, 0.22
      )
    );
    // sides (trapezoids)
    g.add(
      this.saggedPanel(
        [0, 0, -hw], [0, H, -hw], [-dTop, H, -hw], [-dBot, 0, -hw],
        this.netMaterial(dBot, H), 6, 8, 0.06
      )
    );
    g.add(
      this.saggedPanel(
        [0, 0, hw], [0, H, hw], [-dTop, H, hw], [-dBot, 0, hw],
        this.netMaterial(dBot, H), 6, 8, 0.06
      )
    );

    const x = sign * FIELD.HALF_LENGTH;
    g.position.x = x;
    if (sign > 0) g.rotation.y = Math.PI; // away goal faces −X
    return g;
  }

  /**
   * A subdivided quad through four corners with a soft inward sag, used for net
   * faces. Corners given in goal-local coords [x,y,z]; bilinearly interpolated.
   */
  saggedPanel(c00, c10, c11, c01, material, segU, segV, sag) {
    const geo = new THREE.PlaneGeometry(1, 1, segU, segV);
    const pos = geo.attributes.position;
    const a = new THREE.Vector3(...c00);
    const b = new THREE.Vector3(...c10);
    const c = new THREE.Vector3(...c11);
    const d = new THREE.Vector3(...c01);
    const tmpAB = new THREE.Vector3();
    const tmpDC = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5; // 0..1
      const v = pos.getY(i) + 0.5; // 0..1
      tmpAB.lerpVectors(a, b, u);
      tmpDC.lerpVectors(d, c, u);
      p.lerpVectors(tmpAB, tmpDC, v);
      // gravity sag toward −X and slightly down, strongest at the panel centre
      const s = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * sag;
      p.x -= s;
      p.y -= s * 0.4;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }

  get object() {
    return this.group;
  }
}
