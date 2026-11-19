/**
 * Serves the built web app from the same origin as the API (PLAN C1). A file under the web root is sent as is;
 * any other GET outside /api gets index.html, so the browser's router handles deep links such as /jo/orders/1.
 * A missing file under /assets is a 404, never the app page: a page left open across an update that asks for a part of
 * the old app gets a clear failure, not a web page read as a script (the owner's report, Nov 2026: Download PSD failed).
 */
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { AppError, isErpHost } from '@moonproject/shared';

export function webRoutes(app: FastifyInstance, root: string): void {
  app.register(fastifyStatic, { root, serve: false });

  // The phone app (the owner's request, Nov 2026): installed from the ERP's own address it is the ERP's app, by name too.
  app.get('/site.webmanifest', { config: { permission: 'public' } }, (req, reply) => {
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(readFileSync(resolve(root, 'site.webmanifest'), 'utf8')) as Record<string, unknown>; } catch { throw new AppError('NOT_FOUND', 'Not found.', 404); }
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').replace(/:\d+$/, '');
    if (isErpHost(host)) Object.assign(manifest, { name: 'Virtus ERP', short_name: 'Virtus ERP', description: "Virtus Garments' ERP: job orders, production, the floor app and payroll." });
    reply.type('application/manifest+json; charset=utf-8').header('cache-control', 'no-cache');
    return JSON.stringify(manifest);
  });

  app.get('/*', { config: { permission: 'public' } }, (req, reply) => {
    const path = (req.params as { '*': string })['*'];
    if (/^api(\/|$)/.test(path)) throw new AppError('NOT_FOUND', 'Not found.', 404);
    if (isFileUnder(root, path)) return reply.sendFile(path);
    if (/^assets\//.test(path)) throw new AppError('NOT_FOUND', 'Not found.', 404);
    return reply.sendFile('index.html');
  });
}

export function isFileUnder(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  try {
    return statSync(resolve(root, rel)).isFile();
  } catch {
    return false;
  }
}
