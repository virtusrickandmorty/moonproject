/** What the graphs show on hover: where a month's expenses went, what is left out as cancelled, cash by place. Made-up figures. */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { incomeStatement } from '../../RPT/public.ts';
import { ownerCharts } from '../charts.ts';

let env: TestEnv, accountant: Client;
beforeEach(async () => {
  env = await createTestEnv();
  encoderOwnDefaults(env);
  accountant = await env.as('accountant');
});

const id = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
async function spend(debits: Record<string, number>) {
  const total = Object.values(debits).reduce((n, c) => n + c, 0);
  const lines = [...Object.entries(debits).map(([code, debitCents]) => ({ accountId: id(code), debitCents })), { accountId: cashPlaceId(env.db, '1101'), creditCents: total }];
  const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up costs of the month', lines }, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const cancel = async (docId: string) => expect((await accountant.post(`/api/docs/acc.jv/${docId}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
const nextMonth = async (iso: string) => { env.clock.set(iso); accountant = await env.as('accountant'); };
const month = (asOf: string, key: string) => ownerCharts(env.db, asOf).months.find((m) => m.month === key)!;

describe('the details of a month on the graph', () => {
  it('splits the expenses and names the biggest', async () => {
    await spend({ 5101: 100_000, 6110: 300_000, 6120: 50_000, 6230: 20_000 });
    const m = month('2026-09-30', '2026-09');
    expect(m).toMatchObject({ costOfSalesCents: 100_000, operatingCents: 370_000, incomeTaxCents: 0, expensesCents: 470_000, cancelledExpenses: [] });
    expect(m.biggestExpenses.map((e) => e.amountCents)).toEqual([300_000, 100_000, 50_000]);
  });

  it('leaves an expense cancelled in a later month out of both months, and names it in both', async () => {
    const old = await spend({ 5101: 500_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    await spend({ 6230: 1_000 });
    await cancel(old.id);
    const [september, october] = [month('2026-10-05', '2026-09'), month('2026-10-05', '2026-10')];
    expect(october).toMatchObject({ expensesCents: 1_000, costOfSalesCents: 0, operatingCents: 1_000 });
    expect(september).toMatchObject({ expensesCents: 0, costOfSalesCents: 0, biggestExpenses: [] });
    for (const m of [september, october]) expect(m.cancelledExpenses).toEqual([{ number: old.number, amountCents: 500_000 }]);
    expect(october.biggestExpenses.map((e) => e.amountCents)).toEqual([1_000]);
  });

  it('agrees with the income statement across the months', async () => {
    const old = await spend({ 5101: 500_000 });
    await spend({ 6230: 2_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    await spend({ 6230: 1_000 });
    await cancel(old.id);
    const charts = ownerCharts(env.db, '2026-10-05').months;
    const statement = incomeStatement(env.db, charts[0]!.from, '2026-10-05');
    const books = statement.sections.filter((s) => ['costOfSales', 'operatingExpenses', 'incomeTax'].includes(s.key)).reduce((n, s) => n + s.totalCents, 0);
    expect(charts.reduce((n, m) => n + m.expensesCents, 0)).toBe(books);
  });

  it('says nothing of an expense cancelled in its own month: it nets out there', async () => {
    const same = await spend({ 5101: 500_000 });
    await cancel(same.id);
    expect(month('2026-09-30', '2026-09')).toMatchObject({ expensesCents: 0, cancelledExpenses: [] });
  });

  it('adds up the cash places to the total, leaving out the empty ones', async () => {
    await spend({ 6230: 1_000 });
    const m = month('2026-09-30', '2026-09');
    expect(m.cashPlaces.length).toBeGreaterThan(0);
    expect(m.cashPlaces.every((p) => p.balanceCents !== 0)).toBe(true);
    expect(m.cashPlaces.reduce((n, p) => n + p.balanceCents, 0)).toBe(m.cashCents);
  });
});
