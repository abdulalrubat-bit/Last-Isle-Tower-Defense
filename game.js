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
  { id:'landing', name:'FIRST LANDING', palette:'meadow', hp:0.72, seed:20260912,
    props:300, decor:620,
    roster:{ fodder:'goblin', fast:'scorpion', heavy:'ogre', boss:'demon' },
    curve:'standard',
    control:[[-40,700],[240,690],[430,640],[520,500],[660,430],[860,470],
             [980,380],[1010,240],[1200,190],[1400,230],[1580,300]],
    water:[{x:1210,y:585,rx:185,ry:80,rot:-.08}] },

  { id:'palmrun', name:'THE LONG MEADOW', palette:'jungle', hp:0.96, seed:5514,
    props:320, decor:640, padGap:170,
    roster:{ fodder:'goblin', fast:'wisp', heavy:'feline', boss:'warlord',
             support:'phantom' },
    curve:'rush',
    control:[[-40,240],[210,220],[390,330],[430,540],[620,660],[830,600],
             [890,420],[1060,300],[1270,330],[1400,520],[1580,620]],
    water:[{x:250,y:660,rx:150,ry:66,rot:.12}] },

  { id:'deepwood', name:'DUST ROAD', palette:'dunes', hp:0.76, seed:7712,
    props:340, decor:640, padGap:180,
    roster:{ fodder:'raider', fast:'scorpion', heavy:'sentinel', boss:'matriarch',
             support:'bulwark' },
    curve:'siege',
    control:[[-40,180],[220,200],[400,320],[420,520],[600,640],[820,600],
             [900,430],[1080,330],[1290,380],[1420,560],[1580,660]],
    water:[{x:290,y:700,rx:145,ry:66,rot:.1},{x:1190,y:150,rx:118,ry:56,rot:-.2}] },

  { id:'millpond', name:'MILLPOND', palette:'marsh', hp:1.12, seed:41009,
    props:300, decor:600, padGap:186,
    roster:{ fodder:'wisp', fast:'scorpion', heavy:'warden', boss:'warlord',
             support:'phantom' },
    curve:'swarm',
    control:[[-40,620],[220,640],[420,560],[500,380],[700,300],[900,380],
             [1000,560],[1180,640],[1360,560],[1460,380],[1580,300]],
    water:[{x:700,y:640,rx:175,ry:76,rot:0},{x:1180,y:200,rx:130,ry:60,rot:.15}] },

  { id:'frostgate', name:'FROSTGATE', palette:'snow', hp:0.70, seed:33144,
    props:260, decor:520, padGap:190,
    roster:{ fodder:'goblin', fast:'raider', heavy:'warden', boss:'matriarch',
             support:'shaman' },
    curve:'siege',
    control:[[-40,430],[200,440],[340,300],[540,250],[700,360],[760,570],
             [950,660],[1150,590],[1240,400],[1420,330],[1580,380]],
    water:[{x:520,y:700,rx:160,ry:70,rot:.05}] },

  { id:'longroad', name:'ASHFALL', palette:'volcano', hp:0.82, seed:88231,
    props:280, decor:560, padGap:216,
    roster:{ fodder:'wizard', fast:'feline', heavy:'ogre', boss:'demon',
             support:'bulwark' },
    curve:'standard',
    control:[[-40,160],[180,180],[300,360],[240,560],[380,700],[620,700],
             [740,540],[700,340],[860,220],[1080,240],[1180,420],[1120,620],
             [1300,720],[1480,620],[1580,440]],
    water:[{x:980,y:700,rx:140,ry:62,rot:-.1}] },

  // The map-mechanics level. Two roads, entered from opposite corners, walked
  // alternately — every tower that covers one of them covers none of the
  // other, so the question stops being "where is the best spot" and becomes
  // "how do I split what I have".
  //
  // It also bans the arcane tower, which is the splash answer to an armoured
  // roster, while fielding one. Two mechanics on one map on purpose: this is
  // the last level, and it should ask something the other six do not.
  // Palette chosen for road-against-ground contrast rather than mood: `forge`
  // was the first pick and its road and its dirt differ by six points of
  // luminance, which on a map whose whole point is covering TWO roads made
  // both of them nearly invisible. `ash` sits at fifty, about where jungle
  // does, and jungle reads fine.
  { id:'crossroads', name:'THE CROSSROADS', palette:'ash', hp:0.82, seed:61207,
    props:300, decor:600, padGap:150,
    roster:{ fodder:'goblin', fast:'scorpion', heavy:'sentinel', boss:'warlord',
             support:'shaman' },
    curve:'standard',
    ban:['arcane'],
    control:[[-40,180],[190,190],[360,270],[470,420],[640,470],[820,430],
             [960,330],[1140,300],[1330,360],[1450,470],[1580,520]],
    control2:[[-40,720],[200,700],[380,610],[500,640],[680,690],[880,660],
              [1020,560],[1180,540],[1340,600],[1460,660],[1580,700]],
    water:[{x:760,y:120,rx:150,ry:62,rot:.06}] },
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
            dmg:27, rate:660,  range:190, shot:520, colour:'#ff9b38' },
  ice:    { name:'ICE TOWER',       art:'tower_ice.png',    cost:110,
            dmg:15, rate:800,  range:180, shot:500, colour:'#8deaff',
            slow:0.62, slowFor:1300 },
  bolt:   { name:'LIGHTNING TOWER', art:'tower_bolt.png',   cost:170,
            dmg:44, rate:1150, range:225, shot:900, colour:'#ffe34d',
            chain:2, chainRange:132, chainFalloff:0.34 },
  arcane: { name:'ARCANE TOWER',    art:'tower_arcane.png', cost:165,
            dmg:20, rate:660,  range:195, shot:470, colour:'#f0563c',
            splash:76, splashDmg:0.62 },
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

// ---------------------------------------------------------------- specs ---
//
// Maxing ANY of the three tracks opens a one-time, permanent fork: two
// specialisations per tower, and the tower keeps whichever is bought.
//
// The rule every one of these follows is that it changes what the tower DOES,
// not how big its numbers are. Three levels of DAMAGE is the same tower
// hitting harder; BURN is a different tower. That matters because the game
// already proved — in the simulation, across six levels — that the interesting
// question is which tower answers which roster, and a pure stat ladder cannot
// change the answer to that question, only the speed at which you reach it.
//
// Each fork is also an answer to a threat the next-wave panel names, so the
// warning and the purchase are the same conversation:
//
//   ARMOUR  -> fire/BURN, bolt/LANCE (both bypass it)
//   REGEN   -> fire/BURN (damage over time never lets regen start)
//   SPLITS  -> fire/SCORCH, arcane/SIEGE (the children die to the same hit)
//   NO SLOW -> ice/DEEP FREEZE (the only thing that slows a slow-immune kind)
//   BOSS    -> bolt/LANCE (all of it into one target)
//
// ice/SHATTER is the odd one and the point of the set: it deals almost no
// damage itself and instead makes everything ELSE hit a slowed enemy harder.
// It is the first tower in the game whose value depends on the other towers
// around it, which is the whole of "build discovery" in one purchase.
//
// EVERY fork costs something. The first cut of this table did not, and the
// sweep was blunt about it: a mixed build that took any spec set won 17 or 18
// of 18, against 16 for the same build without them, and cleared the hardest
// level without losing a single life. That is not a choice, it is a button
// marked WIN, and the two sets scored within one run of each other so the
// fork itself decided nothing either. Each one now gives up damage, rate or
// reach for what it gains, which is what makes it possible for a fork to be
// WRONG on a given level — and a fork that cannot be wrong is decoration.
const SPECS = {
  fire: [
    { id:'burn',   name:'BURN',
      blurb:'Weaker hits, but they set the target alight. Burning ignores\narmour and keeps regeneration from ever starting.',
      mod:{ dmgMul:0.70, burnDps:0.58, burnFor:2600 } },
    { id:'scorch', name:'SCORCH',
      blurb:'Every shot bursts. Fires slower, but kills crowds and finishes\nwhat a splitter leaves behind.',
      mod:{ rateMul:1.58, splash:62, splashDmg:0.50 } },
  ],
  ice: [
    { id:'shatter', name:'SHATTER',
      blurb:'Barely scratches anything itself. Everything it slows takes\n+55% damage from EVERY other tower.',
      mod:{ dmgMul:0.45, slowFor:1000, shatter:1.55 } },
    { id:'freeze',  name:'DEEP FREEZE',
      blurb:'Deals almost no damage. In exchange the slow bites harder,\nlasts twice as long, and works on kinds that are\notherwise immune to it.',
      mod:{ dmgMul:0.48, slow:0.36, slowFor:2800, pierceSlowImmune:0.66 } },
  ],
  bolt: [
    { id:'overload', name:'OVERLOAD',
      blurb:'Each bolt is much weaker, but arcs to four more targets and\nbarely fades on the way.',
      mod:{ dmgMul:0.55, chain:4, chainRange:150, chainFalloff:0.78 } },
    { id:'lance',    name:'LANCE',
      blurb:'Stops chaining and fires far slower, putting all of it into one\ntarget: double damage, straight through armour.',
      mod:{ chain:0, dmgMul:2.30, rateMul:1.55, pierce:true } },
  ],
  arcane: [
    { id:'siege', name:'SIEGE',
      blurb:'A far wider blast at full damage, at the cost of most of its\nreach. A mortar, not a sniper.',
      mod:{ splash:124, splashDmg:1.0, rangeMul:0.72 } },
    { id:'rift',  name:'RIFT',
      blurb:'Reaches half again as far and drags everything it catches to a\ncrawl, but hits for little.',
      mod:{ rangeMul:1.50, dmgMul:0.55, splashSlow:0.66, splashSlowFor:1400 } },
  ],
};

