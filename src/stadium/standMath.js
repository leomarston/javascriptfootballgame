/**
 * standMath.js — derives the bowl's tier dimensions from config so the stands,
 * roof and floodlights stay perfectly aligned.
 *
 * The bowl is a rounded rectangle. Its straight half-extents (core) stay fixed
 * while the corner radius grows row-by-row, which is exactly a uniform outward
 * offset of a rounded rect (Minkowski sum with a growing disk).
 */

import { STAND } from '../config.js';

export function computeTiers() {
  const baseR = STAND.CORNER_RADIUS;
  const core = {
    halfX: STAND.GAP_END - baseR,
    halfZ: STAND.GAP_SIDE - baseR
  };

  const lower = {
    core,
    rows: STAND.LOWER_ROWS,
    rFront: baseR,
    yFront: STAND.BASE_HEIGHT,
    get rBack() {
      return this.rFront + (this.rows - 1) * STAND.ROW_DEPTH;
    },
    get yBack() {
      return this.yFront + (this.rows - 1) * STAND.ROW_RISE;
    }
  };

  const upper = {
    core,
    rows: STAND.UPPER_ROWS,
    rFront:
      baseR +
      (STAND.LOWER_ROWS + STAND.TIER_GAP) * STAND.ROW_DEPTH +
      STAND.TIER_STEP_BACK,
    yFront:
      STAND.BASE_HEIGHT + STAND.LOWER_ROWS * STAND.ROW_RISE + STAND.TIER_STEP_UP,
    get rBack() {
      return this.rFront + (this.rows - 1) * STAND.ROW_DEPTH;
    },
    get yBack() {
      return this.yFront + (this.rows - 1) * STAND.ROW_RISE;
    }
  };

  const roof = {
    innerR: upper.rFront - 3.0,
    outerR: upper.rBack + 5.0,
    frontY: upper.yBack + 5.5,
    backY: upper.yBack + 9.0
  };

  return { core, baseR, lower, upper, roof };
}
