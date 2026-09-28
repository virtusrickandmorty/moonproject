import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, isBusinessDate, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { customerRef } from '../CUS/public.ts';
import { jobOrderRef } from '../JO/public.ts';
import { calendarItems, checkRange, currentEvent, eventHistory, type EventRow } from './calendar.ts';

const date = z.string().refine(isBusinessDate, 'Enter a real date in YYYY-MM-DD form.');
const eventInput = z.object({
  title: z.string().trim().min(1).max(160), date,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  customerId: z.string().uuid().nullable().optional(), jobOrderId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const moveInput = z.object({ date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional() }).strict();
const cancelInput = z.object({ reason: z.string().trim().min(10).max(300) }).strict();
const rangeInput = z.object({ from: date, to: date }).strict();

export function calRoutes(app: FastifyInstance, { db, clock }: AppDeps): void {
  const actor = (req: FastifyRequest) => currentUser(req);
  const writable = (req: FastifyRequest) => {
    clockGuard({ db, clock });
    return { userId: actor(req).userId, at: stamp(clock) };
  };
  const validateLinks = (req: FastifyRequest, customerId: string | null, jobOrderId: string | null) => {
    const user = actor(req);
    if (customerId) {
      if (!user.permissions.has('cus.view')) throw badRequest('CUSTOMER_PERMISSION', 'You cannot link a customer to this event.');
      if (!customerRef(db, customerId)) throw notFound('The customer');
    }
    if (jobOrderId) {
      if (!user.permissions.has('jo.view')) throw badRequest('JO_PERMISSION', 'You cannot link a job order to this event.');
      const jo = jobOrderRef(db, jobOrderId);
      if (!jo || jo.status !== 'posted') throw notFound('The job order');
      if (customerId && jo.customerId !== customerId) throw badRequest('CUSTOMER_MISMATCH', 'The job order belongs to another customer.');
    }
  };
  const insert = (row: EventRow) => db.prepare(`INSERT INTO cal_events
    (id, event_id, seq, action, title, event_date, event_time, customer_id, job_order_id, notes, reason, created_at, created_by)
    VALUES (@id, @eventId, @seq, @action, @title, @date, @time, @customerId, @jobOrderId, @notes, @reason, @createdAt, @createdBy)`).run(row);

  app.get('/api/cal', { config: { permission: 'cal.view' } }, async (req) => {
    const { from, to } = rangeInput.parse(req.query);
    checkRange(from, to);
    const user = actor(req);
    return calendarItems(db, from, to, (key) => user.permissions.has(key));
  });
  app.get<{ Params: { id: string } }>('/api/cal/events/:id/history', { config: { permission: 'cal.view' } }, async (req) => {
    const rows = eventHistory(db, req.params.id);
    if (!rows.length) throw notFound('The event');
    const permissions = actor(req).permissions;
    return rows.map((row) => ({ ...row,
      customerId: permissions.has('cus.view') ? row.customerId : null,
      jobOrderId: permissions.has('jo.view') ? row.jobOrderId : null,
    }));
  });
  app.post('/api/cal/events', { config: { permission: 'cal.events.create' } }, async (req) => {
    const input = eventInput.parse(req.body);
    return tx(db, () => {
      const who = writable(req);
      validateLinks(req, input.customerId ?? null, input.jobOrderId ?? null);
      const id = newId();
      const row: EventRow = { id, eventId: id, seq: 1, action: 'create', title: input.title, date: input.date,
        time: input.time ?? null, customerId: input.customerId ?? null, jobOrderId: input.jobOrderId ?? null,
        notes: input.notes ?? null, reason: null, createdAt: who.at, createdBy: who.userId };
      insert(row);
      appendAudit(db, { at: who.at, userId: who.userId, action: 'cal.event.create', entityType: 'cal.event', entityId: id, data: { ...row } });
      return row;
    });
  });
  app.post<{ Params: { id: string } }>('/api/cal/events/:id/move', { config: { permission: 'cal.events.create' } }, async (req) => {
    const input = moveInput.parse(req.body);
    return tx(db, () => {
      const who = writable(req);
      const old = currentEvent(db, req.params.id);
      if (!old) throw notFound('The event');
      if (old.action === 'cancel') throw conflict('EVENT_CANCELLED', 'A cancelled event cannot be moved.');
      const row: EventRow = { ...old, id: newId(), seq: old.seq + 1, action: 'move', date: input.date,
        time: input.time === undefined ? old.time : input.time, reason: null, createdAt: who.at, createdBy: who.userId };
      insert(row);
      appendAudit(db, { at: who.at, userId: who.userId, action: 'cal.event.move', entityType: 'cal.event', entityId: row.eventId, data: { ...row } });
      return row;
    });
  });
  app.post<{ Params: { id: string } }>('/api/cal/events/:id/cancel', { config: { permission: 'cal.events.create' } }, async (req) => {
    const { reason } = cancelInput.parse(req.body);
    return tx(db, () => {
      const who = writable(req);
      const old = currentEvent(db, req.params.id);
      if (!old) throw notFound('The event');
      if (old.action === 'cancel') throw conflict('EVENT_CANCELLED', 'This event is already cancelled.');
      const row: EventRow = { ...old, id: newId(), seq: old.seq + 1, action: 'cancel', reason,
        createdAt: who.at, createdBy: who.userId };
      insert(row);
      appendAudit(db, { at: who.at, userId: who.userId, action: 'cal.event.cancel', entityType: 'cal.event', entityId: row.eventId, data: { ...row } });
      return row;
    });
  });
}
