/**
 * nations.js — the ten national teams offered on the team-select screen.
 *
 * Each entry carries a 3-letter code, display name, confederation, kit colours
 * (shirt / shorts / socks, applied to the in-match players), a cosmetic star
 * rating and FW/MF/DF ratings (display only), and a flag drawn as a simple
 * geometric SVG. National flags are public-domain symbols; these are plain
 * geometric renditions (no coats of arms or other intricate emblems).
 */

// viewBox 0 0 60 40 flags, returned as SVG markup strings.
const FLAGS = {
  ARG: `<rect width="60" height="40" fill="#74acdf"/><rect y="13.3" width="60" height="13.3" fill="#fff"/><circle cx="30" cy="20" r="4.2" fill="#f6b40e"/>`,
  FRA: `<rect width="20" height="40" fill="#0055a4"/><rect x="20" width="20" height="40" fill="#fff"/><rect x="40" width="20" height="40" fill="#ef4135"/>`,
  ESP: `<rect width="60" height="40" fill="#c60b1e"/><rect y="10" width="60" height="20" fill="#ffc400"/>`,
  ENG: `<rect width="60" height="40" fill="#fff"/><rect x="25" width="10" height="40" fill="#ce1124"/><rect y="15" width="60" height="10" fill="#ce1124"/>`,
  BRA: `<rect width="60" height="40" fill="#009b3a"/><polygon points="30,5 55,20 30,35 5,20" fill="#ffdf00"/><circle cx="30" cy="20" r="7" fill="#002776"/>`,
  POR: `<rect width="60" height="40" fill="#da291c"/><rect width="24" height="40" fill="#046a38"/><circle cx="24" cy="20" r="4.4" fill="#ffe600"/>`,
  NED: `<rect width="60" height="40" fill="#ae1c28"/><rect y="13.3" width="60" height="13.3" fill="#fff"/><rect y="26.6" width="60" height="13.4" fill="#21468b"/>`,
  BEL: `<rect width="20" height="40" fill="#000"/><rect x="20" width="20" height="40" fill="#fdda24"/><rect x="40" width="20" height="40" fill="#ef3340"/>`,
  ITA: `<rect width="20" height="40" fill="#009246"/><rect x="20" width="20" height="40" fill="#fff"/><rect x="40" width="20" height="40" fill="#ce2b37"/>`,
  GER: `<rect width="60" height="40" fill="#000"/><rect y="13.3" width="60" height="13.3" fill="#dd0000"/><rect y="26.6" width="60" height="13.4" fill="#ffce00"/>`
};

export function flagSVG(id, cls = '') {
  return `<svg class="flag ${cls}" viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice">${FLAGS[id] || ''}</svg>`;
}

// Real country flags off a public-domain flag CDN (flagcdn.com). `code` is the
// ISO 3166-1 alpha-2 (or gb-eng for England).
export function flagURL(code) {
  return `https://flagcdn.com/${code}.svg`;
}

// A real flag <img> with the simple drawn flag as an offline/blocked fallback.
// `nation` needs { code, id }.
export function makeFlag(nation, cls = '') {
  const img = document.createElement('img');
  img.className = 'flag-img' + (cls ? ' ' + cls : '');
  img.alt = nation.name || '';
  img.decoding = 'async';
  if (nation.code) img.src = flagURL(nation.code);
  img.onerror = () => {
    img.onerror = null;
    const tmp = document.createElement('div');
    tmp.innerHTML = flagSVG(nation.id, cls);
    const svg = tmp.firstElementChild;
    if (svg) img.replaceWith(svg);
    else img.style.display = 'none';
  };
  if (!nation.code) img.onerror();
  return img;
}

// The current top-10 (cosmetic ratings; kit colours drive the in-match teams).
export const NATIONS = [
  { id: 'ARG', code: 'ar', name: 'Argentina', confed: 'CONMEBOL', stars: 5.0, fw: 90, mf: 86, df: 84, colors: { shirt: 0x73b5e6, shorts: 0x12161c, socks: 0xffffff } },
  { id: 'FRA', code: 'fr', name: 'France', confed: 'UEFA', stars: 5.0, fw: 89, mf: 88, df: 87, colors: { shirt: 0x1d3a8a, shorts: 0xf2f3f5, socks: 0xc8102e } },
  { id: 'ESP', code: 'es', name: 'Spain', confed: 'UEFA', stars: 4.5, fw: 85, mf: 89, df: 85, colors: { shirt: 0xc60b1e, shorts: 0x10245e, socks: 0xc60b1e } },
  { id: 'ENG', code: 'gb-eng', name: 'England', confed: 'UEFA', stars: 4.5, fw: 87, mf: 86, df: 85, colors: { shirt: 0xf3f4f6, shorts: 0x1b2a52, socks: 0xf3f4f6 } },
  { id: 'BRA', code: 'br', name: 'Brazil', confed: 'CONMEBOL', stars: 4.5, fw: 88, mf: 85, df: 83, colors: { shirt: 0xffd400, shorts: 0x1e3fae, socks: 0xffffff } },
  { id: 'POR', code: 'pt', name: 'Portugal', confed: 'UEFA', stars: 4.5, fw: 87, mf: 85, df: 82, colors: { shirt: 0x8a1538, shorts: 0x0a3d2e, socks: 0x8a1538 } },
  { id: 'NED', code: 'nl', name: 'Netherlands', confed: 'UEFA', stars: 4.0, fw: 84, mf: 84, df: 85, colors: { shirt: 0xee7711, shorts: 0x12161c, socks: 0xee7711 } },
  { id: 'BEL', code: 'be', name: 'Belgium', confed: 'UEFA', stars: 4.0, fw: 85, mf: 84, df: 80, colors: { shirt: 0xb81d2c, shorts: 0x12161c, socks: 0xb81d2c } },
  { id: 'ITA', code: 'it', name: 'Italy', confed: 'UEFA', stars: 4.0, fw: 80, mf: 84, df: 87, colors: { shirt: 0x1a5fb4, shorts: 0xf2f3f5, socks: 0x1a5fb4 } },
  { id: 'GER', code: 'de', name: 'Germany', confed: 'UEFA', stars: 4.5, fw: 84, mf: 87, df: 83, colors: { shirt: 0xf3f4f6, shorts: 0x12161c, socks: 0xf3f4f6 } }
];

// 'ARG' -> 'ARG' code shown on the scoreboard; reuse the id as the short code.
export const nationShort = (n) => n.id;
