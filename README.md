# Island Defence

A tower defence with a six-map campaign. Fifteen waves a map, four towers,
three difficulties, stars per map, maps unlocking in order.

**The terrain is drawn in code.** There is not one background image in the
game. A map is about ten lines of data.

Hand-written, no engine. Offline once loaded, no accounts, no network calls,
nothing leaving the device. Saves stars, gems and the two audio toggles to
`localStorage` and nothing else.

```
index.html     shell, HUD, overlays, all CSS
map.js         terrain: geometry, build pads, renderer
game.js        the game, and the campaign
assets/        44 files, 764KB — towers, enemies, UI. No backgrounds.
sw.js          offline cache — generated, run tools/stamp-sw.py
tools/         asset pipeline, balance sim, sw stamper
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
- **Biome is a palette swap.** Island, forest and snow are the same renderer.
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

# Rebuild assets/ from original art (towers, enemies, UI — no backgrounds)
python3 tools/build-assets.py ~/art/tower-defence-pack

# After ANY change to shipped files
python3 tools/stamp-sw.py
```

**To add a map**: append to `LEVELS` in `game.js`. Control points run off the
left and right edges (`-40` and `1580`) so the road enters and leaves the
board cleanly. Then run the sim and set `hp` and `padGap` from what it reports
— those two are the difficulty dial, and guessing them is how levels 4–6 first
came out as walls.

## Known gaps

Deliberate omissions, not oversights:

- **The original art has not been dropped in yet.** Every sprite is *recovered*
  from the pack's JPEGs by keying the black surround — good, but inferred.
  Export the originals as PNGs with alpha into one folder and run
  `tools/build-assets.py`; nothing in the game changes, everything gets
  sharper. This no longer touches backgrounds, only towers, enemies and UI.
- **The victory header reads "ACHIEVEMENT"** — the closest thing to a
  celebratory header the pack has. It wants a real one.
- **One enemy sprite set.** Grunt, runner, brute and boss are the same ten run
  frames at different scales and tints, baked once at load. Real variety needs
  art — and it is now the only thing in the game that does.
- **No music.** The toggle persists and the sound effects are synthesised.
- **No achievements.** The pack has a window for them; nothing opens it,
  because there are no achievements yet to put in it.
- **The renderer has no elevation.** Cliffs, bridges and roads that cross
  would all add map variety, and all need the renderer to understand height,
  which it currently does not.
