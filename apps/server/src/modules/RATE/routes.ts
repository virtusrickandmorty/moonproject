import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { addRate, addRates, garmentTypes, rateHistory, ratesAt, switchGarmentType } from './rates.ts';
import { jobItemsMadeAs } from '../PRD/public.ts';
import { itemGarmentTypes } from '../CAT/public.ts';

export function rateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** The rates in force on a date (today by default), the full history, and the garment types for pickers. */
  app.get('/api/rate/rates', { config: { permission: 'rate.view' } }, async (req) => {
    const q = z.object({ asOf: z.string().optional() }).strict().parse(req.query);
    if (q.asOf !== undefined && !isBusinessDate(q.asOf)) throw badRequest('BAD_DATE', 'Use a date like 2026-09-28.');
    const asOf = q.asOf ?? today(clock);
    const current = ratesAt(db, asOf);
    // Rates in force for a garment type no price list item goes by: kept for the job orders that use it (shown on the price list).
    const items = new Set(itemGarmentTypes(db).map((g) => g.toLowerCase()));
    const unmatched = current.filter((r) => !items.has(r.garmentType.toLowerCase()))
      .map((r) => ({ ...r, jobItems: jobItemsMadeAs(db, r.garmentType) })); // how many job order items are made as it
    return { asOf, current, history: rateHistory(db), garmentTypes: garmentTypes(db), unmatched };
  });

  /** Switch a garment type's rates off (no price list item, no job order item made as it) or on again. */
  app.post('/api/rate/garment-types/switch', { config: { permission: 'rate.manage' } }, async (req) => {
    const who = { userId: currentUser(req).userId, at: stamp(clock) };
    return tx(db, () => { clockGuard({ db, clock }); return switchGarmentType(db, req.body, who, (g) => jobItemsMadeAs(db, g)); });
  });

  /** The same new rate for many items at once (the owner's request, Oct 27, 2026): all saved, or none. */
  app.post('/api/rate/rates/bulk', { config: { permission: 'rate.manage' } }, async (req) => {
    const who = { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) };
    return tx(db, () => {
      clockGuard({ db, clock });
      const rates = addRates(db, req.body, who);
      return { count: rates.length, rates };
    });
  });

  app.post('/api/rate/rates', { config: { permission: 'rate.manage' } }, async (req) => {
    const who = { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) };
    return tx(db, () => {
      clockGuard({ db, clock });
      return addRate(db, req.body, who);
    });
  });
}
