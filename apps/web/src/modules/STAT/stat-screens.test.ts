/** The statutory screens' rules (remittance input, the check's words), the menu, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee, addPay } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { createApi, newIdempotencyKey as key, type SchemeCheck } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { checkWords, remittanceInput } from './stat.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('statutory screen rules', () => {
  it('remittance input: each missing part named; a complete form becomes the input; a blank penalty is none', () => {
    expect(remittanceInput({ scheme: '', month: '2026-9', cashPlaceId: '', amount: '0', penalty: 'two fifty', reference: ' x ', note: '' }).errors).toEqual([
      'Pick what is being paid.', 'Pick the month paid for.', 'Pick where the money came from.', 'Type the amount paid, like 7,560.00',
      'Type the penalty like 250.00, or leave it blank.', 'Type the PRN, payment reference or receipt number.',
    ]);
    expect(remittanceInput({ scheme: 'SSS', month: '2026-09', cashPlaceId: '7', amount: '7,560.00', penalty: ' ', reference: ' PRN 0926-0001 ', note: ' Paid at BDO ' })).toEqual({
      input: { scheme: 'SSS', month: '2026-09', cashPlaceId: 7, amountCents: 756_000, reference: 'PRN 0926-0001', note: 'Paid at BDO' },
      errors: [],
    });
    expect(remittanceInput({ scheme: 'SSS', month: '2026-09', cashPlaceId: '7', amount: '7,560.00', penalty: '250.00', reference: 'PRN 0926-0001', note: '' }).input).toEqual({
      scheme: 'SSS', month: '2026-09', cashPlaceId: 7, amountCents: 756_000, penaltyCents: 25_000, reference: 'PRN 0926-0001',
    });
  });

  it('the check in words', () => {
    const c = (recordedCents: number, remittedCents: number) => ({ recordedCents, remittedCents, balanceCents: recordedCents - remittedCents }) as SchemeCheck;
    expect([c(0, 0), c(756_000, 756_000), c(756_000, 0), c(379_000, 756_000)].map((x) => checkWords(x))).toEqual([
      { text: 'Nothing recorded', tone: 'info' }, { text: 'Remitted in full', tone: 'success' }, { text: '₱7,560.00 to remit', tone: 'info' },
      { text: 'Remitted ₱3,770.00 more than the payrolls show', tone: 'warning' },
    ]);
  });

  it('the menu shows Government remittances to those with stat.view, next to the Remittances list', () => {
    const types = [{ key: 'stat.remittance', module: 'STAT', title: 'Remittance' }] as never[];
    expect(buildMenu(types, new Set(['stat.view'])).at(-1)).toEqual({
      group: 'People & Payroll', items: ['Government remittances', 'Remittances'].map((label) => expect.objectContaining({ label })),
    });
    expect(buildMenu(types, new Set()).at(-1)!.items.map((i) => i.label)).toEqual(['Remittances']);
  });
});

describe('web client for statutory', () => {
  it('the month’s lists and check, a remittance recorded against it, and the D6 warning for a run of a remitted month', async () => {
    const env = await createTestEnv('2026-09-15T02:00:00Z');
    const acct = createUser(env.db, 'acct1', ['accountant']);
    const carla = addEmployee(env.db, 'Carla Opisina', { costCentre: 'office' });
    addPay(env.db, carla, acct, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const run = async (periodStart: string) => {
      const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart };
      return api.post('pay.run', input, (await api.preview('pay.run', input)).totalCents, key());
    };
    await run('2026-09-01');
    const later = async (at: string) => (env.clock.set(at), await api.login('acct1', PASSWORD)); // sessions time out over the days skipped
    await later('2026-09-30T02:00:00Z');
    const c2 = await run('2026-09-16');
    await later('2026-10-05T02:00:00Z');

    // Example C: September SSS 2,280.00 (EE 750, ER 1,500, EC 30), PhilHealth 750.00, Pag-IBIG 400.00, no tax.
    expect((await api.statMonths()).map((m) => [m.month, m.check.map((c) => c.balanceCents)])).toEqual([['2026-09', [228_000, 75_000, 40_000, 0]]]);
    const sep = await api.statMonth('2026-09');
    expect(sep.sss.rows.map((r) => [r.name, r.mscCents, r.totalCents])).toEqual([['Carla Opisina', 1_500_000, 228_000]]);
    expect([sep.tax.totalCompensationCents, sep.tax.eeSharesCents, sep.tax.taxableCents]).toEqual([1_500_000, 132_500, 1_367_500]);

    // Paid late, with a ₱250.00 penalty on top: the total covers both, the check counts only the SSS part.
    const input = remittanceInput({ scheme: 'SSS', month: '2026-09', cashPlaceId: String(cashPlaceId(env.db, '1111')), amount: '2,280.00', penalty: '250.00', reference: 'PRN 0926-0001', note: '' }).input;
    const pre = await api.preview('stat.remittance', input);
    expect([pre.totalCents, pre.issues]).toEqual([253_000, []]);
    expect((await api.post('stat.remittance', input, pre.totalCents, key())).number).toBe('REM-000001');
    expect((await api.statMonth('2026-09')).check[0]).toMatchObject({ remittedCents: 228_000, balanceCents: 0 });
    expect(await api.runRemitted(c2.id)).toEqual({ month: '2026-09', remitted: [{ scheme: 'SSS', label: 'SSS', numbers: ['REM-000001'] }] });
  });
});
