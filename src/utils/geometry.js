/**
 * geometry.js — small reusable maths helpers.
 *
 * The star of this file is the rounded-rectangle perimeter sampler. A football
 * bowl is essentially a rounded rectangle extruded upward and outward, so being
 * able to walk its outline by arc-length (and know the outward normal at every
 * point) lets us place seats, roof panels and LED boards consistently.
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg2rad = (d) => (d * Math.PI) / 180;
export const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Describes a rounded rectangle centred on the origin in the XZ plane.
 * @param {number} halfX  half-extent along X to the start of the corner arc
 * @param {number} halfZ  half-extent along Z to the start of the corner arc
 * @param {number} r      corner radius
 */
export function roundedRect(halfX, halfZ, r) {
  const straightX = 2 * halfX; // length of each top/bottom straight run
  const straightZ = 2 * halfZ; // length of each left/right straight run
  const arc = (Math.PI / 2) * r; // length of one quarter-circle corner
  const perimeter = 2 * straightX + 2 * straightZ + 4 * arc;

  // The outline is traversed counter-clockwise starting at the +X / -Z corner
  // exit, segment by segment. Each entry stores its cumulative start length.
  const segments = [];
  let acc = 0;
  const push = (len, fn) => {
    segments.push({ start: acc, len, fn });
    acc += len;
  };

  // +X straight side (front-right edge), travelling -Z → +Z
  push(straightZ, (u) => ({
    x: halfX + r,
    z: -halfZ + u,
    nx: 1,
    nz: 0
  }));
  // top-right corner arc (+X,+Z)
  push(arc, (u) => {
    const a = (u / arc) * (Math.PI / 2); // 0 → 90°
    return {
      x: halfX + r * Math.cos(a),
      z: halfZ + r * Math.sin(a),
      nx: Math.cos(a),
      nz: Math.sin(a)
    };
  });
  // +Z straight side, travelling +X → -X
  push(straightX, (u) => ({
    x: halfX - u,
    z: halfZ + r,
    nx: 0,
    nz: 1
  }));
  // top-left corner arc (-X,+Z)
  push(arc, (u) => {
    const a = (u / arc) * (Math.PI / 2) + Math.PI / 2;
    return {
      x: -halfX + r * Math.cos(a),
      z: halfZ + r * Math.sin(a),
      nx: Math.cos(a),
      nz: Math.sin(a)
    };
  });
  // -X straight side, travelling +Z → -Z
  push(straightZ, (u) => ({
    x: -halfX - r,
    z: halfZ - u,
    nx: -1,
    nz: 0
  }));
  // bottom-left corner arc (-X,-Z)
  push(arc, (u) => {
    const a = (u / arc) * (Math.PI / 2) + Math.PI;
    return {
      x: -halfX + r * Math.cos(a),
      z: -halfZ + r * Math.sin(a),
      nx: Math.cos(a),
      nz: Math.sin(a)
    };
  });
  // -Z straight side, travelling -X → +X
  push(straightX, (u) => ({
    x: -halfX + u,
    z: -halfZ - r,
    nx: 0,
    nz: -1
  }));
  // bottom-right corner arc (+X,-Z)
  push(arc, (u) => {
    const a = (u / arc) * (Math.PI / 2) + (3 * Math.PI) / 2;
    return {
      x: halfX + r * Math.cos(a),
      z: -halfZ + r * Math.sin(a),
      nx: Math.cos(a),
      nz: Math.sin(a)
    };
  });

  /**
   * Sample the outline at arc-length distance `s` (0..perimeter, wraps).
   * Returns world position {x,z} and the outward unit normal {nx,nz}.
   */
  const at = (s) => {
    let d = ((s % perimeter) + perimeter) % perimeter;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (d >= segments[i].start) {
        return segments[i].fn(d - segments[i].start);
      }
    }
    return segments[0].fn(0);
  };

  return { perimeter, at };
}
