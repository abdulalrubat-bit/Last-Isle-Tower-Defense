# Island Defence

A tower defence with a six-map campaign. Fifteen waves a map, four towers,
three difficulties, stars per map, maps unlocking in order.

**The terrain is composed, not painted.** There is no background image: the
ground is a tiling texture, the road is a texture pattern-filled along a
spline, and the scenery is painted props scattered by the code that knows
where the road is. A map is about ten lines of data.

Hand-written, no engine. Offline once loaded, no accounts, no network calls,
nothing leaving the device. Saves stars, gems and the two audio toggles to
`localStorage` and nothing else.

```
index.html     shell, HUD, overlays, all CSS
map.js         terrain: geometry, build pads, renderer
enemies.js     drawn enemies — the fallback when a kind has no art
props-data.js  GENERATED atlas manifest — tools/build-props.py writes it
towers-data.js GENERATED atlas manifest — tools/build-towers.py writes it
fx-data.js     GENERATED atlas manifest — tools/build-fx.py writes it
game.js        the game, and the campaign
assets/        58 files, 1.4MB — prop, tower and fx atlases, enemy sheets, UI
sw.js          offline cache — generated, run tools/stamp-sw.py
tools/         props, towers, fx, enemy sheets, sprites, balance sim, stamper
```

Open `index.html` over http, or from `file://` — the service worker is skipped
there on purpose, so local dev and a WebView build both work.

## The one idea

A level is data:

```js
{ id:'landing', name:'FIRST LANDING', palette:'island', hp:1.00, seed:20260912,
  props:300, decor:620,
  control:[[-40,700],[240,690],[430,640],[520,500],[660,430],[860,470],
           [980,380],[1010,240],[1200,190],[1400,230],[1580,300]],
  water:[{x:1210,y:585,rx:185,ry:80,rot:-.08}] }
```

Those control points are sampled into a dense polyline. The renderer **strokes
that polyline to draw the road**, and the game **walks the same array**. They
cannot disagree, because there is only one of them.

That inverts how this used to work. The first version had a painted JPEG per
map and the enemy path was reverse-engineered back out of it by colour-keying
sand pixels — art first, gameplay inferred from it. Every consequence of the
inversion is a win:

- **Build pads are derived, not listed.** Stepped along the road, alternating
  sides, auto-rejecting anything near water, the map edge or another pad.
- **Pad distance is one constant.** It is also the single most important number
  in the balance — see below — and it can no longer drift per map.
- **Biome is a kit swap.** Twelve kits, all the same renderer with a different
  ground tile, road texture and prop set.
- **Level select thumbnails are free**: the same renderer at card size.
- **The menu backdrop is a level** — the furthest one unlocked.
- **A new map costs about ten lines and zero bytes.**

Everything is composited once into an offscreen canvas when a level starts, so
a map with three hundred props costs exactly one `drawImage` per frame — the
same as the background JPEG it replaced. It measures 55–61fps with a boot of
about 700ms.

Two cheap things carry the cartoon look and both are load-bearing: every solid
shape gets a dark outline, and every highlight falls to the top-left. Without
them it reads as a diagram rather than a game board.

## Towers

Four types, three tiers each, and a projectile per element — all from the pack:

```sh
python3 tools/build-towers.py ~/art/Tower_Assets_2/PNG
python3 tools/stamp-sw.py
```

The pack ships each tower as **three tiers**, which the game had not been using
— it drew one flat sprite per type, and not even consistently: the file called
`tower_arcane` was tier *three* of the dark tower while `tower_bolt` was tier
*one* of the temple. The tool maps them by exact pixel size against what the
game already shipped rather than by eye.

A tower's art now steps up as it is upgraded: levels 1–3 tier one, 4–6 tier
two, 7–10 tier three. Uneven on purpose — tier two arrives early enough that
the first real investment in a tower is visible on the board and not only in
the upgrade panel.

Projectiles are the pack's own per element, rotated to their heading. The
sprites are drawn pointing up, so the heading gets a quarter turn added; a bolt
travelling sideways flew flat without it.

