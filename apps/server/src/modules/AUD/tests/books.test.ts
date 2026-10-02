/**
 * The nightly "Books against the registers" check (PLAN D9 L6, L8, L10) and "Cash places below zero" (L11): each
 * passes on clean books and finds a planted problem. Problems are planted by hand (a trigger dropped, a row changed, or
 * a journal posted straight to the ledger), since the app itself never makes them. Made-up names only.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { PASSWORD, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { postJournal } from '../../../engine/ledger/post.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { world } from '../../PAY/tests/world.ts';
import { runChecks, type NightlyContext } from '../nightly.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

const ctx = (env: TestEnv): NightlyContext => ({ db: env.db, clock: env.clock, practice: true, titleOf: (t) => env.deps.registry.docType(t)?.title ?? t });
const check = (env: TestEnv, key: string) => runChecks(ctx(env), today(env.clock), today(env.clock)).find((c) => c.key === key)!;
const details = (env: TestEnv, key: string) => check(env, key).findings.map((f) => f.detail);
/** A journal posted straight to the ledger, as no document would. */
const plant = (env: TestEnv, userId: string, lines: Parameters<typeof postJournal>[1]['lines']) =>
  tx(env.db, () => postJournal(env.db, { memo: 'Planted for the test', lines }, { sourceType: 'test', sourceId: newId(), businessDate: today(env.clock), userId, at: stamp(env.clock) }));

async function shop() {
  const env = await createTestEnv(); // 2026-09-28 10:00 Manila
  const accountant = await env.as('accountant');
  const encoder = await env.as('encoder');
  return { env, accountant, encoder };
}
const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });

describe('books against the registers', () => {
  it('passes on clean books', async () => {
    const { env } = await shop();
    expect(check(env, 'books')).toMatchObject({ passed: true, findings: [] });
    expect(check(env, 'negative-cash')).toMatchObject({ passed: true, findings: [] });
  });

  it('L6: finds a register that does not add up to its account (an opening 2307 line changed by hand)', async () => {
    const { env, accountant, encoder } = await shop();
    const c = seedCustomers(env.db, encoder.userId);
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER })).statusCode).toBe(200);
    const input = { rows: [{ customerId: c.school, year: 2026, quarter: 2, atc: 'WC158', cwtCents: 100_000, vatWithheldCents: 500_000, certificate: 'received' }] };
    const ob = await accountant.post('/api/docs/tax.opening/post', { input, expectedTotalCents: 600_000, businessDate: CUTOVER }, idem());
    expect(ob.statusCode, ob.body).toBe(200);
    expect(check(env, 'books').passed).toBe(true);

    env.db.exec('DROP TRIGGER tax_opening_lines_no_update');
    env.db.prepare('UPDATE tax_opening_lines SET cwt_cents = 90_000').run();
    expect(details(env, 'books')).toEqual([
      '2307s received (creditable tax), July to September 2026: the register adds up to ₱900.00 but the books show ₱1,000.00.']);
    expect(check(env, 'books').findings[0]!.path).toBe('/tax/2307-received');
  });

  it('L8: finds opening balance equity left after the opening balances are closed', async () => {
    const { env, accountant } = await shop();
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER })).statusCode).toBe(200);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);
    expect(check(env, 'books').passed).toBe(true);

    plant(env, accountant.userId, [{ account: { role: 'OPENING_EQUITY' }, debitCents: 5_000 }, { account: { role: 'CASH_SHORT_OVER' }, creditCents: 5_000 }]);
    expect(details(env, 'books')).toEqual([expect.stringMatching(/^3900 .+ is ₱50\.00 debit, but the opening balances were closed on 2026-09-28 and it should be zero\.$/)]);
  });

  it('L10: finds a payslip whose lines do not add up to its gross, and a run whose payslips do not add up to it', async () => {
    const w = await world('2026-09-15');
    w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const run = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    expect(check(w.env, 'books').passed).toBe(true);

    w.db.exec('DROP TRIGGER pay_run_employees_no_update');
    w.db.prepare('UPDATE pay_run_employees SET gross_cents = gross_cents + 100, net_cents = net_cents + 100').run(); // net = gross less deductions still holds
    const c = check(w.env, 'books');
    expect(c.findings.map((f) => f.detail)).toEqual([
      "PAY-000001: Carla Opisina's gross pay is ₱7,501.00 but the payslip's lines add up to ₱7,500.00.",
      "PAY-000001: the run's gross pay is ₱7,500.00 but its payslips add up to ₱7,501.00.",
      "PAY-000001: the run's net pay is ₱6,600.00 but its payslips add up to ₱6,601.00.",
    ]);
    expect(c.findings[0]!.path).toBe(`/docs/pay.run/${run.id}`);
  });
});

describe('cash places below zero', () => {
  it('L11: finds a cash place below zero', async () => {
    const { env, accountant } = await shop();
    plant(env, accountant.userId, [{ account: { role: 'CASH_SHORT_OVER' }, debitCents: 100 }, { account: { cashPlace: env.db.prepare("SELECT id FROM accounts WHERE code = '1101'").pluck().get() as number }, creditCents: 100 }]);
    expect(check(env, 'negative-cash').findings).toEqual([{ detail: expect.stringMatching(/ is ₱1\.00 below zero\.$/), path: '/cash/accounts' }]);
  });
});
