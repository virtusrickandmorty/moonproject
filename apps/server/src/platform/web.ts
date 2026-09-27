/**
 * Serves the built web app from the same origin as the API (PLAN C1). A file under the web root is sent as is;
 * any other GET outside /api gets index.html, so the browser's router handles deep links such as /jo/orders/1.
 */
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { AppError } from '@moonproject/shared';

export function webRoutes(app: FastifyInstance, root: string): void {
  app.register(fastifyStatic, { root, serve: false });

  app.get('/*', { config: { permission: 'public' } }, (req, reply) => {
    const path = (req.params as { '*': string })['*'];
    if (/^api(\/|$)/.test(path)) throw new AppError('NOT_FOUND', 'Not found.', 404);
    return isFileUnder(root, path) ? reply.sendFile(path) : reply.sendFile('index.html');
  });
}

function isFileUnder(root: string, path: string): boolean {
  const rel = relative(root, resolve(root, path));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  try {
    return statSync(resolve(root, rel)).isFile();
  } catch {
    return false;
  }
}
