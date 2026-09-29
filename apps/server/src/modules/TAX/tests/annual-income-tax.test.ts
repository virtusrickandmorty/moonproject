/**
 * Annual income tax (1702-RT, PLAN D5 IT-PROV and IT-SETTLE, D8 "Yearly", E12): the worksheet from the ledger in whole
 * pesos, the provision (Dr 8101 / Cr 2320, dated 31 December), the settlement (Dr 2320 / Cr 1411, Cr 1410 for the
 * 2307s in hand; an overpayment carried over on 1411) and the 1702 payment of what is left (Dr 2320). Made-up golden
 * years: 2026 at the regular rate with two 1702Q payments and a 2307 that came in January, a payable paid with the 1702;
 * a year where MCIT is the higher and the credits overpay it, carried over into 2027's 1702Q and 1702-RT; the 40%
 * optional standard deduction picked for the year. Cancels mirror, in order. 403 without the permission. runInvariants.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import type { BirPaymentInput } from '../doctypes/bir-payment.ts';

let env: TestEnv;
let encoder: Client, accountant: Client, owner: Client;
let BDO: number, CASH: number;
let customer: string;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
};
const ok = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);

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
};

type Worksheet = {
  lines: { key: string; label: string; cents: number }[]; checks: { code: string; level: string }[]; basis: string; returnDue: string;
  taxDueCents: number; payableCents: number; provisionCents: number; prepaidCents: number; dueCents: number; paidCents: number; leftCents: number;
  deduction: { method: string; confirmed: boolean }; provision: { number: string } | null; settlement: { number: string } | null;
};
const worksheet = async (year: number, who = accountant) => {
  const res = await who.get(`/api/tax/1702rt?year=${year}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Worksheet;
};
const figures = (w: Worksheet) => w.lines.map((l) => [l.key, formatPesos(l.cents)]);
const checkCodes = (w: Worksheet) => w.checks.map((c) => `${c.level} ${c.code}`);
const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);

const preview = async (type: string, input: unknown, businessDate?: string, who = accountant) =>
  (await who.post(`/api/docs/${type}/preview`, { input, ...(businessDate ? { businessDate } : {}) })).json();
const record = async (type: string, input: unknown, businessDate?: string) => {
  const res = await accountant.post(`/api/docs/${type}/post`, { input, expectedTotalCents: (await preview(type, input, businessDate)).totalCents, ...(businessDate ? { businessDate } : {}) }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string; businessDate: string; totalCents: number; warnings: { code: string; level: string }[] };
};
const provide = (year: number) => record('tax.it_provision', { year }, `${year}-12-31`);
const settle = (year: number, businessDate?: string) => record('tax.it_settlement', { year }, businessDate);
const pay = (o: Partial<BirPaymentInput> & Pick<BirPaymentInput, 'form' | 'period' | 'amountCents'>) => record('tax.bir_payment', { cashPlaceId: BDO, reference: 'eFPS 0001', ...o });
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded against the wrong year' }, idem());

/** The document's journal: "1411 Cr 156,000.00", by account; with the date when asked. */
function journal(documentId: string, kind: 'original' | 'reversal' = 'original', dated = false): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, j.business_date AS date FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY a.code, l.debit_cents DESC`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; date: string }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${dated ? ` ${r.date}` : ''}`);
}
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

beforeEach(async () => {
  env = await createTestEnv('2026-01-05T02:00:00Z');
  await goTo('2026-01-05');
  [BDO, CASH] = [cashPlaceId(env.db, '1111'), cashPlaceId(env.db, '1101')];
  customer = seedCustomers(env.db, encoder.userId).school;
});

