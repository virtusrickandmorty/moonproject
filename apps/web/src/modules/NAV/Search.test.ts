import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavResult } from '../../api.ts';
import { SearchResults, startSearch, type SearchState } from './Search.tsx';

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
