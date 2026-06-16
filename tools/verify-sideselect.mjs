import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const errors=[];

async function openMenu(page){
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
  await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
  await page.waitForTimeout(400);
}

// shoot from x toward the user's goal; returns the ball's resulting vx
async function shotVx(page, x){
  return page.evaluate((x)=>{
    const a=window.__APP, g=a.gameplay, b=a.ball; a.renderer.setAnimationLoop(null);
    const me=g.controlledPlayer();
    me.reset(x,0,g.userSign>0?Math.PI/2:-Math.PI/2); b.reset(x,0); b.position.y=0.13; g.setOwner(me);
    g.shoot(me,0.6);
    return +b.velocity.x.toFixed(2);
  }, x);
}

// ---- AWAY flow -------------------------------------------------------------
const p1 = await browser.newPage({ viewport:{width:1600,height:900} });
p1.on('pageerror',e=>errors.push(e.message));
await openMenu(p1);
await p1.keyboard.press('Enter'); // KICK OFF -> side select
await p1.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
await p1.waitForTimeout(400);
const sideHomeClass = await p1.evaluate(()=>document.querySelector('.ss').className);
await p1.screenshot({ path:'tools/side-home.png' });
await p1.keyboard.press('ArrowRight'); // pick Away
await p1.waitForTimeout(250);
const sideAwayClass = await p1.evaluate(()=>document.querySelector('.ss').className);
await p1.screenshot({ path:'tools/side-away.png' });
await p1.keyboard.press('Enter'); // confirm -> match as AWAY
await p1.waitForTimeout(500);
const away = await p1.evaluate(()=>{
  const g=window.__APP.gameplay, me=g.controlledPlayer();
  return { userSide:g.userSide, active:g.active, attackX:g.userAttackX,
    ctrlInAway:g.away.includes(me), ctrlInHome:g.home.includes(me), ctrlName:me.name,
    ssGone:!document.querySelector('.ss') };
});
away.shotVx = await shotVx(p1, -10); // expect negative (toward -X away goal)
await p1.close();

// ---- HOME flow + cancel ----------------------------------------------------
const p2 = await browser.newPage({ viewport:{width:1600,height:900} });
p2.on('pageerror',e=>errors.push(e.message));
await openMenu(p2);
await p2.keyboard.press('Enter'); // -> side select
await p2.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
await p2.keyboard.press('Escape'); // Return -> back to main menu
await p2.waitForTimeout(300);
const cancelled = await p2.evaluate(()=>({ ssGone:!document.querySelector('.ss'), menuBack:!!document.querySelector('.menu') }));
await p2.keyboard.press('Enter'); // KICK OFF again
await p2.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
await p2.keyboard.press('Enter'); // confirm HOME (default)
await p2.waitForTimeout(500);
const home = await p2.evaluate(()=>{
  const g=window.__APP.gameplay, me=g.controlledPlayer();
  return { userSide:g.userSide, active:g.active, attackX:g.userAttackX,
    ctrlInHome:g.home.includes(me), ctrlName:me.name };
});
home.shotVx = await shotVx(p2, 10); // expect positive (toward +X home goal)
await p2.close();

await browser.close();
const checks = {
  sideHomeDefault: sideHomeClass.includes('side-home'),
  rightPicksAway: sideAwayClass.includes('side-away'),
  awaySide: away.userSide==='AWAY' && away.attackX<0 && away.ctrlInAway && !away.ctrlInHome,
  awayShootsNegX: away.shotVx < 0,
  cancelReturnsToMenu: cancelled.ssGone && cancelled.menuBack,
  homeSide: home.userSide==='HOME' && home.attackX>0 && home.ctrlInHome,
  homeShootsPosX: home.shotVx > 0
};
console.log(JSON.stringify({ away, home, cancelled, checks }, null, 2));
console.log('allPass:', Object.values(checks).every(Boolean));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
