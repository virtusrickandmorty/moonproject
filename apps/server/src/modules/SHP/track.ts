/**
 * The website's tracking page: a customer types an order number (an online order WEB-…, or a job order JO-… recorded in the
 * ERP) and sees where it is. The number alone opens it, so it shows only the status, the dates and how many pieces: never a
 * name, a phone, an address, an amount, a balance or what the items are. An online order's own secret token (the one its order
 * page uses) also shows its items and how it is delivered. Lookups are limited per sender, so numbers cannot be tried in bulk.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { trackedJobOrder } from '../JO/public.ts';
import { PUBLIC_TRACK_REQUESTS } from '../../engine/security/public-requests.ts';

export const LOOKUPS_PER_SENDER = PUBLIC_TRACK_REQUESTS;
const trackInput = z.object({ number: z.string().trim().min(3).max(30), token: z.string().min(10).max(100).optional() }).strict();
const NOT_FOUND = 'We found no order with that number. Check it, or call the shop.';

type OnlineStatus = 'awaiting_payment' | 'payment_sent' | 'confirmed' | 'rejected' | 'cancelled' | 'ready' | 'completed';
const ONLINE_WORDS: Record<OnlineStatus | 'expired', string> = {
  awaiting_payment: 'Waiting for your payment', payment_sent: 'Checking your payment', confirmed: 'Paid · being prepared', ready: 'Ready / sent',
  completed: 'Completed', rejected: 'Payment not confirmed', cancelled: 'Cancelled', expired: 'Expired (not paid in time)',
};

const knows = (tokenHash: string, token: string) => {
  const given = createHash('sha256').update(token).digest('hex');
  return given.length === tokenHash.length && timingSafeEqual(Buffer.from(given), Buffer.from(tokenHash));
};

export function shpTrackRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  app.post('/api/shp/track', { config: { permission: 'public' } }, async (req) => {
    const b = trackInput.parse(req.body);
    const now = clock.now().getTime();
    const number = b.number.toUpperCase().replace(/\s+/g, '');

    // An online order from the website.
    const o = db.prepare(`SELECT id, number, status, fulfilment, delivery_option AS deliveryOption, hold_until_ms AS holdUntil,
      created_at AS createdAt, token_hash AS tokenHash FROM shp_orders WHERE number = ?`).get(number) as
      { id: string; number: string; status: OnlineStatus; fulfilment: 'pickup' | 'delivery'; deliveryOption: string | null; holdUntil: number; createdAt: string; tokenHash: string } | undefined;
    if (o) {
      const status = o.status === 'awaiting_payment' && o.holdUntil <= now ? 'expired' : o.status;
      const rows = db.prepare('SELECT product_name AS name, size, colour, qty FROM shp_order_lines WHERE order_id = ? ORDER BY line_no').all(o.id) as { name: string; size: string; colour: string; qty: number }[];
      const shown = {
        kind: 'online', number: o.number, status, statusLabel: ONLINE_WORDS[status], placedAt: o.createdAt,
        pieces: rows.reduce((n, l) => n + l.qty, 0),
        events: db.prepare('SELECT status, at FROM shp_order_events WHERE order_id = ? ORDER BY at, rowid').all(o.id),
      };
      if (!b.token || !knows(o.tokenHash, b.token)) return shown;
      return {
        ...shown, fulfilment: o.fulfilment, deliveryOption: o.deliveryOption,
        lines: rows.map((l) => ({ description: `${l.name} (${l.colour}, ${l.size})`, qty: l.qty })),
      };
    }

    // A job order recorded in the ERP.
    const jo = trackedJobOrder(db, number);
    if (!jo) throw new AppError('NOT_FOUND', NOT_FOUND, 404);
    return { kind: 'job_order', number: jo.number, asked: number, status: jo.stage, statusLabel: jo.stageLabel, placedAt: jo.businessDate, dueDate: jo.dueDate, pieces: jo.lines.reduce((n, l) => n + l.qty, 0) };
  });
}
