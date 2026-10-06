/**
 * Bank adjustment (D5 BANK-ADJ) goldens and cancels, and the bank reconciliation (E10) to a zero difference.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { bankAdjustmentDoc } from '../doctypes/bank-adjustment.ts';

let env: TestEnv;
let accountant: Client, owner: Client, encoder: Client;
let BDO: number, CBC: number, CASH: number;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  BDO = cashPlaceId(env.db, '1111');
  CBC = cashPlaceId(env.db, '1112');
  CASH = cashPlaceId(env.db, '1101');
});

const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const adjust = (c: Client, input: object, cents: number) => c.post('/api/docs/cash.bank_adj/post', { input, expectedTotalCents: cents }, idem());
const linesOf = (docId: string) =>
  env.db.prepare(`SELECT a.code, l.debit_cents AS d, l.credit_cents AS c FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`).all(docId);
const charge150 = () => ({ cashPlaceId: BDO, kind: 'charge', amountCents: 15_000, description: 'Service charge, below maintaining balance' });
const interest1000 = () => ({ cashPlaceId: BDO, kind: 'interest', amountCents: 100_000, description: 'Interest for September' });

describe('Bank adjustment goldens (D5 BANK-ADJ)', () => {
  it('a bank charge of 150.00: Dr 6230 150.00 / Cr 1111 150.00, and its cancel', async () => {
    const r = await adjust(accountant, charge150(), 15_000);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ number: 'BADJ-000001', summary: 'This will record a bank charge of ₱150.00 on Cash in bank – BDO: Service charge, below maintaining balance.' });
    expect(linesOf(r.json().id)).toEqual([{ code: '6230', d: 15_000, c: 0 }, { code: '1111', d: 0, c: 15_000 }]);
    expect((await accountant.post(`/api/docs/cash.bank_adj/${r.json().id}/cancel`, { reason: 'Charge was reversed by the bank' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('interest of 1,000.00 gross: Dr 1111 800.00, Dr 8103 200.00 / Cr 7101 1,000.00, and its cancel', async () => {
    const r = await adjust(owner, interest1000(), 100_000);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().summary).toBe('This will record interest of ₱1,000.00 on Cash in bank – BDO: ₱800.00 credited after ₱200.00 final tax (20%).');
    expect(linesOf(r.json().id)).toEqual([{ code: '1111', d: 80_000, c: 0 }, { code: '8103', d: 20_000, c: 0 }, { code: '7101', d: 0, c: 100_000 }]);
    expect((await owner.post(`/api/docs/cash.bank_adj/${r.json().id}/cancel`, { reason: 'Recorded on the wrong bank' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('reads the final tax rate on the document date, and takes banks only, from accountants and owners', async () => {
    env.db.prepare(`INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES ('tax.interest_final_tax_bp', '2026-09-29', '1000', 'Test of a rate change', '2026-09-28T10:00:00.000+08:00')`).run();
    expect((await accountant.post('/api/docs/cash.bank_adj/preview', { input: interest1000() })).json().doc).toMatchObject({ finalTaxBp: 2000, finalTaxCents: 20_000 });
    expect((await adjust(encoder, charge150(), 15_000)).statusCode).toBe(403);
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    expect((await accountant.post('/api/docs/cash.bank_adj/preview', { input: interest1000() })).json().doc).toMatchObject({ finalTaxBp: 1000, finalTaxCents: 10_000, netCents: 90_000 });
    expect((await adjust(accountant, { ...charge150(), cashPlaceId: CASH }, 15_000)).json().code).toBe('VALIDATION');
    expect((await adjust(accountant, { ...charge150(), finalTaxCents: 0 }, 15_000)).statusCode).toBe(400);
  });
});

describe('Bank reconciliation (E10)', () => {
  const trf = (from: number, to: number, cents: number) =>
    accountant.post('/api/docs/cash.transfer/post', { input: { fromCashPlaceId: from, toCashPlaceId: to, amountSentCents: cents, amountReceivedCents: cents }, expectedTotalCents: cents }, idem());
  type Report = { id: string; status: string; statementLines: { id: number; description: string; matchNo: number | null }[]; bookLines: { journalLineId: number; documentNumber: string; amountCents: number; state: string }[] } & Record<string, unknown>;
  const get = async (id: string) => (await accountant.get(`/api/cash/recons/${id}`)).json() as Report;
  const stmt = (rep: Report, text: string) => rep.statementLines.find((l) => l.description.startsWith(text))!.id;
  const book = (rep: Report, number: string, sign = 1) => rep.bookLines.find((l) => l.documentNumber === number && Math.sign(l.amountCents) === sign)!.journalLineId;
  const csv = 'Date,Description,Amount\n2026-09-28,Deposit,"50,000.00"\n2026-09-28,Service charge,-150.00\r\n2026-09-28,"Interest, net of tax",800.00\n';

  it('matches, turns the charge and the interest into bank adjustments, and finishes at difference 0', async () => {
    await trf(CASH, BDO, 5_000_000); // TRF-000001: cleared by the deposit line
    await trf(BDO, CBC, 1_000_000); // TRF-000002: not on the statement yet (outstanding)
    const created = await accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 5_065_000 });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().id as string;
    let rep = (await accountant.post(`/api/cash/recons/${id}/lines`, { csv })).json() as Report;
    expect(rep.statementLines.map((l) => l.description)).toEqual(['Deposit', 'Service charge', 'Interest, net of tax']);

    const m = await accountant.post(`/api/cash/recons/${id}/match`, { statementLineIds: [stmt(rep, 'Deposit')], journalLineIds: [book(rep, 'TRF-000001')] });
    expect(m.statusCode, m.body).toBe(200);
    expect((await accountant.post(`/api/cash/recons/${id}/finish`)).json().code).toBe('UNMATCHED');

    const adj = (lineId: number, input: object, cents: number) => accountant.post(`/api/cash/recons/${id}/adjust`, { statementLineIds: [lineId], input, expectedTotalCents: cents }, idem());
    const c = await adj(stmt(rep, 'Service'), charge150(), 15_000);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json()).toMatchObject({ number: 'BADJ-000001', matchNo: 2 });
    // Interest typed at 900.00 gross nets 720.00, not the 800.00 on the statement: nothing is recorded.
    const wrong = await adj(stmt(rep, 'Interest'), { ...interest1000(), amountCents: 90_000 }, 90_000);
    expect(wrong.json().code).toBe('TOTALS_DIFFER');
    expect((await adj(stmt(rep, 'Interest'), interest1000(), 100_000)).json().number).toBe('BADJ-000002');

    rep = await get(id);
    expect(rep).toMatchObject({
      bookBalanceCents: 4_065_000, depositsInTransitCents: 0, outstandingPaymentsCents: -1_000_000, recordedAfterMonthCents: 0,
      adjustedBookCents: 5_065_000, bankBalanceCents: 5_065_000, unmatchedStatementCount: 0, differenceCents: 0,
    });
    expect(rep.bookLines.filter((l) => l.state === 'outstanding').map((l) => l.documentNumber)).toEqual(['TRF-000002']);
    const done = await accountant.post(`/api/cash/recons/${id}/finish`);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().status).toBe('finished');

    // Locked: no new lines, no cancel of a matched adjustment, not even straight in the database.
    expect((await accountant.post(`/api/cash/recons/${id}/lines`, { csv })).json().code).toBe('LOCKED');
    expect((await accountant.post(`/api/docs/cash.bank_adj/${c.json().id}/cancel`, { reason: 'Trying to undo the charge' }, idem())).json().code).toBe('RECONCILED');
    expect(() => env.db.prepare(`UPDATE cash_recon_cleared SET active = 0 WHERE recon_id = ?`).run(id)).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare(`UPDATE cash_recons SET ending_balance_cents = 1 WHERE id = ?`).run(id)).toThrow(/LOCKED/);

    // Reopening is the accountant's, with a reason.
    expect((await owner.post(`/api/cash/recons/${id}/reopen`, { reason: 'The bank sent a corrected statement' })).statusCode).toBe(403);
    expect((await accountant.post(`/api/cash/recons/${id}/reopen`, { reason: 'short' })).statusCode).toBe(400);
    const again = await accountant.post(`/api/cash/recons/${id}/reopen`, { reason: 'The bank sent a corrected statement' });
    expect(again.json()).toMatchObject({ status: 'open', reopenReason: 'The bank sent a corrected statement', differenceCents: 0 });
    expect(balances(env.db)).toEqual({ '1101': -5_000_000, '1111': 4_065_000, '1112': 1_000_000, '6230': 15_000, '8103': 20_000, '7101': -100_000 });
    noBrokenInvariants();
  });

  it('counts an adjustment made after the month as recorded after it, and keeps the finished month fixed', async () => {
    await trf(CASH, BDO, 100_000);
    const id = (await accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 85_000 })).json().id;
    let rep = (await accountant.post(`/api/cash/recons/${id}/lines`, { lines: [{ date: '2026-09-28', description: 'Deposit', amountCents: 100_000 }, { date: '2026-09-30', description: 'Checkbook', amountCents: -15_000 }] })).json() as Report;
    await accountant.post(`/api/cash/recons/${id}/match`, { statementLineIds: [stmt(rep, 'Deposit')], journalLineIds: [book(rep, 'TRF-000001')] });
    env.clock.advance(4 * 24 * 3600_000); // 2026-10-02: the September statement is reconciled in October
    accountant = await env.as('accountant');
    const c = await accountant.post(`/api/cash/recons/${id}/adjust`, { statementLineIds: [stmt(rep, 'Checkbook')], input: { ...charge150(), description: 'Checkbook' }, expectedTotalCents: 15_000 }, idem());
    expect(c.json().businessDate).toBe('2026-10-02');
    rep = (await accountant.post(`/api/cash/recons/${id}/finish`)).json();
    expect(rep).toMatchObject({ status: 'finished', bookBalanceCents: 100_000, recordedAfterMonthCents: -15_000, adjustedBookCents: 85_000, differenceCents: 0 });
    await trf(BDO, CBC, 5_000); // an October payment leaves September as it was
    expect(await get(id)).toMatchObject({ bookBalanceCents: 100_000, differenceCents: 0 });
    expect((await get(id)).bookLines.map((l) => l.state)).toEqual(['cleared', 'cleared']);
    const oct = await accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-10', endingBalanceCents: 85_000 });
    expect(oct.json()).toMatchObject({ bookBalanceCents: 80_000, outstandingPaymentsCents: -5_000, differenceCents: 0 });
    expect((await accountant.post(`/api/cash/recons/${id}/reopen`, { reason: 'The bank sent a corrected statement' })).json().code).toBe('LATER_MONTH');
  });

  it('CASH-1: the accountant dates a charge seen in October on its statement day in September; others may not backdate', async () => {
    await trf(CASH, BDO, 100_000);
    const id = (await accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 85_000 })).json().id;
    const rep = (await accountant.post(`/api/cash/recons/${id}/lines`, { lines: [{ date: '2026-09-28', description: 'Deposit', amountCents: 100_000 }, { date: '2026-09-30', description: 'Checkbook', amountCents: -15_000 }] })).json() as Report;
    await accountant.post(`/api/cash/recons/${id}/match`, { statementLineIds: [stmt(rep, 'Deposit')], journalLineIds: [book(rep, 'TRF-000001')] });
    env.clock.advance(4 * 24 * 3600_000); // 2026-10-02
    accountant = await env.as('accountant');
    const adjust = (who: Client) =>
      who.post(`/api/cash/recons/${id}/adjust`, { statementLineIds: [stmt(rep, 'Checkbook')], input: { ...charge150(), description: 'Checkbook' }, expectedTotalCents: 15_000, businessDate: '2026-09-30' }, idem());
    expect((await adjust(await env.as('owner'))).statusCode).toBe(403); // acc.backdate is the accountant's
    const c = await adjust(accountant);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().businessDate).toBe('2026-09-30');
    expect(env.db.prepare("SELECT business_date FROM journals WHERE source_type = 'document' AND source_id = ?").pluck().all(c.json().id)).toEqual(['2026-09-30']);
    expect((await accountant.post(`/api/cash/recons/${id}/finish`)).json()).toMatchObject({ status: 'finished', bookBalanceCents: 85_000, recordedAfterMonthCents: 0, differenceCents: 0 });
    noBrokenInvariants();
  });

  it('matches only equal totals, clears a cancelled entry against its mirror, unmatches and voids', async () => {
    const t = (await trf(CASH, BDO, 20_000)).json();
    await accountant.post(`/api/docs/cash.transfer/${t.id}/cancel`, { reason: 'Deposit slip was never used' }, idem());
    await trf(BDO, CASH, 5_000); // TRF-000002
    const id = (await accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: -5_000 })).json().id;
    let rep = (await accountant.post(`/api/cash/recons/${id}/lines`, { lines: [{ date: '2026-09-28', description: 'Withdrawal', amountCents: -5_000 }, { date: '2026-09-28', description: 'Typo', amountCents: 1 }] })).json() as Report;
    const match = (body: object) => accountant.post(`/api/cash/recons/${id}/match`, body);
    expect((await match({ statementLineIds: [stmt(rep, 'Withdrawal')], journalLineIds: [book(rep, 'TRF-000001')] })).json().code).toBe('TOTALS_DIFFER');
    const cashLine = env.db.prepare(`SELECT l.id FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1101' LIMIT 1`).pluck().get();
    expect((await match({ statementLineIds: [], journalLineIds: [cashLine] })).json().code).toBe('LINE_TAKEN');
    expect((await match({ statementLineIds: [], journalLineIds: [book(rep, 'TRF-000001'), book(rep, 'TRF-000001', -1)] })).statusCode).toBe(200);
    rep = (await match({ statementLineIds: [stmt(rep, 'Withdrawal')], journalLineIds: [book(rep, 'TRF-000002', -1)] })).json();
    expect((await accountant.post(`/api/cash/recons/${id}/unmatch`, { matchNo: 2 })).json().unmatchedStatementCount).toBe(2);
    rep = (await match({ statementLineIds: [stmt(rep, 'Withdrawal')], journalLineIds: [book(rep, 'TRF-000002', -1)] })).json();
    expect(rep.differenceCents).toBe(0);
    expect((await accountant.post(`/api/cash/recons/${id}/finish`)).json().code).toBe('UNMATCHED'); // the 0.01 typo
    rep = (await accountant.post(`/api/cash/recons/${id}/lines/${stmt(rep, 'Typo')}/void`)).json();
    expect((await accountant.post(`/api/cash/recons/${id}/finish`)).statusCode).toBe(200);
    noBrokenInvariants();
  });

  it('checks the bank, the month order, the CSV and who may see it', async () => {
    const make = (body: object) => accountant.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 0, ...body });
    expect((await make({ bankId: CASH })).json().code).toBe('NOT_A_BANK');
    expect((await make({ month: '2026-10' })).json().code).toBe('FUTURE_MONTH');
    const id = (await make({})).json().id;
    expect((await make({ month: '2026-08' })).json().code).toBe('MONTH_TAKEN');
    const lines = (csv: string) => accountant.post(`/api/cash/recons/${id}/lines`, { csv });
    expect((await lines('2026-09-05,Deposit,12,500.00')).json().message).toMatch(/Line 1 has an amount with a comma/);
    expect((await lines('2026-09-05,Deposit,abc')).json().code).toBe('BAD_CSV');
    expect((await lines('2026-08-31,Deposit,100.00')).json().code).toBe('OUTSIDE_MONTH');
    expect((await accountant.put(`/api/cash/recons/${id}`, { endingBalanceCents: 12_345 })).json().bankBalanceCents).toBe(12_345);
    expect((await encoder.get('/api/cash/recons')).statusCode).toBe(403);
    expect((await encoder.post('/api/cash/recons', { bankId: BDO, month: '2026-09', endingBalanceCents: 0 })).statusCode).toBe(403);
    expect((await owner.get('/api/cash/recons')).json()).toHaveLength(1);
    // Given the view permission, an encoder still sees only the banks whose balance they see (OWN-27).
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.post('/api/roles/encoder/permissions', { permissionKey: 'cash.recon.view', granted: true })).statusCode).toBe(200);
    expect((await encoder.get('/api/cash/recons')).json()).toEqual([]);
    expect((await encoder.get(`/api/cash/recons/${id}`)).statusCode).toBe(403);
    expect((await accountant.post(`/api/cash/recons/${id}/adjust`, { statementLineIds: [1], input: charge150(), expectedTotalCents: 15_000 })).json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random bank adjustments post balanced, store what was computed, and cancel or reissue cleanly', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['cash.badj.create', 'cash.badj.post', 'cash.badj.cancel']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = { db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: actor.userId, can: (p: string) => actor.permissions.has(p) };
    fc.assert(
      fc.property(fc.array(fc.tuple(bankAdjustmentDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, then] of ops) {
          const computed = bankAdjustmentDoc.compute(input, ctx);
          expect(computed.netCents + computed.finalTaxCents).toBe(computed.amountCents);
          const p = postDocument(e, bankAdjustmentDoc, actor, { input, expectedTotalCents: computed.totalCents });
          expect(bankAdjustmentDoc.load(env.db, p.id)).toEqual(computed);
          if (then === 'cancel') cancelDocument(e, bankAdjustmentDoc, actor, p.id, 'Recorded twice by mistake');
          if (then === 'reissue') reissueDocument(e, bankAdjustmentDoc, actor, p.id, { input: { ...input, description: 'Corrected' }, expectedTotalCents: computed.totalCents, reason: 'Corrected the description' });
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });
});
