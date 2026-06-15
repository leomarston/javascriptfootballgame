/**
 * tools/verify-team.mjs — deterministic checks of the team systems:
 * control-switching, pass/shoot/cross, teammate runs, defender AI, tackle/slide.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
mkdirSync('screenshots/_inspect', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(900);

const res = await page.evaluate(() => {
  const a = window.__APP, g = a.gameplay, b = a.ball;
  const [h0, h1] = a.home, d = a.defender, k = a.keeper;
  const DT = 1 / 60;
  a.renderer.setAnimationLoop(null); a.isNight = false; a.applyNight();
  const idx = (p) => p === h0 ? 'h0' : p === h1 ? 'h1' : p === d ? 'def' : p === k ? 'keeper' : p === null ? 'loose' : '?';
  const step = (n) => { for (let i = 0; i < n; i++) g.update(DT); };
  const out = {};

  // 1) pass -> ball goes loose, control switches to receiver, who collects it
  g.kickoff();
  h0.reset(0, 0, Math.PI / 2); h1.reset(7, 4, Math.PI / 2); d.reset(30, 20, -Math.PI / 2);
  g.setOwner(h0); b.position.set(0.5, 0.13, 0); b.velocity.set(0, 0, 0);
  g.pass(h0);
  out.pass_wentLoose = g.ballOwner === null;
  out.pass_switchedToReceiver = g.controlledPlayer() === h1;
  step(110);
  out.pass_received = idx(g.ballOwner); // expect h1

  // 2) shoot -> driven toward the +X goal, away from the keeper
  g.kickoff();
  h0.reset(40, 0, Math.PI / 2); g.setOwner(h0); b.position.set(40.5, 0.13, 0); b.velocity.set(0, 0, 0);
  k.reset(); k.position.z = 2; // keeper to one side
  g.shoot(h0);
  out.shoot_velX = +b.velocity.x.toFixed(1);
  out.shoot_awayFromKeeper = Math.sign(b.velocity.z) === -1; // keeper at +z -> aim -z

  // 3) cross -> lofted and lands inside the penalty area
  g.kickoff();
  h0.reset(46, -22, Math.PI / 2); g.setOwner(h0); b.position.set(46, 0.13, -22); b.velocity.set(0, 0, 0);
  h1.reset(45, 2, Math.PI / 2);
  g.cross(h0);
  out.cross_lofted = b.velocity.y > 3;
  let landX = null, landZ = null;
  for (let i = 0; i < 130; i++) { g.update(DT); if (landX === null && i > 6 && b.position.y <= 0.16) { landX = b.position.x; landZ = b.position.z; break; } }
  out.cross_landX = landX === null ? null : +landX.toFixed(1);
  out.cross_inBox = landX !== null && landX > 52.5 - 17 && Math.abs(landZ) < 20;

  // 4) defender AI marks and tackles a HOME carrier
  g.kickoff();
  h0.reset(15, 0, Math.PI / 2); g.setOwner(h0); b.position.set(15.5, 0.13, 0); b.velocity.set(0, 0, 0);
  d.reset(19, 0, -Math.PI / 2); h1.reset(-5, 12, Math.PI / 2);
  let defWon = false;
  for (let i = 0; i < 220; i++) { g.update(DT); if (g.ballOwner === d) { defWon = true; break; } }
  out.def_wonBall = defWon;

  // 5) control auto-switches to the nearest HOME player when AWAY has the ball
  g.kickoff();
  g.setOwner(d); d.reset(10, 0, -Math.PI / 2); g.defenderClear = 99;
  h0.reset(30, 18, 0); h1.reset(12, 0, 0); // h1 is nearer the ball
  g.resolveControl();
  out.switch_toNearest = g.controlledPlayer() === h1;

  // 6) a standing tackle wins the ball off the AWAY carrier
  g.setOwner(d); b.position.set(10, 0.13, 0); b.velocity.set(0, 0, 0);
  h0.reset(10.7, 0, -Math.PI / 2); h0.startTackle(); h0.stateT = 0.15;
  g.resolveTackles();
  out.tackle_won = g.ballOwner === h0;

  // 7) a slide knocks the ball loose off the carrier
  g.setOwner(d); b.position.set(10, 0.13, 0); b.velocity.set(0, 0, 0);
  h1.reset(10.9, 0, -Math.PI / 2); h1.startSlide(); h1.stateT = 0.2;
  g.resolveTackles();
  out.slide_knockedLoose = g.ballOwner === null;

  // 8) teammate makes a supporting run ahead when HOME has the ball
  g.kickoff();
  h0.reset(10, 0, Math.PI / 2); g.setOwner(h0); b.position.set(10.5, 0.13, 0); b.velocity.set(0, 0, 0);
  h1.reset(8, 6, Math.PI / 2); d.reset(40, 20, -Math.PI / 2);
  const h1x0 = h1.position.x;
  step(120);
  out.mate_runAhead = h1.position.x > h1x0 + 2; // advanced upfield

  g.kickoff();
  return out;
});

await page.screenshot({ path: 'screenshots/_inspect/_unused.png' }).catch(() => {});
await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
