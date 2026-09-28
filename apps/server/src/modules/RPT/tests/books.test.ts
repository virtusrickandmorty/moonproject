import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let accountant: Client;
let encoder: Client;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

async function record(date: string, debitCode: string, creditCode: string, cents: number) {
  const input = { memo: `Book test entry for ${date}`, ...(date < '2026-09-28' ? { lateReason: 'Late test entry for accounting books' } : {}),
    lines: [{ accountId: account(debitCode), debitCents: cents }, { accountId: account(creditCode), creditCents: cents }] };
  const res = await accountant.post('/api/docs/acc.jv/post', { input, businessDate: date, expectedTotalCents: cents }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string };
}

describe('RPT accounting books', () => {
  it('uses posted journal lines for the journal, running ledger and comparative trial balance', async () => {
    const first = await record('2026-09-26', '1101', '7103', 10_000);
    const second = await record('2026-09-27', '1101', '7103', 5_000);
    await record('2026-09-28', '7103', '1101', 3_000);

    const journal = await accountant.get('/api/rpt/journal?from=2026-09-27&to=2026-09-27');
    expect(journal.statusCode).toBe(200);
    expect(journal.json().journals).toHaveLength(1);
    expect(journal.json().journals[0]).toMatchObject({ documentNumber: second.number, sourceId: second.id,
      lines: [{ accountCode: '1101', debitCents: 5_000 }, { accountCode: '7103', creditCents: 5_000 }] });

    const ledger = await accountant.get(`/api/rpt/ledger?from=2026-09-27&to=2026-09-28&accountId=${account('1101')}`);
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().accounts[0]).toMatchObject({ openingBalanceCents: 10_000, closingBalanceCents: 12_000,
      lines: [{ runningBalanceCents: 15_000 }, { runningBalanceCents: 12_000 }] });

    const tb = await accountant.get('/api/rpt/trial-balance?asOf=2026-09-28&compareTo=2026-09-26');
    expect(tb.statusCode).toBe(200);
    expect(tb.json()).toMatchObject({ totalDebitCents: 12_000, totalCreditCents: 12_000,
      compareTotalDebitCents: 10_000, compareTotalCreditCents: 10_000 });
    expect(tb.json().rows.find((r: { code: string }) => r.code === '1101')).toMatchObject({ debitCents: 12_000, compareDebitCents: 10_000 });
    expect(first.id).not.toBe(second.id);
  });

  it('rejects encoders on every route and exports quoted, peso-denominated CSV', async () => {
    await record('2026-09-28', '1101', '7103', 12_345);
    for (const path of ['accounts', 'journal?from=2026-09-28&to=2026-09-28',
      'ledger?from=2026-09-28&to=2026-09-28', 'trial-balance?asOf=2026-09-28',
      'journal?from=2026-09-28&to=2026-09-28&format=csv']) {
      expect((await encoder.get(`/api/rpt/${path}`)).statusCode).toBe(403);
    }
    const csv = await accountant.get('/api/rpt/journal?from=2026-09-28&to=2026-09-28&format=csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"123.45"');
    expect(csv.body).toContain('"JV-000001"');
    expect(csv.body).not.toContain('"12345"');
    expect((await accountant.get('/api/rpt/ledger?from=2026-09-29&to=2026-09-28')).statusCode).toBe(400);
  });
});
