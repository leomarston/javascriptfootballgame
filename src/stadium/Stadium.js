/**
 * Stadium.js — assembles every structural piece into one group.
 *
 * Construction is staged through `build(report)` with frame yields so the
 * loading screen animates honestly while the heavy textures and tens of
 * thousands of seat/crowd instances are generated.
 */

import * as THREE from 'three';
import { Pitch } from './Pitch.js';
import { Goals } from './Goals.js';
import { Stands } from './Stands.js';
import { Roof } from './Roof.js';
import { Crowd } from './Crowd.js';
import { AdBoards } from './AdBoards.js';
import { Floodlights } from './Floodlights.js';
import { Surroundings } from './Surroundings.js';
import { QUALITY } from '../config.js';
import { nextFrame } from '../utils/async.js';

export class Stadium {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Stadium';
  }

  get object() {
    return this.group;
  }

  async build(report = () => {}) {
    const steps = [
      ['Laying the turf & markings', 0.2, () => (this.surroundings = new Surroundings())],
      ['Painting the pitch', 0.42, () => (this.pitch = new Pitch())],
      ['Hanging the nets', 0.5, () => (this.goals = new Goals())],
      ['Raising the stands', 0.7, () => (this.stands = new Stands())],
      ['Building the roof', 0.78, () => (this.roof = new Roof())],
      ['Wiring the LED boards', 0.84, () => (this.adBoards = new AdBoards())],
      ['Erecting the floodlights', 0.9, () => (this.floodlights = new Floodlights())]
    ];

    for (const [label, frac, make] of steps) {
      report(frac, label);
      await nextFrame();
      const piece = make();
      this.group.add(piece.object);
    }

    if (QUALITY.crowd) {
      report(0.97, 'Filling the stands');
      await nextFrame();
      this.crowd = new Crowd();
      this.group.add(this.crowd.object);
    }

    report(1, 'Kickoff!');
    await nextFrame();
  }

  setNight(isNight) {
    this.roof.setNight(isNight);
    this.floodlights.setNight(isNight);
  }

  update(dt) {
    if (this.adBoards) this.adBoards.update(dt);
  }
}
