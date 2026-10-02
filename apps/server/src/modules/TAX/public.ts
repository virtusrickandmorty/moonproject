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
import { salesRegister, withholdingReceivedRegister } from './registers.ts';
import { ewtRegister, purchasesRegister } from './purchases.ts';

export interface RegisterDifference { register: string; path: string; registerCents: number; ledgerCents: number }

/**
 * L6 (PLAN D9), for AUD's nightly checks: each tax register's total for [from, to] against the movement of its GL
 * account (output VAT, input VAT, EWT payable, CWT, VAT withheld). The registers are read from the ledger, so a
 * difference means a register lost or doubled a journal (an opening withholding is split into its 2307 lines, so its
 * lines must add up to its journal). Only the registers that differ are returned.
 */
export function registerDifferences(db: Db, from: string, to: string): RegisterDifference[] {
  const sales = salesRegister(db, from, to);
  const bought = purchasesRegister(db, from, to);
  const ewt = ewtRegister(db, from, to);
  const held = withholdingReceivedRegister(db, from, to);
  return [
    { register: 'Sales register (output VAT)', path: '/tax/sales', registerCents: sales.totals.vatCents, ledgerCents: sales.glVatCents },
    { register: 'Purchases register (input VAT)', path: '/tax/purchases', registerCents: bought.totals.vatCents, ledgerCents: bought.glVatCents },
    { register: 'EWT register', path: '/tax/ewt', registerCents: ewt.totals.ewtCents, ledgerCents: ewt.glEwtCents },
    { register: '2307s received (creditable tax)', path: '/tax/2307-received', registerCents: held.totals.cwtCents, ledgerCents: held.glCwtCents },
    { register: '2307s received (VAT withheld)', path: '/tax/2307-received', registerCents: held.totals.vatWithheldCents, ledgerCents: held.glVatWithheldCents },
  ].filter((r) => r.registerCents !== r.ledgerCents);
}

/** What a quarter's 1601-FQ leaves to pay (EQ's dividend declaration checks it before a cancel). */
export { finalTaxDue, type FinalTaxDue } from './payments.ts';
/** The same quarter figures shown by the VAT worksheet, for read-only summaries such as DASH. */
export { vatSummary, type VatPosition } from './vat.ts';
