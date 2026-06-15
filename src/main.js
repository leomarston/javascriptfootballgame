/**
 * main.js — application bootstrap.
 *
 * Creates the renderer, scene, environment, stadium, ball, cameras, post-FX and
 * gameplay, then drives the render loop. Heavy construction is staged behind the
 * loading screen.
 */

import * as THREE from 'three';
import './style.css';
import { QUALITY, TEAMS } from './config.js';
import { Environment } from './core/Environment.js';
import { PostFX } from './core/PostFX.js';
import { Stadium } from './stadium/Stadium.js';
import { Ball } from './game/Ball.js';
import { FieldPlayer } from './game/FieldPlayer.js';
import { Goalkeeper } from './game/Goalkeeper.js';
import { CameraRig } from './game/CameraRig.js';
import { Gameplay } from './game/Gameplay.js';
import { HUD } from './ui/HUD.js';

class App {
  constructor() {
    this.container = document.getElementById('app');

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY.maxPixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.timer = new THREE.Timer();
    this.isNight = true;

    // Some software/headless GL stacks (SwiftShader, llvmpipe) can't run the
    // HDR bloom pass and render black; detect that and degrade gracefully.
    if (this.isSoftwareRenderer()) {
      // The HDR bloom pass and PMREM environment map both break on software GL
      // (they render black / poison PBR shaders); skip them and lean on the
      // analytic lights, which look great on their own.
      QUALITY.bloom = false;
      QUALITY.envMap = false;
      QUALITY.maxPixelRatio = 1;
      this.renderer.setPixelRatio(1);
    }

    this.hud = new HUD();
  }

  isSoftwareRenderer() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const r = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      return /swiftshader|software|llvmpipe|basic render|microsoft basic/i.test(r);
    } catch (e) {
      return false;
    }
  }

  async init() {
    this.hud.setLoading(0.05, 'Preparing renderer');
    this.environment = new Environment(this.scene, this.renderer);

    this.stadium = new Stadium();
    this.scene.add(this.stadium.object);
    await this.stadium.build((f, label) => this.hud.setLoading(0.1 + f * 0.85, label));

    this.ball = new Ball();
    this.scene.add(this.ball.object);

    this.hud.setLoading(0.97, 'Lining up the teams');
    // HOME: two red outfielders (you control one). AWAY: a blue defender + keeper.
    this.home = [
      new FieldPlayer({ team: 'HOME', role: 'striker' }),
      new FieldPlayer({ team: 'HOME', role: 'support' })
    ];
    this.defender = new FieldPlayer({
      team: 'AWAY',
      role: 'defender',
      kit: { shirt: TEAMS.AWAY.primary, socks: TEAMS.AWAY.primary, shorts: 0x0b1f3a }
    });
    this.keeper = new Goalkeeper();
    for (const p of this.home) this.scene.add(p.object);
    this.scene.add(this.defender.object);
    this.scene.add(this.keeper.object);

    // a small ring on the pitch marking the player you currently control
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe14d,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.renderOrder = 4;
    this.scene.add(this.selRing);

    this.rig = new CameraRig(this.renderer.domElement, innerWidth / innerHeight);
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.gameplay = new Gameplay(
      { home: this.home, defender: this.defender, keeper: this.keeper },
      this.ball,
      this.rig,
      this.renderer.domElement,
      this.hud
    );

    this.wireControls();
    this.applyNight(); // night is the default look
    addEventListener('resize', () => this.onResize());

    this.hud.setLoading(1, 'Kickoff!');
    this.hud.hideLoading();
    this.hud.startClock();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  applyNight() {
    this.environment.applyMode(this.isNight ? 'night' : 'day');
    this.stadium.setNight(this.isNight);
    this.postfx.setNight(this.isNight);
  }

  wireControls() {
    const toggleNight = () => {
      this.isNight = !this.isNight;
      this.applyNight();
    };
    const cycleCam = () => this.rig.cycle();

    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'n') toggleNight();
      if (k === 'c') cycleCam();
    });
  }

  onResize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.rig.setAspect(innerWidth / innerHeight);
    this.postfx.setSize(innerWidth, innerHeight);
  }

  frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.gameplay.update(dt);
    const ctrl = this.gameplay.controlledPlayer();
    this.rig.update(dt, ctrl);
    this.selRing.position.set(ctrl.position.x, 0.04, ctrl.position.z);
    this.stadium.update(dt);
    this.hud.update(dt);
    this.postfx.render(this.rig.camera);
  }
}

const app = new App();
window.__APP = app;
app.init().catch((err) => {
  console.error(err);
  const l = document.querySelector('.loader-sub');
  if (l) l.textContent = 'Error: ' + err.message;
});
