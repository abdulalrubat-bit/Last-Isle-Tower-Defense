/* Island Defence — map 1.
 *
 * One map, played to a finish: fifteen waves, a win screen, a real economy.
 *
 * Two rules this file keeps deliberately:
 *   1. Game state lives in `S`, never in the DOM. The HUD is written *from*
 *      state when state changes, and is never read back. The predecessor kept
 *      the player's energy in a <span> and parsed it on every kill, which is
 *      both slow and a save-file anyone can edit with devtools.
 *   2. An enemy's position on the path is computed once per frame and cached.
 *      Targeting used to walk the whole polyline per tower per enemy per
 *      frame — ~300 walks a frame with ten towers on screen.
 */
'use strict';

/* ---------------------------------------------------------------- map ---- */

const MAP_W = 1536, MAP_H = 864;

// Centreline traced from the road in map1.jpg by colour-keying the sand, then
// verified: every sampled point along it lands on road. Do not hand-nudge
// these without re-checking against the art.
const PATH = [
  [0,680],[210,680],[380,678],[452,664],[496,600],[528,540],[556,480],
  [596,432],[648,406],[706,414],[752,446],[800,486],[852,474],[900,462],
  [936,424],[968,362],[1000,318],[1032,276],[1064,226],[1120,204],
  [1240,202],[1340,208],[1400,236],[1464,264],[1536,272]
];

// Build pads: on grass, clear of the road, the huts and the pond, and hugging
// the verge — 66 to 118px off the centreline. That distance is the whole
// balance. An earlier set sat 92-168px out, where a 190-range tower covers
// only a ~160px sliver of road and lands two shots on a passing enemy; the
// game was unwinnable on hard for geometric reasons, not difficulty ones.
// These eleven cover 96% of the route at base range.
const PADS = [
  [70,588],[286,588],[418,564],[526,744],[610,600],[706,324],
  [886,288],[1054,120],[1078,384],[1318,300],[1390,120]
];

// Cumulative arc length, so a point lookup is a binary search rather than a
// walk from the start of the path.
const SEG = [];
let PATH_LEN = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const [ax, ay] = PATH[i], [bx, by] = PATH[i + 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  SEG.push({ ax, ay, dx, dy, len, start: PATH_LEN, angle: Math.atan2(dy, dx) });
  PATH_LEN += len;
}

function pointAt(dist) {
  if (dist <= 0) { const s = SEG[0]; return { x: s.ax, y: s.ay, angle: s.angle }; }
  if (dist >= PATH_LEN) {
    const s = SEG[SEG.length - 1];
    return { x: s.ax + s.dx, y: s.ay + s.dy, angle: s.angle };
  }
  let lo = 0, hi = SEG.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SEG[mid].start <= dist) lo = mid; else hi = mid - 1;
  }
  const s = SEG[lo], t = (dist - s.start) / s.len;
  return { x: s.ax + s.dx * t, y: s.ay + s.dy * t, angle: s.angle };
}

/* ------------------------------------------------------------- balance --- */

// Costs and damage are simulation-checked, not guessed: tools/sim runs five
// build strategies to wave 15 on every difficulty. Two findings shaped these
// numbers. A two-target chain made lightning strictly the best tower at any
// price — it beat every other opening on both difficulties — so it chains once
// and costs more. And an ice/arcane opening used to lose by wave 3, because
// both were priced as damage towers while dealing almost none; they are
// cheaper now and hit hard enough to hold a lane on their own.
const TOWERS = {
  fire:   { name:'FIRE TOWER',      art:'tower_fire.png',   cost:100,
            dmg:24, rate:700,  range:190, shot:520, colour:'#ff9b38' },
  ice:    { name:'ICE TOWER',       art:'tower_ice.png',    cost:110,
            dmg:15, rate:800,  range:180, shot:500, colour:'#8deaff',
            slow:0.50, slowFor:1600 },
  bolt:   { name:'LIGHTNING TOWER', art:'tower_bolt.png',   cost:165,
            dmg:46, rate:1100, range:225, shot:900, colour:'#ffe34d',
            chain:1, chainRange:150, chainFalloff:0.55 },
  arcane: { name:'ARCANE TOWER',    art:'tower_arcane.png', cost:155,
            dmg:21, rate:620,  range:200, shot:470, colour:'#b86cff',
            splash:88 },
};
const TOWER_ORDER = ['fire', 'ice', 'bolt', 'arcane'];

