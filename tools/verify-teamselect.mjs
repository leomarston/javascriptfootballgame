import { chromium } from 'playwright';
const PORT = process.env.PORT || '4173';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const errors=[];

async function toTeamSelect(page){
  await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
  await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.menu.show'),{timeout:20000});
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); // KICK OFF -> side select
  await page.waitForFunction(()=>document.querySelector('.ss.show'),{timeout:10000});
  await page.keyboard.press('Enter'); // confirm HOME side -> team select
  await page.waitForFunction(()=>document.querySelector('.ts.show'),{timeout:10000});
  await page.waitForTimeout(300);
}

// ---- forward flow + apply -------------------------------------------------
const p1 = await browser.newPage({ viewport:{width:1600,height:900} });
p1.on('pageerror',e=>errors.push(e.message));
await toTeamSelect(p1);

const initial = await p1.evaluate(()=>({
  home: document.querySelector('.ts-panel.home .ts-name').textContent,
  away: document.querySelector('.ts-panel.away .ts-name').textContent,
  focusHome: document.querySelector('.ts').className.includes('focus-home'),
  nFlags: document.querySelectorAll('.ts-flag .flag').length,
  stars: document.querySelectorAll('.ts-panel.home .star').length,
  starsFull: document.querySelectorAll('.ts-panel.home .star.full').length
}));
await p1.screenshot({ path:'tools/teamselect.png' });

// cycle the home team right, then back
await p1.keyboard.press('ArrowRight');
await p1.waitForTimeout(120);
const cycled = await p1.evaluate(()=>document.querySelector('.ts-panel.home .ts-name').textContent);
await p1.keyboard.press('ArrowLeft');
await p1.waitForTimeout(120);
const backToArg = await p1.evaluate(()=>document.querySelector('.ts-panel.home .ts-name').textContent);

// confirm: Enter (home->away focus), Enter (start) -> ARG home, FRA away
await p1.keyboard.press('Enter');
await p1.waitForTimeout(120);
await p1.keyboard.press('Enter');
await p1.waitForTimeout(500);

const applied = await p1.evaluate(()=>{
  const a=window.__APP, g=a.gameplay; a.renderer.setAnimationLoop(null);
  const hp=g.home[0]; const attr=hp.mesh.geometry.getAttribute('color'); const [s]=hp.slots.shirt[0];
  const j=s*3; const shirt={ r:+attr.array[j].toFixed(3), g:+attr.array[j+1].toFixed(3), b:+attr.array[j+2].toFixed(3) };
  const ap=g.away[0]; const aattr=ap.mesh.geometry.getAttribute('color'); const [as]=ap.slots.shirt[0];
  const aj=as*3; const ashirt={ r:+aattr.array[aj].toFixed(3), g:+aattr.array[aj+1].toFixed(3), b:+aattr.array[aj+2].toFixed(3) };
  return {
    teamHome:g.teamId.HOME.short, teamAway:g.teamId.AWAY.short,
    hudHome:a.hud.homeName.textContent, hudAway:a.hud.awayName.textContent,
    tsGone:!document.querySelector('.ts'), active:g.active, userSide:g.userSide,
    homeShirt:shirt, awayShirt:ashirt
  };
});
await p1.close();

// ---- cancel back to side-select -------------------------------------------
const p2 = await browser.newPage({ viewport:{width:1600,height:900} });
p2.on('pageerror',e=>errors.push(e.message));
await toTeamSelect(p2);
await p2.keyboard.press('Escape'); // focus home -> back to side select
await p2.waitForTimeout(300);
const cancelled = await p2.evaluate(()=>({ tsGone:!document.querySelector('.ts'), ssBack:!!document.querySelector('.ss') }));
await p2.close();

await browser.close();
const checks = {
  defaultsArgFra: initial.home==='Argentina' && initial.away==='France',
  tenFlagsRendered: initial.nFlags===2, // two big flags shown
  fiveStars: initial.stars===5 && initial.starsFull>=4,
  cyclingWorks: cycled!=='Argentina' && backToArg==='Argentina',
  teamIdApplied: applied.teamHome==='ARG' && applied.teamAway==='FRA',
  hudApplied: applied.hudHome==='ARG' && applied.hudAway==='FRA',
  homeKitRepainted: applied.homeShirt.b > applied.homeShirt.r, // ARG light-blue, not red
  awayKitRepainted: applied.awayShirt.b > applied.awayShirt.r, // FRA blue
  started: applied.active && applied.tsGone && applied.userSide==='HOME',
  cancelToSideSelect: cancelled.tsGone && cancelled.ssBack
};
console.log(JSON.stringify({ initial, cycled, backToArg, applied, cancelled, checks }, null, 2));
console.log('allPass:', Object.values(checks).every(Boolean));
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
