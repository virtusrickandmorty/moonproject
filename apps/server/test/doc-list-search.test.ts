/**
 * Document lists' search (the list screens): words found in the number, the booklet number or the summary, a range of business
 * dates, and the counts of what the same filters find. The documents are laid down directly so every searched field is known.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { createTestEnv, createUser, type Client, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Client;
const TYPE = 'cash.transfer';

/** number, booklet number, business date, status, summary */
const DOCS: [string, string | null, string, 'posted' | 'cancelled', string][] = [
  ['CT-000001', null, '2026-09-01', 'posted', 'Moved cash from the drawer to Maria Santos'],
  ['CT-000002', 'BK-77', '2026-09-10', 'posted', 'Moved cash to the bank'],
  ['CT-000003', null, '2026-09-20', 'cancelled', 'Moved cash to maria santos again'],
  ['CT-000004', null, '2026-09-30', 'posted', 'A 100% sure_thing for Lito\\Cruz'],
  ['CT-000005', null, '2026-10-01', 'posted', 'A 1000 sureXthing for Lito Cruz'],
];

beforeAll(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const by = createUser(env.db, `poster-${newId().slice(0, 6)}`, ['owner']);
  const insert = env.db.prepare(`INSERT INTO documents (id, doc_type, module, series_key, number, external_number, business_date, status, total_cents, summary, posted_at, posted_by, cancelled_at, cancelled_by, cancel_reason)
    VALUES (?, ?, 'CASH', 'test-series', ?, ?, ?, ?, 100, ?, ?, ?, ?, ?, ?)`);
  for (const [number, ext, date, status, summary] of DOCS) {
    const cancelled = status === 'cancelled';
    insert.run(newId(), TYPE, number, ext, date, status, summary, `${date}T10:00:00.000+08:00`, by, cancelled ? `${date}T11:00:00.000+08:00` : null, cancelled ? by : null, cancelled ? 'wrong amount' : null);
  }
});

afterAll(async () => {
  await env.app.close();
});

const numbers = async (query: string) => {
  const res = await owner.get(`/api/docs/${TYPE}?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { number: string }[]).map((d) => d.number).sort();
};
const counts = async (query: string) => {
  const res = await owner.get(`/api/docs/${TYPE}/counts?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { all: number; posted: number; cancelled: number };
};

describe('document list search', () => {
  it('lists everything when nothing is typed', async () => {
    expect(await numbers('')).toEqual(['CT-000001', 'CT-000002', 'CT-000003', 'CT-000004', 'CT-000005']);
    expect(await numbers('q=%20%20&from=&to=')).toHaveLength(5);
    expect(await counts('')).toEqual({ all: 5, posted: 4, cancelled: 1 });
  });

  it('finds words in the number, the booklet number and the summary, in any case', async () => {
    expect(await numbers('q=000002')).toEqual(['CT-000002']);
    expect(await numbers('q=bk-77')).toEqual(['CT-000002']);
    expect(await numbers(`q=${encodeURIComponent('Maria Santos')}`)).toEqual(['CT-000001', 'CT-000003']);
    expect(await numbers('q=maria&status=posted')).toEqual(['CT-000001']);
    expect(await counts('q=maria')).toEqual({ all: 2, posted: 1, cancelled: 1 });
    expect(await numbers('q=nobody')).toEqual([]);
    expect(await counts('q=nobody')).toEqual({ all: 0, posted: 0, cancelled: 0 });
  });

  it('takes %, _ and \\ typed in the search as themselves', async () => {
    expect(await numbers(`q=${encodeURIComponent('100%')}`)).toEqual(['CT-000004']);
    expect(await numbers(`q=${encodeURIComponent('sure_thing')}`)).toEqual(['CT-000004']);
    expect(await numbers(`q=${encodeURIComponent('Lito\\Cruz')}`)).toEqual(['CT-000004']);
    expect(await numbers(`q=${encodeURIComponent('%')}`)).toEqual(['CT-000004']);
  });

  it('keeps the business dates from the first to the last, both included', async () => {
    expect(await numbers('from=2026-09-10&to=2026-09-30')).toEqual(['CT-000002', 'CT-000003', 'CT-000004']);
    expect(await numbers('from=2026-09-30')).toEqual(['CT-000004', 'CT-000005']);
    expect(await numbers('to=2026-09-01')).toEqual(['CT-000001']);
    expect(await counts('from=2026-09-10&to=2026-09-30')).toEqual({ all: 3, posted: 2, cancelled: 1 });
    expect(await numbers('q=cash&from=2026-09-15')).toEqual(['CT-000003']);
  });

  it('pages the search like the plain list', async () => {
    const first = (await owner.get(`/api/docs/${TYPE}?q=moved&limit=2`)).json() as { number: string; postedAt: string }[];
    expect(first.map((d) => d.number)).toEqual(['CT-000003', 'CT-000002']);
    const rest = (await owner.get(`/api/docs/${TYPE}?q=moved&limit=2&before=${encodeURIComponent(first[1]!.postedAt)}`)).json() as { number: string }[];
    expect(rest.map((d) => d.number)).toEqual(['CT-000001']);
  });

  it('refuses a search too long and a date not like 2026-09-30, in plain words', async () => {
    for (const url of [`/api/docs/${TYPE}`, `/api/docs/${TYPE}/counts`]) {
      const long = await owner.get(`${url}?q=${'a'.repeat(101)}`);
      expect(long.statusCode).toBe(400);
      expect(long.json()).toMatchObject({ code: 'BAD_SEARCH', message: 'Type at most 100 characters to search.' });
      expect((await owner.get(`${url}?q=${'a'.repeat(100)}`)).statusCode).toBe(200);
      const from = await owner.get(`${url}?from=30/09/2026`);
      expect(from.statusCode).toBe(400);
      expect(from.json()).toMatchObject({ code: 'BAD_DATE', message: 'Type the first date like 2026-09-30.' });
      expect((await owner.get(`${url}?to=2026-02-30`)).json()).toMatchObject({ code: 'BAD_DATE', message: 'Type the last date like 2026-09-30.' });
    }
  });

  it('counts only what the user may view', async () => {
    const tv = await env.as('tv');
    expect((await tv.get(`/api/docs/${TYPE}/counts`)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/no.such.type/counts')).statusCode).toBe(404);
  });
});
