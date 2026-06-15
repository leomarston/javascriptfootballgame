/**
 * Crowd.js — instanced low-poly spectators.
 *
 * One merged "seated person" geometry (torso + head) instanced across a sampled
 * subset of seats. Coloured to match each stand's section so the bowl reads as a
 * packed, club-coloured crowd up close while staying a single draw call.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAND, TEAMS } from '../config.js';
import { roundedRect } from '../utils/geometry.js';
import { computeTiers } from './standMath.js';

const SHIRTS = [
  0xd81f33, 0x1769ff, 0xffffff, 0xf2c014, 0x18a558, 0xe9602a, 0x8e44ad,
  0x222831, 0xc0c6cc, 0x16324f
];

export class Crowd {
  constructor(target = 16000) {
    this.group = new THREE.Group();
    this.group.name = 'Crowd';
    this.build(target);
  }

  personGeometry() {
    const torso = new THREE.CylinderGeometry(0.17, 0.24, 0.6, 6);
    torso.translate(0, 0.5, 0);
    const head = new THREE.SphereGeometry(0.13, 6, 5);
    head.translate(0, 0.92, 0);
    return mergeGeometries([torso, head]);
  }

  build(target) {
    const { lower, upper, core } = computeTiers();
    const candidates = [];
    const collect = (tier) => {
      for (let i = 0; i < tier.rows; i++) {
        const rEff = tier.rFront + i * STAND.ROW_DEPTH;
        const y = tier.yFront + i * STAND.ROW_RISE;
        const ring = roundedRect(core.halfX, core.halfZ, rEff);
        const count = Math.max(8, Math.round(ring.perimeter / STAND.SEAT_SPACING));
        for (let k = 0; k < count; k++) {
          if (k % 64 === 0 || k % 64 === 1) continue; // aisles
          const p = ring.at((k / count) * ring.perimeter);
          candidates.push({ p, y });
        }
      }
    };
    collect(lower);
    collect(upper);

    const p = Math.min(1, target / candidates.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const chosen = candidates.filter(() => Math.random() < p);

    const geo = this.personGeometry();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, chosen.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    for (let idx = 0; idx < chosen.length; idx++) {
      const it = chosen[idx];
      const inwardX = -it.p.nx;
      const inwardZ = -it.p.nz;
      dummy.position.set(
        it.p.x + (Math.random() - 0.5) * 0.12,
        it.y + 0.34,
        it.p.z + (Math.random() - 0.5) * 0.12
      );
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.2,
        Math.atan2(inwardX, inwardZ) + (Math.random() - 0.5) * 0.4,
        0
      );
      dummy.scale.set(1, 0.9 + Math.random() * 0.25, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);

      // club colours by stand, with random shirts mixed in
      let c;
      if (it.p.nz > 0.85) c = TEAMS.HOME.primary;
      else if (it.p.nz < -0.85) c = TEAMS.AWAY.primary;
      else c = SHIRTS[(Math.random() * SHIRTS.length) | 0];
      if (Math.random() < 0.4) c = SHIRTS[(Math.random() * SHIRTS.length) | 0];
      color.set(c).multiplyScalar(0.7 + Math.random() * 0.5);
      mesh.setColorAt(idx, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.count = chosen.length;
  }

  get object() {
    return this.group;
  }
}
