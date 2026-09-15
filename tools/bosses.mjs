#!/usr/bin/env node
/* Boss bench.
 *
 *   node tools/bosses.mjs
 *
 * One boss, a handful of towers, a fixed number of steps — measuring whether
 * each boss mechanic actually fires and whether it can be answered.
 *
 * The SHIELD pair is the one to read: chipping at it leaves the shield up for
 * hundreds of frames across several cycles and the boss survives; adding real
 * burst collapses the pool in one cycle and kills it. That difference is the
 * mechanic. If the two lines ever look alike, the shield has stopped being a
 * decision and gone back to being extra hit points.
 *
 * SUMMON is capped over the boss's whole life, and the cap is why this file
 * exists: uncapped it put out sixty adds in one crossing and made both levels
 * it appeared on unwinnable on EASY. A rate limit could not bound that.
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
await new Promise(r=>srv.listen(8743,r));
const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
const page=await b.newPage({viewport:{width:1280,height:720}});
const errs=[];page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:8743/',{waitUntil:'networkidle'});
await page.waitForFunction(()=>!document.getElementById('boot'),null,{timeout:20000});

const out = await page.evaluate(() => {
  const log = [];
  // One boss, a ring of towers around the road, stepped for a fixed time.
  function bench(bossKind, { towers = 6, type = 'fire', steps = 900, dps = null } = {}) {
    newRun(0, 'normal'); S.running = false;
    S.towers = []; S.enemies = []; S.shots = []; S.fx = []; S.corpses = [];
    S.wave = 12; S.phase = 'clearing';
    const pads = S.map.pads.slice(0, towers);
    pads.forEach((p, i) => S.towers.push({ x:p[0], y:p[1], pad:i, type,
      up:{dmg:3,range:3,rate:3}, spec:null, jammedUntil:0, spent:0, cool:0, angle:0 }));
    spawn(bossKind);
    const e = S.enemies[0];
    e.dist = 0;
    let shieldUp = 0, shieldBroke = 0, jammed = 0, jamPeak = 0, summoned = 0;
    let lastShield = 0;
    const startFoes = S.enemies.length;
    for (let i = 0; i < steps; i++) {
      // Optional flat damage, to test bursting a shield down rather than
      // waiting it out.
      if (dps && e.hp > 0) damage(e, dps * 16 / 1000, true);
      update(16);
      if (e.hp <= 0) break;
      if (e.shieldHp > 0) shieldUp++;
      if (lastShield > 0 && e.shieldHp <= 0) shieldBroke++;
      lastShield = e.shieldHp;
      const j = S.towers.filter(t => t.jammedUntil > S.time).length;
      jammed += j ? 1 : 0; jamPeak = Math.max(jamPeak, j);
      summoned = Math.max(summoned, S.enemies.length - 1);
    }
    return { alive: e.hp > 0, hpLeft: Math.round(Math.max(0, e.hp)),
             maxHp: Math.round(e.maxHp), shieldUp, shieldBroke,
             jammed, jamPeak, summoned, foes: S.enemies.length, startFoes };
  }
  const show = (l, r) => log.push(`  ${l.padEnd(30)} ` +
    `hp ${String(r.hpLeft).padStart(5)}/${r.maxHp}  shieldUp ${String(r.shieldUp).padStart(3)}` +
    `  cycles ${r.shieldBroke}  jammedFrames ${String(r.jammed).padStart(3)}` +
    `  jamPeak ${r.jamPeak}  adds ${r.summoned}`);

  log.push('SHIELD — demon, no burst (chipping only):');
  show('demon / 6 fire towers', bench('demon'));
  log.push('SHIELD — demon, with burst damage on top:');
  show('demon / + 900 dps', bench('demon', { dps: 900 }));
  log.push('JAM — warlord:');
  show('warlord / 6 fire towers', bench('warlord'));
  log.push('SUMMON — matriarch:');
  show('matriarch / 6 fire towers', bench('matriarch'));
  log.push('CONTROL — an ordinary heavy has no mechanic:');
  show('ogre / 6 fire towers', bench('ogre'));
  return log;
});
out.forEach(l => console.log(l));
console.log('\nerrors:', errs.length?errs:'none');
await b.close(); srv.close();