Tier one is also written out as a standalone `tower_<type>.png`. That is what
the HUD slot shows, and what the board falls back to if the atlas fails — a
tower that does not draw at all is worse than a tower without tiers.

Impacts come from the same pack:

```sh
python3 tools/build-fx.py ~/art/Tower_11/PNG
```

An eight-frame explosion for the arcane splash, which used to be an expanding
circle, and a four-frame spark burst for every other hit — **tinted per tower
type at load**, so a hit tells you which tower landed it. Tinting at draw time
would be a composite pass per hit per frame; baked once, a hit is a
`drawImage`. Frames in a sequence are different sizes because the effect
expands, so they are padded to a common box rather than trimmed to one: trimmed
individually, the burst drifts as it plays.

## Specialisations

Three stat tracks — damage, range, fire rate, three levels each — make a tower
bigger. They never make it a *different* tower, and the simulation had already
shown that what decides a level is which tower answers its roster. So maxing
any track opens a permanent, one-time fork: two specialisations per tower,
bought once, no sell-back.

| tower | | |
|---|---|---|
| **fire** | BURN — less hit damage, sets alight; ignores armour, stops regen | SCORCH — fires slower, every shot bursts |
| **ice** | SHATTER — barely damages; what it slows takes +55% from *every* tower | DEEP FREEZE — almost no damage; slows harder, longer, and slow-immune kinds |
| **bolt** | OVERLOAD — weaker bolts, arcs to four more | LANCE — no chain, slower, double damage through armour |
| **arcane** | SIEGE — far wider blast, a third less reach | RIFT — half again the reach, hits for little, drags what it catches |

Each answers a threat the next-wave panel names, so the warning and the
purchase are one conversation. SHATTER is the odd one and the point of the
set: it is the only tower whose worth depends on what is standing around it.

**Every fork costs something.** See the Balance section for what happened when
they did not. Tune them with `node tools/sim.mjs --forks`, which varies one
fork at a time against a fixed build and reports where each is the best answer.
The target shape is every option best *somewhere* and best *nowhere near
everywhere*.

`node tools/specs.mjs` asks the other question — whether a fork does anything
at all. A behaviour that silently fails scores exactly like the base tower, so
a sweep cannot see it; the bench puts one tower against one enemy kind and
reads the mechanic directly.

A specialised tower is marked on the board by a pool of the mechanic's colour
on the ground under it. Text does not work there: the map draws at about a
fifth of size on a phone, so a thirteen-pixel badge becomes four and its
letters become nothing.

## Permanent progression

Gems — one a wave, five a level — buy four permanent unlocks from the workshop
on the menu. Kept forever and applied to every level including ones already
cleared, so a player stuck on hard has something to do other than retry.

| unlock | gems | opens |
|---|---|---|
| **QUARTERMASTER** | 30 | +90 starting energy — a *fourth* tower in the opening, not a better third |
| **FIELD TRAINING** | 45 | specialisations at two levels in a track instead of three |
| **SURVEYOR** | 60 | tighter pad spacing on every map (2–5 more pads) |
| **DOUBLE OR NOTHING** | 80 | two wagers on one wave, risks and payouts multiplied |

215 gems for all four against roughly 120 for a campaign — the second run is
the point. None of them raises a number for its own sake; the closest is
QUARTERMASTER, chosen so it changes the *shape* of the opening.

**SURVEYOR took three tries to do anything at all.** `derivePads` has two
independent constraints: `minGap` (how far a new pad must be from existing
ones) and a step along the road deciding how often a pad is even considered.
Lowering only `minGap` found zero extra pads on every map, because the step was
the thing saying no. With both moving, −20 still found none on `deepwood`,
whose road sits just the wrong side of the threshold. −40 gains two to five on
every map. An unlock that does nothing on one of seven levels is worse than no
unlock.

Unlocks are off by default and the simulation buys none, so the balance table
measures the game without them.

## Map mechanics

A level may declare a **second road** in `control2`. Enemies alternate between
roads strictly rather than randomly, so a two-entrance map always presents both
and never rolls a wave down one of them by chance. A level may also **ban
tower types** — the cheapest mechanic here and the one with most effect on a
build, since no amount of energy buys around a missing splash tower.

