/**
 * Loan forgiveness (LFGV-, the owner's decision of 6 Oct 2026): the lender forgives the rest of an instalment. Only the
 * principal posts (Dr the loan's liability / Cr gain on debt forgiveness); the interest closes the instalment unposted.
 * Golden lines, the interest-only case, refusals, cancel and edit, and a property test of the balances.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { loanDoc } from '../doctypes/loan.ts';
import { paymentDoc } from '../doctypes/payment.ts';
import { forgivenessDoc } from '../doctypes/forgiveness.ts';
import { listLoans, loanBalance } from '../loans.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
});

/** G-20: ₱500,000.00 at 12% a year, flat, 25 months: 25 × (₱20,000.00 principal + ₱5,000.00 interest), from 2026-10-28. */
const g20 = () => ({ lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 50_000_000, feeCents: 500_000, interestRateBp: 1200, termMonths: 25, schedule: 'flat' });
const borrow = async () => (await accountant.post('/api/docs/loan.loan/post', { input: g20(), expectedTotalCents: 50_000_000 }, idem())).json().id as string;
const pay = (input: object, cents: number) => encoder.post('/api/docs/loan.payment/post', { input, expectedTotalCents: cents }, idem());
const forgive = (c: Client, input: object, cents: number) => c.post('/api/docs/loan.forgiveness/post', { input, expectedTotalCents: cents }, idem());
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
const issueCodes = async (input: object) => ((await accountant.post('/api/docs/loan.forgiveness/preview', { input })).json().issues as { code: string }[]).map((i) => i.code);
const reason = 'The bank waived the rest (made up)';

/** [code, party type, debit, credit] per line of a document's journal of one kind. */
const journalOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as [string, string | null, number, number][];
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const lateNos = async () => ((await accountant.get('/api/loan/late')).json() as { instalmentNo: number }[]).map((l) => l.instalmentNo);
/** Weeks later: past instalment 1's due date (2026-10-28), signed in again. */
async function to2026_11_02() {
  env.clock.advance(35 * 86_400_000);
  [accountant, encoder] = [await env.as('accountant'), await env.as('encoder')];
}

describe('the gain account', () => {
  it('is in 7100 other income: credit-normal revenue, postable, not reserved, no party', () => {
    expect(env.db.prepare(`SELECT code, name, type, normal_side, party_type, is_header, is_postable, is_reserved, is_active FROM accounts WHERE role_key = 'GAIN_ON_DEBT_FORGIVENESS'`).get()).toEqual({
      code: '7104', name: 'Gain on debt forgiveness', type: 'revenue', normal_side: 'credit', party_type: null, is_header: 0, is_postable: 1, is_reserved: 0, is_active: 1,
    });
  });
});

