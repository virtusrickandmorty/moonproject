import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { assetRegister, listClasses } from './assets.ts';

export function faRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** Asset classes with their usual lives (PLAN E10, ACC-16), for the purchase form. */
  app.get('/api/fa/classes', { config: { permission: 'fa.assets.view' } }, async () =>
    listClasses(db).map(({ code, name, defaultLifeMonths }) => ({ code, name, defaultLifeMonths })),
  );

  /** The fixed-asset register: status, monthly charge, accumulated depreciation and book value from the ledger (NR-2). */
  app.get('/api/fa/assets', { config: { permission: 'fa.assets.view' } }, async () => assetRegister(db));
}
