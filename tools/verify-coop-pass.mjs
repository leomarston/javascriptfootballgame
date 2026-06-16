import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const errors=[];

async function toSideSelect(page){
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
  await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
  await page.waitForTimeout(200);
}
async function pickTeamsAndStart(page){
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.ts.show'),{timeout:10000});
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

// ---- CO-OP (P1 Home, P2 Home) ---------------------------------------------
const pc = await browser.newPage({ viewport:{width:1600,height:900} });
pc.on('pageerror',e=>errors.push(e.message));
await toSideSelect(pc);
await pc.keyboard.press('ArrowLeft'); // P2 -> Home
await pc.waitForTimeout(120);
await pickTeamsAndStart(pc);

const coop = await pc.evaluate(()=>{
  const g=window.__APP.gameplay; window.__APP.renderer.setAnimationLoop(null);
  const P1=g.humans[0], P2=g.humans[1], team=g.home;
  const idxA=6, idxF=9, A=team[idxA], F=team[idxF];

  // P1 has the ball on A; P2 controls a forward F up ahead
  P1.controlled=idxA; P2.controlled=idxF;
  A.reset(0,0,Math.PI/2); F.reset(16,0,Math.PI/2);
  g.ball.reset(0,0); g.ball.position.set(0,0.13,0); g.setOwner(A);

  // P1 passes — must NOT keep/follow the ball
  g.pass(A, 0.6, P1);
  const afterPass = { p1Controlled:P1.controlled, p1Followed:P1.controlled!==idxA, p1PassTarget:!!P1.passTarget };

  // F collects it — the human on F (P2) should now have the ball, not P1
  g.setOwner(F); g.ball.position.set(F.position.x,0.13,F.position.z);
  g.resolveControl(1/60);
  const ownerH = g.humans.find(h=>h.player()===g.ballOwner);
  const afterReceive = { ownerBy: ownerH?ownerH.id:null, p1Controlled:P1.controlled, p2Controlled:P2.controlled };

  // Defending: the controller NEAREST the ball presses, not always P1
  for (const p of team) p.reset(-45,0,0);     // park the whole side near own goal
  P1.controlled=2; P2.controlled=4;
  team[2].reset(-44,0,0);                      // P1's man: far from the ball
  team[4].reset(-6,1,0);                       // P2's man: right by the ball
  team[5].reset(-6,-1,0);                      // the nearest team-mate to the ball
  g.setOwner(null); g.lastTouchTeam='AWAY';    // opponent has it (a real defensive ball)
  g.ball.position.set(-6,0.13,0);
  g.resolveControl(1/60);
  const presserH = g.humans.find(h=>h.controlled===g.nearestIndex(team,g.ball.position));
  const defend = { nearestIdx:g.nearestIndex(team,g.ball.position), presserBy:presserH?presserH.id:null, p1Controlled:P1.controlled };

  return { afterPass, afterReceive, defend };
});
await pc.close();

// ---- VERSUS pass-follow still works (single human follows their pass) ------
const pv = await browser.newPage({ viewport:{width:1600,height:900} });
pv.on('pageerror',e=>errors.push(e.message));
await toSideSelect(pv);
await pv.keyboard.press('ArrowRight'); // P2 -> Away (versus)
await pv.waitForTimeout(120);
await pickTeamsAndStart(pv);
const versus = await pv.evaluate(()=>{
  const g=window.__APP.gameplay; window.__APP.renderer.setAnimationLoop(null);
  const P1=g.humans[0], team=g.home, idxA=6, A=team[idxA], F=team[9];
  P1.controlled=idxA; A.reset(0,0,Math.PI/2); F.reset(16,0,Math.PI/2);
  g.ball.position.set(0,0.13,0); g.setOwner(A);
  g.pass(A,0.6,P1);
  return { followed: P1.controlled!==idxA, passTarget: !!P1.passTarget };
});
await pv.close();

await browser.close();
const checks = {
  coop_passerDoesNotFollow: coop.afterPass.p1Followed===false && coop.afterPass.p1PassTarget===false,
  coop_receiverGoesToNearerPad: coop.afterReceive.ownerBy==='P2' && coop.afterReceive.p1Controlled===6,
  coop_nearestPadPresses: coop.defend.presserBy==='P2' && coop.defend.p1Controlled===2,
  versus_passerStillFollows: versus.followed===true && versus.passTarget===true
};
console.log(JSON.stringify({ coop, versus, checks }, null, 2));
console.log('allPass:', Object.values(checks).every(Boolean));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
