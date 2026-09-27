/**
 * Owners and officers: the register, owner money (golden G-19 and every classification), officer money out and back,
 * cancel/edit, the officer ledger, and property tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postDocument, cancelDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { ownerMoneyDoc } from '../doctypes/owner-money.ts';
import { officerDoc } from '../doctypes/officer.ts';
import { listPeople, officerBalances } from '../people.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number, CASH: number, GCASH: number;
let A: string, B: string; // A: stockholder and President; B: officer only (Treasurer)

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  CASH = cashPlaceId(env.db, '1101');
  GCASH = cashPlaceId(env.db, '1121');
  A = (await accountant.post('/api/eq/people', { name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500 })).json().id;
  B = (await accountant.post('/api/eq/people', { name: 'Sample Officer B', isStockholder: false, isOfficer: true, position: 'Treasurer' })).json().id;
});

const postOwn = (c: Client, input: { amountCents: number; [k: string]: unknown }, headers = idem()) =>
  c.post('/api/docs/eq.owner_money/post', { input, expectedTotalCents: input.amountCents }, headers);
const postOfc = (c: Client, input: { amountCents: number; [k: string]: unknown }, headers = idem()) =>
  c.post('/api/docs/eq.officer/post', { input, expectedTotalCents: input.amountCents }, headers);

/** The original journal of a document: [code, party type, party id, debit, credit] per line. */
const journalOf = (documentId: string) =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId);

const docCount = () => env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get() as number;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('register of stockholders and officers', () => {
  it('accountants add and edit people with If-Match; encoders only see them', async () => {
    expect((await encoder.get('/api/eq/people')).json().map((p: { name: string }) => p.name)).toEqual(['Sample Officer B', 'Sample Owner A']);
    expect((await encoder.post('/api/eq/people', { name: 'Sample Person C', isStockholder: true, isOfficer: false })).statusCode).toBe(403);
    const none = await accountant.post('/api/eq/people', { name: 'Sample Person C', isStockholder: false, isOfficer: false });
    expect(none.json().code).toBe('ROLE_REQUIRED');
    expect((await accountant.post('/api/eq/people', { name: 'Sample Person C', isStockholder: true, isOfficer: false, shares: -1 })).statusCode).toBe(400);

    expect((await accountant.put(`/api/eq/people/${B}`, { shares: 100 })).statusCode).toBe(428);
    expect((await accountant.put(`/api/eq/people/${B}`, { shares: 100 }, { 'if-match': '7' })).statusCode).toBe(409);
    const r = await accountant.put(`/api/eq/people/${B}`, { isStockholder: true, shares: 100 }, { 'if-match': '1' });
    expect(r.json()).toMatchObject({ isStockholder: true, isOfficer: true, shares: 100, version: 2 });
    expect((await accountant.put(`/api/eq/people/${B}`, { isStockholder: false, isOfficer: false }, { 'if-match': '2' })).json().code).toBe('ROLE_REQUIRED');
  });

  it('a person is switched off only when nothing is owed either way, and then cannot be picked', async () => {
    await postOfc(encoder, { personId: B, kind: 'taken', cashPlaceId: CASH, amountCents: 50_000, purpose: 'Cash for a trip' });
    const off = await accountant.post(`/api/eq/people/${B}/deactivate`, {}, { 'if-match': '1' });
    expect(off.statusCode).toBe(409);
    expect(off.json().code).toBe('HAS_BALANCE');
    await postOfc(encoder, { personId: B, kind: 'returned', cashPlaceId: CASH, amountCents: 50_000, purpose: 'Paid back in cash' });
    expect((await accountant.post(`/api/eq/people/${B}/deactivate`, {}, { 'if-match': '1' })).json().isActive).toBe(false);
    expect((await encoder.get('/api/eq/people')).json()).toHaveLength(1);
    const r = await postOfc(encoder, { personId: B, kind: 'taken', cashPlaceId: CASH, amountCents: 100, purpose: 'Cash for a trip' });
    expect(r.statusCode).toBe(422);
    expect((await accountant.post(`/api/eq/people/${B}/activate`, {}, { 'if-match': '2' })).json().isActive).toBe(true);
  });
});

