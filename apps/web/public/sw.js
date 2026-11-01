/*
 * The installed app's service worker (the owner's request, Nov 2026): it keeps only the app's own files (the scripts,
 * styles, fonts and icons of a build, whose names change with each build) so the app starts quickly. Pages and every
 * /api/ answer always come from the server: no business data is kept on the phone, and nothing is recorded offline.
 */
const CACHE = 'virtus-app-files-v1';
const KEEP = 400; // files kept at most; the oldest go first

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

/** A build's own file: under /assets/ (named by its content), or one of the icons. */
const isAppFile = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || /^\/(icon-\d+|apple-touch-icon|favicon-\d+)\.png$/.test(url.pathname));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !isAppFile(url)) return; // the server answers as usual
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const kept = await cache.match(event.request);
    if (kept) return kept;
    const answer = await fetch(event.request);
    if (answer.ok) {
      await cache.put(event.request, answer.clone());
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(old);
    }
    return answer;
  })());
});
