import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:900,height:1100} });
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
await page.waitForTimeout(300);
// menu -> side select -> team select -> start (solo, default teams)
await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.ts.show'),{timeout:10000});
await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
await page.waitForTimeout(500);

const info = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, THREE=a.scene.constructor; a.renderer.setAnimationLoop(null);
  // pose a player in a neutral stance and frame a close portrait
  const p = g.home[5];
  p.reset(0,0,Math.PI); // face -Z toward the camera we place at -Z
  for (let i=0;i<30;i++){ p.update(1/60,null,false); } // settle idle
  const cam = a.rig.camera;
  // stand in front of the player (player faces -Z), camera on -Z looking at torso
  cam.position.set(0.6, 1.15, -2.4);
  cam.lookAt(0, 1.0, 0);
  cam.updateMatrixWorld();
  a.postfx.render(cam);
  const tris = p.mesh.geometry.index ? p.mesh.geometry.index.count/3 : p.mesh.geometry.attributes.position.count/3;
  return { verts: p.mesh.geometry.attributes.position.count, tris, hasSlots: Object.keys(p.slots) };
});
await page.screenshot({ path:'tools/player-closeup.png' });

// a second angle: three-quarter
await page.evaluate(()=>{
  const a=window.__APP; const cam=a.rig.camera;
  cam.position.set(1.8,1.2,-1.9); cam.lookAt(0,0.95,0); cam.updateMatrixWorld(); a.postfx.render(cam);
});
await page.screenshot({ path:'tools/player-3q.png' });

await browser.close();
console.log(JSON.stringify(info,null,2));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
