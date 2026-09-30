/** Read-only TAX contract for other modules (JO, QS and COL call the booklet check from `validate`). */
export { BOOKLET_KINDS, bookletIssue, type BookletKind } from './check.ts';
export { taxDeadlines } from './calendar.ts';
import type { Db } from '../../platform/db/driver.ts';

/** Tax periods that already have a live BIR payment, for deadline notices. */
export function paidTaxPeriods(db: Db): Set<string> {
  const rows = db.prepare(`SELECT p.form, p.period FROM tax_bir_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted'
    UNION ALL SELECT '1702Q', p.period FROM tax_income_tax_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted'
    UNION ALL SELECT '1702-RT', p.period FROM tax_income_tax_annual_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted'`).all() as { form: string; period: string }[];
  return new Set(rows.map((row) => `${row.form}:${row.period}`));
}

/** Whether a pending certificate on a collection/opening was later marked received. */
export function hasReceived2307(db: Db, documentId: string, lineNo = 0): boolean {
  return !!db.prepare('SELECT 1 FROM tax_2307_receipts WHERE document_id = ? AND line_no = ?').get(documentId, lineNo);
}
export { ewtReturnCheck, vatCloseCheck, type ReturnCheck } from './month-end.ts';

/** The VAT registers, for RPT's BIR books (read-only). */
export { salesRegister } from './registers.ts';
export { certificatesToIssue, purchasesRegister, type CertificateLine } from './purchases.ts';
