/* Island Defence, offline.
 *
 * Cache-first over the whole shell: none of it changes between deploys, and
 * the point of installing a game is a game that opens with no signal.
 *
 * VERSION is a hash of the shipped bytes, stamped by tools/stamp-sw.py. Keyed
 * by hand it is a key someone forgets to bump, and a forgotten bump strands a
 * player on an old build with no way to know it.
 */
const VERSION = 'a6ffea3216e2';
const CACHE = 'islanddefence-' + VERSION;

const SHELL = [
  './',
  'index.html',
  'game.js',
  'app.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-mask-512.png',
  'assets/art_failed.png',
  'assets/bar_energy.png',
  'assets/bar_gems.png',
  'assets/bar_lives.png',
  'assets/bar_stars.png',
  'assets/btn_close.png',
  'assets/btn_done.png',
  'assets/btn_easy.png',
  'assets/btn_hard.png',
  'assets/btn_menu.png',
  'assets/btn_music.png',
  'assets/btn_music_off.png',
  'assets/btn_normal.png',
  'assets/btn_play.png',
  'assets/btn_restart.png',
  'assets/btn_sell.png',
  'assets/btn_sound.png',
  'assets/btn_sound_off.png',
  'assets/btn_start.png',
  'assets/card_damage.png',
  'assets/card_range.png',
  'assets/card_rate.png',
  'assets/enemy_boss_die.png',
  'assets/enemy_boss_walk.png',
  'assets/enemy_brute_die.png',
  'assets/enemy_brute_walk.png',
  'assets/enemy_grunt_die.png',
  'assets/enemy_grunt_walk.png',
  'assets/enemy_runner_die.png',
  'assets/enemy_runner_walk.png',
  'assets/fx.png',
  'assets/hdr_difficulty.png',
  'assets/hdr_failed.png',
  'assets/hdr_upgrade.png',
  'assets/hdr_victory.png',
  'assets/props.png',
  'assets/skull.png',
  'assets/skull_arrow.png',
  'assets/skull_bg.png',
  'assets/tower_arcane.png',
  'assets/tower_bolt.png',
  'assets/tower_fire.png',
  'assets/tower_ice.png',
  'assets/towers.png',
  'assets/tray.png',
  'assets/window.png'
];

self.addEventListener('install', e => {
  // Take over at once rather than waiting for every tab to close. A game is
  // one tab, and the alternative is an update that lands whenever.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Drop every older build's cache: two copies of the shell on a phone is
    // not free, and a stale one can never be served by accident.
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // never touch remote
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Caching a 404 is how a half-succeeded deploy becomes permanent.
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