describe('Owner money golden (PLAN I2 G-19)', () => {
  const g19 = () => ({ personId: A, cashPlaceId: BDO, amountCents: 10_000_000, classification: 'advance' });

  it('owner puts 100,000.00 into BDO as an advance from a stockholder', async () => {
    const pre = await encoder.post('/api/docs/eq.owner_money/preview', { input: g19() });
    expect(pre.json().summary).toBe('This will record ₱100,000.00 from Sample Owner A into Cash in bank – BDO as an advance from a stockholder (the company owes it back).');
    const res = await postOwn(encoder, g19());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OWN-000001', totalCents: 10_000_000, journalNumber: 'JE-2026-000001' });
    expect(journalOf(res.json().id)).toEqual([
      ['1111', null, null, 10_000_000, 0],
      ['2501', 'officer', A, 0, 10_000_000],
    ]);
    expect(balances(env.db)).toEqual({ '1111': 10_000_000, '2501': -10_000_000 });
    noBrokenInvariants();
  });

  it('saving without a classification is rejected and records nothing', async () => {
    const { classification: _, ...unclassified } = g19();
    const r = await postOwn(encoder, unclassified);
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('INVALID_INPUT');
    expect((await postOwn(encoder, { ...g19(), classification: 'revenue' })).statusCode).toBe(400);
    expect(docCount()).toBe(0);
    expect(balances(env.db)).toEqual({});
  });

  it('capital stock: par to 3101, the excess to 3104; only the accountant classifies', async () => {
    const input = { personId: A, cashPlaceId: CASH, amountCents: 10_000_000, classification: 'capital_stock', parValueCents: 8_000_000 };
    const refused = await postOwn(encoder, input);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().details.map((i: { code: string }) => i.code)).toEqual(['CLASSIFY']);
    const res = await postOwn(accountant, input);
    expect(res.json().summary).toBe('This will record ₱100,000.00 from Sample Owner A into Cash on hand (main cash box) as payment for capital stock (par ₱80,000.00, excess ₱20,000.00).');
    expect(journalOf(res.json().id)).toEqual([
      ['1101', null, null, 10_000_000, 0],
      ['3101', 'stockholder', A, 0, 8_000_000],
      ['3104', null, null, 0, 2_000_000],
    ]);
    const { parValueCents: _, ...noPar } = input;
    expect((await postOwn(accountant, noPar)).json().details[0].code).toBe('PAR_REQUIRED');
    expect((await postOwn(accountant, { ...input, parValueCents: 10_000_001 })).json().details[0].code).toBe('PAR_TOO_BIG');
    expect((await postOwn(accountant, { ...input, classification: 'advance' })).json().details[0].code).toBe('PAR_NOT_ALLOWED');
    expect((await postOwn(accountant, { ...input, personId: B })).json().details.map((i: { code: string }) => i.code)).toEqual(['NOT_STOCKHOLDER']);
    noBrokenInvariants();
  });

  it('a subscription payment clears 3103 and never more than is unpaid', async () => {
    const acc = (code: string) => (env.db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;
    const sh = { type: 'stockholder', id: A };
    const jv = { memo: 'Subscription to 500 shares', lines: [{ accountId: acc('3103'), party: sh, debitCents: 5_000_000 }, { accountId: acc('3102'), party: sh, creditCents: 5_000_000 }] };
    expect((await accountant.post('/api/docs/acc.jv/post', { input: jv, expectedTotalCents: 5_000_000 }, idem())).statusCode).toBe(200);
    const pay = { personId: A, cashPlaceId: BDO, amountCents: 6_000_000, classification: 'subscription_payment' };
    expect((await postOwn(accountant, pay)).json().details[0].code).toBe('OVER_SUBSCRIPTION');
    const res = await postOwn(accountant, { ...pay, amountCents: 3_000_000 });
    expect(journalOf(res.json().id)).toEqual([
      ['1111', null, null, 3_000_000, 0],
      ['3103', 'stockholder', A, 0, 3_000_000],
    ]);
    expect(balances(env.db)).toEqual({ '1111': 3_000_000, '3103': 2_000_000, '3102': -5_000_000 });
    noBrokenInvariants();
  });

  it('deposits for future subscription go to 3105 (FRB 6 met) or 2502', async () => {
    const eq = (await postOwn(accountant, { personId: A, cashPlaceId: BDO, amountCents: 123_456, classification: 'dffs_equity' })).json();
    const li = (await postOwn(accountant, { personId: A, cashPlaceId: GCASH, amountCents: 99, classification: 'dffs_liability' })).json();
    expect(journalOf(eq.id)).toEqual([['1111', null, null, 123_456, 0], ['3105', 'stockholder', A, 0, 123_456]]);
    expect(journalOf(li.id)).toEqual([['1121', null, null, 99, 0], ['2502', 'stockholder', A, 0, 99]]);
    noBrokenInvariants();
  });
});

