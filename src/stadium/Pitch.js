/**
 * Pitch.js — the playing surface.
 *
 * A subdivided plane wearing the procedural albedo (grass + lines) plus tiled
 * normal/roughness maps. The big albedo is mapped 1:1; the high-frequency turf
 * detail tiles many times so individual "blades" stay sharp at ground level.
 */

import * as THREE from 'three';
import { FIELD, COLORS } from '../config.js';
import {
  createPitchAlbedo,
  createTurfNormal,
  createTurfRoughness,
  PITCH_PLANE
} from './PitchTexture.js';

export class Pitch {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Pitch';

    const albedo = createPitchAlbedo();
    const normal = createTurfNormal(512);
    const rough = createTurfRoughness(512);

    const tileX = Math.round(PITCH_PLANE.length / 1.6);
    const tileZ = Math.round(PITCH_PLANE.width / 1.6);
    normal.repeat.set(tileX, tileZ);
    rough.repeat.set(tileX, tileZ);

    const mat = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: rough,
      roughness: 0.92,
      metalness: 0.0,
      dithering: true
    });

    const geo = new THREE.PlaneGeometry(
      PITCH_PLANE.length,
      PITCH_PLANE.width,
      120,
      80
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // Plane local +Y maps to world -Z after the rotation; flip so the texture's
    // "top" (−Z, far stand) lands correctly and lines aren't mirrored.
    mesh.rotation.z = 0;
    mesh.receiveShadow = true;
    mesh.name = 'PitchSurface';
    this.group.add(mesh);
    this.surface = mesh;

    // A soft raised mound of soil under the grass edge → reads as a real,
    // slightly crowned pitch and hides the seam against the surroundings.
    const skirtMat = new THREE.MeshStandardMaterial({
      color: COLORS.GRASS_DARK,
      roughness: 1.0,
      metalness: 0
    });
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(PITCH_PLANE.length, 0.5, PITCH_PLANE.width),
      skirtMat
    );
    skirt.position.y = -0.26;
    skirt.receiveShadow = true;
    this.group.add(skirt);

    this.material = mat;
  }

  get object() {
    return this.group;
  }

  // The painted field rectangle, used by gameplay for goal-line / out detection.
  get bounds() {
    return {
      halfLength: FIELD.HALF_LENGTH,
      halfWidth: FIELD.HALF_WIDTH
    };
  }
}
