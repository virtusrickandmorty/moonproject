/**
 * The Reports overview (the owner's request, Nov 2026): one month's management summary, for reading the month rather than
 * today's figures, which the home already shows. Every money figure comes from the report it is taken from, so the two agree.
 * - A month still running is compared with the same days of the month before, not with a whole month.
 * - Days to collect: what customers owe at the end of the period over the period's sales per day.
 * - Months of cash: cash at the end over what operations paid out in an average complete month (of up to the last three).
 * - The profit and loss follows the books, so an expense cancelled from an earlier month takes off here; those are named.
 */
import { divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { cashFlowStatement } from './cash-flow.ts';
import { cancellations, exceptions, lateEntries } from './control.ts';
import { monthEnd, previousMonth } from './monthly-pack.ts';
import { arAging } from './receivables.ts';
import { collectionsRegister, salesByPeriod } from './sales-collections.ts';
import { expensesCancelledFromEarlier, incomeStatement } from './statements.ts';
import { apAging, receivedNotBilled } from './suppliers.ts';

const TREND_MONTHS = 12;
const SHOWN = 5;
const EXPENSES_SHOWN = 8;
const RUNWAY_MONTHS = 3;
const EXPENSE_SECTIONS = ['costOfSales', 'operatingExpenses', 'incomeTax'];
const day = 86_400_000;

/** A part of a whole in basis points; none when there is nothing to measure against. */
const shareOf = (part: number, whole: number) => (whole > 0 ? divRoundHalfAway(part * 10_000, whole) : null);
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / day);
const monthsBack = (month: string, count: number) => {
  const list = [month];
  while (list.length < count) list.unshift(previousMonth(list[0]!));
  return list;
};

function profit(db: Db, from: string, to: string) {
  const statement = incomeStatement(db, from, to);
  const section = (key: string) => statement.sections.find((row) => row.key === key)?.totalCents ?? 0;
  return {
    salesCents: section('revenue'), costOfSalesCents: section('costOfSales'), grossProfitCents: statement.grossProfitCents,
    operatingCents: section('operatingExpenses'), otherCents: section('otherIncomeAndExpenses'),
    incomeBeforeTaxCents: statement.incomeBeforeTaxCents, incomeTaxCents: section('incomeTax'), netIncomeCents: statement.netIncomeCents,
  };
}

function expenseLines(db: Db, from: string, to: string) {
  return incomeStatement(db, from, to).sections.filter((row) => EXPENSE_SECTIONS.includes(row.key)).flatMap((row) => row.groups.flatMap((g) => g.lines));
}

/** What operations paid out in a month: its money-out lines, as a positive figure. */
function paidOut(db: Db, month: string) {
  const flow = cashFlowStatement(db, `${month}-01`, monthEnd(month));
  return -(flow.sections.find((s) => s.key === 'operating')?.lines ?? []).reduce((n, line) => n + Math.min(0, line.amountCents), 0);
}

/** The period's ratios: what the top of the page shows, for this period and the one it is compared with. */
function ratios(db: Db, from: string, to: string) {
  const figures = profit(db, from, to);
  const collectionsCents = collectionsRegister(db, from, to).tenderCents;
  const owedCents = arAging(db, to).totalCents;
  return {
    netIncomeCents: figures.netIncomeCents,
    netMarginBp: shareOf(figures.netIncomeCents, figures.salesCents),
    grossMarginBp: shareOf(figures.grossProfitCents, figures.salesCents),
    collectionRateBp: shareOf(collectionsCents, figures.salesCents),
    daysToCollect: figures.salesCents > 0 ? divRoundHalfAway(owedCents * (daysBetween(from, to) + 1), figures.salesCents) : null,
  };
}

function collectFirst(db: Db, asOf: string) {
  const aging = arAging(db, asOf);
  const customers = new Map<string, { customerName: string; owedCents: number; overdueCents: number; oldestDue: string }>();
  for (const row of aging.rows) {
    const c = customers.get(row.customerName) ?? { customerName: row.customerName, owedCents: 0, overdueCents: 0, oldestDue: '' };
    const overdue = row.totalCents - row.buckets.current;
    c.owedCents += row.totalCents;
    c.overdueCents += overdue;
    if (overdue > 0 && row.dueDate && (!c.oldestDue || row.dueDate < c.oldestDue)) c.oldestDue = row.dueDate;
    customers.set(row.customerName, c);
  }
  const owing = [...customers.values()].filter((c) => c.owedCents > 0);
  return {
    totalCents: aging.totalCents, overdueCents: owing.reduce((n, c) => n + c.overdueCents, 0), customers: owing.length,
    rows: owing.sort((a, b) => b.overdueCents - a.overdueCents || b.owedCents - a.owedCents || a.customerName.localeCompare(b.customerName)).slice(0, SHOWN)
      .map(({ oldestDue, ...c }) => ({ ...c, daysOverdue: oldestDue ? Math.max(0, daysBetween(oldestDue, asOf)) : 0 })),
  };
}

function billsToPay(db: Db, asOf: string) {
  const aging = apAging(db, asOf);
  const open = aging.rows.filter((r) => r.balanceCents > 0);
  return {
    totalCents: aging.totalCents, overdueCents: open.filter((r) => r.dueDate < asOf).reduce((n, r) => n + r.balanceCents, 0), bills: open.length,
    rows: open.slice(0, SHOWN).map((r) => ({ number: r.number, supplierName: r.supplierName, dueDate: r.dueDate, balanceCents: r.balanceCents, late: r.dueDate < asOf, documentPath: r.documentPath })),
  };
}

