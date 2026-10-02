/** Read-only TAX contract for other modules (JO, QS and COL call the booklet check from `validate`). */
export { BOOKLET_KINDS, bookletIssue, type BookletKind } from './check.ts';
export { taxDeadlines } from './calendar.ts';
import type { Db } from '../../platform/db/driver.ts';
import { filedReturns } from './filed.ts';

/**
 * "form:period" of every return already paid or remitted (filedReturns: the BIR payments and the 1601-C remittances),
 * in the tax calendar's names, where the annual return is 1702-RT. For the deadline notices on the home page.
 */
export function paidTaxPeriods(db: Db): Set<string> {
  return new Set(filedReturns(db).map((r) => `${r.form === '1702' ? '1702-RT' : r.form}:${r.period}`));
}

/** Whether a pending certificate on a collection/opening was later marked received. */
export function hasReceived2307(db: Db, documentId: string, lineNo = 0): boolean {
  return !!db.prepare('SELECT 1 FROM tax_2307_receipts WHERE document_id = ? AND line_no = ?').get(documentId, lineNo);
}
export { ewtReturnCheck, vatCloseCheck, type ReturnCheck } from './month-end.ts';
/** The filed returns (form, period, the payment that filed it and when it was recorded), all or those covering a date (ACC-22). */
export { filedReturns, filedReturnsCovering, type FiledForm, type FiledReturn } from './filed.ts';

/** The VAT registers, for RPT's BIR books (read-only). */
export { salesRegister } from './registers.ts';
export { certificatesToIssue, purchasesRegister, type CertificateLine } from './purchases.ts';

/** What a quarter's 1601-FQ leaves to pay (EQ's dividend declaration checks it before a cancel). */
export { finalTaxDue, type FinalTaxDue } from './payments.ts';
/** The same quarter figures shown by the VAT worksheet, for read-only summaries such as DASH. */
export { vatSummary, type VatPosition } from './vat.ts';