`THE CROSSROADS` uses both. Routes live behind `pathPointAt`: `routes` is the
array everything reads, and `path` / `seg` / `length` remain aliases to the
first, so every single-road level is untouched. Pads come off every road and
must clear all of them; splitters and summoners put children on the parent's
road.

Three things to know before adding another:

- **The sim's bot places towers directly**, not through the tap handler, so it
  will build a banned tower unless told not to. It is told not to now.
- **Check road-against-ground contrast before picking a palette.** `forge` has
  six points of luminance between its road and its dirt, which on a map about
  covering two roads made both nearly invisible. `ash` is fifty, about where
  jungle sits.
- **A two-road level is violently sensitive to `hp`.** 0.58 gave 21 of 27 wins
  on hard where the campaign runs 1 to 4 of 9; correcting to 1.25 walled it on
  *easy* at 2 of 27. It sits at 0.82. Bisect, and re-run with `--runs 3`.

## Wagers

A bet on the next wave, taken during the rest and spent the moment it starts.

| wager | risk | pays |
|---|---|---|
| **SWIFT** | +30% enemy speed | +45% energy |
| **HARDENED** | −22% damage dealt to them | +50% energy |
| **HORDE** | +40% enemy numbers | +40% energy |

One per wave and never compulsory — take one when you are ahead and want the
tempo, decline when you are not. Until this existed the only choice between
waves was what to buy, and buying is never a risk.

Two rules that matter:

- **HORDE swells the ordinary ranks, not the boss count.** Three demons on
  wave ten is not a harder version of that wave, it is a different and much
  worse one.
- **The bet is locked at wave start.** `S.wager` is what is selected;
  `S.wagerLive` is what the wave in flight is running under. Without the pair,
  choosing for the next wave would retroactively change the current one.

None of the simulation's builds take a wager, so the balance table measures
the game without them and a wager can only be something a player reaches for,
never a tax they have to beat.

## Support enemies

Three roles whose value is in what they do for the enemies *around* them, which
is what makes target priority a decision. Every other kind is worth shooting in
the order it arrives; these are worth shooting first.

| kind | does | the answer |
|---|---|---|
| **SHAMAN** | heals every nearby enemy a little each second | out-damage the heal, or kill the shaman |
| **BULWARK** | nearby enemies take reduced damage while it lives | kill it — splash does *not* bypass an aura the way it bypasses armour |
| **PHANTOM** | towers pass over it while anything else is in range | splash, to dig it out of the crowd it hides in |

`support` is a fifth wave role alongside fodder / fast / heavy / boss. Every
curve schedules it on four waves of fifteen, and a level opts in by naming one
in its roster — a roster with no `support` fields none, which is why the
opening level stays a plain fight.

Two numbers here are load-bearing:

- **The bulwark's aura multiplies whatever armour already did.** A siege
  roster's heavies sit at 0.62 before it applies; pairing that with a 0.62 aura
  left 38% of a hit landing and made three levels unwinnable on hard. It stays
  mild deliberately.
- **Support on nearly every wave is a flat tax, not a mechanic.** Scheduled
  from wave six onward it put four levels out of reach on hard while the units
  themselves measured fine in isolation. Sparse, each arrival is a thing to
  notice.

**The phantom was unanswerable on its first cut** and `tools/specs.mjs`-style
benching is the only reason that was caught. Made flatly untargetable, it took
*zero* damage from every tower in the game at any upgrade level — because
splash and chain only ever fire as a consequence of a shot landing, so with
nothing targetable no tower shoots, no shot lands, and there is no splash. It
now hides *in a crowd* rather than outright: alone it is targeted normally,
which keeps the mechanic (splash digs it out) and makes an unhittable enemy
impossible to construct.

## Bosses

Three, one mechanic each, spread across the campaign as part of a level's
roster:

| boss | mechanic | the answer |
|---|---|---|
| **DEMON LORD** | SHIELD — an absorbing pool that goes up, holds, drops, refreshes | burst it down; chipping never gets through before it refreshes |
| **THE WARLORD** | JAM — silences the nearest tower it walks past, then the next | towers spread along the road, not one strong killbox |
| **THE MATRIARCH** | SUMMON — drops fodder behind itself as it walks | kill it fast, or carry something that clears crowds |

