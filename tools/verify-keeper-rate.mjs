import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball, k=a.awayKeeper;
  const DT=1/60; a.renderer.setAnimationLoop(null);
  let seed=12345; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const rng=(lo,hi)=>lo+(hi-lo)*rnd();
  const goalX=k.goalX;
  function trial(){
    const sx=rng(33,47), sz=rng(-12,12), aimZ=rng(-3.3,3.3), aimY=rng(0.2,1.4), speed=rng(16,25);
    k.reset(); b.reset(sx,sz); b.position.y=0.2;
    for(let i=0;i<30;i++){ b.velocity.set(0,0,0); k.update(DT,b,'loose'); }
    const dx=goalX-sx, dz=aimZ-sz; const horiz=Math.hypot(dx,dz); const vh=speed; const tf=horiz/vh;
    const vy=(aimY-0.2)/tf + 0.5*12*tf;
    b.velocity.set(dx/horiz*vh, vy, dz/horiz*vh);
    let goal=false, saved=false;
    for(let i=0;i<160;i++){
      const r=k.update(DT,b,'loose');
      if(k.holding){ saved=true; break; }
      if(r.saved) saved=true;
      const ev=g.physics.step(b,DT);
      if(ev && ev.scorer==='HOME'){ goal=true; break; }
      if(saved && (b.position.x-goalX)*k.side<-0.5) break;
    }
    return {goal,saved};
  }
  let onTarget=0, saves=0, goals=0;
  for(let n=0;n<80;n++){ const r=trial(); if(r.goal||r.saved){ onTarget++; if(r.goal) goals++; else saves++; } }
  return { onTarget, saves, goals, saveRate:+(saves/Math.max(1,onTarget)).toFixed(2) };
});
await browser.close();
console.log(JSON.stringify(res));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
