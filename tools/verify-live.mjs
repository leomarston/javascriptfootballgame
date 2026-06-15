/**
 * tools/verify-live.mjs — deterministic check of player locomotion, clip
 * blending and dribbling. Steps the simulation manually at a fixed timestep
 * (headless rAF is throttled) and records the velocity / weight curve.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
mkdirSync('screenshots/_inspect', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1000);

const result = await page.evaluate(() => {
  const a = window.__APP;
  const DT = 1 / 60;
  a.renderer.setAnimationLoop(null); // take manual control of stepping
  const startNight = a.isNight;
  a.isNight = false; a.applyNight();
  a.rig.setMode('follow');

  const k = a.gameplay.keys;
  const snap = () => ({
    speed: +Math.hypot(a.player.velocity.x, a.player.velocity.z).toFixed(2),
    pos: [+a.player.position.x.toFixed(2), +a.player.position.z.toFixed(2)],
    heading: +a.player.heading.toFixed(2),
    w: { idle: +a.player.weights.idle.toFixed(2), walk: +a.player.weights.walk.toFixed(2), run: +a.player.weights.run.toFixed(2) },
    ballGap: +Math.hypot(a.ball.position.x - a.player.position.x, a.ball.position.z - a.player.position.z).toFixed(2),
    ballPos: [+a.ball.position.x.toFixed(2), +a.ball.position.z.toFixed(2)]
  });
  const step = (n) => { for (let i = 0; i < n; i++) { a.gameplay.update(DT); a.rig.update(DT, a.player); } };

  // sprint forward
  k.add('w'); k.add('shift');
  const curve = [];
  for (let i = 0; i < 8; i++) { step(20); curve.push(snap()); }

  // release -> decelerate
  k.delete('w'); k.delete('shift');
  step(120);
  const stopped = snap();

  // walk left (no shift) -> should settle into walk blend + turn
  k.add('a');
  step(60);
  const walking = snap();
  k.delete('a');

  // --- dribble: running into the ball carries it ahead ---
  a.player.reset(0, 0); a.player.heading = Math.PI / 2; a.player.velocity.set(5, 0, 0);
  a.ball.reset(0.4, 0);
  a.gameplay.dribble();
  const dribble = {
    ballVel: [+a.ball.velocity.x.toFixed(2), +a.ball.velocity.z.toFixed(2)],
    ballPos: [+a.ball.position.x.toFixed(2), +a.ball.position.z.toFixed(2)]
  };

  // --- kick: Space punts the ball forward + up ---
  a.player.reset(0, 0); a.player.heading = Math.PI / 2; a.player.velocity.set(0, 0, 0);
  a.ball.reset(0.4, 0);
  a.gameplay.kickBall(16, 5.5);
  const kick = {
    ballVel: [+a.ball.velocity.x.toFixed(2), +a.ball.velocity.y.toFixed(2), +a.ball.velocity.z.toFixed(2)]
  };

  // re-pose a clean sprint for the screenshot
  a.player.reset(0, 0); a.player.heading = Math.PI / 2;
  k.add('w'); k.add('shift'); step(40); k.delete('w'); k.delete('shift');
  a.postfx.render(a.rig.camera);
  return { startNight, curve, stopped, walking, dribble, kick };
});

await page.screenshot({ path: 'screenshots/_inspect/live_final.png' });
await browser.close();

console.log('startNight:', result.startNight, '(expected true)');
console.log('sprint curve (every ~0.33s):');
for (const s of result.curve) console.log('  ', JSON.stringify(s));
console.log('after release:', JSON.stringify(result.stopped));
console.log('walking+turn:', JSON.stringify(result.walking));
console.log('dribble (ball carried ahead ~0.55,0):', JSON.stringify(result.dribble));
console.log('kick (ball punted +x,+y):', JSON.stringify(result.kick));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
