/**
 * Quarterly income tax (1702Q, PLAN D5 IT-QPAY, D8 "Quarterly", E12): the worksheet from the ledger in whole pesos, and
 * the BIR payment that pays it (Dr 1411 prepaid income tax, or Dr 2320 for a 1702Q an opening brought in). Made-up
 * figures in 2026: a profitable Q1 paid late with a penalty, Q2 taking off Q1's payment and the 2307s in hand, a loss,
 * MCIT higher than the regular tax, and an opening 1702Q paid from 2320. The refusals, the settings, the calendar, and
 * runInvariants clean.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { incomeStatement } from '../../RPT/statements.ts';
import type { BirPaymentInput } from '../doctypes/bir-payment.ts';

let env: TestEnv;
let encoder: Client, accountant: Client, owner: Client;
let BDO: number, CASH: number;
let customer: string;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
/** Moves the clock; yesterday's sessions have timed out. */
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
};
const ok = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);

/** A journal voucher of today: [account code, debit (+) or credit (−) in centavos]; revenue lines carry the customer. */
async function jv(memo: string, lines: [string, number][]) {
  const input = {
    memo,
    lines: lines.map(([code, cents]) => ({
      accountId: account(code), ...(code.startsWith('41') ? { party: { type: 'customer' as const, id: customer } } : {}),
      ...(cents > 0 ? { debitCents: cents } : { creditCents: -cents }),
    })),
  };
  return ok(await accountant.post('/api/docs/acc.jv/post', { input, expectedTotalCents: lines.filter(([, c]) => c > 0).reduce((s, [, c]) => s + c, 0) }, idem()));
}
const sale = (cents: number) => jv('Sales of the month', [['1101', cents], ['4101', -cents]]);
const expense = (code: string, cents: number) => jv(`Expense ${code}`, [[code, cents], ['1101', -cents]]);
/** A customer's payment kept as a deposit, with CWT on a 2307 in hand or pending. */
const collectWithCwt = async (crNumber: string, cashCents: number, cwtCents: number, certificate: 'received' | 'pending') =>
  ok(await encoder.post('/api/docs/col.collection/post', {
    input: { customerId: customer, crNumber, applications: [], tenders: [{ cashPlaceId: CASH, amountCents: cashCents }], withholding: { cwtCents, atc: 'WC158', certificate } },
    expectedTotalCents: cashCents + cwtCents,
  }, idem()));

