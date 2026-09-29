import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { currentStage, jobOrderRef, lineState } from '../JO/public.ts';
import { garmentTypes } from '../RATE/public.ts';
import { activeEmployees } from './emp.ts';
import { COMPLEXITIES, availableFor, board, lineRoute, lineSetup, listSteps, listTemplates, setupLine, stepAction, stepById, type StepAction } from './production.ts';

const setupBody = z
  .object({ templateId: z.number().int().positive().optional(), stepIds: z.array(z.number().int().positive()).min(1).max(20), garmentType: z.string().trim().min(1).max(60), complexity: z.enum(COMPLEXITIES) })
  .strict();
const stepBody = z.object({ name: z.string().trim().min(1).max(60).optional(), payBasis: z.enum(['piece', 'daily', 'piece_or_daily']).optional(), isActive: z.boolean().optional() }).strict();
const ACTIONS: Record<string, StepAction> = { complete: 'complete', 'not-needed': 'not_needed', reopen: 'reopen' };
type LineParams = { jo: string; line: string };
const lineNoOf = (p: LineParams) => {
  const n = Number(p.line);
  if (!Number.isInteger(n) || n < 1) throw notFound('The job order line');
  return n;
};

export function prdRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  /** What the production screens pick from: steps (canonical order), route templates, garment types with rates, complexities. */
  app.get('/api/prd/catalogue', { config: { permission: 'prd.view' } }, async () => ({ steps: listSteps(db), templates: listTemplates(db), garmentTypes: garmentTypes(db), complexities: COMPLEXITIES }));

  app.get('/api/prd/board', { config: { permission: 'prd.view' } }, async () => board(db));

  app.get('/api/prd/tv', { config: { permission: 'prd.tv' } }, async () => ({ cards: board(db), steps: listSteps(db) }));

  /** One job order's production: each line's setup and route, with the pieces each step may still take (E7 rules 1–2). */
  app.get<{ Params: { jo: string } }>('/api/prd/jobs/:jo', { config: { permission: 'prd.view' } }, async (req) => {
    const jo = jobOrderRef(db, req.params.jo);
    if (!jo) throw notFound('The job order');
    const lines = lineState(db, jo.id).map((l) => {
      const route = lineRoute(db, jo.id, l.lineNo);
      return {
        lineNo: l.lineNo, description: l.description, qty: l.qty, releasedQty: l.releasedQty, setup: lineSetup(db, jo.id, l.lineNo) ?? null,
        route: route?.map((s) => ({ ...s, availablePieces: availableFor(route, s.id, l.qty) })) ?? null,
      };
    });
    return { jobOrder: { id: jo.id, number: jo.number, status: jo.status, customerName: jo.customerName, dueDate: jo.dueDate, priority: jo.priority, stage: currentStage(db, jo.id) }, lines };
  });

  app.post<{ Params: LineParams }>('/api/prd/jobs/:jo/lines/:line/setup', { config: { permission: 'prd.progress' } }, async (req) => {
    const body = setupBody.parse(req.body);
    return write(() => setupLine(db, req.params.jo, lineNoOf(req.params), body, who(req)));
  });

  /** Complete, Not needed or Reopen one step of a line (the board's buttons). */
  app.post<{ Params: LineParams & { step: string; action: string } }>('/api/prd/jobs/:jo/lines/:line/steps/:step/:action', { config: { permission: 'prd.progress' } }, async (req) => {
    const action = ACTIONS[req.params.action];
    if (!action) throw notFound('That action');
    const body = z.object({ reason: z.string().max(500).optional() }).strict().parse(req.body ?? {});
    return write(() => stepAction(db, req.params.jo, lineNoOf(req.params), Number(req.params.step), action, body.reason, who(req)));
  });

  /** Workers who can be given pieces (active employees). */
  app.get('/api/prd/workers', { config: { permission: 'prd.assign' } }, async () => activeEmployees(db).map(({ id, code, name }) => ({ id, code, name })));

  /** Rename a step, change its default pay basis, or switch it on or off (QC is off by default, OWN-24). Needs If-Match. */
  app.put<{ Params: { id: string } }>('/api/prd/steps/:id', { config: { permission: 'prd.steps' } }, async (req) => {
    const body = stepBody.parse(req.body);
    return write(() => {
      const step = stepById(db, Number(req.params.id));
      if (!step) throw notFound('The step');
      const raw = req.headers['if-match'];
      if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new AppError('VERSION_REQUIRED', 'Reload the steps before saving.', 428);
      if (Number(raw) !== step.version) throw conflict('VERSION_CHANGED', 'Someone changed this step. Reload and check.');
      const next = { name: body.name ?? step.name, payBasis: body.payBasis ?? step.payBasis, isActive: body.isActive ?? step.isActive };
      const { at, userId } = who(req);
      db.prepare('UPDATE prd_steps SET name = ?, pay_basis = ?, is_active = ?, version = version + 1, updated_at = ? WHERE id = ?').run(next.name, next.payBasis, next.isActive ? 1 : 0, at, step.id);
      appendAudit(db, { at, userId, action: 'prd.step_edit', entityType: 'prd.step', entityId: String(step.id), data: { before: { name: step.name, payBasis: step.payBasis, isActive: step.isActive }, after: next } });
      return stepById(db, step.id);
    });
  });
}
