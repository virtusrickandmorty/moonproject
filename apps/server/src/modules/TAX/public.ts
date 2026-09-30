/** Read-only TAX contract for other modules (JO, QS and COL call the booklet check from `validate`). */
export { BOOKLET_KINDS, bookletIssue, type BookletKind } from './check.ts';
export { taxDeadlines } from './calendar.ts';
export { ewtReturnCheck, vatCloseCheck, type ReturnCheck } from './month-end.ts';

/** The VAT registers, for RPT's BIR books (read-only). */
export { salesRegister } from './registers.ts';
export { certificatesToIssue, purchasesRegister, type CertificateLine } from './purchases.ts';
