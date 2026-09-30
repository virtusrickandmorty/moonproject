import type { Db } from '../../platform/db/driver.ts';
import { cashPosition, collectionsRegister, depositsHeld, payrollRegister, productionTiming, arAging, apAging } from '../RPT/public.ts';
import { salesRegister, taxDeadlines } from '../TAX/public.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date: string, days: number) => dateOf(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
const monthRange = (year: number, month: number) => ({
  from: `${year}-${pad(month)}-01`,
  to: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`,
  label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1))),
});

const monthBefore = (date: string) => {
  const first = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 1);
  return monthRange(first.getUTCFullYear(), first.getUTCMonth() + 1);
};

function period(db: Db, from: string, to: string, label: string) {
  const sales = salesRegister(db, from, to);
  const collections = collectionsRegister(db, from, to);
  const payroll = payrollRegister(db, from.slice(0, 7));
  return {
    label,
    from,
    to,
    salesCents: sales.totals.netCents,
    vatCents: sales.totals.vatCents,
    collectionsCents: collections.tenderCents,
    payrollCents: Number(payroll.totals.grossCents),
  };
}

/** Owner summary composed only from the same read functions as its linked reports. */
export function ownerHealth(db: Db, date: string) {
  const current = monthRange(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  const previous = monthBefore(date);
  const receivables = arAging(db, date);
  const payables = apAging(db, date);
  const production = productionTiming(db, date);
  const weekEnd = addDays(date, 7 - (new Date(`${date}T00:00:00Z`).getUTCDay() || 7));
  const openJobs = production.rows.filter((row) => row.releaseDate === null);
  return {
    asOf: date,
    periods: [period(db, current.from, date, current.label), period(db, previous.from, previous.to, previous.label)],
    cashPlaces: cashPosition(db, date).rows,
    receivables: {
      totalCents: receivables.totalCents,
      over30Cents: receivables.buckets.days31to60 + receivables.buckets.days61to90 + receivables.buckets.over90,
      over60Cents: receivables.buckets.days61to90 + receivables.buckets.over90,
      over90Cents: receivables.buckets.over90,
    },
    payables: {
      totalCents: payables.totalCents,
      dueNext7DaysCents: payables.rows.filter((row) => row.dueDate >= date && row.dueDate <= addDays(date, 7))
        .reduce((sum, row) => sum + row.balanceCents, 0),
    },
    jobs: {
      open: openJobs.length,
      dueThisWeek: openJobs.filter((row) => String(row.dueDate) >= date && String(row.dueDate) <= weekEnd).length,
      late: production.late.length,
    },
    depositsHeldCents: depositsHeld(db, date).totalCents,
    taxDeadlines: taxDeadlines(db, date, addDays(date, 120)).slice(0, 6),
  };
}
