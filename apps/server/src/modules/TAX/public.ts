/** Read-only TAX contract for other modules (JO, QS and COL call the booklet check from `validate`). */
export { BOOKLET_KINDS, bookletIssue, type BookletKind } from './check.ts';
export { taxDeadlines } from './calendar.ts';
export { ewtReturnCheck, vatCloseCheck, type ReturnCheck } from './month-end.ts';
/** The filed returns (form, period, the payment that filed it and when it was recorded), all or those covering a date (ACC-22). */
export { filedReturns, filedReturnsCovering, type FiledForm, type FiledReturn } from './filed.ts';

/** The VAT registers, for RPT's BIR books (read-only). */
export { salesRegister } from './registers.ts';
export { certificatesToIssue, purchasesRegister, type CertificateLine } from './purchases.ts';

/** What a quarter's 1601-FQ leaves to pay (EQ's dividend declaration checks it before a cancel). */
export { finalTaxDue, type FinalTaxDue } from './payments.ts';
