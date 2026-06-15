/**
 * Environment.js — sky, sun, ambient lighting, fog, image-based reflections and
 * the day/night system.
 *
 * The physical Sky shader drives both the visible backdrop and a PMREM-generated
 * environment map, so metals (posts, roof, masts) pick up real sky reflections.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SCENE, QUALITY } from '../config.js';

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.useEnvMap = QUALITY.envMap;

    // visible sky
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    scene.add(this.sky);

    if (this.useEnvMap) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.pmrem.compileEquirectangularShader();
      // a separate minimal sky used only to bake the environment map
      this.envScene = new THREE.Scene();
      this.envSky = new Sky();
      this.envSky.scale.setScalar(450000);
      this.envScene.add(this.envSky);
    }

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 400;
    cam.left = -90;
    cam.right = 90;
    cam.top = 70;
    cam.bottom = -70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4e8, 0x2a3326, 0.6);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(this.ambient);

    // a soft fill from the opposite side of the sun to lift shadows
    this.fill = new THREE.DirectionalLight(0xdfe9ff, 0.25);
    scene.add(this.fill);

    this.stars = this.makeStars();
    scene.add(this.stars);

    this.nightDome = this.makeNightDome();
    scene.add(this.nightDome);

    this.mode = 'day';
    this.applyMode('day');
  }

  // A view-correct vertical gradient dome used as the night sky (the physical
  // Sky shader can't get dark enough with the sun near the horizon).
  makeNightDome() {
    const geo = new THREE.SphereGeometry(2800, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x02040a) },
        horizon: { value: new THREE.Color(0x0c1c33) },
        glow: { value: new THREE.Color(0x16314f) }
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize((modelMatrix * vec4(position,1.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 glow;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(horizon, top, pow(h, 0.55));
          // subtle floodlit haze right at the horizon
          c += glow * pow(1.0 - clamp(abs(vDir.y),0.0,1.0), 6.0) * 0.6;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -1;
    dome.visible = false;
    dome.frustumCulled = false;
    return dome;
  }

  makeStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      v.set(
        Math.random() - 0.5,
        Math.random() * 0.6 + 0.05,
        Math.random() - 0.5
      )
        .normalize()
        .multiplyScalar(2000);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    pts.name = 'Stars';
    return pts;
  }

  sunDirection(elevation, azimuth) {
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }

  applyMode(mode) {
    const cfg = mode === 'night' ? SCENE.NIGHT : SCENE.DAY;
    this.mode = mode;
    const dir = this.sunDirection(cfg.elevation, cfg.azimuth);

    // sky shaders
    [this.sky, this.envSky].forEach((sky) => {
      if (!sky) return;
      const u = sky.material.uniforms;
      u.turbidity.value = cfg.turbidity;
      u.rayleigh.value = cfg.rayleigh;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      u.sunPosition.value.copy(dir);
    });

    // sun light + fill
    this.sun.position.copy(dir).multiplyScalar(220);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = cfg.sunIntensity;
    this.sun.color.set(mode === 'night' ? 0x9fb0d0 : 0xfff4e2);
    this.fill.position.copy(dir).multiplyScalar(-180);
    this.fill.position.y = Math.abs(this.fill.position.y) * 0.6 + 40;
    this.fill.intensity = mode === 'night' ? 0.05 : 0.3;

    // Without an IBL env map, lean a little harder on the analytic ambient.
    const ambBoost = this.useEnvMap ? 1.0 : 1.5;
    this.hemi.intensity = cfg.ambient * ambBoost;
    this.ambient.intensity = cfg.ambient * 0.5 * ambBoost;
    if (mode === 'night') {
      this.hemi.color.set(0x2a3a52);
      this.hemi.groundColor.set(0x05060a);
    } else {
      this.hemi.color.set(0xbfd4e8);
      this.hemi.groundColor.set(0x2a3326);
    }

    // backdrop: physical Sky by day, gradient dome by night
    this.sky.visible = mode !== 'night';
    this.nightDome.visible = mode === 'night';

    // fog + exposure
    this.scene.fog = new THREE.FogExp2(cfg.fog, cfg.fogDensity);
    this.renderer.toneMappingExposure = cfg.exposure;

    this.stars.material.opacity = mode === 'night' ? 0.9 : 0;

    this.refreshEnvironment();
  }

  refreshEnvironment() {
    if (!this.useEnvMap) {
      this.scene.environment = null;
      return;
    }
    if (this.envMap) this.envMap.dispose();
    this.envMap = this.pmrem.fromScene(this.envScene, 0.04);
    this.scene.environment = this.envMap.texture;
    this.scene.environmentIntensity = this.mode === 'night' ? 0.35 : 1.0;
  }

  toggle() {
    this.applyMode(this.mode === 'day' ? 'night' : 'day');
    return this.mode;
  }
}
