#!/usr/bin/env node
/* HUD layout check.
 *
 *   node tools/layout.mjs
 *
 * Exits non-zero on any overlap, so it is usable as a gate. The first cut of the wave-preview panel shipped a wave
 * counter drawn ON TOP of the stats box on a portrait phone, which no unit
 * test would have caught. This walks the HUD boxes at the sizes the game
 * actually runs at and fails on any overlap. */
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
await new Promise(r=>srv.listen(8734,r));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const SIZES = [
  ['phone-sm',   360, 640], ['phone',      412, 915],
  ['phone-lg',   430, 932], ['landscape',  915, 412],
  ['tablet',    1024, 768], ['desktop',   1440, 900],
];
const IDS = ['stats','waveStack','rightControls','bottomBar','banner'];
let bad = 0;
for (const [name, width, height] of SIZES) {
  const page = await b.newPage({ viewport: { width, height } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8734/', { waitUntil:'networkidle' });
  await page.waitForFunction(()=>!document.getElementById('boot'),null,{timeout:20000});
  await page.evaluate(()=>{ newRun(5,'normal'); S.wave=8; S.phase='ready';
    S.restLeft=20000; S.dirty=true; syncHud(); syncWaveState();
    // Clearing a wave puts the banner up AND the next-wave panel up, in the
    // same instant — the state where they can collide, so it is the state
    // this checks. Held open rather than left to time out.
    banner('WAVE 8 CLEAR', '+136 ENERGY', false, 60000); });
  await page.waitForTimeout(250);
  const r = await page.evaluate((ids)=>{
    const box = {};
    for (const id of ids) { const e=document.getElementById(id); if(!e) continue;
      const b=e.getBoundingClientRect();
      box[id]={l:Math.round(b.left),t:Math.round(b.top),
               r:Math.round(b.right),b:Math.round(b.bottom)}; }
    const hits=[]; const k=Object.keys(box);
    for (let i=0;i<k.length;i++) for (let j=i+1;j<k.length;j++) {
      const A=box[k[i]],B=box[k[j]];
      if (!(A.r<=B.l||A.l>=B.r||A.b<=B.t||A.t>=B.b)) hits.push(`${k[i]}/${k[j]}`);
    }
    const pv=box.waveStack;
    const off = pv && (pv.l<0||pv.r>innerWidth||pv.t<0||pv.b>innerHeight);

    // Where the BOARD is, which is not where the canvas is: the canvas fills
    // the window and the board is letterboxed inside it. Checking HUD boxes
    // only against each other passed a portrait phone whose board was 27% of
    // the screen with a dead band under it and the wave counter adrift above
    // it — every widget was clear of every other widget and the screen was
    // still wrong.
    const board = { l: Math.round(ox), t: Math.round(oy),
                    r: Math.round(ox + MAP_W*scale), b: Math.round(oy + MAP_H*scale) };
    board.frac = +((board.b - board.t) / innerHeight).toFixed(2);

    // Dead space trapped BETWEEN the board and the tray, or between the HUD
    // and the board. Space outside the whole group is a frame; space inside it
    // is a hole.
    const tray = box.bottomBar, stack = box.waveStack;
    const gapBelow = tray ? tray.t - board.b : 0;
    const gapAbove = stack ? board.t - stack.b : 0;

    // A HUD panel over the board is fine — that is the landscape design — but
    // one that covers a quarter of it is not.
    let covered = 0;
    for (const k of ['stats','waveStack','bottomBar']) {
      const A = box[k]; if (!A) continue;
      const w = Math.max(0, Math.min(A.r,board.r) - Math.max(A.l,board.l));
      const h = Math.max(0, Math.min(A.b,board.b) - Math.max(A.t,board.t));
      covered += w*h;
    }
    const boardArea = Math.max(1,(board.r-board.l)*(board.b-board.t));
    const coverFrac = +(covered/boardArea).toFixed(2);

    return { hits, off, pv, board, gapBelow, gapAbove, coverFrac };
  }, IDS);
  const holes = [];
  if (r.gapBelow > 60) holes.push(`${r.gapBelow}px dead below board`);
  if (r.gapAbove > 60) holes.push(`${r.gapAbove}px dead above board`);
  // Coverage only matters where the HUD had somewhere else to go. When the
  // board fills the screen — landscape, tablet, desktop — the HUD overlaying
  // it is the design, not a fault; a letterboxed board is the case where a
  // panel sitting on the playfield means the layout gave up.
  if (r.board.frac < 0.8 && r.coverFrac > 0.3) {
    holes.push(`HUD covers ${Math.round(r.coverFrac*100)}% of a letterboxed board`);
  }
  const ok = !r.hits.length && !r.off && !errs.length && !holes.length;
  if (!ok) bad++;
  console.log(`${ok?'ok  ':'FAIL'} ${name.padEnd(10)} ${String(width).padStart(4)}x${height}` +
    `  board ${Math.round(r.board.frac*100)}%` +
    (r.hits.length?`  overlap: ${r.hits.join(' ')}`:'') +
    (holes.length?`  ${holes.join(', ')}`:'') +
    (r.off?'  preview off-screen':'') + (errs.length?`  errors: ${errs[0]}`:''));
  await page.close();
}
await b.close(); srv.close();
console.log(bad ? `\n${bad} viewport(s) failed` : '\nall viewports clear');
process.exit(bad ? 1 : 0);
