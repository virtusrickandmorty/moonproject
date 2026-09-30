/**
 * The credit forms' rules (PLAN D5 CWT-ONLY, DEP-FORFEIT, CM-ALLOW, BAD-DEBT): typed values to input, and what is
 * missing. Pure, so they are tested without a browser; the server checks what is owed or held and everything else again.
 */
import { cents } from './money.ts';

const reasonError = (reason: string, what: string) => (reason.trim().length >= 10 ? [] : [`Say why ${what} (at least 10 characters).`]);
const amountOf = (text: string, example: string) => {
  const amount = cents(text);
  return { amount: amount ?? 0, errors: amount && amount > 0 ? [] : [`Type the amount like ${example}`] };
};

export interface CwtOnlyValues { invoiceId: string; amount: string; atc: '' | 'WC158' | 'WC160' | 'other'; period: string; note: string }
export const emptyCwtOnly = (): CwtOnlyValues => ({ invoiceId: '', amount: '', atc: '', period: '', note: '' });

/** `period` is the quarter printed on the 2307, typed as 2026-Q3. */
export function cwtOnlyInput(v: CwtOnlyValues) {
  const { amount, errors: amountErrors } = amountOf(v.amount, '250.00');
  const q = /^(\d{4})-Q([1-4])$/.exec(v.period.trim().toUpperCase());
  const errors = [
    ...(v.invoiceId ? [] : ['Pick the invoice the tax was withheld on.']),
    ...amountErrors,
    ...(v.atc ? [] : ['Pick the ATC printed on the 2307.']),
    ...(q ? [] : ['Type the quarter on the 2307 like 2026-Q3.']),
  ];
  const input = {
    invoiceId: v.invoiceId, cwtCents: amount, atc: v.atc || 'WC158', periodYear: q ? Number(q[1]) : 0, periodQuarter: q ? Number(q[2]) : 0,
    ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors };
}

export interface ForfeitValues { jobOrderId: string; amount: string; reason: string }
export const emptyForfeit = (): ForfeitValues => ({ jobOrderId: '', amount: '', reason: '' });

export function forfeitInput(v: ForfeitValues) {
  const { amount, errors: amountErrors } = amountOf(v.amount, '5,000.00');
  const errors = [...(v.jobOrderId ? [] : ['Pick the job order the customer abandoned.']), ...amountErrors, ...reasonError(v.reason, 'the deposit is kept')];
  return { input: { jobOrderId: v.jobOrderId, amountCents: amount, reason: v.reason.trim() }, errors };
}

export interface CreditMemoValues { invoiceId: string; kind: '' | 'return' | 'allowance'; amount: string; formNumber: string; reason: string }
export const emptyCreditMemo = (): CreditMemoValues => ({ invoiceId: '', kind: '', amount: '', formNumber: '', reason: '' });

export function creditMemoInput(v: CreditMemoValues) {
  const { amount, errors: amountErrors } = amountOf(v.amount, '1,120.00');
  const form = v.formNumber.trim();
  const errors = [
    ...(v.invoiceId ? [] : ['Pick the invoice this credit memo is for.']),
    ...(v.kind ? [] : ['Pick return or allowance.']),
    ...amountErrors,
    ...(!form || /^\d{1,12}$/.test(form) ? [] : ['Type the credit memo form number in digits only, or leave it blank.']),
    ...reasonError(v.reason, 'the customer gets this credit'),
  ];
  return { input: { invoiceId: v.invoiceId, kind: v.kind || 'return', amountCents: amount, ...(form ? { formNumber: form } : {}), reason: v.reason.trim() }, errors };
}

export interface WriteOffValues { invoiceId: string; reason: string }
export const emptyWriteOff = (): WriteOffValues => ({ invoiceId: '', reason: '' });

export function writeOffInput(v: WriteOffValues) {
  const errors = [...(v.invoiceId ? [] : ['Pick the invoice to write off.']), ...reasonError(v.reason, 'it is written off')];
  return { input: { invoiceId: v.invoiceId, reason: v.reason.trim() }, errors };
}
