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
const full = args.includes('--full');      // every strategy x level x difficulty
const lvlArg = args.includes('--level') ? args[args.indexOf('--level') + 1] : null;
const sweep = args.includes('--rosters') ? Number(args[args.indexOf('--rosters') + 1]) : 0;

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

const rows = await page.evaluate(({ only, runs, full, lvlArg, sweep }) => {
  const STRATS = {
    'mixed/cheapest':    { build:['fire','fire','bolt','ice','arcane','fire','bolt','arcane','ice','bolt','fire'], pick:'cheap' },
    'mixed/damage':      { build:['fire','fire','bolt','ice','arcane','fire','bolt','arcane','ice','bolt','fire'], pick:'dmg' },
    'bolt-heavy/damage': { build:['fire','bolt','bolt','ice','bolt','bolt','arcane','bolt','ice','bolt','bolt'],   pick:'dmg' },
    'fire-rush/rate':    { build:['fire','fire','fire','fire','fire','fire','fire','fire','fire','fire','fire'],   pick:'rate' },
    'arcane+ice/damage': { build:['fire','ice','arcane','arcane','ice','arcane','arcane','ice','arcane','bolt','arcane'], pick:'dmg' },
  };

  function play(levelIndex, diff, cfg) {
    newRun(levelIndex, diff);
    // Pads ordered by how early on the road they sit: a competent player
    // fortifies the approach before the exit.
    const pads = S.map.pads;
    const order = pads.map((p, i) => {
      let best = 1e9, at = 0;
      for (let d = 0; d < S.map.length; d += 8) {
        const q = pathPointAt(S.map, d), dd = Math.hypot(q.x - p[0], q.y - p[1]);
        if (dd < best) { best = dd; at = d; }
      }
      return { i, at };
    }).sort((a, b) => a.at - b.at).map(o => o.i);

    function bot() {
      // Fill every affordable pad, then spend the rest on upgrades — which is
      // what a player does before pressing start.
      for (let n = 0; n < pads.length; n++) {
        const pad = order[n];
        if (S.towers.some(t => t.pad === pad)) continue;
        const type = cfg.build[n % cfg.build.length], def = TOWERS[type];
        if (S.energy >= def.cost) {
          S.energy -= def.cost;
          S.towers.push({ x:pads[pad][0], y:pads[pad][1], pad, type,
            up:{dmg:0,range:0,rate:0}, spent:def.cost, cool:260, angle:0 });
        }
      }
      if (S.towers.length < 4) return;
      const tracks = cfg.pick === 'cheap' ? TRACK_ORDER
                   : cfg.pick === 'dmg'   ? ['dmg','rate','range'] : ['rate','dmg','range'];
      for (let g = 0; g < 40; g++) {
        let bt = null, bk = null, bs = 1e9;
        for (const t of S.towers) for (const k of tracks) {
          if (t.up[k] >= MAX_TRACK) continue;
          const c = upgradeCost(t, k);
          const sc = cfg.pick === 'cheap' ? c : c + tracks.indexOf(k) * 1000;
          if (sc < bs && S.energy >= c * 2) { bs = sc; bt = t; bk = k; }
        }
        if (!bt) break;
        const c = upgradeCost(bt, bk);
        S.energy -= c; bt.spent += c; bt.up[bk]++;
      }
    }

    let guard = 0;
    while (S.phase !== 'done' && guard++ < 500000) {
      if (S.phase === 'ready') { bot(); startWave(true); }
      else if (guard % 24 === 0) bot();
      update(33);
    }
    const d = DIFF[diff];
    return { won: S.lives > 0, wave: S.wave, lives: S.lives, of: d.lives,
      score: S.score, towers: S.towers.length,
      stars: S.lives <= 0 ? 0 : S.lives >= d.lives*0.9 ? 3
           : S.lives >= d.lives*0.55 ? 2 : 1 };
  }

  if (sweep) {
    // Same map, same wave curve, same difficulty — only the roster changes.
    // Anything that differs in the result is the roster's doing.
    const kinds = Object.keys(KINDS);
    const heavies = kinds.filter(k => KINDS[k].hp >= 1.8 && KINDS[k].hp < 8);
    const fasts   = kinds.filter(k => KINDS[k].speed >= 1.1);
    const fodders = kinds.filter(k => KINDS[k].hp <= 1.3);
    // Vary the CURVE as well as the roster. Roster alone measures one lever;
    // a level gets both, and the pair is what decides how many genuinely
    // different levels can exist.
    const curves = Object.keys(CURVES);
    const seen = new Map();
    const tried = [];
    const savedCurve = LEVELS[0].curve, savedHp = LEVELS[0].hp;
    LEVELS[0].hp = 1.0;          // neutral map, so the LEVERS are what shows
    let n = 0;
    outer:
    for (const cv of curves) {
      for (const fo of fodders) for (const fa of fasts) for (const he of heavies) {
        if (n++ >= sweep) break outer;
        LEVELS[0].curve = cv;
        LEVELS[0].roster = { fodder:fo, fast:fa, heavy:he, boss:'demon' };
        const won = [];
        for (const [name, cfg] of Object.entries(STRATS)) {
          const r = play(0, 'normal', cfg);
          if (r.won) won.push(name.split('/')[0]);
        }
        const key = [...new Set(won)].sort().join(',') || '(none)';
        seen.set(key, (seen.get(key) || 0) + 1);
        tried.push({ roster: `${cv}: ${fo}/${fa}/${he}`, key });
      }
    }
    LEVELS[0].curve = savedCurve; LEVELS[0].hp = savedHp;
    return { sweep: true, tried, distinct: [...seen.entries()] };
  }

  const out = [];
  const levels = lvlArg == null ? LEVELS.map((_, i) => i)
                                : [LEVELS.findIndex(l => l.id === lvlArg)].filter(i => i >= 0);
  const diffs = full ? ['easy','normal','hard'] : ['easy','normal','hard'];
  for (const li of levels) {
    for (const diff of diffs) {
      for (const [name, cfg] of Object.entries(STRATS)) {
        if (only && name !== only) continue;
        for (let r = 0; r < runs; r++) {
          out.push(Object.assign({ level: LEVELS[li].id, n: li + 1, strat: name, diff },
                                 play(li, diff, cfg)));
        }
      }
    }
  }
  return out;
}, { only, runs, full, lvlArg, sweep });

