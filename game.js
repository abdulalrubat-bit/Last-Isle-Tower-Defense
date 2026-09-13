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

/* ------------------------------------------------------------- campaign --- */

const MAP_W = 1536, MAP_H = 864;

// A level is data. The control points are sampled into the road the player
// sees AND the line the enemies walk — one array, so they cannot disagree.
// Build pads are derived from that road at a fixed offset rather than listed,
// which is what stopped them drifting to a distance that broke the balance.
// See map.js. No level here costs a single byte of image.
//
// `hp` ramps the campaign. Path length and pad count already vary the
// difficulty a lot — a longer road means more time in range, so it plays
// easier — so these are set from what tools/sim.mjs measures, not by eye.
const LEVELS = [
  { id:'landing', name:'FIRST LANDING', palette:'meadow', hp:1.00, seed:20260912,
    props:300, decor:620,
    control:[[-40,700],[240,690],[430,640],[520,500],[660,430],[860,470],
             [980,380],[1010,240],[1200,190],[1400,230],[1580,300]],
    water:[{x:1210,y:585,rx:185,ry:80,rot:-.08}] },

  { id:'palmrun', name:'THE LONG MEADOW', palette:'meadow', hp:1.06, seed:5514,
    props:320, decor:640, padGap:170,
    control:[[-40,240],[210,220],[390,330],[430,540],[620,660],[830,600],
             [890,420],[1060,300],[1270,330],[1400,520],[1580,620]],
    water:[{x:250,y:660,rx:150,ry:66,rot:.12}] },

  { id:'deepwood', name:'DUST ROAD', palette:'desert', hp:1.07, seed:7712,
    props:340, decor:640, padGap:180,
    control:[[-40,180],[220,200],[400,320],[420,520],[600,640],[820,600],
             [900,430],[1080,330],[1290,380],[1420,560],[1580,660]],
    water:[{x:290,y:700,rx:145,ry:66,rot:.1},{x:1190,y:150,rx:118,ry:56,rot:-.2}] },

  { id:'millpond', name:'MILLPOND', palette:'frost', hp:1.05, seed:41009,
    props:300, decor:600, padGap:186,
    control:[[-40,620],[220,640],[420,560],[500,380],[700,300],[900,380],
             [1000,560],[1180,640],[1360,560],[1460,380],[1580,300]],
    water:[{x:700,y:640,rx:175,ry:76,rot:0},{x:1180,y:200,rx:130,ry:60,rot:.15}] },

  { id:'frostgate', name:'FROSTGATE', palette:'frost', hp:1.07, seed:33144,
    props:260, decor:520, padGap:190,
    control:[[-40,430],[200,440],[340,300],[540,250],[700,360],[760,570],
             [950,660],[1150,590],[1240,400],[1420,330],[1580,380]],
    water:[{x:520,y:700,rx:160,ry:70,rot:.05}] },

  { id:'longroad', name:'ASHFALL', palette:'ash', hp:1.11, seed:88231,
    props:280, decor:560, padGap:216,
    control:[[-40,160],[180,180],[300,360],[240,560],[380,700],[620,700],
             [740,540],[700,340],[860,220],[1080,240],[1180,420],[1120,620],
             [1300,720],[1480,620],[1580,440]],
    water:[{x:980,y:700,rx:140,ry:62,rot:-.1}] },
];

const levelById = id => LEVELS.findIndex(l => l.id === id);

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

// `size` is the drawn height in map pixels and is the main thing telling the
// player what is coming, so the four are deliberately far apart.
const KINDS = {
  grunt:  { hp:1,    speed:1,    size:82,  reward:1 },
  runner: { hp:0.55, speed:1.75, size:68,  reward:1 },
  brute:  { hp:3.2,  speed:0.68, size:112, reward:2.4 },
  boss:   { hp:16,   speed:0.55, size:158, reward:9 },
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
  hard:   { hp:1.12, speed:1.00, energy:390, lives:18, label:'HARD' },
};

