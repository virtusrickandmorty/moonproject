/**
 * Online orders from the website shop (ready-stock items only). Payment first: the customer places the order (its pieces are
 * held for 24 hours), pays by the shop's QR and sends the reference and a screenshot; staff check the bank by hand and either
 * confirm it, which records a quick sale and its payment (the usual journal: Dr cash / Cr receivable, Cr sales, Cr output VAT,
 * PLAN QS-SALE), or reject it with a reason. The customer follows the order on a page only their link opens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, formatPeso, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { sha256Hex, sniffType } from '../../engine/attachments.ts';
import { engineEnv } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { PUBLIC_RATE_MESSAGE } from '../../engine/security/sessions.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { placesFor } from '../CASH/public.ts';
import { enqueueOnlineOrder, plain } from '../COM/public.ts';
import { cancelQuickSale, recordQuickSale, saleRef } from '../QS/public.ts';
import { HOLD_MS, OVERDUE_LABEL, isOverdue, stockOf } from './public.ts';

export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
export const ORDERS_PER_SENDER_PER_HOUR = 5;
export const ORDERS_PER_HOUR = 60;
/** Orders with a payment sent and no staff decision yet, all customers together; past it the website asks buyers to call the shop. */
export const MAX_PAYMENTS_WAITING = 100;
const HOUR_MS = 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?(?:[\s()-]*\d){7,15}[\s()-]*$/;
const b64 = (bytes: number) => Math.ceil(bytes / 3) * 4 + 4;

const orderInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  fulfilment: z.enum(['pickup', 'delivery']),
  // For delivery: house, street and barangay, then the city or municipality and the province, which decide the area and its fee.
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(60).optional(),
  province: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  consent: z.literal(true),
  website: z.string().max(0).optional(), // left empty by people; a robot filling every field gives itself away
  lines: z.array(z.object({ productId: z.string().min(1).max(64), size: z.string().min(1).max(4), colour: z.string().trim().min(1).max(30), qty: z.number().int().min(1).max(100) }).strict()).min(1).max(20),
}).strict();
const paymentInput = z.object({
  token: z.string().min(10).max(100),
  reference: z.string().trim().min(4).max(60),
  proof: z.object({ name: z.string().max(200), data: z.string().max(b64(MAX_PROOF_BYTES)) }).strict(),
}).strict();
const tokenInput = z.object({ token: z.string().min(10).max(100) }).strict();
const confirmInput = z.object({
  customerId: z.uuid(), // "Walk-in" usually; a known customer if the buyer is one
  invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the invoice number from the booklet (digits only).'),
  crNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the CR number from the booklet (digits only).'),
  version: z.number().int().min(1),
}).strict();
const rejectInput = z.object({ reason: z.string().trim().min(10).max(500), version: z.number().int().min(1) }).strict();
/** Staff cancel or return an order that was confirmed: the reason is kept with the order; the buyer sees only the new status. */
const reverseInput = z.object({ reason: z.string().trim().min(10).max(200), version: z.number().int().min(1) }).strict();
const moveInput = z.object({ to: z.enum(['ready', 'completed']), note: z.string().trim().max(500).optional(), version: z.number().int().min(1) }).strict();
const settingsInput = z.object({
  bankName: z.string().trim().min(1).max(60), accountName: z.string().trim().min(1).max(100), accountHint: z.string().trim().max(40).optional(),
  instructions: z.string().trim().max(500).optional(), cashPlaceId: z.number().int().positive(),
  qr: z.object({ name: z.string().max(200), data: z.string().max(b64(MAX_PROOF_BYTES)) }).strict().optional(), // omitted: keep the current QR
  /** Where the shop delivers and for how much; none: pickup only. */
  deliveryOptions: z.array(z.object({
    name: z.string().trim().min(1).max(60), feeCents: z.number().int().min(0).max(10_000_000),
    places: z.array(z.string().trim().min(1).max(60)).max(200).default([]), // the cities, municipalities and provinces it covers
    otherwise: z.boolean().default(false), // takes every address no other area lists
  }).strict()).max(10)
    .refine((o) => new Set(o.map((x) => x.name.toLowerCase())).size === o.length, 'Each delivery area needs its own name.')
    .refine((o) => o.filter((x) => x.otherwise).length <= 1, 'Only one delivery area can take every other address.')
    .refine((o) => o.every((x) => x.otherwise || x.places.length > 0), 'List the places each delivery area covers (or let it take every other address).')
    .default([]),
}).strict();