const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const settings = async (value: { regularRateBp: number; mcitRateBp: number; operationsBeganYear: number | null }, effectiveFrom: string) => {
  await stepUp(accountant);
  const res = await accountant.post('/api/tax/income-tax-settings', { effectiveFrom, value, reason: 'Confirmed with the accountant for the year' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

type Worksheet = {
  lines: { key: string; label: string; cents: number }[]; checks: { code: string; level: string }[]; basis: string; mcitApplies: boolean | null; returnDue: string;
  taxDueCents: number; dueCents: number; paidCents: number; leftCents: number; payableCents: number; opening: { number: string } | null;
};
const worksheet = async (year: number, quarter: number, who = accountant) => (await who.get(`/api/tax/1702q?year=${year}&quarter=${quarter}`)).json() as Worksheet;
/** The worksheet's lines as [key, pesos]. */
const figures = (w: Worksheet) => w.lines.map((l) => [l.key, formatPesos(l.cents)]);
const checkCodes = (w: Worksheet) => w.checks.map((c) => `${c.level} ${c.code}`);

const pay = (o: Partial<BirPaymentInput> & Pick<BirPaymentInput, 'period' | 'amountCents'>): BirPaymentInput => ({ form: '1702Q', cashPlaceId: BDO, reference: 'eFPS 1702Q-0001', ...o });
const preview = async (input: BirPaymentInput) => (await accountant.post('/api/docs/tax.bir_payment/preview', { input })).json();
const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);
const record = async (input: BirPaymentInput) => {
  const res = await accountant.post('/api/docs/tax.bir_payment/post', { input, expectedTotalCents: (await preview(input)).totalCents }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string; totalCents: number; warnings: { code: string; level: string }[] };
};
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded against the wrong quarter' }, idem());

/** The document's journal: "1411 Dr 81,000.00", by account. */
function journal(documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, l.memo FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY a.code`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}`);
}
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

beforeEach(async () => {
  env = await createTestEnv('2026-01-05T02:00:00Z'); encoderOwnDefaults(env);
  await goTo('2026-01-05');
  [BDO, CASH] = [cashPlaceId(env.db, '1111'), cashPlaceId(env.db, '1101')];
  customer = seedCustomers(env.db, encoder.userId).school;
});

describe('1702Q worksheet and payment (D5 IT-QPAY)', () => {
  it('a profitable Q1, paid late with a penalty; Q2 takes off Q1’s payment and the 2307s in hand', async () => {
    await settings({ regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: 2015 }, '2026-01-05');
    await goTo('2026-02-15');
    await sale(100_000_040); // ₱1,000,000.40 → ₱1,000,000
    await expense('5101', 40_000_049); // cost of sales ₱400,000.49 → ₱400,000
    await expense('6110', 20_000_000); // rent ₱200,000.00
    await expense('6290', 100_000); // a penalty: not deductible
    await jv('Scrap sold', [['1101', 500_000], ['7103', -500_000]]); // other income ₱5,000.00
    await jv('Bank interest, net of final tax', [['1101', 80_000], ['7101', -80_000]]); // under final tax: left out

    // Before the quarter ends the worksheet says so, and no payment is taken.
    await goTo('2026-03-20');
    expect(checkCodes(await worksheet(2026, 1))).toContain('info QUARTER_OPEN');
    expect(codes((await preview(pay({ period: '2026-Q1', amountCents: 8_100_000 }))).issues)).toEqual(['QUARTER_OPEN']);

    await goTo('2026-04-10');
    const q1 = await worksheet(2026, 1);
    expect(figures(q1)).toEqual([
      ['sales', '1,000,000.00'], ['cost_of_sales', '400,000.00'], ['gross_income', '600,000.00'], ['other_income', '5,000.00'],
      ['total_gross_income', '605,000.00'], ['deductions', '200,000.00'], ['taxable_income', '405,000.00'],
      ['regular_tax', '81,000.00'], ['mcit', '12,100.00'], ['tax_due', '81,000.00'],
      ['prior_payments', '0.00'], ['prior_prepaid', '0.00'], ['cwt', '0.00'], ['payable', '81,000.00'],
    ]);
    expect(q1).toMatchObject({ basis: 'regular', mcitApplies: true, taxDueCents: 8_100_000, dueCents: 8_100_000, paidCents: 0, leftCents: 8_100_000, returnDue: '2026-06-01' }); // 30 May is a Saturday
    expect(checkCodes(q1)).toEqual(['info PENALTIES', 'info INTEREST']);
    // The income statement of the same dates agrees before the rounding.
    const is = incomeStatement(env.db, '2026-01-01', '2026-03-31');
    expect(is.grossProfitCents).toBe(100_000_040 - 40_000_049);
    expect(is.incomeBeforeTaxCents).toBe(100_000_040 - 40_000_049 - 20_000_000 - 100_000 + 500_000 + 80_000);

    const csv = (await accountant.get('/api/tax/1702q?year=2026&quarter=1&format=csv')).body.replace(/^\uFEFF/, '').split('\r\n');
    expect(csv.slice(0, 3)).toEqual(['"Item","Amount"', '"Sales, net of discounts and returns","1000000.00"', '"Less: cost of sales","400000.00"']);
    expect(csv).toContain('"Left to pay","81000.00"');
    expect(csv).toContain('"Rates in force on 2026-03-31: regular 20%, MCIT 2%, operations began 2015",""');

    // Q2: more sales and rent; a 2307 in hand (₱5,000.00) and one still pending (₱2,000.00).
    await goTo('2026-05-12');
    await sale(50_000_000);
    await expense('6110', 10_000_000);
    await collectWithCwt('0101', 49_500_000, 500_000, 'received');
    await collectWithCwt('0102', 19_800_000, 200_000, 'pending');

    // Paid on 5 June, after the due date, with ₱500.00 surcharge: Dr 1411 / Dr 6290 / Cr the bank.
    await goTo('2026-06-05');
    const input = pay({ period: '2026-Q1', amountCents: 8_100_000 });
    const pre = await preview(input);
    expect([codes(pre.issues), codes(pre.issues, 'warning'), pre.doc.payableCents]).toEqual([[], ['LATE'], 8_100_000]);
    expect((await preview({ ...input, penaltyCents: 50_000 })).summary).toBe(
      'This will record ₱81,000.00 income tax paid to the BIR with the 1702Q for Q1 2026 (eFPS 1702Q-0001) from Cash in bank – BDO, plus ₱500.00 surcharge, interest and compromise (₱81,500.00 in all).',
    );
    const p1 = await record({ ...input, penaltyCents: 50_000 });
    expect(p1).toMatchObject({ number: 'BIRP-000001', totalCents: 8_150_000, warnings: [] });
    expect(journal(p1.id)).toEqual(['1111 Cr 81,500.00', '1411 Dr 81,000.00', '6290 Dr 500.00']);
    expect((await accountant.get(`/api/docs/tax.bir_payment/${p1.id}`)).json().doc).toMatchObject({ form: '1702Q', period: '2026-Q1', payableCents: 8_100_000, opening: null, penaltyCents: 50_000 });
    expect(await worksheet(2026, 1)).toMatchObject({ paidCents: 8_100_000, leftCents: 0 });
    expect(codes((await preview(pay({ period: '2026-Q1', amountCents: 100 }))).issues)).toEqual(['NOTHING_DUE']);

    await goTo('2026-07-15');
    const q2 = await worksheet(2026, 2);
    expect(figures(q2).slice(4)).toEqual([
      ['total_gross_income', '1,105,000.00'], ['deductions', '300,000.00'], ['taxable_income', '805,000.00'],
      ['regular_tax', '161,000.00'], ['mcit', '22,100.00'], ['tax_due', '161,000.00'],
      ['prior_payments', '81,000.00'], ['prior_prepaid', '0.00'], ['cwt', '5,000.00'], ['payable', '75,000.00'],
    ]);
    expect(checkCodes(q2)).toEqual(['warning PENDING_2307', 'info PENALTIES', 'info INTEREST']);
    // The payment form opens on what is left; ₱40,000.00 now leaves ₱35,000.00.
    const p2 = await record(pay({ period: '2026-Q2', amountCents: 4_000_000 }));
    expect(codes(p2.warnings, 'warning')).toEqual(['UNDER']);
    expect(journal(p2.id)).toEqual(['1111 Cr 40,000.00', '1411 Dr 40,000.00']);
    expect(await worksheet(2026, 2)).toMatchObject({ dueCents: 7_500_000, paidCents: 4_000_000, leftCents: 3_500_000 });
    expect((await accountant.get('/api/tax/payments/due')).json()).toEqual([{ form: '1702Q', period: '2026-Q2', payableCents: 3_500_000 }]);

    // Cancel mirrors it; Q2 is due in full again, and 1411 holds Q1's payment only.
    expect((await cancel('tax.bir_payment', p2.id)).statusCode).toBe(200);
    expect(journal(p2.id, 'reversal')).toEqual(['1111 Dr 40,000.00', '1411 Cr 40,000.00']);
    expect(await worksheet(2026, 2)).toMatchObject({ leftCents: 7_500_000 });
    expect(balances(env.db)['1411']).toBe(8_100_000);
    noBrokenInvariants();
  });

  it('a loss: nothing is due; more than is due needs a note', async () => {
    await settings({ regularRateBp: 2500, mcitRateBp: 200, operationsBeganYear: 2024 }, '2026-01-05'); // MCIT from 2028
    await goTo('2026-02-10');
    await sale(10_000_000);
    await expense('5101', 8_000_000);
    await expense('6110', 5_000_000);
    await goTo('2026-04-15');
    const w = await worksheet(2026, 1);
    expect(figures(w).slice(4)).toEqual([
      ['total_gross_income', '20,000.00'], ['deductions', '50,000.00'], ['taxable_income', '-30,000.00'],
      ['regular_tax', '0.00'], ['mcit', '400.00'], ['tax_due', '0.00'], ['prior_payments', '0.00'], ['prior_prepaid', '0.00'], ['cwt', '0.00'], ['payable', '0.00'],
    ]);
    expect(w.lines.find((l) => l.key === 'taxable_income')!.label).toBe('Net loss');
    expect(w.lines.find((l) => l.key === 'mcit')!.label).toBe('Minimum corporate income tax (2% of total gross income), does not apply yet');
    expect(w).toMatchObject({ mcitApplies: false, basis: 'regular', dueCents: 0, leftCents: 0 });

    // The return may say more than the books: refused without a note, a warning with one.
    const input = pay({ period: '2026-Q1', amountCents: 150_000 });
    expect(codes((await preview(input)).issues)).toEqual(['NOTHING_DUE']);
    const noted = { ...input, note: 'The filed 1702Q adds income of the old books' };
    expect([codes((await preview(noted)).issues), codes((await preview(noted)).issues, 'warning')]).toEqual([[], ['OVER_NOTED']]);
    const p = await record(noted);
    expect(journal(p.id)).toEqual(['1111 Cr 1,500.00', '1411 Dr 1,500.00']);
    expect(env.db.prepare('SELECT payable_cents, amount_cents, note FROM tax_income_tax_payments WHERE document_id = ?').get(p.id)).toEqual({
      payable_cents: 0, amount_cents: 150_000, note: 'The filed 1702Q adds income of the old books',
    });
    // Overpaid: the credits are more than the tax, and nothing is left.
    expect(await worksheet(2026, 1)).toMatchObject({ dueCents: 0, paidCents: 150_000, leftCents: -150_000 });
    noBrokenInvariants();
  });

  it('MCIT is higher than the regular tax, from the 4th year after operations began', async () => {
    await settings({ regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: 2019 }, '2026-01-05');
    await goTo('2026-03-02');
    await sale(200_000_000);
    await expense('5101', 100_000_000);
    await expense('6110', 98_000_000);
    await goTo('2026-04-06');
    const w = await worksheet(2026, 1);
    expect(figures(w).slice(4, 10)).toEqual([
      ['total_gross_income', '1,000,000.00'], ['deductions', '980,000.00'], ['taxable_income', '20,000.00'],
      ['regular_tax', '4,000.00'], ['mcit', '20,000.00'], ['tax_due', '20,000.00'],
    ]);
    expect(w).toMatchObject({ basis: 'mcit', mcitApplies: true, dueCents: 2_000_000 });
    expect(w.lines.find((l) => l.key === 'tax_due')!.label).toBe('Income tax due (MCIT, the higher)');
    // Paying more than is due is refused without a note.
    expect(codes((await preview(pay({ period: '2026-Q1', amountCents: 2_000_100 }))).issues)).toEqual(['OVER']);
    const p = await record(pay({ period: '2026-Q1', amountCents: 2_000_000 }));
    expect(journal(p.id)).toEqual(['1111 Cr 20,000.00', '1411 Dr 20,000.00']);
    noBrokenInvariants();
  });

  it('the defaults at install are flagged; settings change from today on, with a fresh password', async () => {
    await goTo('2026-04-06');
    const w = await worksheet(2026, 1);
    expect(checkCodes(w)).toEqual(['warning SETTINGS_DEFAULT', 'warning MCIT_UNKNOWN']);
    expect(w.mcitApplies).toBeNull();
    expect((await accountant.get('/api/tax/income-tax-settings')).json().current).toMatchObject({ regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: null, confirmed: false });

    const change = { effectiveFrom: '2026-04-06', value: { regularRateBp: 2500, mcitRateBp: 200, operationsBeganYear: 2010 }, reason: 'Total assets are above ₱100 million' };
    expect((await accountant.post('/api/tax/income-tax-settings', change)).json().code).toBe('STEP_UP_REQUIRED');
    expect((await encoder.post('/api/tax/income-tax-settings', change)).statusCode).toBe(403);
    await stepUp(accountant);
    expect((await accountant.post('/api/tax/income-tax-settings', { ...change, effectiveFrom: '2026-04-05' })).json().code).toBe('SETTING_BACKDATED');
    expect((await accountant.post('/api/tax/income-tax-settings', { ...change, value: { ...change.value, regularRateBp: 9000 } })).json().code).toBe('BAD_VALUE');
    const v = await accountant.post('/api/tax/income-tax-settings', change);
    expect(v.json()).toMatchObject({ effectiveFrom: '2026-04-06', regularRateBp: 2500, confirmed: true });
    expect((await accountant.post('/api/tax/income-tax-settings', change)).json().code).toBe('NO_CHANGE');
    // Read on the quarter's last day: Q1 keeps the defaults, Q2 takes the new version.
    expect(checkCodes(await worksheet(2026, 1))).toContain('warning SETTINGS_DEFAULT');
    expect(await worksheet(2026, 2)).toMatchObject({ mcitApplies: true });
    expect(env.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action = 'tax.income_tax_settings.add'").pluck().get()).toBe(1);
  });

  it('Q4 has no 1702Q; encoders see no worksheet; the calendar has the 1702Q 60 days after the quarter', async () => {
    await goTo('2026-10-05');
    expect((await accountant.get('/api/tax/1702q?year=2026&quarter=4')).json().code).toBe('NO_Q4');
    expect((await accountant.get('/api/tax/1702q?year=2026')).json().code).toBe('BAD_QUARTER');
    expect((await encoder.get('/api/tax/1702q?year=2026&quarter=3')).statusCode).toBe(403);
    expect(codes((await preview(pay({ period: '2025-Q4', amountCents: 100 }))).issues)).toEqual(['NO_Q4']);
    const due = (await accountant.get('/api/tax/calendar?from=2026-10-01&to=2026-12-31')).json().filter((d: { form: string }) => d.form === '1702Q');
    expect(due).toMatchObject([{ period: '2026-Q3', statutoryDate: '2026-11-29', periodStart: '2026-01-01', periodEnd: '2026-09-30' }]);
    expect((await worksheet(2026, 3)).returnDue).toBe(due[0].dueDate);
  });
});

describe('a 1702Q the old books left unpaid (opening tax payable, on 2320)', () => {
  it('is paid from 2320, up to what the opening left; a quarter before the cut-over with no opening is refused', async () => {
    await goTo('2026-09-28');
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: '2026-09-27' })).statusCode).toBe(200);
    const opening = await accountant.post('/api/docs/tax.payable.opening/post', {
      input: { rows: [{ form: '1702Q', period: '2026-Q2', amountCents: 1_500_000 }] }, expectedTotalCents: 1_500_000, businessDate: '2026-09-27',
    }, idem());
    const openingId = ok(opening);

    const w = await worksheet(2026, 2);
    expect(w).toMatchObject({ opening: { number: 'OBTP-000001' }, dueCents: 1_500_000, leftCents: 1_500_000 });
    expect(checkCodes(w)).toEqual(['warning SETTINGS_DEFAULT', 'warning MCIT_UNKNOWN', 'info OPENED']);
    expect(checkCodes(await worksheet(2026, 1))).toContain('warning OLD_BOOKS');
    expect(checkCodes(await worksheet(2026, 3))).toEqual(['warning SETTINGS_DEFAULT', 'warning MCIT_UNKNOWN', 'warning BOOKS_START', 'info QUARTER_OPEN']);

    // Q1 ended before the cut-over and was not opened: the old books'. Q3 has not ended.
    expect(codes((await preview(pay({ period: '2026-Q1', amountCents: 100 }))).issues)).toEqual(['OLD_BOOKS']);
    expect(codes((await preview(pay({ period: '2026-Q3', amountCents: 100 }))).issues)).toEqual(['QUARTER_OPEN']);
    // More than the opening left is refused even with a note: the opening is corrected first.
    expect(codes((await preview(pay({ period: '2026-Q2', amountCents: 1_500_100, note: 'The return says more' }))).issues)).toEqual(['OVER']);

    const input = pay({ period: '2026-Q2', amountCents: 1_500_000 });
    const pre = await preview(input);
    expect(pre.doc).toMatchObject({ payableCents: 1_500_000, opening: { documentId: openingId, number: 'OBTP-000001', date: '2026-09-27' } });
    const p = await record(input);
    expect(journal(p.id)).toEqual(['1111 Cr 15,000.00', '2320 Dr 15,000.00']);
    expect(balances(env.db)['2320'] ?? 0).toBe(0);
    expect(balances(env.db)['1411'] ?? 0).toBe(0);
    expect((await accountant.get(`/api/docs/tax.bir_payment/${p.id}`)).json().doc).toMatchObject({ opening: { number: 'OBTP-000001' }, payableCents: 1_500_000 });
    expect(await worksheet(2026, 2)).toMatchObject({ paidCents: 1_500_000, leftCents: 0 });
    expect((await accountant.get('/api/tax/payments/due')).json()).toEqual([]);
    // Q3's 1702Q takes Q2's payment off as paid for an earlier quarter.
    expect((await worksheet(2026, 3)).lines.find((l) => l.key === 'prior_payments')!.cents).toBe(1_500_000);

    // The opening waits for its payment: cancel the payment first.
    expect((await cancel('tax.payable.opening', openingId)).json().message).toBe(`Cancel these first: ${p.number}.`);
    expect((await cancel('tax.bir_payment', p.id)).statusCode).toBe(200);
    expect(journal(p.id, 'reversal')).toEqual(['1111 Dr 15,000.00', '2320 Cr 15,000.00']);
    expect((await cancel('tax.payable.opening', openingId)).statusCode).toBe(200);
    noBrokenInvariants();
  });
});