describe('Owner money cancel and edit (NR-4)', () => {
  it('cancel posts a mirror dated today and nets to zero; encoders cannot cancel', async () => {
    const { id } = (await postOwn(encoder, { personId: A, cashPlaceId: BDO, amountCents: 10_000_000, classification: 'advance' })).json();
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    encoder = await env.as('encoder');
    expect((await encoder.post(`/api/docs/eq.owner_money/${id}/cancel`, { reason: 'Recorded in the wrong bank' }, idem())).statusCode).toBe(403);
    expect((await accountant.post(`/api/docs/eq.owner_money/${id}/cancel`, { reason: 'Recorded in the wrong bank' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    const rev = env.db.prepare(`SELECT business_date FROM journals WHERE posting_kind = 'reversal'`).pluck().get();
    expect(rev).toBe('2026-09-29');
    noBrokenInvariants();
  });

  it('the accountant reclassifies an advance by editing it (cancel + new number)', async () => {
    const first = (await postOwn(encoder, { personId: A, cashPlaceId: BDO, amountCents: 500_000, classification: 'advance' })).json();
    const r = await accountant.post(
      `/api/docs/eq.owner_money/${first.id}/reissue`,
      { input: { personId: A, cashPlaceId: BDO, amountCents: 500_000, classification: 'dffs_liability' }, expectedTotalCents: 500_000, reason: 'Classified per the board resolution' },
      idem(),
    );
    expect(r.json().number).toBe('OWN-000002');
    expect(balances(env.db)).toEqual({ '1111': 500_000, '2502': -500_000 });
    expect((await accountant.get(`/api/docs/eq.owner_money/${first.id}`)).json().header).toMatchObject({ status: 'cancelled', replacedById: r.json().id });
    noBrokenInvariants();
  });

  it('an advance the company already paid back in part cannot be cancelled first', async () => {
    const adv = (await postOwn(encoder, { personId: A, cashPlaceId: BDO, amountCents: 1_000_000, classification: 'advance' })).json();
    const back = (await postOfc(encoder, { personId: A, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 400_000, purpose: 'Part of the advance' })).json();
    const c = await accountant.post(`/api/docs/eq.owner_money/${adv.id}/cancel`, { reason: 'Recorded twice by mistake' }, idem());
    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ code: 'HAS_DEPENDENTS', details: [{ number: back.number }] });
    expect((await accountant.post(`/api/docs/eq.officer/${back.id}/cancel`, { reason: 'Recorded twice by mistake' }, idem())).statusCode).toBe(200);
    expect((await accountant.post(`/api/docs/eq.owner_money/${adv.id}/cancel`, { reason: 'Recorded twice by mistake' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });
});

describe('Officer money out and back (OFC-OUT, OFC-IN)', () => {
  it('officer takes 5,000.00 from the cash box and pays back 3,000.00 into GCash', async () => {
    const out = await postOfc(encoder, { personId: B, kind: 'taken', cashPlaceId: CASH, amountCents: 500_000, purpose: 'School fees' });
    expect(out.json()).toMatchObject({ number: 'OFC-000001', summary: 'This will record ₱5,000.00 from Cash on hand (main cash box) for Sample Officer B, who owes it to the company (School fees).' });
    expect(journalOf(out.json().id)).toEqual([['1220', 'officer', B, 500_000, 0], ['1101', null, null, 0, 500_000]]);
    const back = await postOfc(encoder, { personId: B, kind: 'returned', cashPlaceId: GCASH, amountCents: 300_000, purpose: 'Paid back in GCash' });
    expect(journalOf(back.json().id)).toEqual([['1121', null, null, 300_000, 0], ['1220', 'officer', B, 0, 300_000]]);
    expect(balances(env.db)).toEqual({ '1220': 200_000, '1101': -500_000, '1121': 300_000 });
    const over = await postOfc(encoder, { personId: B, kind: 'returned', cashPlaceId: CASH, amountCents: 200_001, purpose: 'Paid back in cash' });
    expect(over.json()).toMatchObject({ code: 'VALIDATION', message: 'Sample Officer B owes the company only ₱2,000.00. Record any extra as owner money.' });
    noBrokenInvariants();
  });

  it('the company pays back an advance, never more than it owes', async () => {
    await postOwn(encoder, { personId: A, cashPlaceId: BDO, amountCents: 1_000_000, classification: 'advance' });
    const over = await postOfc(encoder, { personId: A, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 1_000_001, purpose: 'Advance repaid' });
    expect(over.json().details[0].code).toBe('MORE_THAN_OWED');
    const r = await postOfc(encoder, { personId: A, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 400_000, purpose: 'Advance repaid' });
    expect(journalOf(r.json().id)).toEqual([['2501', 'officer', A, 400_000, 0], ['1111', null, null, 0, 400_000]]);
    expect(balances(env.db)).toEqual({ '1111': 600_000, '2501': -600_000 });
    expect((await postOfc(encoder, { personId: B, kind: 'repaid_to_officer', cashPlaceId: BDO, amountCents: 1, purpose: 'Advance repaid' })).statusCode).toBe(422);
    noBrokenInvariants();
  });

  it('cancel: money taken waits for its pay-backs to be cancelled first; mirrors net to zero', async () => {
    const out = (await postOfc(encoder, { personId: B, kind: 'taken', cashPlaceId: CASH, amountCents: 500_000, purpose: 'School fees' })).json();
    const back = (await postOfc(encoder, { personId: B, kind: 'returned', cashPlaceId: CASH, amountCents: 100_000, purpose: 'Paid back in cash' })).json();
    expect((await encoder.post(`/api/docs/eq.officer/${out.id}/cancel`, { reason: 'Wrong officer was picked' }, idem())).statusCode).toBe(403);
    const blocked = await accountant.post(`/api/docs/eq.officer/${out.id}/cancel`, { reason: 'Wrong officer was picked' }, idem());
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', details: [{ number: back.number }] });
    expect((await accountant.post(`/api/docs/eq.officer/${back.id}/cancel`, { reason: 'Wrong officer was picked' }, idem())).statusCode).toBe(200);
    expect((await accountant.post(`/api/docs/eq.officer/${out.id}/cancel`, { reason: 'Wrong officer was picked' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('shows the officer ledger with a running net, to accountants and owners only', async () => {
    await postOwn(encoder, { personId: A, cashPlaceId: BDO, amountCents: 1_000_000, classification: 'advance' });
    await postOfc(encoder, { personId: A, kind: 'taken', cashPlaceId: CASH, amountCents: 250_000, purpose: 'Personal groceries' });
    expect((await encoder.get(`/api/eq/people/${A}/ledger`)).statusCode).toBe(403);
    const l = (await accountant.get(`/api/eq/people/${A}/ledger`)).json();
    expect(l).toMatchObject({ dueFromCents: 250_000, dueToCents: 1_000_000, netCents: -750_000 });
    expect(l.lines.map((x: { documentNumber: string; accountCode: string; amountCents: number; netCents: number }) => [x.documentNumber, x.accountCode, x.amountCents, x.netCents])).toEqual([
      ['OWN-000001', '2501', -1_000_000, -1_000_000],
      ['OFC-000001', '1220', 250_000, -750_000],
    ]);
  });
});

describe('property tests (PLAN I1.3)', () => {
  const actor = () => ({
    userId: accountant.userId,
    permissions: new Set(['eq.own.create', 'eq.own.post', 'eq.own.cancel', 'eq.own.classify', 'eq.ofc.create', 'eq.ofc.post', 'eq.ofc.cancel']),
  });

  it('random owner money posts balanced, cancels to zero and reclassifies cleanly', () => {
    const e = { db: env.db, clock: env.clock };
    fc.assert(
      fc.property(fc.array(fc.tuple(ownerMoneyDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, then] of ops) {
          const p = postDocument(e, ownerMoneyDoc, actor(), { input, expectedTotalCents: input.amountCents });
          if (then === 'cancel') cancelDocument(e, ownerMoneyDoc, actor(), p.id, 'Recorded twice by mistake');
          if (then === 'reissue') {
            const { parValueCents: _, ...rest } = input;
            reissueDocument(e, ownerMoneyDoc, actor(), p.id, { input: { ...rest, classification: 'advance' }, expectedTotalCents: input.amountCents, reason: 'Back to an advance until classified' });
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it('random officer money either posts balanced or is refused with nothing written; nobody owes less than nothing', () => {
    const e = { db: env.db, clock: env.clock };
    postDocument(e, ownerMoneyDoc, actor(), { input: { personId: A, cashPlaceId: BDO, amountCents: 50_000_000, classification: 'advance' }, expectedTotalCents: 50_000_000 });
    fc.assert(
      fc.property(fc.array(fc.tuple(officerDoc.arbitrary(env.db), fc.boolean()), { minLength: 1, maxLength: 10 }), (ops) => {
        for (const [input, cancel] of ops) {
          const before = docCount();
          try {
            const p = postDocument(e, officerDoc, actor(), { input, expectedTotalCents: input.amountCents });
            if (cancel) cancelDocument(e, officerDoc, actor(), p.id, 'Recorded twice by mistake');
          } catch (err) {
            // Pay-backs larger than what is owed, or cancels waiting on a pay-back, are refused whole.
            expect(err).toBeInstanceOf(AppError);
            expect(['VALIDATION', 'HAS_DEPENDENTS']).toContain((err as AppError).code);
            if ((err as AppError).code === 'VALIDATION') expect(docCount()).toBe(before);
          }
          for (const p of listPeople(env.db)) {
            const b = officerBalances(env.db, p.id);
            expect(b.dueFromCents).toBeGreaterThanOrEqual(0);
            expect(b.dueToCents).toBeGreaterThanOrEqual(0);
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });
});
