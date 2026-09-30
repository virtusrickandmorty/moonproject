/**
 * Bad debts on the income tax worksheets (ACC-26): a provision for credit losses is not deductible, only an actual
 * write-off is. Under the allowance method the 1702Q and 1702-RT add back the 6270 the allowance moved and deduct what
 * was written off against 1209 (net of a recovery); under the direct method the write-off on 6270 is deducted as it is.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { addSettingVersion } from '../../../engine/settings.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let invoiceNo = 500;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  invoiceNo = 500;
});

const posted = async (type: string, input: object, total: number, who = accountant): Promise<string> => {
  const r = await who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
};
/** A one-line JO released in full on credit with its invoice record: the invoice's id. */
async function invoiced(cents: number, customerId: string): Promise<string> {
  const jo = await posted('jo.job_order', { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] }] }, cents, encoder);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo).padStart(4, '0') }, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().invoiceRecord.id;
}
const allowanceMethod = () =>
  tx(env.db, () => addSettingVersion(env.db, { key: 'acc.bad_debt_method', effectiveFrom: today(env.clock), value: 'allowance', reason: 'Accountant picked the method (ACC-26)', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
const RATES = { currentBp: 100, days1to30Bp: 500, days31to60Bp: 1000, days61to90Bp: 2500, over90Bp: 5000 };
type Sheet = { lines: { key: string; cents: number }[]; checks: { code: string }[]; deductionsCents: number; taxableIncomeCents: number };
const figures = (w: Sheet) => Object.fromEntries(w.lines.map((l) => [l.key, l.cents]));

describe('bad debts on the 1702Q and 1702-RT (ACC-26)', () => {
  it('allowance method: the provision is added back and the write-off against the allowance deducted, so taxable income is as under direct', async () => {
    allowanceMethod();
    const school = await invoiced(5_600_000, c.school); // net 50,000.00
    await posted('col.allowance', { basis: 'customer', ...RATES, customers: [{ customerId: c.school, allowanceCents: 5_600_000 }], reason: 'The school stopped answering calls' }, 5_600_000);
    await posted('col.write_off', { invoiceId: school, reason: 'Customer closed shop and cannot be reached' }, 5_600_000);
    await invoiced(1_120_000, c.other); // net 10,000.00
    await posted('col.allowance', { basis: 'customer', ...RATES, reason: 'Month-end review of the AR aging' }, 11_200); // 1% of 11,200.00

    for (const url of ['/api/tax/1702q?year=2026&quarter=3', '/api/tax/1702rt?year=2026']) {
      const w = (await accountant.get(url)).json() as Sheet;
      expect(figures(w), url).toMatchObject({
        sales: 6_000_000,
        expenses_per_books: 5_611_200, // 6270: the provisions 56,000.00 + 112.00
        bad_debt_provision: 5_611_200,
        bad_debt_written_off: 5_600_000,
        deductions: 5_600_000,
        taxable_income: 400_000,
      });
      expect(w.lines.map((l) => l.key).slice(5, 9), url).toEqual(['expenses_per_books', 'bad_debt_provision', 'bad_debt_written_off', 'deductions']);
      expect(w.checks.map((x) => x.code), url).toContain('BAD_DEBTS');
    }
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('a recovery of a write-off against the allowance takes it off the deductions; direct write-offs need no lines', async () => {
    const direct = await invoiced(560_000, c.school);
    await posted('col.write_off', { invoiceId: direct, reason: 'Customer closed shop and cannot be reached' }, 560_000);
    let w = (await accountant.get('/api/tax/1702q?year=2026&quarter=3')).json() as Sheet;
    expect(w.lines.map((l) => l.key)).not.toContain('bad_debt_provision');
    expect(w.deductionsCents).toBe(560_000);

    allowanceMethod();
    const inv = await invoiced(1_120_000, c.other);
    await posted('col.allowance', { basis: 'customer', ...RATES, customers: [{ customerId: c.other, allowanceCents: 1_120_000 }], reason: 'The club disbanded, likely lost' }, 1_120_000);
    const off = await posted('col.write_off', { invoiceId: inv, reason: 'Customer closed shop and cannot be reached' }, 1_120_000);
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    expect((await accountant.post(`/api/docs/col.write_off/${off}/cancel`, { reason: 'The club paid after all, recovered' }, idem())).statusCode).toBe(200);
    w = (await accountant.get('/api/tax/1702q?year=2026&quarter=3')).json() as Sheet;
    // 6270: 5,600.00 direct + 11,200.00 provision; the provision added back; the write-off and its recovery net to nothing.
    expect(figures(w)).toMatchObject({ expenses_per_books: 1_680_000, bad_debt_provision: 1_120_000, bad_debt_written_off: 0, deductions: 560_000 });
  });
});
