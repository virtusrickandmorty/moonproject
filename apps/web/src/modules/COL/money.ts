/**
 * Typed rows -> server input for the money screens (collections, refunds, quick sales), and the E5 default "oldest due
 * first". Pure, so it is tested without a browser; the server recomputes and checks everything again.
 */
import { formatPesos, parsePesos } from '@moonproject/shared';

export interface TenderRow { cashPlaceId: string; amount: string; reference: string }
export interface TenderInput { cashPlaceId: number; amountCents: number; reference?: string }
export const emptyTender = (): TenderRow => ({ cashPlaceId: '', amount: '', reference: '' });

/** Typed pesos -> centavos: blank is 0, and undefined means it cannot be read as an amount. */
export function cents(text: string): number | undefined {
  if (!text.trim()) return 0;
  try {
    return parsePesos(text);
  } catch {
    return undefined;
  }
}

/** Tender rows -> input. Blank rows are left out; `pick` is the question the cash place answers. */
export function tendersToInput(rows: TenderRow[], pick = 'pick where the money went'): { tenders: TenderInput[]; errors: string[] } {
  const tenders: TenderInput[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const amount = cents(r.amount);
    if (!r.cashPlaceId && !r.amount.trim() && !r.reference.trim()) return;
    if (!r.cashPlaceId) errors.push(`Payment ${i + 1}: ${pick}.`);
    if (amount === undefined || amount <= 0) errors.push(`Payment ${i + 1}: type an amount like 1,250.00`);
    else if (r.cashPlaceId) tenders.push({ cashPlaceId: Number(r.cashPlaceId), amountCents: amount, ...(r.reference.trim() ? { reference: r.reference.trim() } : {}) });
  });
  if (tenders.length === 0 && errors.length === 0) errors.push('Type the amount and pick where the money went.');
  return { tenders, errors };
}

export const tendersToRows = (tenders: TenderInput[]): TenderRow[] =>
  tenders.map((t) => ({ cashPlaceId: String(t.cashPlaceId), amount: formatPesos(t.amountCents), reference: t.reference ?? '' }));

export const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** E5 default: the money received pays the oldest items first; what is left stays unapplied (a deposit). */
export function oldestFirst(receivedCents: number, dues: readonly number[]): number[] {
  let left = Math.max(0, receivedCents);
  return dues.map((due) => {
    const paid = Math.min(Math.max(0, due), left);
    left -= paid;
    return paid;
  });
}
