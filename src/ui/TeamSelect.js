/**
 * TeamSelect.js — the "choose the teams" screen shown after the side is picked,
 * modelled on a console match-setup screen: a HOME panel and an AWAY panel,
 * each with the team's flag (crest), name, confederation, star rating and
 * FW/MF/DF bars, an EXHIBITION centre column with the match settings, and the
 * controller-hint bar. Only the ten national teams in nations.js are offered.
 *
 * Left/Right change the focused side's team; Up/Down (or Tab) switch which side
 * you're editing; Select walks home → away → start; Back steps the other way
 * (and out to the side-select). Y randomises the focused team.
 */

import { NATIONS, makeFlag } from '../game/nations.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

const DIFFICULTIES = ['Superstar', 'Legend', 'Professional', 'Regular'];

export class TeamSelect {
  constructor({ onConfirm, onCancel }) {
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.home = 0; // Argentina
    this.away = 1; // France
    this.focus = 'home';
    this.diff = 0;
    this.done = false;
    this.build();
    this.onKey = (e) => this.handleKey(e);
    addEventListener('keydown', this.onKey);
  }

  build() {
    const root = el('div', 'ts focus-home', document.body);
    this.root = root;
    el('div', 'ts-bg', root);

    // headers: HOME · EXHIBITION · AWAY
    const heads = el('div', 'ts-headers', root);
    this.headHome = el('div', 'ts-tab home', heads, 'HOME');
    el('div', 'ts-mode', heads, 'EXHIBITION');
    this.headAway = el('div', 'ts-tab away', heads, 'AWAY');

    const main = el('div', 'ts-main', root);
    this.homePanel = this.panel(main, 'home');
    this.center = this.centerColumn(main);
    this.awayPanel = this.panel(main, 'away');

    this.refresh();
    requestAnimationFrame(() => root.classList.add('show'));
  }

  panel(parent, side) {
    const p = el('div', 'ts-panel ' + side, parent);
    p.addEventListener('click', () => this.setFocus(side));
    const league = el('div', 'ts-league', p);
    league.__flag = el('span', 'ts-league-flag', league);
    league.__name = el('span', 'ts-league-name', league);
    p.__league = league;
    p.__name = el('div', 'ts-name', p);
    const crest = el('div', 'ts-crest', p);
    const prev = el('button', 'ts-arrow prev', crest, '‹');
    p.__flag = el('div', 'ts-flag', crest);
    const next = el('button', 'ts-arrow next', crest, '›');
    prev.addEventListener('click', (e) => { e.stopPropagation(); this.setFocus(side); this.cycle(side, -1); });
    next.addEventListener('click', (e) => { e.stopPropagation(); this.setFocus(side); this.cycle(side, 1); });
    p.__stars = el('div', 'ts-stars', p);
    p.__stats = el('div', 'ts-stats', p);
    for (const k of ['FW', 'MF', 'DF']) {
      const row = el('div', 'ts-stat ' + k.toLowerCase(), p.__stats);
      el('span', 'ts-stat-key', row, k);
      const track = el('span', 'ts-stat-track', row);
      row.__fill = el('span', 'ts-stat-fill', track);
      row.__val = el('span', 'ts-stat-val', row, '0');
      p.__stats['__' + k] = row;
    }
    return p;
  }

  centerColumn(parent) {
    const c = el('div', 'ts-center', parent);
    // a generic round emblem (a simple football — not a brand mark)
    el('div', 'ts-emblem', c, `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="#0f1430" stroke="#aeb7e8" stroke-width="3"/>
      <circle cx="50" cy="50" r="30" fill="none" stroke="#aeb7e8" stroke-width="3"/>
      <polygon points="50,34 64,44 59,61 41,61 36,44" fill="#aeb7e8"/>
    </svg>`);
    const s = el('div', 'ts-settings', c);
    el('div', 'ts-settings-title', s, 'MATCH SETTINGS');
    this.lenEl = el('div', 'ts-setting', s, 'Match length: <b>10 min</b>');
    this.diffEl = el('div', 'ts-setting', s, 'Difficulty: <b>Superstar</b>');
    el('div', 'ts-setting', s, 'Form: <b>Random</b>');
    return c;
  }

  // --- state → DOM ---
  refresh() {
    this.fillPanel(this.homePanel, NATIONS[this.home]);
    this.fillPanel(this.awayPanel, NATIONS[this.away]);
    this.diffEl.innerHTML = `Difficulty: <b>${DIFFICULTIES[this.diff]}</b>`;
  }

  fillPanel(p, n) {
    p.__league.__flag.replaceChildren(makeFlag(n, 'sm'));
    p.__league.__name.textContent = n.confed;
    p.__name.textContent = n.name;
    p.__flag.replaceChildren(makeFlag(n, 'lg'));
    p.__stars.innerHTML = this.stars(n.stars);
    for (const k of ['FW', 'MF', 'DF']) {
      const row = p.__stats['__' + k];
      row.__fill.style.width = `${n[k.toLowerCase()]}%`;
      row.__val.textContent = n[k.toLowerCase()];
    }
  }

  stars(v) {
    let h = '';
    for (let i = 1; i <= 5; i++) {
      const cls = v >= i ? 'full' : v >= i - 0.5 ? 'half' : 'empty';
      h += `<span class="star ${cls}">★</span>`;
    }
    return h;
  }

  // --- interaction ---
  setFocus(side) {
    this.focus = side;
    this.root.classList.toggle('focus-home', side === 'home');
    this.root.classList.toggle('focus-away', side === 'away');
  }

  cycle(side, dir) {
    const otherIdx = side === 'home' ? this.away : this.home;
    let idx = side === 'home' ? this.home : this.away;
    do { idx = (idx + dir + NATIONS.length) % NATIONS.length; } while (idx === otherIdx);
    if (side === 'home') this.home = idx; else this.away = idx;
    this.refresh();
  }

  random() {
    const otherIdx = this.focus === 'home' ? this.away : this.home;
    let idx;
    do { idx = Math.floor(Math.random() * NATIONS.length); } while (idx === otherIdx);
    if (this.focus === 'home') this.home = idx; else this.away = idx;
    this.refresh();
  }

  cycleSettings() {
    this.diff = (this.diff + 1) % DIFFICULTIES.length;
    this.refresh();
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') { e.preventDefault(); this.cycle(this.focus, -1); }
    else if (k === 'arrowright') { e.preventDefault(); this.cycle(this.focus, 1); }
    else if (k === 'arrowup' || k === 'arrowdown' || k === 'tab') { e.preventDefault(); this.setFocus(this.focus === 'home' ? 'away' : 'home'); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); this.confirm(); }
    else if (k === 'escape' || k === 'backspace') { e.preventDefault(); this.back(); }
    else if (k === 'y') { e.preventDefault(); this.random(); }
    else if (k === 'x') { e.preventDefault(); this.cycleSettings(); }
  }

  // Select walks home → away → start.
  confirm() {
    if (this.done) return;
    if (this.focus === 'home') { this.setFocus('away'); return; }
    this.done = true;
    removeEventListener('keydown', this.onKey);
    this.root.classList.add('leaving');
    const home = NATIONS[this.home];
    const away = NATIONS[this.away];
    setTimeout(() => this.destroy(), 360);
    this.onConfirm(home, away);
  }

  // Back steps away → home, then out to the side-select.
  back() {
    if (this.done) return;
    if (this.focus === 'away') { this.setFocus('home'); return; }
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
