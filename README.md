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
assets/        46 files, 976KB — prop, tower and fx atlases, enemy sheets, UI
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
- **Biome is a kit swap.** Meadow, desert, frost and ash are the same renderer
  with a different ground tile, road texture and prop set.
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

## Balance

Simulation-checked, not guessed. `tools/sim.mjs` runs the real `game.js`
headlessly through all six maps, three difficulties and five build strategies
— ninety runs in a few seconds.

```
level           easy            normal          hard
1. landing      10/10 win 25/25 8/10 win 18/20  5/10 win 4/18
2. palmrun      10/10 win 25/25 8/10 win 18/20  5/10 win 8/18
3. deepwood     10/10 win 25/25 8/10 win 17/20  4/10 win 5/18
4. millpond     10/10 win 25/25 8/10 win 17/20  2/10 win 3/18
5. frostgate    10/10 win 25/25 8/10 win 16/20  3/10 win 6/18
6. longroad     10/10 win 25/25 10/10 win 19/20 4/10 win 8/18
```

Easy is comfortable, normal is cleared by four of five builds, hard is tight
and winnable on every map. Read it as a spread: a level nothing clears is a
wall, a level everything clears is not asking anything.

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

Starting energy is deliberately similar across difficulties: it has to buy an
opening of three towers everywhere. Hard starting at two towers was a cliff,
not a curve.

## Tools

```sh
# Balance, after any change to a level or a tower
npm i playwright && node tools/sim.mjs          # the summary table above
node tools/sim.mjs --full                       # every run, itemised
node tools/sim.mjs --level deepwood --runs 3    # one map, repeated

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
- **The victory header reads "ACHIEVEMENT"** — the closest thing to a
  celebratory header the pack has. It wants a real one.
- **Four enemy types, but ten exist.** The pack carries ten types with seven
  animations each. Four are used — goblin, scorpion, ogre, horned demon —
  chosen so no two silhouettes can be confused. Adding more is editing `PICK`
  in `tools/build-enemies.py` and a row in `KINDS`.
- **Only walk and die are used.** The pack also ships attack, hurt, idle, jump
  and run per type. An attack animation when an enemy reaches the end, or a
  hurt flash on a hit, are both art-complete and code-only.
- **No music.** The toggle persists and the sound effects are synthesised.
- **No achievements.** The pack has a window for them; nothing opens it,
  because there are no achievements yet to put in it.
- **The renderer has no elevation.** Cliffs, bridges and roads that cross
  would all add map variety, and all need the renderer to understand height,
  which it currently does not.
- **Water is still drawn, not painted.** The pack ships a `lake.png` per kit;
  the game draws an ellipse. It shows most in frost and ash.
- **The pack has a second tower family** — catapults and ballistae, with archer
  units that have their own bow animations. A tower that fires a visible unit
  rather than a bolt would use them, and nothing does yet.
- **Chain lightning is still drawn**, not painted: the arc between chained
  targets is a stroked line. The pack has no art for it, so this one would
  stay drawn even with everything else swapped.
