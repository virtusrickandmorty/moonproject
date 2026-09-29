/** Doc types with their own form or view parts; the generic screens handle every other type (PLAN H2). */
import type { ComponentType } from 'react';
import type { DocTypeInfo, Me } from '../api.ts';
import type { FormMode } from '../generic/DocForm.tsx';
import type { ViewParts } from '../generic/DocView.tsx';
import { CollectionForm } from './COL/CollectionForm.tsx';
import { DepositTransferForm } from './COL/DepositTransferForm.tsx';
import { RefundForm } from './COL/RefundForm.tsx';
import { CreditMemoForm, CwtOnlyForm, ForfeitForm, WriteOffForm, creditMemoView, cwtOnlyView, forfeitView, writeOffView } from './COL/CreditForms.tsx';
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
import { ThirteenthForm } from './PAY/ThirteenthForm.tsx';
import { Payslips, advanceView, releaseView, runView, thirteenthView } from './PAY/views.tsx';
import { GovLoans } from './PAY/Loans.tsx';
import { Sheet2316, YearEndPage } from './PAY/YearEnd.tsx';
import { AdvanceForm } from './CA/AdvanceForm.tsx';
import { OpeningForm as OpeningCaForm } from './CA/OpeningForm.tsx';
import { RepaymentForm, WriteoffForm } from './CA/SettleForms.tsx';
import { CaEmployeePage, CaOwed } from './CA/Owed.tsx';
import { NotificationsPage } from './DASH/Home.tsx';
import { CalendarPage } from './CAL/Calendar.tsx';
import { Customers } from './CUS/Customers.tsx';
import { CompanyProfileScreen } from './PRT/CompanyProfile.tsx';
import { StatMonthPage, StatMonths, remittanceView } from './STAT/Statutory.tsx';
import { RemittanceForm } from './STAT/RemittanceForm.tsx';
import { OpeningStatForm } from './STAT/OpeningStatForm.tsx';
import { GeneralJournal, GeneralLedger, TrialBalance } from './RPT/Books.tsx';
import { BalanceSheet, IncomeStatement } from './RPT/Statements.tsx';
import { ArAging, CustomerStatement } from './RPT/Receivables.tsx';
import { DepositsHeld, CollectionsRegister, SalesByPeriod, JobOrderFollowUp } from './RPT/SalesCollections.tsx';
import { CashAccounts } from './CASH/CashAccounts.tsx';
import { CashBook } from './CASH/CashBook.tsx';
import { BankRecon, BankReconWork } from './CASH/BankRecon.tsx';
import { BankAdjustmentForm } from './CASH/BankAdjustmentForm.tsx';
import { bankAdjustmentView } from './CASH/BankAdjustmentView.tsx';
import { CashCountForm } from './CASH/CashCountForm.tsx';
import { cashCountView } from './CASH/CashCountView.tsx';
import { Booklets, BookletPage, RegisterBooklet } from './TAX/Booklets.tsx';
import { SalesRegister, WithholdingReceived } from './TAX/Registers.tsx';
import { EwtRegister, PurchasesRegister } from './TAX/SupplierRegisters.tsx';
import { CertificatesToIssue, VatWorksheet } from './TAX/QuarterReports.tsx';
import { TaxCalendar } from './TAX/TaxCalendar.tsx';
import { VatQuarter } from './TAX/VatQuarter.tsx';
import { ShopCertificate } from './SEC/ShopCertificate.tsx';
import { PracticeShop } from './PLT/PracticeShop.tsx';
import { SystemHealthPage } from './PLT/SystemHealth.tsx';
import { BillForm } from './AP/BillForm.tsx';
import { OpeningBillForm } from './AP/OpeningBillForm.tsx';
import { PaymentForm as SupplierPaymentForm } from './AP/PaymentForm.tsx';
import { AdvanceForm as SupplierAdvanceForm } from './AP/AdvanceForm.tsx';
import { AdvanceReturnForm } from './AP/AdvanceReturnForm.tsx';
import { ApBalances, ApSupplierPage } from './AP/Suppliers.tsx';
import { advanceReturnView, advanceView as supplierAdvanceView, billView, paymentView } from './AP/views.tsx';
import { VoucherForm } from './EXP/VoucherForm.tsx';
import { OfficerForm, OwnerMoneyForm } from './EQ/forms.tsx';
import { OpeningForm as OpeningOfficerForm } from './EQ/OpeningForm.tsx';
import { VatCloseForm } from './TAX/VatCloseForm.tsx';
import { JvForm } from './ACC/JvForm.tsx';
import { OpeningForm } from './ACC/OpeningForm.tsx';
import { OpeningBalances } from './ACC/OpeningBalances.tsx';
import { BirPaymentForm } from './TAX/BirPaymentForm.tsx';
import { OpeningWithholdingForm } from './TAX/OpeningWithholdingForm.tsx';
import { OpeningPayableForm } from './TAX/OpeningPayableForm.tsx';
import { EwtMonthReturn, EwtQuarterReturn } from './TAX/EwtWorksheets.tsx';
import { IncomeTaxReturn } from './TAX/IncomeTax.tsx';
import { AnnualIncomeTaxReturn, YearEndTaxForm } from './TAX/AnnualIncomeTax.tsx';
import { EwtAnnualReturnPage } from './TAX/EwtAnnual.tsx';
import { LoanForm } from './LOAN/LoanForm.tsx';
import { OpeningForm as OpeningLoanForm } from './LOAN/OpeningForm.tsx';
import { PaymentForm as LoanPaymentForm } from './LOAN/PaymentForm.tsx';
import { loanView } from './LOAN/views.tsx';
import { BuyForm } from './FA/BuyForm.tsx';
import { OpeningForm as OpeningAssetForm } from './FA/OpeningForm.tsx';
import { Backups } from './BAK/Backups.tsx';
import { ImportOldData } from './MIG/Importer.tsx';
import { ImportUpload } from './MIG/Upload.tsx';
import { AuditLog } from './AUD/AuditLog.tsx';
import { IntegrityCheck } from './AUD/IntegrityCheck.tsx';
import { Suppliers } from './PUR/Suppliers.tsx';
import { SupplierPage } from './PUR/Supplier.tsx';
import { Supplies } from './PUR/Supplies.tsx';
import { PoForm } from './PUR/PoForm.tsx';
import { RrForm } from './PUR/RrForm.tsx';
import { purchaseOrderView, receivingReportView } from './PUR/views.tsx';
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
  '/cash/recon': BankRecon,
  '/cash/recon/:id': BankReconWork,
  '/prd/board': ProductionBoard,
  '/prd/rates': PieceRates,
  '/pur/suppliers': Suppliers,
  '/pur/suppliers/new': SupplierPage,
  '/pur/suppliers/:id': SupplierPage,
  '/pur/supplies': Supplies,
  '/emp/employees': Employees,
  '/emp/employees/:id': EmployeePage,
  '/emp/attendance': Attendance,
  '/emp/holidays': Holidays,
  '/pay/runs/:id/payslips': Payslips,
  '/ca/employees': CaOwed,
  '/ca/employees/:id': CaEmployeePage,
  '/pay/loans': GovLoans,
  '/pay/2316': YearEndPage,
  '/pay/2316/:year/:employeeId': Sheet2316,
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
  '/rpt/ar-aging': ArAging,
  '/rpt/customer-statement': CustomerStatement,
  '/rpt/deposits-held': DepositsHeld,
  '/rpt/collections-register': CollectionsRegister,
  '/rpt/sales-by-period': SalesByPeriod,
  '/rpt/job-order-follow-up': JobOrderFollowUp,
  '/tax/sales': SalesRegister,
  '/tax/2307-received': WithholdingReceived,
  '/tax/purchases': PurchasesRegister,
  '/tax/ewt': EwtRegister,
  '/tax/2307-to-issue': CertificatesToIssue,
  '/tax/vat': VatQuarter,
  '/tax/2550q': VatWorksheet,
  '/tax/0619e': EwtMonthReturn,
  '/tax/1601eq': EwtQuarterReturn,
  '/tax/1702q': IncomeTaxReturn,
  '/tax/1702rt': AnnualIncomeTaxReturn,
  '/tax/1604e': EwtAnnualReturnPage,
  '/acc/opening': OpeningBalances,
  '/tax/calendar': TaxCalendar,
  '/admin/shop-certificate': ShopCertificate,
  '/admin/practice': PracticeShop,
  '/admin/health': SystemHealthPage,
  '/bak': Backups,
  '/bak/:section': Backups,
  '/mig': ImportOldData,
  '/mig/:uploadId': ImportUpload,
  '/aud/log': AuditLog,
  '/aud/integrity': IntegrityCheck,
  '/ap/suppliers': ApBalances,
  '/ap/suppliers/:id': ApSupplierPage,
};