// Read the mechanic, not the tower: burn and scorch are both fire, but one is
// a lingering flame and the other a burst, and the discs say so.
const SPEC_COLOUR = {
  burn:'#c8471c', scorch:'#e08a1e', shatter:'#3f8fbf', freeze:'#5ec8e8',
  overload:'#c9a91b', lance:'#8f7be0', siege:'#a33a2a', rift:'#7a3fb0',
};

function specUnlocked(t) {
  const need = owns('training') ? MAX_TRACK - 1 : MAX_TRACK;
  return TRACK_ORDER.some(k => t.up[k] >= need);
}
function specOf(t) {
  return t.spec ? SPECS[t.type].find(x => x.id === t.spec) : null;
}
function specCost(t) {
  return Math.round(TOWERS[t.type].cost * 1.4);
}

// The tower as combat sees it: its base, with the chosen specialisation's
// changes laid over the top. Everything that fires or resolves a hit reads
// this rather than TOWERS[t.type], so a spec needs no special case anywhere.
const defCache = new WeakMap();
function towerDef(t) {
  if (!t.spec) return TOWERS[t.type];
  let c = defCache.get(t);
  if (!c || c.spec !== t.spec) {
    c = { spec: t.spec, def: Object.assign({}, TOWERS[t.type], specOf(t).mod) };
    defCache.set(t, c);
  }
  return c.def;
}

function upgradeCost(tower, track) {
  const lvl = tower.up[track];
  return Math.round(TOWERS[tower.type].cost * 0.55 * Math.pow(1.65, lvl));
}

// Ten kinds, all from the pack. `size` is the drawn height and is the main
// thing telling a player what is coming, so they are spread wide.
//
// Two stats decide WHICH tower answers a kind, and they are what makes one
// level's roster a different problem to another's:
//
//   armour      multiplies damage from anything that hits a single target —
//               fire, lightning, ice. Splash ignores it, so an armoured
//               roster is arcane's problem to solve.
//   slowImmune  ice still damages it but no longer slows it.
//   flying      ignores the road entirely and crosses in a straight line from
//               where the road enters to where it leaves. Every pad chosen to
//               cover a bend now covers nothing, which is the point.
//   regen       heals a fraction of its maximum every second unless it was hit
//               in the last second and a half. Chip damage stops working;
//               something has to burst it down.
//   split       on death becomes N of another kind at the same point on the
//               road. Killing it is not the end of it.
//   heal        restores a fraction of every nearby enemy's maximum health a
//               second, itself excluded. Damage that does not outpace it is
//               wasted, so the shaman is the thing to shoot, not the thing in
//               front of it.
//   aura        every nearby enemy takes reduced damage while the carrier is
//               alive. Unlike armour this applies to splash too, because the
//               answer is meant to be killing the carrier rather than picking
//               a damage type.
//   untargetable
//               towers pass over it while anything else is in range, so it
//               cannot be picked out of a crowd — splash is what digs it out.
//               Alone it is targeted normally, which is deliberate: see the
//               note in the targeting loop for what happened when it was not.
//
// Without these, a roster swap is a reskin: the simulation showed six maps
// reporting the same result to the wave when only their numbers differed.
const KINDS = {
  goblin:   { hp:1.00, speed:1.00, size:82,  reward:1.0, armour:1 },
  scorpion: { hp:0.55, speed:1.75, size:68,  reward:1.0, armour:1 },
  wisp:     { hp:0.62, speed:1.50, size:62,  reward:0.8, armour:1, slowImmune:true,
              flying:true },
  raider:   { hp:1.14, speed:1.15, size:86,  reward:1.2, armour:1 },
  feline:   { hp:1.80, speed:1.20, size:92,  reward:1.5, armour:1 },
  wizard:   { hp:1.15, speed:0.90, size:94,  reward:1.8, armour:1, regen:0.06 },
  sentinel: { hp:2.20, speed:0.80, size:96,  reward:2.0, armour:0.70 },
  warden:   { hp:2.60, speed:0.62, size:92,  reward:2.2, armour:0.62, slowImmune:true },
  ogre:     { hp:2.30, speed:0.68, size:112, reward:2.4, armour:1,
              split:{ into:'goblin', n:2 } },
  // Support. The three roles the brief lists that the roster had no answer to.
  // Each one's value is in what it does for the enemies AROUND it, which makes
  // target priority a decision for the first time: every other kind is worth
  // shooting in the order it arrives, and these are worth shooting first.
  shaman:   { hp:1.30, speed:0.86, size:92,  reward:2.2, armour:1,
              heal:{ range:165, rate:0.055 } },
  // Its aura multiplies whatever armour has already done — a siege roster's
  // heavies are at 0.62 before it applies — so it is kept mild on purpose. At
  // 0.62 the pair left 38% of a hit landing and made three levels unwinnable.
  bulwark:  { hp:2.40, speed:0.66, size:104, reward:2.6, armour:0.66,
              aura:{ range:150, reduce:0.80 } },
  phantom:  { hp:0.90, speed:1.30, size:74,  reward:1.6, armour:1,
              flying:true, slowImmune:true, untargetable:true },
  demon:    { hp:16.0, speed:0.55, size:158, reward:9.0, armour:0.85,
              boss:{ mech:'shield', pool:0.20, up:2600, gap:5200 } },
  warlord:  { hp:13.0, speed:0.70, size:150, reward:8.5, armour:0.78,
              boss:{ mech:'jam', range:240, jamFor:2600, gap:3600 } },
  matriarch:{ hp:14.5, speed:0.52, size:158, reward:9.0, armour:1,
              boss:{ mech:'summon', n:2, gap:5000 } },
};

// ---------------------------------------------------------------- bosses ---
//
// A boss used to be one kind with sixteen times the hit points, which the
// next-wave panel then announced three waves in advance — a lot of ceremony
// for an enemy that asked nothing the wave before it had not already asked.
//
// Each of the three now brings a mechanic instead, and each mechanic has a
// different answer, so which boss a level fields changes how the level ends:
//
//   SHIELD   a pool of absorbing shield goes up, holds, drops, comes back.
//            Damage lands on the pool first. Chipping at it forever never
//            breaks it before it refreshes; something has to burst the pool
//            down so the seconds after it collapses are spent on the boss.
//   JAM      silences the nearest tower it passes, then the next one. A
//            single strong killbox is exactly the shape this beats; towers
//            spread along the road keep firing while one is out.
//   SUMMON   drops fodder behind itself as it walks, so every second it
//            survives is more to clear. Answered by killing it, or by having
//            something that clears crowds while the rest works on it.
//
// The art is reused: warlord is the sentinel's sheet and matriarch is the
// ogre's, both at boss scale. They read as distinct at size and want their
// own sprites eventually.
const BOSS_NAME = { shield:'SHIELDED', jam:'JAMS TOWERS', summon:'SUMMONS' };
// Extra enemies a single wave can be given by summoning, however many
// summoners are in it. See updateBoss for why this is not per boss.
const SUMMON_BUDGET = 10;

// How much SURVEYOR tightens pad spacing. -20 was the first guess and it found
// two extra pads on some maps and NONE on deepwood, whose road happens to sit
// just the wrong side of the threshold — an unlock that does nothing on one of
// six levels is worse than no unlock. -40 gains between two and five on every
// map in the campaign.
const PAD_SURVEY = -40;

// Waves are written in ROLES, and each level maps roles to kinds. One curve,
// ten kinds, and a level fielding wisps and wardens is a different problem to
// one fielding goblins and ogres — without rewriting the curve.
//
// The curve itself is also per level. Roster alone was not enough: the
// simulation showed the fodder slot deciding nearly every outcome, because a
// wave is 8-20 fodder against 2-8 heavies. Changing the SHAPE of the wave
// changes which slot matters, which is the lever the roster did not have.
const CURVES = {
  // Support appears on four waves of the fifteen, not on every wave from six.
  // Scheduled on nearly every wave it was a flat tax: four levels went
  // unwinnable on hard while the support units themselves measured fine.
  // Sparse, each arrival is a thing to notice and shoot first, which is the
  // whole point of the role.
  //
  // The original. Fodder throughout, fast from wave 3, heavies from 5.
  standard: [
    { fodder:8 }, { fodder:12 }, { fodder:10, fast:4 }, { fodder:12, fast:6 },
    { fodder:10, heavy:2 }, { fodder:14, fast:8 },
    { fodder:12, fast:4, heavy:3, support:1 },
    { fodder:16, fast:10 }, { fodder:10, heavy:5, support:1 },
    { fodder:8, boss:1 },
    { fodder:18, fast:12, support:1 }, { fodder:14, heavy:6 },
    { fodder:16, fast:14, heavy:4 },
    { fodder:20, fast:10, heavy:8, support:2 }, { fodder:12, heavy:6, boss:2 },
  ],
  // Heavies from wave two and barely any fodder. Single-target damage matters
  // and splash has little to splash.
  siege: [
    { fodder:6 }, { heavy:2, fodder:4 }, { heavy:3, fodder:4 },
    { heavy:4, fast:3 }, { heavy:5, fodder:6 }, { heavy:5, fast:5 },
    { heavy:5, fodder:5, support:1 }, { heavy:6, fast:4 },
    { heavy:6, fodder:6, support:1 }, { heavy:3, boss:1 },
    { heavy:7, fast:6, support:1 }, { heavy:8, fodder:6 },
    { heavy:8, fast:8 }, { heavy:9, fodder:8, support:1 },
    { heavy:6, boss:2 },
  ],
  // Almost nothing but fodder, in numbers. Splash and chain earn their cost.
  swarm: [
    { fodder:14 }, { fodder:20 }, { fodder:24, fast:4 }, { fodder:28, fast:6 },
    { fodder:30 }, { fodder:26, fast:12 }, { fodder:34, fast:8, support:1 },
    { fodder:38, fast:12 }, { fodder:30, heavy:3, support:1 },
    { fodder:20, boss:1 },
    { fodder:36, fast:12, support:1 }, { fodder:32, heavy:4 },
    { fodder:38, fast:14 }, { fodder:40, fast:12, support:2 },
    { fodder:24, heavy:5, boss:2 },
  ],
  // Fast units front to back, with the fodder thinned out. Slowing matters,
  // and towers covering only one bend never get a second shot.
  rush: [
    { fast:8 }, { fast:12 }, { fast:14, fodder:4 }, { fast:18 },
    { fast:16, heavy:2 }, { fast:22 }, { fast:20, fodder:8, support:1 },
    { fast:26 }, { fast:18, heavy:4, support:1 },
    { fast:12, boss:1 },
    { fast:24, fodder:8, support:1 }, { fast:22, heavy:4 },
    { fast:28 }, { fast:24, heavy:5, support:2 },
    { fast:18, heavy:3, boss:2 },
  ],
};

