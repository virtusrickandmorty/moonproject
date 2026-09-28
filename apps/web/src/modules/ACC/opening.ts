/**
 * The opening balances screens' rules (PLAN D8 "Cut-over", MIG-02): the OB- form's typed lines to input, its date,
 * 3900 in words, what still stops the close, and the "New ..." links of the opening documents. Pure, so they are tested
 * without a browser; the server checks everything again and refuses the close itself.
 */
import { formatPeso, formatPesos, isBusinessDate } from '@moonproject/shared';
import type { DocTypeInfo, OpeningState } from '../../api.ts';
import { docPath, labelOf } from '../../shell/menu.ts';
import { cents } from '../COL/money.ts';

/** One typed OB- line; `stockholderId` only on an account kept per stockholder. */
export interface OpeningRow { accountId: string; stockholderId: string; debit: string; credit: string; memo: string }
export const emptyOpeningRow = (): OpeningRow => ({ accountId: '', stockholderId: '', debit: '', credit: '', memo: '' });

export interface OpeningLineInput { accountId: number; stockholderId?: string; debitCents?: number; creditCents?: number; memo?: string }
type Accounts = OpeningState['accounts'];

const isBlank = (r: OpeningRow) => !r.accountId && !r.stockholderId && !r.debit.trim() && !r.credit.trim() && !r.memo.trim();

/** Debits and credits of the typed lines; an unreadable amount counts as nothing. 3900 takes the difference. */
export function openingSides(rows: OpeningRow[]): { debits: number; credits: number } {
  const add = (text: string) => Math.max(cents(text) ?? 0, 0);
  return { debits: rows.reduce((s, r) => s + add(r.debit), 0), credits: rows.reduce((s, r) => s + add(r.credit), 0) };
}

/** Typed rows -> OB- input, with plain errors. Blank rows are left out; the lines need not balance (3900 takes the rest). */
export function openingInput(rows: OpeningRow[], accounts: Accounts): { input: { lines: OpeningLineInput[] }; errors: string[] } {
  const errors: string[] = [];
  const lines: OpeningLineInput[] = [];
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const n = `Line ${i + 1}`;
    const a = accounts.find((x) => String(x.id) === r.accountId);
    const debit = cents(r.debit);
    const credit = cents(r.credit);
    if (!a) errors.push(`${n}: pick an account.`);
    else if (a.needsStockholder && !r.stockholderId) errors.push(`${n}: pick the stockholder for ${a.name}.`);
    if (debit === undefined || debit < 0) errors.push(`${n}: type the debit like 1,250.00`);
    else if (credit === undefined || credit < 0) errors.push(`${n}: type the credit like 1,250.00`);
    else if ((debit > 0) === (credit > 0)) errors.push(`${n}: type a debit or a credit, not both and not neither.`);
    lines.push({
      accountId: a?.id ?? 0, ...(a?.needsStockholder && r.stockholderId ? { stockholderId: r.stockholderId } : {}),
      ...(debit ? { debitCents: debit } : {}), ...(credit ? { creditCents: credit } : {}), ...(r.memo.trim() ? { memo: r.memo.trim() } : {}),
    });
  });
  if (lines.length === 0) errors.push('Enter at least one line.');
  return { input: { lines }, errors };
}

/** Stored lines -> typed rows, to prefill an edit. */
export const openingRows = (lines: OpeningLineInput[]): OpeningRow[] =>
  lines.map((l) => ({
    accountId: String(l.accountId), stockholderId: l.stockholderId ?? '', debit: l.debitCents ? formatPesos(l.debitCents) : '', credit: l.creditCents ? formatPesos(l.creditCents) : '', memo: l.memo ?? '',
  }));

/**
 * An opening document is dated the cut-over date. On today no date is sent; an earlier day is sent (the accountant may
 * backdate); a later day cannot be recorded yet.
 */
export function openingDate(cutover: string | null, today: string): { businessDate?: string; error?: string } {
  if (!cutover) return { error: 'Set the cut-over date on the Opening balances page first.' };
  if (!today || cutover === today) return {};
  if (cutover > today) return { error: `The cut-over date, ${cutover}, is after today. Opening balances are recorded on it or after it.` };
  return { businessDate: cutover };
}

/** The 3900 line of an OB- preview: the difference, on the side that balances the journal. */
export function equityLineWords(doc: { equityDebitCents: number; equityCreditCents: number }): string {
  if (doc.equityCreditCents > 0) return `Credit ${formatPeso(doc.equityCreditCents)} to opening balance equity (3900)`;
  if (doc.equityDebitCents > 0) return `Debit ${formatPeso(doc.equityDebitCents)} to opening balance equity (3900)`;
  return 'The lines balance by themselves: nothing goes to opening balance equity (3900).';
}

/** 3900's balance (debit-positive) in words; zero is what the close needs. */
export function equityWords(cents: number): string {
  if (cents === 0) return 'Zero';
  return cents < 0 ? `Credit balance of ${formatPeso(-cents)}` : `Debit balance of ${formatPeso(cents)}`;
}

/** The cut-over date typed on the page, before asking the server (which gives every other refusal in its own words). */
export function cutoverError(typed: string, current: string | null): string | null {
  if (!isBusinessDate(typed)) return 'Pick the cut-over date.';
  if (typed === current) return `The cut-over date is already ${typed}.`;
  return null;
}

/** What still stops the close, in the order of the server's own checks; empty when "Close the opening" may be pressed. */
export function closeBlockers(s: Pick<OpeningState, 'cutoverDate' | 'openingEquityCents' | 'trialBalance' | 'checks' | 'closed'>): string[] {
  if (s.closed) return ['The opening is closed.'];
  if (!s.cutoverDate || !s.trialBalance) return ['Set the cut-over date first.'];
  const out: string[] = [];
  if (s.openingEquityCents !== 0) out.push(`Opening balance equity (3900) is not zero: ${equityWords(s.openingEquityCents).toLowerCase()}. Record the equity breakdown until it is zero.`);
  if (!s.trialBalance.balanced) out.push(`The trial balance on ${s.cutoverDate} does not balance.`);
  const untied = s.checks.filter((c) => !c.ok);
  if (untied.length) out.push(`The balance by customer, supplier or person does not add up to the account total for ${untied.map((c) => `${c.code} ${c.name}`).join(', ')}.`);
  return out;
}

/** A "New ..." link per opening document type (key ending ".opening") that has its own form and the user may create. */
export function openingForms(docTypes: Pick<DocTypeInfo, 'key' | 'title' | 'canCreate'>[], formKeys: string[]): { key: string; label: string; path: string }[] {
  return docTypes
    .filter((d) => d.key.endsWith('.opening') && d.canCreate && formKeys.includes(d.key))
    .map((d) => ({ key: d.key, label: `New ${labelOf(d)}`, path: docPath(d.key, '/new') }));
}