/** A module's own form; `me` lets it offer what only some users may do (the remittance's date paid, for acc.backdate). */
export const FORMS: Record<string, ComponentType<{ type: DocTypeInfo; mode: FormMode; me: Me }>> = {
  'cash.count': CashCountForm,
  'cash.bank_adj': BankAdjustmentForm,
  'col.collection': CollectionForm,
  'col.refund': RefundForm,
  'col.deposit_transfer': DepositTransferForm,
  'col.cwt_only': CwtOnlyForm,
  'col.forfeit': ForfeitForm,
  'col.credit_memo': CreditMemoForm,
  'col.write_off': WriteOffForm,
  'qs.sale': QuickSaleForm,
  'prd.entry': EntryForm,
  'pay.run': RunForm,
  'pay.release': ReleaseForm,
  'pay.thirteenth': ThirteenthForm,
  'ca.advance': AdvanceForm,
  'ca.opening': OpeningCaForm,
  'ca.repayment': RepaymentForm,
  'ca.writeoff': WriteoffForm,
  'stat.remittance': RemittanceForm,
  'stat.opening': OpeningStatForm,
  'ap.bill': BillForm,
  'ap.payment': SupplierPaymentForm,
  'ap.opening': OpeningBillForm,
  'ap.advance': SupplierAdvanceForm,
  'ap.advance_return': AdvanceReturnForm,
  'exp.voucher': VoucherForm,
  'eq.owner_money': OwnerMoneyForm,
  'eq.officer': OfficerForm,
  'eq.opening': OpeningOfficerForm,
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
  'pur.po': PoForm,
  'pur.rr': RrForm,
  'jo.opening': OpeningJobOrderForm,
  'tax.opening': OpeningWithholdingForm,
  'tax.payable.opening': OpeningPayableForm,
  'tax.it_provision': YearEndTaxForm,
  'tax.it_settlement': YearEndTaxForm,
};

export const VIEWS: Record<string, ViewParts> = { 'jo.job_order': jobOrderView, 'jo.opening': openingJobOrderView, 'qs.sale': quickSaleView, 'pay.run': runView, 'pay.release': releaseView, 'pay.thirteenth': thirteenthView, 'ca.advance': advanceView, 'stat.remittance': remittanceView, 'cash.count': cashCountView, 'cash.bank_adj': bankAdjustmentView, 'ap.bill': billView, 'ap.payment': paymentView, 'ap.advance': supplierAdvanceView, 'ap.advance_return': advanceReturnView, 'loan.loan': loanView, 'loan.opening': loanView, 'inv.count': inventoryCountView,
  'pur.po': purchaseOrderView, 'pur.rr': receivingReportView,
  'col.cwt_only': cwtOnlyView, 'col.forfeit': forfeitView, 'col.credit_memo': creditMemoView, 'col.write_off': writeOffView };