const WAVES = CURVES.standard;

function waveSpec(n) {
  const c = CURVES[LEVELS[S.level].curve] || CURVES.standard;
  return c[n - 1] || c[c.length - 1];
}

// Enemy kinds are keyed by what they are in the code; a banner wants what they
// are to the player.
const KIND_NAME = {
  goblin:'GOBLIN HORDE', scorpion:'SCORPION', wisp:'WISP', raider:'RAIDER',
  feline:'PROWLER', wizard:'WARLOCK', sentinel:'SENTINEL', warden:'WARDEN',
  ogre:'OGRE', demon:'DEMON LORD',
  warlord:'THE WARLORD', matriarch:'THE MATRIARCH',
  shaman:'SHAMAN', bulwark:'BULWARK', phantom:'PHANTOM',
};

// ---------------------------------------------------------------- wagers ---
//
// An optional bet on the NEXT wave, taken during the rest between waves and
// spent the moment it starts. Take one when you are ahead and want the tempo,
// decline when you are not — which is the "meaningful spending decision" the
// loop was missing: until now the only choice between waves was what to buy,
// and buying is never a risk.
//
// Deliberately one per wave and never compulsory. The sim's builds take none,
// so the balance table measures the game without them and a wager can only
// ever be something a player reaches for, not a tax they have to beat.
const WAGERS = {
  swift:    { name:'SWIFT',    risk:'+30% SPEED',   pay:1.45, speed:1.30,
              blurb:'They come faster.' },
  hardened: { name:'HARDENED', risk:'-22% DAMAGE',  pay:1.50, tough:0.78,
              blurb:'Your towers hit them softer.' },
  horde:    { name:'HORDE',    risk:'+40% NUMBERS', pay:1.40, count:1.40,
              blurb:'More of them.' },
};
const WAGER_ORDER = ['swift', 'hardened', 'horde'];

// Wagers multiply together rather than being picked one at a time, because
// DOUBLE OR NOTHING lets two run at once: two risks stacked, two payouts
// multiplied. One slot without it, two with.
function wagerSlots() { return owns('gambler') ? 2 : 1; }
function wagerStack(list) {
  const out = { pay:1, speed:1, tough:1, count:1 };
  for (const id of list || []) {
    const w = WAGERS[id];
    out.pay *= w.pay;
    if (w.speed) out.speed *= w.speed;
    if (w.tough) out.tough *= w.tough;
    if (w.count) out.count *= w.count;
  }
  return out;
}

const DEFAULT_ROSTER =
  { fodder:'goblin', fast:'scorpion', heavy:'ogre', boss:'demon' };

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
  maxLives: 0, bossCalled: false,
  wager: [], wagerLive: [], summonBudget: 0, roadTurn: -1,
  shakeUntil: 0, shakeMag: 0, leakUntil: 0,
  queue: [],             // enemy kinds still to spawn this wave
  spawnIn: 0,
  towers: [], enemies: [], shots: [], fx: [], corpses: [],
  selectedType: 'fire',
  openTower: null,
  time: 0,
  dirty: true,
};

// ------------------------------------------------------------- workshop ---
//
// What gems are for. They accumulated for months and bought nothing, which is
// the exact thing the brief warns against — a number that goes up is not
// progression.
//
// Every one of these opens a way to PLAY rather than raising a number. The
// closest to a stat is QUARTERMASTER, and even that is chosen so it buys a
// fourth tower in the opening rather than a slightly better third one: the
// interesting part is the shape of the opening, not the energy.
//
// Bought once, kept forever, and applied to every level including ones already
// cleared — so a player who stalls on hard has something to do other than
// retry the same run.
const UNLOCKS = {
  quartermaster: { name:'QUARTERMASTER', cost:30,
    blurb:'Start every level with 90 more energy — enough for a fourth tower\nin the opening instead of a third.' },
  training:      { name:'FIELD TRAINING', cost:45,
    blurb:'Towers open their specialisation at two levels in a track instead\nof three, so a fork arrives early enough to shape the run.' },
  surveyor:      { name:'SURVEYOR', cost:60,
    blurb:'Every map is surveyed for more ground: build pads sit closer\ntogether, so there are more of them.' },
  gambler:       { name:'DOUBLE OR NOTHING', cost:80,
    blurb:'Take two wagers on the same wave. The risks stack and so does\nthe payout.' },
};
const UNLOCK_ORDER = ['quartermaster', 'training', 'surveyor', 'gambler'];

function owns(id) { return !!(save.unlocks && save.unlocks[id]); }

const SAVE_KEY = 'islanddefence.v2';
const save = Object.assign(
  // stars: { levelId: 0-3 }. A level is unlocked once the one before it has
  // any stars at all, so a player who scrapes a win is never stuck.
  { gems: 0, stars: {}, unlocks: {}, music: true, sound: true },
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
  goblin:   { walk:'enemy_goblin_walk.png', die:'enemy_goblin_die.png', walkN:8, dieN:6 },
  scorpion: { walk:'enemy_scorpion_walk.png', die:'enemy_scorpion_die.png', walkN:8, dieN:6 },
  wisp:     { walk:'enemy_wisp_walk.png', die:'enemy_wisp_die.png', walkN:8, dieN:6 },
  raider:   { walk:'enemy_raider_walk.png', die:'enemy_raider_die.png', walkN:8, dieN:6 },
  feline:   { walk:'enemy_feline_walk.png', die:'enemy_feline_die.png', walkN:8, dieN:6 },
  wizard:   { walk:'enemy_wizard_walk.png', die:'enemy_wizard_die.png', walkN:8, dieN:6 },
  sentinel: { walk:'enemy_sentinel_walk.png', die:'enemy_sentinel_die.png', walkN:8, dieN:6 },
  warden:   { walk:'enemy_warden_walk.png', die:'enemy_warden_die.png', walkN:8, dieN:6 },
  ogre:     { walk:'enemy_ogre_walk.png', die:'enemy_ogre_die.png', walkN:8, dieN:6 },
  demon:    { walk:'enemy_demon_walk.png', die:'enemy_demon_die.png', walkN:8, dieN:6 },
  // Reused sheets at boss scale — see BOSS_NAME above.
  warlord:  { walk:'enemy_sentinel_walk.png', die:'enemy_sentinel_die.png', walkN:8, dieN:6 },
  matriarch:{ walk:'enemy_ogre_walk.png', die:'enemy_ogre_die.png', walkN:8, dieN:6 },
  shaman:   { walk:'enemy_wizard_walk.png', die:'enemy_wizard_die.png', walkN:8, dieN:6 },
  bulwark:  { walk:'enemy_sentinel_walk.png', die:'enemy_sentinel_die.png', walkN:8, dieN:6 },
  phantom:  { walk:'enemy_wisp_walk.png', die:'enemy_wisp_die.png', walkN:8, dieN:6 },
};const DIE_MS = 700;

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
const RUN_FRAMES = {}, DIE_FRAMES = {}, FLASH_FRAMES = {};
const HURT_MS = 130;

// A white copy of each walk sheet, composited once at load. Drawn over the
// sprite at a decaying alpha when the enemy is hit, so every shot visibly
// connects. Tinting per hit per frame would be a composite pass in the middle
// of the busiest moment on the board; this is a second drawImage.
function bakeHurtFlash() {
  for (const kind of Object.keys(RUN_FRAMES)) {
    const a = RUN_FRAMES[kind];
    if (!a) continue;
    const cv = makeCanvas(a.fw * a.count, a.fh);
    const c = cv.getContext('2d');
    c.drawImage(a.img, 0, 0, a.fw * a.count, a.fh, 0, 0, a.fw * a.count, a.fh);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = '#fff';
    c.fillRect(0, 0, cv.width, cv.height);
    FLASH_FRAMES[kind] = { img: cv, fw: a.fw, fh: a.fh, count: a.count };
  }
}

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
// Tower tiers and projectiles. Same shape as the prop atlas: absent means
// the game falls back, here to the standalone tier-one sprites.
let FX_IMG = null;
// Spark bursts, pre-tinted per tower type. Tinting at draw time would mean a
// composite pass per hit per frame; baked once, a hit is a drawImage.
const FX_SPARK = {};
function loadFxAtlas() {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth && typeof FX_ATLAS !== 'undefined') {
        FX_IMG = im;
        const s = FX_ATLAS.spark;
        if (s) {
          for (const type of TOWER_ORDER) {
            const cv = makeCanvas(s.r[2] * s.n, s.r[3]);
            const c = cv.getContext('2d');
            c.drawImage(im, s.r[0], s.r[1], s.r[2] * s.n, s.r[3],
                        0, 0, s.r[2] * s.n, s.r[3]);
            c.globalCompositeOperation = 'source-atop';
            c.globalAlpha = 0.75;
            c.fillStyle = TOWERS[type].colour;
            c.fillRect(0, 0, cv.width, cv.height);
            FX_SPARK[type] = cv;
          }
        }
      }
      resolve();
    };
    im.onerror = () => resolve();
    im.src = 'assets/fx.png';
  });
}

let TOWER_IMG = null;
function loadTowerAtlas() {
  return new Promise(resolve => {
    const im = new Image();
    im.onload = () => { if (im.naturalWidth) TOWER_IMG = im; resolve(); };
    im.onerror = () => resolve();
    im.src = 'assets/towers.png';
  });
}

