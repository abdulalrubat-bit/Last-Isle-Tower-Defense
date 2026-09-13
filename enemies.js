/* Enemies, drawn in code — four silhouettes instead of one sprite recoloured.
 *
 * The game had exactly one enemy sprite set. Grunt, runner, brute and boss
 * were that same ten-frame goblin at different scales with a colour wash over
 * it, which is a readability problem before it is an art problem: at a glance
 * on a busy board you cannot tell what is coming, and "what is coming" is the
 * only decision a tower defence asks of you.
 *
 * So each kind gets a shape you can name from across the room:
 *
 *   grunt   an ordinary bloke with a club, the baseline everything reads against
 *   runner  small, pitched forward, mid-stride — fast, and looks it
 *   brute   wide, hunched, no neck, arms like legs — slow and heavy
 *   boss    tall, horned, caped, two-handed axe — unmistakably the problem
 *
 * Walk cycles are baked into offscreen canvases once at load (8 phases each),
 * so drawing an enemy is a drawImage, exactly as it was with the PNGs.
 *
 * REAL ART WINS, and now does: the pack turned out to carry ten enemy types
 * with seven animations each, so all four kinds load painted sheets and none
 * of this runs. It stays because it is the fallback — a kind with no sheet is
 * drawn rather than invisible — and because it is what made four readable
 * enemies possible before the art arrived.
 */
'use strict';

const ENEMY_FRAMES = 8;

// Drawn facing right, feet at the origin, about `tall` units high. The game
// scales to KINDS[kind].size and flips for leftward travel.
const ENEMY_KIT = {
  grunt: {
    tall: 100, ink: '#23401a',
    skin: '#6fae42', skinHi: '#86c657', cloth: '#8a5a2c', metal: '#b9c2c8',
    build: 1.00, lean: 0.06, stride: 1.00,
  },
  runner: {
    tall: 86, ink: '#1d4a2c',
    skin: '#57c46b', skinHi: '#7ee08d', cloth: '#3f7d52', metal: '#c8d2d8',
    build: 0.80, lean: 0.30, stride: 1.45,
  },
  brute: {
    tall: 128, ink: '#4a1c14',
    skin: '#c2593a', skinHi: '#dd7454', cloth: '#6d3524', metal: '#a8b2b8',
    build: 1.55, lean: 0.14, stride: 0.68,
  },
  boss: {
    tall: 168, ink: '#341a4a',
    skin: '#8d55c4', skinHi: '#a875dd', cloth: '#3f2360', metal: '#d8c25e',
    build: 1.30, lean: 0.04, stride: 0.62,
  },
};

/* Shapes are built as paths and stroked with a dark outline, the same two
   tricks that carry the terrain: an ink line around everything, and the
   highlight always up and to the left. */
function inked(ctx, kit, w, fill, path) {
  ctx.beginPath();
  path();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = kit.ink;
  ctx.lineWidth = w;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.stroke();
}

