/**
 * Roof.js — cantilever roof ring over the upper tier.
 *
 * A lofted ring (sloping up and back), a hanging inner fascia, radial structural
 * ribs on the underside, and a bright LED light bank along the front edge that
 * doubles as the stadium's main lighting at night (and feeds the bloom pass).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../config.js';
import { roundedRect } from '../utils/geometry.js';
import { computeTiers } from './standMath.js';

export class Roof {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Roof';
    const { core, roof } = computeTiers();
    this.core = core;
    this.roof = roof;

    this.buildShell();
    this.buildRibs();
    this.buildFascia();
    this.buildLed();
  }

  loftRing(rA, yA, rB, yB, N = 360) {
    const ringA = roundedRect(this.core.halfX, this.core.halfZ, rA);
    const ringB = roundedRect(this.core.halfX, this.core.halfZ, rB);
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
      const a0 = ringA.at(f0 * ringA.perimeter);
      const a1 = ringA.at(f1 * ringA.perimeter);
      const b0 = ringB.at(f0 * ringB.perimeter);
      const b1 = ringB.at(f1 * ringB.perimeter);
      const A = new THREE.Vector3(a0.x, yA, a0.z);
      const B = new THREE.Vector3(a1.x, yA, a1.z);
      const C = new THREE.Vector3(b1.x, yB, b1.z);
      const D = new THREE.Vector3(b0.x, yB, b0.z);
      pushTri(A, C, B);
      pushTri(A, D, C);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }

  buildShell() {
    const { roof } = this;
    const geo = this.loftRing(roof.innerR, roof.frontY, roof.outerR, roof.backY);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.ROOF,
      roughness: 0.55,
      metalness: 0.7,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // a lighter painted underside, sitting just below the shell
    const under = this.loftRing(roof.innerR + 0.05, roof.frontY - 0.25, roof.outerR, roof.backY - 0.25);
    const underMat = new THREE.MeshStandardMaterial({
      color: COLORS.ROOF_UNDER,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    this.group.add(new THREE.Mesh(under, underMat));
  }

  buildRibs() {
    const { roof, core } = this;
    const ring = roundedRect(core.halfX, core.halfZ, (roof.innerR + roof.outerR) / 2);
    const N = 72;
    const ribs = [];
    const tmp = new THREE.Object3D();
    const inner = roundedRect(core.halfX, core.halfZ, roof.innerR);
    const outer = roundedRect(core.halfX, core.halfZ, roof.outerR);
    for (let i = 0; i < N; i++) {
      const f = i / N;
      const pi = inner.at(f * inner.perimeter);
      const po = outer.at(f * outer.perimeter);
      const a = new THREE.Vector3(pi.x, roof.frontY - 0.4, pi.z);
      const b = new THREE.Vector3(po.x, roof.backY - 0.4, po.z);
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const box = new THREE.BoxGeometry(0.25, 0.45, len);
      tmp.position.copy(mid);
      tmp.lookAt(b);
      tmp.updateMatrix();
      box.applyMatrix4(tmp.matrix);
      ribs.push(box);
    }
    const merged = mergeGeometries(ribs);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a525c,
      roughness: 0.6,
      metalness: 0.6
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  buildFascia() {
    const { roof, core } = this;
    // a vertical band hanging from the front edge of the roof
    const inner = roundedRect(core.halfX, core.halfZ, roof.innerR);
    const N = 360;
    const positions = [];
    const normals = [];
    const top = roof.frontY;
    const bottom = roof.frontY - 2.4;
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
      const p0 = inner.at((i / N) * inner.perimeter);
      const p1 = inner.at(((i + 1) / N) * inner.perimeter);
      const A = new THREE.Vector3(p0.x, top, p0.z);
      const B = new THREE.Vector3(p1.x, top, p1.z);
      const C = new THREE.Vector3(p1.x, bottom, p1.z);
      const D = new THREE.Vector3(p0.x, bottom, p0.z);
      pushTri(A, B, C);
      pushTri(A, C, D);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const mat = new THREE.MeshStandardMaterial({
      color: 0x202830,
      roughness: 0.7,
      metalness: 0.3,
      side: THREE.DoubleSide
    });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  buildLed() {
    const { roof, core } = this;
    // bright emissive strip just under the front edge — the floodlight banks
    const inner = roundedRect(core.halfX, core.halfZ, roof.innerR + 0.1);
    const N = 360;
    const positions = [];
    const top = roof.frontY - 1.0;
    const bottom = roof.frontY - 1.6;
    for (let i = 0; i < N; i++) {
      const p0 = inner.at((i / N) * inner.perimeter);
      const p1 = inner.at(((i + 1) / N) * inner.perimeter);
      const A = [p0.x, top, p0.z];
      const B = [p1.x, top, p1.z];
      const C = [p1.x, bottom, p1.z];
      const D = [p0.x, bottom, p0.z];
      positions.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    this.ledMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff4e0,
      emissiveIntensity: 1.2,
      roughness: 0.4,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, this.ledMat);
    this.group.add(mesh);
  }

  setNight(isNight) {
    if (this.ledMat) this.ledMat.emissiveIntensity = isNight ? 6.0 : 0.8;
  }

  get object() {
    return this.group;
  }
}
