/**
 * lowpoly.js — a faceted, low-poly triangle-mesh background.
 *
 * Builds an SVG of jittered triangles shaded between two colours along the
 * diagonal (plus a little per-facet variance), so the menu screens read as a
 * stylised low-poly gradient rather than a smooth one. Deterministic per seed
 * so it doesn't shimmer on re-render.
 */

const rgb = (hex) => ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

export function facetSVG(c0, c1, { cols = 10, rows = 7, seed = 1, jitter = 0.72, variance = 0.16 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const W = 100;
  const H = 100;
  const A = rgb(c0);
  const B = rgb(c1);

  // jittered lattice (edges pinned so it tiles the rectangle fully)
  const pts = [];
  for (let y = 0; y <= rows; y++) {
    pts[y] = [];
    for (let x = 0; x <= cols; x++) {
      const jx = x === 0 || x === cols ? 0 : (rnd() - 0.5) * (W / cols) * jitter;
      const jy = y === 0 || y === rows ? 0 : (rnd() - 0.5) * (H / rows) * jitter;
      pts[y][x] = [(x / cols) * W + jx, (y / rows) * H + jy];
    }
  }

  const fill = (cx, cy) => {
    const t = Math.min(1, Math.max(0, (cx / W + cy / H) / 2 + (rnd() - 0.5) * variance));
    return `rgb(${lerp(A.r, B.r, t)},${lerp(A.g, B.g, t)},${lerp(A.b, B.b, t)})`;
  };
  const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

  let tris = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = pts[y][x];
      const b = pts[y][x + 1];
      const c = pts[y + 1][x];
      const d = pts[y + 1][x + 1];
      tris += `<polygon points="${f(a)} ${f(b)} ${f(c)}" fill="${fill((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)}"/>`;
      tris += `<polygon points="${f(b)} ${f(d)} ${f(c)}" fill="${fill((b[0] + d[0] + c[0]) / 3, (b[1] + d[1] + c[1]) / 3)}"/>`;
    }
  }
  return `<svg class="facet" viewBox="0 0 100 100" preserveAspectRatio="none">${tris}</svg>`;
}
