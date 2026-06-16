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
import { teamSheet } from './game/formations.js';
import { CameraRig } from './game/CameraRig.js';
import { Gameplay, SCHEMES } from './game/Gameplay.js';
import { HUD } from './ui/HUD.js';
import { MainMenu } from './ui/MainMenu.js';
import { SideSelect } from './ui/SideSelect.js';
import { TeamSelect } from './ui/TeamSelect.js';

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
    this._proj = new THREE.Vector3();

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

    this.hud.setLoading(0.97, 'Lining up the teams (4-4-2)');
    // Two full 4-4-2 sides: HOME (red, you control one player) vs AWAY (blue).
    const awayKit = { shirt: TEAMS.AWAY.primary, socks: TEAMS.AWAY.primary, shorts: 0x0b1f3a };
    const homeGkKit = { shirt: 0xe8772e, shorts: 0x14202e, socks: 0xe8772e, glove: 0xeef1f4, boot: 0x15151a };
    const awayGkKit = { shirt: 0x16a085, shorts: 0x0b1f3a, socks: 0x16a085, glove: 0xeef1f4, boot: 0x15151a };
    this.home = [];
    this.away = [];
    for (const s of teamSheet('HOME')) {
      if (s.isKeeper) this.homeKeeper = new Goalkeeper({ side: -1, team: 'HOME', name: s.name, kit: { ...homeGkKit, hair: s.hairColor }, hairStyle: s.hairStyle });
      else this.home.push(new FieldPlayer({ team: 'HOME', role: s.role, name: s.name, label: s.label, number: s.number, homePos: s.home, kit: { hair: s.hairColor }, hairStyle: s.hairStyle }));
    }
    for (const s of teamSheet('AWAY')) {
      if (s.isKeeper) this.awayKeeper = new Goalkeeper({ side: 1, team: 'AWAY', name: s.name, kit: { ...awayGkKit, hair: s.hairColor }, hairStyle: s.hairStyle });
      else this.away.push(new FieldPlayer({ team: 'AWAY', role: s.role, name: s.name, label: s.label, number: s.number, homePos: s.home, kit: { ...awayKit, hair: s.hairColor }, hairStyle: s.hairStyle }));
    }
    for (const p of [...this.home, ...this.away]) this.scene.add(p.object);
    this.scene.add(this.homeKeeper.object);
    this.scene.add(this.awayKeeper.object);

    // selection rings on the pitch — one per human controller, coloured per
    // player (built when the match starts; up to two for couch play)
    this.selRings = [];

    this.rig = new CameraRig(this.renderer.domElement, innerWidth / innerHeight);
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.gameplay = new Gameplay(
      { home: this.home, away: this.away, homeKeeper: this.homeKeeper, awayKeeper: this.awayKeeper },
      this.ball,
      this.rig,
      this.renderer.domElement,
      this.hud
    );

    this.wireControls();
    this.applyNight(); // night is the default look
    addEventListener('resize', () => this.onResize());

    this.hud.setLoading(1, 'Ready');
    this.hud.hideLoading();

    // The front-end menu opens over the lit pitch; KICK OFF leads to the
    // side-select screen, which begins the match on the chosen side.
    this.inMenu = true;
    this.menuTime = 0;
    this.hud.root.style.display = 'none';
    this.openMainMenu();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  openMainMenu() {
    if (this.sideSelect) { this.sideSelect.destroy(); this.sideSelect = null; }
    if (this.teamSelect) { this.teamSelect.destroy(); this.teamSelect = null; }
    this.menu = new MainMenu(() => this.openSideSelect());
  }

  openSideSelect() {
    if (this.teamSelect) { this.teamSelect.destroy(); this.teamSelect = null; }
    this.sideSelect = new SideSelect({
      onConfirm: (sides) => this.openTeamSelect(sides),
      onCancel: () => this.openMainMenu()
    });
  }

  openTeamSelect(sides) {
    if (this.sideSelect) { this.sideSelect.destroy(); this.sideSelect = null; }
    this.teamSelect = new TeamSelect({
      onConfirm: (home, away) => this.beginMatch(sides, home, away),
      onCancel: () => this.openSideSelect()
    });
  }

  // sides: [{ id:'P1', side:'HOME' }, { id:'P2', side:'AWAY' }] (P2 optional)
  beginMatch(sides, homeNation, awayNation) {
    if (!this.inMenu) return;
    this.inMenu = false;
    if (this.teamSelect) { this.teamSelect.destroy(); this.teamSelect = null; }
    this.hud.root.style.display = '';
    const configs = sides.map((s) => ({ id: s.id, side: s.side, scheme: SCHEMES[s.id] }));
    this.gameplay.startMatch(configs, homeNation, awayNation);
    this.buildSelRings();
    this.hud.startClock();
  }

  // one ground ring per human controller, in that controller's colour
  buildSelRings() {
    for (const r of this.selRings) this.scene.remove(r);
    this.selRings = this.gameplay.humans.map((h) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.56, 40),
        new THREE.MeshBasicMaterial({ color: h.ringColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 4;
      this.scene.add(ring);
      return ring;
    });
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

    if (this.inMenu) {
      this.menuTime += dt;
      this.gameplay.menuIdle(dt); // players idle behind the menu
      this.rig.menu(dt, this.menuTime);
      this.stadium.update(dt);
      this.postfx.render(this.rig.camera);
      return;
    }

    this.gameplay.update(dt);
    const humans = this.gameplay.humans;
    const sp = this.gameplay.setPieceActive();
    if (sp && sp.userControlled) {
      const spc = this.gameplay.setPieceCamInfo(); // behind the taker, looking along the aim
      this.rig.behind(dt, spc.pos, spc.dx, spc.dz);
    } else {
      this.rig.update(dt, this.gameplay.cameraTarget()); // ball-focused (2P) / follows ball after a shot
    }

    // one selection ring + name tag per controller
    for (let i = 0; i < this.selRings.length; i++) {
      const h = humans[i];
      const a = this.gameplay.humanActivePlayer(h);
      this.selRings[i].position.set(a.position.x, 0.04, a.position.z);
    }
    const a0 = this.gameplay.humanActivePlayer(humans[0]);
    this.hud.setPlayer(this.gameplay.teamId[humans[0].side].short, a0.name, a0.label);
    if (humans[1]) {
      const a1 = this.gameplay.humanActivePlayer(humans[1]);
      this.hud.setPlayer2(this.gameplay.teamId[humans[1].side].short, a1.name, a1.label, humans[1].ringColor);
    } else {
      this.hud.setPlayer2(null);
    }

    // power bars under each charging player (and the set-piece taker)
    const bars = this.gameplay.chargeInfos();
    for (let i = 0; i < 2; i++) {
      const b = bars[i];
      if (b) {
        this._proj.set(b.player.position.x, 0.1, b.player.position.z).project(this.rig.camera);
        const sx = (this._proj.x * 0.5 + 0.5) * innerWidth;
        const sy = (-this._proj.y * 0.5 + 0.5) * innerHeight + 16;
        this.hud.setCharge(i, true, b.value, b.kind, sx, sy);
      } else {
        this.hud.setCharge(i, false);
      }
    }

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
