import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text());});
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball; a.renderer.setAnimationLoop(null);
  // count HOME players whose AI target sits within `r` of a ball owned by AWAY
  function closeCount(ballX, r){
    b.position.set(ballX, 0.13, 0); g.setOwner(a.away[5]); g.precomputeRoles();
    let cnt=0;
    for(const p of a.home){
      let tx,tz;
      if(p===g.presser.HOME){ tx=b.position.x; tz=b.position.z; }
      else if(p===g.cover.HOME){ const t=g.coverTarget(p); tx=t.x; tz=t.z; }
      else { const t=g.defendTarget(p); tx=t.x; tz=t.z; }
      if(Math.hypot(tx-ballX, tz-0) < r) cnt++;
    }
    return cnt;
  }
  const out={};
  // a ball deep in HOME's half (attack near goal) should pull MANY defenders in;
  // a ball up the pitch should pull few.
  out.shallowClose = closeCount(10, 16);   // ball in AWAY half
  out.midClose = closeCount(-25, 16);      // entering HOME half
  out.deepClose = closeCount(-42, 16);     // near HOME goal
  out.hasCover = !!g.cover.HOME && !!g.presser.HOME && g.cover.HOME !== g.presser.HOME;
  out.collapseScales = out.deepClose >= out.midClose && out.midClose > out.shallowClose && out.deepClose >= 7 && out.shallowClose <= 3;
  g.kickoff();
  return out;
});
await browser.close();
console.log(JSON.stringify(res, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
