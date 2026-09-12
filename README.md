# Island Defence

A tower defence built out of `Tower-Defence-Assets-Upgrade-23.html`. One map,
fifteen waves, four towers, eleven build pads, a win screen and a loss screen.
Playable start to finish.

Hand-written, no engine. Offline once loaded, no accounts, no network calls,
no data leaving the device. Saves nothing but gems, best result and the two
audio toggles, in `localStorage`.

```
index.html        shell, HUD, overlays, all CSS
game.js           the whole game
assets/           48 files, 1.1MB
sw.js             offline cache — generated, run tools/stamp-sw.py
tools/            asset pipeline, map tracer, balance sim
```

Open `index.html` over http (or from `file://` — the service worker is skipped
there on purpose, so local dev and a WebView build both work).

## What changed from the original

The original was a working skeleton with real problems underneath. The ones
that mattered:

**Every asset was a JPEG mislabelled `data:image/png`.** 83 of 84. JPEG has no
alpha, so every button and panel carried an opaque black square, and the CSS
compensated with `mix-blend-mode: screen` on nearly every rule — which only
looks right over a dark background and washes out colour. Assets are now real
files with real alpha and there is no blend-mode hack anywhere.

**12.7MB of base64 in one line, parsed synchronously at startup.** Six
byte-identical copies of the same 328KB background under six names; a
1536×1527 image for a button drawn at 330×170. Now 1.1MB of separate,
cacheable files, each sized to what it is drawn at.

**Map 1 displayed the wrong background.** `levels[0].bg` was `map_bg.png`,
byte-identical to the menu background. The actual level-1 art,
`game_background_1.png`, was the largest asset in the pack and was never
referenced by anything.

**The path and build pads did not match the art.** Waypoints were hand-guessed
against the wrong image; pads for maps 3 and 4 were an obvious placeholder
grid. The route is now traced from the road by colour-keying the sand — every
sampled point on the centreline lands on road — and pads are derived the same
way. See `tools/trace-map.py`.

**Game state lived in the DOM.** Energy was stored in a `<span>` and
re-parsed on every kill. State is now in one object and the HUD is written
from it, never read back.

**Targeting walked the whole polyline per tower per enemy per frame** — about
300 walks a frame with ten towers up. Each enemy's position is now resolved
once per frame by binary search over precomputed arc lengths, and cached.

**Nothing was winnable.** No wave cap, no win condition, no level end; waves
scaled forever and you could only lose. Fifteen waves now, then a result
screen with a star rating.

Also: `pierce` was a fifth tower sharing the arcane art and the arcane tower's
stats — dropped. The three upgrade cards were a single sequential ladder wearing
the costume of a choice; they are now three independent tracks. The tower-table
overlay duplicated the bottom tray and is gone. Sell, 2× speed, a build preview
showing the selected tower's range before you commit, an early-call energy
bonus, sound, and persistence are new.

## Balance

Verified by simulation, not guesswork — `tools/sim.mjs` runs the real `game.js`
headlessly to wave 15 across five build strategies and three difficulties in a
few seconds.

```
strategy              easy         normal       hard
mixed/cheapest        WON 24/25    WON 16/20    lost w14
mixed/damage          WON 24/25    WON 16/20    WON  2/16
bolt-heavy/damage     WON 25/25    WON 15/20    lost w14
fire-rush/rate        WON 18/25    lost w14     lost w11
arcane+ice/damage     WON 24/25    WON 18/20    lost w10
```

Most strategies clear normal; one clears hard; the mono-tower build falls just
short on normal. Read it as a spread — every strategy winning would mean the
towers do not matter, one winning would mean the rest are traps.

Three things the simulation found that reading the code would not have:

- **Pad distance from the road is the whole balance.** An earlier pad set sat
  92–168px off the centreline, where a 190-range tower covers a ~160px slice
  of road and lands two shots on a passing enemy. Hard was unwinnable for
  geometric reasons, not difficulty ones. Moving pads to the verge (66–118px)
  fixed it without touching a damage number.
- **A two-target chain made lightning strictly the best tower at any price.**
  It now chains once and costs more.
- **Ice and arcane were priced as damage towers while dealing almost none**, so
  opening with them lost by wave 3. Cheaper now, and they hit hard enough to
  hold a lane.

Starting energy is deliberately similar across difficulties: it has to buy an
opening of three towers everywhere. Hard starting at two towers was a cliff,
not a curve.

## Tools

```sh
# Rebuild assets/ from the original art (see "Known gaps" first)
python3 tools/build-assets.py ~/art/tower-defence-pack

# Add a map: print the road profile, work out the route, then verify it
python3 tools/trace-map.py assets/map2.jpg
python3 tools/trace-map.py assets/map2.jpg --path '[[0,680],...]' \
    --exclude '[[320,120,660,410]]' --overlay /tmp/map2.png
#   ^ always look at the overlay before trusting the numbers

# Check the balance still holds
npm i playwright && node tools/sim.mjs

# After ANY change to shipped files
python3 tools/stamp-sw.py
```

## Known gaps

These are deliberate omissions, not oversights:

- **The original art has not been dropped in yet.** Every sprite here is
  recovered from the JPEGs by keying the black surround — good, but inferred.
  Export the originals as PNGs with alpha into one folder and run
  `tools/build-assets.py`; nothing in the game changes, everything gets
  sharper. `tools/assets.json` maps source names to output names and sizes.
- **The victory header reads "ACHIEVEMENT"** — the closest thing to a
  celebratory header the pack contains. It wants a real one.
- **One map.** Maps 2–4 are in the original pack and the tooling to place
  their paths and pads is here. The level list in `game.js` is currently a
  single map inlined as `PATH`/`PADS`; adding more means lifting those into a
  `LEVELS` array and adding map select.
- **One enemy sprite set.** Grunt, runner, brute and boss are the same ten run
  frames at different scales and tints, baked once at load. Real variety needs
  art.
- **No music.** The toggle persists and the sound effects are synthesised
  (there are no audio files in the pack). Music needs a track.
- **No achievements.** The pack has a full achievements window; the original
  never opened it and neither does this. It needs achievements to exist first.
