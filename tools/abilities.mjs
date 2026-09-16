#!/usr/bin/env node
/* Ability bench.
 *
 *   node tools/abilities.mjs
 *
 * Each ability, measured against the thing it claims to do. Two of these lines
 * exist because the first version of the test was wrong rather than the code:
 *
 *  - SURGE is measured by DAMAGE over a fixed window. Counting the shots array
 *    is not a count — a shot added on the same frame another lands leaves the
 *    length unchanged, so a tower firing twice as fast read as zero shots.
 *  - Its target is a goblin, not a demon. The demon is the SHIELD boss and its
 *    pool is a fraction of maxHp, so inflating maxHp to keep the target alive
 *    handed it two hundred million points of shield and every shot vanished.
 */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json',
 '.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg'};
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(q.url.split('?')[0]);
 if(f==='/')f='/index.html';const p=path.join(ROOT,f);
 if(!p.startsWith(ROOT)||!fs.existsSync(p)){r.writeHead(404);return r.end('');}
 r.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});
 fs.createReadStream(p).pipe(r);});
await new Promise(r=>srv.listen(8781,r));
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
const page=await b.newPage({viewport:{width:915,height:412}});
const errs=[];page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:8781/',{waitUntil:'networkidle'});
await page.waitForFunction(()=>!document.getElementById('boot'),null,{timeout:20000});
const step=async(l,fn)=>{const r=await page.evaluate(fn);
  console.log(`  ${l.padEnd(40)} ${JSON.stringify(r)}`); return r;};

console.log('abilities:');
await step('three buttons, all ready at wave start', ()=>{
  newRun(0,'normal'); S.running=false; S.wave=5; S.phase='clearing';
  syncAbilities();
  return { buttons:[...document.querySelectorAll('.abil')].map(b=>b.dataset.id),
           ready:[...document.querySelectorAll('.abil.ready')].length };
});
await step('STRIKE arms rather than firing', ()=>{
  document.querySelector('.abil[data-id=strike]').click();
  return { aiming:S.aiming, cooldownStarted:(S.abilityAt.strike||0)>S.time,
           armed:!!document.querySelector('.abil.arm') };
});
await step('tapping it again backs out, unspent', ()=>{
  document.querySelector('.abil[data-id=strike]').click();
  return { aiming:S.aiming, stillReady:abilityReady('strike') };
});
await step('STRIKE kills a clump it lands on', ()=>{
  newRun(0,'normal'); S.running=false; S.wave=10; S.phase='clearing';
  S.enemies=[]; S.towers=[];
  for(let i=0;i<8;i++) spawn('goblin', 500+i*18);
  for(let i=0;i<3;i++) update(16);
  const before=S.enemies.reduce((a,e)=>a+e.hp,0);
  const mid=S.enemies[4];
  useAbility('strike'); fireAbility('strike', mid.x, mid.y);
  const landed=S.pending.length;
  for(let i=0;i<60;i++) update(16);
  const after=S.enemies.reduce((a,e)=>a+Math.max(0,e.hp),0);
  return { queued:landed, dealt:Math.round(before-after),
           killed:8-S.enemies.length, onCooldown:!abilityReady('strike') };
});
await step('STRIKE goes through armour', ()=>{
  newRun(0,'normal'); S.running=false; S.wave=10; S.phase='clearing';
  S.enemies=[]; S.towers=[];
  spawn('sentinel', 500); const e=S.enemies[0];
  for(let i=0;i<3;i++) update(16);
  const before=e.hp;
  fireAbility('strike', e.x, e.y);
  for(let i=0;i<60;i++) update(16);
  return { armour:KINDS.sentinel.armour, dealt:Math.round(before-Math.max(0,e.hp)) };
});
await step('FREEZE stops even slow-immune kinds', ()=>{
  newRun(3,'normal'); S.running=false; S.wave=8; S.phase='clearing';
  S.enemies=[]; S.towers=[];
  spawn('wisp',300); spawn('warden',400);
  for(let i=0;i<3;i++) update(16);
  const before=S.enemies.map(e=>e.dist);
  fireAbility('freeze');
  const slowed=S.enemies.filter(e=>S.time<e.slowUntil).length;
  for(let i=0;i<40;i++) update(16);
  const moved=S.enemies.map((e,i)=>+(e.dist-before[i]).toFixed(1));
  return { immuneKinds:['wisp','warden'].map(k=>!!KINDS[k].slowImmune),
           slowed, movedWhileFrozen:moved };
});
await step('SURGE doubles the damage a tower puts out', ()=>{
  // Measured as damage over a fixed window against a target that will not die
  // and will not walk away. Counting the shots array was the first attempt and
  // it is not a count: a shot added on the same frame another lands leaves the
  // length unchanged, so a faster tower can read as fewer shots.
  function window(surge) {
    newRun(0,'normal'); S.running=false; S.wave=12; S.phase='clearing';
    S.towers=[]; S.enemies=[]; S.shots=[];
    let at=0,best=Infinity;
    const p=S.map.pads[0];
    S.towers.push({x:p[0],y:p[1],pad:0,type:'fire',up:{dmg:0,range:3,rate:0},
      spec:null,jammedUntil:0,spent:0,cool:0,angle:0});
    const t=S.towers[0];
    for(let d=0;d<S.map.length;d+=20){const q=pathPointAt(S.map,d);
      const dd=Math.hypot(q.x-t.x,q.y-t.y); if(dd<best){best=dd;at=d;}}
    // A goblin, not a demon. The demon is the SHIELD boss and its pool is a
    // fraction of maxHp, so inflating maxHp to keep it alive gave it two
    // hundred million points of shield and every shot vanished into that.
    spawn('goblin', Math.max(0,at-40));
    const e=S.enemies[0];
    e.hp = e.maxHp = 1e7;                 // will not die, will not leave
    e.speed = 0;
    for(let i=0;i<4;i++) update(16);
    if (surge) fireAbility('surge');
    const before=e.hp;
    for(let i=0;i<180;i++) update(16);    // ~2.9s, inside surge's 7s
    return Math.round(before-e.hp);
  }
  const plain=window(false), surged=window(true);
  return { plain, surged, ratio:+(surged/plain).toFixed(2) };
});

await step('cooldowns are per ability and tick down', ()=>{
  newRun(0,'normal'); S.running=false; S.wave=5; S.phase='clearing';
  fireAbility('freeze');
  const a=abilityCharge('freeze'), b=abilityCharge('surge');
  for(let i=0;i<600;i++) update(16);   // ~9.6s
  return { freezeJustUsed:+a.toFixed(2), surgeUntouched:+b.toFixed(2),
           freezeAfter10s:+abilityCharge('freeze').toFixed(2),
           surgeStillReady:abilityReady('surge') };
});
await step('nothing fires once the run is over', ()=>{
  newRun(0,'normal'); S.phase='done';
  return { ready:ABILITY_ORDER.map(id=>abilityReady(id)) };
});
console.log('\nerrors:', errs.length?errs:'none');
await b.close(); srv.close();
