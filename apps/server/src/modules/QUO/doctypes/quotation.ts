/** A quotation records an offer, not revenue or a receivable. The document engine owns its lifecycle. */
import { z } from 'zod';
import fc from 'fast-check';
import { AppError, formatPeso, manilaDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { customerRef } from '../../CUS/public.ts';
import { catalogItemRef, logCatalogPriceOverride, lookupCatalogPrice, requireCatalogDiscountReason } from '../../CAT/public.ts';

const MAX_UNIT_CENTS = 100_000_00;
const MAX_TOTAL_CENTS = 100_000_000_00;
const text = (max: number) => z.string().trim().min(1).max(max);

const lineInput = z.object({
  itemId: z.uuid(),
  description: text(200),
  qty: z.number().int().min(1).max(10_000),
  unit: z.enum(['pc', 'set']),
  overrideUnitPriceCents: z.number().int().min(0).max(MAX_UNIT_CENTS).optional(),
  overrideReason: text(500).optional(),
  discountCents: z.number().int().min(0).max(MAX_TOTAL_CENTS).default(0),
  discountReason: text(500).optional(),
}).strict();

export const quotationInput = z.object({
  customerId: z.uuid().optional(),
  prospectName: text(200).optional(),
  contact: text(200).optional(),
  validForDays: z.number().int().min(1).max(365).default(15),
  termsText: text(2000).optional(),
  notes: text(2000).optional(),
  lines: z.array(lineInput).min(1).max(50),
  documentDiscountCents: z.number().int().min(0).max(MAX_TOTAL_CENTS).default(0),
  discountReason: text(500).optional(),
}).strict().refine((v) => Boolean(v.customerId) !== Boolean(v.prospectName), {
  path: ['customerId'], message: 'Pick a customer or enter a prospect name, but not both.',
});
export type QuotationInput = z.infer<typeof quotationInput>;
type InputLine = QuotationInput['lines'][number];

export interface QuotationLine extends InputLine {
  lineNo: number;
  priceId: string | null;
  listUnitPriceCents: number;
  unitPriceCents: number;
  lineTotalCents: number;
}
export interface Quotation extends Omit<QuotationInput, 'lines'> {
  customerName: string;
  validUntil: string;
  lines: QuotationLine[];
  totalCents: number;
}

const addDays = (date: string, days: number) =>
  manilaDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + days * 86_400_000));
const issue = (field: string, code: string, message: string): Issue => ({ field, code, message, level: 'error' });

