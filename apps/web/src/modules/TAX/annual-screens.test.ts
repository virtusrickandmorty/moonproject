/** The 1702-RT and 1604-E screens' rules, the BIR payment form's 1702, the calendar links, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key, taxYearPath, type AnnualIncomeTaxWorksheet } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { FORMS, PAGES } from '../screens.ts';
import { AnnualIncomeTaxReturn, YearEndTaxForm } from './AnnualIncomeTax.tsx';
import { EwtAnnualReturnPage } from './EwtAnnual.tsx';
import { annualReckoning, deductionInput, deductionWords, isAnnualTotal, provisionPath, settlementPath, yearEndDate, yearFromQuery } from './annual.ts';
import { birPaymentInput, defaultPeriod, leftToPay, periodOf, periodParts, quartersOf, worksheetPath, type BirValues } from './bir.ts';
import { excelUrl, worksheetOfDeadline } from './reports.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const values = (patch: Partial<BirValues> = {}): BirValues => ({ form: '1702', year: '2026', part: '', cashPlaceId: '3', amount: '48,000.00', penalty: '', reference: 'eFPS 123456', note: '', ...patch });

describe('1702-RT and 1604-E screen rules', () => {
  it('open on last year or the year in the link; the menu, routes and forms; the calendar links', () => {
    expect([yearFromQuery('', '2027-02-10'), yearFromQuery('?year=2025', '2027-02-10'), yearFromQuery('?year=20x5', '2027-02-10')]).toEqual([2026, 2025, 2026]);
    const tax = buildMenu([], new Set(['tax.registers.view'])).find((g) => g.group === 'Accounting & Tax')?.items.map((i) => `${i.label} ${i.path}`);
    expect(tax).toEqual(expect.arrayContaining(['1702-RT worksheet (annual) /tax/1702rt', '1604-E (annual EWT) /tax/1604e']));
    expect([PAGES['/tax/1702rt'], PAGES['/tax/1604e'], FORMS['tax.it_provision'], FORMS['tax.it_settlement']]).toEqual([AnnualIncomeTaxReturn, EwtAnnualReturnPage, YearEndTaxForm, YearEndTaxForm]);
    expect([worksheetOfDeadline({ form: '1702-RT', period: '2026' }), worksheetOfDeadline({ form: '1604-E', period: '2026' }), worksheetOfDeadline({ form: '1604-C', period: '2026' })])
      .toEqual(['/tax/1702rt?year=2026', '/tax/1604e?year=2026', null]);
    expect(excelUrl(taxYearPath('1604e', 2026))).toBe('/api/tax/1604e?year=2026&format=csv');
    expect([provisionPath(2026), settlementPath(2026)]).toEqual(['/docs/tax.it_provision/new?year=2026', '/docs/tax.it_settlement/new?year=2026']);
  });

  it('the BIR payment form pays a 1702 for a year, with no quarter', () => {
    expect(quartersOf('1702')).toEqual([]);
    expect([periodOf('1702', '2026', ''), periodOf('1702', '26', '')]).toEqual(['2026', null]);
    expect(periodParts('2026')).toEqual({ year: '2026', part: '' });
    expect(defaultPeriod('1702', '2027-04-02')).toBe('2026');
    expect(worksheetPath('1702', '2026')).toBe('/tax/1702rt?year=2026');
    expect(leftToPay('1702', { leftCents: 4_800_000 } as AnnualIncomeTaxWorksheet)).toBe(4_800_000);
    expect(birPaymentInput(values()).input).toEqual({ form: '1702', period: '2026', cashPlaceId: 3, amountCents: 4_800_000, reference: 'eFPS 123456' });
    expect(birPaymentInput(values({ year: '' })).errors).toEqual(['Pick the year.']);
  });

  it('bolds the totals, words the deductions, dates the provision and settlement, and reckons what is left', () => {
    expect(['taxable_income', 'tax_due', 'payable', 'cwt', 'prior_excess'].map(isAnnualTotal)).toEqual([true, true, true, false, false]);
    expect(deductionWords({ method: 'itemized', confirmed: false, effectiveFrom: null })).toBe('Itemized (the default, not confirmed)');
    expect(deductionWords({ method: 'osd', confirmed: true, effectiveFrom: '2027-01-20' })).toBe('40% optional standard deduction, from 2027-01-20');
    // A provision always carries 31 December (recorded later by someone who may backdate); a settlement today unless picked.
    expect([yearEndDate('provision', 2026, '2027-01-20', true, false), yearEndDate('provision', 2026, '2026-12-31', true, false), yearEndDate('provision', 2026, '2027-01-20', false, false)])
      .toEqual(['2026-12-31', undefined, undefined]);
    expect([yearEndDate('settlement', 2026, '2027-04-10', true, false), yearEndDate('settlement', 2026, '2027-04-10', true, true)]).toEqual([undefined, '2026-12-31']);
    expect(annualReckoning({ provision: null, settlement: null, opening: null, provisionCents: 21_100_000, dueCents: 0, leftCents: 0, payableCents: 4_800_000 })).toEqual([
      { label: 'To provide on 31 December (not recorded yet)', cents: 21_100_000 }, { label: 'Not settled yet', cents: 0 }, { label: 'Due with the 1702', cents: 0, strong: true },
    ]);
    expect(annualReckoning({
      provision: { documentId: 'p', number: 'ITP-000001', date: '2026-12-31', amountCents: 1_000_000 },
      settlement: { documentId: 's', number: 'ITS-000001', date: '2027-01-20', payableCents: -1_500_000, carryOverCents: 1_500_000 }, opening: null,
      provisionCents: 1_000_000, dueCents: 0, leftCents: 0, payableCents: -1_500_000,
    }).map((r) => r.label)).toEqual(['Provided with ITP-000001 on 2026-12-31', 'Settled with ITS-000001: carried over to next year', 'Due with the 1702']);
    expect(deductionInput(2026, { method: 'osd', effectiveFrom: '2027-01-19', reason: 'short' }, '2027-01-20').errors).toEqual([
      'Pick the date it takes effect: today or later.', 'Say why, in 10 characters or more.',
    ]);
  });
});

describe('web client for the 1702-RT and 1604-E', () => {
  it('the worksheet, the provision and settlement from it, the 1702 payment, the deductions and the 1604-E, as the screens ask for them', async () => {
    const env = await createTestEnv('2026-04-15T02:00:00Z');
    const acctId = createUser(env.db, 'acct1', ['accountant']);
    const customer = seedCustomers(env.db, acctId).school;
    const web = createApi(injectFetch(env.app));
    await web.login('acct1', PASSWORD);
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    await web.post('acc.jv', { memo: 'April sales and rent', lines: [
      { accountId: account('1101'), debitCents: 50_000_000 }, { accountId: account('4101'), party: { type: 'customer' as const, id: customer }, creditCents: 50_000_000 },
      { accountId: account('6110'), debitCents: 30_000_000 }, { accountId: account('1101'), creditCents: 30_000_000 },
    ] }, 80_000_000, key());
    env.clock.set('2027-01-20T02:00:00Z');
    await web.login('acct1', PASSWORD);

    const w = await web.annualIncomeTaxWorksheet(2026);
    expect(w).toMatchObject({ year: 2026, taxDueCents: 4_000_000, payableCents: 4_000_000, provisionCents: 4_000_000, provision: null, settlement: null, returnDue: '2027-04-15', deduction: { method: 'itemized', confirmed: false } });
    // The provision, dated 31 December, then the settlement: no credits, so the whole ₱40,000.00 stays for the 1702.
    const p = await web.preview('tax.it_provision', { year: 2026 }, yearEndDate('provision', 2026, '2027-01-20', true, false));
    expect(p.journal?.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([['8101', 4_000_000, 0], ['2320', 0, 4_000_000]]);
    expect((await web.post('tax.it_provision', { year: 2026 }, p.totalCents, key(), '2026-12-31')).number).toBe('ITP-000001');
    const s = await web.preview('tax.it_settlement', { year: 2026 });
    expect([s.totalCents, s.journal ?? null]).toEqual([0, null]);
    expect((await web.post('tax.it_settlement', { year: 2026 }, 0, key())).number).toBe('ITS-000001');
    const after = await web.annualIncomeTaxWorksheet(2026);
    expect(after).toMatchObject({ provision: { number: 'ITP-000001' }, settlement: { number: 'ITS-000001', payableCents: 4_000_000 }, dueCents: 4_000_000, leftCents: 4_000_000 });
    const pay = { form: '1702' as const, period: '2026', cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: leftToPay('1702', after), reference: 'eFPS 0120-0001' };
    const pre = await web.preview('tax.bir_payment', pay);
    expect(pre.issues).toEqual([]);
    await web.post('tax.bir_payment', pay, pre.totalCents, key());
    expect(await web.annualIncomeTaxWorksheet(2026)).toMatchObject({ paidCents: 4_000_000, leftCents: 0, payments: [{ number: 'BIRP-000001', amountCents: 4_000_000 }] });

    const d = await web.incomeTaxDeductions(2027);
    expect(d).toMatchObject({ year: 2027, current: { method: 'itemized', confirmed: false }, versions: [] });
    const body = deductionInput(2027, { method: 'osd', effectiveFrom: '2027-01-20', reason: 'The accountant elects OSD for 2027' }, '2027-01-20').body;
    await expect(web.addIncomeTaxDeduction(body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await web.stepUp(PASSWORD);
    expect(await web.addIncomeTaxDeduction(body)).toMatchObject({ year: 2027, method: 'osd', confirmed: true });

    expect(await web.ewtAnnualReturn(2026)).toMatchObject({ year: 2026, returnDue: '2027-03-01', alphalist: [], tied: true, quarters: [{ quarter: 1 }, { quarter: 2 }, { quarter: 3 }, { quarter: 4 }] });
    await env.app.close();
  });
});