// Enemies move at a fixed speed in map pixels per second, NOT at a speed
// normalised to cross any road in the same time. Normalising was hiding the
// maps from the balance: with every crossing pinned to 22 seconds, a 3000px
// road and a 1900px one played identically, and the simulation duly reported
// six levels with the same result to the wave. Fixed speed makes road length
// mean something — a longer road is more seconds under fire, so it is easier,
// and a level pays for its length with fewer build pads.
const BASE_SPEED = 87;

const REST_MS = 20000;   // breathing room between waves before auto-start

/* --------------------------------------------------------------- state --- */

const S = {
  screen: 'boot',        // boot | menu | levels | diff | play | result
  diff: 'normal',
  level: 0,              // index into LEVELS
  map: null,             // built level: path, pads, arc lengths
  baked: null,           // the map composited once into an offscreen canvas
  running: false,        // simulation ticking (false while an overlay is up)
  speed: 1,
  energy: 0, lives: 0, score: 0,
  wave: 0,
  phase: 'ready',        // ready | spawning | clearing | done
  restLeft: 0,
  queue: [],             // enemy kinds still to spawn this wave
  spawnIn: 0,
  towers: [], enemies: [], shots: [], fx: [], corpses: [],
  selectedType: 'fire',
  openTower: null,
  time: 0,
  dirty: true,
};

const SAVE_KEY = 'islanddefence.v2';
const save = Object.assign(
  // stars: { levelId: 0-3 }. A level is unlocked once the one before it has
  // any stars at all, so a player who scrapes a win is never stuck.
  { gems: 0, stars: {}, music: true, sound: true },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
           catch (_) { return {}; } })()
);
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
}

/* -------------------------------------------------------------- assets --- */

const IMG = {};
const ASSET_NAMES = [
  'tower_fire.png','tower_ice.png','tower_bolt.png','tower_arcane.png',
  'btn_music.png','btn_music_off.png','btn_sound.png','btn_sound_off.png',
];

// Per-kind enemy art, built by tools/build-enemies.py from the pack's
// animation folders. A kind set to null is drawn by enemies.js instead.
// Real art, from the pack: ten enemy types, seven animations, twenty frames
// each. Four are used, chosen so their silhouettes cannot be confused —
// goblin, scorpion, ogre, horned demon.
//
// Each animation is ONE sprite sheet, frames laid out left to right. Eighty
// loose frames would be eighty requests; this is eight. null for a kind falls
// back to the version enemies.js draws, which is what shipped before the art
// arrived and is still what runs if a sheet is missing.
const ENEMY_ART = {
  grunt:  { walk:'enemy_grunt_walk.png',  die:'enemy_grunt_die.png',  walkN:10, dieN:8 },
  runner: { walk:'enemy_runner_walk.png', die:'enemy_runner_die.png', walkN:10, dieN:8 },
  brute:  { walk:'enemy_brute_walk.png',  die:'enemy_brute_die.png',  walkN:10, dieN:8 },
  boss:   { walk:'enemy_boss_walk.png',   die:'enemy_boss_die.png',   walkN:10, dieN:8 },
};
const DIE_MS = 700;

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

// Animations are { img, fw, fh, count }, whether loaded or drawn.
const RUN_FRAMES = {}, DIE_FRAMES = {};

function loadSheet(file, count) {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth
      ? { img: im, fw: im.naturalWidth / count, fh: im.naturalHeight, count }
      : null);
    im.onerror = () => resolve(null);      // absent is a state, not an error
    im.src = 'assets/' + file;
  });
}

// The painted map layers. Everything that draws terrain waits on this, so it
// resolves rather than rejects when absent: no atlas means the drawn terrain,
// which is a complete fallback rather than a broken board.
function loadPropAtlas() {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth) setPropAtlas(im, makeCanvas);
      resolve();
    };
    im.onerror = () => resolve();
    im.src = 'assets/props.png';
  });
}

