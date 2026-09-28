/** Doc types with their own form or view parts; the generic screens handle every other type (PLAN H2). */
import type { ComponentType } from 'react';
import type { DocTypeInfo, Me } from '../api.ts';
import type { FormMode } from '../generic/DocForm.tsx';
import type { ViewParts } from '../generic/DocView.tsx';
import { CollectionForm } from './COL/CollectionForm.tsx';
import { DepositTransferForm } from './COL/DepositTransferForm.tsx';
import { RefundForm } from './COL/RefundForm.tsx';
import { jobOrderView, openingJobOrderView } from './JO/JobOrderView.tsx';
import { OpeningJobOrderForm } from './JO/OpeningForm.tsx';
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
import { NotificationsPage } from './DASH/Home.tsx';
import { CalendarPage } from './CAL/Calendar.tsx';
import { Customers } from './CUS/Customers.tsx';
import { CompanyProfileScreen } from './PRT/CompanyProfile.tsx';
import { StatMonthPage, StatMonths, remittanceView } from './STAT/Statutory.tsx';
import { RemittanceForm } from './STAT/RemittanceForm.tsx';
import { GeneralJournal, GeneralLedger, TrialBalance } from './RPT/Books.tsx';
import { BalanceSheet, IncomeStatement } from './RPT/Statements.tsx';
import { CashAccounts } from './CASH/CashAccounts.tsx';
import { CashBook } from './CASH/CashBook.tsx';
import { CashCountForm } from './CASH/CashCountForm.tsx';
import { cashCountView } from './CASH/CashCountView.tsx';
import { Booklets, BookletPage, RegisterBooklet } from './TAX/Booklets.tsx';
import { SalesRegister, WithholdingReceived } from './TAX/Registers.tsx';
import { EwtRegister, PurchasesRegister } from './TAX/SupplierRegisters.tsx';
import { CertificatesToIssue, VatWorksheet } from './TAX/QuarterReports.tsx';
import { TaxCalendar } from './TAX/TaxCalendar.tsx';
import { VatQuarter } from './TAX/VatQuarter.tsx';
import { ShopCertificate } from './SEC/ShopCertificate.tsx';
import { BillForm } from './AP/BillForm.tsx';
import { OpeningBillForm } from './AP/OpeningBillForm.tsx';
import { PaymentForm as SupplierPaymentForm } from './AP/PaymentForm.tsx';
import { billView, paymentView } from './AP/views.tsx';
import { VoucherForm } from './EXP/VoucherForm.tsx';
import { OfficerForm, OwnerMoneyForm } from './EQ/forms.tsx';
import { VatCloseForm } from './TAX/VatCloseForm.tsx';
import { JvForm } from './ACC/JvForm.tsx';
import { OpeningForm } from './ACC/OpeningForm.tsx';
import { OpeningBalances } from './ACC/OpeningBalances.tsx';
import { BirPaymentForm } from './TAX/BirPaymentForm.tsx';
import { EwtMonthReturn, EwtQuarterReturn } from './TAX/EwtWorksheets.tsx';
import { LoanForm } from './LOAN/LoanForm.tsx';
import { OpeningForm as OpeningLoanForm } from './LOAN/OpeningForm.tsx';
import { PaymentForm as LoanPaymentForm } from './LOAN/PaymentForm.tsx';
import { loanView } from './LOAN/views.tsx';
import { BuyForm } from './FA/BuyForm.tsx';
import { OpeningForm as OpeningAssetForm } from './FA/OpeningForm.tsx';
import { Backups } from './BAK/Backups.tsx';
import { AuditLog } from './AUD/AuditLog.tsx';
import { IntegrityCheck } from './AUD/IntegrityCheck.tsx';
import { InventoryCountForm } from './INV/InventoryCountForm.tsx';
import { inventoryCountView } from './INV/InventoryCountView.tsx';

/**
 * Screens that are not a document list, form or view, by path pattern (`:name` parts arrive in `params`). Their menu
 * items are in shell/menu.ts SCREENS.
 */
export const PAGES: Record<string, ComponentType<{ me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }>> = {
  '/dash/notifications': NotificationsPage,
  '/cal': CalendarPage,
  '/cus': Customers,
  '/cash/accounts': CashAccounts,
  '/cash/book': CashBook,
  '/prd/board': ProductionBoard,
  '/prd/rates': PieceRates,
  '/emp/employees': Employees,
  '/emp/employees/:id': EmployeePage,
  '/emp/attendance': Attendance,
  '/emp/holidays': Holidays,
  '/pay/runs/:id/payslips': Payslips,
  '/prt/company-profile': CompanyProfileScreen,
  '/stat': StatMonths,
  '/stat/:month': StatMonthPage,
  '/tax/booklets': Booklets,
  '/tax/booklets/new': RegisterBooklet,
  '/tax/booklets/:id': BookletPage,
  '/rpt/journal': GeneralJournal,
  '/rpt/ledger': GeneralLedger,
  '/rpt/trial-balance': TrialBalance,
  '/rpt/income-statement': IncomeStatement,
  '/rpt/balance-sheet': BalanceSheet,
  '/tax/sales': SalesRegister,
  '/tax/2307-received': WithholdingReceived,
  '/tax/purchases': PurchasesRegister,
  '/tax/ewt': EwtRegister,
  '/tax/2307-to-issue': CertificatesToIssue,
  '/tax/vat': VatQuarter,
  '/tax/2550q': VatWorksheet,
  '/tax/0619e': EwtMonthReturn,
  '/tax/1601eq': EwtQuarterReturn,
  '/acc/opening': OpeningBalances,
  '/tax/calendar': TaxCalendar,
  '/admin/shop-certificate': ShopCertificate,
  '/bak': Backups,
  '/bak/:section': Backups,
  '/aud/log': AuditLog,
  '/aud/integrity': IntegrityCheck,
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
  'ap.bill': BillForm,
  'ap.payment': SupplierPaymentForm,
  'ap.opening': OpeningBillForm,
  'exp.voucher': VoucherForm,
  'eq.owner_money': OwnerMoneyForm,
  'eq.officer': OfficerForm,
  'acc.jv': JvForm,
  'tax.vat_close': VatCloseForm,
  'tax.bir_payment': BirPaymentForm,
  'acc.opening': OpeningForm,
  'loan.loan': LoanForm,
  'loan.payment': LoanPaymentForm,
  'loan.opening': OpeningLoanForm,
  'fa.buy': BuyForm,
  'fa.opening': OpeningAssetForm,
  'inv.count': InventoryCountForm,
  'jo.opening': OpeningJobOrderForm,
};

export const VIEWS: Record<string, ViewParts> = { 'jo.job_order': jobOrderView, 'jo.opening': openingJobOrderView, 'qs.sale': quickSaleView, 'pay.run': runView, 'pay.release': releaseView, 'ca.advance': advanceView, 'stat.remittance': remittanceView, 'cash.count': cashCountView, 'ap.bill': billView, 'ap.payment': paymentView, 'loan.loan': loanView, 'loan.opening': loanView, 'inv.count': inventoryCountView };
