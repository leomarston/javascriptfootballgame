import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball; const DT=1/60; a.renderer.setAnimationLoop(null);
  const me=g.controlledPlayer(); const out={};
  // facing away from goal -> ball travels away (not into the +X goal)
  g.setOwner(me); me.reset(45,0,-Math.PI/2); b.reset(45,0); b.position.y=0.13; g.shoot(me,0.8);
  out.facingAway_goesAway = b.velocity.x < 0;
  // facing the goal from close -> toward goal
  me.reset(46,0,Math.PI/2); b.reset(46,0); b.position.y=0.13; g.shoot(me,0.8);
  out.facingGoal_goesToGoal = b.velocity.x > 5;
  // on-target rate (keeper-free) drops with distance
  function rate(x,n){ let h=0; for(let i=0;i<n;i++){ me.reset(x,0,Math.PI/2); b.reset(x,0); b.position.y=0.13; g.shoot(me,0.9);
    let on=false; for(let f=0;f<180;f++){ const px=b.position.x; g.physics.step(b,DT);
      if(px<52.5 && b.position.x>=52.5){ if(Math.abs(b.position.z)<3.5 && b.position.y<2.3) on=true; break; }
      if(Math.abs(b.position.z)>34 || b.position.x<x-2) break; }
    if(on) h++; } return +(h/n).toFixed(2); }
  out.closeRate = rate(47,60);
  out.midRate = rate(36,60);
  out.farRate = rate(22,60);
  out.dropsWithDistance = out.closeRate > out.midRate && out.midRate > out.farRate;
  return out;
});
await browser.close();
console.log(JSON.stringify(res,null,2)); console.log('ERRORS:', errors.length?errors.join('\n'):'none');
