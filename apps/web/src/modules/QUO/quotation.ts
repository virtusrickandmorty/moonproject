/**
 * Quotations (PLAN E3): the form's values and the input they make, the expiry words, and the job order a quotation turns
 * into. Pure, so a test can send the same input to the real server. Prices, totals and the valid-until date are the
 * server's; nothing here works out money except splitting a whole-document discount across job order lines.
 */
import { allocate, formatPesos, parsePesos } from '@moonproject/shared';
import type { DocDetail } from '../../api.ts';
import { docPath } from '../../shell/menu.ts';
import type { ItemClass } from '../CAT/catalog.ts';

export type Line = { itemId: string; description: string; qty: number; unit: 'pc' | 'set'; discountCents: number;
  discountReason?: string; overrideUnitPriceCents?: number; overrideReason?: string };
export type Form = { customerId: string; prospectName: string; contact: string; validForDays: number; termsText: string; notes: string;
  lines: Line[]; documentDiscountCents: number; discountReason: string };

export const blankLine = (): Line => ({ itemId: '', description: '', qty: 1, unit: 'pc', discountCents: 0 });
export const blank = (): Form => ({ customerId: '', prospectName: '', contact: '', validForDays: 15, termsText: '', notes: '',
  lines: [blankLine()], documentDiscountCents: 0, discountReason: '' });

/** Typed pesos to centavos; null for anything else, so a typing slip never reaches the server as a number. */
export const cents = (value: string): number | null => {
  try { const parsed = parsePesos(value); return parsed >= 0 ? parsed : null; }
  catch { return null; }
};
export const amount = (value: number | undefined) => value === undefined ? '' : formatPesos(value);

const optional = (value: string) => value.trim() || undefined;

/** The strict input of quo.quotation. An override reason goes only with an override price, or the server calls it an error. */
export const toInput = (v: Form) => ({
  ...(v.customerId ? { customerId: v.customerId } : { prospectName: v.prospectName.trim() }),
  ...(optional(v.contact) ? { contact: optional(v.contact) } : {}), validForDays: v.validForDays,
  ...(optional(v.termsText) ? { termsText: optional(v.termsText) } : {}),
  ...(optional(v.notes) ? { notes: optional(v.notes) } : {}),
  lines: v.lines.map((l) => ({ itemId: l.itemId, description: l.description.trim(), qty: l.qty, unit: l.unit,
    discountCents: l.discountCents,
    ...(l.discountReason?.trim() ? { discountReason: l.discountReason.trim() } : {}),
    ...(l.overrideUnitPriceCents !== undefined ? { overrideUnitPriceCents: l.overrideUnitPriceCents } : {}),
    ...(l.overrideUnitPriceCents !== undefined && l.overrideReason?.trim() ? { overrideReason: l.overrideReason.trim() } : {}) })),
  documentDiscountCents: v.documentDiscountCents,
  ...(optional(v.discountReason) ? { discountReason: optional(v.discountReason) } : {}),
});

/** A customer or a prospect (not both), at least one complete line, and a validity. An inquiry is a draft, so the draft needs none of this. */
export const isReady = (v: Form) => v.lines.length > 0 && v.lines.every((l) => l.itemId && l.description.trim() && l.qty >= 1) &&
  Boolean(v.customerId) !== Boolean(v.prospectName.trim()) && v.validForDays >= 1;

/** A saved quotation's input (GET /api/docs/quo.quotation/:id) back into form values, to edit it. */
export function valuesOfInput(x: Record<string, unknown>): Form {
  return { customerId: String(x.customerId ?? ''), prospectName: String(x.prospectName ?? ''), contact: String(x.contact ?? ''),
    validForDays: Number(x.validForDays ?? 15), termsText: String(x.termsText ?? ''), notes: String(x.notes ?? ''),
    lines: ((x.lines ?? []) as Line[]).map((l) => ({ ...l })), documentDiscountCents: Number(x.documentDiscountCents ?? 0),
    discountReason: String(x.discountReason ?? '') };
}

/** The stored quotation as GET /api/docs/quo.quotation/:id returns it under `doc`. */
export interface QuotationDoc {
  customerId?: string; customerName: string; prospectName?: string; contact?: string; validUntil: string; termsText?: string; notes?: string;
  documentDiscountCents: number; discountReason?: string; totalCents: number;
  lines: { lineNo: number; itemId: string; description: string; qty: number; unit: 'pc' | 'set'; listUnitPriceCents: number; unitPriceCents: number;
    overrideReason?: string; discountCents: number; discountReason?: string; lineTotalCents: number }[];
}

/** "Valid until" against the server's date. An expired quotation can still become a job order, with a warning (PLAN E3 tests). */
export const isExpired = (validUntil: string, serverDate: string) => serverDate > validUntil;

export const JOB_ORDER_LATER = (number: string) =>
  `${number} is ready to become a job order, but the job order form comes with the job order screens. Nothing was changed on the quotation.`;

/** Where "Make a job order" goes: the Job Order form with the quotation to fill it from, or the job order list until that form exists. */
export const jobOrderTarget = (hasJobOrderForm: boolean, quotationId: string, quotationNumber: string) => hasJobOrderForm
  ? docPath('jo.job_order', `/new?fromQuotation=${encodeURIComponent(quotationId)}`)
  : `${docPath('jo.job_order')}?from-quotation=${encodeURIComponent(quotationNumber)}`;

const KINDS: Record<ItemClass, 'made_to_order' | 'service' | 'ready_made'> = { made_to_order_garment: 'made_to_order', service: 'service', ready_made_item: 'ready_made' };

/**
 * The Job Order form's starting values from a quotation: the customer, the lines as quoted (kind from the catalog class of
 * each item), and the quotation number in the notes. A whole-document discount is spread over the lines in proportion to
 * their totals, so the job order comes to the same total. Due date, priority and payment terms are left for staff to choose.
 * Null when the quotation is for a prospect: a job order needs a customer, so the prospect is added first.
 */
export function jobOrderPrefill(detail: Pick<DocDetail, 'header'> & { doc?: unknown }, classes: Record<string, ItemClass | undefined>) {
  const doc = detail.doc as QuotationDoc | undefined;
  if (!doc?.customerId) return null;
  const totals = doc.lines.map((l) => l.qty * l.unitPriceCents - l.discountCents);
  const share = doc.documentDiscountCents > 0 && totals.some((t) => t > 0) ? allocate(doc.documentDiscountCents, totals) : totals.map(() => 0);
  const notes = [`From quotation ${detail.header.number}`, doc.notes].filter(Boolean).join('. ');
  return {
    customerId: doc.customerId,
    ...(doc.contact ? { contact: doc.contact } : {}),
    notes: notes.slice(0, 1000),
    lines: doc.lines.map((l, i) => ({
      kind: KINDS[classes[l.itemId] ?? 'made_to_order_garment'], description: l.description, qty: l.qty,
      unitPriceCents: l.unitPriceCents, discountCents: l.discountCents + share[i]!, roster: [] as never[],
    })),
  };
}
