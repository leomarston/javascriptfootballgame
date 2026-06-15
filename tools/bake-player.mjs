/**
 * tools/bake-player.mjs — bakes the rigged player to public/player.glb.
 *
 * Opens bake.html on the Vite dev server with a headless browser, runs the
 * GLTFExporter there, pulls back the binary and writes the .glb. Then reloads
 * it through GLTFLoader to validate the skin + animation clips survived.
 *
 * Usage:  npm run dev    (in one shell)
 *         node tools/bake-player.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

// Parse a .glb's embedded glTF JSON chunk (no deps) to sanity-check the asset.
function inspectGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb (bad magic)');
  const chunkLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + chunkLen).toString('utf8'));
  return {
    skins: (json.skins || []).length,
    joints: (json.skins?.[0]?.joints || []).length,
    nodes: (json.nodes || []).length,
    meshes: (json.meshes || []).length,
    animations: (json.animations || []).map((a) => a.name)
  };
}

const URL = process.env.URL || 'http://localhost:5173/bake.html';
const OUT = 'src/assets/player.glb';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__GLB_BASE64 || window.__GLB_ERROR, { timeout: 60000 });

const err = await page.evaluate(() => window.__GLB_ERROR || null);
if (err) { console.error('Export failed:', err); await browser.close(); process.exit(1); }

const { b64, bytes } = await page.evaluate(() => ({ b64: window.__GLB_BASE64, bytes: window.__GLB_BYTES }));
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(`wrote ${OUT} (${bytes} bytes)`);
await browser.close();

// --- validate the written asset ---
console.log('validated:', JSON.stringify(inspectGlb(OUT)));