describe('forgiving the rest of a short-paid instalment', () => {
  it('posts Dr loans payable / Cr gain for the unpaid principal only; the instalment leaves the late list', async () => {
    const loanId = await borrow();
    // Instalment 1 is ₱20,000 principal + ₱5,000 interest; ₱5,000 principal and the ₱5,000 interest are paid.
    const part = await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO, principalCents: 500_000, interestCents: 500_000, note: 'Paid part only' }, 1_000_000);
    expect(part.statusCode, part.body).toBe(200);
    await to2026_11_02();
    expect(await lateNos()).toEqual([1]);

    const f = await forgive(accountant, { loanId, instalmentNo: 1, reason, note: 'Letter from the bank on file' }, 1_500_000);
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json()).toMatchObject({ number: 'LFGV-000001', totalCents: 1_500_000 });
    expect(f.json().summary).toBe(`This will record that Sample Bank forgave the rest of instalment 1 of 25 on LOAN-000001: ₱15,000.00, ₱15,000.00 principal booked as a gain and ₱0.00 interest. Reason: ${reason}`);
    const lines = journalOf(f.json().id);
    expect(lines).toEqual([['2601', 'loan', 1_500_000, 0], ['7104', null, 0, 1_500_000]]);
    expect(lines.reduce((s, l) => s + l[2] - l[3], 0)).toBe(0);
    expect(balances(env.db)).toEqual({ '1111': 48_500_000, '7201': 1_000_000, '2601': -48_000_000, '7104': -1_500_000 });

    expect(await lateNos()).toEqual([]);
    const ledger = (await accountant.get(`/api/loan/loans/${loanId}`)).json();
    expect(ledger.schedule[0]).toMatchObject({ instalmentNo: 1, paidBy: 'LFGV-000001', forgivenBy: 'LFGV-000001', forgivenPrincipalCents: 1_500_000, forgivenInterestCents: 0, remainingPrincipalCents: 0, remainingInterestCents: 0 });
    expect(ledger.ledger.at(-1)).toMatchObject({ documentNumber: 'LFGV-000001', amountCents: -1_500_000, balanceCents: 48_000_000 });
    const reg = (await encoder.get('/api/loan/loans')).json()[0];
    expect(reg).toMatchObject({ principalPaidCents: 500_000, principalForgivenCents: 1_500_000, interestForgivenCents: 0, balanceCents: 48_000_000 });
    expect(reg.nextDue).toEqual({ instalmentNo: 2, dueDate: '2026-11-28', principalCents: 2_000_000, interestCents: 500_000 });
    expect(loanBalance(env.db, loanId, 'loan')).toBe(48_000_000);
    // The payment form refuses it now, and the next payment is instalment 2.
    expect((await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO }, 1_500_000)).json().details[0]).toMatchObject({ code: 'PAID', message: 'The rest of instalment 1 of LOAN-000001 was forgiven by LFGV-000001; nothing is due on it.' });
    expect((await pay({ loanId, instalmentNo: 2, cashPlaceId: BDO }, 2_500_000)).statusCode).toBe(200);
    expect((await accountant.get(`/api/docs/loan.forgiveness/${f.json().id}`)).json().input).toEqual({ loanId, instalmentNo: 1, reason, note: 'Letter from the bank on file' });
    noBrokenInvariants();
  });

  it('interest still due is not posted, but the instalment closes', async () => {
    const loanId = await borrow();
    // All the principal paid, none of the ₱5,000 interest: only interest is left.
    await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO, principalCents: 2_000_000, interestCents: 0, note: 'Principal only' }, 2_000_000);
    const before = balances(env.db);
    const f = await forgive(accountant, { loanId, instalmentNo: 1, reason }, 500_000);
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json()).toMatchObject({ totalCents: 500_000, journalNumber: null });
    expect(f.json().summary).toContain('The ₱5,000.00 interest was never expensed, so it posts nothing; it closes the instalment.');
    expect(journalOf(f.json().id)).toEqual([]);
    expect(balances(env.db)).toEqual(before);
    expect((await accountant.get(`/api/loan/loans/${loanId}`)).json().schedule[0]).toMatchObject({ paidBy: 'LFGV-000001', forgivenPrincipalCents: 0, forgivenInterestCents: 500_000 });
    expect((await encoder.get('/api/loan/loans')).json()[0]).toMatchObject({ interestForgivenCents: 500_000, nextDue: { instalmentNo: 2 } });
    await to2026_11_02();
    expect(await lateNos()).toEqual([]);

    // Both left: only the principal posts; the interest stays out of 7201 and 7104.
    await pay({ loanId, instalmentNo: 2, cashPlaceId: BDO, principalCents: 1_000_000, interestCents: 0, note: 'Part' }, 1_000_000);
    const both = await forgive(accountant, { loanId, instalmentNo: 2, reason }, 1_500_000);
    expect(both.statusCode, both.body).toBe(200);
    expect(journalOf(both.json().id)).toEqual([['2601', 'loan', 1_000_000, 0], ['7104', null, 0, 1_000_000]]);
    expect(balances(env.db)).toMatchObject({ '7201': 500_000, '7104': -1_000_000, '2601': -46_000_000 });
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('refused when paid in full, already forgiven, nothing is due, an earlier instalment is still due, or the loan is cancelled', async () => {
    const loanId = await borrow();
    expect(await issueCodes({ loanId, instalmentNo: 2, reason })).toEqual(['NOT_NEXT']);
    expect((await forgive(accountant, { loanId, instalmentNo: 2, reason }, 2_500_000)).json().details[0]).toMatchObject({
      code: 'NOT_NEXT', message: 'Instalment 1 of LOAN-000001 is still due first (₱25,000.00). Pay or forgive it before this one.',
    });
    expect(await issueCodes({ loanId, instalmentNo: 26, reason })).toEqual(['INSTALMENT']);
    await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000);
    expect((await forgive(accountant, { loanId, instalmentNo: 1, reason }, 0)).json().details[0]).toMatchObject({ code: 'PAID', message: 'Instalment 1 of LOAN-000001 is already paid in full by LPAY-000001.' });

    await pay({ loanId, instalmentNo: 2, cashPlaceId: BDO, principalCents: 2_000_000, interestCents: 0, note: 'Interest later' }, 2_000_000);
    expect((await forgive(accountant, { loanId, instalmentNo: 2, reason }, 500_000)).statusCode).toBe(200);
    expect((await forgive(accountant, { loanId, instalmentNo: 2, reason }, 500_000)).json().details[0]).toMatchObject({ code: 'PAID', message: 'The rest of instalment 2 of LOAN-000001 is already forgiven by LFGV-000001.' });

    // Paid off early: the later instalments are not settled, but nothing is owed on them.
    await pay({ loanId, instalmentNo: 3, cashPlaceId: BDO, principalCents: 46_000_000, note: 'Paying it all off' }, 46_500_000);
    expect((await forgive(accountant, { loanId, instalmentNo: 4, reason }, 2_500_000)).json().details[0].code).toBe('NOTHING_DUE');
    noBrokenInvariants();
  });

  it('refused on a cancelled loan, with a short reason, and without loan.forgive', async () => {
    const loanId = await borrow();
    expect((await forgive(encoder, { loanId, instalmentNo: 1, reason }, 2_500_000)).statusCode).toBe(403);
    for (const role of ['production', 'tv'] as const) expect((await forgive(await env.as(role), { loanId, instalmentNo: 1, reason }, 2_500_000)).statusCode, role).toBe(403);
    expect((await forgive(accountant, { loanId, instalmentNo: 1, reason: 'Waived' }, 2_500_000)).statusCode).toBe(400);
    expect((await forgive(accountant, { loanId, instalmentNo: 1, reason: 'x'.repeat(201) }, 2_500_000)).statusCode).toBe(400);
    await cancel('loan.loan', loanId);
    expect((await forgive(accountant, { loanId, instalmentNo: 1, reason }, 2_500_000)).json().details).toEqual([
      expect.objectContaining({ code: 'LOAN_CANCELLED', message: 'LOAN-000001 was cancelled. Forgive instalments only on a loan that stands.' }),
    ]);
    expect(balances(env.db)).toEqual({});
  });

  it('loan.forgive goes to the accountant and the owner, and to the encoder as accountant access', async () => {
    const fresh = await createTestEnv();
    const grants = fresh.db.prepare(`SELECT role_key FROM role_permissions WHERE permission_key = 'loan.forgive' AND granted = 1 ORDER BY role_key`).pluck().all();
    expect(grants).toEqual(['accountant', 'encoder', 'owner']);
    const owner = await fresh.as('owner');
    const loan = await owner.post('/api/docs/loan.loan/post', { input: { ...g20(), cashPlaceId: cashPlaceId(fresh.db, '1111') }, expectedTotalCents: 50_000_000 }, idem());
    expect((await owner.post('/api/docs/loan.forgiveness/post', { input: { loanId: loan.json().id, instalmentNo: 1, reason }, expectedTotalCents: 2_500_000 }, idem())).statusCode).toBe(200);
  });
});