// Ten upgrade steps, three tiers of art. A tower has to look different for
// money spent on it, but it also has to still read as the same tower, so the
// steps are uneven on purpose: tier two arrives early enough to feel earned.
function towerTier(t) {
  const lvl = towerLevel(t);            // 1..10
  return lvl >= 7 ? 2 : lvl >= 4 ? 1 : 0;
}

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
  bakeHurtFlash();
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
    clear: [440, 880, 0.26, 'sine',     0.11],
    boss:  [150,  60, 0.55, 'sawtooth', 0.16],
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
  placeBands(vw, vh);
}
addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// The map is 16:9 and a phone held upright is not, so in portrait the board
// can only ever be a band across the middle — 27% of the screen on a 412x870
// device. That part is unavoidable without cropping the road, and cropping the
// road is not an option when the road IS the level.
//
// What IS avoidable is where the leftover space goes. Anchoring the HUD to the
// top of the viewport and the tower tray to the bottom left 234px of dead
// green trapped BETWEEN the board and the tray, which is what made the screen
// read as broken rather than as letterboxed: three widgets adrift at the top,
// a strip of game, then nothing.
//
// So the three bands are treated as one block — HUD, board, tray, touching —
// and that block is centred. The dead space ends up outside it, split top and
// bottom, where it reads as a frame instead of a gap. Landscape keeps the HUD
// overlaying the board, which is what it is designed for and where it works.
function placeBands(vw, vh) {
  const portrait = vh > vw;
  document.body.classList.toggle('portrait', portrait);
  const root = document.documentElement.style;
  const boardH = MAP_H * scale;

  if (!portrait) {
    root.setProperty('--board-top', oy + 'px');
    root.setProperty('--board-bottom', (vh - oy - boardH) + 'px');
    return;
  }

  // Measured rather than assumed: the HUD's height depends on how many kinds
  // are in the next wave and whether a wager row is up.
  const stats = el('stats'), stack = el('waveStack'), tray = el('bottomBar');
  const hudH = Math.max(stats.offsetHeight, 0) + 6 + Math.max(stack.offsetHeight, 0);
  const trayH = Math.max(tray.offsetHeight, 0);
  const blockH = hudH + boardH + trayH + 16;
  const top = Math.max(4, (vh - blockH) / 2);

  oy = top + hudH + 8;
  root.setProperty('--hud-top', top + 'px');
  root.setProperty('--board-top', oy + 'px');
  root.setProperty('--board-bottom', (vh - oy - boardH) + 'px');
  root.setProperty('--tray-top', (oy + boardH + 8) + 'px');
}

function toMap(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale };
}

/* ----------------------------------------------------------- wave logic -- */

function roleKind(role) {
  const r = LEVELS[S.level].roster || DEFAULT_ROSTER;
  return r[role] || DEFAULT_ROSTER[role];
}

// Support is the one role a level may decline. Every curve schedules it, but a
// roster that does not name one fields none — so the opening level can stay a
// plain fight while later ones add a thing to shoot first.
function hasRole(role) {
  if (role !== 'support') return true;
  const r = LEVELS[S.level].roster || DEFAULT_ROSTER;
  return !!r.support;
}

function buildQueue(spec) {
  // Interleave the kinds rather than marching them out in blocks, so a wave
  // reads as a mixed group instead of four separate mini-waves.
  // HORDE swells the ordinary ranks only. Bosses are not multiplied: three
  // demons on wave ten is not a harder version of the same wave, it is a
  // different and much worse one.
  const mult = wagerStack(S.wagerLive).count;
  const pools = Object.entries(spec)
    .filter(([role]) => hasRole(role))
    .flatMap(([role, n]) => Array(role === 'boss' ? n : Math.round(n * mult))
                              .fill(roleKind(role)));
  for (let i = pools.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pools[i], pools[j]] = [pools[j], pools[i]];
  }
  // Bosses last: they should arrive as the punctuation, not the opening.
  const bossKind = roleKind('boss');
  return pools.sort((a, b) =>
    (a === bossKind ? 1 : 0) - (b === bossKind ? 1 : 0));
}

// ------------------------------------------------------------------------
// What is coming next.
//
// A player who cannot see the next wave is not making decisions, they are
// watching. This panel answers "what should I build before I press start",
// and every word in it is DERIVED from the roster and the curve rather than
// written per level — a level that swaps its heavy for an armoured one gets
// the ARMOUR warning for free, and a warning can never go stale against the
// thing it warns about.

// Frame zero of the walk cycle, fitted to a box. Cached: the panel rebuilds
// on every wave and these never change.
const portraitCache = {};
function enemyPortrait(kind, box) {
  const key = kind + ':' + box;
  if (portraitCache[key]) return portraitCache[key];
  const a = RUN_FRAMES[kind];
  if (!a) return null;
  const cv = makeCanvas(box, box);
  const s = Math.min(box / a.fw, box / a.fh);
  const w = a.fw * s, h = a.fh * s;
  cv.getContext('2d').drawImage(a.img, 0, 0, a.fw, a.fh,
                                (box - w) / 2, (box - h) / 2, w, h);
  portraitCache[key] = cv;
  return cv;
}

// Each test is the same property the combat code reads, so a tag appears if
// and only if the mechanic is actually in the wave.
const THREATS = [
  { tag:'BOSS',     boss:true, test: () => false },
  // A boss's mechanic is the thing worth building for, so it is named as its
  // own warning rather than hidden inside the word BOSS. Derived like the
  // rest: the tag comes from the boss kind's own mechanic, so a level that
  // fields a different boss warns differently with nothing else to change.
  { tag:'SHIELDED',    test: k => k.boss && k.boss.mech === 'shield' },
  { tag:'JAMS TOWERS', test: k => k.boss && k.boss.mech === 'jam' },
  { tag:'SUMMONS',     test: k => k.boss && k.boss.mech === 'summon' },
  { tag:'ARMOUR',   test: k => k.armour < 1 },
  { tag:'AIR',      test: k => k.flying },
  { tag:'NO SLOW',  test: k => k.slowImmune },
  { tag:'REGEN',    test: k => k.regen > 0 },
  { tag:'SPLITS',   test: k => !!k.split },
  { tag:'HEALER',   test: k => !!k.heal },
  { tag:'SHIELDS',  test: k => !!k.aura },
  { tag:'STEALTH',  test: k => !!k.untargetable },
];

// Roles in the order they reach the player: fodder first, boss as punctuation.
const ROLE_ORDER = ['fodder', 'fast', 'heavy', 'support', 'boss'];

function curveFor() {
  return CURVES[LEVELS[S.level].curve] || CURVES.standard;
}

// Waves until the next one carrying a boss, counting from `from`. Returns 0
// when `from` itself has one and -1 when none is left in the level.
function bossIn(from) {
  const c = curveFor();
  for (let i = from; i <= c.length; i++) {
    if ((c[i - 1] || {}).boss) return i - from;
  }
  return -1;
}

// The threat tags a given wave carries, as a set. Wave 0 is empty, so every
// threat in wave one counts as new and the opening warns at full volume.
function threatsOf(n) {
  const out = new Set();
  const c = curveFor();
  if (n < 1 || n > c.length) return out;
  const spec = c[n - 1];
  for (const role of ROLE_ORDER) {
    if (!spec[role] || !hasRole(role)) continue;
    const k = KINDS[roleKind(role)];
    for (const t of THREATS) {
      if (!t.boss && t.test(k)) out.add(t.tag);
    }
  }
  return out;
}

// Three chips, one selectable, cleared by tapping the one that is on. Only up
// during the rest between waves: a bet on a wave already running is not a bet.
function renderWagers() {
  const bar = el('wagerBar');
  const on = S.phase === 'ready' && S.wave + 1 <= WAVES.length;
  bar.classList.toggle('show', on);
  if (!on) { bar.innerHTML = ''; return; }
  // Rebuilt only when the selection changes, so tapping is not fighting a DOM
  // that is replaced underneath it every time energy ticks.
  const key = S.wager.join(',');
  if (bar.dataset.sel === key && bar.children.length) return;
  bar.dataset.sel = key;
  bar.innerHTML = '';
  const slots = wagerSlots();
  const hint = document.createElement('span');
  hint.id = 'wagerHint';
  hint.textContent = slots > 1 ? `RISK? ${S.wager.length}/${slots}` : 'RISK?';
  bar.appendChild(hint);
  for (const id of WAGER_ORDER) {
    const w = WAGERS[id];
    const held = S.wager.includes(id);
    const b = document.createElement('button');
    b.className = 'wager' + (held ? ' on' : '');
    // Greyed rather than hidden once the slots are full: the player should see
    // what they did not take.
    if (!held && S.wager.length >= slots) b.classList.add('full');
    b.innerHTML = `<span class="n">${w.name}</span>` +
                  `<span class="r">${w.risk}</span>` +
                  `<span class="p">+${Math.round((w.pay - 1) * 100)}% ENERGY</span>`;
    b.addEventListener('click', () => {
      if (held) S.wager = S.wager.filter(x => x !== id);
      else if (S.wager.length < slots) S.wager = S.wager.concat(id);
      else return;
      S.dirty = true;
      sfx(held ? 'sell' : 'build');
      renderWagers();
    });
    bar.appendChild(b);
  }
}

