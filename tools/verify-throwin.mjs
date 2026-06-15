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
  // 1) throw-ins (loose + dribbled), HOME touched last -> AWAY
  g.kickoff(); g.setOwner(null); g.lastTouchTeam='HOME';
  b.position.set(8,0.13,33.8); b.velocity.set(0,0,12);
  for(let i=0;i<30 && !g.ballOwner;i++) g.update(DT);
  out.loose_throwTeam = g.ballOwner? g.ballOwner.team : 'none';
  g.kickoff(); const c=a.home[5]; c.reset(0,0,0); g.setOwner(c); g.lastTouchTeam='HOME';
  c.position.set(-5,0,34.4); b.position.set(-5,0.13,34); g.carry(DT,c);
  out.dribble_throwTeam = g.ballOwner? g.ballOwner.team : 'none';

  // 2) carrier rule: a HOME player with the ball is always controlled
  g.kickoff(); const owner=g.ballOwner; g.controlled=0; g.resolveControl(DT);
  out.carrierRule = g.controlledPlayer()===owner;

  // 3) ball ALWAYS in frame (camera centre stays within CAM_LEAN of the ball)
  g.kickoff(); g.shotCam=0; const me=g.controlledPlayer(); me.position.set(0,0,0); b.position.set(30,0.13,0);
  out.cam_ballFramedFar = Math.hypot(g.cameraTarget().position.x-30, g.cameraTarget().position.z) <= 7.01;
  g.shotCam=1.0; me.position.set(28,0,0); b.position.set(30,0.13,0);
  out.cam_onBallDuringShot = Math.hypot(g.cameraTarget().position.x-30, g.cameraTarget().position.z) <= 1.0;

  // 4) Q: fresh -> nearest, insist (rapid) -> further, then resets when not rushed
  g.kickoff(); g.setOwner(null); b.position.set(0,0.13,0);
  for(let i=0;i<a.home.length;i++) a.home[i].position.set((i+1)*2,0,0);
  g.controlled=a.home.length-1; g.lastSwitchT=0; g.switchRank=0;
  g.manualSwitch(); const fresh=g.controlled;          // expect 0 (nearest)
  g.manualSwitch(); const i1=g.controlled;             // rapid -> 1
  g.manualSwitch(); const i2=g.controlled;             // rapid -> 2
  g.lastSwitchT=0; g.manualSwitch(); const reset=g.controlled; // fresh again -> 0
  out.q_freshNearest = fresh===0;
  out.q_insistFurther = i1===1 && i2===2;
  out.q_resetsWhenFresh = reset===0;

  g.kickoff();
  return out;
});
await browser.close();
console.log(JSON.stringify(res,null,2));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
