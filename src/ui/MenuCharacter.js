/**
 * MenuCharacter.js — a featured player rendered into the menu, with a lively
 * "waiting" idle: he shifts his weight, glances around, holds his hands in
 * front and taps a foot, the way a player fidgets on a game's front screen.
 *
 * Self-contained: its own transparent WebGL canvas, scene, lights and a soft
 * contact shadow, driven by its own rAF loop. Built from the shared rig + clips
 * so he matches the in-match players. Dispose() tears everything down.
 */

import * as THREE from 'three';
import { buildPlayerRig } from '../game/player/PlayerRig.js';
import { buildPlayerClips } from '../game/player/PlayerAnimations.js';
import { TEAMS } from '../config.js';

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class MenuCharacter {
  constructor(container, { kit, hairStyle = 'short' } = {}) {
    this.container = container;
    const r = container.getBoundingClientRect();
    this.w = Math.max(2, r.width);
    this.h = Math.max(2, r.height);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(this.w, this.h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, this.w / this.h, 0.1, 50);
    this.camera.position.set(0.55, 1.02, 4.25);
    this.camera.lookAt(0, 0.96, 0);

    // lighting tuned to the menu palette: warm key, cool fill, magenta rim
    const key = new THREE.DirectionalLight(0xfff1e2, 2.5);
    key.position.set(2.5, 4, 3.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7b86ff, 1.1);
    fill.position.set(-3, 2, 1.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff4fae, 1.4);
    rim.position.set(-1.5, 3, -3.5);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x47507a, 1.3));

    // soft contact shadow
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.0),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(0, 0.01, 0.05);
    this.scene.add(sh);

    // the player
    const rig = buildPlayerRig({ kit: kit || { shirt: TEAMS.HOME.primary, socks: TEAMS.HOME.primary }, hairStyle });
    this.bones = rig.bones;
    this.player = new THREE.Group();
    this.player.add(rig.mesh);
    this.player.rotation.y = 0.32; // a relaxed three-quarter stance
    this.scene.add(this.player);

    this.mixer = new THREE.AnimationMixer(rig.mesh);
    this.mixer.clipAction(buildPlayerClips().idle).play();

    this.t = Math.random() * 10;
    this.clock = new THREE.Clock();
    this.alive = true;
    this._loop = () => { if (!this.alive) return; this.frame(); this._raf = requestAnimationFrame(this._loop); };
    this._raf = requestAnimationFrame(this._loop);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const t = this.t;
    const b = this.bones;

    this.mixer.update(dt); // base idle (breathing, subtle sway)

    // --- lively idle layered on top of the clip -------------------------
    // glance around (the clip doesn't, so set absolute)
    const yaw = Math.sin(t * 0.45) * 0.3 + Math.sin(t * 0.19 + 1) * 0.13;
    b.head.rotation.y = yaw;
    b.neck.rotation.y = yaw * 0.4;
    b.head.rotation.x += Math.sin(t * 0.6) * 0.05;

    // shift weight foot to foot
    const w = Math.sin(t * 0.55);
    this.player.position.x = w * 0.025;
    b.hips.rotation.z += w * 0.03;
    b.spine.rotation.z += -w * 0.02;

    // hold hands together in front, with a small fidget
    const fidget = Math.sin(t * 0.9) * 0.05;
    b.upperArmL.rotation.z += 0.06;
    b.upperArmR.rotation.z += -0.06;
    b.lowerArmL.rotation.x += -0.55 + fidget;
    b.lowerArmR.rotation.x += -0.55 - fidget;
    b.lowerArmL.rotation.z += 0.18;
    b.lowerArmR.rotation.z += -0.18;

    // tap the right foot in periodic bursts ("shaking his foot")
    const env = Math.pow(Math.max(0, Math.sin(t * 0.6 + 0.5)), 5);
    const tap = env * Math.max(0, Math.sin(t * 11)) * 0.5;
    b.thighR.rotation.x += -tap * 0.18;
    b.shinR.rotation.x += tap * 0.45;
    b.footR.rotation.x += -tap;

    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(2, r.width);
    const h = Math.max(2, r.height);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.alive = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    try { this.renderer.dispose(); this.renderer.forceContextLoss(); } catch (e) { /* ignore */ }
    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
