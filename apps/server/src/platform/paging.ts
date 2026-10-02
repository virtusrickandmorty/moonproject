/**
 * Paging for lists and reports that can run to tens of thousands of rows (PERF). A screen asks for a page with `?limit=100&offset=200`;
 * a request without `limit` (a CSV file, another program, the tests) gets every row, as before. Totals and other figures of a report
 * are always worked out over all the rows: only the list itself is cut.
 */
import { AppError } from '@moonproject/shared';

export const MAX_PAGE = 500;

/** Where a page of a list sits: `total` rows in all, this page starts at `offset` and holds at most `limit`. */
export interface PageInfo { total: number; offset: number; limit: number }
export interface PageAsked { limit: number; offset: number }

/** The page a query string asks for, or undefined when it asks for none. */
export function pageAsked(q: Record<string, unknown>, offsetKey = 'offset'): PageAsked | undefined {
  if (q.limit === undefined || q.limit === '') return undefined;
  const limit = Number(q.limit);
  const offset = q[offsetKey] === undefined || q[offsetKey] === '' ? 0 : Number(q[offsetKey]);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE || !Number.isInteger(offset) || offset < 0)
    throw new AppError('BAD_PAGE', `Ask for a page like limit=100&offset=0 (a limit from 1 to ${MAX_PAGE}).`, 400);
  return { limit, offset };
}

export function pageInfo(total: number, asked: PageAsked): PageInfo {
  return { total, offset: asked.offset, limit: asked.limit };
}

/** The result with `result[key]` cut to the page asked for and `page` added; unchanged when no page is asked for. */
export function paged<T extends object, K extends keyof T & string>(result: T, key: K, asked: PageAsked | undefined, into = 'page'): T & { page?: PageInfo } {
  if (!asked) return result;
  const rows = result[key] as unknown as unknown[];
  return { ...result, [key]: rows.slice(asked.offset, asked.offset + asked.limit), [into]: pageInfo(rows.length, asked) };
}

/**
 * A ledger (accounts, each with its lines, or its loose pages) cut to a window of them counted across the accounts in order. An account with lines in the
 * window keeps its true opening and closing balances and running balances; accounts with no lines at all show on the first page only.
 */
export function pagedLedger<R extends { accounts: object[] }>(result: R, asked: PageAsked | undefined, key: 'lines' | 'pages' = 'lines'): R & { page?: PageInfo } {
  if (!asked) return result;
  const itemsOf = (account: object) => (account as Record<string, unknown[]>)[key]!;
  const total = result.accounts.reduce((n, a) => n + itemsOf(a).length, 0);
  let at = 0;
  const accounts: object[] = [];
  for (const account of result.accounts) {
    const start = at;
    const items = itemsOf(account);
    at += items.length;
    if (items.length === 0) { if (asked.offset === 0) accounts.push(account); continue; }
    const from = Math.max(asked.offset, start);
    const to = Math.min(asked.offset + asked.limit, at);
    if (from < to) accounts.push({ ...account, [key]: items.slice(from - start, to - start) });
  }
  return { ...result, accounts, page: pageInfo(total, asked) };
}
