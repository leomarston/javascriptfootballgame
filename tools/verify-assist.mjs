import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text());});
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay; a.renderer.setAnimationLoop(null);
  const me=a.home[5];
  const assist=(mx,mz,dx,dz,bx,bz,owner)=>{
    me.position.set(mx,0,mz); me.state='loco';
    a.ball.position.set(bx,0.13,bz); g.ballOwner=owner||null;
    const dir={x:dx,z:dz,lengthSq(){return this.x*this.x+this.z*this.z;}};
    const r=g._assistDir(me,dir); return {x:+r.x.toFixed(3),z:+r.z.toFixed(3)};
  };
  const out={};
  const far=assist(-3,1, 1,0, 0,0);            // heading +X, ball below-right
  const near=assist(-1.2,0.6, 1,0, 0,0);       // closer
  out.curvesToBall = far.z < -0.01;
  out.strongerWhenCloser = Math.abs(near.z) > Math.abs(far.z);
  const away=assist(-3,0, -1,0, 0,0);          // steering away
  out.respectsIntent = away.x < -0.9 && Math.abs(away.z) < 0.05;
  const owned=assist(-1.2,0.6, 1,0, 0,0, a.home[3]); // ball owned
  out.onlyLoose = Math.abs(owned.z) < 0.01 && owned.x > 0.99;

  // capture bonus: your player collects a ball at 1.0 m (base radius is 0.85)
  g.kickoff(); g.controlled=5; g.setOwner(null);
  for(const p of [...a.home, ...a.away]) if(p!==me) p.position.set(60,0,60);
  me.position.set(0,0,0); me.captureCooldown=0; me.state='loco';
  a.ball.position.set(0,0.13,1.0); a.ball.velocity.set(0,0,0);
  g.resolveLoose(); out.captureBonus = g.ballOwner===me;

  // a non-controlled player at 1.0 m does NOT get the bonus
  g.setOwner(null); g.controlled=5; const other=a.home[6];
  for(const p of [...a.home, ...a.away]) if(p!==other) p.position.set(60,0,60);
  other.position.set(0,0,0); other.captureCooldown=0; other.state='loco';
  a.ball.position.set(0,0.13,1.0); a.ball.velocity.set(0,0,0);
  g.resolveLoose(); out.noBonusForOthers = g.ballOwner===null;

  g.kickoff();
  return out;
});
await browser.close();
console.log(JSON.stringify(res,null,2));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