// Three tracks, three levels each. Cards, not a single ladder — the panel has
// always shown three choices, so they are now three actual choices.
const TRACKS = {
  dmg:   { label:'DAMAGE', art:'card_damage.png', step:0.30 },
  range: { label:'RANGE',  art:'card_range.png',  step:0.18 },
  rate:  { label:'FIRE\nRATE', art:'card_rate.png', step:0.15 },
};
const TRACK_ORDER = ['dmg', 'range', 'rate'];
const MAX_TRACK = 3;

function upgradeCost(tower, track) {
  const lvl = tower.up[track];
  return Math.round(TOWERS[tower.type].cost * 0.55 * Math.pow(1.65, lvl));
}

const KINDS = {
  grunt:  { hp:1,    speed:1,    size:76,  reward:1,   tint:null },
  runner: { hp:0.55, speed:1.75, size:64,  reward:1,   tint:'#7dff8a' },
  brute:  { hp:3.2,  speed:0.68, size:104, reward:2.4, tint:'#ff6a4d' },
  boss:   { hp:16,   speed:0.55, size:148, reward:9,   tint:'#c46bff' },
};

// Fifteen waves and then it is over. A tower defence you cannot finish is a
// score attack wearing a campaign's clothes.
const WAVES = [
  { grunt:8 },
  { grunt:12 },
  { grunt:10, runner:4 },
  { grunt:12, runner:6 },
  { grunt:10, brute:2 },
  { grunt:14, runner:8 },
  { grunt:12, runner:4, brute:3 },
  { grunt:16, runner:10 },
  { grunt:10, brute:5 },
  { grunt:8,  boss:1 },
  { grunt:18, runner:12 },
  { grunt:14, brute:6 },
  { grunt:16, runner:14, brute:4 },
  { grunt:20, runner:10, brute:8 },
  { grunt:12, brute:6,   boss:2 },
];

// Starting energy is deliberately the same order on all three: it must buy an
// opening of three towers everywhere. Difficulty is the enemies and the life
// buffer, not an opening you cannot afford — starting hard at two towers made
// it unwinnable by wave 2 regardless of skill, which is a cliff, not a curve.
const DIFF = {
  easy:   { hp:0.85, speed:0.92, energy:440, lives:25, label:'EASY' },
  normal: { hp:1.00, speed:1.00, energy:410, lives:20, label:'NORMAL' },
  hard:   { hp:1.18, speed:1.00, energy:390, lives:16, label:'HARD' },
};

const REST_MS = 20000;   // breathing room between waves before auto-start

/* --------------------------------------------------------------- state --- */

const S = {
  screen: 'boot',        // boot | menu | diff | play | result
  diff: 'normal',
  running: false,        // simulation ticking (false while an overlay is up)
  speed: 1,
  energy: 0, lives: 0, score: 0,
  wave: 0,
  phase: 'ready',        // ready | spawning | clearing | done
  restLeft: 0,
  queue: [],             // enemy kinds still to spawn this wave
  spawnIn: 0,
  towers: [], enemies: [], shots: [], fx: [],
  selectedType: 'fire',
  openTower: null,
  time: 0,
  dirty: true,
};

const SAVE_KEY = 'islanddefence.v1';
const save = Object.assign(
  { gems: 0, best: null, music: true, sound: true },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
           catch (_) { return {}; } })()
);
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
}

/* -------------------------------------------------------------- assets --- */

const IMG = {};
const ASSET_NAMES = [
  'map1.jpg','menu_bg.jpg',
  'tower_fire.png','tower_ice.png','tower_bolt.png','tower_arcane.png',
  'btn_music.png','btn_music_off.png','btn_sound.png','btn_sound_off.png',
];
for (let i = 0; i < 10; i++) ASSET_NAMES.push(`enemy_run_${i}.png`);

const bootBar = document.getElementById('bootBar');
const bootSay = document.getElementById('bootSay');

