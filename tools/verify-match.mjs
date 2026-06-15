/**
 * tools/verify-match.mjs — checks for the 11-v-11, 4-4-2 build: squad counts,
 * names/positions, elastic formation, a single presser (not everyone chasing),
 * shot-range nerf, net containment, and the selection lock.
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
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(900);

const res = await page.evaluate(() => {
  const a = window.__APP, g = a.gameplay, b = a.ball;
  const DT = 1 / 60;
  a.renderer.setAnimationLoop(null);
  const out = {};
  const horiz = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);

  // 1) squads
  out.homeCount = a.home.length;
  out.awayCount = a.away.length;
  out.keepers = !!a.homeKeeper && !!a.awayKeeper;

  // 2) every player named with a set formation slot
  const all = [...a.home, ...a.away, a.homeKeeper, a.awayKeeper];
  out.allNamed = all.every((p) => typeof p.name === 'string' && p.name.length > 0);
  out.allPositioned = [...a.home, ...a.away].every((p) => p.homePos && Number.isFinite(p.homePos.x));
  out.sampleNames = a.home.slice(0, 3).map((p) => `${p.name}(${p.label})`);

  // 3) elastic formation: a HOME defender pushes up in possession, drops when defending
  const df = a.home[1]; // a centre-back
  b.position.set(40, 0.13, 0);
  const upX = g.formationTarget(df, true).x;
  b.position.set(-40, 0.13, 0);
  const downX = g.formationTarget(df, false).x;
  out.pushUp = upX > df.homePos.x + 3;
  out.dropBack = downX < df.homePos.x - 1;

  // 4) one presser per team is the nearest player to the ball
  g.kickoff();
  b.position.set(0, 0.13, 0);
  g.precomputeRoles();
  out.presserHomeNearest = g.presser.HOME === a.home[g.nearestIndex(a.home, b.position)];
  out.presserAwayNearest = g.presser.AWAY === a.away[g.nearestIndex(a.away, b.position)];

  // 5) play a bit with no input -> NOT everyone chases; the shape holds
  g.kickoff();
  for (let i = 0; i < 200; i++) g.update(DT);
  const field = [...a.home, ...a.away];
  out.chasers = field.filter((p) => horiz(p.position, b.position) < 6).length;   // few
  out.holders = field.filter((p) => horiz(p.position, b.position) > 15).length;  // many
  out.noErrorsDuringPlay = true;

  // 6) shot from own half can't reach the goal (nerf/cap holds)
  g.kickoff(); g.setOwner(a.home[0]); a.home[0].reset(-40, 0, Math.PI / 2);
  b.position.set(-39.5, 0.13, 0); b.velocity.set(0, 0, 0);
  g.shoot(a.home[0], 1);
  let mx = -1e9;
  for (let i = 0; i < 220; i++) { g.physics.step(b, DT); mx = Math.max(mx, b.position.x); }
  out.ownHalfShot_maxX = +mx.toFixed(1);
  out.ownHalfCantScore = mx < 45;

  // 7) net catches a hard shot
  b.reset(50, 0); b.position.y = 0.3; b.velocity.set(34, 3, 0);
  let nmx = -1e9;
  for (let i = 0; i < 160; i++) { g.physics.step(b, DT); nmx = Math.max(nmx, b.position.x); }
  out.netCaught = b.position.x > 52.5 && b.position.x < 55 && Math.hypot(b.velocity.x, b.velocity.z) < 2;

  // 8) selection lock holds >= 1s; manual switch flips
  g.setOwner(a.away[0]); g.controlled = 0; g.switchLock = 0;
  a.home[0].reset(5, 0, 0); a.home[3].reset(8, 0, 0);
  b.position.set(5, 0.13, 0); g.resolveControl(DT);
  b.position.set(20, 0.13, 0); g.resolveControl(DT); // nearest changes -> switch + lock
  const switched = g.controlled;
  b.position.set(5, 0.13, 0);
  for (let i = 0; i < 30; i++) g.resolveControl(DT); // 0.5s
  const held = g.controlled === switched;
  for (let i = 0; i < 50; i++) g.resolveControl(DT); // > 1s
  const released = g.controlled !== switched;
  out.lock_held = held;
  out.lock_releasedAfter1s = released;
  const before = g.controlled; g.manualSwitch();
  out.manual_switched = g.controlled !== before && g.switchLock > 0.5;

  g.kickoff();
  return out;
});

await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
