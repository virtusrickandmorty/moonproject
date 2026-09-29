/**
 * Golden G-26 (PLAN I2, D5 VAT-CLOSE): "VAT close: output 60,000 / input 25,000; other quarter output 20,000 / input
 * 30,000 → Dr 2301 60,000.00 / Cr 1401 25,000.00; Cr 2302 35,000.00. Dr 2301 20,000.00; Dr 1402 10,000.00 / Cr 1401
 * 30,000.00." Q2 2026 is the first quarter, Q3 2026 the other, so no carry-over enters the first close. Each close's
 * cancel mirrors it (D6: only the latest one). The VAT is put on the books with journal vouchers, as in
 * vat-close.test.ts. (Posting coverage check, docs/review/posting-coverage.md.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const balance = (code: string) =>
  env.db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE j.sealed = 1 AND l.account_id = ?').pluck().get(account(code)) as number;
/** A document's journal as [code, debit, credit], summed per account and sorted by code (the close has one line per party). */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, SUM(l.debit_cents), SUM(l.credit_cents) FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journals j ON j.id = l.journal_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? GROUP BY a.code ORDER BY a.code`,
    )
    .raw()
    .all(documentId, kind);

const jv = async (memo: string, lines: unknown[], cents: number, businessDate?: string) => {
  const r = await accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines, ...(businessDate ? { lateReason: 'Recorded after the fact for the G-26 golden' } : {}) },
    expectedTotalCents: cents, ...(businessDate ? { businessDate } : {}),
  }, idem());
  expect(r.statusCode, r.body).toBe(200);
};
/** Output VAT on a sale (Cr 2301, the customer) and input VAT on a purchase (Dr 1401, the supplier), cash on the other side. */
const vatOf = async (outputCents: number, inputCents: number, businessDate?: string) => {
  await jv('Output VAT of the quarter', [{ accountId: account('1101'), debitCents: outputCents }, { accountId: account('2301'), party: { type: 'customer', id: c.school }, creditCents: outputCents }], outputCents, businessDate);
  await jv('Input VAT of the quarter', [{ accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-1' }, debitCents: inputCents }, { accountId: account('1101'), creditCents: inputCents }], inputCents, businessDate);
};
const close = async (year: number, quarter: number) => {
  const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year, quarter } })).json();
  const res = await accountant.post('/api/docs/tax.vat_close/post', { input: { year, quarter }, expectedTotalCents: pre.totalCents }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
};
const cancel = (id: string) => accountant.post(`/api/docs/tax.vat_close/${id}/cancel`, { reason: 'Closed with the wrong figures' }, idem());

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28, Q3
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, accountant.userId);
});

describe('VAT close golden (PLAN I2 G-26)', () => {
  it('Q2: Dr 2301 60,000.00 / Cr 1401 25,000.00, Cr 2302 35,000.00; Q3: Dr 2301 20,000.00, Dr 1402 10,000.00 / Cr 1401 30,000.00; cancels mirror, latest first', async () => {
    await vatOf(6_000_000, 2_500_000, '2026-05-15'); // Q2
    const q2 = await close(2026, 2);
    expect(journalOf(q2)).toEqual([['1401', 0, 2_500_000], ['2301', 6_000_000, 0], ['2302', 0, 3_500_000]]);
    expect([balance('2301'), balance('1401'), balance('1402'), balance('2302')]).toEqual([0, 0, 0, -3_500_000]);

    await vatOf(2_000_000, 3_000_000); // Q3, today
    env.clock.set('2026-10-05T02:00:00Z');
    accountant = await env.as('accountant');
    const q3 = await close(2026, 3);
    expect(journalOf(q3)).toEqual([['1401', 0, 3_000_000], ['1402', 1_000_000, 0], ['2301', 2_000_000, 0]]);
    expect([balance('2301'), balance('1401'), balance('1402'), balance('2302')]).toEqual([0, 0, 1_000_000, -3_500_000]);

    expect((await cancel(q2)).json().code).toBe('HAS_DEPENDENTS');
    expect((await cancel(q3)).statusCode).toBe(200);
    expect(journalOf(q3, 'reversal')).toEqual([['1401', 3_000_000, 0], ['1402', 0, 1_000_000], ['2301', 0, 2_000_000]]);
    expect((await cancel(q2)).statusCode).toBe(200);
    expect(journalOf(q2, 'reversal')).toEqual([['1401', 2_500_000, 0], ['2301', 0, 6_000_000], ['2302', 3_500_000, 0]]);
    expect([balance('2301'), balance('1401'), balance('1402'), balance('2302')]).toEqual([-8_000_000, 5_500_000, 0, 0]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
