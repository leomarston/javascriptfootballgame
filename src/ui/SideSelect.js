/**
 * SideSelect.js — couch-play side assignment, modelled on a console controller
 * board. Two controller tokens (P1, P2) sit in one of three zones: Home, Not
 * Playing, or Away. Both on the same side = co-op; opposite sides = versus; P2
 * in "Not Playing" = a solo game.
 *
 *   P1: A → Home, D → Away (P1 always plays).
 *   P2: ← / → step Home ⇆ Not Playing ⇆ Away (click the P2 pad to cycle too).
 *   Enter = confirm (start team-select), Esc/Backspace = back to the menu.
 */

import { facetSVG } from './lowpoly.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

const PAD_SVG = `<svg viewBox="0 0 120 80" aria-hidden="true">
  <path d="M60 14 C45 14 41 16 34 22 L19 37 C9 47 7 64 15 70 C23 76 31 70 39 62
           C45 57 49 56 60 56 C71 56 75 57 81 62 C89 70 97 76 105 70
           C113 64 111 47 101 37 L86 22 C79 16 75 14 60 14 Z"/>
  <circle cx="46" cy="41" r="5.5"/>
  <circle cx="74" cy="41" r="5.5"/>
</svg>`;

const P2_ORDER = ['HOME', 'OFF', 'AWAY'];

export class SideSelect {
  constructor({ onConfirm, onCancel }) {
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.p1 = 'HOME';
    this.p2 = 'OFF'; // solo by default
    this.done = false;
    this.build();
    this.onKey = (e) => this.handleKey(e);
    addEventListener('keydown', this.onKey);
  }

  build() {
    const root = el('div', 'ss', document.body);
    this.root = root;
    el('div', 'ss-bg', root).innerHTML = facetSVG(0x241a52, 0x120d2c, { seed: 11 });
    root.insertAdjacentHTML('beforeend', this.ribbons());

    const board = el('div', 'ss-board', root);
    this.zones = {};
    this.zones.HOME = this.zone(board, 'home', 'Home');
    this.zones.OFF = this.zone(board, 'off', 'Not Playing');
    this.zones.AWAY = this.zone(board, 'away', 'Away');

    // the two controller tokens
    this.tok1 = this.token('p1', 'P1');
    this.tok2 = this.token('p2', 'P2');
    this.tok2.addEventListener('click', () => this.cycleP2(1));

    this.place();
    requestAnimationFrame(() => root.classList.add('show'));
  }

  zone(parent, cls, title) {
    const z = el('div', 'ss-zone ' + cls, parent);
    el('div', 'ss-zone-title', z, title);
    const slots = el('div', 'ss-zone-slots', z);
    for (let i = 0; i < 3; i++) el('div', 'pad ghost', slots, PAD_SVG); // decorative
    z.__slots = slots;
    z.addEventListener('click', () => { if (cls === 'home') this.setP1('HOME'); else if (cls === 'away') this.setP1('AWAY'); });
    return z;
  }

  token(cls, label) {
    const t = el('div', 'ss-token ' + cls);
    el('div', 'ss-token-name', t, label);
    el('div', 'pad active', t, PAD_SVG);
    t.__cap = el('div', 'ss-token-cap', t, '');
    return t;
  }

  ribbons() {
    const band = (d, c, w) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
    return `<svg class="ss-ribbons" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <g>${band('M-40 250 C 180 80 360 40 600 -40', '#1fae6e', 70)}
        ${band('M-60 320 C 170 130 360 90 620 0', '#2f6df6', 46)}
        ${band('M-70 380 C 160 190 360 150 640 50', '#ff3b4e', 30)}
        ${band('M-80 430 C 150 250 360 210 660 110', '#ffd23f', 20)}</g>
      <g>${band('M1640 650 C 1420 820 1240 860 1000 940', '#1fae6e', 70)}
        ${band('M1660 580 C 1430 770 1240 810 980 900', '#ff3b4e', 46)}
        ${band('M1670 520 C 1440 710 1240 670 960 850', '#ffd23f', 30)}
        ${band('M1680 470 C 1450 650 1240 610 940 790', '#2f6df6', 20)}</g>
    </svg>`;
  }

  place() {
    this.zones[this.p1].__slots.appendChild(this.tok1);
    this.zones[this.p2].__slots.appendChild(this.tok2);
    this.tok1.__cap.textContent = this.p1 === 'HOME' ? 'Home' : 'Away';
    this.tok2.__cap.textContent = this.p2 === 'OFF' ? '—' : (this.p2 === 'HOME' ? 'Home' : 'Away');
    // highlight zones that have a player
    for (const k of ['HOME', 'OFF', 'AWAY']) {
      this.zones[k].classList.toggle('has', this.p1 === k || this.p2 === k);
    }
  }

  setP1(side) { this.p1 = side; this.place(); }
  cycleP2(dir) {
    const i = (P2_ORDER.indexOf(this.p2) + dir + P2_ORDER.length) % P2_ORDER.length;
    this.p2 = P2_ORDER[i];
    this.place();
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); this.setP1('HOME'); }
    else if (k === 'd') { e.preventDefault(); this.setP1('AWAY'); }
    else if (k === 'arrowleft') { e.preventDefault(); this.cycleP2(-1); }
    else if (k === 'arrowright') { e.preventDefault(); this.cycleP2(1); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); this.confirm(); }
    else if (k === 'escape' || k === 'backspace') { e.preventDefault(); this.cancel(); }
  }

  confirm() {
    if (this.done) return;
    this.done = true;
    removeEventListener('keydown', this.onKey);
    const sides = [{ id: 'P1', side: this.p1 }];
    if (this.p2 !== 'OFF') sides.push({ id: 'P2', side: this.p2 });
    this.root.classList.add('leaving');
    setTimeout(() => this.destroy(), 360);
    this.onConfirm(sides);
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
