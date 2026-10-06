import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cashPlaceId, createTestEnv, idem, PASSWORD, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { filedReturnsCovering } from '../filed.ts';
import { stamp } from '../../../platform/clock.ts';
import * as stat from '../../STAT/public.ts';

let env: TestEnv;
let accountant: Client;
const body = { form: '0619-E', period: '2026-07', filedOn: '2026-08-10', reference: 'eBIRForms confirmation 0001', note: 'Nothing to pay' };
const fresh = async (client = accountant) => expect((await client.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
const add = async (patch: object = {}) => {
  const res = await accountant.post('/api/tax/filed-returns', { ...body, ...patch });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: number; reference: string };
};
const input = {
  memo: 'Bank charge found late', lateReason: 'Found in the month-end review',
  lines: [] as { accountId: number; debitCents?: number; creditCents?: number }[],
};
const probe = async (date = '2026-07-20') => {
  const res = await accountant.post('/api/docs/acc.jv/preview', { input, businessDate: date });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const pay = async () => {
  const v = { form: '1702Q', period: '2026-Q2', amountCents: 150_000, cashPlaceId: cashPlaceId(env.db, '1111'), reference: 'eFPS 0002', note: 'Income of the old books before the cut-over' };
  const res = await accountant.post('/api/docs/tax.bir_payment/post', { input: v, expectedTotalCents: 150_000 }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string };
};

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  accountant = await env.as('accountant');
  input.lines = [{ accountId: cashPlaceId(env.db, '6190'), debitCents: 5000 }, { accountId: cashPlaceId(env.db, '1111'), creditCents: 5000 }];
});
afterEach(async () => { vi.restoreAllMocks(); await env.app.close(); env.db.close(); });