function bestCustomers(db: Db, from: string, to: string) {
  const sales = salesByPeriod(db, from, to);
  const totals = new Map<string, number>();
  for (const row of sales.rows) totals.set(row.customerName, (totals.get(row.customerName) ?? 0) + row.salesCents);
  return {
    totalCents: sales.totalCents,
    rows: [...totals].map(([customerName, salesCents]) => ({ customerName, salesCents, shareBp: shareOf(salesCents, sales.totalCents) }))
      .filter((c) => c.salesCents > 0).sort((a, b) => b.salesCents - a.salesCents || a.customerName.localeCompare(b.customerName)).slice(0, SHOWN),
  };
}

/** Net pay still owed to workers: the balance of 2110 at a date. */
const payrollOwed = (db: Db, asOf: string) => db.prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l
  JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
  WHERE j.sealed = 1 AND j.business_date <= ? AND a.code = '2110'`).pluck().get(asOf) as number;

/** What to look at before the month is closed: each says how many or how much, and opens the report that lists it. */
function reviewItems(db: Db, month: string, asOf: string, cashTies: boolean) {
  const found = exceptions(db, asOf).rows.length;
  const cancelled = cancellations(db).rows.filter((r) => r.cancelledAt.slice(0, 7) === month).length;
  const late = lateEntries(db).rows.filter((r) => r.businessDate.slice(0, 7) === month).length;
  const unbilled = receivedNotBilled(db);
  const owed = payrollOwed(db, asOf);
  return [
    { key: 'exceptions', label: 'Exceptions', count: found, amountCents: null, ok: found === 0, href: `/rpt/exceptions?asOf=${asOf}` },
    { key: 'cancellations', label: 'Cancelled in the month', count: cancelled, amountCents: null, ok: cancelled === 0, href: '/rpt/cancellations' },
    { key: 'late', label: 'Entered late, dated in the month', count: late, amountCents: null, ok: late === 0, href: '/rpt/late-entries' },
    { key: 'unbilled', label: 'Received, no supplier bill yet', count: unbilled.rows.length, amountCents: unbilled.totalCents, ok: unbilled.rows.length === 0, href: '/rpt/received-not-billed' },
    { key: 'payroll', label: 'Net pay not yet released', count: null, amountCents: owed, ok: owed === 0, href: '/rpt/payroll-register' },
    { key: 'cash', label: 'Cash flow ties to the balance sheet', count: null, amountCents: null, ok: cashTies, href: '/rpt/cash-flow' },
  ];
}

export function reportsOverview(db: Db, month: string, today: string) {
  const running = month === today.slice(0, 7);
  const from = `${month}-01`;
  const to = running ? today : monthEnd(month);
  const before = previousMonth(month);
  const beforeFrom = `${before}-01`;
  // The same days of the month before, while this one runs.
  const beforeEnd = monthEnd(before);
  const beforeTo = running && to.slice(8) < beforeEnd.slice(8) ? `${before}-${to.slice(8)}` : beforeEnd;
  const flow = cashFlowStatement(db, from, to);
  const complete = running ? before : month;
  const paid = monthsBack(complete, RUNWAY_MONTHS).map((m) => paidOut(db, m)).filter((cents) => cents > 0);
  const averagePaidCents = paid.length ? divRoundHalfAway(paid.reduce((n, c) => n + c, 0), paid.length) : 0;
  const previousLines = new Map(expenseLines(db, beforeFrom, beforeTo).map((line) => [line.code, line.amountCents]));
  const lines = expenseLines(db, from, to).filter((line) => line.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents);
  return {
    month, from, to, running, previousMonth: before, previousFrom: beforeFrom, previousTo: beforeTo,
    now: ratios(db, from, to), previous: ratios(db, beforeFrom, beforeTo),
    cashMonths: averagePaidCents > 0 ? Math.round((flow.closingCashCents * 10) / averagePaidCents) / 10 : null,
    averagePaidCents,
    profit: { month: profit(db, from, to), previous: profit(db, beforeFrom, beforeTo), yearToDate: profit(db, `${month.slice(0, 4)}-01-01`, to) },
    cancelledExpenses: expensesCancelledFromEarlier(db, from, to),
    cash: { openingCents: flow.openingCashCents, sections: flow.sections, netChangeCents: flow.netChangeCents, closingCents: flow.closingCashCents },
    trend: monthsBack(month, TREND_MONTHS).map((m) => {
      const end = monthEnd(m) > today ? today : monthEnd(m);
      return { month: m, from: `${m}-01`, to: end, ...profit(db, `${m}-01`, end), cancelledExpenses: expensesCancelledFromEarlier(db, `${m}-01`, end) };
    }),
    expenses: {
      totalCents: lines.reduce((n, line) => n + line.amountCents, 0),
      rows: lines.slice(0, EXPENSES_SHOWN).map((line) => ({ code: line.code, name: line.name, amountCents: line.amountCents, previousCents: previousLines.get(line.code) ?? 0 })),
    },
    collect: collectFirst(db, to),
    bills: billsToPay(db, to),
    customers: bestCustomers(db, from, to),
    review: reviewItems(db, month, to, flow.balanced),
  };
}
export type ReportsOverview = ReturnType<typeof reportsOverview>;
