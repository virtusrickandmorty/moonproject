/** Doc types with their own form or view parts; the generic screens handle every other type (PLAN H2). */
import type { ComponentType } from 'react';
import type { DocTypeInfo, Me } from '../api.ts';
import type { FormMode } from '../generic/DocForm.tsx';
import type { ViewParts } from '../generic/DocView.tsx';
import { CollectionForm } from './COL/CollectionForm.tsx';
import { DepositTransferForm } from './COL/DepositTransferForm.tsx';
import { RefundForm } from './COL/RefundForm.tsx';
import { jobOrderView } from './JO/JobOrderView.tsx';
import { QuickSaleForm } from './QS/QuickSaleForm.tsx';
import { quickSaleView } from './QS/QuickSaleView.tsx';
import { EntryForm } from './PRD/EntryForm.tsx';
import { ProductionBoard } from './PRD/Board.tsx';
import { PieceRates } from './RATE/Rates.tsx';
import { Employees } from './EMP/Employees.tsx';
import { EmployeePage } from './EMP/Employee.tsx';
import { Attendance } from './EMP/Attendance.tsx';
import { Holidays } from './EMP/Holidays.tsx';
import { RunForm } from './PAY/RunForm.tsx';
import { ReleaseForm } from './PAY/ReleaseForm.tsx';
import { Payslips, advanceView, releaseView, runView } from './PAY/views.tsx';
import { AdvanceForm } from './CA/AdvanceForm.tsx';
import { StatMonthPage, StatMonths, remittanceView } from './STAT/Statutory.tsx';
import { RemittanceForm } from './STAT/RemittanceForm.tsx';
import { GeneralJournal, GeneralLedger, TrialBalance } from './RPT/Books.tsx';
import { CashAccounts } from './CASH/CashAccounts.tsx';
import { CashBook } from './CASH/CashBook.tsx';
import { CashCountForm } from './CASH/CashCountForm.tsx';
import { cashCountView } from './CASH/CashCountView.tsx';
import { Booklets, BookletPage, RegisterBooklet } from './TAX/Booklets.tsx';
import { SalesRegister, WithholdingReceived } from './TAX/Registers.tsx';
import { TaxCalendar } from './TAX/TaxCalendar.tsx';
import { VatQuarter } from './TAX/VatQuarter.tsx';
import { ShopCertificate } from './SEC/ShopCertificate.tsx';

/**
 * Screens that are not a document list, form or view, by path pattern (`:name` parts arrive in `params`). Their menu
 * items are in shell/menu.ts SCREENS.
 */
export const PAGES: Record<string, ComponentType<{ me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }>> = {
  '/cash/accounts': CashAccounts,
  '/cash/book': CashBook,
  '/prd/board': ProductionBoard,
  '/prd/rates': PieceRates,
  '/emp/employees': Employees,
  '/emp/employees/:id': EmployeePage,
  '/emp/attendance': Attendance,
  '/emp/holidays': Holidays,
  '/pay/runs/:id/payslips': Payslips,
  '/stat': StatMonths,
  '/stat/:month': StatMonthPage,
  '/tax/booklets': Booklets,
  '/tax/booklets/new': RegisterBooklet,
  '/tax/booklets/:id': BookletPage,
  '/rpt/journal': GeneralJournal,
  '/rpt/ledger': GeneralLedger,
  '/rpt/trial-balance': TrialBalance,
  '/tax/sales': SalesRegister,
  '/tax/2307-received': WithholdingReceived,
  '/tax/vat': VatQuarter,
  '/tax/calendar': TaxCalendar,
  '/admin/shop-certificate': ShopCertificate,
};

/** A module's own form; `me` lets it offer what only some users may do (the remittance's date paid, for acc.backdate). */
export const FORMS: Record<string, ComponentType<{ type: DocTypeInfo; mode: FormMode; me: Me }>> = {
  'cash.count': CashCountForm,
  'col.collection': CollectionForm,
  'col.refund': RefundForm,
  'col.deposit_transfer': DepositTransferForm,
  'qs.sale': QuickSaleForm,
  'prd.entry': EntryForm,
  'pay.run': RunForm,
  'pay.release': ReleaseForm,
  'ca.advance': AdvanceForm,
  'stat.remittance': RemittanceForm,
};

export const VIEWS: Record<string, ViewParts> = { 'jo.job_order': jobOrderView, 'qs.sale': quickSaleView, 'pay.run': runView, 'pay.release': releaseView, 'ca.advance': advanceView, 'stat.remittance': remittanceView, 'cash.count': cashCountView };