export type OrderStatus = 'awaiting_payment' | 'payment_sent' | 'confirmed' | 'rejected' | 'cancelled' | 'ready' | 'completed' | 'expired' | 'returned';
interface OrderRow {
  id: string; number: string; status: Exclude<OrderStatus, 'expired' | 'returned'>; name: string; email: string; phone: string; fulfilment: 'pickup' | 'delivery';
  address: string | null; note: string | null; total_cents: number; hold_until_ms: number; token_hash: string; payment_reference: string | null;
  payment_sent_at: string | null; sale_document_id: string | null; created_at: string; version: number; updated_at: string; sale_number?: string | null;
  delivery_option: string | null; delivery_fee_cents: number; payment_version: number | null; cash_place_id: number | null;
  reversal_kind: 'cancelled' | 'returned' | null; reversal_reason: string | null; reversal_at: string | null;
}
/** An order still waiting for payment after its 24 hours has expired: its pieces are back on sale. One staff returned after it went out shows as returned. */
const statusOf = (o: OrderRow, nowMs: number): OrderStatus =>
  (o.status === 'awaiting_payment' && o.hold_until_ms <= nowMs ? 'expired' : o.status === 'cancelled' && o.reversal_kind === 'returned' ? 'returned' : o.status);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ORDER = `SELECT o.*, d.number AS sale_number FROM shp_orders o LEFT JOIN documents d ON d.id = o.sale_document_id`;

/** The picture as sent, checked by its first bytes: JPEG, PNG or WebP only. */
function picture(f: { name: string; data: string }, what: string) {
  const data = Buffer.from(f.data, 'base64');
  const type = sniffType(data);
  if (!data.length || !type || type === 'application/pdf') throw new AppError('FILE_TYPE', `The ${what} must be a JPEG, PNG or WebP picture.`, 415);
  if (data.length > MAX_PROOF_BYTES) throw new AppError('FILE_TOO_BIG', `The ${what} is bigger than 4 MB. Send a smaller picture.`, 413);
  return { type, data, sha256: sha256Hex(data) };
}

/** The payment settings of a version (default: the latest) with its delivery areas, without the QR's bytes. */
function paymentSettings(db: Db, version?: number) {
  const p = db.prepare(`SELECT version, bank_name AS bankName, account_name AS accountName, account_hint AS accountHint, instructions,
    cash_place_id AS cashPlaceId, saved_at AS savedAt FROM shp_payment_settings ${version === undefined ? '' : 'WHERE version = ?'} ORDER BY version DESC LIMIT 1`).get(...(version === undefined ? [] : [version])) as
    { version: number; bankName: string; accountName: string; accountHint: string | null; instructions: string | null; cashPlaceId: number; savedAt: string } | undefined;
  if (!p) return undefined;
  const places = db.prepare('SELECT position, place FROM shp_delivery_places WHERE version = ? ORDER BY position, rowid').all(p.version) as { position: number; place: string }[];
  const deliveryOptions = (db.prepare('SELECT position, name, fee_cents AS feeCents, is_default AS isDefault FROM shp_delivery_options WHERE version = ? ORDER BY position').all(p.version) as
    { position: number; name: string; feeCents: number; isDefault: number }[])
    .map((o) => ({ name: o.name, feeCents: o.feeCents, otherwise: o.isDefault === 1, places: places.filter((x) => x.position === o.position).map((x) => x.place) }));
  return { ...p, deliveryOptions };
}

/** A place name as typed or listed, for comparing: lower case, no accents ("Parañaque" = "paranaque"), single spaces. */
const placeKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(city of|city)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * The delivery area for an address: the first area listing its city or municipality, else its province, else the area that
 * takes every other address. Null: the shop does not deliver there.
 */
export function areaFor(options: { name: string; feeCents: number; places: string[]; otherwise: boolean }[], city: string, province: string) {
  const c = placeKey(city), p = placeKey(province);
  const lists = (o: { places: string[] }, key: string) => key !== '' && o.places.some((x) => placeKey(x) === key);
  return options.find((o) => lists(o, c)) ?? options.find((o) => lists(o, p)) ?? options.find((o) => o.otherwise) ?? null;
}
/** What the website shows about paying (and delivering), never the cash account. */
const publicPayment = (p: NonNullable<ReturnType<typeof paymentSettings>>) => ({
  bankName: p.bankName, accountName: p.accountName, accountHint: p.accountHint, instructions: p.instructions, qrUrl: `/api/shp/payment/qr/${p.version}`, deliveryOptions: p.deliveryOptions,
});

/** The settings an order was placed under; an order without a snapshot (placed before it existed) uses the latest. */
const paymentOf = (db: Db, o: OrderRow) => (o.payment_version === null ? undefined : paymentSettings(db, o.payment_version)) ?? paymentSettings(db);

/** Order data names the buyer: browsers and shared caches must not keep it. */
const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'private, no-store');

/** The order a customer's link names: the number and the secret token must both match. */
export function findCustomersOrder(db: Db, number: string, token: string) {
  const o = db.prepare(`${ORDER} WHERE o.number = ?`).get(number) as OrderRow | undefined;
  if (!o || !sameHash(o.token_hash, hash(token))) throw notFound('The order');
  return o;
}

