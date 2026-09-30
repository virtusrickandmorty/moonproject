/**
 * How fast the app answers on three busy years (PERF). Left out of `npm test`; run with `npm run perf`.
 *
 * It opens the database `npm run perf-data` built (data/perf/perf.db, or PERF_DB), signs in as the owner and opens every list and
 * report the way a screen does: over HTTP, for the last month of the data and for its last whole year. A month must answer within
 * 2 seconds, a year within 5, and the search within 300 ms. The first answer is the one that counts (nothing is warmed up first).
 * Every time is printed as a table and written to PERF_OUT (data/perf/last-run.json) so a before and after can be compared.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manilaDate } from '@moonproject/shared';
import { buildApp } from '../src/app.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { loadModules } from '../src/modules/load.ts';
import { SESSION_COOKIE } from '../src/engine/security/sessions.ts';
import { PERF_DB, type PerfSummary } from '../src/platform/practice/perf-data.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const DB_FILE = resolve(ROOT, process.env.PERF_DB ?? PERF_DB);
const OUT_FILE = resolve(ROOT, process.env.PERF_OUT ?? 'data/perf/last-run.json');
const MONTH_MS = 2000;
const YEAR_MS = 5000;
const SEARCH_MS = 300;
const GIVE_UP_MS = 20_000;

interface Sample { as: 'owner' | 'accountant'; name: string; scope: 'month' | 'year' | 'list' | 'search'; url: string; note?: string; ms: number; limitMs: number; status: number; bytes: number; rows: number | null }
const samples: Sample[] = [];

interface Ctx {
  month: { from: string; to: string; ym: string; quarter: { year: number; quarter: number } };
  year: { from: string; to: string; y: number };
  customerId: string; customerName: string; employeeId: string; cashPlaceId: number; accountId: number; runId: string; jobOrderId: string;
  search: { customer: string; jobOrder: string; document: string; wearer: string; supplier: string; employee: string };
  payslipMonth: string;
}

const qs = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A report or list, and the address it is opened at for the month and for the year. `list` ones have no dates: they are timed once. */
interface Screen { name: string; month?: (c: Ctx) => string; year?: (c: Ctx) => string; list?: (c: Ctx) => string;
  /** The screen shows this many rows (or, for the BIR books, loose pages) at a time and asks for them with ?limit; the CSV file has them all. */
  page?: number;
  /** A limit of its own for a check that reads all the history there is (the audit chain and the ledger checks): the year's. */
  budget?: number }
/** The screens' page size (PAGE_ROWS in the web app) and the BIR books' (five loose pages of twenty rows). */
const ROWS = 100;
const LOOSE = 5;
const paging = (screen: Screen, url: string) => (screen.page ? `${url}${url.includes('?') ? '&' : '?'}limit=${screen.page}` : url);
const shown = (n: number, screen: Screen): Screen => ({ ...screen, page: n });
const range = (path: string, extra: Record<string, string | number> = {}): Pick<Screen, 'month' | 'year'> => ({
  month: (c) => `${path}?${qs({ from: c.month.from, to: c.month.to, ...extra })}`,
  year: (c) => `${path}?${qs({ from: c.year.from, to: c.year.to, ...extra })}`,
});
const asOf = (path: string): Pick<Screen, 'month' | 'year'> => ({
  month: (c) => `${path}?${qs({ asOf: c.month.to })}`,
  year: (c) => `${path}?${qs({ asOf: c.year.to })}`,
});
/** A quarterly return: the month's quarter, and for the year the last quarter the return exists for (the 1702-Q is filed for the first three). */
const quarter = (path: string, lastQuarter = 4): Pick<Screen, 'month' | 'year'> => ({
  month: (c) => `${path}?${qs({ year: c.month.quarter.year, quarter: Math.min(c.month.quarter.quarter, lastQuarter) })}`,
  year: (c) => `${path}?${qs({ year: c.year.y, quarter: lastQuarter })}`,
});
const yearly = (path: string): Pick<Screen, 'month' | 'year'> => ({ month: (c) => `${path}?${qs({ year: c.year.y })}`, year: (c) => `${path}?${qs({ year: c.year.y })}` });
const list = (name: string, url: string | ((c: Ctx) => string)): Screen => ({ name, list: typeof url === 'string' ? () => url : url });

