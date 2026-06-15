/**
 * tools/bake-entry.js — runs in the browser (via bake.html) to export the
 * authored player as a binary glTF (.glb): skeleton, skinned mesh and the
 * idle / walk / run animation clips. The result is a standard rig asset that
 * opens in Blender, Unity or any glTF viewer. Driven by tools/bake-player.mjs.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildPlayerRig } from '/src/game/player/PlayerRig.js';
import { buildPlayerClips } from '/src/game/player/PlayerAnimations.js';

const rig = buildPlayerRig();
const clips = buildPlayerClips();

const scene = new THREE.Scene();
scene.add(rig.mesh);
scene.updateMatrixWorld(true);

const exporter = new GLTFExporter();
exporter.parse(
  rig.mesh,
  (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    window.__GLB_BASE64 = btoa(binary);
    window.__GLB_BYTES = bytes.length;
  },
  (error) => {
    window.__GLB_ERROR = String(error && error.message ? error.message : error);
  },
  { binary: true, animations: Object.values(clips) }
);
