import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text());});
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball; const DT=1/60; a.renderer.setAnimationLoop(null);
  const out={};
  // 1) loose ball out over a touchline; HOME touched last -> AWAY throw-in
  g.kickoff(); g.setOwner(null); g.lastTouchTeam='HOME';
  b.position.set(8,0.13,33.8); b.velocity.set(0,0,12);
  for(let i=0;i<30 && !g.ballOwner;i++) g.update(DT);
  out.loose_throwTeam = g.ballOwner? g.ballOwner.team : 'none';
  out.loose_ballInside = Math.abs(b.position.z) <= 34.2;
  // 2) dribbled out over a touchline -> throw to the other team
  g.kickoff(); const c=a.home[5]; c.reset(0,0,0); g.setOwner(c); g.lastTouchTeam='HOME';
  c.position.set(-5,0,34.4); b.position.set(-5,0.13,34);
  g.carry(DT, c);
  out.dribble_throwTeam = g.ballOwner? g.ballOwner.team : 'none';
  // 3) shot camera follows the ball, then returns to the player
  g.kickoff(); const me=g.controlledPlayer(); g.setOwner(me); me.reset(40,0,Math.PI/2); b.position.set(40.5,0.13,0);
  g.shoot(me,1);
  out.shot_camIsBall = g.cameraTarget()===b;
  g.shotCam=0;
  out.shot_camBackToPlayer = g.cameraTarget()===g.controlledPlayer();
  // 4) Q cycles by proximity (not toggle between two)
  g.kickoff(); g.setOwner(null); b.position.set(0,0.13,0);
  for(let i=0;i<a.home.length;i++) a.home[i].position.set((i+1)*2,0,0);
  g.controlled=a.home.length-1;
  const seq=[]; for(let i=0;i<4;i++){ g.manualSwitch(); seq.push(g.controlled); }
  out.q_seq=seq;
  out.q_cyclesNotToggle = new Set(seq.slice(0,3)).size===3;
  g.kickoff();
  return out;
});
await browser.close();
console.log(JSON.stringify(res,null,2));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