describe('filed-returns register', () => {
  it('a confirmation alone files the period, warns and lists later records and cancellations; voiding removes it', async () => {
    await fresh();
    const r = await add();
    expect(filedReturnsCovering(env.db, '2026-07-20')).toMatchObject([{ payment: null, register: { id: r.id }, reference: body.reference }]);
    expect((await probe()).issues).toContainEqual(expect.objectContaining({ code: 'FILED_PERIOD', level: 'warning', message: expect.stringContaining(`filed on ${body.filedOn}, reference ${body.reference}`) }));
    expect((await probe('2026-08-01')).issues.filter((i: { code: string }) => i.code === 'FILED_PERIOD')).toEqual([]);
    env.clock.advance(1000);
    const posted = await accountant.post('/api/docs/acc.jv/post', { input, businessDate: '2026-07-20', expectedTotalCents: 5000 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    env.clock.advance(1000);
    const cancelled = await accountant.post(`/api/docs/acc.jv/${posted.json().id}/cancel`, { reason: 'Recorded against the wrong period' }, idem());
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const changes = (await accountant.get('/api/tax/changes-after-filing')).json().rows;
    expect(changes.map((c: { what: string }) => c.what)).toEqual(['recorded', 'cancelled']);
    expect(changes).toEqual([expect.objectContaining({ paymentNumber: body.reference }), expect.objectContaining({ paymentNumber: body.reference })]);
    const voided = await accountant.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'Wrong confirmation was entered' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(filedReturnsCovering(env.db, '2026-07-20')).toEqual([]);
    expect((await probe()).issues.filter((i: { code: string }) => i.code === 'FILED_PERIOD')).toEqual([]);
    expect((await accountant.get('/api/tax/changes-after-filing')).json().rows).toEqual([]);
    expect((await accountant.get('/api/tax/filed-returns')).json().rows).toEqual([expect.objectContaining({ ...body, voidReason: 'Wrong confirmation was entered', voidedBy: accountant.userId })]);
    const audits = env.db.prepare(`SELECT action FROM audit_log WHERE entity_type = 'tax_filed_return' ORDER BY seq`).pluck().all();
    expect(audits).toEqual(['tax.filed_return.add', 'tax.filed_return.void']);
    const owner = await env.as('owner');
    const notifications = (await owner.get('/api/dash/notifications')).json();
    for (const word of ['recorded a filed return', 'voided a filed return']) {
      expect(notifications).toContainEqual(expect.objectContaining({ kind: 'step-up-action', label: expect.stringContaining(word) }));
    }
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('requires settings permission and a fresh password to add and void, and register permission to view', async () => {
    expect((await accountant.post('/api/tax/filed-returns', body)).json().code).toBe('STEP_UP_REQUIRED');
    const encoder = await env.as('encoder');
    await fresh(encoder);
    expect((await encoder.get('/api/tax/filed-returns')).statusCode).toBe(403);
    expect((await encoder.post('/api/tax/filed-returns', body)).statusCode).toBe(403);
    await fresh();
    const r = await add();
    expect((await encoder.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'Wrong confirmation was entered' })).statusCode).toBe(403);
    env.clock.advance(6 * 60_000);
    for (const url of ['/api/tax/filed-returns', `/api/tax/filed-returns/${r.id}/void`]) {
      expect((await accountant.post(url, url.endsWith('/void') ? { reason: 'Wrong confirmation was entered' } : body)).json().code).toBe('STEP_UP_REQUIRED');
    }
    expect((await accountant.get('/api/tax/filed-returns')).statusCode).toBe(200);
    expect((await (await env.as('owner')).get('/api/tax/filed-returns')).statusCode).toBe(200);
    expect(env.db.prepare('SELECT COUNT(*) FROM tax_filed_return_voids').pluck().get()).toBe(0);
  });

  it('keeps an earlier payment as the filing source even when the confirmation has an earlier date filed', async () => {
    const p = await pay();
    env.clock.advance(1000);
    await fresh();
    await add({ form: '1702Q', period: '2026-Q2', filedOn: '2026-07-20' });
    expect(filedReturnsCovering(env.db, '2026-06-20')).toMatchObject([{ payment: { documentId: p.id, number: p.number }, register: null }]);
    expect((await probe('2026-06-20')).issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining(`was paid on ${p.number}`) }));
  });

  it('keeps an earlier confirmation when payment follows, then falls back to the payment when voided', async () => {
    await fresh();
    const r = await add({ form: '1702Q', period: '2026-Q2' });
    env.clock.advance(1000);
    const p = await pay();
    expect(filedReturnsCovering(env.db, '2026-06-20')).toMatchObject([{ payment: null, register: { id: r.id } }]);
    expect((await accountant.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'Wrong confirmation was entered' })).statusCode).toBe(200);
    expect(filedReturnsCovering(env.db, '2026-06-20')).toMatchObject([{ payment: { documentId: p.id }, register: null }]);
  });

  it.each([
    'payment', 'confirmation',
  ])('uses recording order when a %s is first at the same timestamp', async (first) => {
    await fresh();
    if (first === 'payment') await pay();
    const r = await add({ form: '1702Q', period: '2026-Q2' });
    if (first === 'confirmation') await pay();
    const filed = filedReturnsCovering(env.db, '2026-06-20')[0]!;
    expect(filed.register?.id ?? null).toBe(first === 'confirmation' ? r.id : null);
    expect(filed.payment !== null).toBe(first === 'payment');
  });

  it.each([
    ['2550Q', '2026-Q3'], ['0619-E', '2026-07'], ['1601-EQ', '2026-Q3'], ['1601-FQ', '2026-Q3'],
    ['1702Q', '2026-Q3'], ['1702', '2026'], ['1601-C', '2026-07'],
  ])('supports %s with its matching period', async (form, period) => {
    await fresh();
    await add({ form, period });
    expect(filedReturnsCovering(env.db, '2026-07-20')).toMatchObject([{ form, period }]);
  });

  it('an unrelated remittance at the same timestamp cannot change which source filed a return first', async () => {
    await fresh();
    const r = await add({ form: '1702Q', period: '2026-Q2' });
    await pay();
    // The STAT public boundary supplies another form with a different numbering prefix.
    vi.spyOn(stat, 'wtaxRemittances').mockReturnValue([{
      documentId: 'sample-remittance', number: 'REM-000001', month: '2026-07', paidOn: '2026-09-28', recordedAt: stamp(env.clock), recordedBy: accountant.userId,
    }]);
    expect(filedReturnsCovering(env.db, '2026-06-20')).toMatchObject([{ payment: null, register: { id: r.id } }]);
  });

  it('rejects invalid input, future filing dates, edits, deletes and repeated voids', async () => {
    await fresh();
    for (const patch of [{ filedOn: '2026-09-29' }, { filedOn: '2026-02-30' }, { form: 'unknown' }, { period: '2026-Q3' }, { period: '2026-09' }, { form: '1702Q', period: '2026-Q4' }, { reference: ' ' }, { recordedBy: accountant.userId }]) {
      expect((await accountant.post('/api/tax/filed-returns', { ...body, ...patch })).statusCode).toBe(400);
    }
    const r = await add();
    expect(() => env.db.prepare(`UPDATE tax_filed_returns SET reference = 'edited' WHERE id = ?`).run(r.id)).toThrow('IMMUTABLE');
    expect(() => env.db.prepare('DELETE FROM tax_filed_returns WHERE id = ?').run(r.id)).toThrow();
    expect((await accountant.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'short' })).statusCode).toBe(400);
    expect((await accountant.post('/api/tax/filed-returns/999/void', { reason: 'Wrong confirmation was entered' })).statusCode).toBe(404);
    expect((await accountant.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'Wrong confirmation was entered' })).statusCode).toBe(200);
    expect((await accountant.post(`/api/tax/filed-returns/${r.id}/void`, { reason: 'Wrong confirmation was entered' })).statusCode).toBe(409);
    expect(() => env.db.prepare(`UPDATE tax_filed_return_voids SET reason = 'edited reason' WHERE return_id = ?`).run(r.id)).toThrow('IMMUTABLE');
    expect(() => env.db.prepare('DELETE FROM tax_filed_return_voids WHERE return_id = ?').run(r.id)).toThrow();
  });
});
