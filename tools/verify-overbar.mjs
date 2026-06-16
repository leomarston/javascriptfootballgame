import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const PORT = process.env.PORT || '4173';
await page.goto(`http://localhost:${PORT}/`, { waitUntil:'load', timeout:60000 });
await page.waitForFunction(()=>!document.querySelector('.loader'),{timeout:120000}).catch(()=>{});
await page.waitForTimeout(800);
const res = await page.evaluate(()=>{
  const a=window.__APP, g=a.gameplay, b=a.ball; const DT=1/60; a.renderer.setAnimationLoop(null);
  const me=g.controlledPlayer(); const BAR=2.44; const POST=3.66;
  // Classify a straight-on shot from x (facing +X goal) at a given charge:
  //   'goal'  reached the goal line under the bar & inside the posts
  //   'over'  crossed the goal-line plane above the bar  (miss by height)
  //   'wide'  reached the line but outside the posts
  //   'short' never reached the line (fell short / stopped)
  function classify(x, charge){
    me.reset(x,0,Math.PI/2); b.reset(x,0); b.position.y=0.13; g.shoot(me,charge);
    let peak=0;
    for(let f=0;f<300;f++){
      const px=b.position.x; g.physics.step(b,DT);
      peak=Math.max(peak,b.position.y);
      if(px<52.5 && b.position.x>=52.5){
        const y=b.position.y, z=Math.abs(b.position.z);
        if(y>BAR) return {r:'over',y:+y.toFixed(2),peak:+peak.toFixed(2)};
        if(z>POST) return {r:'wide',y:+y.toFixed(2),peak:+peak.toFixed(2)};
        return {r:'goal',y:+y.toFixed(2),peak:+peak.toFixed(2)};
      }
      if(Math.abs(b.position.z)>34 || b.position.x<x-3) return {r:'wide',peak:+peak.toFixed(2)};
      if(b.velocity.length()<0.5 && b.position.y<0.2) return {r:'short',peak:+peak.toFixed(2)};
    }
    return {r:'short',peak:+peak.toFixed(2)};
  }
  // Average over a few samples (spread is random) and report the dominant verdict.
  function survey(x,charge,n=40){
    const c={goal:0,over:0,wide:0,short:0}; let ySum=0,yN=0,peakSum=0;
    for(let i=0;i<n;i++){ const o=classify(x,charge); c[o.r]++; peakSum+=o.peak; if(o.y!=null){ySum+=o.y;yN++;} }
    return { x, charge, ...c, overRate:+(c.over/n).toFixed(2), goalRate:+(c.goal/n).toFixed(2),
             avgY: yN?+(ySum/yN).toFixed(2):null, avgPeak:+(peakSum/n).toFixed(2) };
  }
  const dist = x => +(52.5 - x).toFixed(1);
  const out = { GOAL_HEIGHT: BAR, samples: [] };
  for (const x of [47, 36, 22]) {
    out.samples.push({ d: dist(x), full:   survey(x, 1.0),
                                   strong: survey(x, 0.8),
                                   mid:    survey(x, 0.5),
                                   soft:   survey(x, 0.3) });
  }
  // The headline checks the user asked for:
  const close = out.samples[0], midR = out.samples[1], farR = out.samples[2];
  out.checks = {
    // over-hitting a close shot still mostly goes in (you can blast it close range)
    closeFullStillScores: close.full.goalRate >= 0.5,
    // over-hitting from range sails OVER the bar (the new "miss by height")
    midFullSailsOver: midR.full.overRate >= 0.5,
    farFullSailsOver: farR.full.overRate >= 0.5,
    // matching power to distance scores from range (skill rewarded)
    midRightChargeScores: midR.mid.goalRate >= 0.5 || midR.strong.goalRate >= 0.5,
    // far shots are deliberately low percentage (distance spray), but a flatter
    // charge arcs up and DESCENDS under the bar — the misses there are width,
    // not height (avgY is the height as it crosses the goal line, not the apex).
    farFlatArrivesUnderBar: farR.strong.overRate <= 0.1 && farR.strong.avgY < BAR,
    farFlatCanScore: farR.strong.goalRate >= 0.1,
    // and a measured mid-range shot now lifts off the turf (no ground-skimmers)
    midMeasuredShotRises: midR.mid.avgPeak >= 1.5
  };
  out.allPass = Object.values(out.checks).every(Boolean);
  return out;
});
await browser.close();
console.log('dist  charge  peak   atGoal  verdict(goal/over/wide/short)');
for (const s of res.samples) {
  for (const [k,c] of [['full',s.full],['strong',s.strong],['mid',s.mid],['soft',s.soft]]) {
    const v = `g${c.goal} o${c.over} w${c.wide} s${c.short}`;
    console.log(`${String(s.d).padEnd(5)} ${k.padEnd(6)} ${String(c.avgPeak).padEnd(6)} ${String(c.avgY).padEnd(7)} ${v}`);
  }
}
console.log('\nchecks:', JSON.stringify(res.checks), '\nallPass:', res.allPass);
console.log('ERRORS:', errors.length?errors.join('\n'):'none');
