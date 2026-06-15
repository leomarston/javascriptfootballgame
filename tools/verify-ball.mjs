/**
 * tools/verify-ball.mjs — deterministic checks of the possession / dribble
 * mechanics, plus a close-up of the redesigned ball. Drives the sim and the
 * gameplay methods directly (camera-independent) at a fixed timestep.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
mkdirSync('screenshots/_inspect', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(900);

const res = await page.evaluate(() => {
  const a = window.__APP;
  a.renderer.setAnimationLoop(null);
  a.isNight = false; a.applyNight();
  const g = a.gameplay, p = a.player, b = a.ball;
  const DT = 1 / 60;
  const out = {};

  // A) trap a loose low ball that comes within reach
  p.reset(0, 0); b.reset(0.4, 0); g.owned = false; g.kickCooldown = 0; g.celebrateT = 0;
  g.keys.clear(); g.update(DT);
  out.A_capture_owned = g.owned;

  // B) dribble keeps the ball just ahead while running (+Z)
  p.reset(0, 0); p.heading = 0; b.position.set(0, 0.13, 0.5); b.velocity.set(0, 0, 0);
  g.owned = true; g.kickCooldown = 0;
  for (let i = 0; i < 90; i++) { p.velocity.set(0, 0, 6); p.position.z += 6 * DT; g.dribble(DT); }
  out.B_owned = g.owned;
  out.B_gap = +(b.position.z - p.position.z).toFixed(2);
  out.B_ahead = b.position.z > p.position.z;
  out.B_ballY = +b.position.y.toFixed(3);

  // C) Space pass releases possession with forward pace
  g.kickGround(1.0);
  out.C_owned = g.owned;
  out.C_velZ = +b.velocity.z.toFixed(1);
  out.C_cooldown = +g.kickCooldown.toFixed(2);

  // D) dribbling out of play drops the ball loose just inside the line
  p.reset(0, 33); p.heading = 0; b.position.set(0, 0.13, 33.5); b.velocity.set(0, 0, 0);
  g.owned = true; g.kickCooldown = 0;
  for (let i = 0; i < 30 && g.owned; i++) { p.velocity.set(0, 0, 6); p.position.z += 6 * DT; g.dribble(DT); }
  out.D_owned = g.owned;
  out.D_ballZ_inside = +b.position.z.toFixed(2); // expect <= 34
  out.D_stopped = +Math.hypot(b.velocity.x, b.velocity.z).toFixed(2);

  // E) a ball above head height can't be trapped, but can on landing
  p.reset(0, 0); b.position.set(0, 1.5, 0); b.velocity.set(0, 0, 0);
  g.owned = false; g.kickCooldown = 0; g.keys.clear();
  g.update(DT);
  out.E_highBall_owned = g.owned; // expect false
  for (let i = 0; i < 70 && !g.owned; i++) g.update(DT);
  out.E_afterLanding_owned = g.owned; // expect true

  // F) dribbling between the posts scores
  g.score.HOME = 0; g.score.AWAY = 0; g.celebrateT = 0;
  p.reset(50, 0); p.heading = Math.PI / 2; b.position.set(50.5, 0.13, 0); b.velocity.set(0, 0, 0);
  g.owned = true; g.kickCooldown = 0;
  for (let i = 0; i < 40 && g.score.HOME === 0; i++) { p.velocity.set(6, 0, 0); p.position.x += 6 * DT; g.dribble(DT); }
  out.F_scoreHOME = g.score.HOME;

  // reset to a tidy state for the screenshot
  g.kickoff();
  return out;
});

// close-up of the redesigned ball
await page.evaluate(() => {
  const a = window.__APP;
  a.ball.reset(0, 0);
  a.rig.setMode('orbit'); a.rig.controls.enabled = false;
  a.rig.camera.position.set(0.18, 0.28, 0.55);
  a.rig.camera.lookAt(0, 0.13, 0);
  a.postfx.render(a.rig.camera);
});
await page.screenshot({ path: 'screenshots/_inspect/ball_closeup.png' });

await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