function loadAssets() {
  let done = 0;
  return Promise.all(ASSET_NAMES.map(name => new Promise(resolve => {
    const im = new Image();
    im.onload = im.onerror = () => {
      IMG[name] = im;
      done++;
      bootBar.style.width = Math.round(4 + 96 * done / ASSET_NAMES.length) + '%';
      resolve();
    };
    im.src = 'assets/' + name;
  })));
}

// One enemy sprite set exists, so variety comes from scale and colour. The
// tints are baked once at load rather than composited every frame.
const RUN_FRAMES = {};
function bakeEnemyFrames() {
  for (const kind of Object.keys(KINDS)) {
    const tint = KINDS[kind].tint;
    RUN_FRAMES[kind] = [];
    for (let i = 0; i < 10; i++) {
      const src = IMG[`enemy_run_${i}.png`];
      if (!tint || !src.naturalWidth) { RUN_FRAMES[kind].push(src); continue; }
      const c = document.createElement('canvas');
      c.width = src.naturalWidth; c.height = src.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = 0.55;
      g.fillStyle = tint;
      g.fillRect(0, 0, c.width, c.height);
      RUN_FRAMES[kind].push(c);
    }
  }
}

/* --------------------------------------------------------------- audio --- */

// Synthesised: there are no audio assets in the pack, and a few hundred bytes
// of oscillator beats shipping silence.
let ac = null;
function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) ac = new Ctx();
  }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
function sfx(type) {
  if (!save.sound) return;
  const a = audio();
  if (!a) return;
  const spec = {
    shoot: [420, 260, 0.06, 'square',   0.05],
    hit:   [200, 120, 0.07, 'triangle', 0.06],
    build: [320, 660, 0.14, 'sine',     0.10],
    sell:  [660, 240, 0.16, 'sine',     0.09],
    leak:  [240,  90, 0.30, 'sawtooth', 0.12],
    win:   [520, 980, 0.45, 'sine',     0.14],
    lose:  [300,  70, 0.70, 'sawtooth', 0.15],
  }[type];
  if (!spec) return;
  const [f0, f1, dur, wave, vol] = spec;
  const o = a.createOscillator(), g = a.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(f0, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.02);
}

/* ------------------------------------------------------------ the loop --- */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1, scale = 1, ox = 0, oy = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vv = window.visualViewport;
  const vw = vv ? vv.width : window.innerWidth;
  const vh = vv ? vv.height : window.innerHeight;
  canvas.width = Math.max(1, Math.round(vw * dpr));
  canvas.height = Math.max(1, Math.round(vh * dpr));
  scale = Math.min(vw / MAP_W, vh / MAP_H);
  ox = (vw - MAP_W * scale) / 2;
  oy = (vh - MAP_H * scale) / 2;
}
addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

function toMap(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale };
}

/* ----------------------------------------------------------- wave logic -- */

function buildQueue(spec) {
  // Interleave the kinds rather than marching them out in blocks, so a wave
  // reads as a mixed group instead of four separate mini-waves.
  const pools = Object.entries(spec).flatMap(([k, n]) => Array(n).fill(k));
  for (let i = pools.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pools[i], pools[j]] = [pools[j], pools[i]];
  }
  // Bosses last: they should arrive as the punctuation, not the opening.
  return pools.sort((a, b) => (a === 'boss' ? 1 : 0) - (b === 'boss' ? 1 : 0));
}

function startWave(manual) {
  if (S.phase !== 'ready' || S.wave >= WAVES.length) return;
  if (manual && S.restLeft > 0 && S.wave > 0) {
    const bonus = Math.round(S.restLeft / 1000) * 3;
    S.energy += bonus;
    toast(`+${bonus} ENERGY — CALLED EARLY`);
  }
  S.wave++;
  S.queue = buildQueue(WAVES[S.wave - 1]);
  S.phase = 'spawning';
  S.spawnIn = 0;
  S.restLeft = 0;
  S.dirty = true;
}

function spawnInterval() {
  return Math.max(280, 820 - S.wave * 34);
}

function spawn(kind) {
  const k = KINDS[kind], d = DIFF[S.diff];
  const hp = (66 + S.wave * 30) * k.hp * d.hp;
  S.enemies.push({
    kind, dist: 0, hp, maxHp: hp,
    speed: (PATH_LEN / 22) * k.speed * d.speed,
    slowUntil: 0, slowFactor: 1,
    reward: Math.round((7 + S.wave * 1.6) * k.reward),
    anim: Math.random() * 1000,
    x: 0, y: 0, angle: 0,
  });
}