function renderPreview() {
  const next = S.wave + 1;
  const on = S.phase === 'ready' && next <= WAVES.length;
  el('wavePreview').classList.toggle('show', on);
  if (!on) return;

  const spec = waveSpec(next);
  el('previewHdr').textContent = `NEXT — WAVE ${next}`;

  // One portrait per role present, with its count. Roles can share a kind
  // (a roster may use the same unit for fodder and fast), so they are merged
  // by kind rather than shown twice.
  const byKind = new Map();
  for (const role of ROLE_ORDER) {
    if (!spec[role] || !hasRole(role)) continue;
    const kind = roleKind(role);
    byKind.set(kind, (byKind.get(kind) || 0) + spec[role]);
  }
  const roster = el('previewRoster');
  roster.innerHTML = '';
  for (const [kind, n] of byKind) {
    const d = document.createElement('div');
    d.className = 'pvUnit';
    const art = enemyPortrait(kind, 76);
    if (art) { art.style.width = '100%'; d.appendChild(art); }
    const b = document.createElement('b');
    b.textContent = '\u00d7' + n;
    d.appendChild(b);
    d.title = kind;
    roster.appendChild(d);
  }

  // A warning that is on for all fifteen waves is wallpaper. The first pass
  // showed ARMOUR on every wave of a siege level and AIR on every wave of a
  // swarm one, which is true and tells the player nothing. So a threat that
  // is NEW this wave is loud, and one carried over from the wave before is
  // shown quietly: the panel still says what the state is, but it only raises
  // its voice when the answer to "what do I build" has actually changed.
  const tags = el('previewThreats');
  tags.innerHTML = '';
  const held = threatsOf(next - 1);
  for (const t of THREATS) {
    const hit = t.boss ? !!spec.boss : threatsOf(next).has(t.tag);
    if (!hit) continue;
    const e = document.createElement('span');
    // A boss is always news; it does not carry over from a wave it was not in.
    const isNew = t.boss || !held.has(t.tag);
    e.className = 'pvTag' + (t.boss ? ' boss' : isNew ? '' : ' held');
    e.textContent = (isNew ? '\u26a0 ' : '') + t.tag;
    tags.appendChild(e);
  }

  renderWagers();

  // Only worth saying when it is far enough off to build for and close enough
  // to matter. Next wave already has its own BOSS tag.
  const away = bossIn(next);
  el('previewBoss').textContent =
    away > 0 && away <= 4 ? `BOSS IN ${away} WAVE${away > 1 ? 'S' : ''}` : '';
}

function startWave(manual) {
  if (S.phase !== 'ready' || S.wave >= WAVES.length) return;
  if (manual && S.restLeft > 0 && S.wave > 0) {
    const bonus = Math.round(S.restLeft / 1000) * 3;
    S.energy += bonus;
    toast(`+${bonus} ENERGY — CALLED EARLY`);
  }
  S.wave++;
  S.bossCalled = false;
  // Locked in as the wave starts. S.wager is what is SELECTED, wagerLive is
  // what the wave is actually running under — otherwise clearing the choice
  // for the next wave would retroactively change the one in flight.
  S.wagerLive = S.wager;
  S.wager = [];
  S.summonBudget = SUMMON_BUDGET;
  if (S.wagerLive.length) {
    const st = wagerStack(S.wagerLive);
    banner(S.wagerLive.map(id => WAGERS[id].name).join(' + '),
           '+' + Math.round((st.pay - 1) * 100) + '% ENERGY', true, 1400);
  }
  S.queue = buildQueue(waveSpec(S.wave));
  S.phase = 'spawning';
  S.spawnIn = 0;
  S.restLeft = 0;
  S.dirty = true;
}

function spawnInterval() {
  return Math.max(280, 820 - S.wave * 34);
}

// Flyers cross the board in a straight line between the road's two ends, so
// they need their own route length to know when they have left.
function routeOf(e) {
  return (S.map.routes && S.map.routes[e.route || 0]) || S.map;
}

