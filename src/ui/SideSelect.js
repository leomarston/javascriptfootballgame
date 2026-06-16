/**
 * SideSelect.js — the "choose your side" screen shown after KICK OFF, modelled
 * on a console controller-assignment screen: a Home | Away board with controller
 * slots, the player's own controller token sitting on the side they've picked,
 * and the controller-hint bar along the bottom.
 *
 * Left/Right (or A/D, or clicking a side) moves the token between Home and Away.
 * Confirm (Enter / Space / ✕ / clicking the chosen side again) starts the match
 * on that side; Return (Esc / Backspace) goes back to the main menu.
 */

import { TEAMS } from '../config.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

// a generic gamepad silhouette (no proprietary artwork)
const PAD_SVG = `<svg viewBox="0 0 120 80" aria-hidden="true">
  <path d="M60 14 C45 14 41 16 34 22 L19 37 C9 47 7 64 15 70 C23 76 31 70 39 62
           C45 57 49 56 60 56 C71 56 75 57 81 62 C89 70 97 76 105 70
           C113 64 111 47 101 37 L86 22 C79 16 75 14 60 14 Z"/>
  <circle cx="46" cy="41" r="5.5"/>
  <circle cx="74" cy="41" r="5.5"/>
</svg>`;

const pad = (parent, cls) => el('div', 'pad ' + (cls || ''), parent, PAD_SVG);

export class SideSelect {
  constructor({ onConfirm, onCancel }) {
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.side = 'HOME';
    this.done = false;
    this.build();
    this.onKey = (e) => this.handleKey(e);
    addEventListener('keydown', this.onKey);
  }

  build() {
    const root = el('div', 'ss side-home', document.body);
    this.root = root;

    el('div', 'ss-bg', root);
    root.insertAdjacentHTML('beforeend', this.ribbons());

    const panel = el('div', 'ss-panel', root);
    const head = el('div', 'ss-head', panel);
    const hHome = el('div', 'ss-head-cell home', head, 'Home');
    el('div', 'ss-head-cell mid', head, '');
    const hAway = el('div', 'ss-head-cell away', head, 'Away');
    hHome.addEventListener('click', () => this.pick('HOME'));
    hAway.addEventListener('click', () => this.pick('AWAY'));

    const grid = el('div', 'ss-grid', panel);

    // top row: token sits on the chosen side, empty middle, silhouette opposite
    const top = el('div', 'ss-row', grid);
    const homeCell = el('div', 'ss-cell home', top);
    this.token(homeCell, 'HOME');
    pad(homeCell, 'ghost'); // shown when the token is on the other side
    el('div', 'ss-cell mid', top);
    const awayCell = el('div', 'ss-cell away', top);
    this.token(awayCell, 'AWAY');
    pad(awayCell, 'ghost');
    homeCell.addEventListener('click', () => this.pickOrConfirm('HOME'));
    awayCell.addEventListener('click', () => this.pickOrConfirm('AWAY'));

    // remaining rows: three idle slots each
    for (let r = 0; r < 7; r++) {
      const row = el('div', 'ss-row', grid);
      const h = el('div', 'ss-cell home', row); pad(h);
      const m = el('div', 'ss-cell mid', row); pad(m);
      const a = el('div', 'ss-cell away', row); pad(a);
      h.addEventListener('click', () => this.pick('HOME'));
      a.addEventListener('click', () => this.pick('AWAY'));
    }

    // controller hint bar
    const hints = el('div', 'ss-hints', root);
    this.hint(hints, 'cross', '✕', 'Confirm', () => this.confirm());
    this.hint(hints, 'circle', '○', 'Return', () => this.cancel());
    this.hint(hints, 'square', '□', 'Edit Personal Preset');
    this.hint(hints, 'triangle', '△', 'Coach Mode');
    const combo = el('span', 'ss-hint', hints);
    el('i', 'glyph pill', combo, 'L2');
    el('i', 'glyph pill', combo, 'R2');
    el('span', 'ss-hint-label', combo, 'Select Personal Preset');

    requestAnimationFrame(() => root.classList.add('show'));
  }

  token(parent, side) {
    const t = el('div', 'token ' + side.toLowerCase(), parent);
    const name = TEAMS[side].short;
    if (side === 'AWAY') el('div', 'chev', t, '‹');
    const body = el('div', 'token-body', t);
    el('div', 'token-name', body, 'Player 1');
    pad(body, 'active');
    el('div', 'token-team', body, TEAMS[side].name);
    if (side === 'HOME') el('div', 'chev', t, '›');
    return t;
  }

  hint(parent, glyphCls, sym, label, fn) {
    const h = el('span', 'ss-hint' + (fn ? ' live' : ''), parent);
    el('i', 'glyph ' + glyphCls, h, sym);
    el('span', 'ss-hint-label', h, label);
    if (fn) h.addEventListener('click', fn);
    return h;
  }

  // top-left and bottom-right colour ribbons, drawn as curved SVG bands
  ribbons() {
    const band = (d, c, w) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
    return `<svg class="ss-ribbons" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <g>
        ${band('M-40 250 C 180 80 360 40 600 -40', '#1fae6e', 70)}
        ${band('M-60 320 C 170 130 360 90 620 0', '#2f6df6', 46)}
        ${band('M-70 380 C 160 190 360 150 640 50', '#ff3b4e', 30)}
        ${band('M-80 430 C 150 250 360 210 660 110', '#ffd23f', 20)}
        ${band('M-90 470 C 150 300 360 260 680 170', '#18c2b0', 14)}
      </g>
      <g>
        ${band('M1640 650 C 1420 820 1240 860 1000 940', '#1fae6e', 70)}
        ${band('M1660 580 C 1430 770 1240 810 980 900', '#ff3b4e', 46)}
        ${band('M1670 520 C 1440 710 1240 670 960 850', '#ffd23f', 30)}
        ${band('M1680 470 C 1450 650 1240 610 940 790', '#2f6df6', 20)}
        ${band('M1690 430 C 1450 600 1240 560 920 730', '#18c2b0', 14)}
      </g>
    </svg>`;
  }

  // --- interaction ---
  pick(side) {
    if (this.side === side) return;
    this.side = side;
    this.root.classList.toggle('side-home', side === 'HOME');
    this.root.classList.toggle('side-away', side === 'AWAY');
  }

  pickOrConfirm(side) {
    if (this.side === side) this.confirm();
    else this.pick(side);
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); this.pick('HOME'); }
    else if (k === 'arrowright' || k === 'd') { e.preventDefault(); this.pick('AWAY'); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); this.confirm(); }
    else if (k === 'escape' || k === 'backspace') { e.preventDefault(); this.cancel(); }
  }

  confirm() {
    if (this.done) return;
    this.done = true;
    removeEventListener('keydown', this.onKey);
    this.root.classList.add('leaving');
    const side = this.side;
    setTimeout(() => this.destroy(), 360);
    this.onConfirm(side);
  }

  cancel() {
    if (this.done) return;
    this.done = true;
    removeEventListener('keydown', this.onKey);
    this.destroy();
    this.onCancel();
  }

  destroy() {
    removeEventListener('keydown', this.onKey);
    if (this.root) this.root.remove();
    this.root = null;
  }
}
