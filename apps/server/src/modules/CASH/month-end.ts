/**
 * What the month-end checklist (ACC, PLAN D8) reads from CASH: whether each bank account is reconciled to the month
 * end and whether each cash box was counted in the month. Read-only. A place that has no entry up to the month end
 * (or, for a box, none in the month and a zero balance) has nothing to reconcile or count, so it is "not needed".
 */
import type { Db } from '../../platform/db/driver.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { listPlaces } from './places.ts';

export interface PlaceCheck { placeId: number; name: string; state: 'done' | 'not_done' | 'not_needed'; detail: string }

const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const linesBetween = (db: Db, accountId: number, from: string, to: string) =>
  db.prepare(`SELECT COUNT(*) FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.sealed = 1 AND j.business_date BETWEEN ? AND ?`)
    .pluck().get(accountId, from, to) as number;

/** Active places of a kind, and inactive ones only if they moved in the month. */
const placesOf = (db: Db, kind: 'bank' | 'cash', month: string) =>
  listPlaces(db, true).filter((p) => p.kind === kind && (p.isActive || linesBetween(db, p.id, `${month}-01`, monthEnd(month)) > 0));

/** Each bank: done when a finished reconciliation covers the month (its own month, or a later one, since months go in order). */
export function bankReconChecks(db: Db, month: string): PlaceCheck[] {
  return placesOf(db, 'bank', month).map((p): PlaceCheck => {
    const finished = db.prepare(`SELECT month FROM cash_recons WHERE account_id = ? AND status = 'finished' AND month >= ? ORDER BY month LIMIT 1`).pluck().get(p.id, month) as string | undefined;
    const base = { placeId: p.id, name: p.name };
    if (finished) return { ...base, state: 'done', detail: finished === month ? `Reconciled to the end of ${month}.` : `Reconciled up to ${finished}, which covers ${month}.` };
    if (linesBetween(db, p.id, '0000-01-01', monthEnd(month)) === 0) return { ...base, state: 'not_needed', detail: 'No entries up to the month end.' };
    const open = db.prepare(`SELECT 1 FROM cash_recons WHERE account_id = ? AND month = ? AND status = 'open'`).get(p.id, month);
    return { ...base, state: 'not_done', detail: open ? `The ${month} reconciliation is started, not finished.` : `Not reconciled to the end of ${month}.` };
  });
}

/** Each cash box (cash on hand, petty cash): done when a count was recorded with a date in the month. */
export function cashCountChecks(db: Db, month: string): PlaceCheck[] {
  const [from, to] = [`${month}-01`, monthEnd(month)];
  return placesOf(db, 'cash', month).map((p): PlaceCheck => {
    const base = { placeId: p.id, name: p.name };
    const count = db
      .prepare(`SELECT d.number, d.business_date AS date FROM cash_counts c JOIN documents d ON d.id = c.document_id
                WHERE c.cash_account_id = ? AND d.status = 'posted' AND d.business_date BETWEEN ? AND ? ORDER BY d.business_date DESC, d.number DESC LIMIT 1`)
      .get(p.id, from, to) as { number: string; date: string } | undefined;
    if (count) return { ...base, state: 'done', detail: `Counted on ${count.date} (${count.number}).` };
    if (linesBetween(db, p.id, from, to) === 0 && accountBalance(db, p.id, { asOf: to }) === 0) return { ...base, state: 'not_needed', detail: 'Nothing in the box this month.' };
    return { ...base, state: 'not_done', detail: `No cash count dated in ${month}.` };
  });
}
