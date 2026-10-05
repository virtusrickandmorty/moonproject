/**
 * Opening job order form (PLAN D8 "Cut-over" step 2): what the accountant types -> the server's input, and back for an
 * edit. Pure, so it is tested without a browser; the server works out the totals and checks everything again.
 */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';
import { KINDS, type Kind } from '../QS/lines.ts';

export { KINDS };
export const TERMS = [
  ['dp50', '50% downpayment'],
  ['full', 'Full payment'],
  ['cod', 'Cash on delivery'],
  ['net7', '7 days'],
  ['net15', '15 days'],
  ['net30', '30 days'],
] as const;
export type Terms = (typeof TERMS)[number][0];

/** A line still to make or release. A roster read back for an edit is kept as it is. */
export interface OpeningLineRow { kind: Kind; description: string; qty: string; price: string; discount: string; roster: unknown[] }
export interface OpeningValues {
  customerId: string; oldNumber: string; contact: string; dueDate: string; priority: 'normal' | 'rush'; paymentTerms: Terms | ''; notes: string;
  lines: OpeningLineRow[]; deposits: string; depositsMemo: string; receivable: string; oldInvoices: string;
}
export interface OpeningLineInput { kind: Kind; description: string; qty: number; unitPriceCents: number; discountCents: number; roster: unknown[] }
export interface OpeningInput {
  customerId: string; oldNumber: string; contact?: string; dueDate: string; priority: 'normal' | 'rush'; paymentTerms: Terms; notes?: string;
  lines: OpeningLineInput[]; depositsCents: number; depositsMemo?: string; receivableCents: number; oldInvoices?: string;
}

export const emptyOpeningLine = (): OpeningLineRow => ({ kind: 'made_to_order', description: '', qty: '1', price: '', discount: '', roster: [] });
export const emptyOpening = (): OpeningValues => ({
  customerId: '', oldNumber: '', contact: '', dueDate: '', priority: 'normal', paymentTerms: '', notes: '',
  lines: [emptyOpeningLine()], deposits: '', depositsMemo: '', receivable: '', oldInvoices: '',
});

const optional = (key: string, text: string) => (text.trim() ? { [key]: text.trim() } : {});

/** Typed values -> input, the part still to release, and what to fix first. Blank line rows are left out. */
export function openingInput(v: OpeningValues): { input: OpeningInput; linesCents: number; errors: string[] } {
  const errors: string[] = [];
  if (!v.customerId) errors.push('Pick the customer.');
  if (!v.oldNumber.trim()) errors.push('Type the job order number in the old records.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)) errors.push('Pick the due date.');
  if (!v.paymentTerms) errors.push('Pick the payment terms.');
  const lines: OpeningLineInput[] = [];
  v.lines.forEach((r, i) => {
    if (!r.description.trim() && !r.price.trim() && !r.discount.trim()) return;
    const [price, discount] = [cents(r.price), cents(r.discount)];
    const at = `Line ${i + 1}`;
    const before = errors.length;
    if (!r.description.trim()) errors.push(`${at}: say what is still to make or release.`);
    if (!(Number.isInteger(Number(r.qty)) && Number(r.qty) >= 1 && Number(r.qty) <= 10_000)) errors.push(`${at}: the quantity must be a whole number like 1 or 20.`);
    if (price === undefined || discount === undefined || price < 0 || discount < 0) errors.push(`${at}: type amounts like 280.00`);
    if (errors.length === before) lines.push({ kind: r.kind, description: r.description.trim(), qty: Number(r.qty), unitPriceCents: price!, discountCents: discount!, roster: r.roster });
  });
  const [deposits, receivable] = [cents(v.deposits), cents(v.receivable)];
  if (deposits === undefined || deposits < 0) errors.push('Deposits held: type an amount like 28,000.00');
  if (receivable === undefined || receivable < 0) errors.push('Invoiced and not yet paid: type an amount like 15,000.00');
  if (lines.length === 0 && !receivable) errors.push('Add the lines still to make or release, or the amount invoiced and not yet paid.');
  if (receivable && !v.oldInvoices.trim()) errors.push('Type the old invoice numbers of the amount not yet paid.');
  const input: OpeningInput = {
    customerId: v.customerId,
    oldNumber: v.oldNumber.trim(),
    ...optional('contact', v.contact),
    dueDate: v.dueDate,
    priority: v.priority,
    paymentTerms: (v.paymentTerms || 'dp50') as Terms,
    ...optional('notes', v.notes),
    lines,
    depositsCents: deposits ?? 0,
    ...optional('depositsMemo', v.depositsMemo),
    receivableCents: receivable ?? 0,
    ...optional('oldInvoices', v.oldInvoices),
  };
  return { input, linesCents: lines.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0), errors };
}

/** A recorded opening job order's input -> typed values, for its Edit. */
export function openingValues(i: OpeningInput): OpeningValues {
  const money = (c: number) => (c ? formatPesos(c) : '');
  return {
    customerId: i.customerId,
    oldNumber: i.oldNumber,
    contact: i.contact ?? '',
    dueDate: i.dueDate,
    priority: i.priority,
    paymentTerms: i.paymentTerms,
    notes: i.notes ?? '',
    lines: i.lines.length > 0
      ? i.lines.map((l) => ({ kind: l.kind, description: l.description, qty: String(l.qty), price: formatPesos(l.unitPriceCents), discount: money(l.discountCents), roster: l.roster }))
      : [emptyOpeningLine()],
    deposits: money(i.depositsCents),
    depositsMemo: i.depositsMemo ?? '',
    receivable: money(i.receivableCents),
    oldInvoices: i.oldInvoices ?? '',
  };
}
