import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocTypeInfo, NavResult } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { SearchResults, grouped, localMatches, startSearch, type SearchState } from './Search.tsx';

const results: NavResult[] = [{ kind: 'Customer', id: 'sample', label: 'Sample Team', href: '/cus/sample' }];
const pending = () => {
  let resolve!: (results: NavResult[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<NavResult[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => vi.useRealTimers());

describe('global search', () => {
  it('shows searching, no matches, failure and successful results as distinct states', () => {
    const render = (status: SearchState['status'], rows: NavResult[] = []) => renderToStaticMarkup(createElement(SearchResults, { state: { query: 'sa', status, results: rows }, onChoose: () => undefined, onRetry: () => undefined }));
    expect(render('searching')).toContain('Searching…');
    expect(render('searching')).not.toContain('No matches');
    expect(render('ready')).toContain('No matches');
    expect(render('error')).toContain('Check the connection');
    expect(render('error')).toContain('Retry search');
    expect(render('error')).not.toContain('No matches');
    expect(render('ready', results)).toContain('href="/cus/sample"');
    expect(render('ready', results)).toContain('Sample Team');
  });

  it.each(['success', 'failure'])('ignores a stale %s after the newest answer arrives', async (outcome) => {
    vi.useFakeTimers();
    const old = pending();
    const newest = pending();
    const show = vi.fn();
    const stop = startSearch('old', () => old.promise, show);
    await vi.advanceTimersByTimeAsync(180);
    stop();
    const finish = startSearch('new', () => newest.promise, show);
    await vi.advanceTimersByTimeAsync(180);
    newest.resolve(results);
    await Promise.resolve();
    const count = show.mock.calls.length;
    if (outcome === 'success') old.resolve([]);
    else old.reject(new Error('Offline'));
    await Promise.resolve();
    expect(show).toHaveBeenCalledTimes(count);
    expect(show).toHaveBeenLastCalledWith({ query: 'new', status: 'ready', results });
    finish();
  });

  it('debounces, clears short queries and ignores a request after clearing or unmounting', async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => results);
    const show = vi.fn();
    const stop = startSearch('sa', search, show);
    expect(show).toHaveBeenLastCalledWith({ query: 'sa', status: 'searching', results: [] });
    stop();
    startSearch('s', search, show);
    await vi.advanceTimersByTimeAsync(200);
    expect(search).not.toHaveBeenCalled();
    expect(show).toHaveBeenLastCalledWith({ query: 's', status: 'idle', results: [] });
    const request = pending();
    const unmount = startSearch('sample', () => request.promise, show);
    await vi.advanceTimersByTimeAsync(180);
    unmount();
    const count = show.mock.calls.length;
    request.resolve(results);
    await Promise.resolve();
    expect(show).toHaveBeenCalledTimes(count);
  });

  it('reports a current failure and can retry the same query successfully', async () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const stop = startSearch('sa', async () => { throw new Error('Connection failed'); }, show);
    await vi.advanceTimersByTimeAsync(180);
    expect(show).toHaveBeenLastCalledWith({ query: 'sa', status: 'error', results: [] });
    stop();
    const finish = startSearch('sa', async () => results, show);
    await vi.advanceTimersByTimeAsync(180);
    expect(show).toHaveBeenLastCalledWith({ query: 'sa', status: 'ready', results });
    finish();
  });
});

describe("the search bar finds screens and New forms too (the owner's request, 26 Oct 2026)", () => {
  const types = ['exp.voucher', 'pay.run', 'jo.job_order', 'cash.transfer'].map((key) => ({ key, title: { 'exp.voucher': 'Expense Voucher', 'pay.run': 'Payroll Run', 'jo.job_order': 'Job Order', 'cash.transfer': 'Fund Transfer' }[key]!,
    module: key.split('.')[0]!.toUpperCase(), canCreate: true, canPost: true }) as DocTypeInfo);
  const menu = buildMenu(types, new Set(['cash.book.view', 'cash.places.view', 'emp.view']));
  it('matches names and everyday words, only from what the user may open', () => {
    expect(localMatches('cash book', menu, types)[0]).toMatchObject({ kind: 'Go to', label: 'Cash book', href: '/cash/book' });
    expect(localMatches('payroll', menu, types).map((r) => r.label)).toEqual(expect.arrayContaining(['Payroll Runs', 'New payroll run']));
    expect(localMatches('petty', menu, types).map((r) => r.href)).toEqual(expect.arrayContaining(['/cash/book', '/cash/accounts', '/docs/exp.voucher/new']));
    expect(localMatches('reconciliation', menu, types)).toEqual([]); // the bank reconciliation is not in this user's menu
  });
  it('puts the New forms first when asked for one', () => {
    expect(localMatches('new expense', menu, types)[0]).toMatchObject({ kind: 'New', label: 'New expense voucher', href: '/docs/exp.voucher/new' });
    expect(localMatches('add', menu, types).every((r) => r.kind === 'New')).toBe(true);
    expect(grouped(localMatches('new expense', menu, types))[0]!.kind).toBe('New');
  });
  it('shows the results grouped, screens first, in a fixed order', () => {
    const rows = [{ kind: 'Document', id: 'd', label: 'QUO-000001', href: '/x' }, { kind: 'Customer', id: 'c', label: 'Sample', href: '/y' }, { kind: 'Go to', id: '/cus', label: 'Customers', href: '/cus' }] as Parameters<typeof grouped>[0];
    expect(grouped(rows).map((g) => g.kind)).toEqual(['Go to', 'Customer', 'Document']);
    const html = renderToStaticMarkup(createElement(SearchResults, { state: { query: 'sa', status: 'ready', results: [] }, local: localMatches('cash book', menu, types), onChoose: () => undefined, onRetry: () => undefined }));
    expect(html).toContain('Screens');
    expect(html).toContain('href="/cash/book"');
  });
});