const SCREENS: Screen[] = [
  // Sales, collections and receivables (RPT)
  { name: 'RPT collections register', ...range('/api/rpt/collections-register') },
  { name: 'RPT sales by period', ...range('/api/rpt/sales-by-period') },
  { name: 'RPT deposits held', ...asOf('/api/rpt/deposits-held') },
  { name: 'RPT AR aging', ...asOf('/api/rpt/ar-aging') },
  list('RPT job order follow-up', '/api/rpt/job-order-follow-up'),
  list('RPT customers', '/api/rpt/customers'),
  { name: 'RPT customer statement', ...{ month: (c: Ctx) => `/api/rpt/customer-statement?${qs({ from: c.month.from, to: c.month.to, customerId: c.customerId })}`,
    year: (c: Ctx) => `/api/rpt/customer-statement?${qs({ from: c.year.from, to: c.year.to, customerId: c.customerId })}` } },
  // Books and statements
  list('RPT accounts', '/api/rpt/accounts'),
  { name: 'RPT general journal', ...range('/api/rpt/journal') },
  { name: 'RPT general ledger (one account)', month: (c) => `/api/rpt/ledger?${qs({ from: c.month.from, to: c.month.to, accountId: c.accountId })}`,
    year: (c) => `/api/rpt/ledger?${qs({ from: c.year.from, to: c.year.to, accountId: c.accountId })}` },
  { name: 'RPT general ledger (all accounts)', ...range('/api/rpt/ledger') },
  { name: 'RPT trial balance', ...asOf('/api/rpt/trial-balance') },
  { name: 'RPT income statement', ...range('/api/rpt/income-statement') },
  { name: 'RPT income statement vs last year', ...range('/api/rpt/income-statement', { compare: 'last_year' }) },
  { name: 'RPT balance sheet', ...asOf('/api/rpt/balance-sheet') },
  { name: 'RPT cash flow', ...range('/api/rpt/cash-flow') },
  { name: 'RPT AP aging', ...asOf('/api/rpt/ap-aging') },
  { name: 'RPT purchases', ...range('/api/rpt/purchases') },
  list('RPT purchase orders', '/api/rpt/purchase-orders'),
  list('RPT received not billed', '/api/rpt/received-not-billed'),
  { name: 'RPT cash position', ...asOf('/api/rpt/cash-position') },
  { name: 'RPT transfers', ...range('/api/rpt/transfers') },
  { name: 'RPT cash counts', ...range('/api/rpt/cash-counts') },
  { name: 'RPT fixed assets', ...asOf('/api/rpt/assets') },
  list('RPT late entries', '/api/rpt/late-entries'),
  list('RPT cancellations', '/api/rpt/cancellations'),
  { name: 'RPT exceptions', ...asOf('/api/rpt/exceptions') },
  { name: 'RPT sign-ins', ...range('/api/rpt/sign-ins') },
  // BIR books
  ...['cash-receipts', 'cash-disbursements', 'sales', 'purchases', 'general-journal'].map((book): Screen => ({ name: `RPT BIR book ${book}`, ...range(`/api/rpt/bir-books/${book}`) })),
  { name: 'RPT BIR book general-ledger', ...range('/api/rpt/bir-books/general-ledger') },
  // Payroll and production
  { name: 'RPT payroll register', month: (c) => `/api/rpt/payroll-register?${qs({ month: c.month.ym })}`, year: (c) => `/api/rpt/payroll-register?${qs({ month: `${c.year.y}-06` })}` },
  { name: 'RPT piece work', ...range('/api/rpt/piece-work') },
  { name: 'RPT labor cost', ...range('/api/rpt/labor-cost') },
  { name: 'RPT 13th-month register', ...yearly('/api/rpt/thirteenth-register') },
  list('RPT production board', '/api/rpt/production-board'),
  { name: 'RPT production activity', ...range('/api/rpt/production-activity') },
  { name: 'RPT production throughput', ...range('/api/rpt/production-throughput') },
  { name: 'RPT worker output', ...range('/api/rpt/worker-output') },
  { name: 'RPT production timing', ...asOf('/api/rpt/production-timing') },
  { name: 'RPT lead time', ...asOf('/api/rpt/lead-time') },
  { name: 'RPT late jobs', ...asOf('/api/rpt/late-jobs') },
  list('RPT job margin', '/api/rpt/job-margin'),
  // TAX registers and returns
  { name: 'TAX sales register', ...range('/api/tax/registers/sales') },
  { name: 'TAX withholding received register', ...range('/api/tax/registers/withholding-received') },
  { name: 'TAX purchases register', ...range('/api/tax/registers/purchases') },
  { name: 'TAX EWT register', ...range('/api/tax/registers/ewt') },
  { name: 'TAX 2307 to issue', ...quarter('/api/tax/2307-to-issue') },
  { name: 'TAX 2550Q', ...quarter('/api/tax/2550q') },
  { name: 'TAX 1601-EQ', ...quarter('/api/tax/1601eq') },
  { name: 'TAX 1702Q', ...quarter('/api/tax/1702q', 3) },
  { name: 'TAX SLSP sales', ...quarter('/api/tax/slsp/sales') },
  { name: 'TAX SLSP purchases', ...quarter('/api/tax/slsp/purchases') },
  { name: 'TAX SAWT', ...quarter('/api/tax/sawt') },
  { name: 'TAX VAT summary', ...quarter('/api/tax/vat-summary') },
  // The 0619-E is filed for the first two months of a quarter: the first month of the month's quarter, and November for the year.
  { name: 'TAX 0619-E', month: (c) => `/api/tax/0619e?${qs({ month: `${c.month.quarter.year}-${String(c.month.quarter.quarter * 3 - 2).padStart(2, '0')}` })}`,
    year: (c) => `/api/tax/0619e?${qs({ month: `${c.year.y}-11` })}` },
  { name: 'TAX 1702-RT', ...yearly('/api/tax/1702rt') },
  { name: 'TAX income tax deductions', ...yearly('/api/tax/income-tax-deductions') },
  { name: 'TAX 1604-E', ...yearly('/api/tax/1604e') },
  { name: 'TAX calendar', ...range('/api/tax/calendar') },
  list('TAX booklets', '/api/tax/booklets'),
  list('TAX income tax settings', '/api/tax/income-tax-settings'),
  list('TAX payments due', '/api/tax/payments/due'),
  // Customers
  list('CUS customers, first page', '/api/cus/customers?limit=50'),
  list('CUS customers, deep page', '/api/cus/customers?limit=50&offset=5000'),
  list('CUS customers, search', '/api/cus/customers?limit=50&search=Santos'),
  list('CUS one customer', (c) => `/api/cus/customers/${c.customerId}`),
  list('CUS sizes', '/api/cus/sizes'),
  // Job orders and collections lookups
  list('JO orders to release', '/api/jo/pick/orders'),
  list('JO orders to release, by name', (c) => `/api/jo/pick/orders?${qs({ q: c.customerName.slice(0, 8) })}`),
  list('JO releases awaiting invoice', '/api/jo/pick/releases'),
  list('COL open items of a customer', (c) => `/api/col/customers/${c.customerId}/open-items`),
  list('COL invoices of a customer', (c) => `/api/col/customers/${c.customerId}/invoices`),
  // Payroll
  list('PAY periods', '/api/pay/periods?payGroup=SEMI_MONTHLY'),
  list('PAY payslips of a run', (c) => `/api/pay/runs/${c.runId}/payslips`),
  list('PAY runs to release', '/api/pay/runs/to-release'),
  list('PAY loans', '/api/pay/loans'),
  list('PAY prior pay', (c) => `/api/pay/prior?${qs({ year: c.year.y })}`),
  list('PAY statutory tables', '/api/pay/statutory'),
  list('PAY 2316', (c) => `/api/pay/2316?${qs({ year: c.year.y })}`),
  list('PAY alphalist', (c) => `/api/pay/alphalist?${qs({ year: c.year.y })}`),
  list('PAY 13th-month years', '/api/pay/thirteenth/years'),
  // Employees, production, stat
  list('EMP employees', '/api/emp/employees'),
  list('EMP leave balances', (c) => `/api/emp/leave-balances?${qs({ year: c.year.y })}`),
  { name: 'EMP attendance', month: range('/api/emp/attendance').month },
  list('EMP holidays', (c) => `/api/emp/holidays?${qs({ year: c.year.y })}`),
  list('EMP one employee', (c) => `/api/emp/employees/${c.employeeId}`),
  list('PRD board', '/api/prd/board'),
  list('PRD TV board', '/api/prd/tv'),
  list('PRD workers', '/api/prd/workers'),
  list('STAT months', '/api/stat/months'),
  list('STAT exposure', '/api/stat/exposure'),
  // Cash, ledger set-up, other registers
  list('CASH places', '/api/cash/places'),
  { name: 'CASH cash book', month: (c) => `/api/cash/places/${c.cashPlaceId}/book?${qs({ from: c.month.from, to: c.month.to })}`,
    year: (c) => `/api/cash/places/${c.cashPlaceId}/book?${qs({ from: c.year.from, to: c.year.to })}` },
  list('CASH bank reconciliations', '/api/cash/recons'),
  { name: 'CAL calendar', month: range('/api/cal').month },
  list('ACC chart of accounts', '/api/acc/accounts'),
  list('ACC month-end checklist', (c) => `/api/acc/month-end?${qs({ month: c.month.ym })}`),
  list('ACC opening balances', '/api/acc/opening'),
  list('ACC settings', '/api/settings'),
  list('ACC go-live decisions', '/api/acc/go-live-decisions'),
  list('DASH home', '/api/dash/home'),
  list('DASH owner health', '/api/dash/owner-health'),
  list('DASH notifications (home panel)', '/api/dash/notifications?limit=8&offset=0&unread=1'),
  list('DASH notifications (all, first page)', '/api/dash/notifications?limit=50&offset=0'),
  list('AUD log', '/api/aud/log'),
  { name: 'AUD integrity check', list: () => '/api/aud/integrity', budget: YEAR_MS },
  list('AUD users', '/api/aud/users'),
  list('SZR overview', '/api/szr/overview'),
  list('SZR sets', '/api/szr/sets'),
  list('SZR loans', '/api/szr/loans'),
  list('SZR overdue loans', '/api/szr/loans/overdue'),
  list('PUR suppliers', '/api/pur/suppliers'),
  list('PUR supplies', '/api/pur/supplies'),
  list('PUR open purchase orders', '/api/pur/purchase-orders/open'),
  list('AP suppliers', '/api/ap/suppliers'),
  list('EXP categories', '/api/exp/categories'),
  list('FA assets', '/api/fa/assets'),
  list('LOAN loans', '/api/loan/loans'),
  list('EQ people', '/api/eq/people'),
  list('EQ balances', '/api/eq/balances'),
  list('CAT items', '/api/cat/items'),
  list('RATE rates', '/api/rate/rates'),
  list('COM outbox', '/api/com/outbox'),
  list('USERS', '/api/users'),
];

