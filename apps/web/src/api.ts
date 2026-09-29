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
export interface GoLiveAnswer { id: number; answer: string; decidedBy: string; decidedOn: string; note: string; recordedAt: string; recordedByName: string }
export interface GoLiveDecision { id: string; group: 'accountant' | 'owner' | 'co-owners'; question: string; defaultAnswer: string; when: string; history: GoLiveAnswer[]; setting: null | { key: string; value: unknown; words: string; matches: boolean | null } }
export interface GoLiveRegister { asOf: string; open: number; rows: GoLiveDecision[] }
export interface AuditLogRow { seq: number; at: string; userId: string | null; userName: string | null; action: string; entityType: string; entityId: string | null; data: Record<string, unknown> }
export interface AuditLogPage { rows: AuditLogRow[]; nextBefore: number | null }
export interface IntegrityReport { audit: { ok: boolean; brokenAt: number | null; count: number; newestAt: string | null; message: string }; checks: { id: string; name: string; ok: boolean; problems: string[]; message: string }[] }
/** Public certificate details returned to a signed-in user; no private key is sent. */
/** System Health (PLAN C8), as GET /api/system/health reports it. */
export type HealthLight = 'green' | 'amber' | 'red' | 'grey';
export interface SystemHealth {
  at: string;
  overall: Exclude<HealthLight, 'grey'>;
  lights: { key: string; label: string; light: HealthLight; message: string }[];
  lastCheck: { at: string; reason: 'schedule' | 'button'; ok: boolean } | null;
}
/** The practice shop (PLAN C8), as GET /api/system/practice reports it. */
export interface PracticeStatus { state: 'off' | 'here' | 'preparing' | 'ready' | 'failed'; port: number | null; preparedAt: string | null; days: number | null; message: string | null }
export interface CertInfo { fingerprint256: string; fingerprint1: string; notAfter: string; ips: string[]; dnsNames: string[] }
/** Where a phone or another PC joins (GET /api/system/tls): `urls` is empty while the "Join this PC" page is not running. */
export interface JoinAddress { pcName: string; addresses: { ip: string; kind: 'lan' | 'vpn' }[]; port: number | null; urls: string[] }
export interface CompanyProfile { registeredName: string; tradeName: string; tin: string; registeredAddress: string; isVatRegistered: boolean; version: number; supersededAt?: string }
export interface JsonSchema { type?: string; format?: string; title?: string; enum?: unknown[]; const?: unknown; anyOf?: JsonSchema[]; maxLength?: number; properties?: Record<string, JsonSchema>; required?: string[] }
export interface DocTypeInfo { key: string; module: string; title: string; dating: 'system' | 'accountant_may_backdate'; canCreate: boolean; canPost: boolean; canCancel: boolean; inputJsonSchema: JsonSchema }
export type PrintVariant = 'document' | 'job_ticket' | 'thermal';
export interface PrintableType { key: string; variants: PrintVariant[] }
export interface PrinterTestPack { prints: { id: string; label: string; paper: string; html: string }[]; notBuilt: string[] }
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
export interface Draft { id: string; docType: string; payload: { values?: Record<string, string>; form?: unknown }; version: number; updatedAt: string }
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
/** Bank reconciliation (E10): one per bank and statement month. Every figure is worked out by the server. */
export interface ReconRow { id: string; bankId: number; bankName: string; month: string; status: 'open' | 'finished'; bankBalanceCents: number; createdAt: string; createdByName: string | null; finishedAt: string | null; finishedByName: string | null }
export interface ReconBookLine { journalLineId: number; date: string; journalNumber: string; documentNumber: string | null; memo: string; amountCents: number; matchNo: number | null; state: 'cleared' | 'outstanding' | 'later' }
export interface ReconStatementLine { id: number; date: string; description: string; amountCents: number; voided: boolean; matchNo: number | null }
export interface ReconReport {
  id: string; bankId: number; bankName: string; month: string; status: 'open' | 'finished'; finishedAt: string | null; reopenedAt: string | null; reopenReason: string | null;
  statementLines: ReconStatementLine[]; bookLines: ReconBookLine[]; bookBalanceCents: number; depositsInTransitCents: number; outstandingPaymentsCents: number;
  recordedAfterMonthCents: number; adjustedBookCents: number; bankBalanceCents: number; unmatchedStatementCount: number; unmatchedStatementCents: number; differenceCents: number;
}
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
/** GET /api/col/customers/:id/invoices: a customer's recorded invoices, for the credit memo, write-off and 2307 forms. */
export interface CustomerInvoices {
  customerId: string; customerName: string;
  invoices: { id: string; kind: 'jo.invoice_record' | 'qs.sale'; number: string; invoiceNumber: string; businessDate: string; jobOrderNumber: string | null;
    grossCents: number; vatCents: number; owedCents: number; creditableCents: number; writtenOff: string | null }[];
}
/** GET /api/col/customers/:id/forfeitable: job orders with a deposit held, for the deposit forfeit form. */
export interface Forfeitable {
  customerId: string; customerName: string;
  jobOrders: { id: string; number: string; status: 'posted' | 'cancelled'; depositsHeldCents: number; stageLabel: string; blocked: string | null }[];
}
/** GET /api/jo/orders/:id/status, the parts the JO view shows: all derived on the server (NR-2). */
export interface JoStatus {
  jobOrder: { id: string; number: string; docType: string; status: 'posted' | 'cancelled'; customerId: string; customerName: string; dueDate: string };
  stage: string;
  stageLabel: string;
  money: { totalCents: number; invoicedCents: number; receivableCents: number; depositsHeldCents: number; balanceDueCents: number; collectedCents: number; requiredDownpaymentCents: number };
  lines: { lineNo: number; description: string; qty: number; releasedQty: number; leftQty: number }[];
  awaitingInvoice: { id: string; number: string; businessDate: string; totalCents: number }[];
  depositVat: JoDepositVat;
  dpInvoices: DpInvoiceRow[];
}
/** The job order's downpayment VAT mode today (COL): its own once a downpayment fixed it, else the setting in force. `kept` is the server's sentence naming the document that fixed a mode other than the setting. */
export interface JoDepositVat { mode: 'A' | 'B' | 'C'; words: string; setting: 'A' | 'B' | 'C'; settingWords: string; lockedBy: string | null; kept: string | null }
/** A downpayment invoice (mode C) with the number printed on the booklet. */
export interface DpInvoiceRow { id: string; number: string; status: 'posted' | 'cancelled'; invoiceNumber: string; amountCents: number; vatCents: number }
/** GET /api/jo/orders/:id/dp-info: what the downpayment invoice form shows for a job order; `refusal` is the server's words when it takes no downpayment invoice. */
export interface DpInfo {
  jobOrder: { id: string; number: string; customerName: string; totalCents: number };
  requiredDownpaymentCents: number; dpInvoicedCents: number; notInvoicedCents: number; depositsHeldCents: number;
  depositVat: JoDepositVat; dpInvoices: DpInvoiceRow[]; refusal: string | null;
}
/** GET /api/jo/pick/orders: job orders to pick on the release form. */
export interface JoPick { id: string; number: string; customerName: string; dueDate: string; stageLabel: string; leftPieces: number; balanceDueCents: number }
/** GET /api/jo/pick/releases: releases to pick on the invoice record form, with the invoice already recorded for each. */
export interface ReleasePick {
  id: string; number: string; date: string; status: 'posted' | 'cancelled'; totalCents: number; jobOrderId: string; jobOrderNumber: string; customerName: string;
  invoice: { id: string; number: string; invoiceNumber: string } | null;
}
/** "Write these on the booklet" for a release (D4.4). */
export interface BookletFigures {
  vatRateBp: number; listCents: number; discountCents: number; grossCents: number; vatableSalesCents: number; vatCents: number;
  /** Mode C: downpayments already invoiced that this invoice takes into sales; gross, VATable sales and VAT above are what the booklet shows after them. */
  downpaymentsInvoicedCents?: number;
  /** Mode B: the VAT of this sale already booked on the deposits it applies. */
  depositVatMode?: 'A' | 'B' | 'C'; depositVatCents?: number;
}
/** What the booklet panel needs: the three figures; the rest is shown when the server sent it. */
export type BookletShown = Pick<BookletFigures, 'grossCents' | 'vatableSalesCents' | 'vatCents'> & Partial<BookletFigures>;
/** GET /api/jo/releases/:id/invoice-info. */
export interface ReleaseInvoiceInfo { release: ReleasePick; lines: { lineNo: number; qty: number; description: string; amountCents: number }[]; booklet: BookletFigures; depositAppliedCents: number }
/** POST /api/jo/releases/preview: the release as it would be recorded and its invoice figures. */
export interface ReleasePreview { release: Preview & { doc: { balanceDueCents: number; totalCents: number; creditDueDate?: string } }; booklet: BookletFigures; depositAppliedCents: number }
export interface ReleaseBody { release: unknown; invoice: { invoiceNumber: string; note?: string } | null }
/** GET /api/jo/customers/:id/wearers: a customer's groups and active wearers with the size on file. */
export interface WearerPick { personId: string; wearerName: string; groupId: string | null; sizeMode: 'preset' | 'measured'; size?: string; jerseyName?: string; jerseyNumber?: string }
export interface CustomerWearers { groups: { id: string; name: string }[]; wearers: WearerPick[] }
/** The catalog as GET /api/cat/items returns it (active items), and a tier price (GET /api/cat/items/:id/price). */
export interface CatItem { id: string; code: string; name: string; class: 'made_to_order_garment' | 'service' | 'ready_made_item'; unit: 'pc' | 'set' }
export interface CatPrice { itemId: string; minQty: number; unitPriceCents: number; effectiveFrom: string }
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
export interface NavResult { kind: 'Customer' | 'Wearer' | 'Job order' | 'Document' | 'Supplier' | 'Employee'; id: string; label: string; detail?: string; href: string }
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
  /** used: days of leave taken; paid: unused days paid in cash by a payroll (final pay, December). */
  sil: { year: number; eligibleFrom: string; daysPerYear: number; used: number; paid: number; left: number };
}
export type AttendanceStatus = 'present' | 'half_day' | 'absent' | 'rest_day' | 'leave' | 'unpaid_leave' | 'holiday_off' | 'holiday_worked' | 'rest_day_worked';
export interface AttendanceDay { employeeId: string; date: string; status: AttendanceStatus; otMinutes: number; note: string | null }
export interface Holiday { id: number; date: string; name: string; kind: 'regular' | 'special'; source: string; isActive: boolean; deactivatedReason: string | null }
export interface AttendanceGrid {
  from: string; to: string; today: string; statuses: AttendanceStatus[]; holidays: Holiday[];
  employees: { id: string; code: string; fullName: string; hireDate: string; separatedOn: string | null }[]; days: AttendanceDay[];
  /** Days recorded payroll runs paid: locked until the run is cancelled. */
  paid: PaidDays[];
}
export interface PaidDays { employeeId: string; from: string; to: string; number: string }
export type AttendanceSave = { employeeId: string; date: string; status: AttendanceStatus; otMinutes?: number; note?: string };
/** Payroll (PAY) and cash advances (CA): every figure is worked out by the server. */
export type PayGroup = 'WEEKLY_PIECE' | 'SEMI_DAILY' | 'SEMI_MONTHLY';
export interface PayLine { lineNo: number; kind: string; description: string; qty: number; rateCents: number; multiplierBp: number; amountCents: number; jobOrderId?: string; reason?: string }
export interface PayEmployee {
  employeeId: string; code: string; name: string; costCentre: string; payType: string; isMwe: boolean; lines: PayLine[]; grossCents: number; pieceCents: number; taxableCents: number;
  sssMscCents: number; sssEeCents: number; sssErCents: number; sssEcCents: number; phicEeCents: number; phicErCents: number; hdmfEeCents: number; hdmfErCents: number;
  eeShortCents: number; wtaxCents: number; loanCents?: number; loans?: PayLoan[]; caCents: number; caOverrideCents: number | null; thirteenthCents: number; netCents: number;
  /** Tax withheld earlier in the year and refunded on this run (year-end adjustment); net pay includes it. */
  wtaxRefundCents?: number; yearEnd?: PayYearEnd;
  /** Separated within the run's period: this run is their final pay; what they still owe after it. */
  final?: { separatedOn: string; caLeftCents: number; loansLeftCents: number };
}
/** One employee's year-end tax adjustment on a run: the annual tax less what the year withheld before; a deficiency (withheld, short) or a refund. */
export interface PayYearEnd {
  year: number; taxableCents: number; benefitsTaxableCents: number; annualTaxCents: number; withheldBeforeCents: number;
  deficiencyCents: number; withheldCents: number; shortCents: number; refundCents: number;
}
/** Pay before Moonproject (this shop's, 'before') or a previous employer's ('previous'), per employee and year; the parts add up to the gross. */
export interface PriorPay {
  id: string; employeeId: string; employeeName: string; year: number; source: 'before' | 'previous'; employerName: string | null; employerTin: string | null;
  grossCents: number; benefitsCents: number; deMinimisCents: number; sssCents: number; phicCents: number; hdmfCents: number; otherNontaxCents: number;
  taxableCents: number; wtaxCents: number; note: string | null; version: number;
}
export type PriorAmounts = Pick<PriorPay, 'grossCents' | 'benefitsCents' | 'deMinimisCents' | 'sssCents' | 'phicCents' | 'hdmfCents' | 'otherNontaxCents' | 'taxableCents' | 'wtaxCents'>;
/** BIR 2316 figures (IV-A items 19–28, IV-B items 29–52). */
export interface Figures2316 {
  i29BasicSmwCents: number; i30HolidayMweCents: number; i31OvertimeMweCents: number; i32NightMweCents: number; i33HazardMweCents: number;
  i34BenefitsCents: number; i35DeMinimisCents: number; i36SharesCents: number; i37OtherNonTaxableCents: number; i38NonTaxableCents: number;
  i39BasicCents: number; i48TaxableBenefitsCents: number; i50OvertimeCents: number; i51OtherCents: number; i52TaxableCents: number;
  i19GrossCents: number; i20NonTaxableCents: number; i21TaxableCents: number; i22PreviousTaxableCents: number; i23GrossTaxableCents: number; i24TaxDueCents: number;
  i25aPresentWithheldCents: number; i25bPreviousWithheldCents: number; i26WithheldCents: number; withheldJanNovCents: number; withheldDecemberCents: number; refundedCents: number;
}
export interface Data2316 {
  year: number; employeeId: string; code: string; name: string; tin: string | null; isMwe: boolean; periodFrom: string; periodTo: string; separatedOn: string | null;
  smw: { perDayCents: number; factor: number; perMonthCents: number; perYearCents: number } | null; previousEmployer: { name: string | null; tin: string | null } | null;
  figures: Figures2316; yearEnd: { number: string; id: string; deficiencyCents: number; withheldCents: number; refundCents: number } | null; substitutedFiling: boolean; runs: number;
}
/** The 1604-C alphalist URL; with &format=csv (and &schedule=1 or 2) it downloads for the BIR data entry. */
export const alphalistPath = (year: number) => `/api/pay/alphalist?${new URLSearchParams({ year: String(year) })}`;
/** Government loans (PAY): SSS salary and calamity loans, Pag-IBIG multi-purpose and calamity loans. */
export type LoanKind = 'SSS_SALARY' | 'SSS_CALAMITY' | 'HDMF_MPL' | 'HDMF_CALAMITY';
/** One loan's deduction on a run: the plan or the amount typed, what net pay allowed, and what is left of the loan after it. */
export interface PayLoan { loanId: string; agency: 'SSS' | 'HDMF'; kind: LoanKind; loanNo: string; dueCents: number; amountCents: number; overrideCents: number | null; reason?: string; balanceAfterCents: number }
export interface GovLoan {
  id: string; employeeId: string; employeeName: string; employeeCode: string; kind: LoanKind; agency: 'SSS' | 'HDMF'; loanNo: string; amortizationCents: number;
  firstMonth: string; lastMonth: string; stoppedFrom: string | null; stopReason: string | null; note: string | null; version: number;
  scheduledCents: number; deductedCents: number; leftCents: number; lastDeductedMonth: string | null; status: 'not_started' | 'running' | 'ended' | 'stopped';
}
export interface GovLoanInput { employeeId: string; kind: LoanKind; loanNo: string; amortizationCents: number; firstMonth: string; lastMonth: string; note?: string }
export interface ManualPayLine { employeeId: string; kind: 'allowance' | 'adjustment'; amountCents: number; reason: string }
export interface PayRunInput {
  payGroup: PayGroup; periodStart: string; lines?: ManualPayLine[]; advances?: { employeeId: string; amountCents: number }[]; skip?: { employeeId: string; reason: string }[];
  loans?: { loanId: string; amountCents: number; reason: string }[]; yearEnd?: boolean; unusedLeave?: boolean;
}
export interface PayRunDoc extends PayRunInput { periodEnd: string; contributionMonth: string; employees: PayEmployee[]; grossCents: number; netCents: number }
/** `bookOn`: the date to give the run (the period's last day, for someone who may backdate), or null for today. */
export interface PayPeriod { periodStart: string; periodEnd: string; employees: number; recorded: { id: string; number: string } | null; bookOn: string | null }
export interface Payslips {
  number: string; status: 'posted' | 'cancelled'; payDate: string; payGroup: PayGroup; periodStart: string; periodEnd: string; contributionMonth: string;
  employees: (PayEmployee & {
    caBalanceAfterCents: number; ytd: { grossCents: number; wtaxCents: number; thirteenthCents: number };
    /** The year's 13th-month pay recorded for the employee (TH13-). */
    thirteenthPaid: { id: string; number: string; amountCents: number }[];
  })[];
}
/** 13th-month pay (TH13-): one twelfth of the year's basic pay beside what the runs accrued on 2111. */
export interface PayThirteenthInput {
  payGroup: PayGroup; year: number; amounts?: { employeeId: string; amountCents: number; reason: string }[]; skip?: { employeeId: string; reason: string }[];
  /** One separated employee alone (their 13th month on separation). */
  employeeId?: string;
}
export interface PayThirteenthEmployee {
  employeeId: string; code: string; name: string; costCentre: string; basicCents: number; earlierBasicCents: number; dueCents: number; accruedCents: number; amountCents: number; reason?: string;
  otherBenefitsCents: number; taxableCents: number; wtaxCents: number; netCents: number; basis: string[];
}
export interface PayThirteenthDoc extends PayThirteenthInput { employees: PayThirteenthEmployee[]; netCents: number; totalCents: number }
export interface ThirteenthYears { years: number[]; recorded: { payGroup: PayGroup; year: number; id: string; number: string }[] }
/** A recorded payroll run, or 13th-month pay (its period is the year), with net pay still to release. */
export interface RunToRelease { id: string; number: string; kind: 'run' | 'thirteenth'; payGroup: PayGroup; periodStart: string; periodEnd: string; dueCents: number }
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
  scheme: Scheme; label: string; recordedCents: number; remittedCents: number; balanceCents: number; loanRecordedCents: number; loanRemittedCents: number;
  /** What a remittance of the month offers now; for the withholding tax, net of year-end tax refunds. */
  dueCents: number;
  /** Withholding tax only: the month's year-end tax refunds, those not yet taken off, earlier months' excess taken off this month, and this month's excess for the next. */
  refundCents: number; refundOpenCents: number; carriedInCents: number; carriedFrom: string[]; carriedOutCents: number;
  remittances: { id: string; number: string; amountCents: number; month?: string }[];
  cancelledAfter: { id: string; number: string; cancelledAt: string }[]; overRemitted: { employeeId: string; name: string; part?: 'contribution' | 'loan'; cents: number }[];
}
interface StatPerson { employeeId: string; code: string; name: string; idNo: string | null }
export interface StatLoanRow extends StatPerson { loanNo: string; kind: LoanKind; kindLabel: string; totalCents: number }
export interface StatMonth {
  month: string;
  sss: { rows: (StatPerson & { mscCents: number; mpfMscCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number })[]; totalCents: number };
  phic: { rows: (StatPerson & { basisCents: number; eeCents: number; erCents: number; totalCents: number })[]; totalCents: number };
  hdmf: { rows: (StatPerson & { compensationCents: number; eeCents: number; erCents: number; totalCents: number })[]; totalCents: number };
  sssLoans: { rows: StatLoanRow[]; totalCents: number };
  hdmfLoans: { rows: StatLoanRow[]; totalCents: number };
  tax: {
    employees: number; totalCompensationCents: number; mweBasicCents: number; mwePremiumCents: number; thirteenthMonthCents: number; deMinimisCents: number; eeSharesCents: number;
    otherNonTaxableCents: number; nonTaxableCents: number; taxableCents: number; noTaxWithheldCents: number; taxWithheldCents: number;
    yearEndRefundCents: number; refundCarriedInCents: number; refundCarriedFrom: string[]; taxToRemitCents: number; refundCarriedOutCents: number;
    rows: (StatPerson & { isMwe: boolean; grossCents: number; nonTaxableCents: number; taxableCents: number; taxCents: number; refundCents: number })[];
  };
  check: SchemeCheck[];
  notDeducted: { employeeId: string; name: string; cents: number }[];
}
/** The agencies that take an upload file (STAT), and the employer's number at each. */
export type UploadScheme = 'SSS' | 'PHIC' | 'HDMF';
export interface EmployerNumberRow { scheme: UploadScheme; label: string; employerLabel: string; number: string | null; since: string | null }
/** The exposure report (ACC-05): months since the cut-over with pay but no contribution recorded, with estimates. Posts nothing. */
export interface ExposureMonth { month: string; grossCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number; monthsLate: number; penaltyCents: number }
export interface ExposureLine {
  employeeId: string; code: string; name: string; scheme: UploadScheme; label: string; switchedOff: boolean;
  months: ExposureMonth[]; eeCents: number; erCents: number; ecCents: number; totalCents: number; penaltyCents: number;
}
export interface Exposure {
  asOf: string; cutoverDate: string | null; from: string | null; to: string | null;
  rates: { scheme: UploadScheme; label: string; monthlyBp: number | null; source: string | null }[];
  lines: ExposureLine[];
  totals: { scheme: UploadScheme; label: string; employees: number; months: number; eeCents: number; erCents: number; ecCents: number; totalCents: number; penaltyCents: number }[];
  notes: string[];
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
/** Opening statutory payable (OBST-, stat.opening, PLAN D8 step 3): per employee, what is still to remit for a contribution month. */
export interface OpeningStatEmployee { employeeId: string; sssCents?: number; phicCents?: number; hdmfCents?: number; wtaxCents?: number; sssLoanCents?: number; hdmfLoanCents?: number }
export interface OpeningStatInput { month: string; employees: OpeningStatEmployee[] }
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
/** SLSP and SAWT data of a quarter: each figure tied to its register or the books, with the difference (0 when they agree). */
export interface TaxTie { key: string; label: string; listCents: number; bookCents: number; differenceCents: number }
export type SaleClass = 'zero_rated' | 'exempt' | 'not_a_sale';
/** GET /api/tax/slsp/sales: one row per customer with a TIN, the customers without one on one line (customerId null). */
export interface SlspSales {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string;
  rows: {
    customerId: string | null; tin: string | null; registeredName: string; address: string | null; exemptCents: number; zeroRatedCents: number;
    vatableCents: number; outputTaxCents: number; grossTaxableCents: number; toClassifyCents: number; customers: number;
  }[];
  totals: { exemptCents: number; zeroRatedCents: number; vatableCents: number; outputTaxCents: number; grossTaxableCents: number; toClassifyCents: number };
  otherIncomeCents: number; ties: TaxTie[]; checks: WorksheetCheck[];
  /** Sales with no output VAT (journal vouchers) and the accountant's class of each; null = to classify. */
  noVatSales: (TaxJournalRef & { customerId: string | null; customerName: string; tin: string | null; amountCents: number; sale: boolean; saleClass: SaleClass | null })[];
}
/** GET /api/tax/slsp/purchases: one row per supplier (or one-off payee), by class. */
export interface SlspPurchases {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string;
  rows: {
    supplierId: string | null; tin: string | null; registeredName: string; address: string | null; exemptCents: number; zeroRatedCents: number; servicesCents: number;
    capitalGoodsCents: number; goodsCents: number; toClassifyCents: number; inputTaxCents: number; grossTaxableCents: number;
  }[];
  totals: { exemptCents: number; zeroRatedCents: number; servicesCents: number; capitalGoodsCents: number; goodsCents: number; toClassifyCents: number; inputTaxCents: number; grossTaxableCents: number };
  ties: TaxTie[]; checks: WorksheetCheck[];
}
/** GET /api/tax/sawt: one row per customer, ATC and 2307 status; `certificate` null = no 2307 recorded (a journal voucher). */
export interface Sawt {
  year: number; quarter: 1 | 2 | 3 | 4; from: string; to: string;
  rows: {
    customerId: string | null; tin: string | null; registeredName: string; atc: string | null; nature: string | null; rateBp: number | null;
    incomePaymentCents: number | null; cwtCents: number; vatWithheldCents: number; certificate: 'received' | 'pending' | null; period: string | null; documents: string[];
  }[];
  totals: { cwtCents: number; vatWithheldCents: number; incomePaymentCents: number };
  inHand: { cwtCents: number; vatWithheldCents: number }; pending: { cwtCents: number; vatWithheldCents: number };
  ties: TaxTie[]; checks: WorksheetCheck[];
}
export interface SalesRegister { from: string; to: string; rows: (TaxRegisterRow & { netCents: number; vatCents: number; totalCents: number })[]; totals: { netCents: number; vatCents: number; totalCents: number }; glVatCents: number }
export interface WithholdingRegister {
  from: string; to: string;
  /** `lineNo` names the 2307 (an opening withholding's row, 0 for a collection's); `period` ('2026-Q2') only on an opening's. */
  rows: (TaxRegisterRow & {
    atc: string | null; certificate: 'pending' | 'received' | null; cwtCents: number; vatWithheldCents: number;
    lineNo: number; receivedOn: string | null; opening: boolean; period: string | null;
  })[];
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
/** Suppliers and the supplies catalogue as PUR keeps them (GET /api/pur/suppliers?status=, /api/pur/supplies?status=): the whole row, with its version for If-Match. */
export type PurStatus = 'active' | 'inactive' | 'all';
export interface SupplierRecord extends SupplierRow { registered_name: string; sworn_declaration_until: string | null; legacy_id: string | null; is_active: number; version: number }
export interface SupplierBody {
  name: string; registeredName: string; tin: string | null; isVatRegistered: boolean; ewtClass: string | null; swornDeclarationUntil: string | null; paymentTermsDays: number | null; legacyId: string | null;
}
export interface SupplierContact { id: string; supplier_id: string; name: string; role: string | null; phone: string | null; email: string | null }
export interface ContactBody { name: string; role: string | null; phone: string | null; email: string | null }
export type SupplyUnit = 'yard' | 'meter' | 'kg' | 'roll' | 'pc';
export interface SupplyRecord extends SupplyRow { unit: SupplyUnit; last_purchase_cost_cents: number; is_active: number; version: number }
export interface SupplyBody { name: string; unit: SupplyUnit; category: 'materials' | 'ready_made' }
/** A purchase order line with what posted receiving reports have received (GET /api/pur/purchase-orders/:id and /open). */
export interface PoLineStatus { lineNo: number; supplyId: string; supplyName: string; unit: SupplyUnit; orderedQty: number; receivedQty: number; remainingQty: number; unitCostCents: number }
export interface PoStatus { id: string; number: string; status: 'posted' | 'cancelled'; date: string; totalCents: number; expectedDate: string | null; supplierId: string; supplierName: string; lines: PoLineStatus[] }
export interface RrDetail {
  id: string; number: string; status: 'posted' | 'cancelled'; date: string; poId: string; poNumber: string; supplierId: string; supplierName: string;
  lines: { lineNo: number; poLineNo: number; supplyId: string; supplyName: string; unit: SupplyUnit; qty: number }[];
}
export interface SupplierPo { id: string; number: string; status: 'posted' | 'cancelled'; date: string; totalCents: number; expectedDate: string | null; fullyReceived: boolean }
export interface SupplierRr { id: string; number: string; status: 'posted' | 'cancelled'; date: string; poId: string; poNumber: string }
/** GET /api/inv/count-sheet?format=json: the active supplies of a category and the cost each is valued at on the count date. */
export interface SheetSupply {
  supplyId: string; name: string; unit: 'yard' | 'meter' | 'kg' | 'roll' | 'pc'; milliUnits: boolean;
  defaultCostCents: number; costSource: 'bill' | 'po' | 'catalogue'; costSourceNumber: string | null;
}
export interface CountSheet { category: 'materials' | 'ready_made'; date: string; supplies: SheetSupply[] }
export interface ExpCategory { id: number; code: string; name: string; defaultEwtClass: string | null }
/**
 * GET /api/ap/suppliers/:id: a supplier's bills (with the advances applied on each and what is still owed), payments and
 * advances (with what is still open on each), the AP balance (2101) and the advances open (1230), all from the ledger.
 */
export interface ApLedger {
  supplierId: string; supplierName: string; balanceCents: number; advancesCents: number;
  bills: {
    id: string; docType?: 'ap.bill' | 'ap.opening'; number: string; status: 'posted' | 'cancelled'; date?: string; supplierInvoiceNo: string; dueDate: string; payableCents: number; owedCents: number;
    advanceCents?: number; paidCents?: number;
  }[];
  payments?: { id: string; number: string; status: 'posted' | 'cancelled'; date: string; totalCents: number; bills: { billNumber: string; amountCents: number }[] }[];
  advances: {
    id: string; number: string; status: 'posted' | 'cancelled'; date: string; purchaseOrderNumber: string | null; amountCents: number; ewtCents: number; cashCents: number;
    appliedCents: number; returnedCents: number; openCents: number; bills: { billId: string; billNumber: string; amountCents: number }[]; returns: { id: string; number: string; amountCents: number }[];
  }[];
}
/** GET /api/ap/suppliers: every supplier with something owed or an advance open; `netCents` = owed less the advances. */
export interface ApBalance { supplierId: string; supplierName: string; balanceCents: number; advancesCents: number; netCents: number }
/** GET /api/acc/opening, what an opening document's form needs: the cut-over date it is dated, and the close once done. */
export type OpeningStatus = Pick<OpeningState, 'cutoverDate' | 'closed'>;
export interface EqPerson { id: string; name: string; isStockholder: boolean; isOfficer: boolean; position: string | null }
/** GET /api/settings: each dated setting with the value in force today and every version, newest first. */
export interface SettingVersion { id: number; key: string; effectiveFrom: string; value: unknown; reason: string; createdAt: string; createdBy: string | null }
export interface Setting { key: string; label: string; current: unknown; versions: SettingVersion[] }
/** Users and roles (SEC, owner only): GET /api/users and GET /api/roles. */
export interface UserRow { id: string; username: string; displayName: string; isActive: boolean; mustChangePassword: boolean; roles: string[] }
export interface RoleGrid { roles: string[]; permissions: { key: string; module: string; label: string; roles: string[] }[] }
/** The chart of accounts as GET /api/acc/accounts returns it, in code order. `balanceCents` is debit-positive. */
export interface CoaAccount {
  id: number; code: string; name: string; type: Account['type']; normalSide: 'debit' | 'credit'; roleKey: string | null; partyType: PartyType | null;
  isHeader: boolean; isCashPlace: boolean; isReserved: boolean; isActive: boolean; version: number; balanceCents: number;
}
export interface NewAccountBody { code: string; name: string; type: Account['type']; normalSide?: 'debit' | 'credit'; partyType?: PartyType }

/** Chart of accounts (ACC), for pickers. `partyType`: the subledger a line on the account names; 'free' takes any, or none. */
export type PartyType = 'customer' | 'supplier' | 'employee' | 'officer' | 'stockholder' | 'loan' | 'asset' | 'free';
export interface Account { id: number; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; partyType: PartyType | null; isHeader: boolean; isCashPlace: boolean; isReserved: boolean; isActive: boolean }
/** GET /api/pur/suppliers (the same rows as SupplierRow). */
export type Supplier = SupplierRow;
/** The loan register (LOAN): what is owed comes from the ledger; `nextDue` is null once paid off or cancelled. */
export interface LoanRow {
  id: string; number: string; status: 'posted' | 'cancelled'; lender: string; kind: 'loan' | 'equipment'; principalCents: number; balanceCents: number; instalments: number;
  dateReceived?: string; rateBp?: number; termMonths?: number; principalPaidCents?: number; interestPaidCents?: number; reference?: string | null;
  nextDue: { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number } | null;
}
/** An FA- purchase whose financed part no loan has taken over yet. */
export interface FinancedPurchase { id: string; number: string; date: string; description: string; supplierName: string; lender: string; financedCents: number }
export interface AssetClass { code: string; name: string; defaultLifeMonths: number | null }
export type AssetStatus = 'in service' | 'fully depreciated' | 'disposed' | 'cancelled';
/** GET /api/fa/assets: the register; every figure but the description and class comes from the ledger and the documents. */
export interface AssetRow {
  id: string; number: string; description: string; className: string; status: AssetStatus;
  acquiredOn?: string; costCents?: number; residualCents?: number; lifeMonths?: number; monthlyChargeCents?: number; accumulatedCents?: number; bookValueCents?: number; location?: string | null;
}
/** GET /api/fa/assets/:id: the register row with its depreciation from the recorded runs, its documents and the months with no charge. */
export interface AssetPage extends Required<AssetRow> {
  disposal: string | null;
  depreciation: { month: string; documentId: string; documentNumber: string; chargeCents: number; accumulatedCents: number }[];
  missingMonths: string[];
  documents: { docType: string; id: string; number: string; date: string; status: 'posted' | 'cancelled' }[];
}
/** GET /api/fa/depreciation-gaps: months before this one in which an asset in service was not charged. */
export interface DepreciationGaps { thisMonth: string; lastRunMonth: string | null; months: string[] }

/** GET /api/eq/people?all=1: the register of stockholders and officers. */
export interface EqPersonRecord extends EqPerson { shares: number | null; isActive: boolean; version: number }
/** GET /api/eq/balances: what each person owes the company, is owed, and still owes on a stock subscription. */
export interface EqBalance { personId: string; dueFromCents: number; dueToCents: number; unpaidSubscriptionCents: number }
/** GET /api/eq/people/:id/owner-money and /officer-transactions: `kind` is the classification, or taken | returned | repaid_to_officer; `note` the note or purpose. */
export interface EqDocument { id: string; number: string; date: string; status: 'posted' | 'cancelled'; amountCents: number; accountName: string; kind: string; note: string | null }
/** GET /api/eq/people/:id/ledger: `netCents` is what they owe the company less what it owes them; amounts on lines are debit-positive. */
export interface EqLedger {
  person: EqPersonRecord; dueFromCents: number; dueToCents: number; netCents: number;
  lines: { date: string; journalNumber: string; documentNumber: string | null; accountCode: string; accountName: string; memo: string; amountCents: number; netCents: number }[];
}

/** GET /api/loan/loans/:id: the register row with its schedule (and the payment on each paid instalment) and the loan ledger. */
export interface LoanDetail extends LoanRow {
  schedule: { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number; paidBy: string | null }[];
  ledger: { date: string; journalNumber: string; documentNumber: string | null; memo: string; amountCents: number; balanceCents: number }[];
}
/** GET /api/loan/loans/:id/payments. */
export interface LoanPayment { id: string; number: string; date: string; status: 'posted' | 'cancelled'; instalmentNo: number; principalCents: number; interestCents: number; totalCents: number; note: string | null }
/** GET /api/loan/late: an instalment past its due date with no recorded payment. */
export interface LateInstalment { loanId: string; loanNumber: string; lender: string; instalmentNo: number; dueDate: string; principalCents: number; interestCents: number; daysLate: number }

/** GET /api/szr/overview (PLAN E8): every set with who has it, the overdue ones and the last returns. */
export interface SizerHolder { loanId: string; loanVersion: number; customerId: string; customerName: string; dateOut: string; expectedReturnDate: string; daysOverdue: number }
export interface SizerSet { id: string; code: string; garmentType: string; sizesIncluded: string; status: 'in shop' | 'lent' | 'lost or damaged'; holder: SizerHolder | null }
export interface SizerReturned { loanId: string; setCode: string; garmentType: string; customerName: string; dateOut: string; expectedReturnDate: string; returnedDate: string; conditionOnReturn: string }
export interface SizerBoard { today: string; sets: SizerSet[]; overdue: SizerSet[]; returned: SizerReturned[] }
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
/** Customer emails (COM). The App Password is write-only: the server says only whether one is saved. */
export type EmailTemplate = 'job_order_created' | 'job_order_ready' | 'claimed' | 'statement';
export interface EmailSettings { sendingOn: boolean; host: string; port: number; user: string; senderName: string; senderAddress: string; version: number; appPasswordSet: boolean; missing: string[] }
export interface EmailSettingsInput { sendingOn: boolean; host: string; port: number; user: string; senderName: string; senderAddress: string; appPassword?: string }
export interface OutboxRow {
  id: string; template: EmailTemplate; customerId: string; customerName: string; toAddress: string; documentId: string | null; documentNumber: string | null;
  periodFrom: string | null; periodTo: string | null; subject: string; body: string; attachmentName: string | null; status: 'queued' | 'sent' | 'failed';
  attempts: number; nextAttemptAt: string; lastError: string | null; createdAt: string; sentAt: string | null;
}
export interface Outbox { rows: OutboxRow[]; counts: Record<'queued' | 'sent' | 'failed', number> }
/** The old-data importer (PLAN E13 MIG-01), as /api/mig reports it. */
export type MigRowType = 'customer' | 'measurement' | 'employee' | 'piece_rate' | 'unknown';
export type MigRowStatus = 'valid' | 'needs_review' | 'accepted' | 'merged' | 'excluded';
export interface MigUpload { id: string; filename: string; uploadedAt: string; uploadedBy: string; status: 'staged' | 'dry_run_passed' | 'committed' }
export interface MigUploaded { uploadId: string; totalRows: number; needsReview: number }
/** A row of the review: the old sheet's cells (`raw`), the problems in the server's words, and the fix if one was made. */
export interface MigRow {
  id: string; rowNumber: number; rowType: MigRowType; status: MigRowStatus; raw: Record<string, string>; issues: string[];
  manualData: Record<string, string | number> | null; legacyId: string | null; rateCents: number | null; mergeIntoRowId: string | null;
}
export interface DryRunResult {
  success: true;
  counts: { customers: number; measurements: number; employees: number; pieceRates: number; excluded: number; merged: number; total: number };
  checksums: {
    customer: { sha256: string }; measurement: { sha256: string; cellTenths: number }; employee: { sha256: string; rateCents: number }; pieceRate: { sha256: string; rateCents: number };
  };
}
export type MigCommitKind = 'customer' | 'group' | 'wearer' | 'measurement' | 'employee' | 'piece_rate';
/** What a commit made. `excluded` and `merged` are only in the answer to the commit itself, not in the later look-up. */
export interface MigCommitResult { counts: Record<MigCommitKind, { imported: number; alreadyImported: number }>; measurementCellTenths: number; excluded?: number; merged?: number }
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
/** GET /api/acc/month-end?month=: the month-end checklist (PLAN D8), each item read from the app. */
export type MonthEndState = 'done' | 'not_done' | 'not_needed';
export interface MonthEndItem { key: string; title: string; state: MonthEndState; detail: string; href: string; linkLabel: string; rows: { label: string; state: MonthEndState; detail: string }[] }
export interface MonthEndSignoff { id: number; month: string; signedAt: string; signedBy: string; signedByName: string; note: string }
export interface MonthEndChecklist {
  month: string; asOf: string; over: boolean; canSignOff: boolean; items: MonthEndItem[];
  signoff: (MonthEndSignoff & { items: { key: string; state: MonthEndState; detail: string }[] }) | null;
  earlierSignoffs: MonthEndSignoff[];
  /** Documents dated in the month that were recorded or cancelled after the newest sign-off; null while the month is not signed. */
  changedAfterSignoff: { count: number; documents: { number: string; title: string; date: string; action: 'recorded' | 'cancelled'; at: string }[] } | null;
}
/** BIR payments (BIRP-): the return, and the posted payments a worksheet counts. */
export type BirForm = '2550Q' | '0619-E' | '1601-EQ' | '1702Q' | '1702';
export interface BirPaymentLine { id: string; number: string; date: string; period: string; reference: string; amountCents: number; penaltyCents: number }
/** The EWT of a period by ATC (per EWT class while the ATC is to confirm). */
export type EwtAtcLine = EwtAtc & { baseCents: number; ewtCents: number };
/** GET /api/tax/0619e?month=: month 1 or 2 of a quarter. */
/** What the opening tax payables (OBTP-) left to pay with a return of a period before the cut-over date. */
export interface OpenedReturns { openingCents: number; openings: { documentId: string; number: string; form: string; period: string }[] }
export interface EwtMonthWorksheet extends OpenedReturns {
  month: string; label: string; from: string; to: string; returnDue: string; atcs: EwtAtcLine[]; totals: { baseCents: number; ewtCents: number };
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number; checks: WorksheetCheck[];
}
/** GET /api/tax/1601eq?year&quarter=: the quarter less its 0619-E payments, and the QAP. */
export interface EwtQuarterWorksheet extends OpenedReturns {
  year: number; quarter: 1 | 2 | 3 | 4; period: string; from: string; to: string; months: string[]; returnDue: string; atcs: EwtAtcLine[]; totals: { baseCents: number; ewtCents: number };
  remittances: { month: string; label: string; payments: BirPaymentLine[]; paidCents: number }[]; remittedCents: number;
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number;
  qap: (EwtAtc & { supplierId: string | null; tin: string | null; registeredName: string; baseCents: number; rateBp: number | null; ewtCents: number })[];
  checks: WorksheetCheck[];
}
/** The income tax settings (dated): the regular rate, the MCIT rate, and the year operations began (MCIT from its 4th year after). */
export interface IncomeTaxSettingsValue { regularRateBp: number; mcitRateBp: number; operationsBeganYear: number | null }
export interface IncomeTaxSettings extends IncomeTaxSettingsValue { id: number; effectiveFrom: string; reason: string; createdAt: string; createdBy: string | null; confirmed: boolean }
/** GET /api/tax/1702q?year&quarter=: the year to date in whole pesos, the tax, the credits, and what is left to pay. */
export interface IncomeTaxWorksheet {
  year: number; quarter: 1 | 2 | 3; period: string; from: string; to: string; returnDue: string | null;
  settings: IncomeTaxSettings; mcitApplies: boolean | null; basis: 'regular' | 'mcit';
  lines: { key: string; label: string; cents: number }[];
  taxDueCents: number; payableCents: number;
  opening: { documentId: string; number: string; date: string } | null; openingCents: number;
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number;
  checks: WorksheetCheck[];
}
/** The deductions a year's 1702-RT takes (dated, per year): itemized by default until the accountant confirms, or the 40% OSD. */
export type DeductionMethod = 'itemized' | 'osd';
export interface DeductionSetting {
  id: number | null; year: number; method: DeductionMethod; effectiveFrom: string | null; reason: string | null; createdAt: string | null; createdBy: string | null; confirmed: boolean;
}
type DocRef = { documentId: string; number: string; date: string };
/** GET /api/tax/1702rt?year=: the year in whole pesos, the tax, the credits, payable or carried over; the provision, settlement and 1702 payments. */
export interface AnnualIncomeTaxWorksheet {
  year: number; from: string; to: string; returnDue: string | null;
  settings: IncomeTaxSettings; mcitApplies: boolean | null; basis: 'regular' | 'mcit'; deduction: DeductionSetting;
  lines: { key: string; label: string; cents: number }[];
  itemizedDeductionsCents: number; osdCents: number; taxDueCents: number; payableCents: number; provisionCents: number;
  quarterlyPayments: BirPaymentLine[];
  provision: (DocRef & { amountCents: number }) | null; settlement: (DocRef & { payableCents: number; carryOverCents: number }) | null; opening: DocRef | null;
  dueCents: number; payments: BirPaymentLine[]; paidCents: number; leftCents: number;
  checks: WorksheetCheck[];
}
/** GET /api/tax/1604e?year=: the alphalist per payee and ATC, and its tie-out to the four quarters. */
export interface EwtAnnualReturn {
  year: number; from: string; to: string; returnDue: string | null;
  alphalist: (EwtAtc & { supplierId: string | null; tin: string | null; registeredName: string; rateBp: number | null; quarters: [number, number, number, number]; baseCents: number; ewtCents: number })[];
  totals: { baseCents: number; ewtCents: number };
  quarters: { quarter: 1 | 2 | 3 | 4; period: string; qapCents: number; worksheetCents: number; registerCents: number; glCents: number; tied: boolean; dueCents: number; remittedCents: number; paidCents: number; leftCents: number }[];
  quartersCents: number; registerCents: number; glCents: number; tied: boolean; checks: WorksheetCheck[];
}
/** A year's annual report URL; with &format=csv the same URL downloads it for Excel. */
export const taxYearPath = (report: '1702rt' | '1604e', year: number) => `/api/tax/${report}?${new URLSearchParams({ year: String(year) })}`;
/** A tax register's URL; with &format=csv the same URL downloads it for Excel. */
export const taxRegisterPath = (register: 'sales' | 'withholding-received' | 'purchases' | 'ewt', from: string, to: string) => `/api/tax/registers/${register}?${new URLSearchParams({ from, to })}`;
/** A quarter's tax report URL; with &format=csv the same URL downloads it for Excel. */
export const taxQuarterPath = (report: '2307-to-issue' | '2550q' | '1601eq' | '1702q' | 'slsp/sales' | 'slsp/purchases' | 'sawt', year: number, quarter: number) => `/api/tax/${report}?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}`;
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
    printerTestPack: () => call<PrinterTestPack>('GET', '/api/prt/test-pack'),
    printDocument: (type: string, id: string, variant: PrintVariant = 'document') =>
      call<{ html: string; copyNumber: number }>('POST', `/api/prt/print/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { variant }),
    /** practice: this is the practice shop (PLAN C8). */
    health: () => call<{ serverTime: string; practice?: boolean }>('GET', '/api/health'),
    dashHome: () => call<DashHomeData>('GET', '/api/dash/home'),
    dashNotifications: () => call<DashNotification[]>('GET', '/api/dash/notifications'),
    dashRead: (id: string) => call<{ ok: true }>('POST', '/api/dash/notifications/read', { id }),
    calItems: (from: string, to: string) => call<CalItem[]>('GET', `/api/cal?${new URLSearchParams({ from, to })}`),
    calCreate: (body: CalEventInput) => call<CalEvent>('POST', '/api/cal/events', body),
    calMove: (id: string, date: string, time?: string | null) => call<CalEvent>('POST', `/api/cal/events/${encodeURIComponent(id)}/move`, { date, time }),
    calCancel: (id: string, reason: string) => call<CalEvent>('POST', `/api/cal/events/${encodeURIComponent(id)}/cancel`, { reason }),
    calHistory: (id: string) => call<CalEvent[]>('GET', `/api/cal/events/${encodeURIComponent(id)}/history`),
    shopCertificate: () => call<{ ca: CertInfo | null; join?: JoinAddress }>('GET', '/api/system/tls'),
    systemHealth: () => call<SystemHealth>('GET', '/api/system/health'),
    systemCheck: () => call<SystemHealth>('POST', '/api/system/health/check'),
    practice: () => call<PracticeStatus>('GET', '/api/system/practice'),
    /** Needs a fresh password (step-up). */
    practiceReset: () => call<PracticeStatus>('POST', '/api/system/practice/reset'),
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
    cashRecons: () => call<ReconRow[]>('GET', '/api/cash/recons'),
    cashRecon: (id: string) => call<ReconReport>('GET', `/api/cash/recons/${id}`),
    startCashRecon: (bankId: number, month: string, endingBalanceCents: number) => call<ReconReport>('POST', '/api/cash/recons', { bankId, month, endingBalanceCents }),
    setReconEnding: (id: string, endingBalanceCents: number) => call<ReconReport>('PUT', `/api/cash/recons/${id}`, { endingBalanceCents }),
    addReconLines: (id: string, lines: { date: string; description: string; amountCents: number }[]) => call<ReconReport>('POST', `/api/cash/recons/${id}/lines`, { lines }),
    voidReconLine: (id: string, lineId: number) => call<ReconReport>('POST', `/api/cash/recons/${id}/lines/${lineId}/void`, {}),
    matchRecon: (id: string, statementLineIds: number[], journalLineIds: number[]) => call<ReconReport>('POST', `/api/cash/recons/${id}/match`, { statementLineIds, journalLineIds }),
    unmatchRecon: (id: string, matchNo: number) => call<ReconReport>('POST', `/api/cash/recons/${id}/unmatch`, { matchNo }),
    finishRecon: (id: string) => call<ReconReport>('POST', `/api/cash/recons/${id}/finish`, {}),
    customer: (id: string) => call<CustomerRow>('GET', `/api/cus/customers/${encodeURIComponent(id)}`),
    customers: (search: string) => call<CustomerRow[]>('GET', `/api/cus/customers?${new URLSearchParams({ search, limit: '10' })}`),
    openItems: (customerId: string) => call<OpenItems>('GET', customer(customerId, 'open-items')),
    refundable: (customerId: string) => call<Refundable>('GET', customer(customerId, 'refundable')),
    transferable: (customerId: string) => call<Transferable>('GET', customer(customerId, 'transferable')),
    customerInvoices: (customerId: string) => call<CustomerInvoices>('GET', customer(customerId, 'invoices')),
    forfeitable: (customerId: string) => call<Forfeitable>('GET', customer(customerId, 'forfeitable')),
    joStatus: (id: string) => call<JoStatus>('GET', `/api/jo/orders/${encodeURIComponent(id)}/status`),
    joDpInfo: (id: string) => call<DpInfo>('GET', `/api/jo/orders/${encodeURIComponent(id)}/dp-info`),
    joPickOrders: (q: string) => call<JoPick[]>('GET', `/api/jo/pick/orders?${new URLSearchParams({ q })}`),
    joPickReleases: (q: string) => call<ReleasePick[]>('GET', `/api/jo/pick/releases?${new URLSearchParams({ q })}`),
    joReleaseInfo: (id: string) => call<ReleaseInvoiceInfo>('GET', `/api/jo/releases/${encodeURIComponent(id)}/invoice-info`),
    joWearers: (customerId: string) => call<CustomerWearers>('GET', `/api/jo/customers/${encodeURIComponent(customerId)}/wearers`),
    joReleasePreview: (release: unknown) => call<ReleasePreview>('POST', '/api/jo/releases/preview', { release }),
    /** The release (REL-) and, unless the invoice is to follow (invoice: null), its invoice record, in one transaction. */
    joRelease: (b: ReleaseBody, expectedTotalCents: number, key: string) =>
      call<{ release: PostResult; invoiceRecord: PostResult | null }>('POST', '/api/jo/releases', { ...b, expectedTotalCents }, idem(key)),
    addCustomer: (b: { kind: 'person' | 'organization'; displayName: string }) => call<CustomerRow & { duplicateWarnings: { id: string; reason: string }[] }>('POST', '/api/cus/customers', b),
    catItems: (search: string) => call<CatItem[]>('GET', `/api/cat/items?${new URLSearchParams({ search, active: '1', limit: '10' })}`),
    catPrice: (itemId: string, qty: number) => call<CatPrice>('GET', `/api/cat/items/${encodeURIComponent(itemId)}/price?${new URLSearchParams({ qty: String(qty) })}`),
    cusSizes: () => call<{ id: string; label: string; is_active: number }[]>('GET', '/api/cus/sizes'),
    qsPreview: (b: QsBody) => call<QsPreview>('POST', '/api/qs/sales/preview', b),
    qsRecord: (b: QsBody, expectedTotalCents: number, key: string) => call<QsRecorded>('POST', '/api/qs/sales', { ...b, expectedTotalCents }, idem(key)),
    qsReissue: (id: string, b: QsBody, expectedTotalCents: number, reason: string, key: string) =>
      call<QsRecorded>('POST', qs(id, 'reissue'), { ...b, expectedTotalCents, reason }, idem(key)),
    qsCancel: (id: string, reason: string, key: string) => call<unknown>('POST', qs(id, 'cancel'), { reason }, idem(key)),
    qsPayments: (id: string) => call<SalePayment[]>('GET', qs(id, 'payments')),
    prdCatalogue: () => call<PrdCatalogue>('GET', '/api/prd/catalogue'),
    prdBoard: () => call<BoardCard[]>('GET', '/api/prd/board'),
    prdTv: () => call<{ cards: BoardCard[]; steps: PrdStep[] }>('GET', '/api/prd/tv'),
    navSearch: (q: string) => call<NavResult[]>('GET', `/api/nav/search?${new URLSearchParams({ q })}`),
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
    thirteenthYears: () => call<ThirteenthYears>('GET', '/api/pay/thirteenth/years'),
    releaseStatus: (runId: string) => call<ReleaseRow[]>('GET', `/api/pay/runs/${encodeURIComponent(runId)}/release-status`),
    govLoans: (q: { employeeId?: string; status?: 'open' | 'all' } = {}) => call<GovLoan[]>('GET', `/api/pay/loans?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
    addGovLoan: (body: GovLoanInput) => call<GovLoan>('POST', '/api/pay/loans', body),
    updateGovLoan: (id: string, v: number, body: Partial<Omit<GovLoanInput, 'employeeId' | 'kind'>>) => call<GovLoan>('PUT', `/api/pay/loans/${encodeURIComponent(id)}`, body, version(v)),
    stopGovLoan: (id: string, v: number, body: { fromMonth: string; reason: string }) => call<GovLoan>('POST', `/api/pay/loans/${encodeURIComponent(id)}/stop`, body, version(v)),
    priorPay: (q: { employeeId?: string; year?: number } = {}) =>
      call<PriorPay[]>('GET', `/api/pay/prior?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`),
    addPriorPay: (body: PriorAmounts & { employeeId: string; year: number; source: 'before' | 'previous'; employerName?: string; employerTin?: string; note?: string }) =>
      call<PriorPay>('POST', '/api/pay/prior', body),
    updatePriorPay: (id: string, v: number, body: Partial<PriorAmounts & { employerName: string | null; employerTin: string | null; note: string | null }>) =>
      call<PriorPay>('PUT', `/api/pay/prior/${encodeURIComponent(id)}`, body, version(v)),
    all2316: (year: number) => call<Data2316[]>('GET', `/api/pay/2316?year=${year}`),
    one2316: (year: number, employeeId: string) => call<Data2316>('GET', `/api/pay/2316?${new URLSearchParams({ year: String(year), employeeId })}`),
    caStatus: (employeeId: string) => call<CaStatus>('GET', `/api/ca/employees/${encodeURIComponent(employeeId)}`),
    /** Who owes on cash advances today, separated employees included. */
    caOwing: () => call<CaOwing[]>('GET', '/api/ca/employees'),
    /** The operating expense accounts a write-off may be charged to (ca.writeoff). */
    caWriteoffAccounts: () => call<{ id: number; code: string; name: string }[]>('GET', '/api/ca/writeoff-accounts'),
    statMonths: () => call<{ month: string; check: SchemeCheck[] }[]>('GET', '/api/stat/months'),
    statMonth: (month: string) => call<StatMonth>('GET', `/api/stat/months/${encodeURIComponent(month)}`),
    statExposure: () => call<Exposure>('GET', '/api/stat/exposure'),
    statEmployerNumbers: () => call<EmployerNumberRow[]>('GET', '/api/stat/employer-numbers'),
    /** Needs a fresh password (step-up). */
    setEmployerNumber: (scheme: UploadScheme, number: string) => call<{ scheme: UploadScheme; number: string; changed: boolean }>('PUT', `/api/stat/employer-numbers/${scheme}`, { number }),
    /** An agency upload file (CSV) for a month: the bytes and the file's name, or the server's plain refusal (a missing ID number names the employee). */
    statUpload: async (month: string, scheme: UploadScheme): Promise<{ filename: string; blob: Blob }> => {
      let res: Response;
      try {
        res = await fetchImpl(`/api/stat/months/${encodeURIComponent(month)}/upload/${scheme.toLowerCase()}`, { method: 'GET', headers: {}, credentials: 'same-origin' });
      } catch {
        throw new ApiError('OFFLINE', 'Cannot reach the server. Check the connection and try again.', 0);
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: string; message?: string; details?: unknown } | null;
        throw new ApiError(data?.code ?? `HTTP_${res.status}`, data?.message ?? 'Something went wrong. Please try again.', res.status, data?.details);
      }
      return { filename: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${scheme}-${month}.csv`, blob: await res.blob() };
    },
    /** D6: what of a payroll run's month is already remitted (the warning before a cancel). */
    runRemitted: (runId: string) => call<{ month: string; remitted: { scheme: Scheme; label: string; numbers: string[] }[] }>('GET', `/api/stat/runs/${encodeURIComponent(runId)}/remitted`),
    settings: () => call<Setting[]>('GET', '/api/settings'),
    /** A new version from today or later (acc.settings.manage); needs a fresh password (step-up). */
    addSetting: (key: string, body: { effectiveFrom: string; value: unknown; reason: string }) => call<SettingVersion>('POST', `/api/settings/${encodeURIComponent(key)}`, body),
    /** Users and roles (sec.users.manage). Every change but the two reads needs a fresh password (step-up). */
    users: () => call<UserRow[]>('GET', '/api/users'),
    addUser: (body: { username: string; displayName: string; roles: string[]; temporaryPassword: string }) => call<{ id: string }>('POST', '/api/users', body),
    setUserRoles: (id: string, roles: string[]) => call<{ ok: true }>('POST', `/api/users/${encodeURIComponent(id)}/roles`, { roles }),
    resetUserPassword: (id: string, temporaryPassword: string) => call<{ ok: true }>('POST', `/api/users/${encodeURIComponent(id)}/reset-password`, { temporaryPassword }),
    setUserActive: (id: string, active: boolean) => call<{ ok: true }>('POST', `/api/users/${encodeURIComponent(id)}/active`, { active }),
    roles: () => call<RoleGrid>('GET', '/api/roles'),
    setRolePermission: (role: string, permissionKey: string, granted: boolean) =>
      call<{ ok: true }>('POST', `/api/roles/${encodeURIComponent(role)}/permissions`, { permissionKey, granted }),
    /** The chart of accounts (acc.coa.view); changes need acc.coa.manage, `v` is the account's version (If-Match). Deactivating needs a fresh password. */
    coaAccounts: () => call<CoaAccount[]>('GET', '/api/acc/accounts'),
    addAccount: (body: NewAccountBody) => call<CoaAccount>('POST', '/api/acc/accounts', body),
    renameAccount: (id: number, v: number, name: string) => call<CoaAccount>('PUT', `/api/acc/accounts/${id}`, { name }, version(v)),
    deactivateAccount: (id: number, v: number) => call<CoaAccount>('POST', `/api/acc/accounts/${id}/deactivate`, undefined, version(v)),
    activateAccount: (id: number, v: number) => call<CoaAccount>('POST', `/api/acc/accounts/${id}/activate`, undefined, version(v)),
    suppliers: () => call<SupplierRow[]>('GET', '/api/pur/suppliers'),
    supplies: () => call<SupplyRow[]>('GET', '/api/pur/supplies'),
    supplierList: (status: PurStatus) => call<SupplierRecord[]>('GET', `/api/pur/suppliers?status=${status}`),
    supplier: (id: string) => call<SupplierRecord>('GET', `/api/pur/suppliers/${encodeURIComponent(id)}`),
    addSupplier: (body: SupplierBody) => call<{ id: string; version: number }>('POST', '/api/pur/suppliers', body),
    updateSupplier: (id: string, v: number, body: SupplierBody) => call<{ success: true; version: number }>('PUT', `/api/pur/suppliers/${encodeURIComponent(id)}`, body, version(v)),
    deactivateSupplier: (id: string, v: number) => call<{ success: true }>('POST', `/api/pur/suppliers/${encodeURIComponent(id)}/deactivate`, undefined, version(v)),
    supplierContacts: (id: string) => call<SupplierContact[]>('GET', `/api/pur/suppliers/${encodeURIComponent(id)}/contacts`),
    addSupplierContact: (id: string, body: ContactBody) => call<{ id: string }>('POST', `/api/pur/suppliers/${encodeURIComponent(id)}/contacts`, body),
    deactivateSupplierContact: (supplierId: string, id: string) => call<{ success: true }>('POST', `/api/pur/suppliers/${encodeURIComponent(supplierId)}/contacts/${encodeURIComponent(id)}/deactivate`),
    supplierPurchaseOrders: (id: string) => call<SupplierPo[]>('GET', `/api/pur/suppliers/${encodeURIComponent(id)}/purchase-orders`),
    supplierReceivingReports: (id: string) => call<SupplierRr[]>('GET', `/api/pur/suppliers/${encodeURIComponent(id)}/receiving-reports`),
    supplyList: (status: PurStatus) => call<SupplyRecord[]>('GET', `/api/pur/supplies?status=${status}`),
    addSupply: (body: SupplyBody) => call<{ id: string; version: number }>('POST', '/api/pur/supplies', body),
    updateSupply: (id: string, v: number, body: SupplyBody) => call<{ success: true; version: number }>('PUT', `/api/pur/supplies/${encodeURIComponent(id)}`, body, version(v)),
    deactivateSupply: (id: string, v: number) => call<{ success: true }>('POST', `/api/pur/supplies/${encodeURIComponent(id)}/deactivate`, undefined, version(v)),
    /** Posted purchase orders with something still to receive (pur.rr.create), for the receiving form. */
    openPurchaseOrders: () => call<PoStatus[]>('GET', '/api/pur/purchase-orders/open'),
    purchaseOrder: (id: string) => call<PoStatus>('GET', `/api/pur/purchase-orders/${encodeURIComponent(id)}`),
    receivingReport: (id: string) => call<RrDetail>('GET', `/api/pur/receiving-reports/${encodeURIComponent(id)}`),
    countSheet: (category: string, date: string) => call<CountSheet>('GET', `/api/inv/count-sheet?${new URLSearchParams({ category, date, format: 'json' })}`),
    expCategories: () => call<ExpCategory[]>('GET', '/api/exp/categories'),
    apLedger: (supplierId: string) => call<ApLedger>('GET', `/api/ap/suppliers/${encodeURIComponent(supplierId)}`),
    apBalances: () => call<ApBalance[]>('GET', '/api/ap/suppliers'),
    eqPeople: () => call<EqPerson[]>('GET', '/api/eq/people'),
    /** What an officer owes the company and is owed (needs eq.ledger.view). */
    officerBalances: (personId: string) => call<{ dueFromCents: number; dueToCents: number }>('GET', `/api/eq/people/${encodeURIComponent(personId)}/ledger`),
    booklets: () => call<BookletUsage[]>('GET', '/api/tax/booklets'),
    booklet: (id: string) => call<BookletUsage>('GET', `/api/tax/booklets/${encodeURIComponent(id)}`),
    registerBooklet: (body: BookletInput) => call<Booklet>('POST', '/api/tax/booklets', body),
    setBookletActive: (id: string, v: number, active: boolean, note: string) => call<Booklet>('POST', `/api/tax/booklets/${encodeURIComponent(id)}/${active ? 'activate' : 'retire'}`, { note }, version(v)),
    salesRegister: (from: string, to: string) => call<SalesRegister>('GET', taxRegisterPath('sales', from, to)),
    withholdingReceived: (from: string, to: string) => call<WithholdingRegister>('GET', taxRegisterPath('withholding-received', from, to)),
    /** A customer's 2307 recorded as pending has come (tax.2307.receive); dated the server's today. */
    mark2307Received: (documentId: string, lineNo: number) =>
      call<{ documentId: string; number: string; lineNo: number; receivedOn: string }>('POST', '/api/tax/2307s/received', { documentId, lineNo }),
    purchasesRegister: (from: string, to: string) => call<PurchasesRegister>('GET', taxRegisterPath('purchases', from, to)),
    ewtRegister: (from: string, to: string) => call<EwtRegister>('GET', taxRegisterPath('ewt', from, to)),
    certificatesToIssue: (year: number, quarter: number) => call<CertificatesToIssue>('GET', taxQuarterPath('2307-to-issue', year, quarter)),
    vatWorksheet: (year: number, quarter: number) => call<VatWorksheet>('GET', taxQuarterPath('2550q', year, quarter)),
    slspSales: (year: number, quarter: number) => call<SlspSales>('GET', taxQuarterPath('slsp/sales', year, quarter)),
    slspPurchases: (year: number, quarter: number) => call<SlspPurchases>('GET', taxQuarterPath('slsp/purchases', year, quarter)),
    sawt: (year: number, quarter: number) => call<Sawt>('GET', taxQuarterPath('sawt', year, quarter)),
    /** A sale with no output VAT is zero-rated, exempt or not a sale (tax.slsp.classify); posts nothing. */
    classifySale: (journalId: string, saleClass: SaleClass, reason: string) =>
      call<{ journalId: string; number: string; saleClass: SaleClass }>('POST', '/api/tax/slsp/sale-class', { journalId, saleClass, reason }),
    ewtMonthWorksheet: (month: string) => call<EwtMonthWorksheet>('GET', ewtMonthPath(month)),
    ewtQuarterWorksheet: (year: number, quarter: number) => call<EwtQuarterWorksheet>('GET', taxQuarterPath('1601eq', year, quarter)),
    incomeTaxWorksheet: (year: number, quarter: number) => call<IncomeTaxWorksheet>('GET', taxQuarterPath('1702q', year, quarter)),
    incomeTaxSettings: () => call<{ current: IncomeTaxSettings; versions: IncomeTaxSettings[] }>('GET', '/api/tax/income-tax-settings'),
    /** A new version from today or later (acc.settings.manage); needs a fresh password (step-up). */
    addIncomeTaxSettings: (body: { effectiveFrom: string; value: IncomeTaxSettingsValue; reason: string }) => call<IncomeTaxSettings>('POST', '/api/tax/income-tax-settings', body),
    annualIncomeTaxWorksheet: (year: number) => call<AnnualIncomeTaxWorksheet>('GET', taxYearPath('1702rt', year)),
    ewtAnnualReturn: (year: number) => call<EwtAnnualReturn>('GET', taxYearPath('1604e', year)),
    incomeTaxDeductions: (year: number) => call<{ year: number; current: DeductionSetting; versions: DeductionSetting[] }>('GET', `/api/tax/income-tax-deductions?${new URLSearchParams({ year: String(year) })}`),
    /** A year's deduction method from today or later (acc.settings.manage); needs a fresh password (step-up). */
    addIncomeTaxDeduction: (body: { year: number; method: DeductionMethod; effectiveFrom: string; reason: string }) => call<DeductionSetting>('POST', '/api/tax/income-tax-deductions', body),
    opening: () => call<OpeningState>('GET', '/api/acc/opening'),
    monthEnd: (month?: string) => call<MonthEndChecklist>('GET', `/api/acc/month-end${month ? `?${new URLSearchParams({ month })}` : ''}`),
    goLiveDecisions: () => call<GoLiveRegister>('GET', '/api/acc/go-live-decisions'),
    recordGoLiveAnswer: (body: { decisionId: string; answer: string; decidedBy: string; decidedOn: string; note: string }) => call<GoLiveRegister>('POST', '/api/acc/go-live-decisions/answers', body),
    /** The accountant's sign-off of a month that has ended; needs a fresh password (step-up). */
    signOffMonth: (month: string, note: string) => call<MonthEndChecklist>('POST', '/api/acc/month-end/sign-off', { month, note }),
    /** Every return with something left to pay (GET /api/tax/payments/due): a VAT close or an opening's 2550Q, EWT withheld or opened. */
    taxPaymentsDue: () => call<{ form: BirForm; period: string; payableCents: number }[]>('GET', '/api/tax/payments/due'),
    /** Both need a fresh password (step-up). */
    setCutoverDate: (date: string) => call<OpeningState>('POST', '/api/acc/opening/cutover-date', { date }),
    closeOpening: () => call<OpeningState>('POST', '/api/acc/opening/close', {}),
    taxCalendar: (from: string, to: string) => call<TaxDeadline[]>('GET', `/api/tax/calendar?${new URLSearchParams({ from, to })}`),
    accounts: () => call<Account[]>('GET', '/api/acc/accounts'),
    loans: (status?: 'posted' | 'cancelled') => call<LoanRow[]>('GET', `/api/loan/loans${status ? `?status=${status}` : ''}`),
    financedAssets: () => call<FinancedPurchase[]>('GET', '/api/loan/financed-assets'),
    assetClasses: () => call<AssetClass[]>('GET', '/api/fa/classes'),
    assets: () => call<AssetRow[]>('GET', '/api/fa/assets'),
    asset: (id: string) => call<AssetPage>('GET', `/api/fa/assets/${encodeURIComponent(id)}`),
    depreciationGaps: () => call<DepreciationGaps>('GET', '/api/fa/depreciation-gaps'),
    /** The whole register, switched-off people included. */
    eqRegister: () => call<EqPersonRecord[]>('GET', '/api/eq/people?all=1'),
    eqBalances: () => call<EqBalance[]>('GET', '/api/eq/balances'),
    eqLedger: (personId: string) => call<EqLedger>('GET', `/api/eq/people/${encodeURIComponent(personId)}/ledger`),
    eqOwnerMoney: (personId: string) => call<EqDocument[]>('GET', `/api/eq/people/${encodeURIComponent(personId)}/owner-money`),
    eqOfficerTransactions: (personId: string) => call<EqDocument[]>('GET', `/api/eq/people/${encodeURIComponent(personId)}/officer-transactions`),
    loan: (id: string) => call<LoanDetail>('GET', `/api/loan/loans/${encodeURIComponent(id)}`),
    loanPayments: (id: string) => call<LoanPayment[]>('GET', `/api/loan/loans/${encodeURIComponent(id)}/payments`),
    loansLate: () => call<LateInstalment[]>('GET', '/api/loan/late'),
    sizerBoard: () => call<SizerBoard>('GET', '/api/szr/overview'),
    /** Lend a set that is in the shop to a customer; the date out is the server's today. */
    sizerLend: (body: { setId: string; customerId: string; expectedReturnDate: string }) => call<{ id: string; version: number }>('POST', '/api/szr/loans', body),
    /** Take a set back, with the loan's version (If-Match); it is back in the shop, or lost or damaged. */
    sizerReturn: (loanId: string, v: number, body: { status: 'in shop' | 'lost or damaged'; conditionOnReturn: string }) =>
      call<{ success: true }>('POST', `/api/szr/loans/${encodeURIComponent(loanId)}/return`, body, version(v)),
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
    bakApply: (stagedId: string) => call<{ file: string; restartNeeded: boolean; restarting: boolean; message: string }>('POST', '/api/bak/restore/apply', { stagedId }),
    bakRestored: () => call<{ restored: { file: string; at: string } | null }>('GET', '/api/bak/restored').then((r) => r.restored),
    comSettings: () => call<EmailSettings>('GET', '/api/com/settings'),
    /** Needs a fresh password (step-up). Leave `appPassword` out to keep the saved one. */
    comSaveSettings: (v: number, body: EmailSettingsInput) => call<EmailSettings>('PUT', '/api/com/settings', body, version(v)),
    comTestEmail: () => call<{ ok: true; message: string }>('POST', '/api/com/test-email', {}),
    comOutbox: (status?: OutboxRow['status']) => call<Outbox>('GET', `/api/com/outbox${status ? `?status=${status}` : ''}`),
    comResend: (id: string) => call<{ success: true }>('POST', `/api/com/outbox/${encodeURIComponent(id)}/resend`, {}),
    comEmailStatement: (b: { customerId: string; from: string; to: string }) => call<{ id: string }>('POST', '/api/com/statements', b),
    migUploads: () => call<{ uploads: MigUpload[] }>('GET', '/api/mig/uploads').then((r) => r.uploads),
    /** The kind is not sent: the server reads it from the columns. */
    migUpload: (filename: string, csv: string) => call<MigUploaded>('POST', '/api/mig/upload', { filename, csv }),
    migReview: (uploadId: string) => call<{ rows: MigRow[] }>('GET', `/api/mig/uploads/${encodeURIComponent(uploadId)}/review`).then((r) => r.rows),
    migAccept: (rowId: string) => call<{ success: true }>('POST', `/api/mig/rows/${encodeURIComponent(rowId)}/accept`, {}),
    migFix: (rowId: string, manualData: Record<string, string | number>) => call<{ success: true }>('POST', `/api/mig/rows/${encodeURIComponent(rowId)}/fix`, { manualData }),
    migMerge: (rowId: string, mergeIntoRowId: string) => call<{ success: true }>('POST', `/api/mig/rows/${encodeURIComponent(rowId)}/merge`, { mergeIntoRowId }),
    /** The reason is sent for the day the server keeps it; today the server ignores it. */
    migExclude: (rowId: string, reason: string) => call<{ success: true }>('POST', `/api/mig/rows/${encodeURIComponent(rowId)}/exclude`, { reason }),
    migDryRun: (uploadId: string) => call<DryRunResult>('POST', `/api/mig/uploads/${encodeURIComponent(uploadId)}/dry-run`, {}),
    /** Needs a fresh password (step-up) and mig.commit. */
    migCommit: (uploadId: string, expectedMeasurementCellTenths: number) => call<MigCommitResult>('POST', `/api/mig/uploads/${encodeURIComponent(uploadId)}/commit`, { expectedMeasurementCellTenths }),
    migCommitted: (uploadId: string) => call<{ counts: MigCommitResult['counts']; checksums: { measurementCellTenths: number }; clearedAt: string | null }>('GET', `/api/mig/uploads/${encodeURIComponent(uploadId)}/commit`),
    /** Needs a fresh password (step-up) and mig.commit. */
    migClearStaging: (uploadId: string) => call<{ success: true; rowsCleared: number }>('POST', `/api/mig/uploads/${encodeURIComponent(uploadId)}/clear-staging`, {}),
  };
}

export type Api = ReturnType<typeof createApi>;
export const api = createApi();

/** One key per thing the user confirmed, so a retried click never records twice. */
export const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();
