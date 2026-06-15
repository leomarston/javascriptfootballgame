/**
 * Stands.js — the two-tier seating bowl.
 *
 *  • The structural terrace is built as lofted "rake" rings (a sloped concrete
 *    surface + a vertical front fascia) so the bowl reads as solid from inside.
 *  • Every seat is one instance of a shared low-poly bucket geometry, coloured
 *    per-instance to form club-coloured sections, banded mosaics and a "tifo"
 *    that spells the home club's name across the main stand.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAND, TEAMS, COLORS } from '../config.js';
import { roundedRect } from '../utils/geometry.js';
import { computeTiers } from './standMath.js';

export class Stands {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Stands';
    this.tiers = computeTiers();

    this.tifo = this.makeLabelSampler(TEAMS.HOME.name);

    this.buildStructure();
    this.buildSeats();
  }

  // --- structural concrete -------------------------------------------------
  buildStructure() {
    const concrete = new THREE.MeshStandardMaterial({
      color: COLORS.CONCRETE,
      roughness: 0.95,
      metalness: 0
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x33373d,
      roughness: 1,
      metalness: 0
    });

    const { lower, upper, core } = this.tiers;
    this.group.add(this.rakeBand(core, lower.rFront, lower.yFront, lower.rBack, lower.yBack, concrete, 0.0));
    this.group.add(this.rakeBand(core, upper.rFront, upper.yFront, upper.rBack, upper.yBack, concrete, lower.yBack));
    // perimeter back wall enclosing the bowl
    this.group.add(this.wallRing(core, upper.rBack + 1.2, 0, upper.yBack + 1.5, dark));
  }

  /**
   * A sloped terrace ring from (rFront,yFront) to (rBack,yBack) plus a vertical
   * fascia dropping from the front edge down to `fasciaFloor`.
   */
  rakeBand(core, rFront, yFront, rBack, yBack, material, fasciaFloor) {
    const N = 320;
    const front = roundedRect(core.halfX, core.halfZ, rFront);
    const back = roundedRect(core.halfX, core.halfZ, rBack);
    const positions = [];
    const normals = [];
    const pushTri = (a, b, c) => {
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
      [a, b, c].forEach((v) => {
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
      });
    };

    for (let i = 0; i < N; i++) {
      const f0 = i / N;
      const f1 = (i + 1) / N;
      const pf0 = front.at(f0 * front.perimeter);
      const pf1 = front.at(f1 * front.perimeter);
      const pb0 = back.at(f0 * back.perimeter);
      const pb1 = back.at(f1 * back.perimeter);

      const FA = new THREE.Vector3(pf0.x, yFront, pf0.z);
      const FB = new THREE.Vector3(pf1.x, yFront, pf1.z);
      const BA = new THREE.Vector3(pb0.x, yBack, pb0.z);
      const BB = new THREE.Vector3(pb1.x, yBack, pb1.z);
      // rake top
      pushTri(FA, BA, BB);
      pushTri(FA, BB, FB);
      // front fascia (drop to floor)
      const GA = new THREE.Vector3(pf0.x, fasciaFloor, pf0.z);
      const GB = new THREE.Vector3(pf1.x, fasciaFloor, pf1.z);
      pushTri(GA, FB, FA);
      pushTri(GA, GB, FB);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /** Tall vertical wall ring (outer enclosure). */
  wallRing(core, r, yBottom, yTop, material) {
    const N = 320;
    const ring = roundedRect(core.halfX, core.halfZ, r);
    const positions = [];
    const normals = [];
    const pushTri = (a, b, c) => {
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
      [a, b, c].forEach((v) => {
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
      });
    };
    for (let i = 0; i < N; i++) {
      const p0 = ring.at((i / N) * ring.perimeter);
      const p1 = ring.at(((i + 1) / N) * ring.perimeter);
      const A = new THREE.Vector3(p0.x, yBottom, p0.z);
      const B = new THREE.Vector3(p1.x, yBottom, p1.z);
      const C = new THREE.Vector3(p1.x, yTop, p1.z);
      const D = new THREE.Vector3(p0.x, yTop, p0.z);
      pushTri(A, C, B);
      pushTri(A, D, C);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return new THREE.Mesh(geo, material);
  }

  // --- seats ---------------------------------------------------------------
  seatGeometry() {
    const pan = new THREE.BoxGeometry(0.46, 0.07, 0.42);
    pan.translate(0, 0.42, 0.02);
    const backrest = new THREE.BoxGeometry(0.46, 0.5, 0.08);
    backrest.translate(0, 0.66, -0.19);
    const geo = mergeGeometries([pan, backrest]);
    return geo;
  }

  buildSeats() {
    const { lower, upper, core } = this.tiers;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // collect transforms first so we know the total instance count
    const items = [];
    const collectTier = (tier, isUpper) => {
      for (let i = 0; i < tier.rows; i++) {
        const rEff = tier.rFront + i * STAND.ROW_DEPTH;
        const y = tier.yFront + i * STAND.ROW_RISE;
        const ring = roundedRect(core.halfX, core.halfZ, rEff);
        const count = Math.max(8, Math.round(ring.perimeter / STAND.SEAT_SPACING));
        const rowFrac = i / (tier.rows - 1);
        for (let k = 0; k < count; k++) {
          const p = ring.at((k / count) * ring.perimeter);
          // skip a few vomitory aisles for realism
          if (k % 64 === 0 || k % 64 === 1) continue;
          items.push({ p, y, isUpper, rowFrac, rowIndex: i, kFrac: k / count });
        }
      }
    };
    collectTier(lower, false);
    collectTier(upper, true);

    const geo = this.seatGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.05,
      vertexColors: false
    });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = false; // far too many to shadow; ambient handles it
    mesh.receiveShadow = false;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const inwardX = -it.p.nx;
      const inwardZ = -it.p.nz;
      dummy.position.set(it.p.x, it.y, it.p.z);
      dummy.rotation.set(0, Math.atan2(inwardX, inwardZ), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      this.seatColor(it, color);
      mesh.setColorAt(idx, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.seatMesh = mesh;
    this.group.add(mesh);
  }

  seatColor(it, out) {
    const home = new THREE.Color(TEAMS.HOME.primary);
    const homeSec = new THREE.Color(TEAMS.HOME.secondary);
    const away = new THREE.Color(TEAMS.AWAY.primary);
    const awaySec = new THREE.Color(TEAMS.AWAY.secondary);

    const { p, rowIndex } = it;
    const onMainStand = p.nz > 0.85; // +Z straight section
    const onFarStand = p.nz < -0.85;

    let base;
    if (onFarStand) {
      base = away.clone();
      if (rowIndex % 8 < 1) base.copy(awaySec);
    } else if (onMainStand) {
      base = home.clone();
      // tifo: spell the club name across the upper main stand
      if (it.isUpper) {
        const u = (p.x + this.tiers.core.halfX + this.tiers.upper.rBack) /
          (2 * (this.tiers.core.halfX + this.tiers.upper.rBack));
        const v = 1 - it.rowFrac;
        if (this.tifo(u, v)) base.copy(homeSec);
      } else if (rowIndex % 8 < 1) {
        base.copy(homeSec);
      }
    } else {
      // ends + corners: alternate club colours by quadrant
      base = p.x > 0 ? away.clone() : home.clone();
      if (rowIndex % 6 < 1) base.multiplyScalar(1.3);
    }

    // a sprinkling of light "shirts" and a few empty dark seats
    const r = Math.random();
    if (r < 0.05) base.setRGB(0.85, 0.86, 0.88);
    else if (r > 0.96) base.multiplyScalar(0.35);

    base.multiplyScalar(0.82 + Math.random() * 0.28);
    out.copy(base);
  }

  /**
   * Returns a function(u,v)->bool sampling block letters of `text` (u,v in 0..1
   * across the stand). Used to paint the tifo into the seat colours.
   */
  makeLabelSampler(text) {
    const w = 512;
    const h = 128;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 96px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
    const data = ctx.getImageData(0, 0, w, h).data;
    return (u, v) => {
      if (u < 0.06 || u > 0.94 || v < 0.28 || v > 0.78) return false;
      const x = Math.floor(u * (w - 1));
      const y = Math.floor((1 - v) * (h - 1));
      return data[(y * w + x) * 4] > 128;
    };
  }

  get object() {
    return this.group;
  }
}
