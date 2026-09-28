/** The government loan screens' rules (loan form, run input, payslip rows), the menu, and the web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee, addPay } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { ApiError, createApi, newIdempotencyKey as key, type PayEmployee, type PayRunDoc } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { deductionsOf, loanInput, loansLeft, runInput } from './run.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('government loan screen rules', () => {
  it('the loan form: plain errors, then the input', () => {
    const blank = { employeeId: '', kind: 'SSS_SALARY' as const, loanNo: 'x', amortization: '', firstMonth: '2026-10', lastMonth: '2026-09', note: '' };
    expect(loanInput(blank).errors).toEqual(['Pick the employee.', 'Type the loan number from the agency (letters, digits and dashes).', 'Type the monthly amortization, like 1500.00.', 'The last month cannot be before the first month.']);
    expect(loanInput({ ...blank, employeeId: 'e1', loanNo: ' 0301-555-01 ', amortization: '1,500', lastMonth: '2027-09', note: ' From the statement ' })).toEqual({
      input: { employeeId: 'e1', kind: 'SSS_SALARY', loanNo: '0301-555-01', amortizationCents: 150_000, firstMonth: '2026-10', lastMonth: '2027-09', note: 'From the statement' }, errors: [],
    });
  });

  it('run input: a loan deduction changed or skipped needs a note; blank keeps the plan', () => {
    expect(runInput('SEMI_MONTHLY', '2026-10-16', [], {}, {}, { l1: { amount: '0', reason: 'Skip October' }, l2: { amount: '', reason: '' } }).input.loans).toEqual([{ loanId: 'l1', amountCents: 0, reason: 'Skip October' }]);
    expect(runInput('SEMI_MONTHLY', '2026-10-16', [], {}, {}, { l1: { amount: '500', reason: '' } }).errors).toEqual(['Say why the loan deduction is changed (5 characters or more).']);
  });

  it('payslip rows: each loan between tax and the cash advance, and what is left of it', () => {
    const e = {
      sssEeCents: 25_000, phicEeCents: 0, hdmfEeCents: 1_200, wtaxCents: 0, caCents: 50_000,
      loans: [{ loanId: 'l1', agency: 'SSS', kind: 'SSS_SALARY', loanNo: '0301-555-01', dueCents: 150_000, amountCents: 150_000, overrideCents: null, balanceAfterCents: 1_650_000 }],
    } as PayEmployee;
    expect(deductionsOf(e)).toEqual([['SSS', 25_000], ['Pag-IBIG', 1_200], ['SSS salary loan 0301-555-01', 150_000], ['Cash advance', 50_000]]);
    expect(loansLeft(e)).toEqual([['SSS salary loan 0301-555-01', 1_650_000]]);
  });

  it('the menu shows Government loans under People & Payroll with pay.loans.view only', () => {
    const items = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'People & Payroll')?.items.map((i) => i.label) ?? [];
    expect(items(['emp.view'])).not.toContain('Government loans');
    expect(items(['emp.view', 'pay.loans.view'])).toContain('Government loans');
  });
});

describe('web client for government loans', () => {
  it('registers a loan, the run deducts it, the payslip shows what is left; the encoder may not see loans', async () => {
    const env = await createTestEnv('2026-09-30T02:00:00Z');
    const acct = createUser(env.db, 'acct-l', ['accountant']);
    createUser(env.db, 'enc-l', ['encoder']);
    const carla = addEmployee(env.db, 'Carla Opisina', { costCentre: 'office' });
    addPay(env.db, carla, acct, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const api = createApi(injectFetch(env.app));
    await api.login('acct-l', PASSWORD);
    const made = await api.addGovLoan(loanInput({ employeeId: carla, kind: 'HDMF_MPL', loanNo: '8000-1234-01', amortization: '900', firstMonth: '2026-09', lastMonth: '2028-08', note: '' }).input);
    expect(made).toMatchObject({ agency: 'HDMF', leftCents: 90_000 * 24, status: 'running' });
    const changed = await api.updateGovLoan(made.id, made.version, { amortizationCents: 95_000 });
    expect(changed.version).toBe(2);
    await expect(api.updateGovLoan(made.id, made.version, { amortizationCents: 1 })).rejects.toMatchObject({ code: 'VERSION_CHANGED' });

    const input = runInput('SEMI_MONTHLY', '2026-09-16', [], {}, {}).input;
    const pre = await api.preview('pay.run', input);
    const e = (pre.doc as PayRunDoc).employees[0]!;
    expect([e.loanCents, e.netCents]).toEqual([95_000, e.grossCents - e.sssEeCents - e.phicEeCents - e.hdmfEeCents - e.wtaxCents - 95_000 - e.caCents]);
    const run = await api.post('pay.run', input, pre.totalCents, key());
    const slips = await api.payslips(run.id);
    expect(loansLeft(slips.employees[0]!)).toEqual([['Pag-IBIG multi-purpose loan 8000-1234-01', 95_000 * 24 - 95_000]]);
    expect((await api.govLoans({ employeeId: carla }))[0]).toMatchObject({ deductedCents: 95_000 });
    const month = await api.statMonth('2026-09');
    expect([month.hdmfLoans.totalCents, month.check.find((c) => c.scheme === 'HDMF')!.loanRecordedCents]).toEqual([95_000, 95_000]);

    const enc = createApi(injectFetch(env.app));
    await enc.login('enc-l', PASSWORD);
    const refused = await enc.govLoans().catch((e: ApiError) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(403);
  });
});