function limb(ctx, kit, x1, y1, x2, y2, width, fill) {
  inked(ctx, kit, 3, fill, () => {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  });
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/* A limb with an outline needs the dark stroke drawn wider underneath, or the
   outline lands inside the fill and the shape reads muddy at small sizes. */
function boneStroke(ctx, kit, pts, width, fill) {
  // Two passes, upper limb thicker than lower. One width end to end is what
  // made the first attempt read as a stick figure instead of a body.
  ctx.lineCap = ctx.lineJoin = 'round';
  const seg = (a, b, w) => {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = kit.ink; ctx.lineWidth = w + 5.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
  };
  for (let i = 0; i < pts.length - 1; i++) {
    seg(pts[i], pts[i + 1], i === 0 ? width : width * 0.82);
  }
}

function drawEnemy(ctx, kind, phase) {
  const kit = ENEMY_KIT[kind];
  const b = kit.build;
  const t = phase * Math.PI * 2;
  const swing = Math.sin(t) * kit.stride;         // legs and arms, opposed
  const bob = Math.abs(Math.cos(t)) * 3 * b;      // body rise on each step
  const hip = -46 * b - bob;
  const shoulder = -78 * b - bob;
  const lean = kit.lean * 26;

  ctx.save();
  ctx.translate(lean * 0.4, 0);

  // Back limbs first, darkened, so the figure has a front and a back.
  ctx.globalAlpha = 0.72;
  boneStroke(ctx, kit, [[0, hip], [-16 * b - swing * 13, -22 * b], [-12 * b - swing * 18, 0]],
             15 * b, kit.skin);
  boneStroke(ctx, kit, [[0, shoulder + 4], [-15 * b + swing * 12, -60 * b], [-11 * b + swing * 17, -38 * b]],
             12.5 * b, kit.skin);
  ctx.globalAlpha = 1;

  // Torso: a tapered barrel. The brute's is nearly square, the runner's narrow.
  const chest = 21 * b, waist = 15 * b;
  inked(ctx, kit, 3.4, kit.skin, () => {
    ctx.moveTo(-waist, hip + 6);
    ctx.quadraticCurveTo(-chest - 2, (hip + shoulder) / 2, -chest, shoulder + 6);
    ctx.quadraticCurveTo(0, shoulder - 7 * b, chest, shoulder + 6);
    ctx.quadraticCurveTo(chest + 2, (hip + shoulder) / 2, waist, hip + 6);
    ctx.closePath();
  });
  // Lit edge, up and to the left like everything else on the board.
  ctx.globalAlpha = 0.5;
  inked(ctx, kit, 0, kit.skinHi, () => {
    ctx.moveTo(-waist + 3, hip + 2);
    ctx.quadraticCurveTo(-chest + 3, (hip + shoulder) / 2, -chest + 4, shoulder + 8);
    ctx.lineTo(-chest + 11, shoulder + 9);
    ctx.quadraticCurveTo(-chest + 12, (hip + shoulder) / 2, -waist + 10, hip);
    ctx.closePath();
  });
  ctx.globalAlpha = 1;

  drawKit(ctx, kit, kind, { hip, shoulder, b, swing, chest });

  // Front limbs.
  boneStroke(ctx, kit, [[0, hip], [16 * b + swing * 13, -22 * b], [12 * b + swing * 18, 0]],
             16 * b, kit.skin);

  // Weapon before the head: drawn after, a two-handed axe sits across the
  // face at exactly head height and the silhouette stops reading.
  drawWeapon(ctx, kit, kind, { shoulder, b, swing });

  inked(ctx, kit, 3, kit.skin, () =>
    ctx.roundRect(-6 * b, shoulder - 12 * b, 12 * b, 15 * b, 4 * b));
  drawHead(ctx, kit, kind, shoulder, b, lean);

  boneStroke(ctx, kit, [[0, shoulder + 4], [16 * b - swing * 12, -60 * b], [12 * b - swing * 17, -38 * b]],
             13.5 * b, kit.skin);
  ctx.restore();
}

function drawHead(ctx, kit, kind, shoulder, b, lean) {
  const hy = shoulder - 24 * b, r = 17 * b;
  ctx.save();
  ctx.translate(lean * 0.5, 0);

  if (kind === 'boss') {
    // Horned helm: the one silhouette that has to read at any size.
    inked(ctx, kit, 3.4, kit.metal, () => {
      ctx.moveTo(-r - 3, hy + 4);
      ctx.quadraticCurveTo(0, hy - r - 6, r + 3, hy + 4);
      ctx.lineTo(r - 1, hy + 9);
      ctx.lineTo(-r + 1, hy + 9);
      ctx.closePath();
    });
    for (const s of [-1, 1]) {
      inked(ctx, kit, 3, kit.metal, () => {
        ctx.moveTo(s * (r - 3), hy - 4);
        ctx.quadraticCurveTo(s * (r + 17), hy - 16, s * (r + 9), hy - 30);
        ctx.quadraticCurveTo(s * (r + 9), hy - 14, s * (r - 7), hy - 2);
        ctx.closePath();
      });
    }
    inked(ctx, kit, 2.6, kit.skin, () => ctx.ellipse(0, hy + 13, r - 3, 8 * b, 0, 0, Math.PI * 2));
    ctx.fillStyle = '#ffe9a0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 5.5 * b, hy + 12, 2.6 * b, 3.4 * b, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  inked(ctx, kit, 3.4, kit.skin, () => {
    // Brute's head sits low and wide; the runner's is small and forward.
    const sq = kind === 'brute' ? 1.25 : 1;
    ctx.ellipse(kind === 'runner' ? 3 : 0, hy, r * sq, r * (kind === 'brute' ? 0.86 : 1),
                0, 0, Math.PI * 2);
  });
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = kit.skinHi;
  ctx.beginPath();
  ctx.ellipse(-r * 0.34, hy - r * 0.34, r * 0.44, r * 0.36, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Ears mark the grunt and runner apart from the brute's blunt skull.
  if (kind !== 'brute') {
    for (const s of [-1, 1]) {
      inked(ctx, kit, 2.6, kit.skin, () => {
        ctx.moveTo(s * (r - 3), hy - 2);
        ctx.quadraticCurveTo(s * (r + 11), hy - (kind === 'runner' ? 2 : 9),
                             s * (r + 3), hy + 6);
        ctx.closePath();
      });
    }
  }

  if (kind === 'brute') {                    // a jaw, so it is not a blob
    inked(ctx, kit, 2.6, kit.skinHi, () =>
      ctx.ellipse(2 * b, hy + 8 * b, r * 0.62, 6 * b, 0, 0, Math.PI * 2));
    for (const s of [-1, 1]) {
      inked(ctx, kit, 2.2, '#f2ead4', () => {
        ctx.moveTo(s * 5 * b, hy + 5 * b);
        ctx.lineTo(s * 8.5 * b, hy + 15 * b);
        ctx.lineTo(s * 9.5 * b, hy + 4 * b);
        ctx.closePath();
      });
    }
  }

  ctx.fillStyle = kit.ink;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 5.5 * b + (kind === 'runner' ? 3 : 0), hy - 2 * b,
                2.7 * b, 3.4 * b, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawKit(ctx, kit, kind, g) {
  const { hip, shoulder, b, chest } = g;
  if (kind === 'boss') {
    // Cape, drawn behind the torso's front but over the back arm.
    ctx.globalAlpha = 0.9;
    inked(ctx, kit, 3, kit.cloth, () => {
      ctx.moveTo(-chest + 2, shoulder + 4);
      ctx.quadraticCurveTo(-chest - 16, (hip + shoulder) / 2, -chest - 9, hip + 22);
      ctx.lineTo(-4, hip + 14);
      ctx.quadraticCurveTo(-chest + 6, (hip + shoulder) / 2, -chest + 9, shoulder + 6);
      ctx.closePath();
    });
    ctx.globalAlpha = 1;
    inked(ctx, kit, 2.8, kit.metal, () => {
      ctx.moveTo(-chest + 4, shoulder + 8);
      ctx.lineTo(chest - 4, shoulder + 8);
      ctx.lineTo(chest - 8, shoulder + 17);
      ctx.lineTo(-chest + 8, shoulder + 17);
      ctx.closePath();
    });
  } else if (kind === 'brute') {
    // Shoulder plates: the widest thing on the board.
    for (const s of [-1, 1]) {
      inked(ctx, kit, 3, kit.cloth, () => {
        ctx.ellipse(s * (chest - 1), shoulder + 8, 11 * b, 8 * b, s * 0.4, 0, Math.PI * 2);
      });
    }
  } else {
    // A belt, so the torso is not one flat slab.
    inked(ctx, kit, 2.6, kit.cloth, () => {
      ctx.moveTo(-chest + 5, hip - 2);
      ctx.lineTo(chest - 5, hip - 2);
      ctx.lineTo(chest - 6, hip + 6);
      ctx.lineTo(-chest + 6, hip + 6);
      ctx.closePath();
    });
  }
}

function drawWeapon(ctx, kit, kind, g) {
  const { shoulder, b, swing } = g;
  const hx = 11 * b - swing * 17, hy = -38 * b;      // front hand

  if (kind === 'runner') return;                     // runs, carries nothing

  if (kind === 'boss') {
    ctx.save();
    ctx.translate(hx + 16 * b, hy - 4);
    ctx.rotate(0.22 + swing * 0.1);
    boneStroke(ctx, kit, [[0, 20], [0, -74]], 9 * b, kit.cloth);
    for (const s of [-1, 1]) {
      inked(ctx, kit, 3.6, kit.metal, () => {
        ctx.moveTo(s * 3, -70);
        ctx.quadraticCurveTo(s * 40, -80, s * 31, -40);
        ctx.quadraticCurveTo(s * 15, -47, s * 3, -46);
        ctx.closePath();
      });
    }
    ctx.restore();
    return;
  }

  if (kind === 'brute') {                            // a fist, not a weapon
    inked(ctx, kit, 3, kit.skin, () =>
      ctx.ellipse(hx, hy + 4, 10 * b, 9 * b, 0, 0, Math.PI * 2));
    return;
  }

  ctx.save();                                        // grunt: a club
  ctx.translate(hx, hy);
  ctx.rotate(-1.05 + swing * 0.2);
  boneStroke(ctx, kit, [[0, 12], [0, -26]], 8 * b, kit.cloth);
  inked(ctx, kit, 3.4, kit.cloth, () =>
    ctx.ellipse(0, -38, 12 * b, 15 * b, 0, 0, Math.PI * 2));
  ctx.globalAlpha = .4; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-4 * b, -43 * b / b, 5 * b, 6 * b, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
}

/* Bake every kind's walk cycle into one strip, as { img, fw, fh, count } —
   the same shape the loaded sprite sheets take, so the renderer has one path
   and neither source is the special case. */
function bakeEnemySprites(kinds, canvasFactory) {
  const out = {};
  for (const kind of Object.keys(kinds)) {
    const kit = ENEMY_KIT[kind];
    if (!kit) continue;
    const fh = Math.ceil(kinds[kind].size * 2);
    const scale = fh / (kit.tall + 26);         // headroom for horns and axe
    const fw = Math.ceil(fh * 1.15);
    const cv = canvasFactory(fw * ENEMY_FRAMES, fh);
    const ctx = cv.getContext('2d');
    for (let f = 0; f < ENEMY_FRAMES; f++) {
      ctx.save();
      ctx.translate(fw * f + fw / 2, fh - 3);
      ctx.scale(scale, scale);
      ctx.fillStyle = 'rgba(24,54,18,.26)';
      ctx.beginPath();
      ctx.ellipse(3, 1, 26 * kit.build, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      drawEnemy(ctx, kind, f / ENEMY_FRAMES);
      ctx.restore();
    }
    out[kind] = { img: cv, fw, fh, count: ENEMY_FRAMES };
  }
  return out;
}
