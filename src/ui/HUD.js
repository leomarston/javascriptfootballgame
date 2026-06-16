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
    this.homeName = el('span', 'tname', home, TEAMS.HOME.short);
    this.homeScore = el('span', 'tscore', board, '0');
    this.clockEl = el('span', 'clock', board, "0'");
    this.awayScore = el('span', 'tscore', board, '0');
    const away = el('div', 'team away', board);
    away.style.setProperty('--c', '#' + TEAMS.AWAY.primary.toString(16).padStart(6, '0'));
    this.awayName = el('span', 'tname', away, TEAMS.AWAY.short);
    el('span', 'badge', away);
    this.homeTeamEl = home;
    this.awayTeamEl = away;

    // ---- controlled-player name tags (P1 left, P2 right in couch play) ---
    this.playerTag = el('div', 'playertag', root, '');
    this.playerTag2 = el('div', 'playertag p2', root, '');
    this.playerTag2.style.display = 'none';

    // ---- charge bars (one per controller, shown under the player) --------
    this.chargeBars = [];
    this.chargeFills = [];
    for (let i = 0; i < 2; i++) {
      const bar = el('div', 'chargebar', root);
      this.chargeFills.push(el('div', 'chargefill', bar));
      bar.style.display = 'none';
      this.chargeBars.push(bar);
    }

    // ---- goal banner -----------------------------------------------------
    this.goalBanner = el('div', 'goal-banner hidden', root, 'GOAL!');
  }

  setScore(h, a) {
    this.homeScore.textContent = h;
    this.awayScore.textContent = a;
  }

  // Point the scoreboard at the chosen teams (code + badge colour).
  setTeams(home, away) {
    this.homeName.textContent = home.short;
    this.awayName.textContent = away.short;
    this.homeTeamEl.style.setProperty('--c', '#' + home.primary.toString(16).padStart(6, '0'));
    this.awayTeamEl.style.setProperty('--c', '#' + away.primary.toString(16).padStart(6, '0'));
  }

  setPlayer(team, name, label) {
    const tag = `${team} · ${name}${label ? ' · ' + label : ''}`;
    if (this.playerTag.textContent !== tag) this.playerTag.textContent = tag;
  }

  // P2's name tag (bottom-right), with their ring colour as an accent; pass a
  // falsy team to hide it (solo play).
  setPlayer2(team, name, label, color) {
    if (!team) {
      if (this.playerTag2.style.display !== 'none') this.playerTag2.style.display = 'none';
      return;
    }
    this.playerTag2.style.display = 'block';
    const tag = `${team} · ${name}${label ? ' · ' + label : ''}`;
    if (this.playerTag2.textContent !== tag) this.playerTag2.textContent = tag;
    if (color != null) this.playerTag2.style.borderColor = '#' + color.toString(16).padStart(6, '0');
  }

  setCharge(index, active, value, kind, x, y) {
    const bar = this.chargeBars[index];
    const fill = this.chargeFills[index];
    if (!bar) return;
    if (!active) {
      if (bar.style.display !== 'none') bar.style.display = 'none';
      return;
    }
    bar.style.display = 'block';
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    fill.style.width = `${Math.round(value * 100)}%`;
    fill.style.background = kind === 'shot' ? '#ff5b3b' : '#46d39a';
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
