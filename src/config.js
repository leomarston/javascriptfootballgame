/**
 * config.js — single source of truth for the arena.
 *
 * All pitch measurements follow the IFAB Laws of the Game (in metres). World
 * units == metres. The pitch is centred on the origin:
 *   +X  → towards the "away" goal (right),  -X → "home" goal (left)
 *   +Z  → towards the main (broadcast) stand, -Z → far stand
 *   +Y  → up
 */

export const FIELD = {
  LENGTH: 105, // touchline length (goal-to-goal axis, X)
  WIDTH: 68, // goal line length (Z)
  get HALF_LENGTH() {
    return this.LENGTH / 2;
  },
  get HALF_WIDTH() {
    return this.WIDTH / 2;
  },

  LINE_WIDTH: 0.12, // painted line thickness

  // Grass run-off area painted/mown beyond the lines.
  MARGIN_END: 6.0, // behind each goal line
  MARGIN_SIDE: 5.0 // beyond each touchline
};

export const MARKINGS = {
  CENTER_CIRCLE_R: 9.15,
  CENTER_SPOT_R: 0.15,

  PENALTY_DEPTH: 16.5,
  PENALTY_HALF_WIDTH: 7.32 / 2 + 16.5, // 20.16
  GOAL_AREA_DEPTH: 5.5,
  GOAL_AREA_HALF_WIDTH: 7.32 / 2 + 5.5, // 9.16

  PENALTY_SPOT_DIST: 11.0,
  PENALTY_ARC_R: 9.15,
  CORNER_ARC_R: 1.0
};

export const GOAL = {
  WIDTH: 7.32,
  HEIGHT: 2.44,
  POST_RADIUS: 0.06,
  DEPTH_TOP: 1.6, // how far the net roof reaches back from the crossbar
  DEPTH_BOTTOM: 2.4 // how far the net foot reaches back along the ground
};

export const BALL = {
  RADIUS: 0.13,
  MASS: 0.43,
  RESTITUTION: 0.55, // bounciness against the turf
  ROLL_FRICTION: 0.55, // velocity damping while rolling (per second)
  AIR_DRAG: 0.18, // aerodynamic drag (per second)
  SPIN_DECAY: 1.2,
  MAX_SPEED: 42
};

// Tiered bowl seating geometry.
export const STAND = {
  // Distance from pitch centre lines to the foot of the lower tier.
  GAP_END: FIELD.HALF_LENGTH + FIELD.MARGIN_END + 3.0,
  GAP_SIDE: FIELD.HALF_WIDTH + FIELD.MARGIN_SIDE + 3.0,
  CORNER_RADIUS: 16.0,

  SEAT_SPACING: 0.52, // horizontal spacing along a row
  ROW_DEPTH: 0.82, // tread depth (how far back each row sits)
  ROW_RISE: 0.46, // riser height between rows

  LOWER_ROWS: 24,
  UPPER_ROWS: 30,
  TIER_GAP: 3.4, // concourse break between lower and upper tier (rows)
  TIER_STEP_BACK: 9.0, // how far the upper tier is set back horizontally
  TIER_STEP_UP: 7.5, // vertical lift to the foot of the upper tier

  BASE_HEIGHT: 1.4 // height of the lower tier foot above the pitch
};

// Visual identity for the two clubs / the arena dressing.
export const TEAMS = {
  HOME: {
    name: 'ASTRA',
    full: 'ASTRA UNITED',
    primary: 0xd81f33, // crimson
    secondary: 0xffffff,
    short: 'AST'
  },
  AWAY: {
    name: 'NOVA',
    full: 'NOVA CITY',
    primary: 0x1769ff, // royal blue
    secondary: 0x0b1f3a,
    short: 'NOV'
  }
};

export const COLORS = {
  GRASS_DARK: 0x2c6e2f,
  GRASS_LIGHT: 0x3a8a3d,
  LINE: 0xc6cbc3, // soft, matte chalk-white (kept under 1.0 so it never blooms)
  STEEL: 0xc9d2dc,
  ROOF: 0x2a2f38,
  ROOF_UNDER: 0x161a20,
  CONCRETE: 0x6b6f75,
  TRACK: 0x9c3b2e,
  NIGHT_SKY: 0x05070d
};

// Quality / performance knobs. Lowered automatically on weak hardware.
export const QUALITY = {
  shadowMapSize: 4096,
  maxPixelRatio: 2,
  bloom: true,
  envMap: true,
  crowd: true,
  seatDetail: true
};

export const SCENE = {
  // Sun direction is expressed as elevation/azimuth (degrees) and converted to a
  // position by the Environment module.
  DAY: {
    elevation: 34,
    azimuth: 150,
    turbidity: 6,
    rayleigh: 1.2,
    sunIntensity: 3.1,
    ambient: 0.55,
    exposure: 1.0,
    fog: 0x9fb4c7,
    fogDensity: 0.0016
  },
  NIGHT: {
    elevation: -6,
    azimuth: 150,
    turbidity: 12,
    rayleigh: 0.6,
    sunIntensity: 0.05,
    ambient: 0.12,
    exposure: 0.82,
    fog: 0x0a0e16,
    fogDensity: 0.003
  }
};
