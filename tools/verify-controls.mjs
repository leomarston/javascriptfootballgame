/**
 * tools/verify-controls.mjs — net containment, charged/nerfed shooting & passing,
 * and the 1-second selection lock + manual switch.
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173/';
const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(800);

const res = await page.evaluate(() => {
  const a = window.__APP, g = a.gameplay, b = a.ball;
  const [h0, h1] = a.home, d = a.defender;
  const DT = 1 / 60;
  a.renderer.setAnimationLoop(null);
  const out = {};
  const phys = (n, track) => { let mx = -1e9; for (let i = 0; i < n; i++) { g.physics.step(b, DT); if (track) mx = Math.max(mx, b.position.x); } return mx; };

  // 1) net catches a hard shot inside the goal (doesn't fly through)
  b.reset(50, 0); b.position.y = 0.3; b.velocity.set(34, 3, 0);
  const maxX = phys(160, true);
  out.net_maxX = +maxX.toFixed(2);                 // <= ~54.9 (back of net)
  out.net_caughtInGoal = b.position.x > 52.5 && b.position.x < 55.0 && Math.abs(b.position.z) < 3.66;
  out.net_settled = Math.hypot(b.velocity.x, b.velocity.z) < 2;

  // 2) shot from the box reaches the goal line; from own half it can't
  b.reset(42, 0); g.setOwner(h0); h0.reset(42, 0, Math.PI / 2); b.position.set(42.5, 0.13, 0);
  g.shoot(h0, 1);
  out.boxShot_reaches = phys(160, true) >= 52.5;

  b.reset(-39.5, 0); g.setOwner(h0); h0.reset(-40, 0, Math.PI / 2); b.position.set(-39.5, 0.13, 0);
  g.shoot(h0, 1);
  out.ownHalfShot_maxX = +phys(220, true).toFixed(1); // well short of 52.5
  out.ownHalfShot_cantScore = out.ownHalfShot_maxX < 45;

  // 3) charged pass: full charge reaches the mate, a tap falls short
  g.kickoff(); g.setOwner(h0); h0.reset(0, 0, Math.PI / 2); h1.reset(15, 0, Math.PI / 2);
  b.position.set(0.5, 0.13, 0); d.reset(40, 20, -Math.PI / 2);
  g.pass(h0, 1.0);
  let strongReached = false;
  for (let i = 0; i < 130; i++) { g.update(DT); if (g.ballOwner === h1) { strongReached = true; break; } }
  out.pass_strongReaches = strongReached;

  g.kickoff(); g.setOwner(h0); h0.reset(0, 0, Math.PI / 2); h1.reset(15, 0, Math.PI / 2);
  b.position.set(0.5, 0.13, 0); d.reset(40, 20, -Math.PI / 2);
  g.pass(h0, 0.0);
  for (let i = 0; i < 130; i++) { g.update(DT); if (g.ballOwner === h1) break; }
  out.pass_tapFallsShort = g.ballOwner !== h1 && b.position.x < 14;

  // 4) selection lock: a switch holds for >= 1s, manual switch flips instantly
  g.setOwner(d); h0.reset(5, 0, 0); h1.reset(8, 0, 0); d.reset(4, 0, 0); g.controlled = 0; g.switchLock = 0;
  b.position.set(5, 0.13, 0); g.resolveControl(DT);                 // nearest h0, no switch
  b.position.set(8, 0.13, 0); g.resolveControl(DT);                 // -> switch to h1, lock 1s
  const afterSwitch = g.controlled;
  b.position.set(5, 0.13, 0);                                       // ball back near h0
  for (let i = 0; i < 30; i++) g.resolveControl(DT);                // 0.5s
  const stillLocked = g.controlled;
  for (let i = 0; i < 50; i++) g.resolveControl(DT);                // > 1s total
  const released = g.controlled;
  out.lock_switched = afterSwitch === 1;
  out.lock_heldDuringWindow = stillLocked === 1;
  out.lock_releasedAfter1s = released === 0;

  g.controlled = 0; g.manualSwitch();
  out.manual_switched = g.controlled === 1 && g.switchLock > 0.5;

  g.kickoff();
  return out;
});

await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
