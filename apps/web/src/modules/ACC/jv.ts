/**
 * The journal voucher form's rules (PLAN D5 JV, E12): typed lines to input, the running debits − credits that must be
 * zero, the party a line's account asks for, and the entry date with its late reason. Pure, so they are tested without
 * a browser; the server checks every line again.
 */
import { formatPeso, formatPesos, isBusinessDate } from '@moonproject/shared';
import type { Account, PartyType } from '../../api.ts';
import { cents } from '../COL/money.ts';

/** One typed line. `party` is the picked id (or free text); `partyName` only shows a picked customer. */
export interface JvRow { accountId: string; party: string; partyName: string; debit: string; credit: string; memo: string }
export const emptyRow = (): JvRow => ({ accountId: '', party: '', partyName: '', debit: '', credit: '', memo: '' });

export interface JvLineInput { accountId: number; party?: { type: PartyType; id: string }; debitCents?: number; creditCents?: number; memo?: string }
export interface JvInput { memo: string; lines: JvLineInput[]; lateReason?: string }

/** Accounts a line may use: active, not headings. Reserved ones are hidden from encoders only, so the accountant sees them. */
export const postable = (accounts: Account[]) => accounts.filter((a) => a.isActive && !a.isHeader);

export const PARTY_WORDS: Record<PartyType, string> = {
  customer: 'customer', supplier: 'supplier', employee: 'employee', officer: 'officer', stockholder: 'stockholder', loan: 'loan', asset: 'asset', free: 'party',
};

const isBlank = (r: JvRow) => !r.accountId && !r.party.trim() && !r.debit.trim() && !r.credit.trim() && !r.memo.trim();

/** Debits and credits of the typed lines; an unreadable amount counts as nothing. */
export function totals(rows: JvRow[]): { debits: number; credits: number; difference: number } {
  const add = (text: string) => Math.max(cents(text) ?? 0, 0);
  const debits = rows.reduce((s, r) => s + add(r.debit), 0);
  const credits = rows.reduce((s, r) => s + add(r.credit), 0);
  return { debits, credits, difference: debits - credits };
}

/** The running "debits − credits" in words. */
export function balanceWords(difference: number): string {
  if (difference === 0) return 'Balanced';
  return difference > 0 ? `Debits are ${formatPeso(difference)} more than credits` : `Credits are ${formatPeso(-difference)} more than debits`;
}

/** Typed memo and rows -> input, with plain errors. Blank rows are left out; a party goes only on an account that takes one. */
export function jvInput(memo: string, rows: JvRow[], accounts: Account[], lateReason?: string): { input: JvInput; errors: string[] } {
  const errors: string[] = [];
  const lines: JvLineInput[] = [];
  if (memo.trim().length < 5) errors.push('Say what the entry is for (5 letters or more).');
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const n = `Line ${i + 1}`;
    const a = accounts.find((x) => String(x.id) === r.accountId);
    const debit = cents(r.debit);
    const credit = cents(r.credit);
    if (!a) errors.push(`${n}: pick an account.`);
    else if (a.partyType && a.partyType !== 'free' && !r.party) errors.push(`${n}: pick the ${PARTY_WORDS[a.partyType]} for ${a.name}.`);
    if (debit === undefined || debit < 0) errors.push(`${n}: type the debit like 1,250.00`);
    else if (credit === undefined || credit < 0) errors.push(`${n}: type the credit like 1,250.00`);
    else if ((debit > 0) === (credit > 0)) errors.push(`${n}: type a debit or a credit, not both and not neither.`);
    const party = a?.partyType && r.party.trim() ? { party: { type: a.partyType, id: r.party.trim() } } : {};
    lines.push({
      accountId: a?.id ?? 0, ...party, ...(debit ? { debitCents: debit } : {}), ...(credit ? { creditCents: credit } : {}), ...(r.memo.trim() ? { memo: r.memo.trim() } : {}),
    });
  });
  if (lines.length < 2) errors.push('Enter at least two lines.');
  const { difference } = totals(rows);
  if (difference !== 0) errors.push(`Debits and credits must be equal. ${balanceWords(difference)}.`);
  return { input: { memo: memo.trim(), lines, ...(lateReason?.trim() ? { lateReason: lateReason.trim() } : {}) }, errors };
}

/** Stored lines -> typed rows, to prefill an edit. */
export const rowsFromInput = (lines: JvLineInput[]): JvRow[] =>
  lines.map((l) => ({
    accountId: String(l.accountId), party: l.party?.id ?? '', partyName: '', debit: l.debitCents ? formatPesos(l.debitCents) : '', credit: l.creditCents ? formatPesos(l.creditCents) : '', memo: l.memo ?? '',
  }));

/**
 * The entry date, offered only to someone who may backdate (acc.backdate). Empty or today sends no date; an earlier day is
 * a late entry, which needs a reason of 10 letters or more (the server refuses a day after today).
 */
export function entryDate(text: string, today: string, reason: string): { businessDate?: string; late: boolean; error?: string } {
  const v = text.trim();
  if (!v || v === today) return { late: false };
  if (!isBusinessDate(v)) return { late: false, error: 'Type the date like 2026-09-15, or leave it empty for today.' };
  if (today && v > today) return { late: false, error: 'The date cannot be after today.' };
  return { businessDate: v, late: true, ...(reason.trim().length < 10 ? { error: 'Say why the entry is recorded late (10 letters or more).' } : {}) };
}
