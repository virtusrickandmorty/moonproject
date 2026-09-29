import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { assetRegister, listClasses } from './assets.ts';
import { assetPage, depreciationGaps, lastRunMonth } from './register.ts';

export function faRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const thisMonth = () => today(clock).slice(0, 7);

  /** Asset classes with their usual lives (PLAN E10, ACC-16), for the purchase form. */
  app.get('/api/fa/classes', { config: { permission: 'fa.assets.view' } }, async () =>
    listClasses(db).map(({ code, name, defaultLifeMonths }) => ({ code, name, defaultLifeMonths })),
  );

  /** The fixed-asset register: status, monthly charge, accumulated depreciation and book value from the ledger (NR-2). */
  app.get('/api/fa/assets', { config: { permission: 'fa.assets.view' } }, async () => assetRegister(db));

  /** Months before this one in which an asset in service should have been depreciated and was not and the month of the latest recorded run (a warning, nothing is posted). */
  app.get('/api/fa/depreciation-gaps', { config: { permission: 'fa.assets.view' } }, async () => ({ thisMonth: thisMonth(), lastRunMonth: lastRunMonth(db), months: depreciationGaps(db, thisMonth()) }));

  /** One asset: its figures, depreciation month by month from the recorded runs, its documents and its months with no charge. */
  app.get<{ Params: { id: string } }>('/api/fa/assets/:id', { config: { permission: 'fa.assets.view' } }, async (req) => assetPage(db, req.params.id, thisMonth()));
}