function waveCleared() {
  const bonus = 40 + S.wave * 12;
  S.energy += bonus;
  save.gems += 1;
  persist();
  if (S.wave >= WAVES.length) { finish(true); return; }
  S.phase = 'ready';
  S.restLeft = REST_MS;
  toast(`WAVE ${S.wave} CLEARED  ·  +${bonus} ENERGY`);
  S.dirty = true;
}

function finish(won) {
  S.phase = 'done';
  S.running = false;
  const d = DIFF[S.diff];
  const stars = !won ? 0
    : S.lives >= d.lives * 0.9 ? 3
    : S.lives >= d.lives * 0.55 ? 2 : 1;
  if (won) {
    save.gems += 5;
    const prev = save.best;
    if (!prev || stars > prev.stars) save.best = { stars, diff: S.diff };
    persist();
  }
  sfx(won ? 'win' : 'lose');
  showResult(won, stars);
}

/* ------------------------------------------------------------- combat ---- */

function damage(e, amount) {
  if (e.hp <= 0) return;
  e.hp -= amount;
  if (e.hp <= 0) {
    S.energy += e.reward;
    S.score += e.reward;
    S.dirty = true;
  }
}

function splash(x, y, radius, dmg, source) {
  for (const e of S.enemies) {
    if (e.hp <= 0 || e === source) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= radius) damage(e, dmg * (1 - 0.5 * d / radius));
  }
  S.fx.push({ kind: 'ring', x, y, r: radius, ttl: 240, life: 240 });
}

function chain(from, first, def, dmg) {
  let cur = first, power = dmg, prev = { x: from.x, y: from.y - 40 };
  const hit = new Set([first]);
  for (let i = 0; i < def.chain; i++) {
    let next = null, best = def.chainRange;
    for (const e of S.enemies) {
      if (e.hp <= 0 || hit.has(e)) continue;
      const d = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (d < best) { best = d; next = e; }
    }
    if (!next) break;
    power *= def.chainFalloff;
    damage(next, power);
    hit.add(next);
    S.fx.push({ kind:'arc', x1:cur.x, y1:cur.y, x2:next.x, y2:next.y, ttl:140, life:140 });
    prev = cur; cur = next;
  }
}

/* ------------------------------------------------------------- update ---- */

function update(dt) {
  S.time += dt;

  if (S.phase === 'ready' && S.restLeft > 0 && S.wave > 0) {
    S.restLeft -= dt;
    if (S.restLeft <= 0) startWave(false);
  }

  if (S.phase === 'spawning') {
    S.spawnIn -= dt;
    while (S.spawnIn <= 0 && S.queue.length) {
      spawn(S.queue.shift());
      S.spawnIn += spawnInterval();
    }
    if (!S.queue.length) S.phase = 'clearing';
  }

  // One polyline lookup per enemy per frame; everything downstream reads the
  // cached x/y.
  for (const e of S.enemies) {
    if (e.hp <= 0) continue;
    const factor = S.time < e.slowUntil ? e.slowFactor : 1;
    e.dist += e.speed * factor * dt / 1000;
    const p = pointAt(e.dist);
    e.x = p.x; e.y = p.y; e.angle = p.angle;
    if (e.dist >= PATH_LEN) {
      e.hp = 0;
      e.leaked = true;
      S.lives--;
      S.dirty = true;
      sfx('leak');
      if (S.lives <= 0) { S.lives = 0; finish(false); return; }
    }
  }

  for (const t of S.towers) {
    t.cool = Math.max(0, t.cool - dt);
    const range = towerRange(t);
    let target = null, furthest = -1;
    for (const e of S.enemies) {
      if (e.hp <= 0) continue;
      if (e.dist > furthest && Math.hypot(t.x - e.x, t.y - e.y) <= range) {
        furthest = e.dist; target = e;
      }
    }
    if (!target) continue;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (t.cool > 0) continue;
    const def = TOWERS[t.type];
    S.shots.push({
      x: t.x, y: t.y - 40, target, from: t,
      speed: def.shot, dmg: towerDamage(t), type: t.type,
    });
    t.cool = towerRate(t);
    sfx('shoot');
  }

  for (const s of S.shots) {
    const e = s.target;
    if (!e || e.hp <= 0) { s.dead = true; continue; }
    const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
    const step = s.speed * dt / 1000;
    if (d <= step + 12) {
      const def = TOWERS[s.type];
      damage(e, s.dmg);
      if (def.slow) { e.slowUntil = S.time + def.slowFor; e.slowFactor = def.slow; }
      if (def.splash) splash(e.x, e.y, def.splash, s.dmg * 0.7, e);
      if (def.chain) chain(s.from, e, def, s.dmg);
      sfx('hit');
      s.dead = true;
    } else {
      s.x += dx / d * step;
      s.y += dy / d * step;
    }
  }

  for (const f of S.fx) f.ttl -= dt;

  S.shots = S.shots.filter(s => !s.dead);
  S.fx = S.fx.filter(f => f.ttl > 0);
  const before = S.enemies.length;
  S.enemies = S.enemies.filter(e => e.hp > 0);
  if (S.enemies.length !== before) S.dirty = true;

  if (S.phase === 'clearing' && !S.enemies.length) waveCleared();
}

