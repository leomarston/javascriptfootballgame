/**
 * HUD.js — the DOM overlay: a broadcast scoreboard with match clock, a shot
 * power meter, the goal banner, a controls panel and the loading screen.
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
    this.callbacks = {};
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

    // ---- top-right buttons ----------------------------------------------
    const tools = el('div', 'tools', root);
    this.btnNight = el('button', 'btn', tools, '☀ Day');
    this.btnCam = el('button', 'btn', tools, '🎥 Broadcast');
    this.btnHelp = el('button', 'btn', tools, '? Help');
    this.btnNight.onclick = () => this.callbacks.night && this.callbacks.night();
    this.btnCam.onclick = () => this.callbacks.cam && this.callbacks.cam();
    this.btnHelp.onclick = () => this.help.classList.toggle('hidden');

    // ---- power meter -----------------------------------------------------
    const power = el('div', 'power', root);
    el('div', 'power-label', power, 'SHOT');
    const pwrap = el('div', 'power-bar', power);
    this.powerFill = el('div', 'power-fill', pwrap);

    // ---- speedometer -----------------------------------------------------
    this.speedEl = el('div', 'speed', root, '0 km/h');

    // ---- goal banner -----------------------------------------------------
    this.goalBanner = el('div', 'goal-banner hidden', root, 'GOAL!');

    // ---- help panel ------------------------------------------------------
    this.help = el('div', 'help', root);
    this.help.innerHTML = `
      <h3>ASTRA ARENA — Controls</h3>
      <ul>
        <li><b>Hold + release Left Mouse</b> — charged shot toward the cursor</li>
        <li><b>W A S D / Arrows</b> — dribble the ball</li>
        <li><b>Space</b> — loft / chip the ball</li>
        <li><b>R</b> — reset to kickoff</li>
        <li><b>C</b> — change camera (Broadcast · Follow · Aerial · Free)</li>
        <li><b>N</b> — toggle day / night</li>
        <li><b>Free cam:</b> drag to orbit, scroll to zoom</li>
      </ul>
      <p>Score in either net. Have fun!</p>`;
  }

  on(name, fn) {
    this.callbacks[name] = fn;
  }

  setScore(h, a) {
    this.homeScore.textContent = h;
    this.awayScore.textContent = a;
  }

  setPower(p) {
    this.powerFill.style.width = `${Math.round(p * 100)}%`;
  }

  setSpeed(v) {
    this.speedEl.textContent = `${Math.round(v * 3.6)} km/h`;
  }

  setCameraLabel(mode) {
    const map = {
      broadcast: '🎥 Broadcast',
      follow: '🎥 Follow',
      aerial: '🎥 Aerial',
      orbit: '🎥 Free'
    };
    this.btnCam.textContent = map[mode] || mode;
  }

  setNightLabel(isNight) {
    this.btnNight.textContent = isNight ? '🌙 Night' : '☀ Day';
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
