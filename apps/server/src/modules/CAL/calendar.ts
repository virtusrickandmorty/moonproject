import { badRequest, isBusinessDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { activeJobOrders, jobOrderRef, releasesBetween } from '../JO/public.ts';
import { customerBirthdays } from '../CUS/public.ts';
import { employeeBirthdays, holidaysBetween } from '../EMP/public.ts';
import { taxDeadlines } from '../TAX/public.ts';

export type CalKind = 'event' | 'job_due' | 'release' | 'holiday' | 'tax' | 'customer_birthday' | 'employee_birthday';
export interface CalItem { id: string; date: string; kind: CalKind; title: string; href: string; time?: string | null; notes?: string | null; rush?: boolean }
export interface EventRow {
  id: string; eventId: string; seq: number; action: 'create' | 'move' | 'cancel'; title: string; date: string;
  time: string | null; customerId: string | null; jobOrderId: string | null; notes: string | null;
  reason: string | null; createdAt: string; createdBy: string;
}
const FIELDS = `id, event_id AS eventId, seq, action, title, event_date AS date, event_time AS time,
  customer_id AS customerId, job_order_id AS jobOrderId, notes, reason, created_at AS createdAt, created_by AS createdBy`;

export function currentEvent(db: Db, eventId: string): EventRow | undefined {
  return db.prepare(`SELECT ${FIELDS} FROM cal_events WHERE event_id = ? ORDER BY seq DESC LIMIT 1`).get(eventId) as EventRow | undefined;
}
export function eventHistory(db: Db, eventId: string): EventRow[] {
  return db.prepare(`SELECT ${FIELDS} FROM cal_events WHERE event_id = ? ORDER BY seq`).all(eventId) as EventRow[];
}
export function currentEventsBetween(db: Db, from: string, to: string): EventRow[] {
  return db.prepare(`SELECT ${FIELDS} FROM cal_events e WHERE e.seq =
    (SELECT MAX(v.seq) FROM cal_events v WHERE v.event_id = e.event_id)
    AND e.action <> 'cancel' AND e.event_date BETWEEN ? AND ? ORDER BY e.event_date, e.event_time, e.title`)
    .all(from, to) as EventRow[];
}

export function checkRange(from: string, to: string): void {
  if (!isBusinessDate(from) || !isBusinessDate(to) || to < from) throw badRequest('BAD_RANGE', 'Enter a valid start and end date.');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 62) throw badRequest('BAD_RANGE', 'Show at most 62 days at a time.');
}

/** Put recurring birthdays on their actual month/day in every year of the requested range. */
export function birthdaysBetween(from: string, to: string, birthday: string): string[] {
  const mmdd = birthday.slice(5);
  const dates: string[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const date = `${year}-${mmdd}`;
    if (isBusinessDate(date) && date >= from && date <= to) dates.push(date);
  }
  return dates;
}

export function calendarItems(db: Db, from: string, to: string, can: (permission: string) => boolean): CalItem[] {
  checkRange(from, to);
  const items: CalItem[] = [];
  const add = (item: CalItem) => items.push(item);
  for (const event of currentEventsBetween(db, from, to)) {
    const href = event.jobOrderId && can('jo.view') && jobOrderRef(db, event.jobOrderId)?.status === 'posted'
      ? `/docs/jo.job_order/${event.jobOrderId}`
      : event.customerId && can('cus.view') ? `/cus?customer=${event.customerId}` : `/cal?event=${event.eventId}`;
    add({ id: event.eventId, date: event.date, kind: 'event', title: event.title, href, time: event.time, notes: event.notes });
  }
  if (can('jo.view')) {
    for (const jo of activeJobOrders(db)) if (jo.stage !== 'released' && jo.dueDate >= from && jo.dueDate <= to) {
      add({ id: `due:${jo.id}`, date: jo.dueDate, kind: 'job_due', title: `${jo.number} due · ${jo.customerName}${jo.priority === 'rush' ? ' · Rush' : ''}`, href: `/docs/jo.job_order/${jo.id}`, rush: jo.priority === 'rush' });
    }
    for (const release of releasesBetween(db, from, to)) {
      add({ id: `release:${release.id}`, date: release.date, kind: 'release', title: `${release.number} released`, href: `/docs/jo.release/${release.id}` });
    }
  }
  if (can('emp.view')) {
    for (const holiday of holidaysBetween(db, from, to)) add({ id: `holiday:${holiday.id}`, date: holiday.date, kind: 'holiday', title: holiday.name, href: `/emp/holidays` });
    for (const person of employeeBirthdays(db)) for (const date of birthdaysBetween(from, to, person.birthday)) {
      add({ id: `employee:${person.id}:${date}`, date, kind: 'employee_birthday', title: `${person.name}'s birthday`, href: `/emp/employees/${person.id}` });
    }
  }
  if (can('cus.view')) for (const person of customerBirthdays(db)) for (const date of birthdaysBetween(from, to, person.birthday)) {
    add({ id: `customer:${person.id}:${date}`, date, kind: 'customer_birthday', title: `${person.name}'s birthday`, href: `/cus?customer=${person.customerId}` });
  }
  if (can('tax.calendar.view')) for (const deadline of taxDeadlines(db, from, to)) {
    add({ id: `tax:${deadline.form}:${deadline.period}`, date: deadline.dueDate, kind: 'tax', title: `${deadline.form} · ${deadline.title}`, href: '/tax/calendar' });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
}
