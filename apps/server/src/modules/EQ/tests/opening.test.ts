/**
 * Opening officer balances (OBOF-, PLAN D8 "Cut-over" step 3): Dr 1220 / Cr 3900 (owes the shop) or Dr 3900 / Cr 2501
 * (the shop owes) on the cut-over date, settled afterwards like any officer money and shown in the officer ledger;
 * cancelled on the cut-over date while the opening is open and only after it is settled; the refusals and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { officerBalances, officerLedger } from '../people.ts';
import { openingOfficerDoc, type OpeningOfficerInput } from '../doctypes/opening.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let BDO: number;
let A: string; // an officer and stockholder
let notOfficer: string; // a stockholder only, never an officer

const cashPlaceId = (code: string) => (env.db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  BDO = cashPlaceId('1111');
  A = (await accountant.post('/api/eq/people', { name: 'Sample Officer A', isStockholder: true, isOfficer: true, position: 'President' })).json().id;
  notOfficer = (await accountant.post('/api/eq/people', { name: 'Sample Stockholder Only', isStockholder: true, isOfficer: false })).json().id;
});

const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: 'correct horse battery staple' });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
const obof = (over: Partial<OpeningOfficerInput> = {}): OpeningOfficerInput => ({ personId: A, direction: 'owes_shop', amountCents: 250_000, note: 'Old officer ledger balance from the prior book', ...over });
const open = (input: OpeningOfficerInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/eq.opening/post', { input, expectedTotalCents: input.amountCents, ...(businessDate ? { businessDate } : {}) }, idem());
const errors = async (input: OpeningOfficerInput, businessDate: string | null = CUTOVER) => {
  const r = await accountant.post('/api/docs/eq.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
  return r.json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
};
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? AND j.source_type = 'document' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const openingState = async () => (await accountant.get('/api/acc/opening')).json();

describe('opening officer balance golden (PLAN D8 step 3)', () => {
  it('owes the shop: Dr 1220 / Cr 3900 for the officer, dated the cut-over date', async () => {
    await setCutover();
    const pre = await accountant.post('/api/docs/eq.opening/preview', { input: obof(), businessDate: CUTOVER });
    expect(pre.json()).toMatchObject({
      totalCents: 250_000,
      issues: [],
      summary: 'This will record ₱2,500.00 Sample Officer A owed the company on the cut-over date 2026-09-27 (Old officer ledger balance from the prior book).',
    });
    const res = await open(obof());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBOF-000001', businessDate: CUTOVER, totalCents: 250_000, warnings: [] });
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['1220', 'officer', A, 250_000, 0, CUTOVER],
      ['3900', null, null, 0, 250_000, CUTOVER],
    ]);
    expect(balances(env.db)).toEqual({ '1220': 250_000, '3900': -250_000 });
    expect(officerBalances(env.db, A)).toEqual({ dueFromCents: 250_000, dueToCents: 0 });
    expect(officerLedger(env.db, A)).toMatchObject([{ documentNumber: 'OBOF-000001', accountCode: '1220', amountCents: 250_000, netCents: 250_000 }]);

    const s = await openingState();
    expect(s.openingEquityCents).toBe(-250_000);
    expect(s.documents).toMatchObject([{ docType: 'eq.opening', number: 'OBOF-000001', businessDate: CUTOVER, status: 'posted', totalCents: 250_000 }]);
    expect(s.checks.find((c: { code: string }) => c.code === '1220')).toMatchObject({ controlCents: 250_000, partiesCents: 250_000, ok: true });
    expect((await accountant.get(`/api/docs/eq.opening/${id}`)).json().input).toEqual(obof());
    noBrokenInvariants();
  });

  it('the shop owes: Dr 3900 / Cr 2501, settled afterwards like any officer money', async () => {
    await setCutover();
    const id = (await open(obof({ direction: 'shop_owes', amountCents: 400_000 }))).json().id as string;
    expect(journalOf(id)).toEqual([
      ['3900', null, null, 400_000, 0, CUTOVER],
      ['2501', 'officer', A, 0, 400_000, CUTOVER],
    ]);
    expect(officerBalances(env.db, A)).toEqual({ dueFromCents: 0, dueToCents: 400_000 });

    // Settled like any officer money: the company pays part of it back, never more than is owed.
    const over = await encoder.post('/api/docs/eq.officer/post', { input: { personId: A, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 400_001, purpose: 'Advance repaid' }, expectedTotalCents: 400_001 }, idem());
    expect(over.json().details[0].code).toBe('MORE_THAN_OWED');
    const back = await encoder.post('/api/docs/eq.officer/post', { input: { personId: A, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 150_000, purpose: 'Advance repaid' }, expectedTotalCents: 150_000 }, idem());
    expect(back.statusCode).toBe(200);
    expect(officerBalances(env.db, A)).toEqual({ dueFromCents: 0, dueToCents: 250_000 });

    // Cancel is now blocked: the settlement paid part of it back.
    const blocked = await cancel(accountant, 'eq.opening', id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: `Cancel these first: ${back.json().number}.` });
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date, only after it is settled', async () => {
    await setCutover();
    const id = (await open(obof())).json().id as string;
    env.clock.advance(24 * 3600_000); // cancelled the next day
    accountant = await env.as('accountant');
    expect((await cancel(accountant, 'eq.opening', id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['1220', 'officer', A, 0, 250_000, CUTOVER],
      ['3900', null, null, 250_000, 0, CUTOVER],
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(officerBalances(env.db, A)).toEqual({ dueFromCents: 0, dueToCents: 0 });
    expect((await openingState()).documents).toMatchObject([{ number: 'OBOF-000001', status: 'cancelled' }]);

    // Edit = cancel + a new number, still on the cut-over date.
    const second = (await open(obof({ amountCents: 300_000 }))).json();
    expect(second).toMatchObject({ number: 'OBOF-000002', businessDate: CUTOVER });
    const input = obof({ amountCents: 320_000, note: 'The old ledger shows more owed' });
    const r = await accountant.post(`/api/docs/eq.opening/${second.id}/reissue`, { input, expectedTotalCents: 320_000, businessDate: CUTOVER, reason: 'The old ledger shows more owed' }, idem());
    expect(r.json()).toMatchObject({ number: 'OBOF-000003', businessDate: CUTOVER });
    expect(balances(env.db)).toEqual({ '1220': 320_000, '3900': -320_000 });
    noBrokenInvariants();
  });

  it('after the opening is closed it stays, and is still settled like any officer money', async () => {
    await setCutover();
    const id = (await open(obof())).json().id as string;
    const accId = env.db.prepare(`SELECT id FROM accounts WHERE code = '3201'`).pluck().get() as number;
    await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: accId, creditCents: 250_000 }] }, expectedTotalCents: 250_000, businessDate: CUTOVER }, idem());
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);

    const refused = await cancel(accountant, 'eq.opening', id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('OPENING_CLOSED');
    const back = await encoder.post('/api/docs/eq.officer/post', { input: { personId: A, kind: 'returned', cashPlaceId: BDO, amountCents: 250_000, purpose: 'Paid back in full' }, expectedTotalCents: 250_000 }, idem());
    expect(back.statusCode).toBe(200);
    expect(officerBalances(env.db, A)).toEqual({ dueFromCents: 0, dueToCents: 0 });
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, or once the opening is closed', async () => {
    expect(await errors(obof())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(obof(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(obof(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(obof(), '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect(await errors(obof())).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200); // nothing opened: 3900 is zero
    const closed = await open(obof());
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(balances(env.db)).toEqual({});
  });

  it('a person who is not an officer', async () => {
    await setCutover();
    expect(await errors(obof({ personId: notOfficer }))).toEqual(['NOT_OFFICER']);
    expect(await errors(obof({ personId: 'no-such-person' }))).toEqual(['PERSON']);
    await accountant.post(`/api/eq/people/${A}/deactivate`, {}, { 'if-match': '1' });
    expect(await errors(obof())).toEqual(['PERSON']);
  });

  it('who may record it', async () => {
    await setCutover();
    expect((await open(obof(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(obof(), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/eq.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/eq.opening')).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random opening officer balances post balanced, nobody owes less than nothing, and cancel to zero (L3)', async () => {
    await setCutover();
    const B = (await accountant.post('/api/eq/people', { name: 'Sample Officer B', isStockholder: false, isOfficer: true, position: 'Treasurer' })).json().id;
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const openings = openingOfficerDoc.arbitrary(env.db);
    const post = (input: OpeningOfficerInput) => postDocument(e, openingOfficerDoc, actor, { input, expectedTotalCents: input.amountCents, businessDate: CUTOVER });
    fc.assert(
      fc.property(fc.array(fc.tuple(openings, fc.boolean()), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, doCancel] of ops) {
          const doc = openingOfficerDoc.compute(input, ctx());
          expect(openingOfficerDoc.validate(doc, ctx())).toEqual([]);
          const lines = resolveDraft(env.db, openingOfficerDoc.journal!(doc, ctx())!);
          const expected =
            input.direction === 'owes_shop'
              ? [['DUE_FROM_OFFICERS', input.amountCents, 0], ['OPENING_EQUITY', 0, input.amountCents]]
              : [['OPENING_EQUITY', input.amountCents, 0], ['DUE_TO_OFFICERS', 0, input.amountCents]];
          expect(lines.map((l) => [l.account.role_key, l.debitCents, l.creditCents])).toEqual(expected);
          const o = post(input);
          expect(openingOfficerDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingOfficerDoc.toInput(doc)).toEqual(input);
          if (doCancel) cancelDocument(e, openingOfficerDoc, actor, o.id, 'Recorded twice by mistake');
        }
        for (const id of [A, B]) {
          const b = officerBalances(env.db, id);
          expect(b.dueFromCents).toBeGreaterThanOrEqual(0);
          expect(b.dueToCents).toBeGreaterThanOrEqual(0);
        }
        const reversals = env.db.prepare(`SELECT DISTINCT j.business_date FROM journals j JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'eq.opening' AND j.posting_kind = 'reversal'`).pluck().all();
        expect(reversals.filter((d) => d !== CUTOVER)).toEqual([]);
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
