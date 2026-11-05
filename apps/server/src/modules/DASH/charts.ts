import type { Db } from '../../platform/db/driver.ts';
import { arAging, cashPosition, collectionsRegister, expensesLeftOut, expensesThatStood, incomeStatement } from '../RPT/public.ts';

const monthStart = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
const monthEnd = (year: number, month: number) => {
  const value = new Date(Date.UTC(year, month + 1, 0));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
};

/** The largest few, for a graph's details. */
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
    // Expenses as they really stood (the owner's choice, Nov 2026): a cancelled one is left out of both its months, so no month
    // goes below zero for it. The income statement keeps it on its dates, so a month here can differ; across the months they agree.
    const stood = expensesThatStood(db, from, to);
    const part = (digit: string) => stood.filter((e) => e.code[0] === digit).reduce((n, e) => n + e.amountCents, 0);
    const costOfSalesCents = part('5');
    const operatingCents = part('6');
    const incomeTaxCents = part('8');
    return {
      month: from.slice(0, 7), from, to,
      salesCents: section('revenue'),
      collectionsCents: collectionsRegister(db, from, to).tenderCents,
      expensesCents: costOfSalesCents + operatingCents + incomeTaxCents,
      cashCents: cash.totalCents,
      // What the graphs show on hover.
      costOfSalesCents, operatingCents, incomeTaxCents,
      biggestExpenses: biggest(stood.map((e) => ({ name: e.name, amountCents: e.amountCents }))),
      cancelledExpenses: expensesLeftOut(db, from, to),
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