const PAGED_ROWS = ['RPT collections register', 'RPT sales by period', 'RPT AR aging', 'RPT job order follow-up', 'RPT general journal',
  'RPT general ledger (one account)', 'RPT general ledger (all accounts)', 'RPT production timing', 'RPT lead time', 'RPT late jobs', 'RPT job margin',
  'RPT labor cost', 'TAX sales register', 'TAX withholding received register', 'TAX purchases register', 'TAX EWT register'];
const PAGED_SCREENS: Screen[] = SCREENS.map((sc) => PAGED_ROWS.includes(sc.name) ? shown(ROWS, sc) : sc.name.startsWith('RPT BIR book') ? shown(LOOSE, sc) : sc);

const ready = existsSync(DB_FILE) && existsSync(`${DB_FILE}.json`);
describe.skipIf(!ready)('three busy years', () => {
  let app: FastifyInstance;
  let db: Db;
  let cookies: Record<string, string>;
  let accountantCookies: Record<string, string>;
  let ctx: Ctx;
  let docTypes: { key: string; title: string }[];

  async function time(name: string, scope: Sample['scope'], url: string, limitMs: number): Promise<Sample> {
    // The owner's screens are timed as the owner; the few the accountant alone may open (year-end pay) as the accountant.
    let as: Sample['as'] = 'owner';
    let at = performance.now();
    let res = await app.inject({ method: 'GET', url, cookies });
    if (res.statusCode === 403) {
      as = 'accountant';
      at = performance.now();
      res = await app.inject({ method: 'GET', url, cookies: accountantCookies });
    }
    const ms = performance.now() - at;
    let rows: number | null = null;
    try {
      const body = res.json() as unknown;
      if (Array.isArray(body)) rows = body.length;
      else if (body && typeof body === 'object') {
        const arrays = Object.values(body as Record<string, unknown>).filter(Array.isArray) as unknown[][];
        rows = arrays.length ? Math.max(...arrays.map((a) => a.length)) : null;
      }
    } catch { /* a CSV or other text answer */ }
    const sample = { as, name, scope, url, ms, limitMs, status: res.statusCode, bytes: Buffer.byteLength(res.body), rows };
    samples.push(sample);
    process.stderr.write(`${sample.ms.toFixed(0).padStart(7)} ms  ${scope.padEnd(6)} ${name}\n`); // so a slow one shows while the rest run
    return sample;
  }
  const check = (s: Sample) => {
    expect(s.status, `${s.name} ${s.url}: ${s.status}`).toBe(200);
    expect(s.ms, `${s.name} answered in ${s.ms.toFixed(0)} ms, the limit is ${s.limitMs} ms`).toBeLessThanOrEqual(s.limitMs);
  };

  beforeAll(async () => {
    const meta = JSON.parse(readFileSync(`${DB_FILE}.json`, 'utf8')) as PerfSummary;
    db = openDb(DB_FILE);
    const first = Date.parse(`${meta.options.start}T02:00:00Z`);
    const lastDate = manilaDate(new Date(first + (meta.options.days - 1) * 86_400_000));
    const clock = fixedClock(new Date(first + (meta.options.days - 1) * 86_400_000 + 4 * 3_600_000).toISOString()); // 2 p.m. on the last day
    const built = buildApp({ db, clock, modules: await loadModules(), config: { scryptN: 2 ** 10 } });
    app = built.app;
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'perf-owner', password: meta.passwords.owner } });
    expect(login.statusCode).toBe(200);
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    // Pay and year-end screens ask the owner to confirm the password again first.
    const step = await app.inject({ method: 'POST', url: '/api/auth/step-up', cookies,
      headers: { 'x-csrf-token': (login.json() as { csrfToken: string }).csrfToken }, payload: { password: meta.passwords.owner } });
    expect(step.statusCode).toBe(200);
    const accountant = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'perf-accountant', password: meta.passwords.accountant } });
    expect(accountant.statusCode).toBe(200);
    accountantCookies = { [SESSION_COOKIE]: accountant.cookies.find((c) => c.name === SESSION_COOKIE)!.value };

    const [ly, lm] = lastDate.split('-').map(Number) as [number, number];
    const ym = `${ly}-${String(lm).padStart(2, '0')}`;
    const one = <T,>(sql: string) => db.prepare(sql).get() as T;
    const busy = one<{ customer_id: string; name: string }>(`SELECT o.customer_id, o.customer_name AS name FROM jo_orders o GROUP BY o.customer_id ORDER BY COUNT(*) DESC, o.customer_id LIMIT 1`);
    const middle = (sql: string, from: string) => db.prepare(`${sql} OFFSET (SELECT COUNT(*) / 2 FROM ${from})`).pluck().get() as string;
    const names = middle('SELECT display_name FROM cus_customers ORDER BY display_name LIMIT 1', 'cus_customers');
    ctx = {
      month: { from: `${ym}-01`, to: `${ym}-${lastDay(ly, lm)}`, ym, quarter: { year: ly, quarter: Math.ceil(lm / 3) } },
      year: { from: `${ly}-01-01`, to: `${ly}-12-31`, y: ly },
      customerId: busy.customer_id, customerName: busy.name ?? names,
      employeeId: one<{ id: string }>('SELECT id FROM emp_employees ORDER BY id LIMIT 1').id,
      cashPlaceId: one<{ id: number }>(`SELECT id FROM accounts WHERE is_cash_place = 1 AND name LIKE 'Perf counter till%'`).id,
      accountId: one<{ id: number }>(`SELECT id FROM accounts WHERE role_key = 'AR_TRADE'`).id,
      runId: one<{ id: string }>(`SELECT id FROM documents WHERE doc_type = 'pay.run' ORDER BY business_date DESC LIMIT 1`).id,
      jobOrderId: one<{ id: string }>(`SELECT id FROM documents WHERE doc_type = 'jo.job_order' ORDER BY business_date DESC LIMIT 1`).id,
      payslipMonth: ym,
      search: {
        customer: names.split(' ')[0]!, wearer: 'wearer 12', supplier: 'Fabric', employee: 'Ana',
        jobOrder: middle(`SELECT number FROM documents WHERE doc_type = 'jo.job_order' ORDER BY number LIMIT 1`, `documents WHERE doc_type = 'jo.job_order'`),
        document: middle(`SELECT number FROM documents WHERE doc_type = 'col.collection' ORDER BY number LIMIT 1`, `documents WHERE doc_type = 'col.collection'`),
      },
    };
    docTypes = (await app.inject({ method: 'GET', url: '/api/doc-types', cookies })).json() as { key: string; title: string }[];
  }, 120_000);

  afterAll(async () => {
    if (samples.length) {
      const table = ['| Screen | Scope | Time (ms) | Limit (ms) | Rows | Size (KB) |', '|---|---|---:|---:|---:|---:|',
        ...samples.map((s) => `| ${s.name}${s.as === 'owner' ? '' : ' (accountant)'} | ${s.scope} | ${Number.isFinite(s.ms) ? s.ms.toFixed(0) : 'not tried'}${s.status === 200 ? '' : ` (HTTP ${s.status})`} | ${s.limitMs} | ${s.rows ?? ''} | ${(s.bytes / 1024).toFixed(0)} |`)];
      console.log(`\n${table.join('\n')}\n`);
      mkdirSync(dirname(OUT_FILE), { recursive: true });
      writeFileSync(OUT_FILE, `${JSON.stringify({ at: new Date().toISOString(), samples }, null, 2)}\n`);
    }
    await app?.close();
    db?.close();
  });

  describe.each(PAGED_SCREENS)('$name', (screen) => {
    if (screen.month) it('one month', async () => check(await time(screen.name, 'month', paging(screen, screen.month!(ctx)), MONTH_MS)));
    if (screen.year) it('one year', async () => {
      // A synchronous query cannot be interrupted: when the month took over 20 s, the year is not tried (it would run for hours).
      const month = samples.find((s) => s.name === screen.name && s.scope === 'month');
      if (month && month.ms > GIVE_UP_MS) {
        const skipped: Sample = { ...month, scope: 'year', limitMs: YEAR_MS, ms: Number.POSITIVE_INFINITY, note: `not tried: the month took ${(month.ms / 1000).toFixed(0)} s` };
        samples.push(skipped);
        process.stderr.write(`    not tried  year   ${screen.name}\n`);
        return check(skipped);
      }
      check(await time(screen.name, 'year', paging(screen, screen.year!(ctx)), YEAR_MS));
    });
    if (screen.list) it('the list', async () => check(await time(screen.name, 'list', paging(screen, screen.list!(ctx)), screen.budget ?? MONTH_MS)));
  });

  // The generic lists every document type gets, first page and a page far down.
  it('every document list, first page and a deep page', async () => {
    expect(docTypes.length).toBeGreaterThan(10);
    const slow: string[] = [];
    for (const t of docTypes) {
      const first = await time(`DOC list ${t.key}`, 'list', `/api/docs/${t.key}?limit=200`, MONTH_MS);
      if (first.status !== 200 || first.ms > MONTH_MS) slow.push(`${first.name}: ${first.status} in ${first.ms.toFixed(0)} ms`);
      const rows = (JSON.parse((await app.inject({ method: 'GET', url: `/api/docs/${t.key}?limit=200`, cookies })).body) as { postedAt?: string }[]);
      const before = rows[rows.length - 1]?.postedAt;
      if (before) {
        const deep = await time(`DOC list ${t.key}, next page`, 'list', `/api/docs/${t.key}?${qs({ limit: 200, before })}`, MONTH_MS);
        if (deep.status !== 200 || deep.ms > MONTH_MS) slow.push(`${deep.name}: ${deep.status} in ${deep.ms.toFixed(0)} ms`);
      }
    }
    expect(slow).toEqual([]);
  });

  // The whole report as a file (every row, no page): the Export CSV link of a year.
  it.each([
    ['collections register', (c: Ctx) => `/api/rpt/collections-register?${qs({ from: c.year.from, to: c.year.to, format: 'csv' })}`],
    ['sales by period', (c: Ctx) => `/api/rpt/sales-by-period?${qs({ from: c.year.from, to: c.year.to, format: 'csv' })}`],
    ['general journal', (c: Ctx) => `/api/rpt/journal?${qs({ from: c.year.from, to: c.year.to, format: 'csv' })}`],
    ['AR aging', (c: Ctx) => `/api/rpt/ar-aging?${qs({ asOf: c.year.to, format: 'csv' })}`],
    ['TAX sales register', (c: Ctx) => `/api/tax/registers/sales?${qs({ from: c.year.from, to: c.year.to, format: 'csv' })}`],
    ['BIR sales book', (c: Ctx) => `/api/rpt/bir-books/sales?${qs({ from: c.year.from, to: c.year.to, format: 'csv' })}`],
  ] as const)('CSV file of a year: %s', async (name, url) => check(await time(`CSV ${name}`, 'year', url(ctx), YEAR_MS)));

  it('a job order and a payslip run open', async () => {
    check(await time('DOC one job order', 'list', `/api/docs/jo.job_order/${ctx.jobOrderId}`, MONTH_MS));
    check(await time('DOC one pay run', 'list', `/api/docs/pay.run/${ctx.runId}`, MONTH_MS));
  });

  // The search (NAV): a customer, a wearer, a job order number, a document number, a supplier and an employee.
  it.each(['customer', 'wearer', 'jobOrder', 'document', 'supplier', 'employee'] as const)('search: %s', async (kind) => {
    check(await time(`NAV search ${kind}`, 'search', `/api/nav/search?${qs({ q: ctx.search[kind] })}`, SEARCH_MS));
  });
});

describe.skipIf(ready)('three busy years (no database)', () => {
  it('needs the database: run `npm run perf-data` first', () => {
    throw new Error(`No perf database at ${DB_FILE}. Build one with: npm run perf-data (about 30 minutes).`);
  });
});
