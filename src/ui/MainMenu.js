/**
 * MainMenu.js — the front-end menu shown after the game loads: a yellow
 * wordmark, a left section list (KICK OFF / SETTINGS / QUIT), the KICK OFF
 * cards and controller hints, all over the live night pitch.
 *
 * Only KICK OFF is wired up for now — selecting it (or the LOCAL MATCH card)
 * fires onStart() to begin the match. The other sections are inert.
 */

import { TEAMS } from '../config.js';
import { facetSVG } from './lowpoly.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

// Left-hand sections. Only KICK OFF does anything for now.
const SECTIONS = [
  { key: 'kickoff', label: 'KICK OFF', live: true },
  { key: 'settings', label: 'SETTINGS', live: false },
  { key: 'quit', label: 'QUIT', live: false }
];

export class MainMenu {
  constructor(onStart) {
    this.onStart = onStart;
    this.index = 0;
    this.done = false;
    this.build();
    this.onKey = (e) => this.handleKey(e);
    addEventListener('keydown', this.onKey);
  }

  build() {
    const root = el('div', 'menu', document.body);
    this.root = root;

    // background dressing: low-poly facets + faint angular streaks + watermark
    el('div', 'menu-bg', root).innerHTML = facetSVG(0x171f5a, 0x3a2272, { seed: 5 });
    el('div', 'menu-streaks', root);
    this.watermark = el('div', 'menu-watermark', root, SECTIONS[0].label);

    // ---- top bar: wordmark ----------------------------------------------
    const top = el('header', 'menu-top', root);
    el('div', 'ef-logo', top, '<span class="ef-e">A</span>STRA ARENA');

    // ---- left section list ----------------------------------------------
    const nav = el('nav', 'menu-nav', root);
    this.items = SECTIONS.map((s, i) => {
      const b = el('button', 'nav-item' + (i === 0 ? ' is-active' : ''), nav, s.label);
      b.addEventListener('mouseenter', () => this.select(i));
      b.addEventListener('click', () => this.activate(i));
      return b;
    });

    // ---- KICK OFF cards --------------------------------------------------
    const cards = el('section', 'menu-cards', root);

    const last = el('div', 'card card-last', cards);
    el('div', 'card-kicker', last, 'LAST PLAYED');
    el('div', 'card-sub', last, `<b>VERSUS</b> | ${TEAMS.HOME.full} v ${TEAMS.AWAY.full}`);
    const crests = el('div', 'card-crests', last);
    this.crest(crests, TEAMS.HOME);
    el('div', 'vs-badge', crests, 'VS');
    this.crest(crests, TEAMS.AWAY);

    this.card(cards, 'card-coop', 'CO-OP', 'Team up online against other users or the COM.', false);
    this.card(cards, 'card-random', 'RANDOM SELECTION', 'Take a randomly selected squad into a match.', false);
    this.localCard = this.card(cards, 'card-local is-active', 'LOCAL MATCH', 'Kick off a quick match against the COM.', true);
    this.card(cards, 'card-versus', 'VERSUS', 'Face off against another player on this device.', false);

    requestAnimationFrame(() => root.classList.add('show'));
  }

  // a small club shield with the team's monogram
  crest(parent, team) {
    const c = el('div', 'crest', parent, `<span>${team.short[0]}</span>`);
    c.style.setProperty('--c', '#' + team.primary.toString(16).padStart(6, '0'));
    return c;
  }

  // a generic KICK OFF card; `live` cards start the match when clicked
  card(parent, cls, title, desc, live) {
    const c = el('div', 'card ' + cls, parent);
    el('div', 'card-title', c, title);
    el('div', 'card-desc', c, desc);
    if (live) c.addEventListener('click', () => this.start());
    return c;
  }

  select(i) {
    if (i === this.index) return;
    this.items[this.index].classList.remove('is-active');
    this.index = i;
    this.items[i].classList.add('is-active');
    this.watermark.textContent = SECTIONS[i].label;
  }

  // chosen via Enter / click: only the live section (KICK OFF) does anything
  activate(i) {
    this.select(i);
    if (SECTIONS[i].live) this.start();
    else {
      this.items[i].classList.remove('nudge');
      void this.items[i].offsetWidth;
      this.items[i].classList.add('nudge');
    }
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); this.select((this.index + SECTIONS.length - 1) % SECTIONS.length); }
    else if (k === 'arrowdown' || k === 's') { e.preventDefault(); this.select((this.index + 1) % SECTIONS.length); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); this.activate(this.index); }
  }

  start() {
    if (this.done) return;
    this.done = true;
    this.root.classList.add('leaving');
    removeEventListener('keydown', this.onKey);
    setTimeout(() => this.destroy(), 420);
    this.onStart();
  }

  destroy() {
    removeEventListener('keydown', this.onKey);
    if (this.root) this.root.remove();
    this.root = null;
  }
}
