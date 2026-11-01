import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { catalogItemRef, searchCatalogItems } from '../CAT/public.ts';
import { searchSupplies } from '../PUR/public.ts';
import { garmentTypes } from '../RATE/public.ts';
import { garmentTypeGuess, pricesOnly, previewSheet, rulesNow, saveSheet, setRules, sheetOf, sheets } from './costing.ts';

export function estRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const can = (req: FastifyRequest, p: string) => currentUser(req).permissions.has(p);
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const search = z.object({ q: z.string().trim().max(100).default('') }).strict();

  /** Every cost sheet costed today; without est.cost.view, the suggested prices only. */
  app.get('/api/est/sheets', { config: { permission: 'est.view' } }, async (req) => {
    const all = sheets(db, today(clock));
    return can(req, 'est.cost.view') ? { sheets: all, rules: rulesNow(db), costs: true } : { sheets: all.map(pricesOnly), costs: false };
  });

  /** One item's sheet costed today, or a blank one to start (with the garment type its name suggests). */
  app.get<{ Params: { itemId: string } }>('/api/est/sheets/:itemId', { config: { permission: 'est.view' } }, async (req) => {
    const item = catalogItemRef(db, req.params.itemId);
    if (!item) throw notFound('That price list item does not exist.');
    const sheet = sheetOf(db, req.params.itemId, today(clock));
    if (!can(req, 'est.cost.view')) return { item, sheet: sheet ? pricesOnly(sheet) : null };
    return { item, sheet: sheet ?? null, garmentTypeGuess: garmentTypeGuess(db, item.name) };
  });

  /** The figures of a sheet being typed, before it is saved. */
  app.post('/api/est/sheets/preview', { config: { permission: 'est.manage' } }, async (req) => previewSheet(db, req.body, today(clock)));

  app.post('/api/est/sheets', { config: { permission: 'est.manage' } }, async (req) =>
    tx(db, () => { clockGuard({ db, clock }); return saveSheet(db, req.body, who(req)); }));

  app.get('/api/est/rules', { config: { permission: 'est.cost.view' } }, async () => rulesNow(db));
  app.post('/api/est/rules', { config: { permission: 'est.manage' } }, async (req) =>
    tx(db, () => { clockGuard({ db, clock }); return setRules(db, req.body, who(req)); }));

  /** Pickers for the sheet form: price list items, supplies and the piece-rate table's garment types. */
  app.get('/api/est/pickers', { config: { permission: 'est.manage' } }, async (req) => {
    const { q } = search.parse(req.query);
    return { items: q ? searchCatalogItems(db, q, 15) : [], supplies: q ? searchSupplies(db, q, 15) : [], garmentTypes: garmentTypes(db) };
  });
}
