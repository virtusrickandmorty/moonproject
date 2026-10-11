/**
 * Delivery receipt (DR-, TPL; the owner's request, 11 Oct 2026): pieces taken out of a client's stock when the client
 * calls. It posts no journal itself: the TPL action records its invoice in the same transaction, a quick sale on the
 * client's terms (IR-, QS-SALE journal: Dr 1201 AR / Cr 4101-4103 sales, Cr 2301 VAT), which a collection pays later.
 * Pieces: the delivery's lines are what left the stock; cancelled, they are back (on hand reads recorded deliveries).
 * Price: the program's price per piece on the day, kept on the line. Never below zero stock. Over the credit limit, or
 * with an overdue TPL invoice, it needs tpl.override and a reason.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { conflict, formatPeso, manilaDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { customerRef } from '../../CUS/public.ts';
import { item, itemLabel, itemsOf, openBalance, program } from '../programs.ts';

export const MAX_FEE_CENTS = 10_000_000;
const text = (max: number) => z.string().trim().min(1).max(max);
const addDays = (date: string, days: number) => manilaDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + days * 86_400_000));
const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

export const deliveryInput = z.object({
  programId: z.uuid(),
  // Typed from the booklet; the invoice (a quick sale) checks it against the ATP booklet register and earlier use.
  invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().int().min(1).max(100_000) }).strict()).min(1).max(29), // + the fee: 30 invoice lines
  feeCents: z.number().int().min(0).max(MAX_FEE_CENTS), // the delivery fee, a service line on the invoice (0 = none)
  deliveredBy: text(120), // our rider, or the courier
  receivedBy: text(120).optional(),
  tracking: text(60).optional(), // the courier's tracking number
  overrideReason: text(500).optional(), // over the credit limit or with an overdue invoice
  note: text(500).optional(),
}).strict();
export type DeliveryInput = z.infer<typeof deliveryInput>;

export interface DeliveryLine { lineNo: number; itemId: string; description: string; size: string; kind: 'made_to_order' | 'ready_made'; qty: number; unitPriceCents: number; amountCents: number }
export interface Delivery extends Omit<DeliveryInput, 'lines'> {
  lines: DeliveryLine[];
  customerId: string;
  customerName: string;
  termsDays: number;
  dueDate: string;
  goodsCents: number;
  totalCents: number;
}

export const deliveryDoc: DocTypeDef<DeliveryInput, Delivery> = {
  key: 'tpl.delivery',
  module: 'TPL',
  title: 'Delivery Receipt',
  numbering: { series: { key: 'DR', prefix: 'DR-' } },
  permissions: { view: 'tpl.view', create: 'tpl.deliver', post: 'tpl.deliver', cancel: 'qs.cancel' }, // cancelling one cancels its invoice
  dating: 'system',
  inputSchema: deliveryInput,

  compute(input, ctx) {
    const p = program(ctx.db, input.programId);
    const lines = input.lines.map((l, i): DeliveryLine => {
      const it = item(ctx.db, l.itemId);
      const unitPriceCents = it?.priceCents ?? 0;
      return { lineNo: i + 1, itemId: l.itemId, description: it?.description ?? '?', size: it?.size ?? '', kind: it?.kind ?? 'made_to_order', qty: l.qty, unitPriceCents, amountCents: l.qty * unitPriceCents };
    });
    const goodsCents = lines.reduce((s, l) => s + l.amountCents, 0);
    const termsDays = p?.termsDays ?? 30;
    return {
      ...input, lines, customerId: p?.customerId ?? '', customerName: p?.customerName ?? '?', termsDays,
      dueDate: addDays(ctx.businessDate, termsDays), goodsCents, totalCents: goodsCents + input.feeCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const p = program(ctx.db, doc.programId);
    if (!p?.isActive) return [{ field: 'programId', code: 'PROGRAM', level: 'error', message: 'Pick an active stock program.' }];
    const c = customerRef(ctx.db, p.customerId);
    if (c?.is_active !== 1) error('programId', 'CUSTOMER', `${p.customerName} is inactive as a customer.`);
    const seen = new Set<string>();
    doc.lines.forEach((l, i) => {
      const it = item(ctx.db, l.itemId);
      if (!it || it.programId !== p.id || !it.isActive) return error(`lines.${i}.itemId`, 'ITEM', `Line ${l.lineNo}: pick one of ${p.customerName}'s active items.`);
      if (seen.has(l.itemId)) error(`lines.${i}.itemId`, 'ITEM_TWICE', `${itemLabel(it)} is listed twice. Put all its pieces on one line.`);
      seen.add(l.itemId);
      if (l.qty > it.onHand) error(`lines.${i}.qty`, 'NOT_ENOUGH', it.onHand > 0 ? `${itemLabel(it)}: only ${pieces(it.onHand)} on hand.` : `${itemLabel(it)}: none on hand. Restock it first.`);
    });
    if (doc.totalCents <= 0) error('lines', 'NOTHING_TO_INVOICE', 'The delivery comes to ₱0.00, so there is nothing to invoice. Check the prices on the program.');

    // Credit: over the limit, or an invoice of this client past due, needs the owner's say-so and a reason.
    const money = openBalance(ctx.db, p.customerId, ctx.businessDate);
    const reasons: string[] = [];
    if (p.creditLimitCents > 0 && money.openCents + doc.totalCents > p.creditLimitCents) {
      reasons.push(`${p.customerName} would owe ${formatPeso(money.openCents + doc.totalCents)}, over the credit limit of ${formatPeso(p.creditLimitCents)}`);
    }
    if (money.overdue.length > 0) reasons.push(`${money.overdue.map((o) => `${o.number} (${formatPeso(o.openCents)}, due ${o.dueDate})`).join(', ')} ${money.overdue.length === 1 ? 'is' : 'are'} past due`);
    if (reasons.length > 0) {
      const why = `${reasons.join('; ')}.`;
      if (!doc.overrideReason) error('overrideReason', 'CREDIT_HOLD', `${why} To deliver anyway, someone allowed to (tpl.override) gives the reason.`);
      else if (!ctx.can('tpl.override')) error('overrideReason', 'CREDIT_HOLD', `${why} Only someone allowed to override (tpl.override) can deliver now.`);
      else if (doc.overrideReason.length < 10) error('overrideReason', 'REASON', 'Give a reason of at least 10 characters.');
      else issues.push({ field: 'overrideReason', code: 'CREDIT_OVERRIDE', level: 'warning', message: `${why} Delivering anyway: ${doc.overrideReason}` });
    }
    return issues;
  },

  persist(db, doc, h) {
    // Only with its invoice (recordDelivery): the generic document routes would leave it without one.
    if (!recordingWithInvoice.on) throw conflict('USE_TPL_DELIVERY', "Record a delivery from TPL services (the client's program), so its invoice is recorded with it.");
    db.prepare(
      `INSERT INTO tpl_deliveries (document_id, program_id, customer_id, customer_name, invoice_number, terms_days, due_date, goods_cents, fee_cents,
         delivered_by, received_by, tracking, override_reason, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.programId, doc.customerId, doc.customerName, doc.invoiceNumber, doc.termsDays, doc.dueDate, doc.goodsCents, doc.feeCents,
      doc.deliveredBy, doc.receivedBy ?? null, doc.tracking ?? null, doc.overrideReason ?? null, doc.note ?? null);
    const line = db.prepare(`INSERT INTO tpl_delivery_lines (document_id, line_no, item_id, description, size, kind, qty, unit_price_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of doc.lines) line.run(h.documentId, l.lineNo, l.itemId, l.description, l.size, l.kind, l.qty, l.unitPriceCents, l.amountCents);
  },

  load(db, documentId) {
    const r = db.prepare(`SELECT program_id AS programId, customer_id AS customerId, customer_name AS customerName, invoice_number AS invoiceNumber, terms_days AS termsDays,
        due_date AS dueDate, goods_cents AS goodsCents, fee_cents AS feeCents, delivered_by AS deliveredBy, received_by AS receivedBy, tracking,
        override_reason AS overrideReason, note FROM tpl_deliveries WHERE document_id = ?`).get(documentId) as Record<string, unknown> | undefined;
    if (!r) throw new Error(`Delivery ${documentId} not found`);
    const lines = db.prepare(`SELECT line_no AS lineNo, item_id AS itemId, description, size, kind, qty, unit_price_cents AS unitPriceCents, amount_cents AS amountCents
        FROM tpl_delivery_lines WHERE document_id = ? ORDER BY line_no`).all(documentId) as DeliveryLine[];
    const kept = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) as Omit<Delivery, 'lines' | 'totalCents'>;
    return { ...kept, lines, totalCents: kept.goodsCents + kept.feeCents };
  },

  toInput: ({ programId, invoiceNumber, lines, feeCents, deliveredBy, receivedBy, tracking, overrideReason, note }) => ({
    programId, invoiceNumber, lines: lines.map(({ itemId, qty }) => ({ itemId, qty })), feeCents, deliveredBy,
    ...(receivedBy ? { receivedBy } : {}), ...(tracking ? { tracking } : {}), ...(overrideReason ? { overrideReason } : {}), ...(note ? { note } : {}),
  }),

  /** Its invoice, while it stands: the TPL cancel takes both together (cancelDelivery). */
  dependents: (db, documentId) => invoiceStanding(db, documentId),

  summary(doc) {
    const n = doc.lines.reduce((s, l) => s + l.qty, 0);
    const fee = doc.feeCents > 0 ? ` and a delivery fee of ${formatPeso(doc.feeCents)}` : '';
    return `This will deliver ${pieces(n)} to ${doc.customerName} from their stock and record invoice no. ${doc.invoiceNumber}: ${formatPeso(doc.goodsCents)} for the pieces${fee}, `
      + `${formatPeso(doc.totalCents)} in all, due ${doc.dueDate} (${doc.termsDays} days).`;
  },

  arbitrary(db) {
    const programs = db.prepare('SELECT id FROM tpl_programs WHERE is_active = 1').pluck().all() as string[];
    const withStock = programs.map((id) => ({ id, items: itemsOf(db, id).filter((i) => i.isActive && i.onHand > 0) })).filter((p) => p.items.length > 0);
    if (withStock.length === 0) throw new Error('tpl.delivery.arbitrary needs a stock program with pieces on hand');
    return fc.constantFrom(...withStock).chain((p) => fc.record({
      programId: fc.constant(p.id),
      invoiceNumber: fc.integer({ min: 1, max: 99_999_999 }).map((n) => String(n)),
      lines: fc.subarray(p.items, { minLength: 1 }).chain((items) => fc.tuple(...items.map((i) => fc.integer({ min: 1, max: i.onHand }).map((qty) => ({ itemId: i.id, qty }))))),
      feeCents: fc.constantFrom(0, 15_000),
      deliveredBy: fc.constantFrom('Rider Jun', 'LBC'),
    }));
  },
};

/**
 * Deliveries whose cancel is under way through cancelDelivery: their invoice and they go together, so neither waits for
 * the other. Anywhere else, a delivery waits for its invoice and its invoice for it (a lone cancel would split them).
 */
export const cancellingTogether = new Set<string>();
/** On while recordDelivery writes a delivery and then its invoice. */
export const recordingWithInvoice = { on: false };

/** The invoice a delivery carries. */
export const invoiceOf = (db: import('../../../platform/db/driver.ts').Db, documentId: string) =>
  db.prepare('SELECT sale_id FROM tpl_delivery_invoices WHERE document_id = ?').pluck().get(documentId) as string | undefined;

function invoiceStanding(db: import('../../../platform/db/driver.ts').Db, documentId: string) {
  if (cancellingTogether.has(documentId)) return [];
  const saleId = invoiceOf(db, documentId);
  if (!saleId) return [];
  return db.prepare(`SELECT id, number FROM documents WHERE id = ? AND status = 'posted'`).all(saleId) as { id: string; number: string }[];
}