function loadEnemyArt() {
  return Promise.all(Object.keys(KINDS).map(kind => {
    const set = ENEMY_ART[kind];
    if (!set) return Promise.resolve();
    return Promise.all([
      loadSheet(set.walk, set.walkN),
      set.die ? loadSheet(set.die, set.dieN) : Promise.resolve(null),
    ]).then(([walk, die]) => {
      if (walk) RUN_FRAMES[kind] = walk;
      if (die) DIE_FRAMES[kind] = die;
    });
  }));
}

function bakeEnemyFrames() {
  const drawn = bakeEnemySprites(KINDS, makeCanvas);
  for (const kind of Object.keys(KINDS)) {
    if (!RUN_FRAMES[kind]) RUN_FRAMES[kind] = drawn[kind];
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
  const hp = (66 + S.wave * 30) * k.hp * d.hp * LEVELS[S.level].hp;
  S.enemies.push({
    kind, dist: 0, hp, maxHp: hp,
    speed: BASE_SPEED * k.speed * d.speed,
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
    const id = LEVELS[S.level].id;
    // Keep the best result for a level, never overwrite it with a worse one.
    save.stars[id] = Math.max(save.stars[id] || 0, stars);
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
    // The pack ships a death animation per enemy, so a kill is worth showing.
    // Corpses are display-only: off the path, un-targetable, gone in DIE_MS.
    S.corpses.push({ kind: e.kind, x: e.x, y: e.y, angle: e.angle, t: 0 });
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
    const p = pathPointAt(S.map, e.dist);
    e.x = p.x; e.y = p.y; e.angle = p.angle;
    if (e.dist >= S.map.length) {
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
  for (const c of S.corpses) c.t += dt;
  S.corpses = S.corpses.filter(c => c.t < DIE_MS);

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

  // One drawImage for the whole board. The map was composited into this
  // canvas once when the level started; three hundred props cost nothing here.
  if (S.baked) ctx.drawImage(S.baked, 0, 0, MAP_W, MAP_H);

  drawPads();
  drawCorpses();
  drawTowers();
  drawEnemies();
  drawShots();
  drawFx();

  ctx.restore();
}

function drawPads() {
  const def = TOWERS[S.selectedType];
  const affordable = S.energy >= def.cost;
  const pads = S.map.pads;
  for (let i = 0; i < pads.length; i++) {
    if (S.towers.some(t => t.pad === i)) continue;
    const [x, y] = pads[i];
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

// `anim` is { img, fw, fh, count } from either a loaded sheet or enemies.js.
// Feet sit a little below the centreline so a figure stands on the road
// rather than hovering over it.
function blitEnemy(anim, kind, x, y, angle, frame) {
  const size = KINDS[kind].size;
  const s = size / anim.fh;
  const w = anim.fw * s, h = size;
  const i = Math.min(anim.count - 1, Math.max(0, frame));
  ctx.save();
  ctx.translate(x, y + size * 0.20);
  ctx.scale(Math.abs(angle) > Math.PI / 2 ? -s : s, s);
  ctx.drawImage(anim.img, i * anim.fw, 0, anim.fw, anim.fh,
                -anim.fw / 2, -anim.fh, anim.fw, anim.fh);
  ctx.restore();
  return { w, h };
}

function drawCorpses() {
  for (const c of S.corpses) {
    const k = c.t / DIE_MS;
    const anim = DIE_FRAMES[c.kind];
    ctx.save();
    ctx.globalAlpha = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
    if (anim) {
      blitEnemy(anim, c.kind, c.x, c.y, c.angle, Math.floor(k * anim.count));
    } else {
      // No death sheet (a drawn enemy): sink and fade the last walk frame.
      const walk = RUN_FRAMES[c.kind];
      if (walk) {
        ctx.globalAlpha *= 1 - k;
        blitEnemy(walk, c.kind, c.x, c.y + k * 10, c.angle, 0);
      }
    }
    ctx.restore();
  }
}

function drawEnemies() {
  for (const e of S.enemies) {
    const k = KINDS[e.kind];
    const anim = RUN_FRAMES[e.kind];
    if (!anim) continue;
    const step = 92 / k.speed;
    const frame = Math.floor((S.time + e.anim) / step) % anim.count;

    ctx.save();
    if (S.time < e.slowUntil) {
      ctx.shadowColor = '#8deaff';
      ctx.shadowBlur = 14;
    }
    blitEnemy(anim, e.kind, e.x, e.y, e.angle, frame);
    ctx.restore();

    const w = Math.max(34, k.size * 0.52);
    const top = e.y + k.size * 0.20 - k.size - 10;
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
  const lvl = LEVELS[S.level];
  el('resultMsg').innerHTML = won
    ? `${lvl.name}<br>HELD`
    : `SORRY :(<br>${lvl.name} FELL AT WAVE ${S.wave}`;
  // The failure art fills the window on a loss; on a win the same space gets
  // the run's figures, which is the thing a player actually wants to read.
  el('resultArt').style.display = won ? 'none' : '';
  el('resultStars').innerHTML = won
    ? Array.from({ length: 3 },
        (_, i) => i < stars ? '★' : '<span class="off">★</span>').join('')
    : '';
  const d = DIFF[S.diff];
  const nextIndex = S.level + 1;
  const hasNext = won && nextIndex < LEVELS.length;
  el('resultNext').style.display = hasNext ? '' : 'none';
  el('resultNext').onclick = hasNext
    ? () => newRun(nextIndex, S.diff) : null;
  el('resultStats').innerHTML = won
    ? [['DIFFICULTY', d.label], ['SCORE', S.score],
       ['LIVES LEFT', `${S.lives}/${d.lives}`], ['TOWERS BUILT', S.towers.length],
       ['GEMS EARNED', WAVES.length + 5]]
      .map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')
    : '';
  show('resultOverlay', true);
}

/* --------------------------------------------------------------- flow ---- */

function newRun(levelIndex, diff) {
  S.level = levelIndex;
  S.diff = diff;
  // Build the geometry, then composite the map once. Everything after this
  // reads S.map for the path and pads and blits S.baked for the picture.
  S.map = buildLevel(LEVELS[levelIndex], MAP_W, MAP_H);
  S.baked = renderLevel(S.map, makeCanvas);
  const d = DIFF[diff];
  S.energy = d.energy;
  S.lives = d.lives;
  S.score = 0;
  S.wave = 0;
  S.phase = 'ready';
  S.restLeft = 0;
  S.queue = [];
  S.towers = []; S.enemies = []; S.shots = []; S.fx = []; S.corpses = [];
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
  show('levelOverlay', false);
  show('diffOverlay', false);
  show('resultOverlay', false);
  show('upgradeOverlay', false);
  el('pause').innerHTML = '&#10073;&#10073;';
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------------- level select ---- */

// A level is unlocked when the one before it has been cleared at all. Locking
// on a star count would wall off a player who won narrowly, which is exactly
// the player who needs the next map least likely to be a wall.
function unlocked(i) {
  return i === 0 || (save.stars[LEVELS[i - 1].id] || 0) > 0;
}

function totalStars() {
  return LEVELS.reduce((n, l) => n + (save.stars[l.id] || 0), 0);
}

// Thumbnails come free: the same renderer, at card size. There is no art to
// draw, cache or ship for them.
// Cached as a data URL rather than as a <canvas>: cloneNode on a canvas
// copies the element and none of its bitmap, so every card drew blank.
const thumbCache = {};
function levelThumb(spec) {
  if (!thumbCache[spec.id]) {
    const full = renderLevel(buildLevel(spec, MAP_W, MAP_H), makeCanvas);
    const t = makeCanvas(384, 216);
    t.getContext('2d').drawImage(full, 0, 0, 384, 216);
    thumbCache[spec.id] = t.toDataURL('image/webp', 0.8);
  }
  return thumbCache[spec.id];
}

function openLevels() {
  const grid = el('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const open = unlocked(i);
    const stars = save.stars[lvl.id] || 0;
    const card = document.createElement('button');
    card.className = 'levelCard' + (open ? '' : ' locked');
    card.disabled = !open;
    card.setAttribute('aria-label',
      `${lvl.name}${open ? `, ${stars} of 3 stars` : ', locked'}`);

    const shot = new Image();
    shot.className = 'thumb';
    shot.alt = '';
    shot.src = levelThumb(lvl);
    card.appendChild(shot);

    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.innerHTML = `<span class="n">${i + 1}. ${lvl.name}</span>` +
      `<span class="st">${open
        ? Array.from({ length: 3 }, (_, k) =>
            k < stars ? '★' : '<i>★</i>').join('')
        : 'LOCKED'}</span>`;
    card.appendChild(cap);

    card.addEventListener('click', () => {
      S.level = i;
      show('diffOverlay', true);
    });
    grid.appendChild(card);
  });
  el('levelTotal').textContent = `${totalStars()} / ${LEVELS.length * 3} STARS`;
  show('levelOverlay', true);
}

function toMenu() {
  S.screen = 'menu';
  S.running = false;
  hud.classList.add('hide');
  show('resultOverlay', false);
  show('upgradeOverlay', false);
  show('diffOverlay', false);
  show('levelOverlay', false);
  show('menu', true);
  syncMenu();
}

function syncMenu() {
  const n = totalStars();
  el('menuBest').textContent = n
    ? `${n} / ${LEVELS.length * 3} STARS  ·  ${save.gems} GEMS`
    : `${save.gems} GEMS`;
}

// The menu background is a level, rendered. The last map the player unlocked,
// so the menu shows where they have got to — and it costs no image either.
function paintMenuBackdrop() {
  let i = 0;
  while (i + 1 < LEVELS.length && unlocked(i + 1)) i++;
  const cv = el('menuBg');
  cv.width = MAP_W; cv.height = MAP_H;
  cv.getContext('2d').drawImage(
    renderLevel(buildLevel(LEVELS[i], MAP_W, MAP_H), makeCanvas), 0, 0);
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

  const pads = S.map.pads;
  let pick = -1, best = 64;
  for (let i = 0; i < pads.length; i++) {
    if (S.towers.some(t => t.pad === i)) continue;
    const d = Math.hypot(p.x - pads[i][0], p.y - pads[i][1]);
    if (d < best) { best = d; pick = i; }
  }
  if (pick < 0) return;

  const def = TOWERS[S.selectedType];
  if (S.energy < def.cost) { toast('NOT ENOUGH ENERGY'); return; }
  S.energy -= def.cost;
  S.towers.push({
    x: pads[pick][0], y: pads[pick][1], pad: pick, type: S.selectedType,
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

el('menuPlay').addEventListener('click', () => { audio(); openLevels(); });
el('levelClose').addEventListener('click', () => show('levelOverlay', false));
for (const b of document.querySelectorAll('.diffBtn')) {
  b.addEventListener('click', () => newRun(S.level, b.dataset.diff));
}
el('resultRetry').addEventListener('click', () => newRun(S.level, S.diff));
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
Promise.all([loadAssets(), loadEnemyArt(), loadPropAtlas()]).then(() => {
  bakeEnemyFrames();
  bootSay.textContent = 'ready';
  el('btnMusic').querySelector('img').src =
    'assets/' + (save.music ? 'btn_music.png' : 'btn_music_off.png');
  el('btnSound').querySelector('img').src =
    'assets/' + (save.sound ? 'btn_sound.png' : 'btn_sound_off.png');
  paintMenuBackdrop();
  const boot = el('boot');
  boot.classList.add('out');
  setTimeout(() => boot.remove(), 450);
  toMenu();
  requestAnimationFrame(frame);
});
