import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { paginate } from '../bir-books.ts';

let env: TestEnv; let accountant: Client; let encoder: Client;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code=?').pluck().get(code) as number;
beforeEach(async () => { env = await createTestEnv(); accountant = await env.as('accountant'); encoder = await env.as('encoder'); });

describe('RPT BIR loose-leaf books', () => {
  it('carries the exact running totals from one numbered page to the next', () => {
    const pages = paginate(Array.from({ length: 5 }, (_, i) => ({ cents: (i + 1) * 100 })), (r) => ({ cents: r.cents }), 2);
    expect(pages.map((p) => [p.number, p.broughtForward.cents ?? 0, p.carriedForward.cents])).toEqual([[1, 0, 300], [2, 300, 1_000], [3, 1_000, 1_500]]);
  });

  it('reads sealed journals, ties cash receipts to their ledger lines, exports CSV, and enforces permission', async () => {
    const res = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up counter income', lines: [
      { accountId: account('1101'), debitCents: 12_345 }, { accountId: account('7103'), creditCents: 12_345 },
    ] }, expectedTotalCents: 12_345 }, idem());
    expect(res.statusCode, res.body).toBe(200);
    const path = '/api/rpt/bir-books/cash-receipts?from=2026-09-01&to=2026-09-30';
    const book = await accountant.get(path); expect(book.statusCode).toBe(200);
    expect(book.json()).toMatchObject({ totals: { cashCents: 12_345, salesIncomeCents: 12_345 }, pages: [{ number: 1, rows: [{ cashCents: 12_345, salesIncomeCents: 12_345 }] }] });
    const csv = await accountant.get(`${path}&format=csv`); expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body).toContain('123.45');
    expect((await encoder.get(path)).statusCode).toBe(403); expect((await encoder.get(`${path}&format=csv`)).statusCode).toBe(403);
  });
});
