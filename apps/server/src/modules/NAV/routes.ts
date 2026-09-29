import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { search } from './search.ts';

export function navRoutes(app: FastifyInstance, { db, registry }: AppDeps): void {
  app.get<{ Querystring: { q?: string } }>('/api/nav/search', { config: { permission: 'nav.search' } }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).strict().parse(req.query);
    return search(db, registry, currentUser(req), q);
  });
}
