/** The year-end screens' rules (the tick, refund and deficiency words, pay before Virtus amounts, the 2316 items), the menu, and the client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee, addPay } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { alphalistPath, createApi, newIdempotencyKey as key, type Figures2316, type PayEmployee, type PayRunDoc } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { deductionsOf, endsInDecember, priorAmounts, runInput, yearEndDetail, yearEndText, type PriorForm } from './run.ts';
import { ITEMS_2316, yearsToPick } from './year-end.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const blank: PriorForm = { gross: '', benefits: '', deMinimis: '', sss: '', phic: '', hdmf: '', otherNontax: '', taxable: '', wtax: '' };
const y = { year: 2026, taxableCents: 33_060_000, benefitsTaxableCents: 0, annualTaxCents: 1_209_000, withheldBeforeCents: 4_043_245, deficiencyCents: 0, withheldCents: 0, shortCents: 0, refundCents: 2_834_245 };

describe('year-end screen rules', () => {
  it('the tick only on a December period; run input carries it; refund and deficiency in words', () => {
    expect([endsInDecember('2026-12-31'), endsInDecember('2026-12-05'), endsInDecember('2026-11-30'), endsInDecember(undefined)]).toEqual([true, true, false, false]);
    expect(runInput('SEMI_MONTHLY', '2026-12-16', [], {}, {}, {}, true).input).toEqual({ payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true });
    expect(runInput('SEMI_MONTHLY', '2026-12-16', [], {}, {}).input).toEqual({ payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16' });
    expect(yearEndText({ yearEnd: y })).toBe('Refund ₱28,342.45');
    expect(yearEndText({ yearEnd: { ...y, refundCents: 0, deficiencyCents: 665_755, withheldCents: 665_755 } })).toBe('Deficiency ₱6,657.55 withheld');
    expect(yearEndText({ yearEnd: { ...y, refundCents: 0, deficiencyCents: 17_721_755, withheldCents: 1_425_000, shortCents: 16_296_755 } })).toBe('Deficiency ₱177,217.55: ₱14,250.00 withheld, ₱162,967.55 not covered by the pay');
    expect(yearEndText({ yearEnd: { ...y, refundCents: 0 } })).toBe('No adjustment');
    expect(yearEndText({})).toBe('');
    expect(yearEndDetail({ yearEnd: y })).toBe('Year-end tax 2026: taxable ₱330,600.00, tax due ₱12,090.00, withheld before ₱40,432.45. Refund ₱28,342.45.');
    const e = { sssEeCents: 75_000, phicEeCents: 0, hdmfEeCents: 0, wtaxCents: 100, caCents: 0, loans: [], yearEnd: y } as unknown as PayEmployee;
    expect(deductionsOf(e)).toEqual([['SSS', 75_000], ['Withholding tax (year-end adjustment)', 100]]);
  });

  it('pay before Virtus: blanks are ₱0, amounts typed plainly, the parts add up to the gross', () => {
    expect(priorAmounts({ ...blank, gross: '1,000.00', taxable: '900', sss: '100', wtax: '12.5' })).toEqual({
      amounts: { grossCents: 100_000, benefitsCents: 0, deMinimisCents: 0, sssCents: 10_000, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, taxableCents: 90_000, wtaxCents: 1_250 },
      errors: [],
    });
    expect(priorAmounts({ ...blank, gross: '1000', taxable: '900' }).errors).toEqual(['The parts add up to ₱900.00, not the gross ₱1,000.00.']);
    expect(priorAmounts({ ...blank, gross: 'abc' }).errors).toEqual(['Gross compensation: type an amount like 12,500.00.']);
  });

  it('the 2316 items and years; the menu item for the accountant only', () => {
    expect(yearsToPick('2027-01-05T09:00:00.000+08:00')).toEqual([2027, 2026, 2025]);
    const keys = ITEMS_2316.flatMap(([, items]) => items.map(([, , k]) => k));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('i26WithheldCents' satisfies keyof Figures2316);
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'People & Payroll')?.items.map((i) => i.label) ?? [];
    expect(labels(['pay.yearend.view'])).toContain('2316 and alphalist');
    expect(labels(['emp.view'])).not.toContain('2316 and alphalist');
    expect(alphalistPath(2026)).toBe('/api/pay/alphalist?year=2026');
  });
});

describe('year-end client calls against the server', () => {
  it('pay before Virtus, the tick on the December run, the refund on the payslip, and the 2316', async () => {
    const env = await createTestEnv('2026-12-31T02:00:00Z');
    createUser(env.db, 'ana.accountant', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('ana.accountant', PASSWORD);
    const olga = addEmployee(env.db, 'Olga Opisina', { costCentre: 'office' });
    addPay(env.db, olga, (await api.me()).userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 });
    const row = await api.addPriorPay({ employeeId: olga, year: 2026, source: 'before', grossCents: 33_000_000, benefitsCents: 0, deMinimisCents: 0, sssCents: 1_650_000, phicCents: 825_000, hdmfCents: 220_000, otherNontaxCents: 0, taxableCents: 30_305_000, wtaxCents: 4_043_245 });
    expect((await api.priorPay({ employeeId: olga })).map((p) => p.id)).toEqual([row.id]);
    expect((await api.updatePriorPay(row.id, row.version, { note: 'From the old payroll (made up)' })).version).toBe(2);
    // Only the 16–31 run is recorded: with ₱40,432.45 withheld before Virtus, the year-end adjustment refunds some of it.
    const input = runInput('SEMI_MONTHLY', '2026-12-16', [], {}, {}, {}, true).input;
    const preview = await api.preview('pay.run', input);
    const e = (preview.doc as PayRunDoc).employees[0]!;
    expect(e.yearEnd?.refundCents).toBeGreaterThan(0);
    expect(e.netCents).toBe(e.grossCents - e.sssEeCents - e.phicEeCents - e.hdmfEeCents + e.wtaxRefundCents!);
    const posted = await api.post('pay.run', input, preview.totalCents, key());
    const slips = await api.payslips(posted.id);
    expect(slips.employees[0]!.wtaxRefundCents).toBe(e.wtaxRefundCents);
    const d = await api.one2316(2026, olga);
    expect(d.figures.i24TaxDueCents).toBe(d.figures.i26WithheldCents);
    expect((await api.all2316(2026)).map((x) => x.name)).toEqual(['Olga Opisina']);
    await env.app.close();
  });
});
