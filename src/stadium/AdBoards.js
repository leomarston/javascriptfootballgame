/**
 * AdBoards.js — the scrolling LED advertising ring around the pitch.
 *
 * A vertical band lofted along a rounded rectangle just outside the touchlines,
 * wearing an emissive texture of sponsor blocks. The texture offset is animated
 * each frame so the hoardings "run" like real perimeter LED boards.
 */

import * as THREE from 'three';
import { FIELD } from '../config.js';
import { roundedRect } from '../utils/geometry.js';

export class AdBoards {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'AdBoards';
    this.tile = 14; // metres of perimeter per texture repeat

    this.tex = this.makeTexture();
    this.build();
  }

  makeTexture() {
    const w = 1024;
    const h = 96;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const ads = [
      { t: 'ASTRA ARENA', bg: '#0b1f3a', fg: '#ffd23f' },
      { t: 'eFOOTBALL', bg: '#0a7d2c', fg: '#f4e7b0' },
      { t: 'THREE.JS', bg: '#111111', fg: '#22d3ee' },
      { t: 'NOVA CITY', bg: '#1769ff', fg: '#bcd6ff' },
      { t: 'ASTRA UTD', bg: '#d81f33', fg: '#ffd9a8' }
    ];
    const seg = w / ads.length;
    ads.forEach((ad, i) => {
      ctx.fillStyle = ad.bg;
      ctx.fillRect(i * seg, 0, seg, h);
      ctx.fillStyle = ad.fg;
      ctx.font = 'bold 46px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ad.t, i * seg + seg / 2, h / 2 + 2);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  build() {
    const cornerR = 8;
    const core = {
      halfX: FIELD.HALF_LENGTH + 2.5 - cornerR,
      halfZ: FIELD.HALF_WIDTH + 2.5 - cornerR
    };
    const ring = roundedRect(core.halfX, core.halfZ, cornerR);
    const N = 480;
    const yB = 0.06;
    const yT = 0.92;
    const positions = [];
    const uvs = [];
    const totalU = ring.perimeter / this.tile;

    for (let i = 0; i < N; i++) {
      const f0 = i / N;
      const f1 = (i + 1) / N;
      const p0 = ring.at(f0 * ring.perimeter);
      const p1 = ring.at(f1 * ring.perimeter);
      const u0 = f0 * totalU;
      const u1 = f1 * totalU;
      // inward-facing quad
      const A = [p0.x, yT, p0.z];
      const B = [p1.x, yT, p1.z];
      const C = [p1.x, yB, p1.z];
      const D = [p0.x, yB, p0.z];
      positions.push(...A, ...C, ...B, ...A, ...D, ...C);
      uvs.push(u0, 1, u1, 0, u1, 1, u0, 1, u0, 0, u1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x070707,
      emissive: 0xffffff,
      emissiveMap: this.tex,
      emissiveIntensity: 1.3,
      roughness: 0.5,
      metalness: 0.2,
      side: THREE.DoubleSide
    });
    this.material = mat;
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);

    // a dark plinth under the boards
    const plinth = new THREE.Mesh(
      this.loftThin(core, cornerR, 0, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 1 })
    );
    this.group.add(plinth);
  }

  loftThin(core, cornerR, yB, yT) {
    const ring = roundedRect(core.halfX, core.halfZ, cornerR);
    const N = 240;
    const positions = [];
    for (let i = 0; i < N; i++) {
      const p0 = ring.at((i / N) * ring.perimeter);
      const p1 = ring.at(((i + 1) / N) * ring.perimeter);
      positions.push(p0.x, yT, p0.z, p1.x, yB, p1.z, p1.x, yT, p1.z);
      positions.push(p0.x, yT, p0.z, p0.x, yB, p0.z, p1.x, yB, p1.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  update(dt) {
    this.tex.offset.x = (this.tex.offset.x + dt * 0.08) % 1;
  }

  get object() {
    return this.group;
  }
}