The next-wave panel warns three waves out with the mechanic's name, derived
from the boss kind rather than written per level.

**SUMMON's cap is a budget for the WAVE, shared by every summoner in it.**
This has now been paid for twice. Uncapped it put out sixty extra enemies in
one crossing and made both its levels unwinnable on *easy*. Capped per boss it
bounded a single summoner correctly — and then the siege curve's final wave
fielded two, doubled the flood, and took both levels that use that boss to
**0 of 27 runs** on hard, reaching wave 15 and dying there every time. Bound
the total the player actually faces; never the rate, never the per-unit share.

`node tools/bosses.mjs` benches each mechanic in isolation. Read the SHIELD
pair: chipping leaves the pool up for hundreds of frames across several cycles
and the boss lives; adding burst collapses it in one cycle and kills it. If
those two lines ever look alike, the shield has gone back to being hit points.

**What bosses do not do**, measured: they do not change *which build wins* a
level. Two waves in fifteen carry a boss and the other thirteen decide the
run, so the spread by boss type sits inside the sweep's own noise. The one
real signal is `boss-killer/lance` at 4/6 against SHIELD and 2/6 against
SUMMON — single-target damage being the wrong answer to a summoner. Making
bosses central enough to move the answer is a larger change than adding them
was.

Warlord and matriarch reuse the sentinel's and ogre's sheets at boss scale.

## Telling the player what is coming

Between waves the HUD shows the next wave's roster as portraits with counts,
threat warnings, and how far off the next boss is. All of it is **derived**
from the level's roster and its wave curve — ARMOUR appears because a kind in
that wave has `armour` below one, AIR because one has `flying`, and so on,
each test reading the exact property the combat code reads. Swap a level's
heavy for an armoured one and the warning follows for free.

A threat that is new this wave is loud; one carried over from the wave before
is muted. The first version warned on every wave the threat applied to, which
was correct and useless — a siege level showed ARMOUR fifteen times out of
fifteen. A signal that is always on is wallpaper.

`node tools/layout.mjs` checks every HUD box against every other at six
viewports and exits non-zero on an overlap. It exists because the wave counter
shipped drawn *on top of* the stats box on a portrait phone, and no unit test
would have caught that.

## Where the terrain comes from

The pack ships each map as **separate layers** rather than as a flat picture: a
tileable ground texture, road pieces, and painted trees, bushes, stones and
decorations — four complete biome kits. `tools/build-props.py` packs all of it
into one atlas.

```sh
python3 tools/build-props.py ~/art/Tower_tileset/PNG
python3 tools/stamp-sw.py
```

The road is the interesting part. The pack's road pieces are **fixed corners
and junctions**, so they cannot follow an arbitrary spline and none of them are
used as tiles. What is used is the texture *inside* them: a square is cut from
the middle of the straight piece, and the road is stroked into a scratch canvas
and that texture composited into it with `source-in`. A stroke cannot be a clip
region, so this is the way to pattern-fill one — and it is what lets painted
road art follow a road it was never drawn for.

Three things that needed correcting once it was on screen, none of them
visible in the source art:

- **The road vanished.** Several kits paint road and ground at nearly the same
  value — the meadow road is pale yellow-green on pale green — and rely on a
  dark border for the contrast. Drawn faintly, the lane disappeared into the
  field. The border is now derived from the sampled edge at 0.42 brightness.
- **The ground needed to come down a shade** so the road could be the lighter
  of the two. A flat amount crushed the ash kit, which is nearly black to start
  with and is the map whose boss is a black horned demon, so the amount is
  scaled by the ground tile's own measured luminance.
- **Frost swamped itself.** It ships no trees, so its tall crystal growths were
  the tallest thing on the board at the height decor was given. Decor now caps
  below tree height.

Everything is still composited once per level into an offscreen canvas, so a
map with ninety painted props costs one `drawImage` per frame.

## How many different levels are actually possible

