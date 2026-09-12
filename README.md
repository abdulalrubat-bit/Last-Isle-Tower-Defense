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
- **One enemy sprite set.** Grunt, runner, brute and boss are the same ten run
  frames at different scales and tints, baked once at load. Real variety needs
  art — and it is now the only thing in the game that does.
- **No music.** The toggle persists and the sound effects are synthesised.
- **No achievements.** The pack has a window for them; nothing opens it,
  because there are no achievements yet to put in it.
- **The renderer has no elevation.** Cliffs, bridges and roads that cross
  would all add map variety, and all need the renderer to understand height,
  which it currently does not.
