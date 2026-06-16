import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.ts.show'),{timeout:10000});
await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
await page.waitForTimeout(700);
// settle the match a moment so players spread a little
await page.evaluate(()=>{ const a=window.__APP; a.renderer.setAnimationLoop(null); for(let i=0;i<120;i++) a.gameplay.update(1/60); });

// broadcast-ish low angle over the pitch
await page.evaluate(()=>{
  const a=window.__APP; const cam=a.rig.camera;
  cam.position.set(-6, 7, 30); cam.lookAt(2,0.6,2); cam.updateMatrixWorld(); a.postfx.render(cam);
});
await page.screenshot({ path:'tools/pitch-broadcast.png' });

// closer to read the turf stripes + player size
await page.evaluate(()=>{
  const a=window.__APP; const cam=a.rig.camera;
  cam.position.set(0, 3.2, 12); cam.lookAt(0,0.7,-2); cam.updateMatrixWorld(); a.postfx.render(cam);
});
await page.screenshot({ path:'tools/pitch-close.png' });

await browser.close();
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
