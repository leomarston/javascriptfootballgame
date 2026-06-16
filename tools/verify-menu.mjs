import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000}).catch(()=>{});
await page.waitForTimeout(700);

const present = await page.evaluate(()=>({
  menu: !!document.querySelector('.menu'),
  logo: document.querySelector('.ef-logo')?.textContent.trim(),
  navItems: [...document.querySelectorAll('.nav-item')].map(n=>n.textContent.trim()),
  activeNav: document.querySelector('.nav-item.is-active')?.textContent.trim(),
  cards: [...document.querySelectorAll('.card-title')].map(n=>n.textContent.trim()),
  liveCard: document.querySelector('.card-local.is-active .card-title')?.textContent.trim(),
  wallet: !!document.querySelector('.menu-wallet'),
  hints: [...document.querySelectorAll('.menu-hints .hint')].map(h=>h.textContent.trim()),
  watermark: document.querySelector('.menu-watermark')?.textContent.trim(),
  matchActiveWhileMenu: window.__APP.gameplay.active,
  hudHidden: getComputedStyle(window.__APP.hud.root).display === 'none'
}));

await page.screenshot({ path: 'tools/menu.png' });

// arrow-down should move the highlight to the 2nd section (does nothing else)
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
const afterNav = await page.evaluate(()=>({
  activeNav: document.querySelector('.nav-item.is-active')?.textContent.trim(),
  watermark: document.querySelector('.menu-watermark')?.textContent.trim(),
  stillActive: window.__APP.gameplay.active
}));

// back to KICK OFF and start the match
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
const afterStart = await page.evaluate(()=>({
  menuGone: !document.querySelector('.menu'),
  matchActive: window.__APP.gameplay.active,
  hudShown: getComputedStyle(window.__APP.hud.root).display !== 'none'
}));
await page.screenshot({ path: 'tools/menu-started.png' });

await browser.close();
console.log(JSON.stringify({ present, afterNav, afterStart }, null, 2));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