function routeLen(e) {
  const r = routeOf(e);
  if (!KINDS[e.kind].flying) return r.length;
  const p = r.path, a = p[0], b = p[p.length - 1];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function enemyPos(e) {
  if (!KINDS[e.kind].flying) return pathPointAt(S.map, e.dist, e.route);
  const p = routeOf(e).path, a = p[0], b = p[p.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = Math.min(1, e.dist / len);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t,
           angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function spawn(kind, atDist, route) {
  const k = KINDS[kind], d = DIFF[S.diff];
  // The next-wave panel says a boss is coming; this is it arriving. Announced
  // once per wave — a wave with two bosses should not announce twice.
  if (!S.bossCalled && atDist == null && waveSpec(S.wave).boss
      && kind === roleKind('boss')) {
    S.bossCalled = true;
    const mech = (k.boss && BOSS_NAME[k.boss.mech]) || '';
    banner(KIND_NAME[kind] || 'BOSS', mech, true, 1900);
    shake(11, 260);
    sfx('boss');
  }
  const w = wagerStack(S.wagerLive);
  const hp = (66 + S.wave * 30) * k.hp * d.hp * LEVELS[S.level].hp;
  // Roads alternate strictly rather than being picked at random, so a level
  // with two entrances always presents both and never rolls a wave down one
  // of them by chance.
  const roads = (S.map.routes && S.map.routes.length) || 1;
  const road = route != null ? route : (roads > 1 ? (S.roadTurn = (S.roadTurn + 1) % roads) : 0);
  S.enemies.push({
    kind, route: road, dist: atDist || 0, hp, maxHp: hp,
    // HARDENED is a damage-taken multiplier rather than extra health, so the
    // health bar still reads as the fraction of the enemy that is left.
    tough: w.tough,
    speed: BASE_SPEED * k.speed * d.speed * w.speed,
    slowUntil: 0, slowFactor: 1, hurtUntil: 0, wasSplit: false,
    burnUntil: 0, burnDps: 0, shatterUntil: 0, shatterMul: 1,
    auraUntil: 0, auraMul: 1,
    bossNext: 0, shieldHp: 0, shieldMax: 0, shieldDownUntil: 0, jamTarget: null,
    summoned: 0,
    reward: Math.round((7 + S.wave * 1.6) * k.reward * w.pay),
    anim: Math.random() * 1000,
    x: 0, y: 0, angle: 0,
  });
}

function waveCleared() {
  const bonus = Math.round((40 + S.wave * 12) * wagerStack(S.wagerLive).pay);
  S.wagerLive = [];
  S.energy += bonus;
  save.gems += 1;
  persist();
  if (S.wave >= WAVES.length) { finish(true); return; }
  S.phase = 'ready';
  S.restLeft = REST_MS;
  banner(`WAVE ${S.wave} CLEAR`, `+${bonus} ENERGY`, false, 1600);
  sfx('clear');
  S.dirty = true;
}

function finish(won) {
  S.phase = 'done';
  S.running = false;
  S.dirty = true;      // the next-wave panel has nothing left to preview
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

// Runs once a frame for anything carrying a boss block, AFTER its position is
// known — jam needs to know which tower it is beside, and summon needs a point
// on the road to drop children at.
// Healing and damage-reduction auras, resolved for the whole field at once.
//
// Auras are stamped onto the enemies they cover with an expiry a few frames
// out, rather than recomputed inside damage(). damage() is called from four
// places — shots, splash, chain, burn ticks — and a shot resolving between
// two updates has to see the aura that was up when it landed. A short-lived
// mark does that with one pass here instead of a search per hit.
//
// Runs before positions update, so it uses last frame's coordinates: a
// carrier that moved a few pixels does not change who is inside a 170px
// radius, and paying for a second position pass would.
const AURA_HOLD = 90;   // ms; comfortably longer than a frame at any rate

function updateSupport(dt) {
  let any = false;
  for (const e of S.enemies) {
    const k = KINDS[e.kind];
    if (e.hp > 0 && (k.heal || k.aura)) { any = true; break; }
  }
  if (!any) return;

  for (const src of S.enemies) {
    if (src.hp <= 0) continue;
    const k = KINDS[src.kind];
    if (!k.heal && !k.aura) continue;
    const r = (k.heal || k.aura).range;
    const r2 = r * r;
    for (const e of S.enemies) {
      if (e === src || e.hp <= 0) continue;
      const dx = e.x - src.x, dy = e.y - src.y;
      if (dx * dx + dy * dy > r2) continue;
      if (k.heal && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * k.heal.rate * dt / 1000);
      }
      if (k.aura) {
        // Strongest aura covering an enemy wins; they do not stack, or three
        // bulwarks in a wave would make everything near them unkillable.
        if (!(e.auraUntil > S.time) || k.aura.reduce < e.auraMul) {
          e.auraMul = k.aura.reduce;
        }
        e.auraUntil = S.time + AURA_HOLD;
      }
    }
  }
}

function updateBoss(e, b) {
  if (b.mech === 'shield') {
    // Raise, hold, drop, wait, raise. Bursting the pool down early ends the
    // hold early, which is the whole decision: the reward for real damage is
    // seconds of an exposed boss.
    if (e.shieldHp > 0) {
      if (S.time >= e.bossNext) { e.shieldHp = 0; e.shieldDownUntil = S.time + b.gap; }
    } else if (S.time >= e.shieldDownUntil) {
      e.shieldMax = e.maxHp * b.pool;
      e.shieldHp = e.shieldMax;
      e.bossNext = S.time + b.up;
    }
    return;
  }
  if (S.time < e.bossNext) return;
  e.bossNext = S.time + b.gap;

  if (b.mech === 'jam') {
    // The nearest tower still able to fire. Picking the nearest rather than
    // the strongest is what makes spreading towers out the answer: a boss can
    // only silence what it is walking past.
    let best = b.range, pick = null;
    for (const t of S.towers) {
      if (t.jammedUntil > S.time) continue;
      const d = Math.hypot(t.x - e.x, t.y - e.y);
      if (d < best) { best = d; pick = t; }
    }
    if (pick) {
      pick.jammedUntil = S.time + b.jamFor;
      e.jamTarget = pick;
      S.fx.push({ kind:'jam', x1:e.x, y1:e.y - KINDS[e.kind].size * 0.45,
                  x2:pick.x, y2:pick.y - 30, ttl:360, life:360 });
      sfx('leak');
    }
    return;
  }

  if (b.mech === 'summon') {
    // The cap is a budget for the WAVE, shared by every summoner in it, not an
    // allowance each one gets.
    //
    // Per-boss it bounded a single summoner correctly and then the final wave
    // of the siege curve fielded two, which doubled the flood and made both
    // levels that use this boss unwinnable on hard — 0 of 27 runs, reaching
    // wave 15 and dying there every time. That was not noise, and it is the
    // second time the same lesson has been paid for here: bound the total the
    // player actually faces, never the rate or the per-unit share.
    if (S.summonBudget <= 0) return;
    // Behind itself, so the children have to walk the whole board the boss
    // already covered rather than appearing at the end of the road.
    const kind = roleKind('fodder');
    for (let i = 0; i < b.n && S.summonBudget > 0; i++) {
      S.summonBudget--;
      spawn(kind, Math.max(0, e.dist - 40 - i * 34), e.route);
      S.enemies[S.enemies.length - 1].wasSplit = true;
    }
    S.fx.push({ kind:'boom', x:e.x, y:e.y - KINDS[e.kind].size * 0.35,
                r:70, ttl:320, life:320 });
  }
}

/* ------------------------------------------------------------- combat ---- */

function damage(e, amount, ignoreArmour) {
  if (e.hp <= 0) return;
  // A SHATTER mark is left on the ENEMY by the ice tower that slowed it, not
  // held on the tower, so every other tower's hits are amplified without any
  // of them needing to know an ice tower exists.
  if (e.shatterUntil && S.time < e.shatterUntil) amount *= e.shatterMul;
  // An aura applies even to damage that ignores armour. Splash is the answer
  // to an armoured roster; it is deliberately NOT the answer to a bulwark,
  // whose answer is killing the bulwark.
  if (e.auraUntil && S.time < e.auraUntil) amount *= e.auraMul;
  if (e.tough !== 1) amount *= e.tough;
  let dealt = ignoreArmour ? amount : amount * (KINDS[e.kind].armour ?? 1);
  // A raised shield eats damage until its pool is gone, and armour does not
  // apply to it — the shield is the obstacle, not the hide behind it. Burst
  // it down and the boss is exposed for the rest of the phase; chip at it and
  // it refreshes before you ever get through.
  if (e.shieldHp > 0) {
    const taken = Math.min(e.shieldHp, dealt);
    e.shieldHp -= taken;
    dealt -= taken;
    e.hurtUntil = S.time + HURT_MS;
    if (e.shieldHp <= 0) {
      const b = KINDS[e.kind].boss;
      e.shieldDownUntil = S.time + (b ? b.gap : 4000);
      S.fx.push({ kind:'boom', x:e.x, y:e.y - KINDS[e.kind].size * 0.4,
                  r:90, ttl:380, life:380 });
      shake(7, 180);
    }
    if (dealt <= 0) return;
  }
  e.hp -= dealt;
  e.hurtUntil = S.time + HURT_MS;
  if (e.hp <= 0) {
    S.energy += e.reward;
    S.score += e.reward;
    S.dirty = true;
    // The pack ships a death animation per enemy, so a kill is worth showing.
    // Corpses are display-only: off the path, un-targetable, gone in DIE_MS.
    S.corpses.push({ kind: e.kind, x: e.x, y: e.y, angle: e.angle, t: 0 });

    const k = KINDS[e.kind];
    if (k.split && !e.wasSplit) {
      // Spread the children along the road so they do not stack into one
      // sprite, and mark them so a split cannot cascade forever.
      for (let i = 0; i < k.split.n; i++) {
        spawn(k.split.into, Math.max(0, e.dist - 14 + i * 28), e.route);
        S.enemies[S.enemies.length - 1].wasSplit = true;
      }
    }
  }
}

// Slowing in one place, because three things now do it: the ice tower, RIFT's
// blast, and DEEP FREEZE. A slow-immune kind normally shrugs it off entirely;
// pierceSlowImmune is the only thing that gets through, and at reduced bite.
function applySlow(e, def) {
  let factor = def.slow;
  if (KINDS[e.kind].slowImmune) {
    if (!def.pierceSlowImmune) return;
    factor = def.pierceSlowImmune;
  }
  // Never let a weaker slow overwrite a stronger one that is still running.
  if (S.time < e.slowUntil && e.slowFactor < factor) return;
  e.slowUntil = S.time + def.slowFor;
  e.slowFactor = factor;
  if (def.shatter) { e.shatterUntil = e.slowUntil; e.shatterMul = def.shatter; }
}

function splash(x, y, radius, dmg, source, def) {
  for (const e of S.enemies) {
    if (e.hp <= 0 || e === source) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    // Splash ignores armour: it is the answer to an armoured roster.
    if (d > radius) continue;
    damage(e, dmg * (1 - 0.5 * d / radius), true);
    if (def && def.splashSlow) {
      applySlow(e, { slow: def.splashSlow, slowFor: def.splashSlowFor });
    }
  }
  S.fx.push({ kind: 'boom', x, y, r: radius, ttl: 420, life: 420 });
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
    damage(next, power, def.pierce);
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

  updateSupport(dt);

  // One polyline lookup per enemy per frame; everything downstream reads the
  // cached x/y.
  for (const e of S.enemies) {
    if (e.hp <= 0) continue;
    const ek = KINDS[e.kind];
    const factor = S.time < e.slowUntil ? e.slowFactor : 1;
    e.dist += e.speed * factor * dt / 1000;
    // Burning ticks before regeneration is considered, and goes through
    // damage() so it refreshes hurtUntil — which is what makes BURN the
    // answer to a regenerating roster rather than merely extra damage.
    if (e.burnUntil && S.time < e.burnUntil) {
      damage(e, e.burnDps * dt / 1000, true);
      if (e.hp <= 0) continue;
    }
    // Regeneration is held off by recent damage, so sustained fire beats it
    // and chip damage does not.
    if (ek.regen && S.time > e.hurtUntil + 1500 && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * ek.regen * dt / 1000);
    }
    const p = enemyPos(e);
    e.x = p.x; e.y = p.y; e.angle = p.angle;
    if (ek.boss) updateBoss(e, ek.boss);
    if (e.dist >= routeLen(e)) {
      e.hp = 0;
      e.leaked = true;
      S.lives--;
      S.dirty = true;
      sfx('leak');
      // Losing a life used to be a number quietly going down. It is the only
      // thing in the game that can actually end the run, so it gets the
      // loudest feedback in it.
      S.leakUntil = S.time + 420;
      shake(KINDS[e.kind].hp >= 8 ? 16 : 8, 220);
      if (S.lives <= 0) { S.lives = 0; finish(false); return; }
    }
  }

  for (const t of S.towers) {
    t.cool = Math.max(0, t.cool - dt);
    if (t.jammedUntil > S.time) continue;
    const range = towerRange(t);
    let target = null, furthest = -1;
    // Two passes. A phantom is passed over while there is anything else in
    // range to shoot, and picked normally when there is not.
    //
    // The first version made it flatly untargetable, which the bench showed
    // was unanswerable rather than hard: splash and chain only ever happen
    // because a shot LANDED, so with nothing targetable no tower fires, no
    // shot lands, and a wave of nothing but phantoms takes zero damage from
    // every tower in the game at any upgrade level. Hiding in a crowd instead
    // of hiding outright keeps the mechanic — splash is what digs them out of
    // a wave — and can never produce an enemy that simply cannot be hit.
    let ghost = null, ghostAt = -1;
    for (const e of S.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(t.x - e.x, t.y - e.y) > range) continue;
      if (KINDS[e.kind].untargetable) {
        if (e.dist > ghostAt) { ghostAt = e.dist; ghost = e; }
        continue;
      }
      if (e.dist > furthest) { furthest = e.dist; target = e; }
    }
    if (!target) target = ghost;
    if (!target) continue;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (t.cool > 0) continue;
    const def = towerDef(t);
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
      const def = s.from ? towerDef(s.from) : TOWERS[s.type];
      damage(e, s.dmg, def.pierce);
      if (def.slow) applySlow(e, def);
      if (def.burnDps) {
        // Refreshes rather than stacks: two fire towers on one target should
        // not multiply, and a burning enemy never gets the 1.5s of quiet its
        // regeneration needs.
        e.burnDps = s.dmg * def.burnDps;
        e.burnUntil = S.time + def.burnFor;
      }
      if (def.splash) {
        splash(e.x, e.y, def.splash, s.dmg * (def.splashDmg ?? 0.7), e, def);
      }
      if (def.chain) chain(s.from, e, def, s.dmg);
      if (!def.splash) {
        // Splash draws its own explosion; a spark on top of it is noise.
        S.fx.push({ kind: 'spark', x: e.x, y: e.y - KINDS[e.kind].size * 0.35,
                    type: s.type, ttl: 240, life: 240 });
      }
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

function towerRange(t)  { const d = towerDef(t);
  return d.range * (1 + TRACKS.range.step * t.up.range) * (d.rangeMul || 1); }
function towerDamage(t) { const d = towerDef(t);
  return d.dmg * (1 + TRACKS.dmg.step * t.up.dmg) * (d.dmgMul || 1); }
function towerRate(t)   { const d = towerDef(t);
  return Math.max(180, d.rate * Math.pow(1 - TRACKS.rate.step, t.up.rate)
                      * (d.rateMul || 1)); }
function towerLevel(t)  { return 1 + t.up.dmg + t.up.range + t.up.rate; }

/* ------------------------------------------------------------- render ---- */

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vw = canvas.width / dpr, vh = canvas.height / dpr;
  ctx.fillStyle = '#12180d';
  ctx.fillRect(0, 0, vw, vh);

  let sx = 0, sy = 0;
  if (S.time < S.shakeUntil) {
    // Decays over its life, so a hit lands hard and settles rather than
    // rattling at full strength and stopping dead.
    const k = (S.shakeUntil - S.time) / 220;
    const m = S.shakeMag * Math.min(1, k);
    sx = (Math.random() * 2 - 1) * m;
    sy = (Math.random() * 2 - 1) * m;
  } else {
    S.shakeMag = 0;
  }

  ctx.save();
  ctx.translate(ox + sx, oy + sy);
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
  drawDanger(vw, vh);
}

// "How close am I to losing?" answered without a number. Two sources feed the
// same red edge: a leak just happened, or the life buffer is nearly gone. The
// second is a steady breath rather than a flash, so a player under pressure
// feels it continuously instead of only at the moment of loss.
function drawDanger(vw, vh) {
  let a = 0;
  if (S.time < S.leakUntil) a = 0.55 * ((S.leakUntil - S.time) / 420);
  if (S.screen === 'play' && S.phase !== 'done' && S.maxLives) {
    const frac = S.lives / S.maxLives;
    if (frac <= 0.3) {
      const pulse = 0.5 + 0.5 * Math.sin(S.time / 380);
      a = Math.max(a, (1 - frac / 0.3) * 0.30 * (0.45 + 0.55 * pulse));
    }
  }
  if (a <= 0.004) return;
  const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.34,
                                     vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
  g.addColorStop(0, 'rgba(190,20,10,0)');
  g.addColorStop(1, `rgba(190,20,10,${a.toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vw, vh);
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

// A specialised tower has to be readable from the board, not only from the
// panel — a player deciding where the next one goes needs to see what is
// already down.
//
// This started as a disc carrying the spec's first three letters, which was
// unreadable: the map draws at about a fifth of its size on a phone, so
// thirteen pixels of badge becomes four and the text becomes nothing. The
// second try was a ring around the tower's footing, drawn after the sprite,
// which the sprite then covered half of. What survives phone scale is a pool
// of saturated colour on the GROUND, drawn before the tower stands on it.
function drawSpecMark(t) {
  const sp = specOf(t);
  if (!sp) return;
  const c = SPEC_COLOUR[sp.id] || '#d8b56a';
  ctx.save();
  ctx.translate(t.x, t.y + 2);
  ctx.scale(1, 0.44);                  // flattened, so it lies on the ground
  ctx.beginPath();
  ctx.arc(0, 0, 52, 0, Math.PI * 2);
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = c;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 8;
  ctx.strokeStyle = c;
  ctx.stroke();
  ctx.restore();
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
    drawSpecMark(t);
    const art = TOWER_IMG && typeof TOWER_ATLAS !== 'undefined'
      && TOWER_ATLAS[t.type] && TOWER_ATLAS[t.type].tiers[towerTier(t)];
    if (art) {
      const [sx, sy, sw, sh] = art;
      const s = Math.min(132 / sw, 132 / sh);
      const w = sw * s, h = sh * s;
      ctx.drawImage(TOWER_IMG, sx, sy, sw, sh, t.x - w / 2, t.y + 10 - h, w, h);
    } else {
      const im = IMG[TOWERS[t.type].art];
      if (!im || !im.naturalWidth) continue;
      const s = Math.min(132 / im.naturalWidth, 132 / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      ctx.drawImage(im, t.x - w / 2, t.y + 10 - h, w, h);
    }

    // A silenced tower must not look like a working one, or the player reads
    // it as their own build failing rather than as the boss doing something.
    if (t.jammedUntil > S.time) {
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.25 * Math.sin(S.time / 90);
      ctx.strokeStyle = '#c83bd8';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(t.x, t.y - 26, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(t.x - 30, t.y - 56);
      ctx.lineTo(t.x + 30, t.y + 4);
      ctx.stroke();
      ctx.restore();
    }

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
  // Support rings first, under every sprite, so a healer's reach reads as
  // ground it covers rather than as decoration on one figure. A player who
  // cannot see the radius cannot make the decision the radius exists for.
  for (const e of S.enemies) {
    const k = KINDS[e.kind];
    const sup = k.heal || k.aura;
    if (!sup || e.hp <= 0) continue;
    const heal = !!k.heal;
    ctx.save();
    ctx.translate(e.x, e.y + 4);
    ctx.scale(1, 0.44);
    ctx.beginPath();
    ctx.arc(0, 0, sup.range, 0, Math.PI * 2);
    ctx.globalAlpha = 0.11 + 0.05 * Math.sin(S.time / 420);
    ctx.fillStyle = heal ? '#6ce07a' : '#c9a227';
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 5;
    ctx.strokeStyle = heal ? '#8bf39a' : '#e8c24a';
    ctx.stroke();
    ctx.restore();
  }

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
    // Faded and drifting, because towers ignoring it entirely looks like a
    // targeting bug unless the thing they ignore is visibly not all there.
    if (k.untargetable) {
      ctx.globalAlpha = 0.42 + 0.16 * Math.sin(S.time / 260 + e.anim);
    }
    blitEnemy(anim, e.kind, e.x, e.y, e.angle, frame);
    const flash = FLASH_FRAMES[e.kind];
    if (flash && S.time < e.hurtUntil) {
      ctx.globalAlpha = 0.78 * ((e.hurtUntil - S.time) / HURT_MS);
      blitEnemy(flash, e.kind, e.x, e.y, e.angle, frame);
    }
    ctx.restore();

    if (e.auraUntil > S.time) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#e8c24a';
      ctx.beginPath();
      ctx.arc(e.x, e.y + k.size * 0.20 - k.size * 0.5, k.size * 0.42,
              0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // A raised shield has to be unmistakable: it is the reason damage is not
    // landing, and a player who cannot see it just thinks their towers broke.
    if (e.shieldHp > 0) {
      const frac = e.shieldHp / (e.shieldMax || 1);
      const r = k.size * 0.62;
      const cy = e.y + k.size * 0.20 - k.size * 0.5;
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.22 * frac;
      ctx.fillStyle = '#6fd6ff';
      ctx.beginPath();
      ctx.arc(e.x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.45 * frac;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#bfefff';
      ctx.beginPath();
      // Drawn as an arc that shrinks with the pool, so the shield visibly
      // takes damage rather than vanishing all at once.
      ctx.arc(e.x, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.restore();
    }

    const w = Math.max(34, k.size * 0.52);
    const top = e.y + k.size * 0.20 - k.size - 10;
    ctx.fillStyle = '#24150d';
    ctx.fillRect(e.x - w / 2, top, w, 6);
    ctx.fillStyle = KINDS[e.kind].hp >= 8 ? '#c46bff' : '#e94332';
    ctx.fillRect(e.x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), 6);
  }
}

function drawShots() {
  for (const s of S.shots) {
    const colour = TOWERS[s.type].colour;
    const art = TOWER_IMG && typeof TOWER_ATLAS !== 'undefined'
      && TOWER_ATLAS[s.type] && TOWER_ATLAS[s.type].shot;
    ctx.save();
    if (art) {
      const [sx, sy, sw, sh] = art;
      // The sprites are drawn pointing up, so the heading is rotated a
      // quarter turn. A bolt travelling sideways otherwise flies flat.
      const ang = Math.atan2(s.target.y - s.y, s.target.x - s.x) + Math.PI / 2;
      // 30 was the radius of the circle these replaced, and it made a painted
      // icicle read as a speck. A projectile has to be legible in flight.
      const k = 46 / Math.max(sw, sh);
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      ctx.shadowColor = colour;
      ctx.shadowBlur = 9;
      ctx.drawImage(TOWER_IMG, sx, sy, sw, sh,
                    -sw * k / 2, -sh * k / 2, sw * k, sh * k);
    } else {
      ctx.fillStyle = colour;
      ctx.shadowColor = colour;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// `sheet` may be the atlas itself or a pre-tinted canvas; the rectangle is
// the same either way.
function blitFx(sheet, spec, x, y, progress, scale) {
  const [sx, sy, fw, fh] = spec.r;
  const i = Math.min(spec.n - 1, Math.floor(progress * spec.n));
  const w = fw * scale, h = fh * scale;
  const ox = sheet === FX_IMG ? sx : 0;
  const oy = sheet === FX_IMG ? sy : 0;
  ctx.drawImage(sheet, ox + i * fw, oy, fw, fh, x - w / 2, y - h / 2, w, h);
}

function drawFx() {
  for (const f of S.fx) {
    const k = f.ttl / f.life;
    ctx.save();
    if (f.kind === 'boom') {
      const spec = FX_IMG && typeof FX_ATLAS !== 'undefined' && FX_ATLAS.boom;
      if (spec) {
        blitFx(FX_IMG, spec, f.x, f.y, 1 - k, (f.r * 2.3) / spec.r[2]);
      } else {
        ctx.globalAlpha = k;
        ctx.strokeStyle = '#f0563c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1.15 - k * 0.55), 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (f.kind === 'spark') {
      const spec = FX_IMG && typeof FX_ATLAS !== 'undefined' && FX_ATLAS.spark;
      const sheet = FX_SPARK[f.type];
      if (spec && sheet) blitFx(sheet, spec, f.x, f.y, 1 - k, 0.62);
    } else {
      // 'arc' is lightning chaining between enemies; 'jam' is a boss reaching
      // out to silence a tower. Same shape, opposite meaning, so they are not
      // allowed to be the same colour.
      const jam = f.kind === 'jam';
      ctx.globalAlpha = k;
      ctx.strokeStyle = jam ? '#c83bd8' : '#ffe34d';
      ctx.shadowColor = jam ? '#c83bd8' : '#ffe34d';
      ctx.shadowBlur = jam ? 18 : 12;
      ctx.lineWidth = jam ? 6 : 4;
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

// A level may forbid tower types outright. Cheaper than any other map
// mechanic and the one with the most effect on a build: a map that bans the
// splash tower is a different problem to the same map without the ban, and no
// amount of energy buys around it.
function banned(type) {
  const b = LEVELS[S.level] && LEVELS[S.level].ban;
  return !!(b && b.includes(type));
}

function buildSlots() {
  slotsWrap.innerHTML = '';
  for (const type of TOWER_ORDER) {
    if (banned(type)) continue;
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
// Announcements go in the DOM, not on the canvas. The board draws at roughly a
// fifth of its size on a phone, so text painted into the map is unreadable at
// any size worth using; a DOM banner is sized in viewport units and legible
// everywhere. Same reason the specialisation mark on a tower is a colour and
// not a word.
let bannerTimer = 0;
function banner(big, small, bad, ms) {
  const b = el('banner');
  b.querySelector('b').textContent = big;
  b.querySelector('i').textContent = small || '';
  b.classList.toggle('bad', !!bad);
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), ms || 1500);
}

// Shake is applied to the whole board rather than to anything in it, so it
// costs one translate and reads at any zoom.
function shake(mag, ms) {
  S.shakeMag = Math.max(S.shakeMag, mag);
  S.shakeUntil = Math.max(S.shakeUntil, S.time + ms);
}

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
  // The lives tile is the answer to "how close am I to losing", so below a
  // third of the buffer it pulses instead of sitting there.
  const livesTile = el('sLives').closest('.stat');
  if (livesTile) {
    livesTile.classList.toggle('danger',
      S.screen === 'play' && S.maxLives > 0 && S.lives / S.maxLives <= 0.3);
  }
  el('sGems').textContent = save.gems;
  el('sScore').textContent = S.score;
  el('waveLabel').textContent = `WAVE ${Math.max(1, S.wave)}/${WAVES.length}`;
  el('enemyCount').textContent = 'ENEMIES ' + (S.enemies.length + S.queue.length);
  for (const s of slotsWrap.children) {
    s.classList.toggle('poor', S.energy < TOWERS[s.dataset.type].cost);
  }
  const canStart = S.phase === 'ready' && S.wave < WAVES.length;
  el('startWave').disabled = !canStart;
  renderPreview();
  // The panel above just changed height, and in portrait the board's position
  // is measured from it.
  if (document.body.classList.contains('portrait')) {
    const vv = window.visualViewport;
    placeBands(vv ? vv.width : innerWidth, vv ? vv.height : innerHeight);
  }
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
  pushBack();
}
function closeUpgrade() {
  S.openTower = null;
  show('upgradeOverlay', false);
  if (S.phase !== 'done') S.running = true;
}

function renderUpgrade() {
  const t = S.openTower;
  if (!t) return;
  const sp = specOf(t);
  el('upgradeName').textContent = sp
    ? `${TOWERS[t.type].name.replace(' TOWER', '')} \u00b7 ${sp.name}`
    : TOWERS[t.type].name;
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
  renderSpec(t);
}

// The fork. Nothing at all until a track is maxed — a choice the player cannot
// yet make is only clutter — then two cards, then a banner naming what they
// bought. Buying is permanent: there is no sell-back on a spec, which is what
// makes it a decision rather than a setting.
function renderSpec(t) {
  const row = el('specRow');
  row.innerHTML = '';
  if (!specUnlocked(t)) return;

  const chosen = specOf(t);
  if (chosen) {
    row.innerHTML =
      `<div id="specHdr">SPECIALISED</div>` +
      `<div id="specHas"><div class="n">${chosen.name}</div>` +
      `<div class="d">${chosen.blurb}</div></div>`;
    return;
  }

  const hdr = document.createElement('div');
  hdr.id = 'specHdr';
  hdr.textContent = 'CHOOSE ONE — PERMANENT';
  row.appendChild(hdr);

  const pick = document.createElement('div');
  pick.id = 'specPick';
  const cost = specCost(t);
  for (const sp of SPECS[t.type]) {
    const b = document.createElement('button');
    b.className = 'specCard';
    b.disabled = S.energy < cost;
    b.innerHTML = `<span class="n">${sp.name}</span>` +
                  `<span class="d">${sp.blurb}</span>` +
                  `<span class="buy">${cost}</span>`;
    b.addEventListener('click', () => {
      if (t.spec || S.energy < cost) return;
      S.energy -= cost;
      t.spent += cost;
      t.spec = sp.id;
      S.dirty = true;
      sfx('build');
      toast(`${TOWERS[t.type].name} \u2192 ${sp.name}`);
      renderUpgrade();
    });
    pick.appendChild(b);
  }
  row.appendChild(pick);
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
  // SURVEYOR tightens the pad spacing rather than adding pads by hand, so the
  // extra ones land where the geometry already wanted one and never in the
  // water or across the road. See derivePads: the adjustment has to move the
  // along-road step as well as the between-pad gap, or it finds nothing.
  S.map = buildLevel(LEVELS[levelIndex], MAP_W, MAP_H,
                     owns('surveyor') ? PAD_SURVEY : 0);
  S.baked = renderLevel(S.map, makeCanvas);
  const d = DIFF[diff];
  S.energy = d.energy + (owns('quartermaster') ? 90 : 0);
  S.lives = d.lives;
  S.maxLives = d.lives;
  S.shakeUntil = 0; S.shakeMag = 0; S.leakUntil = 0;
  S.wager = []; S.wagerLive = []; S.roadTurn = -1;
  S.score = 0;
  S.wave = 0;
  S.phase = 'ready';
  S.restLeft = 0;
  S.queue = [];
  S.towers = []; S.enemies = []; S.shots = []; S.fx = []; S.corpses = [];
  S.openTower = null;
  S.selectedType = TOWER_ORDER.find(t => !(LEVELS[levelIndex].ban || []).includes(t)) || 'fire';
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
// Cached as a canvas, and COPIED into a fresh canvas per card.
//
// Two traps here, one after the other. cloneNode on a canvas copies the
// element and none of its bitmap, so the first version drew blank cards. The
// fix — cache a data URL and use an <img> — works over http and throws from
// file://: drawing the prop atlas taints the canvas, toDataURL refuses, and
// the level select comes up EMPTY. That is exactly the Android WebView case,
// where the app loads from file:// and there is no server to be same-origin
// with. Copying canvas to canvas needs no export and works in both.
const thumbCache = {};
function levelThumb(spec) {
  if (!thumbCache[spec.id]) {
    const full = renderLevel(buildLevel(spec, MAP_W, MAP_H), makeCanvas);
    const t = makeCanvas(384, 216);
    t.getContext('2d').drawImage(full, 0, 0, 384, 216);
    thumbCache[spec.id] = t;
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

    const shot = makeCanvas(384, 216);
    shot.className = 'thumb';
    shot.setAttribute('aria-hidden', 'true');
    shot.getContext('2d').drawImage(levelThumb(lvl), 0, 0);
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
      pushBack();
    });
    grid.appendChild(card);
  });
  el('levelTotal').textContent = `${totalStars()} / ${LEVELS.length * 3} STARS`;
  show('levelOverlay', true);
  pushBack();
}

function openShop() {
  renderShop();
  show('shopOverlay', true);
  pushBack();
}

function renderShop() {
  el('shopGems').textContent = `${save.gems} GEM${save.gems === 1 ? '' : 'S'}`;
  const list = el('shopList');
  list.innerHTML = '';
  for (const id of UNLOCK_ORDER) {
    const u = UNLOCKS[id];
    const had = owns(id);
    const afford = save.gems >= u.cost;
    const row = document.createElement('button');
    row.className = 'shopRow' + (had ? ' owned' : afford ? '' : ' poor');
    row.disabled = had || !afford;
    row.innerHTML =
      `<span class="txt"><span class="n">${u.name}</span>` +
      `<span class="d">${u.blurb}</span></span>` +
      `<span class="buy">${had ? 'OWNED' : u.cost + ' \u25c6'}</span>`;
    row.addEventListener('click', () => {
      if (owns(id) || save.gems < u.cost) return;
      save.gems -= u.cost;
      save.unlocks[id] = true;
      persist();
      sfx('win');
      toast(`${u.name} UNLOCKED`);
      renderShop();
      syncMenu();
    });
    list.appendChild(row);
  }
}

function toMenu() {
  S.screen = 'menu';
  S.running = false;
  hud.classList.add('hide');
  show('resultOverlay', false);
  show('upgradeOverlay', false);
  show('diffOverlay', false);
  show('levelOverlay', false);
  show('shopOverlay', false);
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

  if (banned(S.selectedType)) return;
  const def = TOWERS[S.selectedType];
  if (S.energy < def.cost) { toast('NOT ENOUGH ENERGY'); return; }
  S.energy -= def.cost;
  S.towers.push({
    x: pads[pick][0], y: pads[pick][1], pad: pick, type: S.selectedType,
    up: { dmg: 0, range: 0, rate: 0 }, spec: null, jammedUntil: 0,
    spent: def.cost, cool: 260, angle: 0,
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
el('menuShop').addEventListener('click', () => { audio(); openShop(); });
el('shopClose').addEventListener('click', () => show('shopOverlay', false));
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

/* Android's back button.
 *
 * A WebView with no history has exactly one response to back: close the app.
 * From inside a level that loses the run; from the level select it is merely
 * wrong. Each overlay pushes a history entry when it opens, so back pops that
 * entry instead and the handler closes the topmost thing. Only a back press
 * with nothing open falls through to leaving.
 */
let backDepth = 0;
function pushBack() {
  backDepth++;
  try { history.pushState({ td: backDepth }, ''); } catch (_) {}
}
function closeTopmost() {
  if (el('upgradeOverlay').classList.contains('show')) { closeUpgrade(); return true; }
  if (el('shopOverlay').classList.contains('show')) { show('shopOverlay', false); return true; }
  if (el('diffOverlay').classList.contains('show')) {
    show('diffOverlay', false); return true;
  }
  if (el('levelOverlay').classList.contains('show')) {
    show('levelOverlay', false); return true;
  }
  if (el('resultOverlay').classList.contains('show')) { toMenu(); return true; }
  // In a level with nothing open: back returns to the menu rather than
  // quitting the app, which is what a player means by it.
  if (S.screen === 'play') { toMenu(); return true; }
  return false;
}
addEventListener('popstate', () => {
  if (backDepth > 0) backDepth--;
  if (closeTopmost()) pushBack();     // stay one entry deep while anything is open
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
Promise.all([loadAssets(), loadEnemyArt(), loadPropAtlas(),
              loadTowerAtlas(), loadFxAtlas()]).then(() => {
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