describe('cancel and edit', () => {
  it('cancelling reopens the instalment and reverses the journal; its payment and loan cancel only after it', async () => {
    const loanId = await borrow();
    const part = (await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO, principalCents: 500_000, interestCents: 500_000, note: 'Paid part only' }, 1_000_000)).json();
    await to2026_11_02();
    const f = (await forgive(accountant, { loanId, instalmentNo: 1, reason }, 1_500_000)).json();
    expect((await cancel('loan.payment', part.id)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: LFGV-000001.' });
    expect((await cancel('loan.loan', loanId)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: LPAY-000001, LFGV-000001.' });
    expect((await encoder.post(`/api/docs/loan.forgiveness/${f.id}/cancel`, { reason: 'Recorded by mistake today' }, idem())).statusCode).toBe(403);

    expect((await cancel('loan.forgiveness', f.id)).statusCode).toBe(200);
    expect(journalOf(f.id, 'reversal')).toEqual([['2601', 'loan', 0, 1_500_000], ['7104', null, 1_500_000, 0]]);
    expect(balances(env.db)).toEqual({ '1111': 48_500_000, '7201': 1_000_000, '2601': -49_500_000 });
    expect((await accountant.get(`/api/loan/loans/${loanId}`)).json().schedule[0]).toMatchObject({ paidBy: null, remainingPrincipalCents: 1_500_000, remainingInterestCents: 0 });
    expect((await accountant.get(`/api/loan/loans/${loanId}`)).json().schedule[0].forgivenBy).toBeUndefined();
    expect(await lateNos()).toEqual([1]);
    expect((await encoder.get('/api/loan/loans')).json()[0]).toMatchObject({ principalForgivenCents: 0, nextDue: { instalmentNo: 1, principalCents: 1_500_000 } });
    // Paid after all.
    expect((await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO }, 1_500_000)).statusCode).toBe(200);
    expect(await lateNos()).toEqual([]);
    noBrokenInvariants();
  });

  it('an edit (cancel + new number) forgives the same rest again with the new reason', async () => {
    const loanId = await borrow();
    await pay({ loanId, instalmentNo: 1, cashPlaceId: BDO, principalCents: 1_000_000, interestCents: 500_000, note: 'Part' }, 1_500_000);
    const f = (await forgive(accountant, { loanId, instalmentNo: 1, reason }, 1_000_000)).json();
    const input = { loanId, instalmentNo: 1, reason: 'The bank waived it by letter (made up)' };
    expect((await accountant.post('/api/docs/loan.forgiveness/preview', { input })).json().totalCents).toBe(1_000_000);
    const r = await accountant.post(`/api/docs/loan.forgiveness/${f.id}/reissue`, { input, expectedTotalCents: 1_000_000, reason: 'Wrong reason typed' }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().number).toBe('LFGV-000002');
    expect(journalOf(r.json().id)).toEqual([['2601', 'loan', 1_000_000, 0], ['7104', null, 0, 1_000_000]]);
    expect(balances(env.db)).toMatchObject({ '2601': -48_000_000, '7104': -1_000_000 });
    noBrokenInvariants();
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random payments and forgivenesses, some cancelled: balance = principal − paid − forgiven, gains = forgiven principal, invariants hold', () => {
    const perms = ['loan.in.create', 'loan.in.post', 'loan.pay.create', 'loan.pay.post', 'loan.pay.cancel', 'loan.forgive'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const ctx = () => ({ db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: actor.userId, can: (p: string) => actor.permissions.has(p) });
    const e = { db: env.db, clock: env.clock };
    for (const input of [g20(), { ...g20(), kind: 'equipment', schedule: 'declining', principalCents: 1_000_000, feeCents: 0, termMonths: 3 }]) {
      postDocument(e, loanDoc, actor, { input, expectedTotalCents: input.principalCents });
    }
    const docCount = () => env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get() as number;
    const op = fc.oneof(
      fc.tuple(fc.constant(paymentDoc), paymentDoc.arbitrary(env.db), fc.boolean()),
      fc.tuple(fc.constant(forgivenessDoc), forgivenessDoc.arbitrary(env.db), fc.boolean()),
    );
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 12 }), (ops) => {
        for (const [def, input, cancelIt] of ops) {
          const before = docCount();
          try {
            const p = postDocument(e, def, actor, { input, expectedTotalCents: def.compute(input as never, ctx()).totalCents });
            if (cancelIt) cancelDocument(e, def, actor, p.id, 'Recorded twice by mistake');
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect(['VALIDATION', 'HAS_DEPENDENTS']).toContain((err as AppError).code);
            if ((err as AppError).code === 'VALIDATION') expect(docCount()).toBe(before);
          }
        }
        let fees = 0, interest = 0, forgiven = 0;
        for (const l of listLoans(env.db, 'posted')) {
          expect(l.balanceCents).toBe(l.principalCents - l.principalPaidCents - l.principalForgivenCents);
          expect(l.balanceCents).toBeGreaterThanOrEqual(0);
          expect(loanBalance(env.db, l.id, l.kind)).toBe(l.balanceCents);
          fees += l.feeCents;
          interest += l.interestPaidCents;
          forgiven += l.principalForgivenCents;
        }
        const b = balances(env.db);
        expect(b['7201'] ?? 0).toBe(fees + interest); // forgiven interest is never expensed
        expect(0 - (b['7104'] ?? 0)).toBe(forgiven);
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });
});
