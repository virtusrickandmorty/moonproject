/**
 * Paging (PERF): a page of a long list or report is a slice of the answer without paging, and every figure of the report (totals,
 * balances, running totals) is the one for all the rows. Checked over a few weeks of the three-years data, through the HTTP API.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { loadModules } from '../src/modules/load.ts';
import { SESSION_COOKIE } from '../src/engine/security/sessions.ts';
import { pageAsked, paged, pagedLedger } from '../src/platform/paging.ts';
import { createPerfData } from '../src/platform/practice/perf-data.ts';

describe('paging helpers', () => {
  it('asks for a page only when a limit is given, and refuses a nonsense page', () => {
    expect(pageAsked({})).toBeUndefined();
    expect(pageAsked({ limit: '25' })).toEqual({ limit: 25, offset: 0 });
    expect(pageAsked({ limit: '25', offset: '50' })).toEqual({ limit: 25, offset: 50 });
    expect(pageAsked({ limit: '5', other: '10' }, 'other')).toEqual({ limit: 5, offset: 10 });
    for (const bad of [{ limit: '0' }, { limit: '-1' }, { limit: '1.5' }, { limit: 'x' }, { limit: '501' }, { limit: '5', offset: '-1' }, { limit: '5', offset: 'a' }])
      expect(() => pageAsked(bad), JSON.stringify(bad)).toThrow(/limit=100&offset=0/);
  });

  it('cuts a list, and leaves it whole when no page is asked for', () => {
    const r = { rows: [1, 2, 3, 4, 5], total: 15 };
    expect(paged(r, 'rows', undefined)).toBe(r);
    expect(paged(r, 'rows', { limit: 2, offset: 2 })).toEqual({ rows: [3, 4], total: 15, page: { total: 5, offset: 2, limit: 2 } });
    expect(paged(r, 'rows', { limit: 2, offset: 9 }).rows).toEqual([]);
  });

  it('cuts a ledger across its accounts, keeping every account\'s balances', () => {
    const ledger = { accounts: [
      { code: 'A', openingBalanceCents: 5, closingBalanceCents: 5, lines: [] as number[] },
      { code: 'B', openingBalanceCents: 0, closingBalanceCents: 30, lines: [1, 2, 3] },
      { code: 'C', openingBalanceCents: 7, closingBalanceCents: 9, lines: [4, 5] },
    ] };
    const first = pagedLedger(ledger, { limit: 2, offset: 0 });
    expect(first.accounts.map((a) => [a.code, a.lines])).toEqual([['A', []], ['B', [1, 2]]]);
    expect(first.page).toEqual({ total: 5, offset: 0, limit: 2 });
    const second = pagedLedger(ledger, { limit: 2, offset: 2 });
    expect(second.accounts.map((a) => [a.code, a.lines, a.closingBalanceCents])).toEqual([['B', [3], 30], ['C', [4], 9]]);
    expect(pagedLedger(ledger, { limit: 2, offset: 4 }).accounts.map((a) => [a.code, a.lines])).toEqual([['C', [5]]]);
    expect(pagedLedger(ledger, undefined)).toBe(ledger);
  });
});

describe('paged reports over the perf data', () => {
  let dir: string;
  let db: Db;
  let app: FastifyInstance;
  let cookies: Record<string, string>;
  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode, `${url}: ${res.body.slice(0, 200)}`).toBe(200);
    return res.json() as Record<string, any>;
  };
  /** Every page of `url` (`size` rows at a time) joined up, by the list at `key`. */
  const allPages = async (url: string, key: string, size: number, dig = (r: Record<string, any>) => r[key] as unknown[], offsetKey = 'offset') => {
    const rows: unknown[] = [];
    let last: Record<string, any> = {};
    for (let offset = 0; ; offset += size) {
      last = await get(`${url}${url.includes('?') ? '&' : '?'}limit=${size}&${offsetKey}=${offset}`);
      const part = dig(last);
      expect(part.length).toBeLessThanOrEqual(size);
      rows.push(...part);
      if (part.length < size) return { rows, last };
    }
  };
  const without = (r: Record<string, any>, ...keys: string[]) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moon-paging-'));
    const summary = await createPerfData(join(dir, 'p.db'), { days: 40, customers: 20, jobOrders: 90, employees: 4, seed: 11 });
    db = openDb(join(dir, 'p.db'));
    const end = Date.parse(`${summary.options.start}T02:00:00Z`) + (summary.options.days - 1) * 86_400_000 + 4 * 3_600_000;
    app = buildApp({ db, clock: fixedClock(new Date(end).toISOString()), modules: await loadModules(), config: { scryptN: 2 ** 10 } }).app;
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'perf-owner', password: summary.passwords.owner } });
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
  }, 240_000);
  afterAll(async () => { await app?.close(); db?.close(); await rm(dir, { recursive: true, force: true }); });

  const RANGE = 'from=2026-01-01&to=2026-02-09';
  it.each([
    ['collections register', `/api/rpt/collections-register?${RANGE}`, 'rows'],
    ['sales by period', `/api/rpt/sales-by-period?${RANGE}`, 'rows'],
    ['general journal', `/api/rpt/journal?${RANGE}`, 'journals'],
    ['AR aging', '/api/rpt/ar-aging?asOf=2026-02-09', 'rows'],
    ['job order follow-up', '/api/rpt/job-order-follow-up', 'rows'],
    ['lead time', '/api/rpt/lead-time?asOf=2026-02-09', 'rows'],
    ['tax sales register', `/api/tax/registers/sales?${RANGE}`, 'rows'],
    ['BIR sales book', `/api/rpt/bir-books/sales?${RANGE}`, 'pages'],
  ] as const)('%s: the pages add up to the whole, and its figures are the same', async (_name, url, key) => {
    const whole = await get(url);
    const { rows, last } = await allPages(url, key, key === 'pages' ? 2 : 7);
    expect(rows.length).toBeGreaterThan(7 * (key === 'pages' ? 0 : 1));
    expect(rows).toEqual(whole[key]);
    expect(last.page.total).toBe(whole[key].length);
    expect(without(last, key, 'page', 'balancePage', 'memoPage', 'releasedWithBalance', 'memo')).toEqual(without(whole, key, 'page', 'balancePage', 'memoPage', 'releasedWithBalance', 'memo'));
  });

  it('the second lists of the follow-up and the aging have pages of their own', async () => {
    const jobs = await get('/api/rpt/job-order-follow-up');
    expect(jobs.releasedWithBalance.length).toBeGreaterThan(3);
    const balance = await allPages('/api/rpt/job-order-follow-up', 'releasedWithBalance', 3, (r) => r.releasedWithBalance, 'balanceOffset');
    expect(balance.rows).toEqual(jobs.releasedWithBalance);
    const aging = await get('/api/rpt/ar-aging?asOf=2026-02-09');
    const memo = await allPages('/api/rpt/ar-aging?asOf=2026-02-09', 'memo', 4, (r) => r.memo, 'memoOffset');
    expect(memo.rows).toEqual(aging.memo);
  });

  it('the general ledger: a window of lines across the accounts, with true balances', async () => {
    const url = `/api/rpt/ledger?${RANGE}`;
    const whole = await get(url);
    const total = whole.accounts.reduce((n: number, a: any) => n + a.lines.length, 0);
    const lines: unknown[] = [];
    const seen = new Map<number, any>();
    for (let offset = 0; offset < total; offset += 25) {
      const page = await get(`${url}&limit=25&offset=${offset}`);
      expect(page.page).toEqual({ total, offset, limit: 25 });
      for (const a of page.accounts) {
        const truth = whole.accounts.find((x: any) => x.id === a.id);
        expect([a.openingBalanceCents, a.closingBalanceCents]).toEqual([truth.openingBalanceCents, truth.closingBalanceCents]);
        lines.push(...a.lines);
        seen.set(a.id, a);
      }
    }
    expect(lines).toEqual(whole.accounts.flatMap((a: any) => a.lines));
    // Accounts with no line at all are on the first page, so none is lost.
    expect(whole.accounts.filter((a: any) => a.lines.length === 0).every((a: any) => (seen.get(a.id) ?? null) !== null)).toBe(true);
  });

  it('the notifications: only the unread ones, a page at a time', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/dash/notifications', cookies });
    const list = all.json() as { id: string; read: boolean }[];
    const first = (await app.inject({ method: 'GET', url: '/api/dash/notifications?limit=3&offset=0&unread=1', cookies })).json() as { id: string }[];
    expect(first.map((n) => n.id)).toEqual(list.filter((n) => !n.read).slice(0, 3).map((n) => n.id));
    expect((await app.inject({ method: 'GET', url: '/api/dash/notifications?limit=0', cookies })).statusCode).toBe(400);
  });
});
