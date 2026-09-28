/**
 * The repayment and write-off forms' rules (PLAN D5 CA-REPAY, CA-WO): typed values to input. Pure, so they are tested
 * without a browser; the server checks what is owed and everything else again.
 */
import { cents } from '../COL/money.ts';

export interface RepaymentValues { employeeId: string; cashPlaceId: string; amount: string; reference: string; note: string }
export const emptyRepayment = (employeeId = ''): RepaymentValues => ({ employeeId, cashPlaceId: '', amount: '', reference: '', note: '' });

export function repaymentInput(v: RepaymentValues) {
  const amount = cents(v.amount);
  const errors = [
    ...(v.employeeId ? [] : ['Pick who pays back.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money went.']),
    ...(amount && amount > 0 ? [] : ['Type the amount paid back, like 500.00']),
  ];
  const input = {
    employeeId: v.employeeId, cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0,
    ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors };
}

/** A blank amount writes off all that is owed. */
export interface WriteoffValues { employeeId: string; amount: string; accountId: string; reason: string }
export const emptyWriteoff = (employeeId = ''): WriteoffValues => ({ employeeId, amount: '', accountId: '', reason: '' });

export function writeoffInput(v: WriteoffValues) {
  const amount = cents(v.amount);
  const errors = [
    ...(v.employeeId ? [] : ['Pick whose cash advance is written off.']),
    ...(amount === undefined || amount < 0 ? ['Type the amount like 500.00, or leave it blank to write off all that is owed.'] : []),
    ...(v.accountId ? [] : ['Pick the expense account to charge.']),
    ...(v.reason.trim().length >= 10 ? [] : ['Say why it is written off (at least 10 characters).']),
  ];
  const input = { employeeId: v.employeeId, ...(amount ? { amountCents: amount } : {}), accountId: Number(v.accountId), reason: v.reason.trim() };
  return { input, errors };
}
