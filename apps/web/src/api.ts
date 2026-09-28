/**
 * The only way the web app talks to the server: same origin, JSON, the session cookie, and only the
 * routes listed in AGENTS.md. Changes carry X-CSRF-Token; recording carries an Idempotency-Key.
 * The CSRF token lives in memory only. Nothing is kept in browser storage (NR-11).
 */
import type { Issue } from '@moonproject/shared';

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

export interface Me { userId: string; username: string; displayName: string; roles: string[]; permissions: string[]; mustChangePassword: boolean; csrfToken: string }
export interface AuditLogRow { seq: number; at: string; userId: string | null; userName: string | null; action: string; entityType: string; entityId: string | null; data: Record<string, unknown> }
export interface AuditLogPage { rows: AuditLogRow[]; nextBefore: number | null }
export interface IntegrityReport { audit: { ok: boolean; brokenAt: number | null; count: number; newestAt: string | null; message: string }; checks: { id: string; name: string; ok: boolean; problems: string[]; message: string }[] }
/** Public certificate details returned to a signed-in user; no private key is sent. */
export interface CertInfo { fingerprint256: string; fingerprint1: string; notAfter: string; ips: string[]; dnsNames: string[] }
export interface CompanyProfile { registeredName: string; tradeName: string; tin: string; registeredAddress: string; isVatRegistered: boolean; version: number; supersededAt?: string }
export interface JsonSchema { type?: string; title?: string; enum?: unknown[]; const?: unknown; anyOf?: JsonSchema[]; maxLength?: number; properties?: Record<string, JsonSchema>; required?: string[] }
export interface DocTypeInfo { key: string; module: string; title: string; dating: 'system' | 'accountant_may_backdate'; canCreate: boolean; canPost: boolean; canCancel: boolean; inputJsonSchema: JsonSchema }
export type PrintVariant = 'document' | 'job_ticket';
export interface PrintableType { key: string; variants: PrintVariant[] }
export interface DocHeader {
  id: string; number: string; businessDate: string; status: 'posted' | 'cancelled'; totalCents: number; summary: string; postedAt: string;
  cancelledAt: string | null; cancelReason: string | null; replacesId: string | null; replacedById: string | null;
}
/** Read-only display of lines the server built. Declared this way so the money-rule tripwire (tests/house-rules) stays exact. */
export type JournalLine = { accountCode: string; accountName: string } & Record<'debitCents' | 'creditCents', number>;
export interface Journal { id: string; number: string; businessDate: string; postingKind: 'original' | 'reversal'; memo: string; lines: JournalLine[] }
/** `journals` and `journal` are present only for users with acc.journal.view. `doc` is the stored document, as the server built it. */
export interface DocDetail { header: DocHeader; input: Record<string, unknown>; doc?: Record<string, unknown>; journals?: Journal[] }
/** `doc` is the document as the server worked it out (the payroll form shows its lines). */
export interface Preview { totalCents: number; summary: string; issues: Issue[]; journal?: JournalLine[] | null; doc?: unknown }
export interface PostResult { id: string; number: string; totalCents: number; warnings: Issue[] }
export interface Draft { id: string; docType: string; payload: { values?: Record<string, string> }; version: number; updatedAt: string }
export interface CashPlace { id: number; name: string; balanceCents: number | null }
export interface DashItem { id: string; label: string; href?: string; detail?: string; amountCents?: number }
export interface DashWidget { key: string; title: string; items?: DashItem[]; amountCents?: number; href?: string }
export interface DashHomeData { role: string; asOf: string; widgets: DashWidget[] }
export interface DashNotification extends DashItem { kind: string; read: boolean }
export type CalKind = 'event' | 'job_due' | 'release' | 'holiday' | 'tax' | 'customer_birthday' | 'employee_birthday';
export interface CalItem { id: string; date: string; kind: CalKind; title: string; href: string; time?: string | null; notes?: string | null; rush?: boolean }
export interface CalEvent { id: string; eventId: string; seq: number; action: 'create' | 'move' | 'cancel'; title: string; date: string; time: string | null; customerId: string | null; jobOrderId: string | null; notes: string | null; reason: string | null; createdAt: string; createdBy: string }
export interface CalEventInput { title: string; date: string; time?: string | null; customerId?: string | null; jobOrderId?: string | null; notes?: string | null }
export interface CashAccount extends CashPlace { code: string; kind: 'cash' | 'checks' | 'bank' | 'ewallet'; isActive: boolean; accountNo: string | null; encoderSeesBalance?: boolean; version?: number }
export interface CashBook { place: Pick<CashAccount, 'id' | 'code' | 'name' | 'kind'>; from: string; to: string; openingCents: number; closingCents: number; lines: { date: string; journalNumber: string; documentId: string | null; documentNumber: string | null; docType: string | null; memo: string; inCents: number; outCents: number; balanceCents: number }[] }
export interface CustomerRow { id: string; code: string; display_name: string; is_active: number }
/** GET /api/col/customers/:id/open-items: what a customer can pay on. */
export interface OpenItems {
  customerId: string; customerName: string; unappliedCents: number;
  jobOrders: { id: string; number: string; dueDate: string; totalCents: number; balanceDueCents: number; depositsHeldCents: number }[];
  quickSales: { id: string; number: string; invoiceNumber: string; businessDate: string; totalCents: number; openCents: number }[];
}
/** GET /api/col/customers/:id/refundable: money held that can be paid back. */
export interface Refundable { customerId: string; customerName: string; unappliedCents: number; jobOrders: { id: string; number: string; status: 'posted' | 'cancelled'; depositsHeldCents: number }[] }
/** GET /api/col/customers/:id/transferable: money held that can be moved (D5 DEP-XFER), and the JOs it can go to. */
export interface Transferable {
  customerId: string; customerName: string; unappliedCents: number;
  held: { id: string; number: string; status: 'posted' | 'cancelled'; depositsHeldCents: number; replacement: { id: string; number: string } | null }[];
  jobOrders: { id: string; number: string; dueDate: string; totalCents: number; balanceDueCents: number }[];
}
/** GET /api/jo/orders/:id/status, the parts the JO view shows: all derived on the server (NR-2). */
export interface JoStatus {
  stageLabel: string;
  money: { totalCents: number; invoicedCents: number; receivableCents: number; depositsHeldCents: number; balanceDueCents: number; collectedCents: number };
}
type Checked = { summary: string; issues: Issue[]; journal?: JournalLine[] | null };
/** POST /api/qs/sales/preview: the sale, "write these on the booklet" and its payment (null while the sale has errors). */
export interface QsPreview { totalCents: number; booklet: { vatableSalesCents: number; vatCents: number; discountCents: number; totalCents: number }; sale: Checked; payment: Checked | null }
export interface QsBody { sale: unknown; payment: unknown }
export interface QsRecorded { sale: PostResult; payment: PostResult }
export interface SalePayment { id: string; number: string; status: 'posted' | 'cancelled'; crNumber: string; totalCents: number }
/** Production (PRD) and piece rates (RATE). */
export interface PrdStep { id: number; code: string; name: string; seq: number; payBasis: 'piece' | 'daily' | 'piece_or_daily'; isActive: boolean; version: number }
export interface PrdCatalogue { steps: PrdStep[]; templates: { id: number; code: string; name: string; stepIds: number[] }[]; garmentTypes: string[]; complexities: string[] }
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'not_needed';
export interface BoardCard {
  jobOrderId: string; number: string; customerName: string; dueDate: string; priority: 'normal' | 'rush'; stage: string; lineNo: number; description: string;
  qty: number; releasedQty: number; garmentType: string | null; complexity: string | null; templateId: number | null; currentStepId: number | null; ready: boolean;
  steps: { stepId: number; status: StepStatus; pieces: number; reworkPieces: number }[] | null;
}
export interface PrdJob {
  jobOrder: { id: string; number: string; status: 'posted' | 'cancelled'; customerName: string; dueDate: string; priority: string; stage: string };
  lines: { lineNo: number; description: string; qty: number; releasedQty: number; setup: { templateId: number | null; garmentType: string; complexity: string; stepIds: number[] } | null;
    route: (PrdStep & { status: StepStatus; pieces: number; reworkPieces: number; availablePieces: number })[] | null }[];
}
export interface PrdSetup { templateId?: number; stepIds: number[]; garmentType: string; complexity: string }
export interface Worker { id: string; code: string; name: string }
export interface PieceRate { id: number; garmentType: string; stepCode: string; complexity: string; rateCents: number; effectiveFrom: string; reason: string; createdAt: string }
export interface RateTable { asOf: string; current: PieceRate[]; history: PieceRate[]; garmentTypes: string[] }
/** Employees and time (EMP). Government IDs arrive masked without emp.view_ids; pay history is null without pay.view_rates. */
export interface EmployeeRow { id: string; code: string; fullName: string; position: string | null; department: string | null; costCentre: string; isActive: boolean; hireDate: string; separatedOn: string | null }
export interface Statutory { sss: boolean; phic: boolean; hdmf: boolean; wtax: boolean }
export interface EmployeeRecord extends EmployeeRow {
  separationReason: string | null; birthday: string | null; statutory: Statutory; statutoryOffReason: string | null;
  sssNo: string | null; phicNo: string | null; hdmfNo: string | null; tin: string | null;
  payoutMethod: 'cash' | 'bank' | 'gcash'; payoutAccount: string | null; emergencyContact: string | null; version: number;
}
export interface PayProfile {
  id: number; effectiveFrom: string; payType: 'daily' | 'piece' | 'monthly' | 'mixed'; dailyRateCents: number | null; monthlyRateCents: number | null;
  payGroup: 'WEEKLY_PIECE' | 'SEMI_DAILY' | 'SEMI_MONTHLY'; workweekDays: 5 | 6; isMwe: boolean; reason: string; createdAt: string;
}
export interface EmployeeDetail {
  employee: EmployeeRecord;
  pay: Pick<PayProfile, 'payType' | 'payGroup' | 'workweekDays' | 'effectiveFrom'> | null;
  payHistory: PayProfile[] | null;
  sil: { year: number; eligibleFrom: string; daysPerYear: number; used: number; left: number };
}
export type AttendanceStatus = 'present' | 'half_day' | 'absent' | 'rest_day' | 'leave' | 'unpaid_leave' | 'holiday_off' | 'holiday_worked' | 'rest_day_worked';
export interface AttendanceDay { employeeId: string; date: string; status: AttendanceStatus; otMinutes: number; note: string | null }
export interface Holiday { id: number; date: string; name: string; kind: 'regular' | 'special'; source: string; isActive: boolean; deactivatedReason: string | null }
export interface AttendanceGrid {
  from: string; to: string; today: string; statuses: AttendanceStatus[]; holidays: Holiday[];
  employees: { id: string; code: string; fullName: string; hireDate: string; separatedOn: string | null }[]; days: AttendanceDay[];
}
export type AttendanceSave = { employeeId: string; date: string; status: AttendanceStatus; otMinutes?: number; note?: string };
/** Payroll (PAY) and cash advances (CA): every figure is worked out by the server. */
export type PayGroup = 'WEEKLY_PIECE' | 'SEMI_DAILY' | 'SEMI_MONTHLY';
export interface PayLine { lineNo: number; kind: string; description: string; qty: number; rateCents: number; multiplierBp: number; amountCents: number; jobOrderId?: string; reason?: string }
export interface PayEmployee {
  employeeId: string; code: string; name: string; costCentre: string; payType: string; isMwe: boolean; lines: PayLine[]; grossCents: number; pieceCents: number; taxableCents: number;
  sssMscCents: number; sssEeCents: number; sssErCents: number; sssEcCents: number; phicEeCents: number; phicErCents: number; hdmfEeCents: number; hdmfErCents: number;
  eeShortCents: number; wtaxCents: number; caCents: number; caOverrideCents: number | null; thirteenthCents: number; netCents: number;
}
export interface ManualPayLine { employeeId: string; kind: 'allowance' | 'adjustment'; amountCents: number; reason: string }
export interface PayRunInput { payGroup: PayGroup; periodStart: string; lines?: ManualPayLine[]; advances?: { employeeId: string; amountCents: number }[]; skip?: { employeeId: string; reason: string }[] }
export interface PayRunDoc extends PayRunInput { periodEnd: string; contributionMonth: string; employees: PayEmployee[]; grossCents: number; netCents: number }
/** `bookOn`: the date to give the run (the period's last day, for someone who may backdate), or null for today. */
export interface PayPeriod { periodStart: string; periodEnd: string; employees: number; recorded: { id: string; number: string } | null; bookOn: string | null }
export interface Payslips {
  number: string; status: 'posted' | 'cancelled'; payDate: string; payGroup: PayGroup; periodStart: string; periodEnd: string; contributionMonth: string;
  employees: (PayEmployee & { caBalanceAfterCents: number; ytd: { grossCents: number; wtaxCents: number } })[];
}
export interface RunToRelease { id: string; number: string; payGroup: PayGroup; periodStart: string; periodEnd: string; dueCents: number }
export interface ReleaseRow { employeeId: string; name: string; netCents: number; releasedBy: string | null }
export interface CaStatus {
  employeeId: string; name: string; active: boolean; outstandingCents: number; installmentCents: number; open: { documentId: string; number: string; amountCents: number; installmentCents: number; openCents: number }[];
  /** Repayments (CAR-) and write-offs (CAW-) still recorded, oldest first, with what was owed right after each. */
  settlements: { documentId: string; number: string; kind: 'repayment' | 'writeoff'; businessDate: string; amountCents: number; balanceAfterCents: number }[];
}
export interface CaOwing { employeeId: string; name: string; owedCents: number }
export interface ActiveEmployee { id: string; code: string; name: string; costCentre: string }
/** Statutory (STAT): the month's lists, the 1601-C worksheet and the remittance check, worked out by the server. */
export type Scheme = 'SSS' | 'PHIC' | 'HDMF' | 'WTAX';
export interface SchemeCheck {
  scheme: Scheme; label: string; recordedCents: number; remittedCents: number; balanceCents: number; remittances: { id: string; number: string; amountCents: number }[];
  cancelledAfter: { id: string; number: string; cancelledAt: string }[]; overRemitted: { employeeId: string; name: string; cents: number }[];
}
interface StatPerson { employeeId: string; code: string; name: string; idNo: string | null }
export interface StatMonth {
  month: string;
  sss: { rows: (StatPerson & { mscCents: number; mpfMscCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number })[]; totalCents: number };
  phic: { rows: (StatPerson & { basisCents: number; eeCents: number; erCents: number; totalCents: number })[]; totalCents: number };
  hdmf: { rows: (StatPerson & { compensationCents: number; eeCents: number; erCents: number; totalCents: number })[]; totalCents: number };
  tax: {
    employees: number; totalCompensationCents: number; mweBasicCents: number; mwePremiumCents: number; thirteenthMonthCents: number; deMinimisCents: number; eeSharesCents: number;
    otherNonTaxableCents: number; nonTaxableCents: number; taxableCents: number; noTaxWithheldCents: number; taxWithheldCents: number;
    rows: (StatPerson & { isMwe: boolean; grossCents: number; nonTaxableCents: number; taxableCents: number; taxCents: number })[];
  };
  check: SchemeCheck[];
  notDeducted: { employeeId: string; name: string; cents: number }[];
}
export type BookletKind = 'SALES_INVOICE' | 'CR';
export interface Booklet { id: string; kind: BookletKind; atpNo: string; printer: string | null; serialFrom: number; serialTo: number; receivedOn: string; note: string | null; isActive: boolean; version: number }
export interface BookletUsage {
  booklet: Booklet; usedCount: number; cancelledCount: number; lastUsed: number | null; leftCount: number;
  skipped: number[]; skippedCount: number;
  used: { n: number; number: string; status: 'posted' | 'cancelled'; documentId: string | null; docType: string | null }[];
}
export interface BookletInput { kind: BookletKind; atpNo: string; printer?: string; serialFrom: number; serialTo: number; receivedOn: string; note?: string }
export interface RemittanceInput { scheme: Scheme; month: string; cashPlaceId: number; amountCents: number; penaltyCents?: number; reference: string; note?: string }
/** Tax registers (TAX): one row per journal on the account, read from the ledger. A cancel is its own negative row (posting 'reversal'). */
export interface TaxJournalRef {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal'; documentId: string | null; docType: string | null; docTitle: string;
  documentNumber: string | null; documentStatus: 'posted' | 'cancelled' | null;
}
export interface TaxRegisterRow extends TaxJournalRef { formNumber: string | null; customerId: string | null; customerName: string; tin: string | null }
/** A purchases or EWT register row: the supplier on the ledger lines ("… and others" on a JV naming several), or a one-off payee. */
export interface TaxSupplierRow extends TaxJournalRef { supplierId: string | null; supplierName: string; tin: string | null }
export type PurchaseClass = 'capital_goods' | 'goods' | 'services';
export interface PurchaseSums { netCents: number; vatCents: number; totalCents: number }
/** GET /api/tax/registers/purchases: a bill with lines of two classes gives two rows with the same journal; `purchaseClass` null = to classify. */
export interface PurchasesRegister {
  from: string; to: string; rows: (TaxSupplierRow & PurchaseSums & { supplierInvoiceNo: string | null; purchaseClass: PurchaseClass | null })[];
  totals: PurchaseSums; byClass: Record<PurchaseClass | 'unclassified', PurchaseSums>; glVatCents: number;
}
/** An EWT class and its ATC; `atc` null with `atcChoices` = the ATC to confirm (individual or company). */
export interface EwtAtc { ewtClass: string | null; atc: string | null; atcChoices: string[] }
export interface EwtRegister {
  from: string; to: string; rows: (TaxSupplierRow & EwtAtc & { baseCents: number | null; rateBp: number | null; ewtCents: number })[];
  totals: { baseCents: number; ewtCents: number }; glEwtCents: number; atcToConfirmCount: number;
}
/** GET /api/tax/2307-to-issue: one line per supplier and ATC; `months` are "2026-07", "2026-08", "2026-09". */
export interface CertificatesToIssue {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string; months: string[];
  lines: (EwtAtc & { supplierId: string | null; supplierName: string; tin: string | null; months: { month: string; baseCents: number; ewtCents: number }[]; baseCents: number; ewtCents: number })[];
  totals: { baseCents: number; ewtCents: number };
}
/** GET /api/tax/2550q: each item of the return (amount null where the form has none) and the checks before filing. */
export interface WorksheetCheck { code: string; level: 'error' | 'warning' | 'info'; message: string }
export interface VatWorksheet {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string; returnDue: string; close: { documentId: string; number: string; date: string } | null;
  lines: { key: string; label: string; amountCents: number | null; taxCents: number }[]; checks: WorksheetCheck[];
}
export interface SalesRegister { from: string; to: string; rows: (TaxRegisterRow & { netCents: number; vatCents: number; totalCents: number })[]; totals: { netCents: number; vatCents: number; totalCents: number }; glVatCents: number }
export interface WithholdingRegister {
  from: string; to: string; rows: (TaxRegisterRow & { atc: string | null; certificate: 'pending' | 'received' | null; cwtCents: number; vatWithheldCents: number })[];
  totals: { cwtCents: number; vatWithheldCents: number }; glCwtCents: number; glVatWithheldCents: number; pendingCount: number;
}
export interface TaxDeadline { form: string; title: string; period: string; periodLabel: string; periodStart: string; periodEnd: string; statutoryDate: string; dueDate: string }
export interface VatSummary {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string; returnDue: string; outputVatCents: number; inputVatCents: number; vatWithheldCents: number;
  carryOverCents: number; vatWithheldPendingCents: number; payableCents: number; carryForwardCents: number;
  /** Output and input VAT dated in earlier quarters but not closed with them, included above. */
  earlierOutputVatCents: number; earlierInputVatCents: number;
  /** The quarter's posted VAT close (VATC-), if any. */
  close: { documentId: string; number: string; date: string } | null;
}
/** Money out (AP, EXP, EQ). Suppliers and supplies are PUR's own rows (GET /api/pur/suppliers, /api/pur/supplies). */
export interface SupplierRow { id: string; name: string; tin: string | null; is_vat_registered: number; ewt_class: string | null; payment_terms_days: number | null }
export interface SupplyRow { id: string; name: string; category: 'materials' | 'ready_made' }
/** GET /api/inv/count-sheet?format=json: the active supplies of a category and the cost each is valued at on the count date. */
export interface SheetSupply {
  supplyId: string; name: string; unit: 'yard' | 'meter' | 'kg' | 'roll' | 'pc'; milliUnits: boolean;
  defaultCostCents: number; costSource: 'bill' | 'po' | 'catalogue'; costSourceNumber: string | null;
}
export interface CountSheet { category: 'materials' | 'ready_made'; date: string; supplies: SheetSupply[] }
export interface ExpCategory { id: number; code: string; name: string; defaultEwtClass: string | null }
/** GET /api/ap/suppliers/:id: a supplier's bills, with what is still owed on each (from the ledger). */
export interface ApLedger {
  supplierId: string; supplierName: string; balanceCents: number;
  bills: { id: string; number: string; status: 'posted' | 'cancelled'; supplierInvoiceNo: string; dueDate: string; payableCents: number; owedCents: number }[];
}
/** GET /api/acc/opening, what an opening document's form needs: the cut-over date it is dated, and the close once done. */
export type OpeningStatus = Pick<OpeningState, 'cutoverDate' | 'closed'>;
export interface EqPerson { id: string; name: string; isStockholder: boolean; isOfficer: boolean; position: string | null }
export interface Setting { key: string; label: string; current: unknown }

