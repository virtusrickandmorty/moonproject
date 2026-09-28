/** The 1702Q worksheet screen's rules, the BIR payment form's 1702Q, the calendar link, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key, taxQuarterPath, type IncomeTaxSettings, type IncomeTaxWorksheet } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { birPaymentInput, defaultPeriod, incomeTaxQuarter, leftToPay, periodOf, quartersOf, worksheetPath, type BirValues } from './bir.ts';
import { IncomeTaxReturn } from './IncomeTax.tsx';
import { incomeTaxReckoning, isIncomeTaxTotal, percentWords, settingsInput, settingsValues, settingsWords } from './income-tax.ts';
import { excelUrl, worksheetOfDeadline } from './reports.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const values = (patch: Partial<BirValues> = {}): BirValues => ({ form: '1702Q', year: '2026', part: '2', cashPlaceId: '3', amount: '75,000.00', penalty: '', reference: 'eFPS 123456', note: '', ...patch });
const setting = (patch: Partial<IncomeTaxSettings> = {}): IncomeTaxSettings => ({
  id: 1, effectiveFrom: '2000-01-01', regularRateBp: 2000, mcitRateBp: 200, operationsBeganYear: null, reason: 'Default', createdAt: '', createdBy: null, confirmed: false, ...patch,
});

describe('1702Q screen rules', () => {
  it('pays Q1 to Q3 only, opening on the quarter just ended (Q3 after Q4)', () => {
    expect(quartersOf('1702Q')).toEqual([1, 2, 3]);
    expect(quartersOf('2550Q')).toEqual([1, 2, 3, 4]);
    expect([periodOf('1702Q', '2026', '3'), periodOf('1702Q', '2026', '4'), periodOf('1601-EQ', '2026', '4')]).toEqual(['2026-Q3', null, '2026-Q4']);
    expect(incomeTaxQuarter('2026-09-28')).toEqual({ year: 2026, quarter: 2 });
    expect(incomeTaxQuarter('2026-11-20')).toEqual({ year: 2026, quarter: 3 });
    expect(incomeTaxQuarter('2027-02-01')).toEqual({ year: 2026, quarter: 3 }); // Q4 is the annual return's
    expect(defaultPeriod('1702Q', '2027-02-01')).toBe('2026-Q3');
    expect(birPaymentInput(values({ part: '4' })).errors).toEqual(['Pick the year and quarter.']);
    expect(birPaymentInput(values({ note: 'The return adds the old books' })).input).toEqual({
      form: '1702Q', period: '2026-Q2', cashPlaceId: 3, amountCents: 7_500_000, reference: 'eFPS 123456', note: 'The return adds the old books',
    });
  });

  it('links the worksheet, the form and the calendar; the menu lists the worksheet; the screen is routed', () => {
    expect(worksheetPath('1702Q', '2026-Q3')).toBe('/tax/1702q?year=2026&quarter=3');
    expect(worksheetOfDeadline({ form: '1702Q', period: '2026-Q3' })).toBe('/tax/1702q?year=2026&quarter=3');
    expect([worksheetOfDeadline({ form: '2550Q', period: '2026-Q3' }), worksheetOfDeadline({ form: '1702-RT', period: '2026' })]).toEqual([null, null]);
    expect(excelUrl(taxQuarterPath('1702q', 2026, 3))).toBe('/api/tax/1702q?year=2026&quarter=3&format=csv');
    expect(leftToPay('1702Q', { leftCents: 7_500_000 } as IncomeTaxWorksheet)).toBe(7_500_000);
    expect(leftToPay('1702Q', { leftCents: -150_000 } as IncomeTaxWorksheet)).toBe(0);
    const tax = buildMenu([], new Set(['tax.registers.view'])).find((g) => g.group === 'Accounting & Tax')?.items.map((i) => `${i.label} ${i.path}`);
    expect(tax).toContain('1702Q worksheet /tax/1702q');
    expect(PAGES['/tax/1702q']).toBe(IncomeTaxReturn);
  });

  it('bolds the totals, says what the old books left, and words the settings', () => {
    expect(['gross_income', 'taxable_income', 'tax_due', 'payable', 'sales', 'cwt'].map(isIncomeTaxTotal)).toEqual([true, true, true, true, false, false]);
    expect(incomeTaxReckoning({ opening: null, openingCents: 0, dueCents: 7_500_000, leftCents: 7_500_000 })).toEqual([{ label: 'Due with the 1702Q', cents: 7_500_000, strong: true }]);
    expect(incomeTaxReckoning({ opening: { documentId: 'x', number: 'OBTP-000001', date: '2026-09-27' }, openingCents: 1_500_000, dueCents: 1_500_000, leftCents: 0 })[0])
      .toEqual({ label: 'Left to pay by the old books (OBTP-000001, on 2320)', cents: 1_500_000 });
    expect([percentWords(2000), percentWords(250)]).toEqual(['20%', '2.5%']);
    expect(settingsWords(setting())).toBe('Regular rate 20%, MCIT 2%, year operations began not confirmed');
    expect(settingsWords(setting({ regularRateBp: 2500, operationsBeganYear: 2015 }))).toBe('Regular rate 25%, MCIT 2% from 2019 (operations began 2015)');
  });

  it('turns the settings form into the body the server takes, with plain errors', () => {
    const v = { ...settingsValues(setting({ operationsBeganYear: 2015 }), '2026-09-28'), reason: 'Confirmed with the accountant' };
    expect(v).toMatchObject({ effectiveFrom: '2026-09-28', regularRate: '20', mcitRate: '2', operationsBeganYear: '2015' });
    expect(settingsInput({ ...v, regularRate: '25', mcitRate: '1.5' }, '2026-09-28')).toEqual({
      body: { effectiveFrom: '2026-09-28', value: { regularRateBp: 2500, mcitRateBp: 150, operationsBeganYear: 2015 }, reason: 'Confirmed with the accountant' }, errors: [],
    });
    expect(settingsInput({ ...v, operationsBeganYear: '' }, '2026-09-28').body.value.operationsBeganYear).toBeNull();
    expect(settingsInput({ effectiveFrom: '2026-09-27', regularRate: 'x', mcitRate: '11', operationsBeganYear: '15', reason: 'short' }, '2026-09-28').errors).toEqual([
      'Pick the date it takes effect: today or later.', 'Type the regular rate in percent, like 20 or 25.', 'Type the MCIT rate in percent, like 2.',
      'Type the year operations began, like 2015, or leave it blank until it is confirmed.', 'Say why, in 10 characters or more.',
    ]);
  });
});

describe('web client for the 1702Q', () => {
  it('the worksheet, a payment from it, and the settings, as the screens ask for them', async () => {
    const env = await createTestEnv('2026-04-15T02:00:00Z');
    const acctId = createUser(env.db, 'acct1', ['accountant']);
    const customer = seedCustomers(env.db, acctId).school;
    const web = createApi(injectFetch(env.app));
    await web.login('acct1', PASSWORD);
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    // April: ₱500,000.00 sales, ₱300,000.00 rent (a JV of today).
    const jv = { memo: 'April sales and rent', lines: [
      { accountId: account('1101'), debitCents: 50_000_000 }, { accountId: account('4101'), party: { type: 'customer' as const, id: customer }, creditCents: 50_000_000 },
      { accountId: account('6110'), debitCents: 30_000_000 }, { accountId: account('1101'), creditCents: 30_000_000 },
    ] };
    await web.post('acc.jv', jv, 80_000_000, key());
    env.clock.set('2026-07-20T02:00:00Z');
    await web.login('acct1', PASSWORD);

    const w = await web.incomeTaxWorksheet(2026, 2);
    expect(w.lines.find((l) => l.key === 'taxable_income')?.cents).toBe(20_000_000);
    expect(w).toMatchObject({ period: '2026-Q2', taxDueCents: 4_000_000, dueCents: 4_000_000, leftCents: 4_000_000, returnDue: '2026-09-01' }); // 29 Aug is a Saturday, 31 Aug National Heroes Day
    expect(w.checks.map((c) => c.code)).toEqual(['SETTINGS_DEFAULT', 'MCIT_UNKNOWN']);
    await expect(web.incomeTaxWorksheet(2026, 4)).rejects.toMatchObject({ code: 'NO_Q4' });

    const input = { form: '1702Q' as const, period: '2026-Q2', cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: leftToPay('1702Q', w), reference: 'eFPS 0720-0001' };
    const pre = await web.preview('tax.bir_payment', input);
    expect(pre.issues).toEqual([]);
    const posted = await web.post('tax.bir_payment', input, pre.totalCents, key());
    expect(posted.number).toBe('BIRP-000001');
    expect(await web.incomeTaxWorksheet(2026, 2)).toMatchObject({ paidCents: 4_000_000, leftCents: 0, payments: [{ number: 'BIRP-000001', amountCents: 4_000_000 }] });

    const s = await web.incomeTaxSettings();
    expect(s.current).toMatchObject({ regularRateBp: 2000, confirmed: false });
    const body = settingsInput({ ...settingsValues(s.current, '2026-07-20'), operationsBeganYear: '2012', reason: 'Confirmed with the accountant' }, '2026-07-20').body;
    await expect(web.addIncomeTaxSettings(body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await web.stepUp(PASSWORD);
    expect(await web.addIncomeTaxSettings(body)).toMatchObject({ operationsBeganYear: 2012, confirmed: true });
    expect((await web.incomeTaxSettings()).versions.map((v) => v.effectiveFrom)).toEqual(['2026-07-20', '2000-01-01']);
    await env.app.close();
  });
});
