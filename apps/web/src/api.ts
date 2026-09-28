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
export interface JsonSchema { type?: string; title?: string; enum?: unknown[]; maxLength?: number; properties?: Record<string, JsonSchema>; required?: string[] }
export interface DocTypeInfo { key: string; module: string; title: string; canCreate: boolean; canPost: boolean; canCancel: boolean; inputJsonSchema: JsonSchema }
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
export interface CaStatus { employeeId: string; name: string; outstandingCents: number; installmentCents: number; open: { documentId: string; number: string; amountCents: number; installmentCents: number; openCents: number }[] }
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
export interface RemittanceInput { scheme: Scheme; month: string; cashPlaceId: number; amountCents: number; penaltyCents?: number; reference: string; note?: string }

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
    health: () => call<{ serverTime: string }>('GET', '/api/health'),
    docTypes: () => call<DocTypeInfo[]>('GET', '/api/doc-types'),
    report: <T>(path: string) => call<T>('GET', `/api/rpt/${path}`),
    list: (type: string, q: { status?: string; before?: string; limit?: number } = {}) =>
      call<DocHeader[]>('GET', doc(type, `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`)),
    get: (type: string, id: string) => call<DocDetail>('GET', one(type, id)),
    /** `businessDate` only for a type that may be backdated, by someone allowed to (the payroll run's period end). */
    preview: (type: string, input: unknown, businessDate?: string) => call<Preview>('POST', doc(type, '/preview'), { input, ...(businessDate ? { businessDate } : {}) }),
    post: (type: string, input: unknown, expectedTotalCents: number, key: string, businessDate?: string) =>
      call<PostResult>('POST', doc(type, '/post'), { input, expectedTotalCents, ...(businessDate ? { businessDate } : {}) }, idem(key)),
    cancel: (type: string, id: string, reason: string, key: string) => call<unknown>('POST', one(type, id, '/cancel'), { reason }, idem(key)),
    reissue: (type: string, id: string, input: unknown, expectedTotalCents: number, reason: string, key: string) =>
      call<PostResult>('POST', one(type, id, '/reissue'), { input, expectedTotalCents, reason }, idem(key)),
    drafts: (type: string) => call<Draft[]>('GET', `/api/drafts?type=${encodeURIComponent(type)}`),
    createDraft: (docType: string, payload: Draft['payload']) => call<{ id: string; version: number }>('POST', '/api/drafts', { docType, payload }),
    saveDraft: (id: string, version: number, payload: Draft['payload']) =>
      call<{ id: string; version: number }>('PUT', `/api/drafts/${encodeURIComponent(id)}`, { payload }, { 'if-match': String(version) }),
    discardDraft: (id: string) => call<unknown>('POST', `/api/drafts/${encodeURIComponent(id)}/discard`),
    cashPlaces: () => call<CashPlace[]>('GET', '/api/cash/places'),
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
    statMonths: () => call<{ month: string; check: SchemeCheck[] }[]>('GET', '/api/stat/months'),
    statMonth: (month: string) => call<StatMonth>('GET', `/api/stat/months/${encodeURIComponent(month)}`),
    /** D6: what of a payroll run's month is already remitted (the warning before a cancel). */
    runRemitted: (runId: string) => call<{ month: string; remitted: { scheme: Scheme; label: string; numbers: string[] }[] }>('GET', `/api/stat/runs/${encodeURIComponent(runId)}/remitted`),
  };
}

export type Api = ReturnType<typeof createApi>;
export const api = createApi();

/** One key per thing the user confirmed, so a retried click never records twice. */
export const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();
