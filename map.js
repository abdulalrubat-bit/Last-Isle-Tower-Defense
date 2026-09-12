/* Terrain drawn in code. A map is data, not a picture.
 *
 * The point of this file is that the road the player sees and the line the
 * enemies walk are the same array. A level authors a handful of control
 * points; those are sampled into a dense polyline; the renderer strokes that
 * polyline to draw the road and the game walks it. They cannot drift apart,
 * because there is only one of them. The arrangement it replaces — a painted
 * JPEG with the path reverse-engineered out of it by colour-keying sand
 * pixels — could drift, and did.
 *
 * Everything is composited once into an offscreen canvas at level start and
 * blitted per frame, so a map with three hundred props costs exactly one
 * drawImage in the loop — the same as the background JPEG it replaces.
 *
 * Two things carry the cartoon look, and both are cheap: every solid shape
 * gets a dark outline, and every highlight falls to the top-left. Without
 * them this reads as a diagram.
 */
'use strict';

const LIGHT = { x: -0.55, y: -0.8 };     // unit-ish; highlights offset this way

function rng(seed) {                      // mulberry32
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const PALETTES = {
  island: {
    ink:'#2b4520',
    ground:['#62a63f','#6fb349','#569636'],
    groundDeep:'#47832e',
    road:'#ebd39a', roadLo:'#d8bd83', roadEdge:'#a8854f', roadInk:'#7d6136',
    water:'#3ba0dd', waterDeep:'#2a7fb8', waterRim:'#8ad6f5', shore:'#e0c894',
    leaf:['#3e8f30','#4fa93d','#68c352'], leafInk:'#245018',
    trunk:'#7d5430', trunkInk:'#4a2f19',
    rock:'#9aa4ab', rockHi:'#c6ced4', rockInk:'#5d666c',
    bloom:['#f5e356','#f28fb0','#ffffff'],
    shadow:'rgba(24,54,18,.20)',
    props:['palm','palm','tree','bush','rock','stump','reeds','flowers'],
  },
  forest: {
    ink:'#22371c',
    ground:['#4e8437','#5a9240','#43752f'],
    groundDeep:'#376127',
    road:'#b9925f', roadLo:'#a37f4f', roadEdge:'#7d6141', roadInk:'#54402a',
    water:'#3785ad', waterDeep:'#2a6a8c', waterRim:'#7bc0dd', shore:'#a98f60',
    leaf:['#2f6b2b','#3d8434','#4f9d42'], leafInk:'#1a3d16',
    trunk:'#68472a', trunkInk:'#3c2717',
    rock:'#8d9499', rockHi:'#b8c0c5', rockInk:'#535a5f',
    bloom:['#e8e15c','#d97fae','#f0f0f0'],
    shadow:'rgba(18,40,14,.24)',
    props:['tree','tree','pine','bush','rock','log','stump','flowers'],
  },
  snow: {
    ink:'#5a6b7a',
    ground:['#e3ebf2','#eef4f9','#d3dee8'],
    groundDeep:'#c2d0dc',
    road:'#c3cedb', roadLo:'#b0bdcb', roadEdge:'#93a2b1', roadInk:'#6d7c8b',
    water:'#63b4e0', waterDeep:'#4795c4', waterRim:'#b3e4fa', shore:'#cfdae5',
    leaf:['#2c6b50','#387f5f','#479973'], leafInk:'#1b4432',
    trunk:'#5d4630', trunkInk:'#33251a',
    rock:'#9aa4ad', rockHi:'#ccd5dc', rockInk:'#606a74',
    bloom:['#ffffff','#cfe6f5','#e8f4ff'],
    shadow:'rgba(90,110,130,.18)',
    props:['pine','pine','rock','stump','bush','log'],
  },
};

/* ---------------------------------------------------- spline -> polyline -- */

function sampleSpline(pts, step) {
  const out = [];
  const P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(2, Math.round(Math.hypot(p2[0]-p1[0], p2[1]-p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5*((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5*((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/* ------------------------------------------------------------- geometry --- */

const ROAD_W = 92;          // visible road width
const PAD_OUT = 84;         // pad centre offset from the road centreline

// 84px out with a 46px road half-width puts a pad's edge about 14px off the
// verge. That distance is the balance: pads pushed out to 120-160 leave a
// 190-range tower covering a thin slice of road and landing two shots on a
// passing enemy, which made the previous map unwinnable on hard for reasons
// that had nothing to do with difficulty.

function derivePads(path, water, W, H, minGap) {
  const pads = [];
  let acc = 1e9, side = 1;
  for (let i = 3; i < path.length - 3; i++) {
    acc += Math.hypot(path[i][0]-path[i-1][0], path[i][1]-path[i-1][1]);
    if (acc < 168) continue;
    const [ax, ay] = path[i-3], [bx, by] = path[i+3];
    const len = Math.hypot(bx-ax, by-ay) || 1;
    const nx = -(by-ay)/len, ny = (bx-ax)/len;
    for (const s of [side, -side]) {
      const px = path[i][0] + nx*PAD_OUT*s, py = path[i][1] + ny*PAD_OUT*s;
      if (px < 70 || px > W-70 || py < 96 || py > H-74) continue;
      if (pads.some(p => Math.hypot(p[0]-px, p[1]-py) < minGap)) continue;
      if (water.some(w => Math.hypot((px-w.x)/(w.rx+64), (py-w.y)/(w.ry+64)) < 1)) continue;
      // Never on the far side of the road from where it was measured.
      if (path.some(q => Math.hypot(q[0]-px, q[1]-py) < ROAD_W*0.5 + 24)) continue;
      pads.push([Math.round(px), Math.round(py)]);
      acc = 0; side = -side;
      break;
    }
  }
  return pads;
}

function buildLevel(spec, W, H) {
  const pal = PALETTES[spec.palette] || PALETTES.island;
  const path = sampleSpline(spec.control, 12);
  const water = spec.water || [];
  const pads = derivePads(path, water, W, H, spec.padGap || 152);
  const rand = rng(spec.seed);

  const clearOfRoad = (x, y, d) => !path.some(p => Math.hypot(p[0]-x, p[1]-y) < d);
  const clearOfPads = (x, y, d) => !pads.some(p => Math.hypot(p[0]-x, p[1]-y) < d);
  const clearOfWater = (x, y, d) =>
    !water.some(w => Math.hypot((x-w.x)/(w.rx+d), (y-w.y)/(w.ry+d)) < 1);

  // Clusters, so the ground reads as groves and clearings rather than as an
  // evenly seeded lawn.
  const groves = [];
  for (let i = 0; i < 9; i++) groves.push([rand()*W, rand()*H, 110 + rand()*150]);

  const props = [];
  for (let i = 0; i < (spec.props || 260); i++) {
    let x, y;
    if (rand() < 0.62) {
      const g = groves[(rand()*groves.length)|0];
      const a = rand()*Math.PI*2, d = Math.pow(rand(), 0.6) * g[2];
      x = g[0] + Math.cos(a)*d; y = g[1] + Math.sin(a)*d;
      if (x < 0 || x > W || y < 30 || y > H) continue;
    } else {
      x = rand()*W; y = 40 + rand()*(H-40);
    }
    if (!clearOfRoad(x, y, ROAD_W*0.5 + 34)) continue;
    if (!clearOfPads(x, y, 88)) continue;
    if (!clearOfWater(x, y, 26)) continue;
    if (props.some(p => Math.hypot(p.x-x, p.y-y) < 46)) continue;
    props.push({ x, y, s: 0.78 + rand()*0.46, r: rand(),
                 kind: pal.props[(rand()*pal.props.length) | 0] });
  }
  props.sort((a, b) => a.y - b.y);

  // Ground litter: dense, tiny, no shadows. Cheap, and it stops the ground
  // reading as a flat fill.
  const decor = [];
  for (let i = 0; i < (spec.decor || 520); i++) {
    const x = rand()*W, y = rand()*H;
    if (!clearOfRoad(x, y, ROAD_W*0.5 + 8)) continue;
    if (!clearOfWater(x, y, 6)) continue;
    decor.push({ x, y, r: rand(), s: 0.6 + rand()*0.7,
                 kind: rand() < 0.72 ? 'tuft' : rand() < 0.88 ? 'pebble' : 'bloom' });
  }

  // Cumulative arc length, so resolving a distance to a point is a binary
  // search rather than a walk from the start of the path. Enemies are
  // positioned from this every frame, for every enemy.
  const seg = [];
  let length = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    seg.push({ ax, ay, dx, dy, len, start: length, angle: Math.atan2(dy, dx) });
    length += len;
  }

  return { spec, pal, path, pads, props, decor, water, seg, length, W, H };
}

/* Where along the road is `dist`? The one function the game asks of a map. */
function pathPointAt(level, dist) {
  const seg = level.seg;
  if (dist <= 0) { const s = seg[0]; return { x: s.ax, y: s.ay, angle: s.angle }; }
  if (dist >= level.length) {
    const s = seg[seg.length - 1];
    return { x: s.ax + s.dx, y: s.ay + s.dy, angle: s.angle };
  }
  let lo = 0, hi = seg.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (seg[mid].start <= dist) lo = mid; else hi = mid - 1;
  }
  const s = seg[lo], t = (dist - s.start) / s.len;
  return { x: s.ax + s.dx * t, y: s.ay + s.dy * t, angle: s.angle };
}

/* --------------------------------------------------------------- render --- */

function outlined(ctx, ink, width, drawPath, fill) {
  ctx.beginPath(); drawPath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = ink; ctx.lineWidth = width;
  ctx.lineJoin = 'round'; ctx.stroke();
}

function renderLevel(level, canvasFactory) {
  const { W, H, pal } = level;
  const cv = canvasFactory(W, H);
  const ctx = cv.getContext('2d');
  const rand = rng(level.spec.seed ^ 0x9e37);

  /* ground */
  ctx.fillStyle = pal.ground[0];
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    ctx.globalAlpha = 0.18 + rand()*0.22;
    ctx.fillStyle = pal.ground[rand() < 0.5 ? 1 : 2];
    ctx.beginPath();
    ctx.ellipse(rand()*W, rand()*H, 50 + rand()*150, 34 + rand()*90,
                rand()*Math.PI, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const d of level.decor) drawDecor(ctx, pal, d);
  for (const w of level.water) drawWater(ctx, pal, w, rand);
  drawRoad(ctx, pal, level.path, rand);
  for (const p of level.props) drawProp(ctx, pal, p);

  /* vignette: sits the board in its frame and stops the edges reading flat */
  const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.36,
                                     W/2, H/2, Math.max(W,H)*0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,22,8,.30)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return cv;
}

function drawRoad(ctx, pal, path, rand) {
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  trace(); ctx.strokeStyle = pal.roadInk;  ctx.lineWidth = ROAD_W + 16; ctx.stroke();
  trace(); ctx.strokeStyle = pal.roadEdge; ctx.lineWidth = ROAD_W + 9;  ctx.stroke();
  trace(); ctx.strokeStyle = pal.roadLo;   ctx.lineWidth = ROAD_W;      ctx.stroke();
  // Lit centre, narrower and nudged toward the light: the road reads as worn
  // down the middle instead of as a flat ribbon.
  ctx.save();
  ctx.translate(LIGHT.x * 3, LIGHT.y * 3);
  trace(); ctx.strokeStyle = pal.road; ctx.lineWidth = ROAD_W - 16; ctx.stroke();
  ctx.restore();

  // Wear: patches placed at points sampled along the centreline and pushed
  // sideways along the normal. On the road by construction, with none of the
  // bead-chain regularity a dashed stroke gives.
  ctx.save();
  ctx.globalAlpha = 0.42;
  for (let i = 4; i < path.length - 4; i++) {
    if (rand() > 0.55) continue;
    const [ax, ay] = path[i-2], [bx, by] = path[i+2];
    const len = Math.hypot(bx-ax, by-ay) || 1;
    const nx = -(by-ay)/len, ny = (bx-ax)/len;
    const off = (rand()*2 - 1) * (ROAD_W*0.5 - 16);
    const rx = 7 + rand()*16, ry = 4 + rand()*7;
    ctx.fillStyle = rand() < 0.72 ? pal.roadLo : pal.roadEdge;
    ctx.beginPath();
    ctx.ellipse(path[i][0] + nx*off, path[i][1] + ny*off, rx, ry,
                Math.atan2(by-ay, bx-ax), 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWater(ctx, pal, w, rand) {
  const ell = (rx, ry) => () => ctx.ellipse(w.x, w.y, rx, ry, w.rot||0, 0, Math.PI*2);
  outlined(ctx, pal.ink, 3, ell(w.rx+18, w.ry+16), pal.shore);
  outlined(ctx, pal.waterRim, 4, ell(w.rx+4, w.ry+4), pal.waterDeep);
  ctx.beginPath(); ell(w.rx, w.ry)(); ctx.fillStyle = pal.water; ctx.fill();
  ctx.save();
  ctx.globalAlpha = .55; ctx.strokeStyle = pal.waterRim; ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const yy = w.y - w.ry*0.55 + rand()*w.ry*1.1;
    const ww = w.rx * (0.2 + rand()*0.38);
    const xx = w.x - w.rx*0.3 + rand()*w.rx*0.6;
    ctx.beginPath(); ctx.moveTo(xx - ww/2, yy);
    ctx.quadraticCurveTo(xx, yy + 6, xx + ww/2, yy); ctx.stroke();
  }
  ctx.restore();
}

function drawDecor(ctx, pal, d) {
  const s = d.s;
  ctx.save(); ctx.translate(d.x, d.y);
  if (d.kind === 'tuft') {
    ctx.strokeStyle = pal.groundDeep; ctx.lineWidth = 2*s; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i*3*s, 0);
      ctx.quadraticCurveTo(i*5*s, -5*s, i*7*s - 1, -9*s); ctx.stroke();
    }
  } else if (d.kind === 'pebble') {
    ctx.fillStyle = pal.rock; ctx.globalAlpha = .75;
    ctx.beginPath(); ctx.ellipse(0, 0, 3.4*s, 2.4*s, d.r*3, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = pal.bloom[(d.r*pal.bloom.length)|0];
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(Math.cos(i*2.1)*3*s, Math.sin(i*2.1)*3*s, 2.1*s, 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* Canopies are drawn as a dark silhouette of oversized lobes, then the lobes
   again at true size, then a smaller highlight cluster offset toward the
   light. Stroking each lobe instead would draw the internal seams. */
function lobes(ctx, list, r, colour) {
  ctx.fillStyle = colour;
  for (const [lx, ly, lr] of list) {
    ctx.beginPath(); ctx.arc(lx, ly, lr * r, 0, Math.PI*2); ctx.fill();
  }
}

function drawProp(ctx, pal, p) {
  const s = p.s;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = pal.shadow;
  ctx.beginPath();
  ctx.ellipse(4*s, 5*s, 23*s, 9*s, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.scale(s, s);

  switch (p.kind) {
    case 'palm':   drawPalm(ctx, pal, p);   break;
    case 'pine':   drawPine(ctx, pal, p);   break;
    case 'tree':   drawTree(ctx, pal, p);   break;
    case 'bush':   drawBush(ctx, pal, p);   break;
    case 'rock':   drawRock(ctx, pal, p);   break;
    case 'log':    drawLog(ctx, pal, p);    break;
    case 'reeds':  drawReeds(ctx, pal, p);  break;
    case 'flowers':drawFlowers(ctx, pal, p);break;
    default:       drawStump(ctx, pal, p);
  }
  ctx.restore();
}

function drawTree(ctx, pal, p) {
  outlined(ctx, pal.trunkInk, 3, () => ctx.roundRect(-5, -34, 10, 38, 4), pal.trunk);
  const list = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i/n)*Math.PI*2 + p.r*6;
    list.push([Math.cos(a)*16, -44 + Math.sin(a)*11, 16]);
  }
  list.push([0, -48, 19]);
  lobes(ctx, list, 1.18, pal.leafInk);
  lobes(ctx, list, 1.0,  pal.leaf[0]);
  lobes(ctx, list.slice(0, 3).map(([x,y,r]) => [x + LIGHT.x*7, y + LIGHT.y*7, r]),
        0.72, pal.leaf[1]);
  lobes(ctx, [[LIGHT.x*13, -48 + LIGHT.y*13, 12]], 0.7, pal.leaf[2]);
}

function drawPine(ctx, pal, p) {
  outlined(ctx, pal.trunkInk, 3, () => ctx.roundRect(-4, -22, 8, 26, 3), pal.trunk);
  // Bottom tier darkest, top tier lightest: the light is above, and three
  // tiers sharing one dark green read as a black triangle.
  for (let tier = 0; tier < 3; tier++) {
    const y = -20 - tier*15, w = 25 - tier*6;
    outlined(ctx, pal.leafInk, 2.6, () => {
      ctx.moveTo(-w, y); ctx.lineTo(0, y - 24); ctx.lineTo(w, y); ctx.closePath();
    }, pal.leaf[tier]);
  }
  ctx.fillStyle = pal.leaf[1];
  ctx.globalAlpha = .55;
  ctx.beginPath();
  ctx.moveTo(-8, -34); ctx.lineTo(0, -56); ctx.lineTo(-1, -34); ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPalm(ctx, pal, p) {
  const lean = (p.r - 0.5) * 16;
  ctx.save();
  outlined(ctx, pal.trunkInk, 3.5, () => {
    ctx.moveTo(-5, 4);
    ctx.quadraticCurveTo(-2 + lean*0.4, -22, lean, -46);
    ctx.lineTo(lean + 8, -45);
    ctx.quadraticCurveTo(4 + lean*0.4, -22, 5, 4);
    ctx.closePath();
  }, pal.trunk);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i/n)*Math.PI*2 + p.r*4;
    const fx = lean + 4, fy = -48;
    const ex = fx + Math.cos(a)*30, ey = fy + Math.sin(a)*17 - 4;
    outlined(ctx, pal.leafInk, 3, () => {
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo((fx+ex)/2, (fy+ey)/2 - 13, ex, ey);
      ctx.quadraticCurveTo((fx+ex)/2, (fy+ey)/2 - 2, fx, fy);
      ctx.closePath();
    }, pal.leaf[i % 2]);
  }
  ctx.fillStyle = pal.trunkInk;
  ctx.beginPath(); ctx.arc(lean + 4, -48, 4, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawBush(ctx, pal, p) {
  const list = [[-11, -6, 12], [0, -13, 14], [11, -5, 12]];
  lobes(ctx, list, 1.2, pal.leafInk);
  lobes(ctx, list, 1.0, pal.leaf[0]);
  lobes(ctx, [[-4 + LIGHT.x*5, -15 + LIGHT.y*5, 8]], 1, pal.leaf[1]);
}

function drawRock(ctx, pal, p) {
  outlined(ctx, pal.rockInk, 3.5, () => {
    ctx.moveTo(-19, 3); ctx.lineTo(-13, -14); ctx.lineTo(2, -20);
    ctx.lineTo(17, -8); ctx.lineTo(14, 4); ctx.closePath();
  }, pal.rock);
  ctx.fillStyle = pal.rockHi;
  ctx.beginPath();
  ctx.moveTo(-11, -13); ctx.lineTo(2, -18); ctx.lineTo(8, -10);
  ctx.lineTo(-5, -6); ctx.closePath(); ctx.fill();
}

function drawLog(ctx, pal, p) {
  ctx.save(); ctx.rotate((p.r - 0.5) * 1.2);
  outlined(ctx, pal.trunkInk, 3, () => ctx.roundRect(-24, -8, 48, 15, 7), pal.trunk);
  outlined(ctx, pal.trunkInk, 2.5,
    () => ctx.ellipse(-23, -1, 4, 7, 0, 0, Math.PI*2), pal.rockHi);
  ctx.restore();
}

function drawStump(ctx, pal, p) {
  outlined(ctx, pal.trunkInk, 3, () => ctx.roundRect(-10, -12, 20, 16, 4), pal.trunk);
  outlined(ctx, pal.trunkInk, 2.5,
    () => ctx.ellipse(0, -12, 10, 5, 0, 0, Math.PI*2), '#a5754a');
}

function drawReeds(ctx, pal, p) {
  ctx.strokeStyle = pal.leafInk; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i*5, 2);
    ctx.quadraticCurveTo(i*7, -14, i*10 + (p.r-0.5)*8, -26); ctx.stroke();
  }
  ctx.strokeStyle = pal.leaf[1]; ctx.lineWidth = 1.8;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i*5, 2);
    ctx.quadraticCurveTo(i*7, -14, i*10 + (p.r-0.5)*8, -25); ctx.stroke();
  }
}

function drawFlowers(ctx, pal, p) {
  ctx.strokeStyle = pal.leafInk; ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(i*8, 2); ctx.lineTo(i*9, -12); ctx.stroke();
  }
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = pal.bloom[(i + 1 + ((p.r*3)|0)) % pal.bloom.length];
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(i*9 + Math.cos(k*1.26)*3.4, -13 + Math.sin(k*1.26)*3.4, 2.6, 0, Math.PI*2);
      ctx.fill();
    }
  }
}
