/** Direct cash-flow golden: hand-worked receipts/payments, non-cash source documents, internal transfer, CSV and access. */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cashFlowStatement } from '../cash-flow.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv; let accountant: Client; let encoder: Client;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code=?').pluck().get(code) as number;

beforeEach(async () => {
  env = await createTestEnv(); accountant = await env.as('accountant'); encoder = await env.as('encoder');
  const customerId = seedCustomers(env.db, encoder.userId).school;
  const jv = async (date: string, memo: string, lines: { code: string; debitCents?: number; creditCents?: number }[]) => {
    const total = lines.reduce((sum, line) => sum + (line.debitCents ?? 0), 0);
    const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo, lateReason: 'Cash flow report made-up month',
      lines: lines.map(({ code, ...amount }) => {
        const partyType = env.db.prepare('SELECT party_type FROM accounts WHERE code=?').pluck().get(code) as string | null;
        return { accountId: account(code), ...amount, ...(partyType && partyType !== 'free'
          ? { party: { type: partyType, id: partyType === 'customer' ? customerId : `sample-${partyType}` } } : {}) };
      }) }, businessDate: date, expectedTotalCents: total }, idem());
    expect(r.statusCode, r.body).toBe(200);
  };
  await jv('2026-08-31', 'Opening cash', [{ code: '1101', debitCents: 10_000_000 }, { code: '3900', creditCents: 10_000_000 }]);
  // Downpayment and paid release invoice: collections 20,000 + 30,000.
  await jv('2026-09-02', 'Customer downpayment', [{ code: '1101', debitCents: 2_000_000 }, { code: '2201', creditCents: 2_000_000 }]);
  await jv('2026-09-04', 'Release invoice paid', [{ code: '1111', debitCents: 3_000_000 }, { code: '1201', creditCents: 3_000_000 }]);
  // Supplier bill and payroll run are non-cash; only their payment/release appears.
  await jv('2026-09-05', 'Supplier bill', [{ code: '5101', debitCents: 1_000_000 }, { code: '2101', creditCents: 1_000_000 }]);
  await jv('2026-09-06', 'Supplier payment', [{ code: '2101', debitCents: 1_000_000 }, { code: '1101', creditCents: 1_000_000 }]);
  await jv('2026-09-07', 'Expense paid', [{ code: '6120', debitCents: 500_000 }, { code: '1101', creditCents: 500_000 }]);
  await jv('2026-09-08', 'Payroll run', [{ code: '6101', debitCents: 1_000_000 }, { code: '2110', creditCents: 800_000 }, { code: '2401', creditCents: 200_000 }]);
  await jv('2026-09-09', 'Payroll release', [{ code: '2110', debitCents: 800_000 }, { code: '1101', creditCents: 800_000 }]);
  await jv('2026-09-10', 'Government remittance', [{ code: '2401', debitCents: 200_000 }, { code: '1101', creditCents: 200_000 }]);
  await jv('2026-09-11', 'Asset bought', [{ code: '1510', debitCents: 1_500_000 }, { code: '1111', creditCents: 1_500_000 }]);
  await jv('2026-09-12', 'Owner money in', [{ code: '1101', debitCents: 4_000_000 }, { code: '3101', creditCents: 4_000_000 }]);
  await jv('2026-09-13', 'Loan received', [{ code: '1111', debitCents: 2_500_000 }, { code: '2601', creditCents: 2_500_000 }]);
  await jv('2026-09-14', 'Loan repayment', [{ code: '2601', debitCents: 500_000 }, { code: '1111', creditCents: 500_000 }]);
  const transfer = await encoder.post('/api/docs/cash.transfer/post', { input: { fromCashPlaceId: cashPlaceId(env.db, '1101'),
    toCashPlaceId: cashPlaceId(env.db, '1111'), amountSentCents: 700_000, amountReceivedCents: 700_000 }, expectedTotalCents: 700_000 }, idem());
  expect(transfer.statusCode, transfer.body).toBe(200);
});

describe('statement of cash flows', () => {
  it('classifies the made-up month by direct method, excludes the transfer, and checks to the balance sheet cash', async () => {
    const r = await accountant.get('/api/rpt/cash-flow?from=2026-09-01&to=2026-09-30'); expect(r.statusCode).toBe(200);
    const flow = r.json() as ReturnType<typeof cashFlowStatement>;
    expect(flow.sections.map((s) => [s.key, s.lines.map((l) => [l.name, l.amountCents]), s.totalCents])).toEqual([
      ['operating', [['Collections from customers', 5_000_000], ['Payments to suppliers and for expenses', -1_500_000], ['Payroll paid', -800_000], ['Government remittances and taxes', -200_000]], 2_500_000],
      ['investing', [['Fixed assets bought', -1_500_000]], -1_500_000],
      ['financing', [['Owners’ money in', 4_000_000], ['Loans received', 2_500_000], ['Loans repaid', -500_000]], 6_000_000],
    ]);
    expect(flow).toMatchObject({ openingCashCents: 10_000_000, netChangeCents: 7_000_000, closingCashCents: 17_000_000,
      balanceSheetCashCents: 17_000_000, checkDifferenceCents: 0, balanced: true });
    expect(flow.sections.flatMap((s) => s.lines).some((l) => l.amountCents === 700_000 || l.amountCents === -700_000)).toBe(false);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it('exports CSV and denies a role without the books permission', async () => {
    const csv = await accountant.get('/api/rpt/cash-flow?from=2026-09-01&to=2026-09-30&format=csv');
    expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="cash-flow-2026-09-01-2026-09-30.csv"');
    expect(csv.body).toContain('"Operating activities","Collections from customers","50000.00"');
    expect(csv.body).toContain('"Check","Difference","0.00"');
    expect((await encoder.get('/api/rpt/cash-flow?from=2026-09-01&to=2026-09-30')).statusCode).toBe(403);
    expect((await encoder.get('/api/rpt/cash-flow?from=2026-09-01&to=2026-09-30&format=csv')).statusCode).toBe(403);
  });
});
