import type { FastifyInstance } from 'fastify';
import { badRequest, csvPesos, isBusinessDate, toCsv } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { CATEGORIES, countSheet, type Category } from './costs.ts';
import { countableSupply, latestPurchaseCost } from '../PUR/public.ts';

export function invRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /**
   * The count sheet (PLAN E9): every active supply of a category with its unit and the cost it is valued at on the count
   * date (today if left out), and an empty quantity column to fill in by hand. CSV to print; ?format=json for the form.
   */
  app.get<{ Querystring: { category?: string; date?: string; format?: string } }>('/api/inv/count-sheet', { config: { permission: 'inv.count.view' } }, async (req, reply) => {
    const category = req.query.category as Category;
    if (!CATEGORIES.includes(category)) throw badRequest('BAD_CATEGORY', 'Pick the count sheet: materials or ready_made.');
    const now = today(clock);
    const date = req.query.date ?? now;
    if (!isBusinessDate(date) || date > now) throw badRequest('BAD_DATE', 'Pick the count date, like 2026-09-30: today or earlier.');
    const rows = countSheet(db, category, date);
    if (req.query.format === 'json') return { category, date, supplies: rows };
    reply.header('Content-Disposition', `attachment; filename="count-sheet-${category}-${date}.csv"`);
    reply.type('text/csv; charset=utf-8');
    return toCsv([
      ['Supply', 'Unit', 'Cost per unit', 'Cost from', 'Quantity counted'],
      ...rows.map((r) => {
        const supply = countableSupply(db, r.supplyId)!;
        const cost = latestPurchaseCost(db, supply, date);
        const source = cost.sourceNumber ? `${cost.sourceNumber} · ${cost.sourceDate}` : 'Catalogue';
        return [r.name, r.unit, csvPesos(r.defaultCostCents), source, ''];
      }),
    ]);
  });
}
