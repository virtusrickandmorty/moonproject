/** The statutory screens' rules (remittance input, the check's words), the menu, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee, addPay } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { ApiError, createApi, newIdempotencyKey as key, type SchemeCheck } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { canDownloadUploads, checkWords, exposureMonths, paidOn, remittanceInput, UPLOAD_LIST } from './stat.ts';

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

  it('the date paid (STAT-1): empty is today (no date sent); a typed day is sent as it is; anything else is named', () => {
    expect(paidOn('')).toEqual({});
    expect(paidOn(' 2026-10-02 ')).toEqual({ businessDate: '2026-10-02' });
    expect(paidOn('2026-02-30').error).toBe('Type the date paid like 2026-10-02, or leave it empty for today.');
  });

  it('the check in words', () => {
    const c = (recordedCents: number, remittedCents: number) => ({ recordedCents, remittedCents, balanceCents: recordedCents - remittedCents }) as SchemeCheck;
    expect([c(0, 0), c(756_000, 756_000), c(756_000, 0), c(379_000, 756_000)].map((x) => checkWords(x))).toEqual([
      { text: 'Nothing recorded', tone: 'info' }, { text: 'Remitted in full', tone: 'success' }, { text: '₱7,560.00 to remit', tone: 'info' },
      { text: 'Remitted ₱3,770.00 more than the payrolls show', tone: 'warning' },
    ]);
  });

  it('the withholding-tax check words year-end tax refunds as refunds, never as a payroll cancelled after it was remitted (K23)', () => {
    const none = { dueCents: 0, refundCents: 0, refundOpenCents: 0, carriedInCents: 0, carriedFrom: [], carriedOutCents: 0 };
    const c = (x: Partial<SchemeCheck>) => ({ ...none, ...x }) as SchemeCheck;
    expect([
      // December: 7,090.00 owed, a 910.00 refund still to take off → 6,180.00 to remit.
      c({ recordedCents: 618_000, remittedCents: 0, balanceCents: 618_000, dueCents: 618_000, refundCents: 134_245, refundOpenCents: 91_000 }),
      // December: refunds 820.00 more than the tax → nothing to remit, carried to January.
      c({ recordedCents: -82_000, remittedCents: 0, balanceCents: -82_000, refundCents: 834_245, refundOpenCents: 791_000, carriedOutCents: 82_000 }),
      // January: 2,014.80 withheld less December's 820.00.
      c({ recordedCents: 201_480, remittedCents: 0, balanceCents: 201_480, dueCents: 119_480, carriedInCents: 82_000, carriedFrom: ['2026-12'] }),
      // December once January's remittance took its refunds off.
      c({ recordedCents: -82_000, remittedCents: -82_000, balanceCents: 0, refundCents: 834_245 }),
    ].map((x) => checkWords(x))).toEqual([
      { text: '₱6,180.00 to remit, after ₱910.00 of year-end tax refunds', tone: 'info' },
      { text: "Nothing to remit: ₱820.00 of year-end tax refunds above the month's tax come off the next month's remittance", tone: 'info' },
      { text: '₱1,194.80 to remit: ₱2,014.80 less ₱820.00 of year-end tax refunds carried from 2026-12', tone: 'info' },
      { text: 'Remitted in full', tone: 'success' },
    ]);
  });

  it('the menu shows Government remittances and Statutory exposure to those with stat.view, next to the Remittances list', () => {
    const types = [{ key: 'stat.remittance', module: 'STAT', title: 'Remittance' }] as never[];
    expect(buildMenu(types, new Set(['stat.view'])).find((g) => g.group === 'People & Payroll')).toEqual({
      group: 'People & Payroll', items: ['Government remittances', 'Statutory exposure', 'Remittances'].map((label) => expect.objectContaining({ label })),
    });
    expect(buildMenu(types, new Set()).find((g) => g.group === 'People & Payroll')!.items.map((i) => i.label)).toEqual(['Remittances']);
  });
});

describe('agency upload and exposure screen rules', () => {
  it('the files are offered for the three agencies, and downloaded only with stat.upload and emp.view_ids', () => {
    expect(UPLOAD_LIST.map((u) => u.scheme)).toEqual(['SSS', 'PHIC', 'HDMF']);
    expect(canDownloadUploads(['stat.view', 'stat.upload', 'emp.view_ids'])).toBe(true);
    expect(canDownloadUploads(['stat.view', 'stat.upload'])).toBe(false);
    expect(canDownloadUploads(['stat.view', 'emp.view_ids'])).toBe(false);
  });

  it('an exposure line names its months', () => {
    const m = (month: string) => ({ month, grossCents: 0, eeCents: 0, erCents: 0, ecCents: 0, totalCents: 0, monthsLate: 0, penaltyCents: 0 });
    expect(exposureMonths({ months: [m('2026-07')] })).toBe('1 month: 2026-07');
    expect(exposureMonths({ months: [m('2026-06'), m('2026-07')] })).toBe('2 months: 2026-06, 2026-07');
  });
});

describe('web client for the agency files and the exposure report', () => {
  it('a file is refused in plain words until the employer number and the ID are there, then downloads; the report needs the cut-over date', async () => {
    const env = await createTestEnv('2026-09-15T02:00:00Z');
    const acct = createUser(env.db, 'acct2', ['accountant']);
    const carla = addEmployee(env.db, 'Carla Opisina', { costCentre: 'office' });
    addPay(env.db, carla, acct, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const api = createApi(injectFetch(env.app));
    await api.login('acct2', PASSWORD);
    const run = async (periodStart: string) => {
      const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart };
      return api.post('pay.run', input, (await api.preview('pay.run', input)).totalCents, key());
    };
    await run('2026-09-01');
    env.clock.set('2026-09-30T02:00:00Z');
    await api.login('acct2', PASSWORD);
    await run('2026-09-16');
    env.clock.set('2026-10-05T02:00:00Z');
    await api.login('acct2', PASSWORD);

    const refusal = (p: Promise<unknown>) => p.then(() => null, (e: ApiError) => e);
    expect(await refusal(api.statUpload('2026-09', 'SSS'))).toMatchObject({ code: 'EMPLOYER_NUMBER_MISSING', status: 422 });
    expect(await refusal(api.setEmployerNumber('SSS', '03-9999999-9'))).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await api.stepUp(PASSWORD);
    expect(await api.setEmployerNumber('SSS', '03-9999999-9')).toMatchObject({ changed: true });
    expect((await api.statEmployerNumbers()).map((n) => [n.scheme, n.number])).toEqual([['SSS', '03-9999999-9'], ['PHIC', null], ['HDMF', null]]);
    const noId = await refusal(api.statUpload('2026-09', 'SSS'));
    expect(noId).toMatchObject({ code: 'ID_NUMBER_MISSING', status: 422 });
    expect(noId!.message).toContain('Carla Opisina');

    env.db.prepare(`UPDATE emp_employees SET sss_no = '34-0000001-1' WHERE id = ?`).run(carla);
    const file = await api.statUpload('2026-09', 'SSS');
    expect(file.filename).toBe('SSS-2026-09.csv');
    const text = await file.blob.text();
    expect(text).toContain('"03-9999999-9","092026","34-0000001-1","Carla Opisina","15000.00","0.00","750.00","1500.00","30.00","2280.00"');

    // No cut-over date yet: the report says so and lists nothing.
    const exposure = await api.statExposure();
    expect(exposure).toMatchObject({ cutoverDate: null, lines: [] });
    expect(exposure.notes[0]).toContain('cut-over date');
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

    // STAT-1: the accountant (acc.backdate) records PhilHealth three days after it was paid, dated the day paid.
    expect((await api.docTypes()).find((t) => t.key === 'stat.remittance')?.dating).toBe('accountant_may_backdate');
    const phic = { ...input, scheme: 'PHIC' as const, amountCents: 75_000, reference: 'PRN 0926-0002' };
    const paid = await api.post('stat.remittance', phic, (await api.preview('stat.remittance', phic, '2026-10-02')).totalCents, key(), '2026-10-02');
    expect((await api.get('stat.remittance', paid.id)).header.businessDate).toBe('2026-10-02');
  });
});