Not a rhetorical question — `tools/sim.mjs --rosters N` measures it. It holds
the map and difficulty fixed, varies the **wave curve and the roster**, and
reports which of five build strategies clears each result. Two levels the same
builds beat are the same puzzle in different scenery.

**Visually: twelve biome kits × any path you draw × any seed.** Effectively
unlimited; the kits start repeating somewhere past twenty levels.

**Mechanically: five or six distinct puzzles**, each tunable to several
difficulty points. Sixty-four curve+roster pairs on a neutral map produced six
distinct outcomes. The six-level campaign uses four of them.

Three levers decide that number, and they were built in the order they matter:

- **The roster.** Which kinds fill fodder / fast / heavy / boss. Alone it gave
  six outcomes from forty rosters, but thirty-one fell into two buckets,
  because the **fodder slot decided nearly everything** — a wave is 8–20 fodder
  against 2–8 heavies, so the fodder is what the towers spend their time
  shooting.
- **The curve.** `standard`, `siege` (heavies from wave two, little fodder),
  `swarm` (almost nothing but fodder, in numbers), `rush` (fast units front to
  back). This is the lever the roster did not have: it changes which *slot*
  matters, so the fodder stops deciding alone.
- **Counter-mechanics.** `armour` (splash ignores it), `slowImmune`, `flying`
  (crosses in a straight line between the road's two ends, so every pad chosen
  to cover a bend covers nothing), `regen` (heals unless hit recently, so chip
  damage stops working), `split` (on death becomes two of something else).

Raising the number further means another lever, not another level. A second
spawn point, or towers that can be repositioned, would each add one.

## Balance

Simulation-checked, not guessed. `tools/sim.mjs` runs the real `game.js`
headlessly through all seven maps, three difficulties and nine build
strategies — 189 runs in a couple of minutes.

```
level           easy         normal        hard
1. landing      9/9 win 23/25 8/9 win 11/20 4/9 win 7/18
2. palmrun      9/9 win 22/25 7/9 win 12/20 2/9 win 4/18
3. deepwood     9/9 win 25/25 7/9 win 15/20 0/9 · w15
4. millpond     9/9 win 22/25 7/9 win 14/20 3/9 win 8/18
5. frostgate    9/9 win 25/25 5/9 win 15/20 1/9 win 1/18
6. longroad     9/9 win 25/25 7/9 win 14/20 1/9 win 3/18
7. crossroads   7/9 win 22/25 6/9 win 11/20 1/9 win 3/18
```

Easy is comfortable, normal is cleared by most builds, hard is tight and
winnable on every map. Read it as a spread: a level nothing clears is a wall,
a level everything clears is not asking anything.

**The sweep is noisy.** The wave queue is shuffled, so repeating it on
unchanged code moves each strategy by about two runs in eighteen, and a level
sitting near the edge on hard can read 0/9 one run and 3/9 the next. A one-run
lead means nothing.

**Before believing a level is a wall, re-run it with `--runs 3`.** The
difference is not subtle once you do: `deepwood` and `frostgate` came back
0 of 27 on hard — a real wall, fixed by making the summon cap a wave budget —
while `longroad` read 0/9 in the same sweep and 3/27 over three runs, which is
just noise. One of those needed a code change and the other needed nothing,
and a single sweep cannot tell them apart.

Four things the simulation found that reading the code would not have:

- **Pad distance from the road is the whole balance.** An early pad set sat
  92–168px off the centreline, where a 190-range tower covers a thin slice of
  road and lands two shots on a passing enemy. Hard was unwinnable for
  geometric reasons, not difficulty ones. Moving pads to the verge fixed it
  without touching a damage number. Pads now sit at a fixed 84px, derived.
- **Six maps that played identically.** With `hp` flat the sim reported the
  same result to the wave on all six. The cause was in the code, not the maps:
  enemy speed was `map.length / 22`, normalising every road to a 22-second
  crossing, so road length had no mechanical effect at all. Speed is now fixed
  in pixels per second, which makes a longer road genuinely easier — more
  seconds under fire — and a level pays for its length with fewer build pads.
- **A two-target chain made lightning strictly the best tower at any price.**
  It chains once now, and costs more.
