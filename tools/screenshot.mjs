/**
 * tools/screenshot.mjs — optional dev utility.
 *
 * Renders the built arena headlessly with Playwright and saves a few showcase
 * screenshots. Useful for verifying the look without a desktop GPU.
 *
 * Usage:
 *   npm run build
 *   npm run preview              # serves dist on http://localhost:4173
 *   node tools/screenshot.mjs    # (in another shell)
 *
 * Env vars:
 *   URL          target URL          (default http://localhost:4173/)
 *   CHROME_PATH  Chromium executable (default: Playwright's bundled Chromium)
 */

import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173/';
const launchOpts = {
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader'
  ]
};
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.querySelector('.loader'), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);

const park = (camPos, target) =>
  page.evaluate(({ camPos, target }) => {
    const a = window.__APP;
    a.rig.setMode('orbit');
    a.rig.controls.enabled = false;
    a.rig.camera.position.set(...camPos);
    a.rig.camera.lookAt(...target);
    a.rig.controls.target.set(...target);
  }, { camPos, target });

await page.screenshot({ path: 'screenshots/broadcast-day.png' });
await park([70, 55, 92], [0, 2, 0]);
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/aerial-day.png' });

await page.evaluate(() => window.__APP.rig.setMode('broadcast'));
await page.keyboard.press('n');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'screenshots/broadcast-night.png' });
await park([70, 55, 92], [0, 2, 0]);
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/aerial-night.png' });

await browser.close();
console.log('Saved screenshots/*.png');
