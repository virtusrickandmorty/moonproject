/** The shop's CA as the screens show it (PLAN C6): its code, so a device's "Join this PC" page can be checked from a signed-in screen too. */
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.ts';
import { currentCa } from './store.ts';

export function tlsRoutes(app: FastifyInstance, deps: AppDeps): void {
  /** Null before the server has first run on the network (LAN mode). */
  app.get('/api/system/tls', { config: { permission: 'authenticated' } }, async () => ({ ca: currentCa(deps.db) }));
}