- **Ice and arcane were priced as damage towers while dealing almost none**, so
  an opening built on them lost by wave 3.
- **Specialisations that only give are not choices.** The first version of the
  tower forks cost energy and nothing else. A mixed build taking either spec
  set won 17 or 18 of 18 against 16 for the same build without them, and
  cleared the hardest level without losing a life. Every fork now trades away
  damage, rate or reach for what it gains — which is the only thing that lets
  a fork be the *wrong* pick on a given level.
- **A spec set hides which half of it is working.** Measured as pairs,
  `scorch+freeze` beat `burn+shatter` and the reason was invisible. Varying one
  fork at a time (`--forks`) showed SCORCH best on eleven of twelve
  level-and-difficulty pairs — strictly correct, therefore not a decision — and
  BURN *worse than buying nothing*, a trap. Both are now middling.

Starting energy is deliberately similar across difficulties: it has to buy an
opening of three towers everywhere. Hard starting at two towers was a cliff,
not a curve.

## Tools

```sh
# Balance, after any change to a level or a tower
npm i playwright && node tools/sim.mjs          # the summary table above
node tools/sim.mjs --full                       # every run, itemised
node tools/sim.mjs --level deepwood --runs 3    # one map, repeated
node tools/sim.mjs --rosters 40                 # how distinct can levels be
node tools/sim.mjs --forks                      # one tower fork at a time

# Does each specialisation actually DO anything? (a sweep cannot tell)
node tools/specs.mjs

# Does each boss mechanic fire, and can it be answered?
node tools/bosses.mjs

# Does the HUD collide with itself at any size?
node tools/layout.mjs

# Replace art (towers, enemies, UI — no backgrounds)
python3 tools/build-assets.py --list ~/art        # what filenames are accepted
python3 tools/build-assets.py ~/art --dry-run     # what would change
python3 tools/build-assets.py ~/art               # do it

# After ANY change to shipped files
python3 tools/stamp-sw.py
```

**To add a map**: append to `LEVELS` in `game.js`. Control points run off the
left and right edges (`-40` and `1580`) so the road enters and leaves the
board cleanly. Then run the sim and set `hp` and `padGap` from what it reports
— those two are the difficulty dial, and guessing them is how levels 4–6 first
came out as walls.

## Enemies

Four kinds, each a painted sprite sheet built from the pack:

```sh
python3 tools/build-enemies.py ~/art/Tower_5/PNG --contact  # see all ten types
python3 tools/build-enemies.py ~/art/Tower_5/PNG            # build the sheets
python3 tools/stamp-sw.py
```

One sheet per animation, frames left to right — eighty loose frames would be
eighty requests. Three details in that tool are load-bearing:

- **One bounding box per animation, not per frame.** Trimming each frame to its
  own content makes the sprite jitter as it plays, because the trim moves
  underneath it.
- **Palette quantisation.** Painted sprites drawn at 110–250px do not need
  full-depth RGBA: 2.28MB became 257KB with no visible difference.
- **Ten frames, not twenty.** Twenty at 92ms is a two-second walk cycle; ten
  reads identically and halves the file.

`enemies.js` draws the four kinds from scratch — jointed figures with walk
cycles, an outline and a light direction, matching the terrain. Nothing uses it
now that the art is in, and that is the point: it is the fallback. Set a kind
to `null` in `ENEMY_ART` and it draws rather than disappears.

## Dropping in the real art

Every sprite the game ships was *recovered* from the pack's JPEGs by keying out
the black background. That works, but it is inferred: JPEG had no alpha to
begin with, so the edges are a guess. Real art with a real alpha channel is a
straight upgrade, and it needs no code change at all.

**You can do this a few files at a time.** Anything you do not supply keeps the
version already in the game, so there is no all-or-nothing drop and nothing to
finish in one sitting.

1. **Make a folder** anywhere — `~/art`, say. It does not go in the repo.

2. **See what it accepts**, which is also the shopping list:

   ```sh
   python3 tools/build-assets.py --list ~/art
   ```

   Each row shows one output file and the filenames that produce it. Both
   spellings work — the pack's (`tower_lightning.png`) and the game's
   (`tower_bolt.png`) — so you never have to remember which is which.

