/**
 * For search engines: robots.txt (the public website may be read; order pages, which carry a secret link, checkout,
 * tracking, sign-in and the ERP's API may not) and sitemap.xml (the website's public pages). Both name the address the
 * visitor used to reach this PC, so they stay right behind any domain the shop puts in front of it.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app.ts';

/** The website's pages worth listing, with how often each changes. */
export const SITE_PAGES: [string, 'daily' | 'weekly' | 'monthly', string][] = [
  ['/', 'daily', '1.0'], ['/services', 'monthly', '0.8'], ['/about', 'weekly', '0.6'], ['/support', 'monthly', '0.5'],
];

/** https://shop.example:8443, from the request; a host that is not a plain host name (and port) falls back to localhost. */
const siteOf = (req: FastifyRequest) => {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol) === 'https' ? 'https' : 'http';
  return `${proto}://${/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host.toLowerCase() : 'localhost'}`;
};

export function shpSeoRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/robots.txt', { config: { permission: 'public' } }, async (req, reply) => {
    reply.type('text/plain; charset=utf-8');
    return [
      'User-agent: *',
      // What the shop pages read to show their products and reviews.
      'Allow: /api/shp/products', 'Allow: /api/shp/photos/', 'Allow: /api/shp/reviews', 'Allow: /api/shp/payment',
      'Disallow: /api/', 'Disallow: /order/', 'Disallow: /orders', 'Disallow: /checkout', 'Disallow: /track', 'Disallow: /sign-in',
      '', `Sitemap: ${siteOf(req)}/sitemap.xml`, '',
    ].join('\n');
  });

  app.get('/sitemap.xml', { config: { permission: 'public' } }, async (req, reply) => {
    const site = siteOf(req);
    // The shop page changes with its products and reviews: its date is the latest of those.
    const latest = (db.prepare(`SELECT MAX(at) FROM (SELECT MAX(updated_at) AS at FROM shp_products UNION ALL SELECT MAX(created_at) FROM shp_reviews)`).pluck().get() as string | null)?.slice(0, 10);
    reply.type('application/xml; charset=utf-8');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITE_PAGES.map(([path, freq, priority]) => `  <url><loc>${site}${path}</loc>${path === '/' && latest ? `<lastmod>${latest}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`).join('\n')}
</urlset>
`;
  });
}
