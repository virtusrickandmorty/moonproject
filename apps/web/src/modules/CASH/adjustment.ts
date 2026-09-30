/**
 * Bank adjustment form logic (PLAN D5 BANK-ADJ): typed values -> the server's input. Pure, so it is tested without a
 * browser; the server recomputes the final tax on interest and checks everything again.
 */
import { isBusinessDate, parsePesos } from '@moonproject/shared';

export type BankAdjustmentKind = 'charge' | 'interest';
export const KIND_LABEL: Record<BankAdjustmentKind, string> = { charge: 'Bank charge', interest: 'Interest earned' };
export const KIND_HELP: Record<BankAdjustmentKind, string> = {
  charge: 'The bank took money out: service charge, checkbook, fee.',
  interest: 'The bank paid interest. The gross amount goes here; the bank keeps the final tax and the summary shows it.',
};
export const isKind = (v: string): v is BankAdjustmentKind => v === 'charge' || v === 'interest';

export interface AdjustmentValues { placeId: string; kind: string; amount: string; description: string; note: string }
export interface AdjustmentInput { cashPlaceId: number; kind: BankAdjustmentKind; amountCents: number; description: string; note?: string }
export const emptyAdjustment = (): AdjustmentValues => ({ placeId: '', kind: '', amount: '', description: '', note: '' });

/** The typed form -> input, with the plain-English reasons it is not ready. */
export function adjustmentInput(v: AdjustmentValues): { input: AdjustmentInput; errors: string[] } {
  const errors: string[] = [];
  if (!v.placeId) errors.push('Pick the bank account.');
  if (!isKind(v.kind)) errors.push('Say whether it is a bank charge or interest earned.');
  let amountCents = 0;
  try {
    amountCents = parsePesos(v.amount);
    if (amountCents <= 0 || amountCents > 100_000_000_00) throw new Error('range');
  } catch {
    amountCents = 0;
    errors.push('Type the amount like 150.00, as the statement shows it (more than zero, no minus sign).');
  }
  const description = v.description.trim();
  if (!description) errors.push('Type what the bank called it, like "Service charge".');
  if (description.length > 200) errors.push('Keep the description within 200 characters.');
  const note = v.note.trim();
  if (note.length > 500) errors.push('Keep the note within 500 characters.');
  const input: AdjustmentInput = { cashPlaceId: Number(v.placeId), kind: isKind(v.kind) ? v.kind : 'charge', amountCents, description, ...(note ? { note } : {}) };
  return { input, errors };
}

/** The statement day someone who may backdate gives; blank means today. */
export function statementDay(text: string): { businessDate?: string; error?: string } {
  const t = text.trim();
  if (!t) return {};
  return isBusinessDate(t) ? { businessDate: t } : { error: 'Type the date on the statement like 2026-09-30, or leave it empty for today.' };
}
