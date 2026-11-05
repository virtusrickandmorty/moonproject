/** The Reports overview: a month against the one before, its ratios, what to review. Made-up figures only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { incomeStatement } from '../statements.ts';

let env: TestEnv, accountant: Client, encoder: Client;
beforeEach(async () => {
  env = await createTestEnv();
  encoderOwnDefaults(env);
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

const SALES = '4103';
const id = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
/** A made-up entry through the cash box: debits for money out, credits for money in. */
async function entry(debits: Record<string, number>, credits: Record<string, number> = {}) {
  const out = Object.values(debits).reduce((n, c) => n + c, 0);
  const inn = Object.values(credits).reduce((n, c) => n + c, 0);
  const cash = cashPlaceId(env.db, '1101');
  const lines = [...Object.entries(debits).map(([code, debitCents]) => ({ accountId: id(code), debitCents })), ...Object.entries(credits).map(([code, creditCents]) => ({ accountId: id(code), creditCents, ...(code === SALES ? { party: { type: 'customer', id: seedCustomers(env.db, env.db.prepare('SELECT id FROM users LIMIT 1').pluck().get() as string).school } } : {}) })),
    ...(inn > out ? [{ accountId: cash, debitCents: inn - out }] : out > inn ? [{ accountId: cash, creditCents: out - inn }] : [])];
  const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up entry', lines }, expectedTotalCents: Math.max(inn, out) }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const overview = async (month: string) => { const r = await accountant.get(`/api/rpt/overview?month=${month}`); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const nextMonth = async (iso: string) => { env.clock.set(iso); accountant = await env.as('accountant'); };

describe('the Reports overview', () => {
  it('agrees with the income statement, and works out the margins on sales', async () => {
    await entry({ 5101: 400_000, 6110: 100_000 }, { [SALES]: 1_000_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    const o = await overview('2026-09');
    const statement = incomeStatement(env.db, '2026-09-01', '2026-09-30');
    expect(o.profit.month).toMatchObject({ salesCents: 1_000_000, costOfSalesCents: 400_000, operatingCents: 100_000, grossProfitCents: statement.grossProfitCents, netIncomeCents: statement.netIncomeCents });
    expect(o.now).toMatchObject({ grossMarginBp: 6_000, netMarginBp: 5_000 });
    expect(o).toMatchObject({ from: '2026-09-01', to: '2026-09-30', running: false, previousMonth: '2026-08' });
  });

  it('compares a month still running with the same days of the month before, and adds up the year', async () => {
    await entry({ 6110: 100_000 });
    await nextMonth('2026-10-05T02:00:00Z');
    await entry({ 6110: 50_000 });
    const o = await overview('2026-10');
    expect(o).toMatchObject({ running: true, to: '2026-10-05', previousFrom: '2026-09-01', previousTo: '2026-09-05' });
    expect(o.profit.yearToDate.operatingCents).toBe(o.profit.month.operatingCents + (incomeStatement(env.db, '2026-01-01', '2026-09-30').sections.find((s) => s.key === 'operatingExpenses')?.totalCents ?? 0));
    expect(o.trend).toHaveLength(12);
    expect(o.trend.at(-1)).toMatchObject({ month: '2026-10', to: '2026-10-05' });
  });

  it('ranks the expenses with last month beside them, and leaves a minus out of the ranking', async () => {
    const old = await entry({ 5101: 900_000, 6230: 2_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    await entry({ 6230: 5_000, 6120: 8_000 });
    expect((await accountant.post(`/api/docs/acc.jv/${old.id}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
    await nextMonth('2026-11-02T02:00:00Z');
    const o = await overview('2026-10');
    expect(o.expenses.rows.map((r: { code: string; previousCents: number }) => [r.code, r.previousCents])).toEqual([['6120', 0], ['6230', 2_000]]);
    expect(o.cancelledExpenses).toEqual([{ number: old.number, amountCents: 902_000 }]);
    expect(o.review.find((r: { key: string }) => r.key === 'cancellations')).toMatchObject({ count: 1, ok: false });
  });

  it('counts months of cash from complete months only, and says when cash flow ties', async () => {
    await entry({}, { 7103: 3_000_000 });
    await entry({ 6110: 500_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    const o = await overview('2026-10');
    expect(o.averagePaidCents).toBe(500_000);
    expect(o.cashMonths).toBe(5);
    expect(o.review.find((r: { key: string }) => r.key === 'cash')).toMatchObject({ ok: true });
  });

  it('refuses a bad month and a month to come, and asks for the books permission', async () => {
    expect((await accountant.get('/api/rpt/overview?month=2026-13')).statusCode).toBe(400);
    expect((await accountant.get('/api/rpt/overview?month=2099-01')).statusCode).toBe(400);
    expect((await encoder.get('/api/rpt/overview?month=2026-09')).statusCode).toBe(403);
  });
});
