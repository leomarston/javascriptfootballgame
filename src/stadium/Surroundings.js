/**
 * Surroundings.js — everything that frames the pitch: the concrete apron/ground,
 * the two team dugouts in the technical area, and the four corner flags.
 */

import * as THREE from 'three';
import { FIELD, TEAMS } from '../config.js';

export class Surroundings {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Surroundings';
    this.buildGround();
    this.buildDugouts();
    this.buildCornerFlags();
  }

  buildGround() {
    // concrete apron surrounding the turf
    const tex = this.concreteTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0,
      color: 0x8a8f96
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 300), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  concreteTexture() {
    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6e747c';
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 36;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // expansion joints
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 34);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildDugouts() {
    const z = FIELD.HALF_WIDTH + 3.6; // main-stand side
    const make = (x, color) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);

      const base = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.25, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })
      );
      base.position.y = 0.12;
      base.receiveShadow = true;
      g.add(base);

      // bucket seats
      const seatGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const seatMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
      for (let i = 0; i < 12; i++) {
        const s = new THREE.Mesh(seatGeo, seatMat);
        s.position.set(-3.5 + i * 0.62, 0.5, 0.2);
        g.add(s);
      }

      // tinted roof on posts
      const postMat = new THREE.MeshStandardMaterial({ color: 0x7a818a, metalness: 0.7, roughness: 0.4 });
      [-3.8, 3.8].forEach((px) => {
        [-0.7, 0.7].forEach((pz) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 8), postMat);
          post.position.set(px, 1.05, pz);
          g.add(post);
        });
      });
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(8.4, 0.1, 2.2),
        new THREE.MeshStandardMaterial({
          color: 0x10141a,
          roughness: 0.2,
          metalness: 0.3,
          transparent: true,
          opacity: 0.65
        })
      );
      roof.position.set(0, 2.15, 0);
      roof.rotation.x = -0.12;
      roof.castShadow = true;
      g.add(roof);

      g.rotation.y = Math.PI; // face the pitch (−Z)
      return g;
    };

    this.group.add(make(-7, TEAMS.HOME.primary));
    this.group.add(make(7, TEAMS.AWAY.primary));
  }

  buildCornerFlags() {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      roughness: 0.45,
      metalness: 0.1
    });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xffce2b,
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide
    });

    // a single waving-flag geometry, reused for all four corners
    const flagGeo = new THREE.PlaneGeometry(0.52, 0.32, 16, 3);
    flagGeo.translate(0.26, 0, 0); // hinge at x=0 (the pole)
    const fp = flagGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const t = x / 0.52; // 0 at pole → 1 at the fly end
      fp.setZ(i, Math.sin(x * 9.0 + 0.6) * 0.05 * t + Math.sin(x * 22.0) * 0.012 * t);
    }
    flagGeo.computeVertexNormals();

    const corners = [
      [-FIELD.HALF_LENGTH, -FIELD.HALF_WIDTH],
      [FIELD.HALF_LENGTH, -FIELD.HALF_WIDTH],
      [-FIELD.HALF_LENGTH, FIELD.HALF_WIDTH],
      [FIELD.HALF_LENGTH, FIELD.HALF_WIDTH]
    ];
    corners.forEach(([x, z]) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.026, 1.5, 10),
        poleMat
      );
      pole.position.y = 0.75;
      pole.castShadow = true;
      g.add(pole);

      // little finial on top + a weighted base
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), poleMat);
      cap.position.y = 1.52;
      g.add(cap);
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 0.08, 12),
        baseMat
      );
      base.position.y = 0.04;
      g.add(base);

      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(0, 1.34, 0);
      flag.rotation.y = Math.atan2(-x, -z); // point in toward the pitch centre
      flag.castShadow = true;
      g.add(flag);

      this.group.add(g);
    });
  }

  get object() {
    return this.group;
  }
}