export const quotationDoc: DocTypeDef<QuotationInput, Quotation> = {
  key: 'quo.quotation',
  module: 'QUO',
  title: 'Quotation',
  numbering: { series: { key: 'QUO', prefix: 'QUO-' } },
  permissions: { view: 'quo.view', create: 'quo.create', post: 'quo.post', cancel: 'quo.cancel' },
  dating: 'system',
  inputSchema: quotationInput,

  compute(input, ctx) {
    const lines = input.lines.map((line, i): QuotationLine => {
      let price;
      try { price = lookupCatalogPrice(ctx.db, line.itemId, line.qty, ctx.businessDate); }
      catch (e) {
        if (!(e instanceof AppError && e.code === 'NOT_FOUND')) throw e;
        price = null;
      }
      const listUnitPriceCents = price?.unitPriceCents ?? 0;
      const unitPriceCents = line.overrideUnitPriceCents ?? listUnitPriceCents;
      const gross = unitPriceCents <= MAX_UNIT_CENTS ? line.qty * unitPriceCents : 0;
      return { ...line, lineNo: i + 1, priceId: price?.priceId ?? null,
        listUnitPriceCents, unitPriceCents, lineTotalCents: gross - line.discountCents };
    });
    return {
      ...input,
      customerName: input.customerId ? customerRef(ctx.db, input.customerId)?.display_name ?? '?' : input.prospectName!,
      validUntil: addDays(ctx.businessDate, input.validForDays),
      lines,
      totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0) - input.documentDiscountCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (doc.customerId) {
      const customer = customerRef(ctx.db, doc.customerId);
      if (!customer || !customer.is_active || customer.merged_into_id) {
        issues.push(issue('customerId', 'CUSTOMER', 'Pick an active customer.'));
      }
    }
    let subtotal = 0;
    for (const line of doc.lines) {
      const field = `lines.${line.lineNo - 1}`;
      const item = catalogItemRef(ctx.db, line.itemId);
      if (item?.isActive && line.unit !== item.unit) issues.push(issue(`${field}.unit`, 'UNIT_MISMATCH', `Use ${item.unit} for ${item.name}.`));
      if (!line.priceId) issues.push(issue(`${field}.itemId`, 'PRICE_MISSING', 'This catalog item has no current price for the quantity.'));
      if (line.listUnitPriceCents > MAX_UNIT_CENTS) issues.push(issue(`${field}.itemId`, 'PRICE_TOO_HIGH', 'Check this catalog price before quoting.'));
      const gross = line.qty * line.unitPriceCents;
      if (line.discountCents > gross) issues.push(issue(`${field}.discountCents`, 'DISCOUNT', 'The discount is more than this line amount.'));
      if (line.overrideUnitPriceCents !== undefined && line.overrideUnitPriceCents === line.listUnitPriceCents) {
        issues.push(issue(`${field}.overrideUnitPriceCents`, 'NO_PRICE_OVERRIDE', 'Remove the override price when it matches the catalog price.'));
      }
      if (line.overrideUnitPriceCents !== undefined && line.overrideUnitPriceCents !== line.listUnitPriceCents) {
        if (!ctx.can('cat.price.override')) issues.push(issue(`${field}.overrideUnitPriceCents`, 'PRICE_OVERRIDE_PERMISSION', 'Ask someone with price override permission.'));
        if (!line.overrideReason || line.overrideReason.length < 3) issues.push(issue(`${field}.overrideReason`, 'OVERRIDE_REASON', 'Enter a reason for the price override.'));
      } else if (line.overrideReason) {
        issues.push(issue(`${field}.overrideReason`, 'NO_PRICE_OVERRIDE', 'Remove the override reason or change the price.'));
      }
      if (line.discountCents <= gross) {
        try { requireCatalogDiscountReason(ctx.db, gross, line.discountCents, line.discountReason, ctx.businessDate); }
        catch (e) {
          if (e instanceof AppError) issues.push(issue(`${field}.discountReason`, e.code, e.message));
          else throw e;
        }
      }
      subtotal += line.lineTotalCents;
    }
    if (doc.documentDiscountCents > subtotal) issues.push(issue('documentDiscountCents', 'DISCOUNT', 'The document discount is more than the line total.'));
    else {
      try { requireCatalogDiscountReason(ctx.db, subtotal, doc.documentDiscountCents, doc.discountReason, ctx.businessDate); }
      catch (e) {
        if (e instanceof AppError) issues.push(issue('discountReason', e.code, e.message));
        else throw e;
      }
    }
    if (doc.totalCents > MAX_TOTAL_CENTS || !Number.isSafeInteger(doc.totalCents)) {
      issues.push(issue('lines', 'TOTAL_TOO_HIGH', 'The quotation is over the allowed total. Check its quantities and prices.'));
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(`INSERT INTO quo_quotations (document_id, customer_id, customer_name, prospect_name, contact,
      valid_for_days, valid_until, terms_text, notes, document_discount_cents, discount_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      h.documentId, doc.customerId ?? null, doc.customerName, doc.prospectName ?? null, doc.contact ?? null,
      doc.validForDays, doc.validUntil, doc.termsText ?? null, doc.notes ?? null,
      doc.documentDiscountCents, doc.discountReason ?? null,
    );
    const insertLine = db.prepare(`INSERT INTO quo_lines (document_id, line_no, item_id, price_id, description,
      qty, unit, list_unit_price_cents, unit_price_cents, override_reason, discount_cents, discount_reason, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const header = db.prepare('SELECT posted_at, posted_by FROM documents WHERE id = ?').get(h.documentId) as
      { posted_at: string; posted_by: string };
    for (const line of doc.lines) {
      insertLine.run(h.documentId, line.lineNo, line.itemId, line.priceId, line.description,
        line.qty, line.unit, line.listUnitPriceCents, line.unitPriceCents, line.overrideReason ?? null,
        line.discountCents, line.discountReason ?? null, line.lineTotalCents);
      if (line.unitPriceCents !== line.listUnitPriceCents) {
        logCatalogPriceOverride(db, { at: header.posted_at, userId: header.posted_by,
          sourceType: 'quo_line', sourceId: `${h.documentId}:${line.lineNo}`, itemId: line.itemId,
          qty: line.qty, listUnitPriceCents: line.listUnitPriceCents,
          overrideUnitPriceCents: line.unitPriceCents, reason: line.overrideReason! });
      }
    }
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM quo_quotations WHERE document_id = ?').get(documentId) as
      | { customer_id: string | null; customer_name: string; prospect_name: string | null; contact: string | null;
          valid_for_days: number; valid_until: string; terms_text: string | null; notes: string | null;
          document_discount_cents: number; discount_reason: string | null }
      | undefined;
    if (!r) throw new Error(`Quotation ${documentId} not found`);
    const rows = db.prepare('SELECT * FROM quo_lines WHERE document_id = ? ORDER BY line_no').all(documentId) as
      { line_no: number; item_id: string; price_id: string; description: string; qty: number; unit: 'pc' | 'set';
        list_unit_price_cents: number; unit_price_cents: number; override_reason: string | null;
        discount_cents: number; discount_reason: string | null; line_total_cents: number }[];
    const lines: QuotationLine[] = rows.map((line) => ({ lineNo: line.line_no, itemId: line.item_id,
      priceId: line.price_id, description: line.description, qty: line.qty, unit: line.unit,
      listUnitPriceCents: line.list_unit_price_cents, unitPriceCents: line.unit_price_cents,
      ...(line.unit_price_cents !== line.list_unit_price_cents ? { overrideUnitPriceCents: line.unit_price_cents } : {}),
      ...(line.override_reason ? { overrideReason: line.override_reason } : {}),
      discountCents: line.discount_cents, ...(line.discount_reason ? { discountReason: line.discount_reason } : {}),
      lineTotalCents: line.line_total_cents }));
    return { ...(r.customer_id ? { customerId: r.customer_id } : { prospectName: r.prospect_name! }),
      ...(r.contact ? { contact: r.contact } : {}), validForDays: r.valid_for_days,
      ...(r.terms_text ? { termsText: r.terms_text } : {}), ...(r.notes ? { notes: r.notes } : {}),
      documentDiscountCents: r.document_discount_cents,
      ...(r.discount_reason ? { discountReason: r.discount_reason } : {}),
      customerName: r.customer_name, validUntil: r.valid_until, lines,
      totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0) - r.document_discount_cents };
  },

  toInput(doc) {
    return { ...(doc.customerId ? { customerId: doc.customerId } : { prospectName: doc.prospectName }),
      ...(doc.contact ? { contact: doc.contact } : {}), validForDays: doc.validForDays,
      ...(doc.termsText ? { termsText: doc.termsText } : {}), ...(doc.notes ? { notes: doc.notes } : {}),
      documentDiscountCents: doc.documentDiscountCents,
      ...(doc.discountReason ? { discountReason: doc.discountReason } : {}),
      lines: doc.lines.map((line) => ({ itemId: line.itemId, description: line.description, qty: line.qty,
        unit: line.unit, discountCents: line.discountCents,
        ...(line.discountReason ? { discountReason: line.discountReason } : {}),
        ...(line.overrideUnitPriceCents !== undefined ? { overrideUnitPriceCents: line.overrideUnitPriceCents,
          overrideReason: line.overrideReason } : {}) })) };
  },

  summary(doc) {
    return `This will record a quotation for ${doc.customerName} totalling ${formatPeso(doc.totalCents)}, valid until ${doc.validUntil}.`;
  },

  arbitrary() {
    return fc.record({
      prospectName: fc.constant('Made-up Prospect'),
      validForDays: fc.integer({ min: 1, max: 60 }),
      documentDiscountCents: fc.constant(0),
      lines: fc.array(fc.record({ itemId: fc.uuid(), description: fc.constant('Sample garment'),
        qty: fc.integer({ min: 1, max: 50 }), unit: fc.constant<'pc'>('pc'),
        discountCents: fc.constant(0) }), { minLength: 1, maxLength: 5 }),
    });
  },
};

