import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type TestEnv } from '../../../../test/helpers.ts';
import { balanceSheet, incomeStatement } from '../statements.ts';
import { cashFlowStatement } from '../cash-flow.ts';
import { arAging } from '../receivables.ts';
import { monthlyOwnersPack, monthlyOwnersPackBody } from '../monthly-pack.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env = undefined; });

describe("monthly owners' pack", () => {
  it('uses every source report figure for a made-up month and denies other roles', async () => {
    env = await createTestEnv();
    const accountant = await env.as('accountant'), encoder = await env.as('encoder');
    const account = (code: string) => env!.db.prepare('SELECT id FROM accounts WHERE code=?').pluck().get(code) as number;
    const posted = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up September counter sale', lines: [
      { accountId: account('1101'), debitCents: 12_345 }, { accountId: account('7103'), creditCents: 12_345 },
    ] }, expectedTotalCents: 12_345 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    env.db.prepare(`INSERT INTO prt_company_profile
      (id,registered_name,trade_name,tin,registered_address,is_vat_registered,version,updated_at,updated_by)
      VALUES (1,'Sample Garments Company','Sample Garments','000-000-000-000','123 Sample Street',1,1,'2026-09-30T10:00:00+08:00',?)`).run(accountant.userId);

    const expected = monthlyOwnersPack(env.db, '2026-09');
    expect(expected.income.netIncomeCents).toBe(incomeStatement(env.db, '2026-09-01', '2026-09-30').netIncomeCents);
    expect(expected.income.previous.netIncomeCents).toBe(incomeStatement(env.db, '2026-08-01', '2026-08-31').netIncomeCents);
    expect(expected.balance.totalAssetsCents).toBe(balanceSheet(env.db, '2026-09-30').totalAssetsCents);
    expect(expected.balance.previous.totalAssetsCents).toBe(balanceSheet(env.db, '2026-08-31').totalAssetsCents);
    expect(expected.cashFlow.closingCashCents).toBe(cashFlowStatement(env.db, '2026-09-01', '2026-09-30').closingCashCents);
    expect(expected.receivables.sourceTotalCents).toBe(arAging(env.db, '2026-09-30').totalCents);

    const response = await accountant.post('/api/rpt/monthly-owners-pack', { month: '2026-09' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toEqual(expected);
    expect(response.json().html).toContain('Sample Garments Company');
    expect(response.json().html).toContain('Income statement');
    expect(response.json().html).toContain('Prepared on');
    expect(response.json().html.match(/Noted by:/g)).toHaveLength(1);
    expect((await encoder.post('/api/rpt/monthly-owners-pack', { month: '2026-09' })).statusCode).toBe(403);
    // Payroll cost is grouped by the run's pay group, printed by its name.
    const withPayroll = { ...expected, payroll: { ...expected.payroll, groups: [{ payGroup: 'WEEKLY_PIECE', grossCents: 100_000, employerSharesCents: 5_000, costCents: 105_000 }] } };
    expect(monthlyOwnersPackBody(withPayroll)).toContain('Weekly piece-rate');
  });

  it('puts a made-up monthly pack row in the printer test pack', async () => {
    env = await createTestEnv(); const owner = await env.as('owner');
    const response = await owner.get('/api/prt/test-pack');
    expect(response.statusCode, response.body).toBe(200);
    const sample = response.json().prints.find((row: { id: string }) => row.id === 'monthly-owners-pack');
    expect(sample.html).toContain('Made-up figure'); expect(sample.html).toContain('₱1,250.00');
  });
});