export function shpOrderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const nowMs = () => clock.now().getTime();
  const lines = (orderId: string) => db.prepare(`SELECT line_no AS lineNo, product_id AS productId, product_name AS productName, size, colour, qty,
    unit_price_cents AS unitPriceCents FROM shp_order_lines WHERE order_id = ? ORDER BY line_no`).all(orderId) as
    { lineNo: number; productId: string; productName: string; size: string; colour: string; qty: number; unitPriceCents: number }[];
  const event = (orderId: string, status: string, at: string, userId: string | null, note?: string | null) =>
    db.prepare('INSERT INTO shp_order_events (id, order_id, status, user_id, note, at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), orderId, status, userId, note ?? null, at);
  const customersOrder = (number: string, token: string) => findCustomersOrder(db, number, token);
  const staffOrder = (id: string) => {
    const o = db.prepare(`${ORDER} WHERE o.id = ?`).get(id) as OrderRow | undefined;
    if (!o) throw notFound('The order');
    return o;
  };
  const sameVersion = (o: OrderRow, version: number) => { if (o.version !== version) throw conflict('STALE', 'This order changed meanwhile. Reload it and try again.'); };
  const setStatus = (o: OrderRow, status: string, at: string, extra = '', ...args: unknown[]) =>
    db.prepare(`UPDATE shp_orders SET status = ?, version = version + 1, updated_at = ?${extra} WHERE id = ?`).run(status, at, ...args, o.id);

  /** What the customer sees: never the staff's names, the IP or the token. */
  const forCustomer = (o: OrderRow) => {
    const pay = paymentOf(db, o);
    return {
      number: o.number, status: statusOf(o, nowMs()), name: o.name, fulfilment: o.fulfilment, address: o.address, totalCents: o.total_cents,
      deliveryOption: o.delivery_option, deliveryFeeCents: o.delivery_fee_cents,
      holdUntil: new Date(o.hold_until_ms).toISOString(), paymentReference: o.payment_reference, saleNumber: o.sale_number ?? null, lines: lines(o.id),
      // Staff's reason for cancelling or returning a confirmed order stays with the shop: the buyer sees the status only.
      events: db.prepare(`SELECT status, CASE WHEN status IN ('cancelled', 'returned') AND user_id IS NOT NULL THEN NULL ELSE note END AS note, at
        FROM shp_order_events WHERE order_id = ? ORDER BY at, rowid`).all(o.id),
      payment: pay ? publicPayment(pay) : null,
      // The items the buyer has rated (a completed order's items can each be rated once).
      reviewed: db.prepare('SELECT product_id FROM shp_reviews WHERE order_id = ?').pluck().all(o.id) as string[],
    };
  };

  /** Whether an expired order's pieces are all still available, so a late payment can still be taken (none are held for it now). */
  const stillAvailable = (o: OrderRow) => {
    const ls = lines(o.id);
    const stock = stockOf(db, [...new Set(ls.map((l) => l.productId))], nowMs());
    return ls.every((l) => (stock.get(l.productId)?.find((s) => s.size === l.size && s.colour === l.colour)?.available ?? 0) >= l.qty);
  };

  /**
   * Inside the confirm transaction: every item must have as many pieces available as the order needs, not counting the pieces
   * this order holds itself (they are about to become its sale). The counter may have sold them since the order was placed.
   * An item the product no longer lists has no count to compare, so it is left to the sale's own stock warning.
   */
  const enoughPieces = (o: OrderRow, status: OrderStatus) => {
    const ls = lines(o.id);
    const stock = stockOf(db, [...new Set(ls.map((l) => l.productId))], nowMs());
    const holding = status === 'payment_sent' || status === 'awaiting_payment';
    for (const l of ls) {
      const s = stock.get(l.productId)?.find((x) => x.size === l.size && x.colour === l.colour);
      if (!s) continue;
      const available = s.onHand - (s.held - (holding ? l.qty : 0));
      if (available < l.qty) {
        throw new AppError('OUT_OF_STOCK', `${l.productName} (${l.colour}, size ${l.size}) has ${Math.max(0, available)} available now and ${o.number} needs ${l.qty}. Count the stock if the pieces are here, or reject the order with a reason and refund the customer.`, 409);
      }
    }
  };

  /** Tells the buyer by email (when the shop sends emails); an email that cannot be queued never stops the order. */
  const tell = (o: OrderRow, step: 'placed' | 'confirmed' | 'rejected' | 'ready', at: string, extra: { link?: string; reason?: string; userId?: string } = {}) => {
    const items = lines(o.id).map((l) => `  - ${l.qty} x ${plain(l.productName)} (${plain(l.colour)}, ${l.size})`).join('\n');
    const total = formatPeso(o.total_cents);
    const words: Record<typeof step, [string, string]> = {
      placed: [`Your order ${o.number}: please pay ${total}`, `Thank you for your order. Your pieces are held for 24 hours while you pay.\n\n${items}${o.delivery_fee_cents ? `\n  - Delivery (${plain(o.delivery_option ?? '')}): ${formatPeso(o.delivery_fee_cents)}` : ''}\nTotal: ${total}\n\nPay the exact amount by the QR on your order page, then send us the reference number and a screenshot there:\n${extra.link ?? ''}\n\nKeep this email: the link is the only way to open your order.`],
      confirmed: [`Your order ${o.number}: payment confirmed`, `We found your payment of ${total}. Your order is being prepared:\n\n${items}\n\nWe will email you again when it is ${o.fulfilment === 'pickup' ? 'ready for pickup' : 'sent out'}.`],
      rejected: [`Your order ${o.number}: we could not confirm your payment`, `We could not confirm your payment for order ${o.number}.\n\n${plain(extra.reason ?? '')}\n\nIf you did pay, reply to this email with your reference number and we will check again.`],
      ready: [`Your order ${o.number} is ${o.fulfilment === 'pickup' ? 'ready for pickup' : 'on its way'}`, o.fulfilment === 'pickup' ? `Your order is ready. Bring your order number, ${o.number}, when you pick it up.` : `Your order has been sent out to ${plain(o.address ?? '')}.`],
    };
    try {
      enqueueOnlineOrder(db, { to: o.email, name: o.name, orderNumber: o.number, dedupeKey: `online_order:${o.id}:${step}`, at, userId: extra.userId,
        build: (company) => ({ subject: words[step][0], body: `Hello ${plain(o.name)},\n\n${words[step][1]}\n\nThank you,\n${company}` }) });
    } catch { /* the wording check refused it: the order goes on, staff can still call or message */ }
  };

  // ---- The website (no sign-in) ----

  /** How to pay, or null while the owner has not set it up (the website then takes no online orders). */
  app.get('/api/shp/payment', { config: { permission: 'public' } }, async () => {
    const p = paymentSettings(db);
    return p ? publicPayment(p) : null;
  });
  /** The delivery area and fee for an address, as the checkout shows it before the order is placed (placing works it out again). */
  app.get<{ Querystring: { city?: string; province?: string } }>('/api/shp/delivery-fee', { config: { permission: 'public' } }, async (req) => {
    const city = String(req.query.city ?? '').slice(0, 60), province = String(req.query.province ?? '').slice(0, 60);
    const area = areaFor(paymentSettings(db)?.deliveryOptions ?? [], city, province);
    return area ? { delivers: true, area: area.name, feeCents: area.feeCents } : { delivers: false };
  });

  app.get<{ Params: { version: string } }>('/api/shp/payment/qr/:version', { config: { permission: 'public' } }, async (req, reply) => {
    const q = db.prepare('SELECT qr_content_type AS type, qr_data AS data FROM shp_payment_settings WHERE version = ?').get(Number(req.params.version)) as { type: string; data: Buffer } | undefined;
    if (!q) throw notFound('The QR code');
    return reply.type(q.type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'").header('Cache-Control', 'public, max-age=86400').send(q.data);
  });

  app.post('/api/shp/orders', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const b = orderInput.parse(req.body);
    if (!EMAIL.test(b.email)) throw new AppError('EMAIL_REQUIRED', 'Please give a valid email address so we can reach you about your order.', 400);
    if (!PHONE.test(b.phone)) throw new AppError('PHONE_REQUIRED', 'Please give your mobile number, like 0917 123 4567.', 400);
    const now = nowMs(), at = stamp(clock);
    return tx(db, () => {
      const pay = paymentSettings(db);
      if (!pay) throw conflict('NO_ONLINE_PAYMENT', 'Online ordering is not open yet. Please call or message the shop.');
      if (b.fulfilment === 'delivery' && !pay.deliveryOptions.length) throw new AppError('DELIVERY_AREA', 'The shop does not deliver online orders yet: pick pickup at the shop.', 400);
      if (b.fulfilment === 'delivery' && (!b.address || !b.city || !b.province)) throw new AppError('ADDRESS_REQUIRED', 'Please give the full delivery address: house, street and barangay, city or municipality, and province.', 400);
      const area = b.fulfilment === 'delivery' ? areaFor(pay.deliveryOptions, b.city!, b.province!) : null;
      if (b.fulfilment === 'delivery' && !area) throw new AppError('DELIVERY_AREA', `We do not deliver to ${b.city}, ${b.province} yet. Pick pickup at the shop, or call us.`, 400);
      const since = now - HOUR_MS;
      const mine = db.prepare('SELECT COUNT(*) AS n FROM shp_orders WHERE ip = ? AND created_ms > ?').get(req.ip, since) as { n: number };
      const all = db.prepare('SELECT COUNT(*) AS n FROM shp_orders WHERE created_ms > ?').get(since) as { n: number };
      if (mine.n >= ORDERS_PER_SENDER_PER_HOUR || all.n >= ORDERS_PER_HOUR) throw new AppError('TOO_MANY_ORDERS', PUBLIC_RATE_MESSAGE, 429);
      // One line per item, prices from the shop (never from the browser), and only what is available now.
      const wanted = new Map<string, { productId: string; size: string; colour: string; qty: number }>();
      for (const l of b.lines) {
        const k = `${l.productId}|${l.size}|${l.colour}`;
        wanted.set(k, { ...l, qty: (wanted.get(k)?.qty ?? 0) + l.qty });
      }
      const ids = [...new Set([...wanted.values()].map((l) => l.productId))];
      const products = new Map((db.prepare(`SELECT id, name, price_cents AS priceCents, made_to_order AS mto, is_active AS active FROM shp_products
        WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as { id: string; name: string; priceCents: number; mto: number; active: number }[]).map((p) => [p.id, p]));
      const stock = stockOf(db, ids, now);
      const priced = [...wanted.values()].map((l) => {
        const p = products.get(l.productId);
        if (!p || !p.active) throw new AppError('ITEM', 'An item in your cart is no longer in the shop. Remove it and try again.', 409);
        if (p.mto) throw new AppError('MADE_TO_ORDER', `${p.name} is made to order: request a quotation for it instead.`, 409);
        const s = stock.get(p.id)?.find((x) => x.size === l.size && x.colour === l.colour);
        if (!s) throw new AppError('ITEM', `${p.name} does not come in ${l.colour}, size ${l.size}.`, 409);
        if (s.available < l.qty) {
          throw new AppError('OUT_OF_STOCK', s.available ? `Only ${s.available} of ${p.name} (${l.colour}, ${l.size}) left. Lower the quantity and try again.` : `${p.name} (${l.colour}, ${l.size}) just sold out.`, 409);
        }
        return { ...l, name: p.name, unitPriceCents: p.priceCents };
      });
      const fee = area?.feeCents ?? 0;
      const total = priced.reduce((s, l) => s + l.qty * l.unitPriceCents, 0) + fee;
      if (total <= 0) throw new AppError('NOTHING_TO_PAY', 'The order comes to ₱0.00.', 400);
      const count = (db.prepare('SELECT COUNT(*) AS n FROM shp_orders').get() as { n: number }).n;
      const id = newId(), number = `WEB-${String(count + 1).padStart(6, '0')}`, token = randomBytes(24).toString('base64url');
      db.prepare(`INSERT INTO shp_orders (id, number, status, name, email, phone, fulfilment, address, note, total_cents, hold_until_ms, token_hash, ip, created_at, created_ms, updated_at,
          delivery_option, delivery_fee_cents, payment_version, cash_place_id)
        VALUES (?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, number, b.name, b.email, b.phone, b.fulfilment, b.fulfilment === 'delivery' ? `${b.address}, ${b.city}, ${b.province}` : null,
        b.note ?? null, total, now + HOLD_MS, hash(token), req.ip, at, now, at, area?.name ?? null, fee, pay.version, pay.cashPlaceId);
      const line = db.prepare('INSERT INTO shp_order_lines (order_id, line_no, product_id, product_name, size, colour, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      priced.forEach((l, i) => line.run(id, i + 1, l.productId, l.name, l.size, l.colour, l.qty, l.unitPriceCents));
      event(id, 'awaiting_payment', at, null);
      appendAudit(db, { at, userId: null, action: 'shp.order.placed', entityType: 'shp.order', entityId: id, data: { number, totalCents: total, lines: priced.length } });
      // The first email carries the order's own link: the address the buyer used to reach the site, with the secret (never kept).
      const site = /^https?:\/\/[\w.-]+(:\d+)?$/.test(String(req.headers.origin ?? '')) ? String(req.headers.origin) : `${req.protocol}://${req.headers.host}`;
      tell(staffOrder(id), 'placed', at, { link: `${site}/order/${number}?t=${token}` });
      return { number, token, totalCents: total, holdUntil: new Date(now + HOLD_MS).toISOString() };
    });
  });

  app.get<{ Params: { number: string }; Querystring: { t?: string } }>('/api/shp/orders/:number', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return forCustomer(customersOrder(req.params.number, String(req.query.t ?? '')));
  });

  app.post<{ Params: { number: string } }>('/api/shp/orders/:number/payment', { bodyLimit: b64(MAX_PROOF_BYTES) + 16 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const b = paymentInput.parse(req.body);
    const proof = picture(b.proof, 'proof of payment');
    const at = stamp(clock);
    return tx(db, () => {
      const o = customersOrder(req.params.number, b.token);
      const status = statusOf(o, nowMs());
      // Paid after the 24 hours: still taken while every piece is available; otherwise the buyer is told to contact the shop.
      if (status === 'expired' && !stillAvailable(o)) throw conflict('EXPIRED', 'This order expired before the payment was sent, and some of its items have sold since. If you already paid, call or message the shop with your reference number.');
      if (status !== 'awaiting_payment' && status !== 'expired') throw conflict('NOT_AWAITING_PAYMENT', 'The payment for this order was already sent.');
      const waiting = (db.prepare("SELECT COUNT(*) FROM shp_orders WHERE status = 'payment_sent'").pluck().get() as number);
      if (waiting >= MAX_PAYMENTS_WAITING) throw new AppError('TOO_MANY_PAYMENTS', 'The shop has many payments waiting to be checked just now, so we cannot take another here. Please call or message the shop with your order number and reference.', 429);
      db.prepare('INSERT INTO shp_order_files (id, order_id, content_type, bytes, sha256, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), o.id, proof.type, proof.data.length, proof.sha256, proof.data, at);
      setStatus(o, 'payment_sent', at, ', payment_reference = ?, payment_sent_at = ?', b.reference, at);
      event(o.id, 'payment_sent', at, null, `Reference ${b.reference}`);
      appendAudit(db, { at, userId: null, action: 'shp.order.payment_sent', entityType: 'shp.order', entityId: o.id, data: { number: o.number, reference: b.reference, bytes: proof.data.length } });
      return forCustomer(customersOrder(req.params.number, b.token));
    });
  });

  app.post<{ Params: { number: string } }>('/api/shp/orders/:number/cancel', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    const b = tokenInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      const o = customersOrder(req.params.number, b.token);
      if (statusOf(o, nowMs()) !== 'awaiting_payment') throw conflict('CANNOT_CANCEL', 'Only an order still waiting for payment can be cancelled here. Please call or message the shop.');
      setStatus(o, 'cancelled', at);
      event(o.id, 'cancelled', at, null, 'Cancelled by the customer');
      return forCustomer(customersOrder(req.params.number, b.token));
    });
  });

  // ---- The ERP ----

  app.get<{ Querystring: { status?: string } }>('/api/shp/admin/orders', { config: { permission: 'shp.orders.view' } }, async (req) => {
    const now = nowMs();
    const rows = (db.prepare(`${ORDER} ORDER BY o.created_ms DESC LIMIT 300`).all() as OrderRow[]).map((o) => ({
      id: o.id, number: o.number, status: statusOf(o, now), name: o.name, phone: o.phone, fulfilment: o.fulfilment, totalCents: o.total_cents,
      createdAt: o.created_at, paymentReference: o.payment_reference, saleNumber: o.sale_number ?? null,
      // A payment sent and not decided for 72 hours: still held and still waiting for staff, shown so it is not forgotten.
      overdue: isOverdue(o, now), statusLabel: isOverdue(o, now) ? OVERDUE_LABEL : null,
    }));
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const wanted = req.query.status && req.query.status !== 'all' ? req.query.status : null;
    return { rows: wanted ? rows.filter((r) => r.status === wanted) : rows, counts };
  });

  app.get('/api/shp/admin/orders/:id', { config: { permission: 'shp.orders.view' } }, async (req) => {
    const o = staffOrder((req.params as { id: string }).id);
    return {
      id: o.id, number: o.number, status: statusOf(o, nowMs()), name: o.name, email: o.email, phone: o.phone, fulfilment: o.fulfilment, address: o.address, note: o.note,
      deliveryOption: o.delivery_option, deliveryFeeCents: o.delivery_fee_cents, lateButAvailable: statusOf(o, nowMs()) === 'expired' ? stillAvailable(o) : null,
      totalCents: o.total_cents, holdUntil: new Date(o.hold_until_ms).toISOString(), paymentReference: o.payment_reference, paymentSentAt: o.payment_sent_at,
      saleId: o.sale_document_id, saleNumber: o.sale_number ?? null, createdAt: o.created_at, version: o.version, lines: lines(o.id),
      reversal: o.reversal_kind ? { kind: o.reversal_kind, reason: o.reversal_reason, at: o.reversal_at } : null,
      proofs: db.prepare('SELECT id, content_type AS contentType, bytes, at FROM shp_order_files WHERE order_id = ? ORDER BY at').all(o.id),
      events: db.prepare(`SELECT e.status, e.note, e.at, u.display_name AS userName FROM shp_order_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.order_id = ? ORDER BY e.at, e.rowid`).all(o.id),
      overdue: isOverdue(o, nowMs()), statusLabel: isOverdue(o, nowMs()) ? OVERDUE_LABEL : null,
      payment: paymentOf(db, o) ?? null,
    };
  });

  app.get<{ Params: { id: string; fileId: string } }>('/api/shp/admin/orders/:id/proofs/:fileId', { config: { permission: 'shp.orders.view' } }, async (req, reply) => {
    const f = db.prepare('SELECT content_type AS type, data FROM shp_order_files WHERE id = ? AND order_id = ?').get(req.params.fileId, req.params.id) as { type: string; data: Buffer } | undefined;
    if (!f) throw notFound('The proof of payment');
    return reply.type(f.type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'").header('Cache-Control', 'private, no-store').send(f.data);
  });

  /**
   * Staff found the money in the bank: record the sale and its payment now (quick sale + collection into the online payment
   * cash account), in one transaction with the order. The order stops holding its pieces first, so the sale takes them.
   */
  app.post('/api/shp/admin/orders/:id/confirm', { config: { permission: 'shp.orders.manage' } }, async (req) => {
    const b = confirmInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const o = staffOrder((req.params as { id: string }).id);
      sameVersion(o, b.version);
      const status = statusOf(o, nowMs());
      if (status !== 'payment_sent' && status !== 'awaiting_payment' && status !== 'expired') throw conflict('NOT_CONFIRMABLE', `${o.number} is ${status.replace('_', ' ')}: only an order waiting for its payment can be confirmed.`);
      // A late payment for an expired order: confirmed only while its pieces are all still available.
      if (status === 'expired' && !stillAvailable(o)) throw conflict('SOLD_SINCE', `${o.number} expired and some of its items have sold since. Reject it with a reason and refund the customer, or call them about other items.`);
      const pay = paymentOf(db, o);
      if (!pay) throw conflict('NO_ONLINE_PAYMENT', 'Set the online payment account first (Website shop › Online payment).');
      enoughPieces(o, status);
      setStatus(o, 'confirmed', at);
      const saleLines = lines(o.id).map((l) => ({
        kind: 'ready_made' as const, description: `${l.productName} (${l.colour}, ${l.size})`, qty: l.qty, unitPriceCents: l.unitPriceCents, discountCents: 0,
        item: { productId: l.productId, size: l.size, colour: l.colour },
      }));
      // The delivery fee the buyer paid: a service line (service income and its VAT), as the shop's other services.
      const delivery = o.delivery_fee_cents > 0
        ? [{ kind: 'service' as const, description: `Delivery (${o.delivery_option ?? 'delivery'})`, qty: 1, unitPriceCents: o.delivery_fee_cents, discountCents: 0 }] : [];
      const recorded = recordQuickSale(engineEnv(deps), { userId: user.userId, permissions: user.permissions },
        { customerId: b.customerId, invoiceNumber: b.invoiceNumber, lines: [...saleLines, ...delivery], note: `Online order ${o.number} · ${o.name} · ${o.phone}` },
        { crNumber: b.crNumber, tenders: [{ cashPlaceId: o.cash_place_id ?? pay.cashPlaceId, amountCents: o.total_cents, ...(o.payment_reference ? { reference: o.payment_reference.slice(0, 40) } : {}) }] },
        o.total_cents);
      db.prepare('UPDATE shp_orders SET sale_document_id = ? WHERE id = ?').run(recorded.sale.id, o.id);
      const saleNumber = db.prepare('SELECT number FROM documents WHERE id = ?').pluck().get(recorded.sale.id) as string;
      event(o.id, 'confirmed', at, user.userId, `Payment found · recorded on ${saleNumber}`);
      appendAudit(db, { at, userId: user.userId, action: 'shp.order.confirmed', entityType: 'shp.order', entityId: o.id, data: { number: o.number, sale: saleNumber, totalCents: o.total_cents } });
      tell(o, 'confirmed', at, { userId: user.userId });
      return { sale: recorded.sale, payment: recorded.payment };
    });
  });

  app.post('/api/shp/admin/orders/:id/reject', { config: { permission: 'shp.orders.manage' } }, async (req) => {
    const b = rejectInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const o = staffOrder((req.params as { id: string }).id);
      sameVersion(o, b.version);
      const status = statusOf(o, nowMs());
      if (status !== 'payment_sent' && status !== 'awaiting_payment' && status !== 'expired') throw conflict('NOT_REJECTABLE', `${o.number} is ${status.replace('_', ' ')}: only an order waiting for its payment can be rejected.`);
      setStatus(o, 'rejected', at);
      event(o.id, 'rejected', at, user.userId, b.reason);
      tell(o, 'rejected', at, { reason: b.reason, userId: user.userId });
      appendAudit(db, { at, userId: user.userId, action: 'shp.order.rejected', entityType: 'shp.order', entityId: o.id, data: { number: o.number, reason: b.reason } });
      return { ok: true };
    });
  });

  app.post('/api/shp/admin/orders/:id/move', { config: { permission: 'shp.orders.manage' } }, async (req) => {
    const b = moveInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const o = staffOrder((req.params as { id: string }).id);
      sameVersion(o, b.version);
      const from = statusOf(o, nowMs());
      const allowed = b.to === 'ready' ? from === 'confirmed' : from === 'confirmed' || from === 'ready';
      if (!allowed) throw conflict('BAD_MOVE', `${o.number} is ${from.replace('_', ' ')}: it cannot be marked ${b.to}.`);
      setStatus(o, b.to, at);
      event(o.id, b.to, at, user.userId, b.note ?? null);
      if (b.to === 'ready') tell(o, 'ready', at, { userId: user.userId });
      return { ok: true };
    });
  });

  /**
   * A confirmed order (the buyer paid and a quick sale was recorded) is cancelled or returned: QS cancels the linked sale and
   * its payment the usual way (its mirrored journal, the pieces back in stock), and the order is marked cancelled, or returned
   * when it had already gone out. Once per order. Any refund to the buyer is paid by staff outside the app.
   */
  app.post('/api/shp/admin/orders/:id/reverse', { config: { permission: 'shp.orders.manage' } }, async (req) => {
    const b = reverseInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const o = staffOrder((req.params as { id: string }).id);
      // Said first, so a second try gets this plain message and not a "changed meanwhile" one.
      if (o.reversal_kind) throw conflict('ALREADY_REVERSED', `${o.number} was already ${o.reversal_kind}. It can only be done once.`);
      sameVersion(o, b.version);
      const from = statusOf(o, nowMs());
      if (!['confirmed', 'ready', 'completed'].includes(from) || !o.sale_document_id) {
        throw conflict('NOT_REVERSIBLE', `${o.number} is ${from.replace('_', ' ')}: only an order the shop confirmed can be cancelled or returned here.`);
      }
      const kind = from === 'confirmed' ? 'cancelled' : 'returned';
      // The sale may already have been cancelled in Quick Sale: then there is nothing left to cancel there.
      const sale = saleRef(db, o.sale_document_id);
      if (sale?.status === 'posted') cancelQuickSale(engineEnv(deps), { userId: user.userId, permissions: user.permissions }, o.sale_document_id, `Online order ${o.number} ${kind}: ${b.reason}`);
      setStatus(o, 'cancelled', at, ', reversal_kind = ?, reversal_reason = ?, reversal_by = ?, reversal_at = ?', kind, b.reason, user.userId, at);
      event(o.id, kind, at, user.userId, b.reason);
      appendAudit(db, { at, userId: user.userId, action: `shp.order.${kind}`, entityType: 'shp.order', entityId: o.id, data: { number: o.number, sale: o.sale_number, reason: b.reason, totalCents: o.total_cents } });
      return { ok: true, status: kind === 'returned' ? 'returned' : 'cancelled' };
    });
  });

  // ---- How customers pay (the owner) ----

  app.get('/api/shp/admin/payment', { config: { permission: 'shp.orders.view' } }, async () => {
    const p = paymentSettings(db);
    return p ? { ...p, qrUrl: `/api/shp/payment/qr/${p.version}` } : null;
  });

  app.post('/api/shp/admin/payment', { bodyLimit: b64(MAX_PROOF_BYTES) + 16 * 1024, config: { permission: 'shp.payment.manage' } }, async (req) => {
    const b = settingsInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const place = placesFor(db, () => false).find((p) => p.id === b.cashPlaceId && p.isActive);
      if (!place) throw new AppError('CASH_PLACE', 'Pick the active cash account the online payments go into (the bank account of the QR).', 400);
      const current = db.prepare('SELECT version, qr_content_type AS type, qr_data AS data FROM shp_payment_settings ORDER BY version DESC LIMIT 1').get() as { version: number; type: string; data: Buffer } | undefined;
      const qr = b.qr ? picture(b.qr, 'QR code') : current ? { type: current.type, data: current.data } : null;
      if (!qr) throw new AppError('QR_REQUIRED', 'Upload the QR code customers will pay to.', 400);
      const version = (current?.version ?? 0) + 1;
      db.prepare(`INSERT INTO shp_payment_settings (version, bank_name, account_name, account_hint, instructions, cash_place_id, qr_content_type, qr_data, saved_by, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(version, b.bankName, b.accountName, b.accountHint || null, b.instructions || null, b.cashPlaceId, qr.type, qr.data, user.userId, at);
      const option = db.prepare('INSERT INTO shp_delivery_options (version, position, name, fee_cents, is_default) VALUES (?, ?, ?, ?, ?)');
      const addPlace = db.prepare('INSERT OR IGNORE INTO shp_delivery_places (version, position, place) VALUES (?, ?, ?)');
      b.deliveryOptions.forEach((d, i) => { option.run(version, i, d.name, d.feeCents, d.otherwise ? 1 : 0); for (const x of d.places) addPlace.run(version, i, x); });
      appendAudit(db, { at, userId: user.userId, action: 'shp.payment.settings', entityType: 'shp.payment', entityId: String(version),
        data: { bankName: b.bankName, accountName: b.accountName, cashPlace: place.name, newQr: Boolean(b.qr) } });
      return { ...paymentSettings(db)!, qrUrl: `/api/shp/payment/qr/${version}` };
    });
  });
}

/** For messages: "₱1,250.00". */
export const peso = formatPeso;
