import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('C:'+m.text());});
await page.goto('http://localhost:4173/', { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball; const DT=1/60; a.renderer.setAnimationLoop(null);
  const live=()=>{ g.kickoff(); for(let i=0;i<80;i++) g.update(DT); };
  const out={};
  // 1) HOME (attacker) puts it out over AWAY's goal line (+X) -> goal kick to AWAY (keeper)
  live(); g.setOwner(null); g.lastTouchTeam='HOME'; b.position.set(53,0.13,12); b.velocity.set(6,0,1);
  g.update(DT);
  out.gk_type = g.setPiece?.type; out.gk_team = g.setPiece?.team;
  out.gk_takerKeeper = g.setPiece && g.setPiece.taker===a.awayKeeper;
  out.gk_notUser = g.setPiece && g.setPiece.userControlled===false; // AWAY -> AI
  // 2) AWAY (defender) puts it out over AWAY's goal line -> corner to HOME (user)
  live(); g.setOwner(null); g.lastTouchTeam='AWAY'; b.position.set(53,0.13,12); b.velocity.set(6,0,1);
  g.update(DT);
  out.co_type = g.setPiece?.type; out.co_team = g.setPiece?.team;
  out.co_user = g.setPiece && g.setPiece.userControlled===true;
  out.co_takerForward = g.setPiece && a.home.includes(g.setPiece.taker);
  // players repositioned into the box (some HOME near the +X goal)
  out.co_attackersInBox = a.home.filter(p=>p.position.x>40).length >= 3;
  // 3) take the HOME corner with charge -> lofted ball, set-piece cleared
  const aim=g.setPiece.aim; g.takeSetPiece(aim, 0.85);
  out.take_cleared = g.setPiece===null;
  out.take_loose = g.ballOwner===null;
  out.take_lofted = b.velocity.y>4 && Math.hypot(b.velocity.x,b.velocity.z)>14;
  // low charge -> short grounded
  live(); g.setOwner(null); g.lastTouchTeam='AWAY'; b.position.set(53,0.13,-12); b.velocity.set(6,0,-1); g.update(DT);
  g.takeSetPiece(g.setPiece.aim, 0.05);
  out.lowCharge_grounded = b.velocity.y < 2 && Math.hypot(b.velocity.x,b.velocity.z) < 12;
  // 4) AWAY set-piece auto-takes after the pause
  live(); g.setOwner(null); g.lastTouchTeam='HOME'; b.position.set(-53,0.13,12); b.velocity.set(-6,0,1); // out over -X (HOME goal), HOME last -> goal kick HOME? wait
  g.update(DT);
  const awaySp = g.setPiece; out.away_type = awaySp?.type; out.away_team = awaySp?.team;
  if (awaySp && !awaySp.userControlled){ for(let i=0;i<90;i++){ g.update(DT); if(!g.setPiece) break; } }
  out.away_autoTaken = g.setPiece===null;
  return out;
});
await browser.close();
console.log(JSON.stringify(res,null,2)); console.log('ERRORS:', errors.length?errors.join('\n'):'none');
