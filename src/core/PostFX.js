/**
 * PostFX.js — the composer chain that gives the "engine" look:
 *   RenderPass → UnrealBloom (floodlights/LEDs glow) → OutputPass (ACES + sRGB)
 *   → SMAA (clean edges).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { QUALITY } from '../config.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (QUALITY.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        0.4, // strength
        0.7, // radius
        1.1 // threshold > 1.0, so only true HDR emissives (floodlight lamps,
        //                  LED banks) bloom — never the floodlit white lines,
        //                  ad-board text or kits, which sit at/below 1.0
      );
      this.composer.addPass(this.bloom);
    }

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
  }

  setNight(isNight) {
    if (this.bloom) {
      // keep the threshold above 1.0 both day and night so only the actual
      // lamps/LEDs glow; the floodlit pitch lines and boards never bloom
      this.bloom.strength = isNight ? 0.6 : 0.35;
      this.bloom.threshold = isNight ? 1.05 : 1.15;
    }
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }

  render(camera) {
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