/** Chart of accounts (ACC), for pickers. `partyType`: the subledger a line on the account names; 'free' takes any, or none. */
export type PartyType = 'customer' | 'supplier' | 'employee' | 'officer' | 'stockholder' | 'loan' | 'asset' | 'free';
export interface Account { id: number; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; partyType: PartyType | null; isHeader: boolean; isCashPlace: boolean; isReserved: boolean; isActive: boolean }
/** GET /api/pur/suppliers (the same rows as SupplierRow). */
export type Supplier = SupplierRow;
/** The loan register (LOAN): what is owed comes from the ledger; `nextDue` is null once paid off or cancelled. */
export interface LoanRow {
  id: string; number: string; status: 'posted' | 'cancelled'; lender: string; kind: 'loan' | 'equipment'; principalCents: number; balanceCents: number; instalments: number;
  nextDue: { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number } | null;
}
/** An FA- purchase whose financed part no loan has taken over yet. */
export interface FinancedPurchase { id: string; number: string; date: string; description: string; supplierName: string; lender: string; financedCents: number }
export interface AssetClass { code: string; name: string; defaultLifeMonths: number | null }
export interface AssetRow { id: string; number: string; description: string; className: string; status: 'in service' | 'fully depreciated' | 'disposed' | 'cancelled' }
/** Backups (BAK). The status's `runs` are the server's bak_runs rows as stored. */
export type BackupTier = 'snapshot' | 'daily' | 'monthly' | 'yearly';
export type BackupSource = 'local' | 'offsite';
export interface BackupSettings { backupDir: string; offsiteDir: string | null; recipients: string[]; version: number }
export interface BackupRun {
  id: string; started_at: string; finished_at: string; reason: 'schedule' | 'manual' | 'pre_update'; tier: BackupTier; status: 'ok' | 'failed';
  file: string | null; bytes: number | null; offsite: number; error: string | null;
}
export interface BackupStatus {
  settings: BackupSettings; issues: Issue[]; lastOk: { at: string; file: string; tier: BackupTier } | null; stale: boolean; kept: Record<BackupTier, number>;
  lastOffsiteAt: string | null; lastDrillAt: string | null; usb: Record<'A' | 'B', string | null>; pendingRestore: { id: string; file: string; requestedAt: string } | null; runs: BackupRun[];
}
export interface BackupMade { file: string; tier: BackupTier; bytes: number; offsite: boolean; offsiteError: string | null }
export interface BackupFile { source: BackupSource; file: string; at: string; tier: BackupTier; bytes: number }
/** What a backup holds, found by opening it with a recovery key. A restore check adds `stagedId` and the live data's audit head. */
export interface BackupCheck {
  file: string; madeAt: string | null; tier: BackupTier | null; sidecar: 'matches' | 'missing'; toApply: string[]; audit: { seq: number } | null;
  lastAuditAt: string | null; trialBalance: { totalDebitCents: number; totalCreditCents: number }; lastBusinessDate: string | null; postedDocuments: number;
  drill?: 'passed'; stagedId?: string; live?: { auditSeq: number; lastAuditAt: string };
}
/** GET /api/acc/opening: the cut-over date, 3900 (debit-positive), the trial balance on the cut-over date, every opening document, the control checks and the close. */
export interface OpeningState {
  cutoverDate: string | null;
  openingEquityCents: number;
  trialBalance: { asOf: string; totalDebitCents: number; totalCreditCents: number; balanced: boolean } | null;
  documents: { id: string; docType: string; number: string; businessDate: string; status: 'posted' | 'cancelled'; totalCents: number; summary: string }[];
  checks: { code: string; name: string; partyType: string; controlCents: number; partiesCents: number; ok: boolean }[];
  /** Accounts an OB- line may open. */
  accounts: { id: number; code: string; name: string; isCashPlace: boolean; needsStockholder: boolean }[];
  closed: { cutoverDate: string; closedAt: string; closedBy: string; closedByName: string; totalDebitCents: number; totalCreditCents: number } | null;
}
/** BIR payments (BIRP-): the return, and the posted payments a worksheet counts. */
export type BirForm = '2550Q' | '0619-E' | '1601-EQ';
export interface BirPaymentLine { id: string; number: string; date: string; period: string; reference: string; amountCents: number; penaltyCents: number }
/** The EWT of a period by ATC (per EWT class while the ATC is to confirm). */
export type EwtAtcLine = EwtAtc & { baseCents: number; ewtCents: number };
/** GET /api/tax/0619e?month=: month 1 or 2 of a quarter. */
export interface EwtMonthWorksheet {
  month: string; label: string; from: string; to: string; returnDue: string; atcs: EwtAtcLine[]; totals: { baseCents: number; ewtCents: number };
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number; checks: WorksheetCheck[];
}
/** GET /api/tax/1601eq?year&quarter=: the quarter less its 0619-E payments, and the QAP. */
export interface EwtQuarterWorksheet {
  year: number; quarter: 1 | 2 | 3 | 4; period: string; from: string; to: string; months: string[]; returnDue: string; atcs: EwtAtcLine[]; totals: { baseCents: number; ewtCents: number };
  remittances: { month: string; label: string; payments: BirPaymentLine[]; paidCents: number }[]; remittedCents: number;
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number;
  qap: (EwtAtc & { supplierId: string | null; tin: string | null; registeredName: string; baseCents: number; rateBp: number | null; ewtCents: number })[];
  checks: WorksheetCheck[];
}
/** A tax register's URL; with &format=csv the same URL downloads it for Excel. */
export const taxRegisterPath = (register: 'sales' | 'withholding-received' | 'purchases' | 'ewt', from: string, to: string) => `/api/tax/registers/${register}?${new URLSearchParams({ from, to })}`;
/** A quarter's tax report URL; with &format=csv the same URL downloads it for Excel. */
export const taxQuarterPath = (report: '2307-to-issue' | '2550q' | '1601eq', year: number, quarter: number) => `/api/tax/${report}?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}`;
/** The 0619-E worksheet's URL (month like 2026-07); with &format=csv it downloads for Excel. */
export const ewtMonthPath = (month: string) => `/api/tax/0619e?${new URLSearchParams({ month })}`;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function createApi(fetchImpl: Fetch = (url, init) => fetch(url, init)) {
  let csrf = '';
  let onSignedOut: (e: ApiError) => void = () => {};

  async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    if (method !== 'GET') headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    } catch {
      throw new ApiError('OFFLINE', 'Cannot reach the server. Check the connection and try again. Nothing was recorded.', 0);
    }
    const data = (await res.json().catch(() => null)) as { code?: string; message?: string; details?: unknown } | null;
    if (res.ok) return data as T;
    const e = new ApiError(data?.code ?? `HTTP_${res.status}`, data?.message ?? 'Something went wrong. Please try again.', res.status, data?.details);
    if (e.code === 'AUTH_REQUIRED' || e.code === 'PASSWORD_CHANGE_REQUIRED') onSignedOut(e);
    throw e;
  }
  const keep = <T extends { csrfToken: string }>(r: T) => ((csrf = r.csrfToken), r);
  const doc = (type: string, rest = '') => `/api/docs/${encodeURIComponent(type)}${rest}`;
  const one = (type: string, id: string, rest = '') => doc(type, `/${encodeURIComponent(id)}${rest}`);
  const idem = (key: string) => ({ 'idempotency-key': key });
  const customer = (id: string, rest: string) => `/api/col/customers/${encodeURIComponent(id)}/${rest}`;
  const qs = (id: string, rest: string) => `/api/qs/sales/${encodeURIComponent(id)}/${rest}`;
  const prdJob = (id: string, rest = '') => `/api/prd/jobs/${encodeURIComponent(id)}${rest}`;
  const emp = (id: string, rest = '') => `/api/emp/employees/${encodeURIComponent(id)}${rest}`;
  const version = (v: number) => ({ 'if-match': String(v) });

  return {
    /** Called when the session ended or a new password is required, so the app can show the right screen. */
    onSignedOut: (fn: (e: ApiError) => void) => void (onSignedOut = fn),
    setupStatus: () => call<{ needsFirstOwner: boolean }>('GET', '/api/setup/status'),
    firstOwner: (b: { username: string; displayName: string; password: string }) => call<{ csrfToken: string }>('POST', '/api/setup/first-owner', b).then(keep),
    login: (username: string, password: string) => call<{ csrfToken: string }>('POST', '/api/auth/login', { username, password }).then(keep),
    me: () => call<Me>('GET', '/api/auth/me').then(keep),
    logout: () => call<unknown>('POST', '/api/auth/logout'),
    changePassword: (currentPassword: string, newPassword: string) => call<unknown>('POST', '/api/auth/change-password', { currentPassword, newPassword }),
    /** The password again, for changes that need a fresh one (good for 5 minutes). */
    stepUp: (password: string) => call<{ ok: true }>('POST', '/api/auth/step-up', { password }),
    companyProfile: () => call<CompanyProfile>('GET', '/api/prt/company-profile'),
    companyProfileHistory: () => call<CompanyProfile[]>('GET', '/api/prt/company-profile/history'),
    saveCompanyProfile: (value: Omit<CompanyProfile, 'version' | 'supersededAt'>, version: number) => call<CompanyProfile>('PUT', '/api/prt/company-profile', value, { 'if-match': String(version) }),
    printableTypes: () => call<PrintableType[]>('GET', '/api/prt/printable-types'),
    printDocument: (type: string, id: string, variant: PrintVariant = 'document') =>
      call<{ html: string; copyNumber: number }>('POST', `/api/prt/print/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { variant }),
    health: () => call<{ serverTime: string }>('GET', '/api/health'),
    dashHome: () => call<DashHomeData>('GET', '/api/dash/home'),
    dashNotifications: () => call<DashNotification[]>('GET', '/api/dash/notifications'),
    dashRead: (id: string) => call<{ ok: true }>('POST', '/api/dash/notifications/read', { id }),
    calItems: (from: string, to: string) => call<CalItem[]>('GET', `/api/cal?${new URLSearchParams({ from, to })}`),
    calCreate: (body: CalEventInput) => call<CalEvent>('POST', '/api/cal/events', body),
    calMove: (id: string, date: string, time?: string | null) => call<CalEvent>('POST', `/api/cal/events/${encodeURIComponent(id)}/move`, { date, time }),
    calCancel: (id: string, reason: string) => call<CalEvent>('POST', `/api/cal/events/${encodeURIComponent(id)}/cancel`, { reason }),
    calHistory: (id: string) => call<CalEvent[]>('GET', `/api/cal/events/${encodeURIComponent(id)}/history`),
    shopCertificate: () => call<{ ca: CertInfo | null }>('GET', '/api/system/tls'),
    docTypes: () => call<DocTypeInfo[]>('GET', '/api/doc-types'),
    report: <T>(path: string) => call<T>('GET', `/api/rpt/${path}`),
    auditLog: (query: string) => call<AuditLogPage>('GET', `/api/aud/log?${query}`),
    auditUsers: () => call<{ id: string; name: string }[]>('GET', '/api/aud/users'),
    auditIntegrity: () => call<IntegrityReport>('GET', '/api/aud/integrity'),
    list: (type: string, q: { status?: string; before?: string; limit?: number } = {}) =>
      call<DocHeader[]>('GET', doc(type, `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`)),
    get: (type: string, id: string) => call<DocDetail>('GET', one(type, id)),
    /** `businessDate` only for a type that may be backdated, by someone allowed to (the payroll run's period end). */
    preview: (type: string, input: unknown, businessDate?: string) => call<Preview>('POST', doc(type, '/preview'), { input, ...(businessDate ? { businessDate } : {}) }),
    post: (type: string, input: unknown, expectedTotalCents: number, key: string, businessDate?: string) =>
      call<PostResult>('POST', doc(type, '/post'), { input, expectedTotalCents, ...(businessDate ? { businessDate } : {}) }, idem(key)),
    cancel: (type: string, id: string, reason: string, key: string) => call<unknown>('POST', one(type, id, '/cancel'), { reason }, idem(key)),
    reissue: (type: string, id: string, input: unknown, expectedTotalCents: number, reason: string, key: string, businessDate?: string) =>
      call<PostResult>('POST', one(type, id, '/reissue'), { input, expectedTotalCents, reason, ...(businessDate ? { businessDate } : {}) }, idem(key)),
    drafts: (type: string) => call<Draft[]>('GET', `/api/drafts?type=${encodeURIComponent(type)}`),
    createDraft: (docType: string, payload: Draft['payload']) => call<{ id: string; version: number }>('POST', '/api/drafts', { docType, payload }),
    saveDraft: (id: string, version: number, payload: Draft['payload']) =>
      call<{ id: string; version: number }>('PUT', `/api/drafts/${encodeURIComponent(id)}`, { payload }, { 'if-match': String(version) }),
    discardDraft: (id: string) => call<unknown>('POST', `/api/drafts/${encodeURIComponent(id)}/discard`),
    cashPlaces: () => call<CashPlace[]>('GET', '/api/cash/places'),
    cashAccounts: () => call<CashAccount[]>('GET', '/api/cash/places'),
    addCashPlace: (body: { name: string; kind: CashAccount['kind']; accountNo?: string; encoderSeesBalance: boolean }) => call<CashAccount>('POST', '/api/cash/places', body),
    updateCashPlace: (id: number, version: number, body: { accountNo?: string | null; encoderSeesBalance?: boolean }) =>
      call<CashAccount>('PUT', `/api/cash/places/${id}/settings`, body, { 'if-match': String(version) }),
    cashBook: (id: number, from: string, to: string) => call<CashBook>('GET', `/api/cash/places/${id}/book?${new URLSearchParams({ from, to })}`),
    customer: (id: string) => call<CustomerRow>('GET', `/api/cus/customers/${encodeURIComponent(id)}`),
    customers: (search: string) => call<CustomerRow[]>('GET', `/api/cus/customers?${new URLSearchParams({ search, limit: '10' })}`),
    openItems: (customerId: string) => call<OpenItems>('GET', customer(customerId, 'open-items')),
    refundable: (customerId: string) => call<Refundable>('GET', customer(customerId, 'refundable')),
    transferable: (customerId: string) => call<Transferable>('GET', customer(customerId, 'transferable')),
    joStatus: (id: string) => call<JoStatus>('GET', `/api/jo/orders/${encodeURIComponent(id)}/status`),
    qsPreview: (b: QsBody) => call<QsPreview>('POST', '/api/qs/sales/preview', b),
    qsRecord: (b: QsBody, expectedTotalCents: number, key: string) => call<QsRecorded>('POST', '/api/qs/sales', { ...b, expectedTotalCents }, idem(key)),
    qsReissue: (id: string, b: QsBody, expectedTotalCents: number, reason: string, key: string) =>
      call<QsRecorded>('POST', qs(id, 'reissue'), { ...b, expectedTotalCents, reason }, idem(key)),
    qsCancel: (id: string, reason: string, key: string) => call<unknown>('POST', qs(id, 'cancel'), { reason }, idem(key)),
    qsPayments: (id: string) => call<SalePayment[]>('GET', qs(id, 'payments')),
    prdCatalogue: () => call<PrdCatalogue>('GET', '/api/prd/catalogue'),
    prdBoard: () => call<BoardCard[]>('GET', '/api/prd/board'),
    prdJob: (id: string) => call<PrdJob>('GET', prdJob(id)),
    prdSetup: (jo: string, lineNo: number, body: PrdSetup) => call<unknown>('POST', prdJob(jo, `/lines/${lineNo}/setup`), body),
    prdStep: (jo: string, lineNo: number, stepId: number, action: 'complete' | 'not-needed' | 'reopen', reason?: string) =>
      call<unknown>('POST', prdJob(jo, `/lines/${lineNo}/steps/${stepId}/${action}`), reason ? { reason } : {}),
    prdWorkers: () => call<Worker[]>('GET', '/api/prd/workers'),
    rates: () => call<RateTable>('GET', '/api/rate/rates'),
    addRate: (body: Omit<PieceRate, 'id' | 'createdAt'>) => call<PieceRate>('POST', '/api/rate/rates', body),
    employees: (q: { search?: string; status?: 'active' | 'separated' | 'all' } = {}) =>
      call<EmployeeRow[]>('GET', `/api/emp/employees?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    employee: (id: string) => call<EmployeeDetail>('GET', emp(id)),
    addEmployee: (body: Record<string, unknown>) => call<EmployeeRecord>('POST', '/api/emp/employees', body),
    updateEmployee: (id: string, v: number, body: Record<string, unknown>) => call<EmployeeRecord>('PUT', emp(id), body, version(v)),
    separateEmployee: (id: string, v: number, body: { separatedOn: string; reason: string }) => call<EmployeeRecord>('POST', emp(id, '/separate'), body, version(v)),
    addPay: (id: string, body: Omit<PayProfile, 'id' | 'createdAt' | 'dailyRateCents' | 'monthlyRateCents'> & { dailyRateCents?: number; monthlyRateCents?: number }) =>
      call<PayProfile>('POST', emp(id, '/pay'), body),
    attendance: (from: string, to: string) => call<AttendanceGrid>('GET', `/api/emp/attendance?${new URLSearchParams({ from, to })}`),
    saveAttendance: (days: AttendanceSave[]) => call<{ saved: number; unchanged: number }>('POST', '/api/emp/attendance', { days }),
    /** Without a year: the server's current year. */
    holidays: (year?: number) => call<{ year: number; holidays: Holiday[] }>('GET', `/api/emp/holidays${year ? `?year=${year}` : ''}`),
    addHoliday: (body: { date: string; name: string; kind: 'regular' | 'special'; source: string }) => call<Holiday>('POST', '/api/emp/holidays', body),
    deactivateHoliday: (id: number, reason: string) => call<Holiday>('POST', `/api/emp/holidays/${id}/deactivate`, { reason }),
    activeEmployees: () => call<ActiveEmployee[]>('GET', '/api/emp/active'),
    payPeriods: (payGroup: PayGroup) => call<PayPeriod[]>('GET', `/api/pay/periods?payGroup=${payGroup}`),
    payslips: (runId: string) => call<Payslips>('GET', `/api/pay/runs/${encodeURIComponent(runId)}/payslips`),
    runsToRelease: () => call<RunToRelease[]>('GET', '/api/pay/runs/to-release'),
    releaseStatus: (runId: string) => call<ReleaseRow[]>('GET', `/api/pay/runs/${encodeURIComponent(runId)}/release-status`),
    caStatus: (employeeId: string) => call<CaStatus>('GET', `/api/ca/employees/${encodeURIComponent(employeeId)}`),
    /** Who owes on cash advances today, separated employees included. */
    caOwing: () => call<CaOwing[]>('GET', '/api/ca/employees'),
    /** The operating expense accounts a write-off may be charged to (ca.writeoff). */
    caWriteoffAccounts: () => call<{ id: number; code: string; name: string }[]>('GET', '/api/ca/writeoff-accounts'),
    statMonths: () => call<{ month: string; check: SchemeCheck[] }[]>('GET', '/api/stat/months'),
    statMonth: (month: string) => call<StatMonth>('GET', `/api/stat/months/${encodeURIComponent(month)}`),
    /** D6: what of a payroll run's month is already remitted (the warning before a cancel). */
    runRemitted: (runId: string) => call<{ month: string; remitted: { scheme: Scheme; label: string; numbers: string[] }[] }>('GET', `/api/stat/runs/${encodeURIComponent(runId)}/remitted`),
    settings: () => call<Setting[]>('GET', '/api/settings'),
    suppliers: () => call<SupplierRow[]>('GET', '/api/pur/suppliers'),
    supplies: () => call<SupplyRow[]>('GET', '/api/pur/supplies'),
    countSheet: (category: string, date: string) => call<CountSheet>('GET', `/api/inv/count-sheet?${new URLSearchParams({ category, date, format: 'json' })}`),
    expCategories: () => call<ExpCategory[]>('GET', '/api/exp/categories'),
    apLedger: (supplierId: string) => call<ApLedger>('GET', `/api/ap/suppliers/${encodeURIComponent(supplierId)}`),
    eqPeople: () => call<EqPerson[]>('GET', '/api/eq/people'),
    /** What an officer owes the company and is owed (needs eq.ledger.view). */
    officerBalances: (personId: string) => call<{ dueFromCents: number; dueToCents: number }>('GET', `/api/eq/people/${encodeURIComponent(personId)}/ledger`),
    booklets: () => call<BookletUsage[]>('GET', '/api/tax/booklets'),
    booklet: (id: string) => call<BookletUsage>('GET', `/api/tax/booklets/${encodeURIComponent(id)}`),
    registerBooklet: (body: BookletInput) => call<Booklet>('POST', '/api/tax/booklets', body),
    setBookletActive: (id: string, v: number, active: boolean, note: string) => call<Booklet>('POST', `/api/tax/booklets/${encodeURIComponent(id)}/${active ? 'activate' : 'retire'}`, { note }, version(v)),
    salesRegister: (from: string, to: string) => call<SalesRegister>('GET', taxRegisterPath('sales', from, to)),
    withholdingReceived: (from: string, to: string) => call<WithholdingRegister>('GET', taxRegisterPath('withholding-received', from, to)),
    purchasesRegister: (from: string, to: string) => call<PurchasesRegister>('GET', taxRegisterPath('purchases', from, to)),
    ewtRegister: (from: string, to: string) => call<EwtRegister>('GET', taxRegisterPath('ewt', from, to)),
    certificatesToIssue: (year: number, quarter: number) => call<CertificatesToIssue>('GET', taxQuarterPath('2307-to-issue', year, quarter)),
    vatWorksheet: (year: number, quarter: number) => call<VatWorksheet>('GET', taxQuarterPath('2550q', year, quarter)),
    ewtMonthWorksheet: (month: string) => call<EwtMonthWorksheet>('GET', ewtMonthPath(month)),
    ewtQuarterWorksheet: (year: number, quarter: number) => call<EwtQuarterWorksheet>('GET', taxQuarterPath('1601eq', year, quarter)),
    opening: () => call<OpeningState>('GET', '/api/acc/opening'),
    /** Both need a fresh password (step-up). */
    setCutoverDate: (date: string) => call<OpeningState>('POST', '/api/acc/opening/cutover-date', { date }),
    closeOpening: () => call<OpeningState>('POST', '/api/acc/opening/close', {}),
    taxCalendar: (from: string, to: string) => call<TaxDeadline[]>('GET', `/api/tax/calendar?${new URLSearchParams({ from, to })}`),
    accounts: () => call<Account[]>('GET', '/api/acc/accounts'),
    loans: (status?: 'posted' | 'cancelled') => call<LoanRow[]>('GET', `/api/loan/loans${status ? `?status=${status}` : ''}`),
    financedAssets: () => call<FinancedPurchase[]>('GET', '/api/loan/financed-assets'),
    assetClasses: () => call<AssetClass[]>('GET', '/api/fa/classes'),
    assets: () => call<AssetRow[]>('GET', '/api/fa/assets'),
    /** Without a year and quarter: the quarter of the server's date. */
    vatSummary: (year?: number, quarter?: number) =>
      call<VatSummary>('GET', `/api/tax/vat-summary${year ? `?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}` : ''}`),
    bakStatus: () => call<BackupStatus>('GET', '/api/bak/status'),
    bakRun: () => call<BackupMade>('POST', '/api/bak/run', {}),
    /** Only the two public keys (age1…) are sent; the secret keys stay in the browser. */
    bakSaveSettings: (v: number, body: Omit<BackupSettings, 'version'>) => call<BackupSettings>('PUT', '/api/bak/settings', body, version(v)),
    bakUsb: (drive: 'A' | 'B', dir: string) => call<{ drive: 'A' | 'B'; copied: number; onDrive: number }>('POST', '/api/bak/usb', { drive, dir }),
    bakBackups: () => call<BackupFile[]>('GET', '/api/bak/backups'),
    bakCheck: (b: { source: BackupSource; file: string; key: string; purpose: 'drill' | 'restore' }) => call<BackupCheck>('POST', '/api/bak/restore/check', b),
    bakApply: (stagedId: string) => call<{ file: string; restartNeeded: boolean; message: string }>('POST', '/api/bak/restore/apply', { stagedId }),
  };
}

export type Api = ReturnType<typeof createApi>;
export const api = createApi();

/** One key per thing the user confirmed, so a retried click never records twice. */
export const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();
