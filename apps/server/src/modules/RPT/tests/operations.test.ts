import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let accountant: Client;
let encoder: Client;

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

describe('RPT supplier, cash, asset and control reports', () => {
  it('takes cash position from the same ledger as the trial balance', async () => {
    const cashId = env.db.prepare("SELECT id FROM accounts WHERE code='1101'").pluck().get() as number;
    const incomeId = env.db.prepare("SELECT id FROM accounts WHERE code='7103'").pluck().get() as number;
    await accountant.post('/api/docs/acc.jv/post', {
      input: {
        memo: 'Made-up shop cash receipt',
        lines: [
          { accountId: cashId, debitCents: 12_345 },
          { accountId: incomeId, creditCents: 12_345 },
        ],
      },
      expectedTotalCents: 12_345,
    }, idem());

    const cash = await accountant.get('/api/rpt/cash-position?asOf=2026-09-29');
    expect(cash.statusCode, cash.body).toBe(200);
    expect(cash.json().rows.find((row: { id: number }) => row.id === cashId).balanceCents).toBe(12_345);

    const trialBalance = await accountant.get('/api/rpt/trial-balance?asOf=2026-09-29');
    expect(trialBalance.json().rows.find((row: { code: string }) => row.code === '1101').debitCents).toBe(12_345);
  });

  it('exports every CSV and denies a role without its report permission', async () => {
    const routes = [
      'ap-aging?asOf=2026-09-29',
      'purchases?from=2026-09-01&to=2026-09-29',
      'purchase-orders',
      'received-not-billed',
      'cash-position?asOf=2026-09-29',
      'transfers?from=2026-09-01&to=2026-09-29',
      'cash-counts?from=2026-09-01&to=2026-09-29',
      'assets?asOf=2026-09-29',
      'late-entries',
      'cancellations',
      'exceptions?asOf=2026-09-29',
    ];
    for (const route of routes) {
      expect((await encoder.get(`/api/rpt/${route}`)).statusCode, route).toBe(403);
      const separator = route.includes('?') ? '&' : '?';
      const exported = await accountant.get(`/api/rpt/${route}${separator}format=csv`);
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.headers['content-type']).toContain('text/csv');
    }
  });

  it('reserves sign-in history and its CSV for the owner', async () => {
    const route = '/api/rpt/sign-ins?from=2026-09-01&to=2026-09-29';
    expect((await accountant.get(route)).statusCode).toBe(403);
    expect((await encoder.get(route)).statusCode).toBe(403);

    const owner = await env.as('owner');
    const exported = await owner.get(`${route}&format=csv`);
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('Username');
  });
});
