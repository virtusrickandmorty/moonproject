/**
 * The website's tracking page: a customer types an order number (an online order WEB-…, or a job order JO-… recorded in the
 * ERP) and sees where it is. The number alone opens it, so it shows only the status, the items and the dates: never a name,
 * a phone, an address, an amount or a balance. Lookups are limited per sender, so numbers cannot be tried in bulk.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { trackedJobOrder } from '../JO/public.ts';

export const LOOKUPS_PER_SENDER = 20;
const WINDOW_MS = 10 * 60 * 1000;
const trackInput = z.object({ number: z.string().trim().min(3).max(30) }).strict();
const NOT_FOUND = 'We found no order with that number. Check it, or call the shop.';

type OnlineStatus = 'awaiting_payment' | 'payment_sent' | 'confirmed' | 'rejected' | 'cancelled' | 'ready' | 'completed';
const ONLINE_WORDS: Record<OnlineStatus | 'expired', string> = {
  awaiting_payment: 'Waiting for your payment', payment_sent: 'Checking your payment', confirmed: 'Paid · being prepared', ready: 'Ready / sent',
  completed: 'Completed', rejected: 'Payment not confirmed', cancelled: 'Cancelled', expired: 'Expired (not paid in time)',
};

export function shpTrackRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  // Lookups per sender in the last 10 minutes, kept in memory: a restart only forgives a few.
  const recent = new Map<string, number[]>();

  app.post('/api/shp/track', { config: { permission: 'public' } }, async (req) => {
    const b = trackInput.parse(req.body);
    const now = clock.now().getTime();
    const mine = (recent.get(req.ip) ?? []).filter((t) => t > now - WINDOW_MS);
    if (mine.length >= LOOKUPS_PER_SENDER) throw new AppError('TOO_MANY_LOOKUPS', 'Too many lookups just now. Please wait a few minutes and try again.', 429);
    recent.set(req.ip, [...mine, now]);
    const number = b.number.toUpperCase().replace(/\s+/g, '');

    // An online order from the website.
    const o = db.prepare(`SELECT id, number, status, fulfilment, delivery_option AS deliveryOption, hold_until_ms AS holdUntil,
      created_at AS createdAt FROM shp_orders WHERE number = ?`).get(number) as
      { id: string; number: string; status: OnlineStatus; fulfilment: 'pickup' | 'delivery'; deliveryOption: string | null; holdUntil: number; createdAt: string } | undefined;
    if (o) {
      const status = o.status === 'awaiting_payment' && o.holdUntil <= now ? 'expired' : o.status;
      return {
        kind: 'online', number: o.number, status, statusLabel: ONLINE_WORDS[status], placedAt: o.createdAt,
        fulfilment: o.fulfilment, deliveryOption: o.deliveryOption,
        lines: (db.prepare('SELECT product_name AS name, size, colour, qty FROM shp_order_lines WHERE order_id = ? ORDER BY line_no').all(o.id) as { name: string; size: string; colour: string; qty: number }[])
          .map((l) => ({ description: `${l.name} (${l.colour}, ${l.size})`, qty: l.qty })),
        events: db.prepare('SELECT status, at FROM shp_order_events WHERE order_id = ? ORDER BY at, rowid').all(o.id),
      };
    }

    // A job order recorded in the ERP.
    const jo = trackedJobOrder(db, number);
    if (!jo) throw new AppError('NOT_FOUND', NOT_FOUND, 404);
    return { kind: 'job_order', number: jo.number, asked: number, status: jo.stage, statusLabel: jo.stageLabel, placedAt: jo.businessDate, dueDate: jo.dueDate, lines: jo.lines };
  });
}
