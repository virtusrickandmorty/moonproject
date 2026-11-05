import type { Db } from '../../platform/db/driver.ts';
import { arAging, cashPosition, collectionsRegister, expensesCancelledFromEarlier, incomeStatement } from '../RPT/public.ts';

const monthStart = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
const monthEnd = (year: number, month: number) => {
  const value = new Date(Date.UTC(year, month + 1, 0));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
};

const EXPENSES = ['costOfSales', 'operatingExpenses', 'incomeTax'];
/** The largest few, for a graph's details; a minus (a cancel) is explained on its own. */
const biggest = <T extends { amountCents: number }>(rows: T[]) => rows.filter((r) => r.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents).slice(0, 3);

export function ownerCharts(db: Db, asOf: string) {
  const currentYear = Number(asOf.slice(0, 4));
  const currentMonth = Number(asOf.slice(5, 7)) - 1;
  const months = Array.from({ length: 12 }, (_, index) => {
    const absolute = currentYear * 12 + currentMonth - 11 + index;
    const year = Math.floor(absolute / 12);
    const month = absolute % 12;
    const from = monthStart(year, month);
    const calendarEnd = monthEnd(year, month);
    const to = calendarEnd > asOf ? asOf : calendarEnd;
    const statement = incomeStatement(db, from, to);
    const section = (key: string) => statement.sections.find((row) => row.key === key)?.totalCents ?? 0;
    const cash = cashPosition(db, to);
    const costOfSalesCents = section('costOfSales');
    const operatingCents = section('operatingExpenses');
    const incomeTaxCents = section('incomeTax');
    return {
      month: from.slice(0, 7), from, to,
      salesCents: section('revenue'),
      collectionsCents: collectionsRegister(db, from, to).tenderCents,
      expensesCents: costOfSalesCents + operatingCents + incomeTaxCents,
      cashCents: cash.totalCents,
      // What the graphs show on hover.
      costOfSalesCents, operatingCents, incomeTaxCents,
      biggestExpenses: biggest(statement.sections.filter((row) => EXPENSES.includes(row.key)).flatMap((row) => row.groups.flatMap((g) => g.lines)).map((e) => ({ name: e.name, amountCents: e.amountCents }))),
      cancelledExpenses: expensesCancelledFromEarlier(db, from, to),
      cashPlaces: cash.rows.filter((row) => row.balanceCents !== 0).map((row) => ({ name: row.name, balanceCents: row.balanceCents })),
    };
  });
  const aging = arAging(db, asOf);
  const bucket = (key: keyof typeof aging.buckets, label: string) => {
    const owing = new Map<string, number>();
    for (const row of aging.rows) if (row.buckets[key] !== 0) owing.set(row.customerName, (owing.get(row.customerName) ?? 0) + row.buckets[key]);
    return { key, label, amountCents: aging.buckets[key], customers: owing.size, biggest: biggest([...owing].map(([name, amountCents]) => ({ name, amountCents }))) };
  };
  return { asOf, months, receivables: [
    bucket('current', 'Current'), bucket('days1to30', '1–30'), bucket('days31to60', '31–60'), bucket('days61to90', '61–90'), bucket('over90', 'Over 90'),
  ] };
}
