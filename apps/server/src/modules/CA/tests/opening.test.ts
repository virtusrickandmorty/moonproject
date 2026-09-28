/**
 * Opening cash advances (OBCA-, PLAN D8 "Cut-over" step 3): Dr 1210 / Cr 3900 on the cut-over date, stored like any CA-
 * so the first payroll after the cut-over deducts it by the instalment typed (PAY-1); cancelled on the cut-over date
 * while the opening is open and only after payroll has deducted none of it; the refusals and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { addEmployee, addPay } from '../../EMP/tests/fixture.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { journal as journalLines } from '../../PAY/tests/world.ts';
import { openingCaDoc, type OpeningCaInput } from '../doctypes/opening.ts';
import { advanceSchedule, caBalance } from '../public.ts';

const CUTOVER = '2026-08-31'; // before the September pay period, ahead of the test clock's 2026-09-15

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let ana: string; // active employee

beforeEach(async () => {
  env = await createTestEnv('2026-09-15T02:00:00Z'); // 10:00 Manila, the end of September's first half
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  ana = addEmployee(env.db, 'Ana Sample', {});
  addPay(env.db, ana, accountant.userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000 });
});

const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: 'correct horse battery staple' });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
const obca = (over: Partial<OpeningCaInput> = {}): OpeningCaInput => ({ employeeId: ana, owedCents: 200_000, installmentCents: 100_000, note: 'Old CA-0098, CA-0102 from the prior book', ...over });
const open = (input: OpeningCaInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/ca.opening/post', { input, expectedTotalCents: input.owedCents, ...(businessDate ? { businessDate } : {}) }, idem());
const errors = async (input: OpeningCaInput, businessDate: string | null = CUTOVER) => {
  const r = await accountant.post('/api/docs/ca.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
  return r.json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
};
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? AND j.source_type = 'document' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const openingState = async () => (await accountant.get('/api/acc/opening')).json();

describe('opening cash advance golden (PLAN D8 step 3)', () => {
  it('one opening: Dr 1210 / Cr 3900 for the employee, dated the cut-over date', async () => {
    await setCutover();
    const pre = await accountant.post('/api/docs/ca.opening/preview', { input: obca(), businessDate: CUTOVER });
    expect(pre.json()).toMatchObject({
      totalCents: 200_000,
      issues: [],
      summary: 'This will record ₱2,000.00 still owed by Ana Sample on cash advances (Old CA-0098, CA-0102 from the prior book), deducted ₱1,000.00 each payroll until repaid, as open on the cut-over date 2026-08-31.',
    });
    const res = await open(obca());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBCA-000001', businessDate: CUTOVER, totalCents: 200_000, warnings: [] });
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['1210', ana, 200_000, 0, CUTOVER],
      ['3900', null, 0, 200_000, CUTOVER],
    ]);
    expect(balances(env.db)).toEqual({ '1210': 200_000, '3900': -200_000 });
    expect(caBalance(env.db, ana)).toBe(200_000);
    expect(advanceSchedule(env.db, ana)).toMatchObject({ outstandingCents: 200_000, installmentCents: 100_000, open: [{ number: 'OBCA-000001', amountCents: 200_000, installmentCents: 100_000, openCents: 200_000 }] });

    const s = await openingState();
    expect(s.openingEquityCents).toBe(-200_000);
    expect(s.documents).toMatchObject([{ docType: 'ca.opening', number: 'OBCA-000001', businessDate: CUTOVER, status: 'posted', totalCents: 200_000 }]);
    expect(s.checks.find((c: { code: string }) => c.code === '1210')).toMatchObject({ controlCents: 200_000, partiesCents: 200_000, ok: true });

    // Stored like a CA-: no cash place, the note kept.
    expect(env.db.prepare('SELECT cash_account_id, amount_cents, installment_cents FROM ca_advances WHERE document_id = ?').raw().get(id)).toEqual([null, 200_000, 100_000]);
    expect((await accountant.get(`/api/docs/ca.opening/${id}`)).json().input).toEqual(obca());
    noBrokenInvariants();
  });

  it('the first payroll after the cut-over deducts it by the instalment typed (PAY-1)', async () => {
    await setCutover();
    const carla = addEmployee(env.db, 'Carla Sample', { costCentre: 'office' });
    addPay(env.db, carla, accountant.userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 });
    const openId = (await open(obca({ employeeId: carla }))).json().id as string;

    const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart: '2026-09-01' };
    const pre = await accountant.post('/api/docs/pay.run/preview', { input });
    expect(pre.json().totalCents).toBe(750_000); // half of ₱15,000
    const run = await accountant.post('/api/docs/pay.run/post', { input, expectedTotalCents: 750_000 }, idem());
    expect(run.statusCode).toBe(200);
    // Same as PLAN I2 G-24 cutoff 1, less the ₱1,000.00 instalment credited to 1210 instead of net pay.
    expect(journalLines(env, run.json().id)).toEqual([
      '1210 Cr 1,000.00', '2110 Cr 5,600.00', '2111 Cr 625.00', '2401 Cr 1,135.00', '2402 Cr 750.00', '2403 Cr 300.00', '6101 Dr 7,500.00', '6102 Dr 1,285.00', '6103 Dr 625.00',
    ]);
    expect(caBalance(env.db, carla)).toBe(100_000);
    expect(advanceSchedule(env.db, carla).outstandingCents).toBe(100_000);

    // Cancel is now blocked: the payroll deducted part of it.
    const blocked = await cancel(accountant, 'ca.opening', openId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: PAY-000001.' });
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date, only after payroll has deducted it', async () => {
    await setCutover();
    const id = (await open(obca())).json().id as string;
    env.clock.set('2026-09-16T02:00:00Z'); // cancelled the next day
    accountant = await env.as('accountant');
    expect((await cancel(accountant, 'ca.opening', id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['1210', ana, 0, 200_000, CUTOVER],
      ['3900', null, 200_000, 0, CUTOVER],
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(caBalance(env.db, ana)).toBe(0);
    expect((await openingState()).documents).toMatchObject([{ number: 'OBCA-000001', status: 'cancelled' }]);

    // Edit = cancel + a new number, still on the cut-over date.
    const second = (await open(obca({ owedCents: 300_000 }))).json();
    expect(second).toMatchObject({ number: 'OBCA-000002', businessDate: CUTOVER });
    const input = obca({ owedCents: 320_000, installmentCents: 120_000 });
    const r = await accountant.post(`/api/docs/ca.opening/${second.id}/reissue`, { input, expectedTotalCents: 320_000, businessDate: CUTOVER, reason: 'The old ledger shows more owed' }, idem());
    expect(r.json()).toMatchObject({ number: 'OBCA-000003', businessDate: CUTOVER });
    expect(balances(env.db)).toEqual({ '1210': 320_000, '3900': -320_000 });
    noBrokenInvariants();
  });

  it('after the opening is closed it stays, and payroll still deducts it', async () => {
    await setCutover();
    const id = (await open(obca())).json().id as string;
    // Balance 3900 with the opposite side (retained earnings) so the close's checks pass.
    const accId = env.db.prepare(`SELECT id FROM accounts WHERE code = '3201'`).pluck().get() as number;
    await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: accId, creditCents: 200_000 }] }, expectedTotalCents: 200_000, businessDate: CUTOVER }, idem());
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);

    const refused = await cancel(accountant, 'ca.opening', id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('OPENING_CLOSED');
    expect(caBalance(env.db, ana)).toBe(200_000);
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, or once the opening is closed', async () => {
    expect(await errors(obca())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(obca(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-15
    expect(await errors(obca(), '2026-08-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(obca(), '2026-08-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-08-31, not 2026-08-20.');
    expect(await errors(obca())).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200); // nothing opened: 3900 is zero
    const closed = await open(obca());
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(balances(env.db)).toEqual({});
  });

  it('an inactive employee, or an instalment more than what is owed', async () => {
    await setCutover();
    const gone = addEmployee(env.db, 'Ben Sample', { separatedOn: '2026-01-01' });
    expect(await errors(obca({ employeeId: gone }))).toEqual(['EMPLOYEE']);
    expect(await errors(obca({ installmentCents: 200_001 }))).toEqual(['INSTALLMENT']);
    expect(await errors(obca({ installmentCents: 200_000 }))).toEqual([]); // the whole balance in one instalment is fine
  });

  it('dates and who may record it', async () => {
    await setCutover();
    expect((await open(obca(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(obca(), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/ca.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/ca.opening')).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random opening cash advances post balanced, never overpay, and cancel to zero (L3, L10)', async () => {
    await setCutover();
    const ben = addEmployee(env.db, 'Ben Sample', {});
    addPay(env.db, ben, accountant.userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const openings = openingCaDoc.arbitrary(env.db);
    const post = (input: OpeningCaInput) => postDocument(e, openingCaDoc, actor, { input, expectedTotalCents: input.owedCents, businessDate: CUTOVER });
    fc.assert(
      fc.property(fc.array(fc.tuple(openings, fc.boolean()), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, doCancel] of ops) {
          const doc = openingCaDoc.compute(input, ctx());
          expect(openingCaDoc.validate(doc, ctx())).toEqual([]);
          const lines = resolveDraft(env.db, openingCaDoc.journal!(doc, ctx())!);
          expect(lines.map((l) => [l.account.role_key, l.debitCents, l.creditCents])).toEqual([
            ['EMP_ADVANCES', input.owedCents, 0],
            ['OPENING_EQUITY', 0, input.owedCents],
          ]);
          const o = post(input);
          expect(openingCaDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingCaDoc.toInput(doc)).toEqual(input);
          if (doCancel) cancelDocument(e, openingCaDoc, actor, o.id, 'Recorded twice by mistake');
        }
        for (const id of [ana, ben]) expect(caBalance(env.db, id)).toBeGreaterThanOrEqual(0);
        const total = [ana, ben].reduce((s, id) => s + caBalance(env.db, id), 0);
        expect(balances(env.db)['1210'] ?? 0).toBe(total);
        expect(balances(env.db)['3900'] ?? 0).toBe(0 - total);
        const reversals = env.db.prepare(`SELECT DISTINCT j.business_date FROM journals j JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'ca.opening' AND j.posting_kind = 'reversal'`).pluck().all();
        expect(reversals.filter((d) => d !== CUTOVER)).toEqual([]);
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
