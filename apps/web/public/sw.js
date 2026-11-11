/*
 * The installed app's service worker (the owner's request, Nov 2026): it keeps the app's own files (the scripts, styles,
 * fonts and icons of a build, whose names change with each build) so the app starts quickly. Staff pages and every staff
 * /api/ answer always come from the server: no business data is kept on the phone.
 * One exception (the owner's request, Nov 2026): a customer's order link (/l/…) opens without internet. Its page, the
 * link's own public details (what the order is, the items and sizes, the shop's note) and its design pictures are kept
 * once seen; the page keeps what the customer types and sends it once the phone is online (OLK offline.ts). A customer's
 * sent answer is never kept here.
 */
const CACHE = 'virtus-app-files-v1';
const LINKS = 'virtus-order-links-v1';
const SHELL = '/__order-link-page';
const KEEP = 400; // files kept at most; the oldest go first
const KEEP_LINKS = 200;

/** The app's page and the build files it names, kept for an order link opened without internet. */
async function keepShell() {
  const page = await fetch('/', { cache: 'no-store' });
  if (!page.ok) return;
  const html = await page.clone().text();
  await (await caches.open(LINKS)).put(SHELL, page);
  const files = await caches.open(CACHE);
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    if (await files.match(m[1])) continue;
    const f = await fetch(m[1]).catch(() => null);
    if (f && f.ok) await files.put(m[1], f);
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(keepShell().catch(() => undefined)); // offline at install: kept the next time an order link opens
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE && name !== LINKS) await caches.delete(name);
    await self.clients.claim();
  })());
});

/** An order link's page, its public details, or one of its design pictures. */
const isLinkPage = (req, url) => req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith('/l/');
const isLinkData = (url) => url.origin === self.location.origin && /^\/api\/olk\/l\/[^/]+(\/pictures\/[^/]+)?$/.test(url.pathname);

/** From the server when it answers (kept for next time); else what was kept. */
async function serverFirst(request, key) {
  const kept = await caches.open(LINKS);
  try {
    const answer = await fetch(request);
    if (answer.ok) {
      await kept.put(key, answer.clone());
      const keys = await kept.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_LINKS))) if (new URL(old.url).pathname !== SHELL) await kept.delete(old);
    }
    return answer;
  } catch (e) {
    const before = await kept.match(key);
    if (before) return before;
    throw e;
  }
}

/** A build's own file: under /assets/ (named by its content), or one of the icons. */
const isAppFile = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || /^\/(icon-\d+|apple-touch-icon|favicon-\d+)\.png$/.test(url.pathname));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && isLinkPage(event.request, url)) return event.respondWith(serverFirst(event.request, SHELL));
  if (event.request.method === 'GET' && isLinkData(url)) return event.respondWith(serverFirst(event.request, url.pathname));
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

// Phone notifications (the owner's request, Nov 2026): a push shows what came up in the person's bell; tapping it opens
// that page in the app (an open window if there is one).
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Virtus', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag, data: { href: d.href || '/dash/notifications' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.href) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.navigate(url); } catch { /* an old window: focus it as it is */ }
      return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});