3. **Export into that folder.** The rules:
   - **PNG with a real alpha channel.** This is the whole point; alpha is used
     exactly as given and nothing is inferred. Art delivered flat on black
     still works — it gets keyed — but you gain nothing over what is there now.
   - **Any extension is fine.** The name before the dot is what matters.
   - **Bigger than the cap is fine**, it downscales. Smaller gets upscaled and
     will look soft, so treat the cap in the `--list` output as a minimum.
   - **No padding.** Trim to the artwork; the game positions by the image box.

4. **Check before committing to it:**

   ```sh
   python3 tools/build-assets.py ~/art --dry-run
   ```

   Every line ends `(alpha)` or `(keyed)`. `(alpha)` means it used your real
   transparency. `(keyed)` means that file had none and it fell back to keying
   black — if you expected alpha there, the export is flattened, so fix it and
   re-run. It also lists what it is leaving alone.

5. **Run it, then stamp the service worker:**

   ```sh
   python3 tools/build-assets.py ~/art
   python3 tools/stamp-sw.py
   ```

   The stamp is not optional. `sw.js` caches by a hash of the shipped bytes,
   and without a re-stamp anyone with the game installed keeps the old art
   forever, on a device you cannot reach.

6. **Look at it**, then commit `assets/` and `sw.js` together.

### If you are drawing new art rather than using the pack

Same steps — name the files by the **output** name from `--list`. Two worth
knowing about:

- `hdr_victory.png` currently reads "ACHIEVEMENT", because that is the closest
  thing to a celebratory header in the pack. It wants a real one.
- `enemy_run_0.png` … `enemy_run_9.png` are the only enemy art in the game.
  Grunt, runner, brute and boss are all that one set at different scales and
  tints. A second set is the single biggest visual upgrade available, and it
  needs a code change as well as art — say the word and I will wire it up.

To add an asset that does not exist yet, add a row to `tools/assets.json`
(`"source-name.png": ["output-name.png", cap]`) and reference the output name
from `index.html` or `game.js`.

## Known gaps

Deliberate omissions, not oversights:

- **The original art has not been dropped in yet.** Every sprite is *recovered*
  from the pack's JPEGs by keying the black surround — good, but inferred.
  See **Dropping in the real art** above. This no longer touches backgrounds,
  only towers, enemies and UI.
- **Bosses do not change which build wins.** They have real mechanics now, but
  at two boss waves in fifteen the other thirteen decide the run. Moving that
  needs bosses to be more central — more boss waves, or a mechanic that
  persists past the boss's death — not more mechanics.
- **Two bosses wear borrowed art.** Warlord is the sentinel's sheet and
  matriarch the ogre's, both at boss scale.
- **The renderer has no elevation.** Cliffs, bridges and roads that cross are
  all off the table until it understands height. Second entrances and tower
  bans exist; conveyors and hazards do not.
- **No music.** The toggle persists and the sound effects are synthesised
  oscillators — there are no audio assets in the pack at all.
- **No achievements.** The pack has a window for them; nothing opens it,
  because there are no achievements yet to put in it.
- **The victory header reads "ACHIEVEMENT"** — the closest thing to a
  celebratory header the pack has. It wants a real one.
- **Only walk and die are used.** The pack also ships attack, hurt, idle, jump
  and run per type. An attack animation when something reaches the end is
  art-complete and code-only.
- **Water is still drawn, not painted.** The pack ships a `lake.png` per kit;
  the game draws an ellipse. It shows most on the dark kits — a bright pond in
  a volcano should probably be lava.
- **The pack has a second tower family** — catapults and ballistae, with archer
  units that have their own bow animations. A tower that fires a visible unit
  rather than a bolt would use them, and nothing does yet.
- **Chain lightning is still drawn**, not painted: the arc between chained
  targets is a stroked line. The pack has no art for it, so this one would
  stay drawn even with everything else swapped.
- **Android packaging has never been done.** The two blockers a WebView build
  would have hit are fixed — the level select renders from `file://`, and the
  hardware back button walks the overlay stack down to the menu — but nothing
  has been wrapped, signed or run on a device.