if (rows && rows.sweep) {
  console.log('curve: fodder/fast/heavy                builds that clear it on normal');
  for (const t of rows.tried) console.log(`  ${t.roster.padEnd(38)} ${t.key}`);
  console.log(`\n${rows.tried.length} curve+roster pairs on ONE map, ` +
    `${rows.distinct.length} distinct outcomes:`);
  for (const [k, n] of rows.distinct.sort((a, b) => b[1] - a[1])) {
    console.log(`  x${String(n).padStart(2)}  ${k}`);
  }
  await browser.close(); srv.close(); process.exit(0);
}

if (full || only) {
  console.log('level        diff    strategy              result  wave   lives  score');
  for (const r of rows) console.log(
    `${r.level.padEnd(12)} ${r.diff.padEnd(7)} ${r.strat.padEnd(21)} ` +
    `${(r.won ? 'WON' : 'lost').padEnd(7)} ${String(r.wave).padStart(2)}/15 ` +
    `${`${r.lives}/${r.of}`.padStart(7)} ${String(r.score).padStart(6)}`);
} else {
  // The shape that matters: per level and difficulty, how many of the five
  // build strategies clear it, and how comfortably the best one does.
  console.log('level           easy         normal        hard');
  for (const lvl of [...new Set(rows.map(r => r.level))]) {
    const cells = ['easy','normal','hard'].map(d => {
      const rs = rows.filter(r => r.level === lvl && r.diff === d);
      const won = rs.filter(r => r.won);
      const best = won.length ? Math.max(...won.map(r => r.lives)) : 0;
      const of = rs[0].of;
      const deepest = Math.max(...rs.map(r => r.wave));
      return won.length
        ? `${won.length}/${rs.length} win ${best}/${of}`.padEnd(13)
        : `0/${rs.length} · w${deepest}`.padEnd(13);
    });
    const n = rows.find(r => r.level === lvl).n;
    console.log(`${(n + '. ' + lvl).padEnd(15)} ${cells.join(' ')}`);
  }
  const wins = rows.filter(r => r.won).length;
  console.log(`\n${wins}/${rows.length} runs won.`);
  console.log('Healthy: easy mostly cleared, normal cleared by several builds,');
  console.log('hard cleared by one or two. A level nothing clears is a wall;');
  console.log('a level everything clears is not asking anything.');

  // Which builds clear each level on normal. This is the test of whether two
  // levels are actually different problems or the same one reskinned: if the
  // set of builds that beat them is identical, so are the levels.
  console.log('\nBuilds that clear each level on NORMAL:');
  const sets = new Map();
  for (const lvl of [...new Set(rows.map(r => r.level))]) {
    const won = rows.filter(r => r.level === lvl && r.diff === 'normal' && r.won)
                    .map(r => r.strat.split('/')[0]);
    const key = [...new Set(won)].sort().join(',');
    sets.set(key, (sets.get(key) || 0) + 1);
    console.log(`  ${lvl.padEnd(12)} ${key || '(none)'}`);
  }
  console.log(`\n${sets.size} distinct answer(s) across ` +
    `${[...new Set(rows.map(r => r.level))].length} levels. Levels sharing an ` +
    'answer\nare the same puzzle wearing different scenery.');
}
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }

await browser.close(); srv.close();
