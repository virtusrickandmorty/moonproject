/**
 * Purchase requests (the owner's request, 26 Oct 2026): where each stands, the lists the approvers and the order and
 * expense forms read, and the decision. The owner or the accountant (pur.request.approve) approves or rejects a request
 * once; nobody but an owner decides on their own request, and a rejection says why. The decision is audited, so open
 * screens reload (engine/live.ts).
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { requestStatus, requestsIn } from './requests.ts';

const id = z.object({ id: z.string().trim().min(1).max(80) }).strict();
const listQuery = z.object({ state: z.enum(['waiting', 'approved']) }).strict();
const decideInput = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(300).optional() }).strict();

export function purRequestRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** Requests waiting for a decision, or approved and not used yet (each with its lines: the order and expense forms fill from them). */
  app.get('/api/pur/requests', { config: { permission: 'pur.request.view' } }, async (req) => requestsIn(db, listQuery.parse(req.query).state, true));

  /** One request: its lines, its decision, what used it, and whether this user may decide on it now. */
  app.get('/api/pur/requests/:id', { config: { permission: 'pur.request.view' } }, async (req) => {
    const r = requestStatus(db, id.parse(req.params).id);
    if (!r) throw notFound('The purchase request');
    const user = currentUser(req);
    const mayDecide = r.state === 'waiting' && user.permissions.has('pur.request.approve') && (r.requestedBy !== user.userId || user.roles.includes('owner'));
    return { ...r, mayDecide };
  });

  app.post('/api/pur/requests/:id/decide', { config: { permission: 'pur.request.approve' } }, async (req) => {
    const b = decideInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const r = requestStatus(db, id.parse(req.params).id);
      if (!r) throw notFound('The purchase request');
      if (r.status !== 'posted') throw conflict('REQUEST_CANCELLED', `${r.number} is cancelled.`);
      if (r.decision) throw conflict('ALREADY_DECIDED', `${r.number} was already ${r.decision.decision} by ${r.decision.userName}.`);
      if (r.requestedBy === user.userId && !user.roles.includes('owner')) {
        throw conflict('OWN_REQUEST', `${r.number} is your own request: the owner or another approver decides on it.`);
      }
      if (b.decision === 'rejected' && !b.note) throw new AppError('VALIDATION', 'Say why it is not approved, for the person who asked.', 422, [{ field: 'note', code: 'NOTE', level: 'error', message: 'Say why it is not approved.' }]);
      db.prepare('INSERT INTO pur_request_decisions (request_id, decision, note, user_id, at) VALUES (?, ?, ?, ?, ?)').run(r.id, b.decision, b.note ?? null, user.userId, at);
      appendAudit(db, { at, userId: user.userId, action: `pur.request.${b.decision}`, entityType: 'pur.request', entityId: r.id, data: { number: r.number, totalCents: r.totalCents, ...(b.note ? { note: b.note } : {}) } });
      return requestStatus(db, r.id);
    });
  });
}
