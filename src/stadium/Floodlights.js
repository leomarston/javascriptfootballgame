/**
 * Floodlights.js — four corner pylons.
 *
 * Each pylon is a steel mast carrying an angled lamp array (an emissive grid
 * texture that blooms) plus a real SpotLight aimed at the centre of the pitch.
 * Intensities ramp up at night and down during the day.
 */

import * as THREE from 'three';
import { STAND } from '../config.js';

export class Floodlights {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Floodlights';
    this.spots = [];
    this.lampMats = [];

    this.lampTex = this.makeLampTexture();

    const X = STAND.GAP_END + 12;
    const Z = STAND.GAP_SIDE + 10;
    [
      [-X, -Z],
      [X, -Z],
      [-X, Z],
      [X, Z]
    ].forEach(([x, z]) => this.buildPylon(x, z));
  }

  makeLampTexture() {
    const w = 256;
    const h = 160;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, w, h);
    const cols = 8;
    const rows = 5;
    const dx = w / cols;
    const dy = h / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const cx = i * dx + dx / 2;
        const cy = j * dy + dy / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, dx * 0.5);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, '#fff3d8');
        g.addColorStop(1, 'rgba(40,40,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, dx * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildPylon(x, z) {
    const pylon = new THREE.Group();
    pylon.position.set(x, 0, z);

    const steel = new THREE.MeshStandardMaterial({
      color: 0x9aa3ad,
      roughness: 0.5,
      metalness: 0.8
    });
    const mastH = 46;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.85, mastH, 14),
      steel
    );
    mast.position.y = mastH / 2;
    mast.castShadow = true;
    pylon.add(mast);

    // a small lattice cross-brace near the top for structure
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 6, 0.3),
      steel
    );
    brace.position.set(0, mastH - 4, 0);
    pylon.add(brace);

    // lamp head, tilted to look at the pitch centre
    const head = new THREE.Group();
    head.position.set(0, mastH + 1.5, 0);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(7.5, 4.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.6, metalness: 0.6 })
    );
    head.add(frame);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      emissive: 0xffffff,
      emissiveMap: this.lampTex,
      emissiveIntensity: 1.0,
      roughness: 0.3
    });
    this.lampMats.push(lampMat);
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.2), lampMat);
    lamps.position.z = 0.38;
    head.add(lamps);

    // aim the head toward centre & slightly down
    const dir = new THREE.Vector2(-x, -z).normalize();
    head.rotation.y = Math.atan2(dir.x, dir.y);
    head.rotation.x = 0.35;
    pylon.add(head);

    // real spotlight (decay 1.0 keeps a broad, even wash across the pitch)
    const spot = new THREE.SpotLight(0xfff0d8, 0, 320, 0.7, 0.45, 1.0);
    spot.position.set(0, mastH + 1.5, 0);
    const target = new THREE.Object3D();
    target.position.set(-x, 0, -z); // pitch centre in pylon-local space
    pylon.add(target);
    spot.target = target;
    pylon.add(spot);
    this.spots.push(spot);

    this.group.add(pylon);
  }

  setNight(isNight) {
    const intensity = isNight ? 220 : 0;
    this.spots.forEach((s) => (s.intensity = intensity));
    this.lampMats.forEach((m) => (m.emissiveIntensity = isNight ? 5.5 : 1.0));
  }

  get object() {
    return this.group;
  }
}
