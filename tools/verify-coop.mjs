import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const errors=[];

async function toSideSelect(page){
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
  await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
  await page.waitForTimeout(250);
}
async function pickTeamsAndStart(page){
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.ts.show'),{timeout:10000});
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

const SNAP = `(()=>{ const g=window.__APP.gameplay; window.__APP.renderer.setAnimationLoop(null);
  return { n:g.humans.length, sides:g.humans.map(h=>h.side), ids:g.humans.map(h=>h.id),
    ringColors:g.humans.map(h=>h.ringColor), ctrlPlayers:g.humans.map(h=>h.player().name),
    distinct:g.humans.length<2 || g.humans[0].player()!==g.humans[1].player(),
    rings:window.__APP.selRings.length, p2tag:getComputedStyle(window.__APP.hud.playerTag2).display }; })()`;

// ---- VERSUS: P1 Home, P2 Away ---------------------------------------------
const pv = await browser.newPage({ viewport:{width:1600,height:900} });
pv.on('pageerror',e=>errors.push(e.message));
await toSideSelect(pv);
await pv.screenshot({ path:'tools/sideselect2.png' });
await pv.keyboard.press('ArrowRight'); // P2 OFF -> AWAY
await pv.waitForTimeout(150);
await pickTeamsAndStart(pv);
const versus = await pv.evaluate((SNAP)=>{
  const g=window.__APP.gameplay; const snap=eval(SNAP);
  const ct=g.cameraTarget();
  snap.camOnBall = Math.abs(ct.position.x-g.ball.position.x)<0.01 && Math.abs(ct.position.z-g.ball.position.z)<0.01;
  g.startCorner('AWAY', 1, 1); snap.awayCornerCtrl = g.setPiece.controller && g.setPiece.controller.id; snap.awayUserCtrl=!!g.setPiece.userControlled;
  g.startCorner('HOME', -1, 1); snap.homeCornerCtrl = g.setPiece.controller && g.setPiece.controller.id;
  g.setPiece=null;
  return snap;
}, SNAP);
await pv.close();

// ---- CO-OP: P1 Home, P2 Home ----------------------------------------------
const pc = await browser.newPage({ viewport:{width:1600,height:900} });
pc.on('pageerror',e=>errors.push(e.message));
await toSideSelect(pc);
await pc.keyboard.press('ArrowLeft'); // P2 OFF -> HOME
await pc.waitForTimeout(150);
await pickTeamsAndStart(pc);
const coop = await pc.evaluate((SNAP)=>{
  const g=window.__APP.gameplay; const snap=eval(SNAP);
  let everSame=false;
  for(let f=0;f<200;f++){ g.update(1/60); if(g.humans[0].player()===g.humans[1].player()) everSame=true; }
  snap.everSame=everSame; snap.sameTeam=g.humans[0].team===g.humans[1].team;
  return snap;
}, SNAP);
await pc.close();

// ---- SOLO: P2 Off ----------------------------------------------------------
const ps = await browser.newPage({ viewport:{width:1600,height:900} });
ps.on('pageerror',e=>errors.push(e.message));
await toSideSelect(ps);
await pickTeamsAndStart(ps);
const solo = await ps.evaluate((SNAP)=>eval(SNAP), SNAP);
await ps.close();

await browser.close();
const checks = {
  versus_twoHumans: versus.n===2 && versus.sides[0]==='HOME' && versus.sides[1]==='AWAY',
  versus_distinct: versus.distinct,
  versus_ringColorsDiffer: versus.ringColors[0]!==versus.ringColors[1],
  versus_twoRings: versus.rings===2 && versus.p2tag!=='none',
  versus_camOnBall: versus.camOnBall,
  versus_setPieceOwner: versus.awayCornerCtrl==='P2' && versus.homeCornerCtrl==='P1' && versus.awayUserCtrl,
  coop_sameTeam: coop.n===2 && coop.sides[0]==='HOME' && coop.sides[1]==='HOME' && coop.sameTeam,
  coop_distinctAlways: coop.distinct && coop.everSame===false,
  solo_oneHuman: solo.n===1 && solo.rings===1 && solo.p2tag==='none'
};
console.log(JSON.stringify({ versus, coop, solo, checks }, null, 2));
console.log('allPass:', Object.values(checks).every(Boolean));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