function towerRange(t)  { return TOWERS[t.type].range * (1 + TRACKS.range.step * t.up.range); }
function towerDamage(t) { return TOWERS[t.type].dmg   * (1 + TRACKS.dmg.step   * t.up.dmg); }
function towerRate(t)   { return Math.max(180, TOWERS[t.type].rate * Math.pow(1 - TRACKS.rate.step, t.up.rate)); }
function towerLevel(t)  { return 1 + t.up.dmg + t.up.range + t.up.rate; }

/* ------------------------------------------------------------- render ---- */

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vw = canvas.width / dpr, vh = canvas.height / dpr;
  ctx.fillStyle = '#12180d';
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, MAP_W, MAP_H);
  ctx.clip();

  const map = IMG['map1.jpg'];
  if (map && map.naturalWidth) ctx.drawImage(map, 0, 0, MAP_W, MAP_H);

  drawPads();
  drawTowers();
  drawEnemies();
  drawShots();
  drawFx();

  ctx.restore();
}

function drawPads() {
  const def = TOWERS[S.selectedType];
  const affordable = S.energy >= def.cost;
  for (let i = 0; i < PADS.length; i++) {
    if (S.towers.some(t => t.pad === i)) continue;
    const [x, y] = PADS[i];
    ctx.beginPath();
    ctx.arc(x, y, 38, 0, Math.PI * 2);
    ctx.fillStyle = affordable ? 'rgba(255,214,65,.17)' : 'rgba(120,120,120,.14)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = affordable ? 'rgba(255,235,120,.8)' : 'rgba(190,190,190,.42)';
    ctx.stroke();
    ctx.fillStyle = affordable ? 'rgba(255,246,196,.95)' : 'rgba(220,220,220,.5)';
    ctx.font = '900 22px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y + 1);

    // Show what the selected tower would actually cover before committing.
    if (affordable) {
      ctx.beginPath();
      ctx.arc(x, y, def.range, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawTowers() {
  for (const t of S.towers) {
    if (t === S.openTower) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, towerRange(t), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,211,77,.10)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,211,77,.65)';
      ctx.stroke();
    }
    const im = IMG[TOWERS[t.type].art];
    if (!im || !im.naturalWidth) continue;
    const s = Math.min(132 / im.naturalWidth, 132 / im.naturalHeight);
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.drawImage(im, t.x - w / 2, t.y + 10 - h, w, h);

    const lvl = towerLevel(t);
    if (lvl > 1) {
      ctx.fillStyle = 'rgba(20,12,6,.82)';
      ctx.beginPath();
      ctx.arc(t.x + 26, t.y + 4, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d8b56a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffe8a3';
      ctx.font = '900 15px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(lvl), t.x + 26, t.y + 5);
    }
  }
}

function drawEnemies() {
  for (const e of S.enemies) {
    const k = KINDS[e.kind];
    const frames = RUN_FRAMES[e.kind];
    const frame = frames && frames[Math.floor((S.time + e.anim) / 85) % frames.length];
    if (!frame) continue;
    const fw = frame.naturalWidth || frame.width;
    const fh = frame.naturalHeight || frame.height;
    if (!fw) continue;
    const s = k.size / fh;
    const flip = Math.abs(e.angle) > Math.PI / 2;

    ctx.save();
    ctx.translate(e.x, e.y);
    if (S.time < e.slowUntil) {
      ctx.shadowColor = '#8deaff';
      ctx.shadowBlur = 14;
    }
    ctx.scale(flip ? -s : s, s);
    ctx.drawImage(frame, -fw / 2, -fh / 2, fw, fh);
    ctx.restore();

    const w = Math.max(34, k.size * 0.6), top = e.y - k.size / 2 - 9;
    ctx.fillStyle = '#24150d';
    ctx.fillRect(e.x - w / 2, top, w, 6);
    ctx.fillStyle = e.kind === 'boss' ? '#c46bff' : '#e94332';
    ctx.fillRect(e.x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), 6);
  }
}

function drawShots() {
  for (const s of S.shots) {
    const colour = TOWERS[s.type].colour;
    ctx.save();
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawFx() {
  for (const f of S.fx) {
    const k = f.ttl / f.life;
    ctx.save();
    if (f.kind === 'ring') {
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#b86cff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.15 - k * 0.55), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffe34d';
      ctx.shadowColor = '#ffe34d';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(f.x1, f.y1);
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- HUD ---- */

const el = id => document.getElementById(id);
const hud = el('hud');
const slotsWrap = el('towerSlots');

function buildSlots() {
  slotsWrap.innerHTML = '';
  for (const type of TOWER_ORDER) {
    const def = TOWERS[type];
    const b = document.createElement('button');
    b.className = 'slot' + (type === S.selectedType ? ' selected' : '');
    b.dataset.type = type;
    b.setAttribute('aria-label', def.name + ', ' + def.cost + ' energy');
    b.innerHTML = `<img src="assets/${def.art}" alt=""><span class="cost">${def.cost}</span>`;
    b.addEventListener('click', () => {
      S.selectedType = type;
      for (const s of slotsWrap.children) s.classList.toggle('selected', s === b);
      audio();
    });
    slotsWrap.appendChild(b);
  }
}

let toastTimer = 0;
function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

function syncHud() {
  if (!S.dirty) return;
  S.dirty = false;
  el('sEnergy').textContent = Math.floor(S.energy);
  el('sLives').textContent = S.lives;
  el('sGems').textContent = save.gems;
  el('sScore').textContent = S.score;
  el('waveLabel').textContent = `WAVE ${Math.max(1, S.wave)}/${WAVES.length}`;
  el('enemyCount').textContent = 'ENEMIES ' + (S.enemies.length + S.queue.length);
  for (const s of slotsWrap.children) {
    s.classList.toggle('poor', S.energy < TOWERS[s.dataset.type].cost);
  }
  const canStart = S.phase === 'ready' && S.wave < WAVES.length;
  el('startWave').disabled = !canStart;
}

// The countdown ticks every frame, so it is written separately from the
// change-driven HUD above.
function syncWaveState() {
  const st = el('waveState');
  if (S.phase === 'ready' && S.wave === 0) st.textContent = 'TAP START';
  else if (S.phase === 'ready') st.textContent = 'NEXT IN ' + Math.ceil(S.restLeft / 1000) + 's';
  else if (S.phase === 'spawning') st.textContent = 'INCOMING';
  else if (S.phase === 'clearing') st.textContent = 'CLEAR THEM OUT';
  else st.textContent = 'DONE';
}

/* ------------------------------------------------------------ overlays --- */

function show(id, on) { el(id).classList.toggle('show', on); }

function openUpgrade(t) {
  S.openTower = t;
  S.running = false;
  renderUpgrade();
  show('upgradeOverlay', true);
}
function closeUpgrade() {
  S.openTower = null;
  show('upgradeOverlay', false);
  if (S.phase !== 'done') S.running = true;
}

function renderUpgrade() {
  const t = S.openTower;
  if (!t) return;
  el('upgradeName').textContent = TOWERS[t.type].name;
  el('upgradeMeta').textContent =
    `LEVEL ${towerLevel(t)}  ·  DMG ${Math.round(towerDamage(t))}  ·  ` +
    `RNG ${Math.round(towerRange(t))}  ·  ${(1000 / towerRate(t)).toFixed(1)}/s`;

  const wrap = el('upgradeCards');
  wrap.innerHTML = '';
  for (const key of TRACK_ORDER) {
    const track = TRACKS[key];
    const lvl = t.up[key];
    const maxed = lvl >= MAX_TRACK;
    const cost = upgradeCost(t, key);
    const afford = S.energy >= cost;

    const b = document.createElement('button');
    b.className = 'upCard';
    b.disabled = maxed || !afford;
    const pips = Array.from({ length: MAX_TRACK },
      (_, i) => i < lvl ? '<span>●</span>' : '<span class="off">●</span>').join('');
    b.innerHTML =
      `<img src="assets/${track.art}" alt="">` +
      `<span class="lbl">${track.label.replace('\n', '<br>')}</span>` +
      `<span class="pips">${pips}</span>` +
      `<span class="buy">${maxed ? 'MAX' : cost}</span>`;
    b.addEventListener('click', () => {
      if (maxed || S.energy < cost) return;
      S.energy -= cost;
      t.spent += cost;
      t.up[key]++;
      S.dirty = true;
      sfx('build');
      renderUpgrade();
    });
    wrap.appendChild(b);
  }
}

function showResult(won, stars) {
  el('resultHdr').src = won ? 'assets/hdr_victory.png' : 'assets/hdr_failed.png';
  el('resultMsg').innerHTML = won
    ? 'ISLAND HELD'
    : `SORRY :(<br>THE ROAD FELL AT WAVE ${S.wave}`;
  // The failure art fills the window on a loss; on a win the same space gets
  // the run's figures, which is the thing a player actually wants to read.
  el('resultArt').style.display = won ? 'none' : '';
  el('resultStars').innerHTML = won
    ? Array.from({ length: 3 },
        (_, i) => i < stars ? '★' : '<span class="off">★</span>').join('')
    : '';
  const d = DIFF[S.diff];
  el('resultStats').innerHTML = won
    ? [['DIFFICULTY', d.label], ['SCORE', S.score],
       ['LIVES LEFT', `${S.lives}/${d.lives}`], ['TOWERS BUILT', S.towers.length],
       ['GEMS EARNED', WAVES.length + 5]]
      .map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')
    : '';
  show('resultOverlay', true);
}

/* --------------------------------------------------------------- flow ---- */

function newRun(diff) {
  S.diff = diff;
  const d = DIFF[diff];
  S.energy = d.energy;
  S.lives = d.lives;
  S.score = 0;
  S.wave = 0;
  S.phase = 'ready';
  S.restLeft = 0;
  S.queue = [];
  S.towers = []; S.enemies = []; S.shots = []; S.fx = [];
  S.openTower = null;
  S.selectedType = 'fire';
  S.speed = 1;
  S.time = 0;
  S.dirty = true;
  S.screen = 'play';
  S.running = true;
  buildSlots();
  updateSpeedButton();
  hud.classList.remove('hide');
  show('menu', false);
  show('diffOverlay', false);
  show('resultOverlay', false);
  show('upgradeOverlay', false);
  el('pause').innerHTML = '&#10073;&#10073;';
}

function toMenu() {
  S.screen = 'menu';
  S.running = false;
  hud.classList.add('hide');
  show('resultOverlay', false);
  show('upgradeOverlay', false);
  show('diffOverlay', false);
  show('menu', true);
  syncMenu();
}

function syncMenu() {
  const b = save.best;
  el('menuBest').textContent = b
    ? `BEST: ${'★'.repeat(b.stars)} ON ${DIFF[b.diff].label}  ·  ${save.gems} GEMS`
    : `${save.gems} GEMS`;
}

function updateSpeedButton() {
  el('callWave').querySelector('.lbl').textContent = S.speed === 1 ? '1×' : '2×';
}

/* -------------------------------------------------------------- input ---- */

function tapBoard(clientX, clientY) {
  if (S.screen !== 'play' || !S.running) return;
  const p = toMap(clientX, clientY);

  const hit = S.towers.find(t => Math.hypot(p.x - t.x, p.y - t.y) < 74);
  if (hit) { openUpgrade(hit); return; }

  let pick = -1, best = 64;
  for (let i = 0; i < PADS.length; i++) {
    if (S.towers.some(t => t.pad === i)) continue;
    const d = Math.hypot(p.x - PADS[i][0], p.y - PADS[i][1]);
    if (d < best) { best = d; pick = i; }
  }
  if (pick < 0) return;

  const def = TOWERS[S.selectedType];
  if (S.energy < def.cost) { toast('NOT ENOUGH ENERGY'); return; }
  S.energy -= def.cost;
  S.towers.push({
    x: PADS[pick][0], y: PADS[pick][1], pad: pick, type: S.selectedType,
    up: { dmg: 0, range: 0, rate: 0 }, spent: def.cost, cool: 260, angle: 0,
  });
  S.dirty = true;
  sfx('build');
}

canvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  audio();                       // first gesture unlocks WebAudio
  tapBoard(e.clientX, e.clientY);
}, { passive: false });

el('pause').addEventListener('click', () => {
  if (S.phase === 'done' || S.openTower) return;
  S.running = !S.running;
  el('pause').innerHTML = S.running ? '&#10073;&#10073;' : '&#9654;';
});

el('startWave').addEventListener('click', () => { audio(); startWave(true); });

el('callWave').addEventListener('click', () => {
  S.speed = S.speed === 1 ? 2 : 1;
  updateSpeedButton();
});

el('upgradeClose').addEventListener('click', closeUpgrade);
el('upgradeDone').addEventListener('click', closeUpgrade);
el('upgradeSell').addEventListener('click', () => {
  const t = S.openTower;
  if (!t) return;
  S.energy += Math.round(t.spent * 0.7);
  S.towers = S.towers.filter(x => x !== t);
  S.dirty = true;
  sfx('sell');
  closeUpgrade();
});

el('menuPlay').addEventListener('click', () => { audio(); show('diffOverlay', true); });
for (const b of document.querySelectorAll('.diffBtn')) {
  b.addEventListener('click', () => newRun(b.dataset.diff));
}
el('resultRetry').addEventListener('click', () => newRun(S.diff));
el('resultMenu').addEventListener('click', toMenu);

el('btnMusic').addEventListener('click', e => {
  save.music = !save.music;
  persist();
  e.currentTarget.querySelector('img').src =
    'assets/' + (save.music ? 'btn_music.png' : 'btn_music_off.png');
});
el('btnSound').addEventListener('click', e => {
  save.sound = !save.sound;
  persist();
  e.currentTarget.querySelector('img').src =
    'assets/' + (save.sound ? 'btn_sound.png' : 'btn_sound_off.png');
  if (save.sound) sfx('build');
});

addEventListener('keydown', e => {
  if (e.key === ' ') { e.preventDefault(); el('pause').click(); }
  if (e.key === 'Enter') startWave(true);
  const n = Number(e.key);
  if (n >= 1 && n <= TOWER_ORDER.length) slotsWrap.children[n - 1].click();
});

// A backgrounded tab should not resume to a pile of accumulated damage.
addEventListener('visibilitychange', () => {
  if (document.hidden && S.running) { S.running = false; el('pause').innerHTML = '&#9654;'; }
});

/* --------------------------------------------------------------- boot ---- */

let last = 0;
function frame(now) {
  const raw = last ? now - last : 16;
  last = now;
  if (S.running) {
    // Clamp, then step at most 33ms at a time so 2× speed stays stable.
    const total = Math.min(50, raw) * S.speed;
    let left = total;
    while (left > 0) { const step = Math.min(33, left); update(step); left -= step; }
  }
  if (S.screen === 'play') { syncHud(); syncWaveState(); render(); }
  requestAnimationFrame(frame);
}

resize();
loadAssets().then(() => {
  bakeEnemyFrames();
  bootSay.textContent = 'ready';
  el('btnMusic').querySelector('img').src =
    'assets/' + (save.music ? 'btn_music.png' : 'btn_music_off.png');
  el('btnSound').querySelector('img').src =
    'assets/' + (save.sound ? 'btn_sound.png' : 'btn_sound_off.png');
  const boot = el('boot');
  boot.classList.add('out');
  setTimeout(() => boot.remove(), 450);
  toMenu();
  requestAnimationFrame(frame);
});
