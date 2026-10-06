/** Public shop/support workloads are bounded before parsing; signed-in staff routes keep their existing options. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Clock } from '../../platform/clock.ts';
import { requestRateLimiter } from './sessions.ts';

export const PUBLIC_TRACK_REQUESTS = 20;
const SHOP_PAGES = new Set(['/', '/shop', '/services', '/about', '/support', '/checkout', '/orders', '/track']);
const isShopRoute = (url: string) => url.startsWith('/api/shp/') || url.startsWith('/api/sup/') || url === '/robots.txt' || url === '/sitemap.xml';

function isPublicShopRequest(req: FastifyRequest): boolean {
  if (req.routeOptions.config.permission !== 'public') return false;
  const route = req.routeOptions.url ?? '';
  if (isShopRoute(route)) return true;
  if (route !== '/*') return false;
  // Fastify has already decoded the wildcard path; queries do not change the page's allowance.
  const path = '/' + (req.params as { '*': string })['*'];
  return SHOP_PAGES.has(path) || /^\/order\/([A-Z]+-\d{1,9})$/.test(path);
}

export function publicRequestLimits(app: FastifyInstance, clock: Clock): void {
  const all = requestRateLimiter(clock, 120, 5 * 60_000);
  const forms = requestRateLimiter(clock, 30, 5 * 60_000);
  const tracking = requestRateLimiter(clock, PUBLIC_TRACK_REQUESTS, 10 * 60_000);

  app.addHook('onRoute', (route) => {
    if (route.config?.permission !== 'public' || !isShopRoute(route.url)) return;
    // Picture forms already declare limits including their base64 overhead; preserve those.
    route.bodyLimit ??= route.url === '/api/shp/orders' ? 32 * 1024
      : route.url === '/api/shp/orders/:number/reviews' ? 8 * 1024 : 4 * 1024;
  });

  app.addHook('onRequest', async (req) => {
    if (!isPublicShopRequest(req)) return;
    // Use the socket address supplied by Fastify. Proxy trust remains disabled.
    all(req.ip);
    if (req.routeOptions.url === '/api/shp/track') tracking(req.ip);
    else if (req.method !== 'GET' && req.method !== 'HEAD') forms(req.ip);
  });
}
