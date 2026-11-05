/** The overhead report: what is direct cost and what is overhead, the average of complete months, and Costing beside it. */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';

let env: TestEnv, accountant: Client, encoder: Client;
beforeEach(async () => {
  env = await createTestEnv();
  encoderOwnDefaults(env);
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

const id = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
/** A made-up month's costs: debits on the accounts given, paid from the cash box. */
async function spend(debits: Record<string, number>) {
  const total = Object.values(debits).reduce((n, c) => n + c, 0);
  const lines = [...Object.entries(debits).map(([code, debitCents]) => ({ accountId: id(code), debitCents })), { accountId: cashPlaceId(env.db, '1101'), creditCents: total }];
  const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up costs of the month', lines }, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const report = async (month: string) => (await accountant.get(`/api/rpt/overhead?month=${month}`)).json();
const nextMonth = async (iso: string) => { env.clock.set(iso); accountant = await env.as('accountant'); };

describe('overhead', () => {
  it('sorts direct cost from overhead, counts production depreciation as overhead, and shows the rate', async () => {
    await spend({ 5101: 100_000, 5201: 100_000, 5302: 50_000, 6110: 200_000, 6120: 50_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    const r = await report('2026-09');
    expect(r.rows).toMatchObject([{ month: '2026-09', directCents: 200_000, overheadCents: 300_000, overheadRateBp: 15_000, finished: true }]);
    expect(r.accounts.map((a: { code: string }) => a.code)).toEqual(['6110', '5302', '6120']);
    expect(r.average).toMatchObject({ months: ['2026-09'], rateBp: 15_000 });
  });

  it('leaves a month still running out of the average, and a cancelled entry out of everything', async () => {
    await spend({ 5101: 100_000, 6110: 100_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    const october = await spend({ 5101: 100_000, 6110: 900_000 });
    const r = await report('2026-10');
    expect(r.rows.map((m: { month: string; finished: boolean }) => [m.month, m.finished])).toEqual([['2026-09', true], ['2026-10', false]]);
    expect(r.average).toMatchObject({ months: ['2026-09'], rateBp: 10_000 });
    expect((await accountant.post(`/api/docs/acc.jv/${october}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
    expect((await report('2026-10')).rows.at(-1)).toMatchObject({ directCents: 0, overheadCents: 0, overheadRateBp: null });
  });

  it('takes an entry cancelled in a later month out of its own month, and leaves the later month unharmed', async () => {
    await spend({ 5101: 100_000, 6110: 100_000 });
    const mistake = await spend({ 5101: 300_000 });
    await nextMonth('2026-10-02T02:00:00Z');
    await spend({ 5101: 100_000, 6110: 200_000 });
    expect((await accountant.post(`/api/docs/acc.jv/${mistake}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
    const r = await report('2026-10');
    expect(r.rows).toMatchObject([{ month: '2026-09', directCents: 100_000, overheadRateBp: 10_000 }, { month: '2026-10', directCents: 100_000, overheadRateBp: 20_000 }]);
    expect(r.average).toMatchObject({ months: ['2026-09'], directCents: 100_000, rateBp: 10_000 });
  });

  it('averages the last three complete months together, and says when Costing is far from it', async () => {
    env.db.prepare('INSERT INTO est_rules (overhead_bp, commission_bp, round_to_cents, reason, created_at) VALUES (5000, 0, 100, ?, ?)').run('Made-up rules', '2026-09-28T10:00:00+08:00');
    await spend({ 5101: 100_000, 6110: 900_000 }); // September: left out, a fourth month back
    for (const [date, overhead] of [['2026-10-02', 100_000], ['2026-11-02', 300_000], ['2026-12-02', 200_000]] as const) {
      await nextMonth(`${date}T02:00:00Z`);
      await spend({ 5101: 100_000, 6110: overhead });
    }
    await nextMonth('2027-01-02T02:00:00Z');
    const r = await report('2026-12');
    expect(r.average).toMatchObject({ months: ['2026-10', '2026-11', '2026-12'], overheadCents: 600_000, directCents: 300_000, rateBp: 20_000 });
    expect(r.costing).toEqual({ rateBp: 5_000, gapBp: 15_000, farApart: 'above' });
  });

  it('exports CSV and is for those who see the books', async () => {
    await spend({ 5101: 100_000, 6110: 150_000 });
    expect((await encoder.get('/api/rpt/overhead?month=2026-09')).statusCode).toBe(403);
    expect((await accountant.get('/api/rpt/overhead?month=2026-13')).json().code).toBe('BAD_MONTH');
    const csv = await accountant.get('/api/rpt/overhead?month=2026-09&format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Overhead % of direct cost');
    expect(csv.body).toContain('150.0%');
  });
});
