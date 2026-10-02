import type { Db } from '../../platform/db/driver.ts';
import { arAging, cashPosition, collectionsRegister, incomeStatement } from '../RPT/public.ts';

const monthStart = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
const monthEnd = (year: number, month: number) => {
  const value = new Date(Date.UTC(year, month + 1, 0));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
};

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
    return {
      month: from.slice(0, 7), from, to,
      salesCents: section('revenue'),
      collectionsCents: collectionsRegister(db, from, to).tenderCents,
      expensesCents: section('costOfSales') + section('operatingExpenses') + section('incomeTax'),
      cashCents: cashPosition(db, to).totalCents,
    };
  });
  const aging = arAging(db, asOf);
  return { asOf, months, receivables: [
    { key: 'current', label: 'Current', amountCents: aging.buckets.current },
    { key: 'days1to30', label: '1–30', amountCents: aging.buckets.days1to30 },
    { key: 'days31to60', label: '31–60', amountCents: aging.buckets.days31to60 },
    { key: 'days61to90', label: '61–90', amountCents: aging.buckets.days61to90 },
    { key: 'over90', label: 'Over 90', amountCents: aging.buckets.over90 },
  ] };
}
