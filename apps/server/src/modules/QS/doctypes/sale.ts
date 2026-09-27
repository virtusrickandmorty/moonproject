/**
 * Quick sale (PLAN E6, D5 QS-SALE): a walk-in sale of any item or service, recorded as an invoice record from the manual
 * BIR invoice (a VAT seller invoices every sale). The QS action pays it with a COL collection in the same transaction.
 *   Dr 1201 AR (G, the sale named as ref); Dr 4190 the discount shown (its NET) / Cr 4101/4102/4103 (NET at list, by
 *   line class); Cr 2301 VAT(G)                                                                             (INV-REC)
 *   then the collection: Dr cash place (per tender) / Cr 1201 AR (the sale)                                 (COL-RCV)
 * The invoice math is the JO invoice record's (VAT on the whole document at the rate in force on the invoice date), and
 * both share the IR- series and the booklet: an invoice number is used once, ever, across releases and quick sales.
 * Cancel: blocked while a payment stands; the QS action cancels the sale's own payment with it (E6).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { customerRef } from '../../CUS/public.ts';
import { salePayments } from '../../COL/public.ts';
import { INVOICE_SERIES, SALES_CLASSES, SALES_ROLE, invoiceAmounts, invoiceNumberUsedBy, jobOrdersOf, type LineKind } from '../../JO/public.ts';

export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const text = (max: number) => z.string().trim().min(1).max(max);

const lineInput = z
  .object({
    kind: z.enum(['service', 'ready_made', 'made_to_order']), // repair/alteration = service
    description: text(200),
    qty: z.number().int().min(1).max(10_000),
    unitPriceCents: z.number().int().min(0).max(MAX_CENTS), // VAT-inclusive
    discountCents: z.number().int().min(0).max(MAX_CENTS), // shown on the invoice
  })
  .strict();

export const saleInput = z
  .object({
    customerId: z.uuid(), // "Walk-in" is a customer record too
    // Typed from the booklet, never prefilled. The ATP booklet register check comes with TAX (D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    lines: z.array(lineInput).min(1).max(30),
    note: text(500).optional(),
  })
  .strict();
export type SaleInput = z.infer<typeof saleInput>;

export interface SaleLine extends z.infer<typeof lineInput> { lineNo: number; listCents: number; amountCents: number }
export interface Sale extends Omit<SaleInput, 'lines'>, ReturnType<typeof invoiceAmounts> {
  lines: SaleLine[];
  customerName: string;
  totalCents: number;
}

export const saleDoc: DocTypeDef<SaleInput, Sale> = {
  key: 'qs.sale',
  module: 'QS',
  title: 'Invoice Record',
  numbering: { series: INVOICE_SERIES },
  permissions: { view: 'qs.view', create: 'qs.create', post: 'qs.post', cancel: 'qs.cancel' },
  dating: 'system',
  inputSchema: saleInput,

  compute(input, ctx) {
    const lines = input.lines.map((l, i) => ({ ...l, lineNo: i + 1, listCents: l.qty * l.unitPriceCents, amountCents: l.qty * l.unitPriceCents - l.discountCents }));
    const listCents = lines.reduce((s, l) => s + l.listCents, 0);
    const figures = invoiceAmounts(listCents <= MAX_CENTS ? lines : [], settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate)); // over the guard: refused in validate
    return { ...input, ...figures, listCents, lines, customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?', totalCents: figures.grossCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const c = customerRef(ctx.db, doc.customerId);
    if (c?.is_active !== 1) error('customerId', 'CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick a customer.');
    const used = invoiceNumberUsedBy(ctx.db, doc.invoiceNumber);
    if (used) {
      const how = used.status === 'cancelled' ? ' (cancelled)' : '';
      error('invoiceNumber', 'INVOICE_USED', `Invoice no. ${doc.invoiceNumber} is already used on ${used.number}${how}. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.`);
    }
    for (const l of doc.lines) if (l.amountCents < 0) error(`lines.${l.lineNo - 1}.discountCents`, 'DISCOUNT', `Line ${l.lineNo}: the discount is more than the line amount.`);
    if (doc.listCents > MAX_CENTS) error('lines', 'TOO_BIG', 'The total is over ₱100 million. Please check the quantities and prices.');
    else if (doc.grossCents <= 0) error('lines', 'NOTHING_TO_INVOICE', 'The sale comes to ₱0.00, so there is nothing to invoice.');
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO qs_sales (document_id, customer_id, customer_name, invoice_number, vat_rate_bp, list_cents, discount_cents, gross_cents, vat_cents,
         discount_net_cents, sales_mto_cents, sales_rtw_cents, sales_service_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.customerId, doc.customerName, doc.invoiceNumber, doc.vatRateBp, doc.listCents, doc.discountCents, doc.grossCents, doc.vatCents,
      doc.discountNetCents, doc.salesCents.made_to_order, doc.salesCents.ready_made, doc.salesCents.service, doc.note ?? null,
    );
    const line = db.prepare(
      'INSERT INTO qs_sale_lines (document_id, line_no, kind, description, qty, unit_price_cents, discount_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const l of doc.lines) line.run(h.documentId, l.lineNo, l.kind, l.description, l.qty, l.unitPriceCents, l.discountCents, l.amountCents);
  },

  journal(doc, _ctx, header) {
    const party = { type: 'customer', id: doc.customerId };
    // The receivable names the sale, so collections pay it by ref. A preview has no header yet and shows the line unnamed.
    const self = header?.documentId;
    return {
      memo: `Quick sale to ${doc.customerName}, invoice no. ${doc.invoiceNumber}`,
      lines: [
        { account: { role: 'AR_TRADE' }, party, ...(self ? { ref: { documentId: self } } : {}), debitCents: doc.grossCents, memo: `Invoice no. ${doc.invoiceNumber}` },
        { account: { role: 'SALES_DISCOUNTS' }, party, debitCents: doc.discountNetCents, memo: 'Discount shown on the invoice' },
        ...SALES_CLASSES.map((k) => ({ account: { role: SALES_ROLE[k] }, party, creditCents: doc.salesCents[k] })),
        { account: { role: 'OUTPUT_VAT' }, party, creditCents: doc.vatCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT customer_id AS customerId, customer_name AS customerName, invoice_number AS invoiceNumber, note, vat_rate_bp AS vatRateBp, list_cents AS listCents,
           discount_cents AS discountCents, gross_cents AS grossCents, vat_cents AS vatCents, discount_net_cents AS discountNetCents,
           sales_mto_cents AS mto, sales_rtw_cents AS rtw, sales_service_cents AS service
         FROM qs_sales WHERE document_id = ?`,
      )
      .get(documentId) as (Omit<Sale, 'note' | 'lines' | 'salesCents' | 'vatableSalesCents' | 'totalCents'> & { note: string | null; mto: number; rtw: number; service: number }) | undefined;
    if (!r) throw new Error(`Quick sale ${documentId} not found`);
    const { note, mto, rtw, service, ...rest } = r;
    const lines = db
      .prepare(
        `SELECT kind, description, qty, unit_price_cents AS unitPriceCents, discount_cents AS discountCents, line_no AS lineNo, qty * unit_price_cents AS listCents,
           amount_cents AS amountCents FROM qs_sale_lines WHERE document_id = ? ORDER BY line_no`,
      )
      .all(documentId) as (SaleLine & { kind: LineKind })[];
    return {
      ...rest,
      ...(note ? { note } : {}),
      lines,
      vatableSalesCents: r.grossCents - r.vatCents,
      salesCents: { made_to_order: mto, ready_made: rtw, service },
      totalCents: r.grossCents,
    };
  },

  toInput: ({ customerId, invoiceNumber, lines, note }) => ({
    customerId,
    invoiceNumber,
    lines: lines.map(({ kind, description, qty, unitPriceCents, discountCents }) => ({ kind, description, qty, unitPriceCents, discountCents })),
    ...(note ? { note } : {}),
  }),

  /** Its payments: cancel them first (the QS action cancels the sale's own payment with it). */
  dependents: (db, documentId) => salePayments(db, documentId).filter((p) => p.status === 'posted').map(({ id, number }) => ({ id, number })),

  summary(doc) {
    const what = doc.lines.length === 1 ? doc.lines[0]!.description : `${doc.lines.length} lines`;
    const discount = doc.discountCents > 0 ? `, discount ${formatPeso(doc.discountCents)} shown` : '';
    return `This will record invoice no. ${doc.invoiceNumber} to ${doc.customerName} for ${what}: ${formatPeso(doc.grossCents)} (VATable sales ${formatPeso(doc.vatableSalesCents)}, VAT ${formatPeso(doc.vatCents)}${discount}).`;
  },

  arbitrary(db) {
    // Customers the shop knows from job orders and earlier quick sales (CUS has no list in its public.ts yet).
    const known = [...new Set([...jobOrdersOf(db).map((jo) => jo.customerId), ...(db.prepare('SELECT DISTINCT customer_id FROM qs_sales').pluck().all() as string[])])];
    const customers = known.filter((id) => customerRef(db, id)?.is_active === 1);
    if (customers.length === 0) throw new Error('qs.sale.arbitrary needs an active customer with a job order or an earlier quick sale');
    const line = fc
      .record({
        kind: fc.constantFrom<LineKind>('service', 'ready_made', 'made_to_order'),
        description: fc.constantFrom('Hemming of pants', 'Plain white shirt', 'Name patch'),
        qty: fc.integer({ min: 1, max: 5 }),
        unitPriceCents: fc.integer({ min: 0, max: 300_000 }),
        discountPct: fc.integer({ min: 0, max: 30 }),
      })
      .map(({ discountPct, ...l }) => ({ ...l, discountCents: Math.floor((l.qty * l.unitPriceCents * discountPct) / 100) }));
    return fc
      .record({ customerId: fc.constantFrom(...customers), n: fc.integer({ min: 1, max: 99_999_999 }), lines: fc.array(line, { minLength: 1, maxLength: 3 }), note: fc.constantFrom(undefined, 'Paid at the counter') })
      .filter((r) => r.lines.some((l) => l.qty * l.unitPriceCents > l.discountCents))
      .map(({ n, note, ...r }) => ({ ...r, invoiceNumber: String(n).padStart(4, '0'), ...(note ? { note } : {}) }));
  },
};
