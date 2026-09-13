#!/usr/bin/env node
/* Specialisation bench.
 *
 *   node tools/specs.mjs
 *
 * Asks a different question to sim.mjs. The sweep asks whether a fork is the
 * RIGHT choice on a level; this asks whether it does anything AT ALL — one
 * tower, one enemy kind, fixed steps, measuring the mechanic each spec claims
 * rather than whether a run was won.
 *
 * It exists because the first version of the specs shipped stat changes that
 * worked and behaviours that silently did not, and a sweep cannot tell those
 * apart: a spec that quietly does nothing still scores like the base tower.
 * Every line below should show its own mechanic firing — burn ticking, a
 * slow landing on a slow-immune kind, four arcs instead of two.
 */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json',
  '.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg' };
const srv = http.createServer((q,r)=>{ let f=decodeURIComponent(q.url.split('?')[0]);
  if(f==='/')f='/index.html'; const p=path.join(ROOT,f);
  if(!p.startsWith(ROOT)||!fs.existsSync(p)){r.writeHead(404);return r.end('');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});
  fs.createReadStream(p).pipe(r);});
await new Promise(r=>srv.listen(8735,r));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:8735/',{waitUntil:'networkidle'});
await page.waitForFunction(()=>!document.getElementById('boot'),null,{timeout:20000});

const out = await page.evaluate(() => {
  const log = [];
  // A controlled bench: one tower, one enemy kind, fixed steps. Measures the
  // mechanic each spec claims rather than whether the run was won.
  function bench({ type, spec, kind, n = 1, steps = 240, maxTracks = false, mate = null }) {
    newRun(0, 'normal');
    S.running = false;
    S.towers = [];
    const pad = S.map.pads[Math.floor(S.map.pads.length/2)];
    const t = { x: pad[0], y: pad[1], pad: 0, type,
                up:{dmg:0,range:0,rate:0}, spec:null, spent:0, cool:0, angle:0 };
    if (maxTracks) t.up.dmg = 3;
    t.spec = spec;
    S.towers.push(t);
    // SHATTER's whole point is amplifying OTHER towers, so a one-tower bench
    // understates it by design. `mate` puts a second tower on the next pad.
    if (mate) {
      const p2 = S.map.pads[Math.floor(S.map.pads.length/2) + 1] || pad;
      S.towers.push({ x:p2[0], y:p2[1], pad:1, type:mate,
        up:{dmg:maxTracks?3:0,range:0,rate:0}, spec:null, spent:0, cool:0, angle:0 });
    }
    S.enemies = []; S.shots = []; S.fx = []; S.corpses = [];
    S.wave = 5; S.phase = 'clearing';
    // Put the enemies where the tower can actually reach them: walk the road
    // for the point nearest the pad and start them a little short of it.
    let at = 0, best = Infinity;
    for (let d = 0; d < S.map.length; d += 20) {
      const p = pathPointAt(S.map, d);
      const dd = Math.hypot(p.x - t.x, p.y - t.y);
      if (dd < best) { best = dd; at = d; }
    }
    const start = Math.max(0, at - 150);
    for (let i = 0; i < n; i++) spawn(kind, start - i * 26);
    const total = S.enemies.reduce((a,e)=>a+e.maxHp,0);
    let slowSeen = 0, burnSeen = 0, shatterSeen = 0, chainMax = 0;
    for (let i = 0; i < steps; i++) {
      const before = S.enemies.length;
      update(16);
      for (const e of S.enemies) {
        if (S.time < e.slowUntil) slowSeen++;
        if (e.burnUntil && S.time < e.burnUntil) burnSeen++;
        if (e.shatterUntil && S.time < e.shatterUntil) shatterSeen++;
      }
      chainMax = Math.max(chainMax, S.fx.filter(f=>f.kind==='arc').length);
      if (!S.enemies.length) break;
    }
    const left = S.enemies.reduce((a,e)=>a+Math.max(0,e.hp),0);
    return { dealt: Math.round(total-left), killed: n - S.enemies.length,
             slowSeen, burnSeen, shatterSeen, chainMax,
             range: Math.round(towerRange(t)), dmg: Math.round(towerDamage(t)) };
  }
  const show = (label, r) => log.push(
    `${label.padEnd(26)} dealt ${String(r.dealt).padStart(6)}  killed ${String(r.killed).padStart(2)}` +
    `  slow ${String(r.slowSeen).padStart(4)}  burn ${String(r.burnSeen).padStart(4)}` +
    `  shatter ${String(r.shatterSeen).padStart(4)}  arcs ${r.chainMax}` +
    `  rng ${r.range} dmg ${r.dmg}`);

  // sentinel is armoured (0.70); wizard regenerates; goblin is plain.
  log.push('--- FIRE vs armoured sentinel ---');
  for (const sp of [null,'burn','scorch']) show(`fire/${sp||'base'}`, bench({type:'fire',spec:sp,kind:'sentinel',n:6,maxTracks:true}));
  log.push('--- FIRE vs regenerating wizard (few towers, long) ---');
  for (const sp of [null,'burn']) show(`fire/${sp||'base'}`, bench({type:'fire',spec:sp,kind:'wizard',n:4,steps:400,maxTracks:true}));
  log.push('--- ICE vs slow-immune warden ---');
  for (const sp of [null,'shatter','freeze']) show(`ice/${sp||'base'}`, bench({type:'ice',spec:sp,kind:'warden',n:4,maxTracks:true}));
  log.push('--- ICE vs plain goblin ---');
  for (const sp of [null,'shatter','freeze']) show(`ice/${sp||'base'}`, bench({type:'ice',spec:sp,kind:'goblin',n:6,maxTracks:true}));
  log.push('--- BOLT vs a crowd of goblins ---');
  for (const sp of [null,'overload','lance']) show(`bolt/${sp||'base'}`, bench({type:'bolt',spec:sp,kind:'goblin',n:12,maxTracks:true}));
  log.push('--- BOLT vs one armoured demon (a target that will not die first) ---');
  for (const sp of [null,'overload','lance']) show(`bolt/${sp||'base'}`, bench({type:'bolt',spec:sp,kind:'demon',n:1,steps:400,maxTracks:true}));
  log.push('--- SHATTER: ice beside a fire tower, vs armoured sentinels ---');
  for (const sp of [null,'shatter']) show(`ice/${sp||'base'} + fire`, bench({type:'ice',spec:sp,kind:'sentinel',n:6,steps:400,maxTracks:true,mate:'fire'}));
  log.push('--- ARCANE vs a crowd ---');
  for (const sp of [null,'siege','rift']) show(`arcane/${sp||'base'}`, bench({type:'arcane',spec:sp,kind:'goblin',n:12,maxTracks:true}));
  return log;
});
out.forEach(l=>console.log(l));
console.log(`
Reading it: every line should show its own mechanic firing, and every spec
should be visibly WORSE at something. burn trades direct damage for a burn
that armour and regeneration cannot answer; overload beats base on a crowd
and loses to it on a boss; siege doubles a blast and gives up a third of its
reach.

The SHATTER pair looks like a bug and is not. With ONE partner tower, +55% on
that partner does not repay the damage ice gives up, so the bench shows it
slightly behind base. Its value scales with how many towers are shooting into
the slow, and this bench can only afford one. What it is here to prove is that
the mark lands and lasts; whether the trade is worth taking is a question for
\`node tools/sim.mjs --forks\`, which plays it in a real build.`);
console.log('\nerrors:', errs.length?errs:'none');
await b.close(); srv.close();
