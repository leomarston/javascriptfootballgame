/**
 * HUD.js — the DOM overlay: a broadcast scoreboard with match clock, the goal
 * banner and the loading screen.
 */

import { TEAMS } from '../config.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

export class HUD {
  constructor() {
    this.clock = 0;
    this.running = false;
    this.build();
  }

  build() {
    const root = el('div', 'hud', document.body);
    this.root = root;

    // ---- loading screen --------------------------------------------------
    this.loader = el('div', 'loader', document.body);
    el('div', 'loader-title', this.loader, 'ASTRA ARENA');
    el('div', 'loader-sub', this.loader, 'Building the stadium…');
    const barWrap = el('div', 'loader-bar', this.loader);
    this.loaderFill = el('div', 'loader-fill', barWrap);
    this.loaderPct = el('div', 'loader-pct', this.loader, '0%');

    // ---- scoreboard ------------------------------------------------------
    const board = el('div', 'scoreboard', root);
    const home = el('div', 'team home', board);
    home.style.setProperty('--c', '#' + TEAMS.HOME.primary.toString(16).padStart(6, '0'));
    el('span', 'badge', home);
    el('span', 'tname', home, TEAMS.HOME.short);
    this.homeScore = el('span', 'tscore', board, '0');
    this.clockEl = el('span', 'clock', board, "0'");
    this.awayScore = el('span', 'tscore', board, '0');
    const away = el('div', 'team away', board);
    away.style.setProperty('--c', '#' + TEAMS.AWAY.primary.toString(16).padStart(6, '0'));
    el('span', 'tname', away, TEAMS.AWAY.short);
    el('span', 'badge', away);

    // ---- goal banner -----------------------------------------------------
    this.goalBanner = el('div', 'goal-banner hidden', root, 'GOAL!');
  }

  setScore(h, a) {
    this.homeScore.textContent = h;
    this.awayScore.textContent = a;
  }

  showGoal(team) {
    this.goalBanner.textContent = 'GOAL!';
    this.goalBanner.style.color = '#' + team.primary.toString(16).padStart(6, '0');
    this.goalBanner.classList.remove('hidden');
    this.goalBanner.classList.remove('pop');
    void this.goalBanner.offsetWidth; // restart animation
    this.goalBanner.classList.add('pop');
  }

  hideGoal() {
    this.goalBanner.classList.add('hidden');
  }

  startClock() {
    this.running = true;
  }

  update(dt) {
    if (this.running) {
      this.clock += dt;
      const mins = Math.floor((this.clock / 60) * 6); // 10 s == 1 match minute
      this.clockEl.textContent = `${mins}'`;
    }
  }

  setLoading(p, text) {
    this.loaderFill.style.width = `${Math.round(p * 100)}%`;
    this.loaderPct.textContent = `${Math.round(p * 100)}%`;
    if (text) this.loader.querySelector('.loader-sub').textContent = text;
  }

  hideLoading() {
    this.loader.classList.add('done');
    setTimeout(() => this.loader.remove(), 900);
  }
}
