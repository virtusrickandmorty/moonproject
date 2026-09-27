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
export interface Preview { totalCents: number; summary: string; issues: Issue[]; journal?: JournalLine[] | null }
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
    list: (type: string, q: { status?: string; before?: string; limit?: number } = {}) =>
      call<DocHeader[]>('GET', doc(type, `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`)),
    get: (type: string, id: string) => call<DocDetail>('GET', one(type, id)),
    preview: (type: string, input: unknown) => call<Preview>('POST', doc(type, '/preview'), { input }),
    post: (type: string, input: unknown, expectedTotalCents: number, key: string) => call<PostResult>('POST', doc(type, '/post'), { input, expectedTotalCents }, idem(key)),
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
  };
}

export type Api = ReturnType<typeof createApi>;
export const api = createApi();

/** One key per thing the user confirmed, so a retried click never records twice. */
export const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();
