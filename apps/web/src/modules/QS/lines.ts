/** Quick sale lines as typed -> server input (PLAN E6). Pure, so it is tested without a browser. */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export const KINDS = [
  ['service', 'Repair / alteration'],
  ['ready_made', 'Ready-made item'],
  ['made_to_order', 'Made to order'],
] as const;
export type Kind = (typeof KINDS)[number][0];
export interface LineRow { kind: Kind; description: string; qty: string; price: string; discount: string }
export interface LineInput { kind: Kind; description: string; qty: number; unitPriceCents: number; discountCents: number }

export const emptyLine = (kind: Kind = 'service'): LineRow => ({ kind, description: '', qty: '1', price: '', discount: '' });

/** Rows -> input and the total the customer pays. Blank rows are left out. */
export function linesToInput(rows: LineRow[]): { lines: LineInput[]; totalCents: number; errors: string[] } {
  const lines: LineInput[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!r.description.trim() && !r.price.trim() && !r.discount.trim()) return;
    const [price, discount] = [cents(r.price), cents(r.discount)];
    const at = `Line ${i + 1}`;
    if (!r.description.trim()) errors.push(`${at}: say what was sold.`);
    if (!/^[1-9]\d{0,3}$/.test(r.qty.trim())) errors.push(`${at}: the quantity must be a whole number like 1 or 2.`);
    if (price === undefined || discount === undefined || price < 0 || discount < 0) errors.push(`${at}: type amounts like 350.00`);
    if (errors.length === 0) lines.push({ kind: r.kind, description: r.description.trim(), qty: Number(r.qty), unitPriceCents: price!, discountCents: discount! });
  });
  if (lines.length === 0 && errors.length === 0) errors.push('Add what was sold.');
  return { lines, totalCents: lines.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0), errors };
}

export const linesToRows = (lines: LineInput[]): LineRow[] =>
  lines.map((l) => ({ kind: l.kind, description: l.description, qty: String(l.qty), price: formatPesos(l.unitPriceCents), discount: l.discountCents ? formatPesos(l.discountCents) : '' }));
