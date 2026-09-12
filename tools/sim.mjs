#!/usr/bin/env node
/* Balance simulation.
 *
 *   npm i playwright && node tools/sim.mjs [--strategy name] [--runs 3]
 *
 * Runs the real game — the actual game.js, not a model of it — headlessly to
 * wave 15 on every difficulty under several build strategies, stepping the
 * simulation directly instead of waiting on real time. A full sweep is seconds.
 *
 * This exists because the numbers are not guessable. Three findings came out
 * of it that reading the code would not have given:
 *
 *   - Pads 92-168px off the road left a 190-range tower covering a ~160px
 *     slice and landing two shots per enemy. Hard was unwinnable for
 *     geometric reasons. Moving pads to the verge fixed the difficulty
 *     without touching a single damage number.
 *   - A two-target chain made lightning strictly the best tower at any price.
 *   - Ice and arcane, priced as damage towers while dealing almost none, made
 *     an opening that lost by wave 3.
 *
 * Read the output as a spread, not a score. Every strategy winning means the
 * towers do not matter; one strategy winning means the others are traps.
 */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg' };

const args = process.argv.slice(2);
const only = args.includes('--strategy') ? args[args.indexOf('--strategy') + 1] : null;
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 1;

const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(''); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
});
await new Promise(r => srv.listen(8731, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:8731/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 });

const rows = await page.evaluate(({ only, runs }) => {
  // Pads ordered by how early on the road they sit: a competent player
  // fortifies the approach before the exit.
  const padOrder = PADS.map((p, i) => {
    let best = 1e9, at = 0;
    for (let d = 0; d < PATH_LEN; d += 8) {
      const q = pointAt(d), dd = Math.hypot(q.x - p[0], q.y - p[1]);
      if (dd < best) { best = dd; at = d; }
    }
    return { i, at };
  }).sort((a, b) => a.at - b.at).map(o => o.i);

  const STRATS = {
    'mixed/cheapest':    { build:['fire','fire','bolt','ice','arcane','fire','bolt','arcane','ice','bolt','fire'], pick:'cheap' },
    'mixed/damage':      { build:['fire','fire','bolt','ice','arcane','fire','bolt','arcane','ice','bolt','fire'], pick:'dmg' },
    'bolt-heavy/damage': { build:['fire','bolt','bolt','ice','bolt','bolt','arcane','bolt','ice','bolt','bolt'],   pick:'dmg' },
    'fire-rush/rate':    { build:['fire','fire','fire','fire','fire','fire','fire','fire','fire','fire','fire'],   pick:'rate' },
    'arcane+ice/damage': { build:['fire','ice','arcane','arcane','ice','arcane','arcane','ice','arcane','bolt','arcane'], pick:'dmg' },
  };

  function bot(cfg) {
    // Fill every affordable pad, then spend the remainder on upgrades — which
    // is what a player does before pressing start.
    for (let n = 0; n < PADS.length; n++) {
      const pad = padOrder[n];
      if (S.towers.some(t => t.pad === pad)) continue;
      const type = cfg.build[n % cfg.build.length], def = TOWERS[type];
      if (S.energy >= def.cost) {
        S.energy -= def.cost;
        S.towers.push({ x:PADS[pad][0], y:PADS[pad][1], pad, type,
          up:{dmg:0,range:0,rate:0}, spent:def.cost, cool:260, angle:0 });
      }
    }
    if (S.towers.length < 4) return;
    const order = cfg.pick === 'cheap' ? TRACK_ORDER
                : cfg.pick === 'dmg'   ? ['dmg','rate','range'] : ['rate','dmg','range'];
    for (let g = 0; g < 40; g++) {
      let bt = null, bk = null, bs = 1e9;
      for (const t of S.towers) for (const k of order) {
        if (t.up[k] >= MAX_TRACK) continue;
        const c = upgradeCost(t, k);
        const score = cfg.pick === 'cheap' ? c : c + order.indexOf(k) * 1000;
        if (score < bs && S.energy >= c * 2) { bs = score; bt = t; bk = k; }
      }
      if (!bt) break;
      const c = upgradeCost(bt, bk);
      S.energy -= c; bt.spent += c; bt.up[bk]++;
    }
  }

  const out = [];
  for (const [name, cfg] of Object.entries(STRATS)) {
    if (only && name !== only) continue;
    for (const diff of ['easy', 'normal', 'hard']) {
      for (let run = 0; run < runs; run++) {
        newRun(diff);
        let guard = 0, peak = 0;
        while (S.phase !== 'done' && guard++ < 400000) {
          if (S.phase === 'ready') { bot(cfg); startWave(true); }
          else if (guard % 24 === 0) bot(cfg);
          peak = Math.max(peak, S.enemies.length);
          update(33);
        }
        const d = DIFF[diff];
        out.push({ strat:name, diff, won:S.lives > 0, wave:S.wave, lives:S.lives,
          of:d.lives, score:S.score, towers:S.towers.length, peak,
          stars: S.lives <= 0 ? 0 : S.lives >= d.lives*0.9 ? 3
               : S.lives >= d.lives*0.55 ? 2 : 1 });
      }
    }
  }
  return out;
}, { only, runs });

console.log('strategy              diff    result  wave   lives  stars  score  peak');
for (const r of rows) {
  console.log(
    `${r.strat.padEnd(21)} ${r.diff.padEnd(7)} ${(r.won ? 'WON' : 'lost').padEnd(7)} ` +
    `${String(r.wave).padStart(2)}/15 ${`${r.lives}/${r.of}`.padStart(7)} ` +
    `${String(r.stars).padStart(5)}  ${String(r.score).padStart(5)}  ${String(r.peak).padStart(4)}`);
}
const won = rows.filter(r => r.won).length;
console.log(`\n${won}/${rows.length} runs won.` +
  ' A healthy map: most strategies clear normal, one or two clear hard.');
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }

await browser.close(); srv.close();
