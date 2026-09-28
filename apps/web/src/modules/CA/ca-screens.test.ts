/** The repayment and write-off screens' rules, where they are registered, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addEmployee } from '../../../../server/src/modules/EMP/tests/fixture.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { FORMS, PAGES } from '../screens.ts';
import { emptyRepayment, emptyWriteoff, repaymentInput, writeoffInput } from './settle.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('repayment and write-off screen rules', () => {
  it('typed values to input, and what is missing', () => {
    expect(repaymentInput({ employeeId: 'e1', cashPlaceId: '3', amount: '1,500.50', reference: ' GCash 123 ', note: '' })).toEqual({
      input: { employeeId: 'e1', cashPlaceId: 3, amountCents: 150_050, reference: 'GCash 123' }, errors: [],
    });
    expect(repaymentInput(emptyRepayment()).errors).toEqual(['Pick who pays back.', 'Pick where the money went.', 'Type the amount paid back, like 500.00']);
    // A blank amount writes off all that is owed.
    expect(writeoffInput({ employeeId: 'e1', amount: '', accountId: '7', reason: ' Left the shop in August ' })).toEqual({
      input: { employeeId: 'e1', accountId: 7, reason: 'Left the shop in August' }, errors: [],
    });
    expect(writeoffInput({ employeeId: 'e1', amount: '250', accountId: '7', reason: 'Left the shop in August' }).input.amountCents).toBe(25_000);
    expect(writeoffInput({ ...emptyWriteoff('e1'), amount: 'abc', reason: 'short' }).errors).toEqual([
      'Type the amount like 500.00, or leave it blank to write off all that is owed.', 'Pick the expense account to charge.', 'Say why it is written off (at least 10 characters).',
    ]);
  });

  it('forms under ca.repayment and ca.writeoff; the employee view and "Cash advances owed" under People & Payroll', () => {
    expect([FORMS['ca.repayment'], FORMS['ca.writeoff'], PAGES['/ca/employees'], PAGES['/ca/employees/:id']].every(Boolean)).toBe(true);
    const types = [{ key: 'ca.repayment', module: 'CA', title: 'Cash Advance Repayment' }, { key: 'ca.writeoff', module: 'CA', title: 'Cash Advance Write-off' }] as never[];
    expect(buildMenu(types, new Set(['ca.view'])).find((g) => g.group === 'People & Payroll')?.items.map((i) => i.label)).toEqual(['Cash advances owed', 'Cash Advance Repayments', 'Cash Advance Write-offs']);
  });
});

describe('web client for repayments and write-offs', () => {
  it('who owes, a repayment, the accounts to charge, a write-off of the rest, and the view with the balance after each', async () => {
    const env = await createTestEnv('2026-09-30T02:00:00Z');
    createUser(env.db, 'acct1', ['accountant']);
    const ana = addEmployee(env.db, 'Ana Tahi');
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const cash = cashPlaceId(env.db, '1101');
    const ca = { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 };
    await api.post('ca.advance', ca, (await api.preview('ca.advance', ca)).totalCents, key());
    expect(await api.caOwing()).toEqual([{ employeeId: ana, name: 'Ana Tahi', owedCents: 200_000 }]);

    const rep = repaymentInput({ ...emptyRepayment(ana), cashPlaceId: String(cash), amount: '500' }).input;
    expect((await api.post('ca.repayment', rep, (await api.preview('ca.repayment', rep)).totalCents, key())).number).toBe('CAR-000001');
    const misc = (await api.caWriteoffAccounts()).find((a) => a.code === '6990')!;
    const wo = writeoffInput({ ...emptyWriteoff(ana), accountId: String(misc.id), reason: 'Left the shop; cannot be collected' }).input;
    const pre = await api.preview('ca.writeoff', wo);
    expect([pre.totalCents, pre.issues.map((i) => i.code)]).toEqual([150_000, ['TAXABLE']]);
    expect((await api.post('ca.writeoff', wo, pre.totalCents, key())).number).toBe('CAW-000001');

    expect(await api.caStatus(ana)).toMatchObject({
      name: 'Ana Tahi', active: true, outstandingCents: 0, open: [],
      settlements: [{ number: 'CAR-000001', kind: 'repayment', amountCents: 50_000, balanceAfterCents: 150_000 }, { number: 'CAW-000001', kind: 'writeoff', amountCents: 150_000, balanceAfterCents: 0 }],
    });
    expect(await api.caOwing()).toEqual([]);
  });
});
