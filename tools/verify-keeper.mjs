/**
 * tools/verify-keeper.mjs — keeper pose screenshots + deterministic AI checks.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
mkdirSync('screenshots/_inspect', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(900);

await page.evaluate(() => { const a = window.__APP; a.renderer.setAnimationLoop(null); a.isNight = false; a.applyNight(); });

// ---- pose screenshots ----
async function pose(file, clip, t, cam, target) {
  await page.evaluate(({ clip, t, cam, target }) => {
    const a = window.__APP, k = a.keeper;
    k.object.position.set(0, 0, 0);
    k.object.rotation.y = 0; // face +Z toward the camera for inspection
    for (const n of ['idle', 'shuffle', 'divePos', 'diveNeg', 'jump']) {
      const act = k.actions[n];
      act.enabled = true;
      act.setEffectiveWeight(n === clip ? 1 : 0);
      act.time = n === clip ? t : 0;
    }
    k.mixer.update(1e-6);
    a.rig.setMode('orbit'); a.rig.controls.enabled = false;
    a.rig.camera.position.set(cam[0], cam[1], cam[2]);
    a.rig.camera.lookAt(target[0], target[1], target[2]);
    a.postfx.render(a.rig.camera);
  }, { clip, t, cam, target });
  await page.screenshot({ path: `screenshots/_inspect/${file}.png` });
}

await pose('keeper_idle', 'idle', 0.4, [1.6, 1.1, 3.0], [0, 0.85, 0]);
await pose('keeper_dive', 'divePos', 0.55, [0.4, 1.1, 3.6], [0.5, 0.6, 0]);
await pose('keeper_jump', 'jump', 0.42, [1.4, 1.6, 3.2], [0, 1.3, 0]);

// ---- behaviour tests ----
const res = await page.evaluate(() => {
  const a = window.__APP, g = a.gameplay, k = a.keeper, b = a.ball, p = a.player;
  const DT = 1 / 60;
  const out = {};

  const looseStep = (n) => {
    let dived = false;
    let saved = false;
    for (let i = 0; i < n; i++) {
      const r = k.update(DT, b, p, false);
      if (k.state === 'dive' || k.state === 'jump') dived = true;
      if (r.saved) saved = true;
      if (!k.holding) {
        const ev = g.physics.step(b, DT);
        if (ev) g.onGoal(ev.scorer);
      }
      if (k.holding) break;
    }
    return { dived, saved };
  };

  // restore keeper to a match orientation
  k.object.rotation.y = -Math.PI / 2;

  // 1) positioning: tracks the ball laterally and comes off its line
  k.reset(); p.reset(-40, 0); b.reset(40, 2); b.velocity.set(0, 0, 0);
  for (let i = 0; i < 70; i++) k.update(DT, b, p, false);
  out.pos_z = +k.position.z.toFixed(2);     // ~ clamp(2*0.85)=1.7
  out.pos_offLine = +(52.5 - k.position.x).toFixed(2); // > 0.9 (advanced)

  // 2) on-target driven shot to the corner -> dive + save (no goal)
  g.score.HOME = 0; g.score.AWAY = 0;
  k.reset(); p.reset(-40, 0); b.reset(47, 0); b.position.y = 0.3; b.velocity.set(13, 0.2, 5.5);
  out.dive_result = looseStep(150);
  out.dive_state = k.state;
  out.dive_saved = out.dive_result.saved;
  out.dive_noGoal = g.score.HOME === 0;

  // 2b) low central shot -> body block (no goal)
  g.score.HOME = 0; g.score.AWAY = 0;
  k.reset(); p.reset(-40, 0); b.reset(38, 0); b.position.y = 0.2; b.velocity.set(13, 0.2, 0);
  out.central_result = looseStep(150);
  out.central_saved = out.central_result.saved;
  out.central_noGoal = g.score.HOME === 0;

  // 3) wide shot -> keeper does NOT dive, no goal
  g.score.HOME = 0; g.score.AWAY = 0;
  k.reset(); p.reset(-40, 0); b.reset(38, 0); b.position.y = 0.2; b.velocity.set(20, 13, 0);
  let dived = false;
  for (let i = 0; i < 60; i++) { k.update(DT, b, p, false); if (k.state === 'dive') dived = true; if (!k.holding) g.physics.step(b, DT); }
  out.wide_dived = dived;                     // expect false
  out.wide_scoreHOME = g.score.HOME;          // expect 0

  // 4) high central ball -> jump reaction
  k.reset(); p.reset(-40, 0); b.reset(40, 0); b.position.y = 0.3; b.velocity.set(14, 7, 0);
  let jumped = false;
  for (let i = 0; i < 40; i++) { k.update(DT, b, p, false); if (k.state === 'jump') jumped = true; if (!k.holding) g.physics.step(b, DT); }
  out.high_jumped = jumped;                   // expect true

  // 5) 1v1: player dribbles into the keeper -> smothered
  g.score.HOME = 0;
  k.reset(); p.reset(50.8, 0); p.heading = Math.PI / 2; b.position.set(51.5, 0.13, 0); b.velocity.set(0, 0, 0);
  g.owned = true; g.kickCooldown = 0; g.celebrateT = 0; g.keys.clear();
  for (let i = 0; i < 8 && g.owned; i++) g.update(DT);
  out.smother_playerLost = !g.owned;          // expect true
  out.smother_keeperHolds = k.holding;        // expect true

  // 6) solid body: a loose ball can never roll through the standing keeper
  k.reset(); p.reset(-40, 0);
  b.position.set(k.position.x - 0.6, 0.4, k.position.z); b.velocity.set(6, 0, 0);
  let through = false;
  for (let i = 0; i < 50; i++) {
    k.update(DT, b, p, false);
    if (!k.holding) g.physics.step(b, DT);
    if (b.position.x > k.position.x + 0.35) through = true;
  }
  out.block_through = through;                 // expect false
  out.block_handled = k.holding || Math.hypot(b.position.x - k.position.x, b.position.z - k.position.z) > 0.4;

  g.kickoff();
  return out;
});

await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
