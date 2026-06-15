/**
 * tools/inspect-player.mjs — dev utility to eyeball the rig & animation poses.
 * Freezes the player on a given clip at a given time and screenshots it from a
 * fixed camera, so the walk/run cycles can be checked and tuned.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
mkdirSync('screenshots/_inspect', { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);

// stop the live loop, switch to bright day light, park the player at origin
await page.evaluate(() => {
  const a = window.__APP;
  a.renderer.setAnimationLoop(null);
  a.isNight = false; a.applyNight();
  a.rig.setMode('orbit'); a.rig.controls.enabled = false;
  a.player.heading = 0;
  a.player.reset(0, 0);
});

async function shot(file, clip, t, cam, target) {
  await page.evaluate(({ clip, t, cam, target }) => {
    const a = window.__APP;
    const p = a.player;
    for (const n of ['idle', 'walk', 'run']) {
      const act = p.actions[n];
      act.enabled = true;
      act.paused = false;
      act.timeScale = 1;
      act.setEffectiveWeight(n === clip ? 1 : 0);
      act.time = n === clip ? t : 0;
    }
    p.mixer.update(1e-6);
    a.rig.camera.position.set(cam[0], cam[1], cam[2]);
    a.rig.camera.lookAt(target[0], target[1], target[2]);
    a.postfx.render(a.rig.camera);
  }, { clip, t, cam, target });
  await page.screenshot({ path: `screenshots/_inspect/${file}.png` });
}

const FRONT = [2.3, 1.2, 3.3];
const SIDE = [3.8, 1.1, 0.6];
const TGT = [0, 0.95, 0];

await shot('idle', 'idle', 0.0, FRONT, TGT);
await shot('walk_00', 'walk', 0.0, SIDE, TGT);
await shot('walk_25', 'walk', 0.25, SIDE, TGT);
await shot('walk_50', 'walk', 0.5, SIDE, TGT);
await shot('walk_75', 'walk', 0.75, SIDE, TGT);
await shot('run_00', 'run', 0.0, SIDE, TGT);
await shot('run_30', 'run', 0.3, SIDE, TGT);
await shot('walk_front', 'walk', 0.25, FRONT, TGT);

await browser.close();
console.log('wrote screenshots/_inspect/*.png');