describe('1702-RT, provision and settlement (D5 IT-PROV, IT-SETTLE)', () => {
  it('a profitable year at the regular rate: 1702Q payments and 2307s credited, the rest paid with the 1702; cancels mirror in order', async () => {
    await settings({ regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: 2015 }, '2026-01-05');
    await goTo('2026-02-15');
    await sale(100_000_040); // ₱1,000,000.40
    await expense('5101', 40_000_049); // cost of sales ₱400,000.49
    await expense('6110', 20_000_000); // rent
    await expense('6290', 100_000); // a penalty: not deductible
    await jv('Scrap sold', [['1101', 500_000], ['7103', -500_000]]);
    await jv('Bank interest, net of final tax', [['1101', 80_000], ['7101', -80_000]]);
    await goTo('2026-04-10');
    const q1 = await pay({ form: '1702Q', period: '2026-Q1', amountCents: 8_100_000 });
    await goTo('2026-05-12');
    await sale(50_000_000);
    await expense('6110', 10_000_000);
    await collectWithCwt('0101', 49_500_000, 500_000, 'received');
    const pending = await collectWithCwt('0102', 19_800_000, 200_000, 'pending');
    await goTo('2026-07-15');
    await pay({ form: '1702Q', period: '2026-Q2', amountCents: 7_500_000 });
    await goTo('2026-11-10');
    await sale(30_000_000);
    await expense('6120', 5_000_000);

    // Before the year ends: the worksheet says so, and nothing is provided or settled.
    await goTo('2026-12-20');
    expect(checkCodes(await worksheet(2026))).toContain('info YEAR_OPEN');
    expect(codes((await preview('tax.it_provision', { year: 2026 })).issues)).toEqual(['YEAR_OPEN']);
    expect(codes((await preview('tax.it_settlement', { year: 2026 })).issues)).toEqual(['YEAR_OPEN']);

    // January: the pending 2307 comes in, so the year's CWT in hand is ₱7,000.00.
    await goTo('2027-01-15');
    expect((await accountant.post('/api/tax/2307s/received', { documentId: pending, lineNo: 0 })).statusCode).toBe(200);
    const w = await worksheet(2026);
    expect(figures(w)).toEqual([
      ['sales', '1,800,000.00'], ['cost_of_sales', '400,000.00'], ['gross_income', '1,400,000.00'], ['other_income', '5,000.00'],
      ['total_gross_income', '1,405,000.00'], ['deductions', '350,000.00'], ['taxable_income', '1,055,000.00'],
      ['regular_tax', '211,000.00'], ['mcit', '28,100.00'], ['tax_due', '211,000.00'],
      ['prior_excess', '0.00'], ['quarterly_payments', '156,000.00'], ['other_prepaid', '0.00'], ['cwt', '7,000.00'], ['payable', '48,000.00'],
    ]);
    expect(w).toMatchObject({ basis: 'regular', returnDue: '2027-04-15', deduction: { method: 'itemized', confirmed: false }, provision: null, settlement: null, dueCents: 0 });
    expect(checkCodes(w)).toEqual(['warning DEDUCTION_DEFAULT', 'info PENALTIES', 'info INTEREST', 'info NOT_PROVIDED']);
    const csv = (await accountant.get('/api/tax/1702rt?year=2026&format=csv')).body.replace(/^﻿/, '').split('\r\n');
    expect(csv.slice(0, 2)).toEqual(['"Item","Amount"', '"Sales, net of discounts and returns","1800000.00"']);
    expect(csv).toContain('"Tax payable with the 1702","48000.00"');
    expect(csv).toContain('"Provision: not recorded",""');

    // Settling before providing is refused; the provision must carry 31 December.
    expect(codes((await preview('tax.it_settlement', { year: 2026 })).issues)).toEqual(['NOT_PROVIDED']);
    expect(codes((await preview('tax.it_provision', { year: 2026 })).issues)).toEqual(['DATE']);
    const pre = await preview('tax.it_provision', { year: 2026 }, '2026-12-31');
    expect([codes(pre.issues), codes(pre.issues, 'warning')]).toEqual([[], ['DEDUCTION_DEFAULT']]);
    expect(pre.summary).toBe('This will provide ₱211,000.00 income tax for 2026 (taxable income ₱1,055,000.00, tax due ₱211,000.00 at the regular rate): Dr income tax – current, Cr income tax payable, dated 2026-12-31.');
    const prov = await provide(2026);
    expect(prov).toMatchObject({ number: 'ITP-000001', businessDate: '2026-12-31', totalCents: 21_100_000 });
    expect(journal(prov.id, 'original', true)).toEqual(['2320 Cr 211,000.00 2026-12-31', '8101 Dr 211,000.00 2026-12-31']);
    expect(codes((await preview('tax.it_provision', { year: 2026 }, '2026-12-31')).issues)).toEqual(['PROVIDED_ALREADY']);

    // Settlement: Dr 2320 163,000 / Cr 1411 156,000 / Cr 1410 7,000 (the customer); 48,000 stays on 2320.
    await goTo('2027-04-10');
    const spre = await preview('tax.it_settlement', { year: 2026 });
    expect([codes(spre.issues), codes(spre.issues, 'warning')]).toEqual([[], []]);
    expect(spre.summary).toBe('This will settle the income tax of 2026 (₱211,000.00) against ₱156,000.00 prepaid income tax (1411) and ₱7,000.00 CWT with the 2307s in hand (1410): ₱48,000.00 is left on income tax payable, to pay with the 1702.');
    const st = await settle(2026);
    expect(st).toMatchObject({ number: 'ITS-000001', totalCents: 16_300_000 });
    expect(journal(st.id)).toEqual(['1410 Cr 7,000.00', '1411 Cr 156,000.00', '2320 Dr 163,000.00']);
    expect(env.db.prepare(`SELECT party_id FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND a.code = '1410'`).pluck().get(st.id)).toBe(customer);
    const zeroOr = (code: string) => balances(env.db)[code] ?? 0; // balances() leaves out accounts at zero
    expect([zeroOr('1410'), zeroOr('1411'), zeroOr('2320'), zeroOr('8101')]).toEqual([0, 0, -4_800_000, 21_100_000]);
    expect((await accountant.get(`/api/docs/tax.it_settlement/${st.id}`)).json().doc).toMatchObject({ year: 2026, payableCents: 4_800_000, liabilityCents: 16_300_000, prepaidCents: 15_600_000, cwtCents: 700_000, roundingCents: 0, provision: { number: 'ITP-000001' } });
    // The registers do not list the settlement: 1410's register for 2026 still shows the 2307s.
    expect((await accountant.get('/api/tax/registers/withholding-received?from=2026-01-01&to=2027-12-31')).json().totals.cwtCents).toBe(700_000);
    // Once settled, the year's 1702Qs are paid with the 1702.
    expect(codes((await preview('tax.bir_payment', { form: '1702Q', period: '2026-Q3', cashPlaceId: BDO, amountCents: 100, reference: 'eFPS 0002' })).issues)).toEqual(['SETTLED']);

    // The 1702: what the settlement left, paid from the bank (Dr 2320); more is refused.
    expect((await accountant.get('/api/tax/payments/due')).json()).toEqual([{ form: '1702', period: '2026', payableCents: 4_800_000 }]);
    expect(codes((await preview('tax.bir_payment', { form: '1702', period: '2026', cashPlaceId: BDO, amountCents: 4_800_100, reference: 'eFPS 0003' })).issues)).toEqual(['OVER']);
    const annual = await pay({ form: '1702', period: '2026', amountCents: 4_800_000, reference: 'eFPS 0003' });
    expect(journal(annual.id)).toEqual(['1111 Cr 48,000.00', '2320 Dr 48,000.00']);
    expect(zeroOr('2320')).toBe(0);
    expect(await worksheet(2026)).toMatchObject({ provision: { number: 'ITP-000001' }, settlement: { number: 'ITS-000001' }, dueCents: 4_800_000, paidCents: 4_800_000, leftCents: 0 });
    noBrokenInvariants();

    // Cancels in order: the provision waits for the settlement, the settlement for the 1702 payment.
    expect((await cancel('tax.it_provision', prov.id)).json().message).toBe(`Cancel these first: ${st.number}.`);
    expect((await cancel('tax.it_settlement', st.id)).json().message).toBe(`Cancel these first: ${annual.number}.`);
    expect((await cancel('tax.bir_payment', annual.id)).statusCode).toBe(200);
    await goTo('2027-05-03');
    expect((await cancel('tax.it_settlement', st.id)).statusCode).toBe(200);
    expect(journal(st.id, 'reversal', true)).toEqual(['1410 Dr 7,000.00 2027-04-10', '1411 Dr 156,000.00 2027-04-10', '2320 Cr 163,000.00 2027-04-10']);
    expect((await cancel('tax.it_provision', prov.id)).statusCode).toBe(200);
    expect(journal(prov.id, 'reversal', true)).toEqual(['2320 Dr 211,000.00 2026-12-31', '8101 Cr 211,000.00 2026-12-31']);
    expect([zeroOr('1410'), zeroOr('1411'), zeroOr('2320'), zeroOr('8101')]).toEqual([700_000, 15_600_000, 0, 0]);
    // Provided and settled again, as before.
    await provide(2026);
    expect(journal((await settle(2026)).id)).toEqual(['1410 Cr 7,000.00', '1411 Cr 156,000.00', '2320 Dr 163,000.00']);
    expect(q1.number).toBe('BIRP-000001');
    noBrokenInvariants();
  });

  it('MCIT is the higher and the credits overpay it: the overpayment is carried over into 2027', async () => {
    await settings({ regularRateBp: 2500, mcitRateBp: 200, operationsBeganYear: 2015 }, '2026-01-05');
    await goTo('2026-02-10');
    await sale(200_000_000);
    await expense('5101', 150_000_000);
    await expense('6110', 48_000_000);
    await goTo('2026-04-20');
    await pay({ form: '1702Q', period: '2026-Q1', amountCents: 1_000_000 });
    await collectWithCwt('0201', 150_000_000, 1_500_040, 'received'); // ₱15,000.40 withheld

    await goTo('2027-01-20');
    const w = await worksheet(2026);
    expect(figures(w).slice(4)).toEqual([
      ['total_gross_income', '500,000.00'], ['deductions', '480,000.00'], ['taxable_income', '20,000.00'],
      ['regular_tax', '5,000.00'], ['mcit', '10,000.00'], ['tax_due', '10,000.00'],
      ['prior_excess', '0.00'], ['quarterly_payments', '10,000.00'], ['other_prepaid', '0.00'], ['cwt', '15,000.00'], ['payable', '-15,000.00'],
    ]);
    expect(w.basis).toBe('mcit');
    expect(w.lines.at(-1)!.label).toBe('Overpayment, carried over to next year');
    expect(checkCodes(w)).toContain('info OVERPAID');
    await provide(2026);
    // Dr 2320 10,000 / Dr 1411 15,000 carried over / Dr 8101 0.40 rounding / Cr 1411 10,000 / Cr 1410 15,000.40.
    const st = await settle(2026);
    expect(codes(st.warnings, 'warning')).toEqual(['CARRIED_OVER']);
    expect(journal(st.id)).toEqual(['1410 Cr 15,000.40', '1411 Dr 15,000.00', '1411 Cr 10,000.00', '2320 Dr 10,000.00', '8101 Dr 0.40']);
    const zeroOr = (code: string) => balances(env.db)[code] ?? 0;
    expect([zeroOr('1410'), zeroOr('1411'), zeroOr('2320'), zeroOr('8101')]).toEqual([0, 1_500_000, 0, 1_000_040]);
    expect(codes((await preview('tax.bir_payment', { form: '1702', period: '2026', cashPlaceId: BDO, amountCents: 100, reference: 'eFPS 9' })).issues)).toEqual(['NOTHING_DUE']);

    // 2027: the 1702Q and the 1702-RT take last year's excess off.
    await goTo('2027-02-10');
    await sale(10_000_000);
    await goTo('2027-04-15');
    const q = (await accountant.get('/api/tax/1702q?year=2027&quarter=1')).json() as Worksheet;
    expect(figures(q).slice(-5)).toEqual([['tax_due', '25,000.00'], ['prior_payments', '0.00'], ['prior_prepaid', '15,000.00'], ['cwt', '0.00'], ['payable', '10,000.00']]);
    expect(figures(await worksheet(2027)).find(([k]) => k === 'prior_excess')).toEqual(['prior_excess', '15,000.00']);
    // 2026 cannot be cancelled once 2027 took its carry-over in a settlement; nor settled after a later year.
    await goTo('2028-01-10');
    await provide(2027);
    const st27 = await settle(2027);
    expect(journal(st27.id)).toEqual(['1411 Cr 15,000.00', '2320 Dr 15,000.00']);
    expect(zeroOr('1411')).toBe(0);
    expect((await cancel('tax.it_settlement', st.id)).json().message).toBe(`Cancel these first: ${st27.number}.`);
    noBrokenInvariants();
  });

  it('the 40% optional standard deduction, picked for the year as a dated setting', async () => {
    await goTo('2026-03-10');
    await sale(100_000_000);
    await expense('5101', 20_000_000);
    await expense('6110', 70_000_000);
    await goTo('2027-01-20');
    const before = await worksheet(2026);
    expect(before).toMatchObject({ deduction: { method: 'itemized', confirmed: false } });
    expect(checkCodes(before)).toEqual(['warning SETTINGS_DEFAULT', 'warning MCIT_UNKNOWN', 'warning DEDUCTION_DEFAULT', 'info NOT_PROVIDED']);
    expect(figures(before).slice(5, 8)).toEqual([['deductions', '700,000.00'], ['taxable_income', '100,000.00'], ['regular_tax', '20,000.00']]);

    const body = { year: 2026, method: 'osd', effectiveFrom: '2027-01-20', reason: 'The accountant elects OSD for 2026' };
    expect((await accountant.post('/api/tax/income-tax-deductions', body)).json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await stepUp(accountant);
    expect((await accountant.post('/api/tax/income-tax-deductions', { ...body, effectiveFrom: '2027-01-19' })).json()).toMatchObject({ code: 'SETTING_BACKDATED' });
    expect((await accountant.post('/api/tax/income-tax-deductions', body)).json()).toMatchObject({ year: 2026, method: 'osd', confirmed: true });
    expect((await accountant.post('/api/tax/income-tax-deductions', body)).json()).toMatchObject({ code: 'NO_CHANGE' });
    expect((await accountant.get('/api/tax/income-tax-deductions?year=2026')).json()).toMatchObject({ current: { method: 'osd' }, versions: [{ effectiveFrom: '2027-01-20' }] });

    const w = await worksheet(2026);
    expect(figures(w).slice(4, 8)).toEqual([['total_gross_income', '800,000.00'], ['deductions', '320,000.00'], ['taxable_income', '480,000.00'], ['regular_tax', '96,000.00']]);
    expect(w.lines[5]!.label).toBe('Less: optional standard deduction (40% of total gross income)');
    expect(checkCodes(w)).toContain('info OSD');
    expect(checkCodes(w)).not.toContain('warning DEDUCTION_DEFAULT');
    const prov = await provide(2026);
    expect(prov.totalCents).toBe(9_600_000);
    expect((await accountant.get(`/api/docs/tax.it_provision/${prov.id}`)).json().doc).toMatchObject({ deductionMethod: 'osd', taxableIncomeCents: 48_000_000, taxDueCents: 9_600_000 });
    noBrokenInvariants();
  });

  it('403 for a role without the permission', async () => {
    await goTo('2027-01-10');
    expect((await encoder.get('/api/tax/1702rt?year=2026')).statusCode).toBe(403);
    expect((await encoder.get('/api/tax/1604e?year=2026')).statusCode).toBe(403);
    expect((await owner.get('/api/tax/1702rt?year=2026')).statusCode).toBe(200);
    // Only the accountant provides and settles; the owner sees them.
    expect((await owner.post('/api/docs/tax.it_provision/preview', { input: { year: 2026 } })).statusCode).toBe(403);
    expect((await owner.post('/api/docs/tax.it_settlement/preview', { input: { year: 2026 } })).statusCode).toBe(403);
    expect((await encoder.post('/api/docs/tax.it_provision/post', { input: { year: 2026 }, expectedTotalCents: 0 }, idem())).statusCode).toBe(403);
    expect((await owner.get('/api/docs/tax.it_provision')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/tax.it_settlement')).statusCode).toBe(403);
    expect((await encoder.post('/api/tax/income-tax-deductions', { year: 2026, method: 'osd', effectiveFrom: '2027-01-10', reason: 'Encoder tries to change it' })).statusCode).toBe(403);
  });
});
