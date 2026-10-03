import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { stamp } from '../../../platform/clock.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';

let env: TestEnv;
let accountant: Client;
const deadline = async (form = '2550Q', period = '2026-Q3', from = '2026-10-01', to = '2026-10-31') => {
  const res = await accountant.get(`/api/tax/calendar?from=${from}&to=${to}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { form: string; period: string; status: string; reference: string | null; recordedAt: string | null }[]).find((d) => d.form === form && d.period === period);
};

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
});
afterEach(async () => { await env.app.close(); env.db.close(); });

describe('tax calendar filing status', () => {
  it('shows a registered 2550Q with its reference and recording date, and reopens it when voided', async () => {
    expect(await deadline()).toMatchObject({ status: 'not_yet_filed', reference: null, recordedAt: null });
    expect((await accountant.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    const recorded = await accountant.post('/api/tax/filed-returns', {
      form: '2550Q', period: '2026-Q3', filedOn: '2026-09-28', reference: 'Made-up VAT confirmation 001',
    });
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(await deadline()).toMatchObject({ status: 'filed', reference: 'Made-up VAT confirmation 001', recordedAt: stamp(env.clock) });
    const voided = await accountant.post(`/api/tax/filed-returns/${recorded.json().id}/void`, { reason: 'Wrong quarter on this confirmation' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await deadline()).toMatchObject({ status: 'not_yet_filed', reference: null, recordedAt: null });
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('calls an unfiled return late only after its adjusted due date has passed', async () => {
    env.clock.set('2026-10-26T15:59:00Z'); // still 26 October in Manila
    accountant = await env.as('accountant');
    expect(await deadline()).toMatchObject({ status: 'not_yet_filed' });
    env.clock.advance(60_000);
    expect(await deadline()).toMatchObject({ status: 'late', reference: null, recordedAt: null });
    expect(await deadline('2550Q', '2026-Q2', '2026-07-01', '2026-07-31')).toMatchObject({ status: 'late' });
  });

  it('matches the annual calendar name to 1702 and keeps a filed return filed after its due date', async () => {
    expect((await accountant.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    const r = await accountant.post('/api/tax/filed-returns', { form: '1702', period: '2025', filedOn: '2026-04-15', reference: 'Made-up annual confirmation 001' });
    expect(r.statusCode, r.body).toBe(200);
    expect(await deadline('1702-RT', '2025', '2026-04-01', '2026-04-30')).toMatchObject({ status: 'filed', reference: 'Made-up annual confirmation 001', recordedAt: stamp(env.clock) });
  });

  it('shows the number and recording date of the BIR payment that filed a return', async () => {
    const paid = await accountant.post('/api/docs/tax.bir_payment/post', { input: {
      form: '1702Q', period: '2026-Q2', amountCents: 150_000, cashPlaceId: cashPlaceId(env.db, '1111'), reference: 'Made-up eFPS 001', note: 'Income in the old books before cut-over',
    }, expectedTotalCents: 150_000 }, idem());
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await deadline('1702Q', '2026-Q2', '2026-09-01', '2026-09-30')).toMatchObject({ status: 'filed', reference: paid.json().number, recordedAt: stamp(env.clock) });
  });

  it('shows a 1601-C remittance as filed and reopens the deadline when it is cancelled', async () => {
    const employeeId = addEmployee(env.db, 'Toni Made-up');
    expect((await accountant.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: '2026-09-01' })).statusCode).toBe(200);
    const opened = await accountant.post('/api/docs/stat.opening/post', { input: {
      month: '2026-08', employees: [{ employeeId, wtaxCents: 100 }],
    }, businessDate: '2026-09-01', expectedTotalCents: 100 }, idem());
    expect(opened.statusCode, opened.body).toBe(200);
    const paid = await accountant.post('/api/docs/stat.remittance/post', { input: {
      scheme: 'WTAX', month: '2026-08', cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: 100, reference: 'MADE-UP-WTAX-001',
    }, expectedTotalCents: 100 }, idem());
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await deadline('1601-C', '2026-08', '2026-09-01', '2026-09-30')).toMatchObject({ status: 'filed', reference: paid.json().number, recordedAt: stamp(env.clock) });
    const cancelled = await accountant.post(`/api/docs/stat.remittance/${paid.json().id}/cancel`, { reason: 'Wrong withholding remittance recorded' }, idem());
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await deadline('1601-C', '2026-08', '2026-09-01', '2026-09-30')).toMatchObject({ status: 'late', reference: null, recordedAt: null });
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
