/** Read-only report calculations shared with summary screens. */
export { arAging } from './receivables.ts';
export { apAging } from './suppliers.ts';
export { cashPosition } from './cash-assets.ts';
export { incomeStatement } from './statements.ts';
export { payrollRegister, productionTiming } from './payroll-production.ts';
export { collectionsRegister, depositsHeld, jobOrderFollowUp } from './sales-collections.ts';
/** The six BIR books' figures (bir-books.ts), for the loose-leaf print. */
export { BIR_BOOKS, cashJournal, salesBook, purchaseBook, birGeneralJournal, birGeneralLedger, type BirBook } from './bir-books.ts';
