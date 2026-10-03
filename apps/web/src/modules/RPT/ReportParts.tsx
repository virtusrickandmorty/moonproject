import { useEffect, useState } from 'react';

export type Period = 'range' | 'asOf' | 'month' | 'year' | 'none';
export function addressValue(key: string) {
  return typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get(key) ?? '';
}
export function periodQuery(filter: Period, values: Record<string, string>) {
  const keys = filter === 'range' ? ['from', 'to'] : filter === 'none' ? [] : [filter];
  return keys.every((k) => values[k]) ? new URLSearchParams(Object.fromEntries(keys.map((k) => [k, values[k]!]))).toString() : '';
}
export function periodLabel(query: string, today = '') {
  const p = new URLSearchParams(query);
  return p.has('from') ? `${p.get('from')} to ${p.get('to')}` : p.has('asOf') ? `As of ${p.get('asOf')}`
    : p.get('month') ?? p.get('year') ?? (today ? `Current status · As of ${today}` : 'Loading period…');
}
export function usePeriod(filter: Period, today: string) {
  const [values, setValues] = useState(() => Object.fromEntries(['from', 'to', 'asOf', 'month', 'year'].map((k) => [k, addressValue(k)])));
  const [applied, setApplied] = useState(() => periodQuery(filter, values));
  useEffect(() => {
    if (!today || applied) return;
    const initial = { from: `${today.slice(0, 7)}-01`, to: today, asOf: today, month: today.slice(0, 7), year: today.slice(0, 4) };
    const next = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, values[k] || v]));
    setValues(next); setApplied(periodQuery(filter, next));
  }, [today, filter, applied]);
  const draft = periodQuery(filter, values);
  return { values, applied, draft, dates: periodLabel(applied, today), valid: !!draft && (filter !== 'range' || values.from! <= values.to!),
    change: (key: string, value: string) => setValues((old) => ({ ...old, [key]: value })), apply: () => setApplied(draft) };
}
export function PendingPeriod({ applied, values }: { applied: string; values: Record<string, string> }) {
  const p = new URLSearchParams(applied);
  const changed = !!applied && Object.entries(values).some(([k, v]) => (p.get(k) ?? '') !== v);
  return changed ? <p className="text-sm text-amber-800 print:hidden">Changed filters are not applied yet. Press Show to load them.</p> : null;
}
export function ResultSummary({ count, total, summary }: { count: number; total?: number; summary?: string }) {
  return <p className="mb-3 text-sm text-slate-600">{count === 0 ? 'No records for this report and period.'
    : `${count.toLocaleString('en-PH')} records on this page${total !== undefined ? ` of ${total.toLocaleString('en-PH')}` : ''}.`}{summary && ` ${summary}`}</p>;
}
export function statusWords(value: unknown) {
  const text = String(value ?? '');
  return ({ posted: 'Recorded', in_production: 'In production', partially_released: 'Partly released', ready: 'Ready for release',
    current: 'Not overdue', days1to30: '1–30 days overdue', days31to60: '31–60 days overdue', days61to90: '61–90 days overdue', over90: 'Over 90 days overdue' } as Record<string, string>)[text]
    ?? text.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
export function daysOverdue(due: string, asOf: string) {
  return due && asOf ? Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000)) : 0;
}
export const purposes: Record<string, string> = {
  'General journal': 'Check recorded money movements in date order.', 'General ledger': 'Trace each account from its opening balance to its closing balance.',
  'Trial balance': 'Check account balances and that total debits equal total credits.', 'Income statement': 'See the income, costs and profit for the loaded period.',
  'Balance sheet': 'See what the company owns, owes and has in equity at the loaded date.', 'Statement of changes in equity': 'See how owner capital and earnings changed during the loaded period.',
  'Statement of cash flows': 'See where cash came from and where it went during the loaded period.', 'AR aging': 'See unpaid customer balances grouped by how long they have been due.',
  'Customer statement': 'Review a customer’s balance, payments and deposits for the loaded period.', 'AP aging': 'See unpaid supplier bills and how long they have been due.',
  'Purchases by supplier and category': 'Review purchases by supplier and spending category.', 'Purchase orders by status': 'Check which purchase orders are recorded or cancelled.',
  'Received but not billed': 'Find receiving records that still need a supplier bill.', 'Cash position': 'See the balance in each cash place at the loaded date.',
  Transfers: 'Review money moved between cash places and the fees charged.', 'Cash counts': 'Compare counted cash with the ledger and find differences.',
  'Fixed-asset schedule': 'Review asset cost, depreciation and remaining book value.', 'Late entries': 'Check entries dated before the day they were recorded.',
  'Cancellations and reissues': 'Review cancelled documents, their reasons and replacement records.', Exceptions: 'Find records and balances that need attention.',
  'Sign-in history': 'Review successful and unsuccessful sign-in attempts.', 'Payroll register': 'Review employee pay and deductions for the loaded month.',
  'Piece-work summary': 'Compare paid piece work by employee and job order.', 'Labor cost per job order': 'Review paid piece labor tagged to job orders.',
  '13th-month register': 'Compare 13th-month pay due, accrued and already paid for the loaded year.', 'Production board status': 'See how many job orders are at each production stage.',
  'Production throughput per step': 'Compare pieces completed at each production step.', 'Worker output': 'Compare pieces completed by each worker and step.',
  'Job order lead time': 'Review the time between ordering and release.', 'Late job orders': 'Find unreleased job orders past their due date.',
  'Job margin per job order': 'Compare recorded net sales with tagged piece labor for each job order.', 'Deposits held': 'See customer deposits still held at the loaded date.',
  'Deposits crossing a VAT quarter': 'Review deposits held across quarters and the VAT declared on them.', 'Collections register': 'Review collections by cash place and the person who recorded them.',
  'Sales by period': 'Compare recorded net sales by period, customer and item.', 'Job order follow-up': 'Find job orders needing production, collection or release follow-up.',
  "Monthly owners' pack": 'Prepare the monthly financial and job-order reports for the co-owners’ meeting.',
};
