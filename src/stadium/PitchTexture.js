/**
 * PitchTexture.js — procedural turf + line-marking texture generation.
 *
 * Everything here is drawn with the 2D canvas API at high resolution and then
 * handed to Three.js as textures. We produce three maps:
 *   • albedo    — grass stripes, mottling, goalmouth wear and every white line,
 *                 all positioned to IFAB metre measurements.
 *   • normal    — a tiled, anisotropic "blades of grass" bump so the sun and
 *                 floodlights rake across the turf instead of hitting a flat plane.
 *   • roughness — gentle wet/dry variation so reflections aren't uniform.
 */

import * as THREE from 'three';
import { FIELD, MARKINGS, COLORS } from '../config.js';

const GRASS_L = FIELD.LENGTH + 2 * FIELD.MARGIN_END; // 117 m
const GRASS_W = FIELD.WIDTH + 2 * FIELD.MARGIN_SIDE; // 78 m

export const PITCH_PLANE = { length: GRASS_L, width: GRASS_W };

const hexToRgb = (hex) => ({
  r: (hex >> 16) & 255,
  g: (hex >> 8) & 255,
  b: hex & 255
});

function valueNoise(size, octaves, persistence) {
  // Multi-octave value noise normalised to 0..1.
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = Math.max(2, Math.floor(size / (2 ** (octaves - o))));
    const grid = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
    const scale = size / cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = x / scale;
        const gy = y / scale;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const tx = gx - x0;
        const ty = gy - y0;
        // smoothstep interpolation
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = grid[y0 * (cells + 1) + x0];
        const b = grid[y0 * (cells + 1) + x0 + 1];
        const c = grid[(y0 + 1) * (cells + 1) + x0];
        const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
        const top = a + (b - a) * sx;
        const bot = c + (d - c) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Big non-repeating albedo with grass + every painted line. */
export function createPitchAlbedo() {
  const W = 4096;
  const H = Math.round((W * GRASS_W) / GRASS_L);
  const scale = W / GRASS_L; // px per metre
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // metre → pixel mappers (origin at pitch centre)
  const mx = (x) => (x + GRASS_L / 2) * scale;
  const mz = (z) => (z + GRASS_W / 2) * scale;

  const dark = hexToRgb(COLORS.GRASS_DARK);
  const light = hexToRgb(COLORS.GRASS_LIGHT);

  // ---- 1. mowing stripes -------------------------------------------------
  // 21 stripes of 5 m, centred so a stripe sits symmetrically on the halfway line.
  const stripeW = 5.0;
  const minIdx = Math.floor((-GRASS_L / 2 + stripeW / 2) / stripeW) - 1;
  const maxIdx = Math.ceil((GRASS_L / 2 + stripeW / 2) / stripeW) + 1;
  for (let i = minIdx; i <= maxIdx; i++) {
    const isLight = ((i % 2) + 2) % 2 === 0;
    const base = isLight ? light : dark;
    const jitter = (Math.random() - 0.5) * 8;
    const x0 = mx(i * stripeW - stripeW / 2);
    const x1 = mx(i * stripeW + stripeW / 2);
    // subtle vertical gradient inside each stripe for a touch of depth
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const c0 = `rgb(${base.r + jitter + 4},${base.g + jitter + 6},${base.b + jitter})`;
    const c1 = `rgb(${base.r + jitter - 6},${base.g + jitter - 4},${base.b + jitter - 4})`;
    grad.addColorStop(0, c0);
    grad.addColorStop(0.5, `rgb(${base.r + jitter},${base.g + jitter},${base.b + jitter})`);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, x1 - x0, H);
  }

  // ---- 2. organic mottling (clumps of slightly different green) ----------
  ctx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < 220; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    const r = (3 + Math.random() * 11) * scale;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const tone = Math.random() > 0.5 ? 210 : 60;
    g.addColorStop(0, `rgba(${tone},${tone},${tone},0.16)`);
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // ---- 3. goalmouth + centre-circle wear (lighter, scuffed turf) ---------
  const wear = (x, z, rx, rz, a) => {
    const g = ctx.createRadialGradient(mx(x), mz(z), 0, mx(x), mz(z), rx * scale);
    g.addColorStop(0, `rgba(150,150,120,${a})`);
    g.addColorStop(0.7, `rgba(150,150,120,${a * 0.4})`);
    g.addColorStop(1, 'rgba(150,150,120,0)');
    ctx.save();
    ctx.translate(mx(x), mz(z));
    ctx.scale(1, rz / rx);
    ctx.translate(-mx(x), -mz(z));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx(x), mz(z), rx * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  wear(-FIELD.HALF_LENGTH + 5.5, 0, 9, 3.4, 0.22); // home goalmouth
  wear(FIELD.HALF_LENGTH - 5.5, 0, 9, 3.4, 0.22); // away goalmouth
  wear(0, 0, 10, 10, 0.1); // centre circle

  // ---- 4. fine grain (tiled noise pattern) -------------------------------
  const grain = document.createElement('canvas');
  grain.width = grain.height = 256;
  const gctx = grain.getContext('2d');
  const img = gctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 110 + Math.random() * 36;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  gctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.12;
  const pattern = ctx.createPattern(grain, 'repeat');
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ---- 5. painted lines --------------------------------------------------
  drawLines(ctx, mx, mz, scale);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function drawLines(ctx, mx, mz, scale) {
  const lw = FIELD.LINE_WIDTH * scale;
  ctx.strokeStyle = `rgb(${hexToRgb(COLORS.LINE).r},${hexToRgb(COLORS.LINE).g},${hexToRgb(COLORS.LINE).b})`;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const L = FIELD.HALF_LENGTH;
  const Wd = FIELD.HALF_WIDTH;

  const seg = (x0, z0, x1, z1) => {
    ctx.beginPath();
    ctx.moveTo(mx(x0), mz(z0));
    ctx.lineTo(mx(x1), mz(z1));
    ctx.stroke();
  };
  const dot = (x, z, r) => {
    ctx.beginPath();
    ctx.arc(mx(x), mz(z), r * scale, 0, Math.PI * 2);
    ctx.fill();
  };
  const arc = (x, z, r, a0, a1) => {
    ctx.beginPath();
    ctx.arc(mx(x), mz(z), r * scale, a0, a1);
    ctx.stroke();
  };

  // outer boundary
  ctx.strokeRect(mx(-L), mz(-Wd), 2 * L * scale, 2 * Wd * scale);
  // halfway line + centre circle + spot
  seg(0, -Wd, 0, Wd);
  arc(0, 0, MARKINGS.CENTER_CIRCLE_R, 0, Math.PI * 2);
  dot(0, 0, MARKINGS.CENTER_SPOT_R);

  const goalSide = (sign) => {
    const gl = sign * L; // goal line x
    const dir = -sign; // direction into the field
    const pa = MARKINGS.PENALTY_HALF_WIDTH;
    const pd = MARKINGS.PENALTY_DEPTH;
    const ga = MARKINGS.GOAL_AREA_HALF_WIDTH;
    const gd = MARKINGS.GOAL_AREA_DEPTH;

    // penalty area (3 inner sides)
    seg(gl, -pa, gl + dir * pd, -pa);
    seg(gl + dir * pd, -pa, gl + dir * pd, pa);
    seg(gl + dir * pd, pa, gl, pa);
    // goal area
    seg(gl, -ga, gl + dir * gd, -ga);
    seg(gl + dir * gd, -ga, gl + dir * gd, ga);
    seg(gl + dir * gd, ga, gl, ga);
    // penalty spot
    const spotX = gl + dir * MARKINGS.PENALTY_SPOT_DIST;
    dot(spotX, 0, 0.16);
    // penalty arc (only the bulge outside the box)
    const a = Math.acos((MARKINGS.PENALTY_DEPTH - MARKINGS.PENALTY_SPOT_DIST) / MARKINGS.PENALTY_ARC_R);
    if (sign < 0) arc(spotX, 0, MARKINGS.PENALTY_ARC_R, -a, a);
    else arc(spotX, 0, MARKINGS.PENALTY_ARC_R, Math.PI - a, Math.PI + a);
  };
  goalSide(-1);
  goalSide(1);

  // corner arcs
  const cr = MARKINGS.CORNER_ARC_R;
  arc(-L, -Wd, cr, 0, Math.PI / 2);
  arc(L, -Wd, cr, Math.PI / 2, Math.PI);
  arc(-L, Wd, cr, -Math.PI / 2, 0);
  arc(L, Wd, cr, Math.PI, 1.5 * Math.PI);
}

/** Tiled anisotropic turf normal map (grass blades). */
export function createTurfNormal(size = 512) {
  // Stretch the noise vertically so blades read as vertical streaks.
  const h = valueNoise(size, 5, 0.55);
  const hv = valueNoise(size, 6, 0.6); // finer vertical detail
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) {
    height[i] = h[i] * 0.55 + hv[i] * 0.45;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const idx = (x, y) => ((y + size) % size) * size + ((x + size) % size);
  const strength = 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (height[idx(x + 1, y)] - height[idx(x - 1, y)]) * strength;
      const dy = (height[idx(x, y + 1)] - height[idx(x, y - 1)]) * strength * 1.6;
      // normal = normalize(-dx, -dy, 1)
      const len = Math.hypot(dx, dy, 1);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = 1 / len;
      const o = (y * size + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  return tex;
}

/** Tiled roughness map — slightly damp patches reflect more. */
export function createTurfRoughness(size = 512) {
  const n = valueNoise(size, 4, 0.6);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = 200 + (n[i] - 0.5) * 70; // ~0.78 roughness with variation
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
