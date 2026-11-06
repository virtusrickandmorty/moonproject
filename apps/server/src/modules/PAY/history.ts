/**
 * One employee's payroll history (the owner's request, Nov 2026): each recorded payroll they are on, and their 13th-month pay for
 * those who may see it, newest first. Net, released and left come from releaseStatus, the figures the release screen shows; a
 * cancelled payroll or release is not there. Read-only.
 */
import type { Db } from '../../platform/db/driver.ts';
import { releaseStatus } from './doctypes/release.ts';

export interface PayHistoryRelease { id: string; number: string; date: string; amountCents: number }
export interface PayHistoryRow {
  id: string; kind: 'run' | 'thirteenth'; number: string; payDate: string; periodStart: string; periodEnd: string;
  grossCents: number; netCents: number; paidCents: number; leftCents: number; releases: PayHistoryRelease[];
}

type Head = Pick<PayHistoryRow, 'id' | 'number' | 'payDate' | 'periodStart' | 'periodEnd' | 'grossCents'>;
const releases = (db: Db, head: string, lines: string, source: string, id: string, employeeId: string) => db.prepare(`SELECT d.id, d.number, d.business_date AS date, l.amount_cents AS amountCents
  FROM ${lines} l JOIN ${head} x ON x.document_id = l.document_id JOIN documents d ON d.id = l.document_id
  WHERE x.${source} = ? AND l.employee_id = ? AND d.status = 'posted' ORDER BY d.business_date, d.number`).all(id, employeeId) as PayHistoryRelease[];

export function payHistory(db: Db, employeeId: string, withThirteenth: boolean): PayHistoryRow[] {
  const row = (kind: PayHistoryRow['kind'], h: Head, paid: PayHistoryRelease[]): PayHistoryRow => {
    const s = releaseStatus(db, h.id).find((x) => x.employeeId === employeeId);
    return { ...h, kind, netCents: s?.netCents ?? 0, paidCents: s?.paidCents ?? 0, leftCents: s?.leftCents ?? 0, releases: paid };
  };
  const runs = (db.prepare(`SELECT d.id, d.number, d.business_date AS payDate, r.period_start AS periodStart, r.period_end AS periodEnd, e.gross_cents AS grossCents
    FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = e.document_id
    WHERE e.employee_id = ? AND d.status = 'posted'`).all(employeeId) as Head[])
    .map((h) => row('run', h, releases(db, 'pay_releases', 'pay_release_lines', 'run_id', h.id, employeeId)));
  const thirteenths = !withThirteenth ? [] : (db.prepare(`SELECT d.id, d.number, d.business_date AS payDate, t.year || '-01-01' AS periodStart, t.year || '-12-31' AS periodEnd, e.amount_cents AS grossCents
    FROM pay_thirteenth_employees e JOIN pay_thirteenths t ON t.document_id = e.document_id JOIN documents d ON d.id = e.document_id
    WHERE e.employee_id = ? AND d.status = 'posted'`).all(employeeId) as Head[])
    .map((h) => row('thirteenth', h, releases(db, 'pay_thirteenth_releases', 'pay_thirteenth_release_lines', 'thirteenth_id', h.id, employeeId)));
  return [...runs, ...thirteenths].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.number.localeCompare(a.number));
}
