import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { addRate, garmentTypes, rateHistory, ratesAt } from './rates.ts';

export function rateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** The rates in force on a date (today by default), the full history, and the garment types for pickers. */
  app.get('/api/rate/rates', { config: { permission: 'rate.view' } }, async (req) => {
    const q = z.object({ asOf: z.string().optional() }).strict().parse(req.query);
    if (q.asOf !== undefined && !isBusinessDate(q.asOf)) throw badRequest('BAD_DATE', 'Use a date like 2026-09-28.');
    const asOf = q.asOf ?? today(clock);
    return { asOf, current: ratesAt(db, asOf), history: rateHistory(db), garmentTypes: garmentTypes(db) };
  });

  app.post('/api/rate/rates', { config: { permission: 'rate.manage' } }, async (req) => {
    const who = { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) };
    return tx(db, () => {
      clockGuard({ db, clock });
      return addRate(db, req.body, who);
    });
  });
}
