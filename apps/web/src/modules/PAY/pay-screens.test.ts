/** The payroll screens' rules (run input, payslip rows), the menu, and the web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee, addPay } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { createApi, newIdempotencyKey as key, type PayEmployee, type PayRunDoc, type PayThirteenthDoc, type Payslips } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { deductionsOf, emptyManual, finalPayText, qtyText, runInput, thirteenthInput, thirteenthText } from './run.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('payroll screen rules', () => {
  it('final pay and unused leave: the tick goes into the input; the badge text; days of unused leave; one separated employee’s 13th month', () => {
    expect(runInput('SEMI_DAILY', '2026-12-16', [], {}, {}, {}, false, true).input).toEqual({ payGroup: 'SEMI_DAILY', periodStart: '2026-12-16', unusedLeave: true });
    expect(finalPayText({})).toBe('');
    expect(finalPayText({ final: { separatedOn: '2026-09-10', caLeftCents: 317_452, loansLeftCents: 1_650_000 } })).toBe(
      'Final pay: left on 2026-09-10; ₱3,174.52 of cash advances still owed; ₱16,500.00 of government loans left (not deducted)',
    );
    expect(finalPayText({ final: { separatedOn: '2026-09-10', caLeftCents: 0, loansLeftCents: 0 } })).toBe('Final pay: left on 2026-09-10');
    expect(qtyText('unused_leave', 3000)).toBe('3 days');
    expect(qtyText('night', 150)).toBe('2:30 h'); // night differential, in minutes like overtime
    expect(thirteenthInput('SEMI_MONTHLY', 2026, {}, {}, 'e1').input).toEqual({ payGroup: 'SEMI_MONTHLY', year: 2026, employeeId: 'e1' });
  });

  it('run input: blank rows left out, allowances above zero, adjustments either way, reasons; deductions and people left out', () => {
    const rows = [emptyManual(), { employeeId: 'e1', kind: 'allowance' as const, amount: '250', reason: ' Rice allowance ' }, { employeeId: 'e2', kind: 'adjustment' as const, amount: '-100.50', reason: 'Short last week' }];
    expect(runInput('SEMI_DAILY', '2026-09-16', rows, { e1: '', e2: '0' }, {})).toEqual({
      input: {
        payGroup: 'SEMI_DAILY', periodStart: '2026-09-16',
        lines: [{ employeeId: 'e1', kind: 'allowance', amountCents: 25_000, reason: 'Rice allowance' }, { employeeId: 'e2', kind: 'adjustment', amountCents: -10_050, reason: 'Short last week' }],
        advances: [{ employeeId: 'e2', amountCents: 0 }],
      },
      errors: [],
    });
    expect(runInput('WEEKLY_PIECE', '', [{ employeeId: '', kind: 'allowance', amount: '-5', reason: 'x' }], { e1: 'abc' }, { e3: ' no ' }).errors).toEqual([
      'Line 1: pick the employee.', 'Line 1: an allowance is more than zero; use an adjustment to take pay away.', 'Line 1: say what it is for (5 characters or more).',
      'Type the cash-advance deduction like 500.00, or leave it blank for the plan.', 'Say why each person is left out (5 characters or more).', 'Pick the period.',
    ]);
    expect(runInput('WEEKLY_PIECE', '2026-09-21', [], {}, { e3: 'On leave all week' }).input.skip).toEqual([{ employeeId: 'e3', reason: 'On leave all week' }]);
  });

  it('payslip rows and quantities', () => {
    const e = { sssEeCents: 25_000, phicEeCents: 0, hdmfEeCents: 1_200, wtaxCents: 0, caCents: 50_000 } as PayEmployee;
    expect(deductionsOf(e)).toEqual([['SSS employee share', 25_000], ['Pag-IBIG employee share', 1_200], ['Cash advance', 50_000]]);
    expect([qtyText('basic', 9_500), qtyText('leave', 1_000), qtyText('ot', 90), qtyText('piece', -2), qtyText('salary', 1)]).toEqual(['9.5 days', '1 day', '1:30 h', '-2 pcs', '']);
  });

  it('13th-month input: blank amounts are one twelfth, a changed amount needs a reason, people left out need one; the payslip line', () => {
    expect(thirteenthInput('SEMI_MONTHLY', 2026, { e1: { amount: '', reason: '' }, e2: { amount: '12,000.50', reason: ' Rounded up (made up) ' } }, {})).toEqual({
      input: { payGroup: 'SEMI_MONTHLY', year: 2026, amounts: [{ employeeId: 'e2', amountCents: 1_200_050, reason: 'Rounded up (made up)' }] }, errors: [],
    });
    expect(thirteenthInput('WEEKLY_PIECE', null, { e1: { amount: 'abc', reason: '' }, e2: { amount: '100', reason: 'no' }, e3: { amount: '5', reason: '' } }, { e3: ' x ' }).errors).toEqual([
      'Type a changed 13th-month amount like 12,500.00, or leave it blank for one twelfth of the basic pay.', 'Say why each 13th-month amount is changed (5 characters or more).',
      'Say why each person is left out (5 characters or more).', 'Pick the year.',
    ]);
    const e = { thirteenthCents: 62_500, ytd: { thirteenthCents: 1_437_500 }, thirteenthPaid: [{ number: 'TH13-000001', amountCents: 1_437_500 }] } as Payslips['employees'][number];
    expect(thirteenthText(e)).toBe('13th month: ₱625.00 this payroll, ₱14,375.00 so far this year; paid ₱14,375.00 by TH13-000001');
  });

  it('the menu shows payroll runs, releases and cash advances under People & Payroll', () => {
    const types = [{ key: 'pay.run', module: 'PAY', title: 'Payroll Run' }, { key: 'pay.release', module: 'PAY', title: 'Payroll Release' }, { key: 'pay.thirteenth', module: 'PAY', title: '13th-Month Pay' }, { key: 'ca.advance', module: 'CA', title: 'Cash Advance' }] as never[];
    expect(buildMenu(types, new Set(['emp.view'])).find((g) => g.group === 'People & Payroll')).toEqual({
      group: 'People & Payroll',
      items: ['Employees', 'Leave balances', 'Attendance', 'Holidays', 'Payroll Runs', 'Payroll Releases', '13th-Month Pay', 'Cash Advances'].map((label) => expect.objectContaining({ label })),
    });
  });
});

describe('web client for payroll', () => {
  it('cash advance, the run worked out and recorded, payslips, and the release', async () => {
    const env = await createTestEnv('2026-09-30T02:00:00Z');
    const owner = createUser(env.db, 'acct1', ['accountant']);
    const ana = addEmployee(env.db, 'Ana Tahi');
    addPay(env.db, ana, owner, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const cash = cashPlaceId(env.db, '1101');

    const caInput = { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 };
    const ca = await api.post('ca.advance', caInput, (await api.preview('ca.advance', caInput)).totalCents, key());
    expect(ca.number).toBe('CA-000001');
    expect(await api.caStatus(ana)).toMatchObject({ outstandingCents: 200_000, installmentCents: 100_000 });
    expect((await api.activeEmployees()).map((e) => e.name)).toEqual(['Ana Tahi']);
    await api.saveAttendance(['16', '17', '18', '19', '21', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' as const })));

    const periods = await api.payPeriods('SEMI_DAILY');
    expect(periods[0]).toMatchObject({ periodStart: '2026-09-16', periodEnd: '2026-09-30', employees: 1, recorded: null });
    const input = runInput('SEMI_DAILY', periods[0]!.periodStart, [], {}, {}).input;
    const pre = await api.preview('pay.run', input);
    const doc = pre.doc as PayRunDoc;
    // 10 days × ₱550; less SSS 275, PhilHealth 358.65, Pag-IBIG 110 and the ₱1,000 CA instalment.
    expect([pre.totalCents, doc.employees[0]!.caCents, doc.employees[0]!.netCents]).toEqual([550_000, 100_000, 375_635]);
    const run = await api.post('pay.run', input, pre.totalCents, key());
    expect(run.number).toBe('PAY-000001');

    const slips = await api.payslips(run.id);
    expect(slips.employees[0]).toMatchObject({ name: 'Ana Tahi', caBalanceAfterCents: 100_000, grossCents: 550_000 });
    const toRelease = await api.runsToRelease();
    expect(toRelease.map((r) => [r.number, r.dueCents])).toEqual([['PAY-000001', slips.employees[0]!.netCents]]);
    const status = await api.releaseStatus(run.id);
    expect(status).toEqual([{ employeeId: ana, name: 'Ana Tahi', netCents: slips.employees[0]!.netCents, releasedBy: null }]);
    const relInput = { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: status[0]!.netCents }] };
    const rel = await api.post('pay.release', relInput, (await api.preview('pay.release', relInput)).totalCents, key());
    expect(rel.number).toBe('POUT-000001');
    expect(await api.runsToRelease()).toEqual([]);
  });

  it('PAY-1: a period that has ended is dated its last day, and the run is booked in that month', async () => {
    const env = await createTestEnv('2026-10-01T02:00:00Z');
    const acct = createUser(env.db, 'acct2', ['accountant']);
    const carla = addEmployee(env.db, 'Carla Opisina', { costCentre: 'office' });
    addPay(env.db, carla, acct, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const api = createApi(injectFetch(env.app));
    await api.login('acct2', PASSWORD);
    const [period] = await api.payPeriods('SEMI_MONTHLY');
    expect(period).toMatchObject({ periodStart: '2026-09-16', periodEnd: '2026-09-30', bookOn: '2026-09-30' });
    const input = runInput('SEMI_MONTHLY', period!.periodStart, [], {}, {}).input;
    expect((await api.preview('pay.run', input)).issues.map((i) => i.code)).toEqual(['BOOKED_LATER']); // undated: today, October
    const pre = await api.preview('pay.run', input, period!.bookOn!);
    expect(pre.issues).toEqual([]);
    const run = await api.post('pay.run', input, pre.totalCents, key(), period!.bookOn!);
    expect((await api.get('pay.run', run.id)).header.businessDate).toBe('2026-09-30');
  });

  it('13th-month pay: the years, worked out and recorded, then released like a payroll; the payslip shows it', async () => {
    const env = await createTestEnv('2026-11-30T02:00:00Z');
    const acct = createUser(env.db, 'acct3', ['accountant']);
    const carla = addEmployee(env.db, 'Carla Opisina', { costCentre: 'office' });
    addPay(env.db, carla, acct, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const api = createApi(injectFetch(env.app));
    await api.login('acct3', PASSWORD);
    const runInput1 = runInput('SEMI_MONTHLY', '2026-11-11', [], {}, {}).input;
    const run = await api.post('pay.run', runInput1, (await api.preview('pay.run', runInput1)).totalCents, key());
    env.clock.set('2026-12-15T02:00:00Z');
    await api.login('acct3', PASSWORD); // the session ended while the clock moved on

    expect(await api.thirteenthYears()).toEqual({ years: [2026, 2025], recorded: [] });
    const { input } = thirteenthInput('SEMI_MONTHLY', 2026, {}, {});
    const pre = await api.preview('pay.thirteenth', input);
    // One half-month of ₱7,500 → 625.00, as accrued by the run.
    expect((pre.doc as PayThirteenthDoc).employees).toMatchObject([{ name: 'Carla Opisina', basicCents: 750_000, dueCents: 62_500, accruedCents: 62_500, netCents: 62_500 }]);
    const th = await api.post('pay.thirteenth', input, pre.totalCents, key());
    expect(th.number).toBe('TH13-000001');
    expect((await api.thirteenthYears()).recorded).toEqual([{ payGroup: 'SEMI_MONTHLY', year: 2026, id: th.id, number: 'TH13-000001' }]);
    expect((await api.runsToRelease()).map((r) => [r.number, r.kind, r.dueCents])).toEqual([['TH13-000001', 'thirteenth', 62_500], ['PAY-000001', 'run', expect.any(Number)]]);
    const relInput = { runId: th.id, employeeIds: [carla], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 62_500 }] };
    const rel = await api.post('pay.release', relInput, (await api.preview('pay.release', relInput)).totalCents, key());
    expect(rel.number).toBe('POUT-000001');
    expect(thirteenthText((await api.payslips(run.id)).employees[0]!)).toBe('13th month: ₱625.00 this payroll, ₱625.00 so far this year; paid ₱625.00 by TH13-000001');
  });
});
