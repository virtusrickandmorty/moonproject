/**
 * What other modules may use from ACC. Opening documents of part 2 (MIG-02, PLAN D8 steps 2 and 3): a module records
 * a balance that existed at the cut-over date with the detail it needs later (a supplier bill still open, a loan with
 * its schedule, a fixed asset with its depreciation so far). Each one, like OB-:
 *   - has the key <module>.opening, a title from the "Opening ..." titles, and OPENING_PERMISSIONS;
 *   - is dated the cut-over date (dating 'accountant_may_backdate'; validate adds openingIssues) and cancels on it
 *     (cancelOn 'document_date'; afterCancel calls assertOpeningOpen, so a closed opening keeps its documents);
 *   - takes the other side of its lines to 3900 opening balance equity (role OPENING_EQUITY).
 * The opening screen lists them with OB- and the cut-over date moves only when none is left posted.
 */
import { conflict, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { closedOn, cutoverDate, openingClose } from './opening.ts';

export { cutoverDate, openingClose, type OpeningClose } from './opening.ts';
/** Accruals whose reversal day has come and that are not reversed yet (for a to-do list on the accountant's home). */
export { reversalsDue, type ReversibleJv } from './doctypes/jv-reversals.ts';
/** The read-only checklist used by the month-end screen and accountant summaries. */
export { monthEndChecklist } from './month-end.ts';

/** The accountant records the opening; owners see it (the acc.opening.* keys, declared by ACC). */
export const OPENING_PERMISSIONS = { view: 'acc.opening.view', create: 'acc.opening.create', post: 'acc.opening.post', cancel: 'acc.opening.cancel' } as const;

/** Why an opening document may not be dated businessDate: no cut-over date yet, another date, or the opening closed. */
export function openingIssues(db: Db, businessDate: string): Issue[] {
  const err = (code: string, message: string): Issue => ({ field: 'businessDate', code, level: 'error', message });
  const closed = openingClose(db);
  if (closed) return [err('OPENING_CLOSED', `The opening was closed on ${closedOn(closed)}. Correct balances with a journal voucher.`)];
  const cutover = cutoverDate(db);
  if (!cutover) return [err('NO_CUTOVER', 'Set the cut-over date first.')];
  if (businessDate !== cutover) return [err('NOT_CUTOVER_DATE', `Opening balances are dated the cut-over date, ${cutover}, not ${businessDate}.`)];
  return [];
}

/**
 * The warning every opening document gives when a posted, not cancelled document of its own type already records the
 * same key figures (`number` is that document). A warning, not an error: two real rows can look alike. Once the opening
 * is closed, OPENING_CLOSED is the only thing worth saying.
 */
export function duplicateOpeningIssue(db: Db, field: string, number: string | undefined, what: string): Issue[] {
  if (!number || openingClose(db)) return [];
  return [{ field, code: 'DUPLICATE_OPENING', level: 'warning', message: `${number} already records ${what}. Record it again only if there really are two.` }];
}

/** For an opening document's afterCancel: throwing rolls the cancel back once the opening is closed. */
export function assertOpeningOpen(db: Db): void {
  const closed = openingClose(db);
  if (closed) throw conflict('OPENING_CLOSED', `The opening was closed on ${closedOn(closed)}. Correct balances with a journal voucher.`);
}
