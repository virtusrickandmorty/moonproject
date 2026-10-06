/**
 * Opening loans (OBLN-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): goldens for a generated and a typed schedule, the first
 * payment after the cut-over, a cancel landing on the cut-over date, the refusals, and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { openingLoanDoc, type OpeningLoanInput } from '../doctypes/opening.ts';
import { paymentDoc } from '../doctypes/payment.ts';
import { listLoans } from '../loans.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let BDO: number;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  BDO = cashPlaceId(env.db, '1111');
});

const setCutover = async (date = CUTOVER) => {
  await accountant.post('/api/auth/step-up', { password: PASSWORD });
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
/** ₱1,000,000.00 received 2025-10-15 at 12%; ₱738,900.00 still owed at the cut-over, 13 equal payments of ₱60,896.31 left. */
const bank = (more: Partial<OpeningLoanInput> = {}) =>
  ({ lender: 'Sample Bank', kind: 'loan', originalPrincipalCents: 100_000_000, dateReceived: '2025-10-15', principalCents: 73_890_000, interestRateBp: 1200, monthsLeft: 13, schedule: 'declining', nextDueDate: '2026-10-15', reference: 'PN 2025-014', ...more }) as OpeningLoanInput;
const open = (input: OpeningLoanInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/loan.opening/post', { input, expectedTotalCents: input.principalCents, ...(businessDate ? { businessDate } : {}) }, idem());
const issues = async (input: object, businessDate: string | null = CUTOVER, level = 'error') => {
  const r = await accountant.post('/api/docs/loan.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
  return (r.json().issues as { code: string; level: string }[]).filter((i) => i.level === level).map((i) => i.code);
};
const pay = (loanId: string, instalmentNo: number, cents: number) => encoder.post('/api/docs/loan.payment/post', { input: { loanId, instalmentNo, cashPlaceId: BDO }, expectedTotalCents: cents }, idem());
const cancel = (type: string, id: string) => accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id AS party, l.debit_cents AS dr, l.credit_cents AS cr, j.business_date AS date
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .all(documentId, kind);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('Opening loan goldens', () => {
  it('generated schedule: Dr 3900 / Cr 2601 on the cut-over date; in the register with its original principal and date', async () => {
    await setCutover();
    const pre = await accountant.post('/api/docs/loan.opening/preview', { input: bank(), businessDate: CUTOVER });
    expect(pre.json().summary).toBe(
      'This will open a loan of ₱1,000,000.00 from Sample Bank, received on 2025-10-15, with ₱738,900.00 of principal still owed on 2026-09-27, repaid in 13 more instalments from 2026-10-15 (the next is ₱60,896.31).',
    );
    const res = await open(bank());
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json().id;
    expect(res.json()).toMatchObject({ number: 'OBLN-000001', businessDate: CUTOVER, totalCents: 73_890_000 });
    expect(journalOf(id)).toEqual([
      { code: '3900', party: null, dr: 73_890_000, cr: 0, date: CUTOVER },
      { code: '2601', party: id, dr: 0, cr: 73_890_000, date: CUTOVER },
    ]);
    expect(balances(env.db)).toEqual({ '2601': -73_890_000, '3900': 73_890_000 });
    expect((await encoder.get('/api/loan/loans')).json()).toEqual([
      expect.objectContaining({
        number: 'OBLN-000001', status: 'posted', dateReceived: '2025-10-15', lender: 'Sample Bank', kind: 'loan', principalCents: 100_000_000, owedAtCutoverCents: 73_890_000,
        principalPaidCents: 26_110_000, interestPaidCents: 0, balanceCents: 73_890_000, instalments: 13, termMonths: 13, feeCents: 0,
        nextDue: { instalmentNo: 1, dueDate: '2026-10-15', principalCents: 5_350_731, interestCents: 738_900 },
      }),
    ]);
    const { schedule } = (await accountant.get(`/api/loan/loans/${id}`)).json();
    expect(schedule.at(-1)).toEqual({ instalmentNo: 13, dueDate: '2027-10-15', principalCents: 6_029_338, interestCents: 60_293, paidBy: null,
      paidPrincipalCents: 0, paidInterestCents: 0, remainingPrincipalCents: 6_029_338, remainingInterestCents: 60_293 });
    expect((await accountant.get(`/api/docs/loan.opening/${id}`)).json().input).toEqual(bank());
    const acc = (await owner.get('/api/acc/opening')).json();
    expect(acc.documents).toMatchObject([{ docType: 'loan.opening', number: 'OBLN-000001', businessDate: CUTOVER, status: 'posted' }]);
    expect(acc.checks.find((c: { code: string }) => c.code === '2601')).toMatchObject({ controlCents: -73_890_000, partiesCents: -73_890_000, ok: true });
    noBrokenInvariants();
  });

  it('typed schedule: equipment financing credits 2602; an edit replaces it on the cut-over date', async () => {
    await setCutover();
    const rows = [
      { dueDate: '2026-10-01', principalCents: 4_000_000, interestCents: 160_000 },
      { dueDate: '2026-11-01', principalCents: 4_000_000, interestCents: 120_000 },
      { dueDate: '2026-12-01', principalCents: 4_000_000, interestCents: 80_000 },
      { dueDate: '2027-01-01', principalCents: 4_000_000, interestCents: 40_000 },
    ];
    const input = { lender: 'Sample Equipment Finance', kind: 'equipment', originalPrincipalCents: 24_000_000, dateReceived: '2026-03-01', principalCents: 16_000_000, interestRateBp: 1200, monthsLeft: 4, schedule: 'typed', rows } as OpeningLoanInput;
    expect(await issues(input, CUTOVER, 'warning')).toEqual([]);
    const res = await open(input);
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json().id;
    expect(journalOf(id)).toEqual([
      { code: '3900', party: null, dr: 16_000_000, cr: 0, date: CUTOVER },
      { code: '2602', party: id, dr: 0, cr: 16_000_000, date: CUTOVER },
    ]);
    expect(env.db.prepare('SELECT due_date, principal_cents, interest_cents FROM loan_schedule WHERE loan_id = ? ORDER BY instalment_no').raw().all(id)).toEqual(rows.map((r) => [r.dueDate, r.principalCents, r.interestCents]));
    expect((await accountant.get(`/api/docs/loan.opening/${id}`)).json().input).toEqual(input);

    const fixed = { ...input, principalCents: 12_000_000, rows: rows.slice(1) };
    const edit = await accountant.post(`/api/docs/loan.opening/${id}/reissue`, { input: fixed, expectedTotalCents: 12_000_000, businessDate: CUTOVER, reason: 'October was paid before the cut-over' }, idem());
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json()).toMatchObject({ number: 'OBLN-000002', businessDate: CUTOVER });
    expect(journalOf(id, 'reversal').map((l) => (l as { date: string }).date)).toEqual([CUTOVER, CUTOVER]);
    expect(balances(env.db)).toEqual({ '2602': -12_000_000, '3900': 12_000_000 });
    expect((await encoder.get('/api/loan/loans?status=posted')).json()).toEqual([expect.objectContaining({ number: 'OBLN-000002', principalPaidCents: 12_000_000, balanceCents: 12_000_000 })]);
    noBrokenInvariants();
  });

  it('the first payment after the cut-over pays instalment 1 of the schedule: principal and interest', async () => {
    await setCutover();
    const id = (await open(bank())).json().id;
    const p = await pay(id, 1, 6_089_631);
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toMatchObject({
      number: 'LPAY-000001', businessDate: '2026-09-28',
      summary: 'This will record instalment 1 of 13 on OBLN-000001 (Sample Bank): ₱60,896.31 from Cash in bank – BDO, ₱53,507.31 principal and ₱7,389.00 interest.',
    });
    expect(journalOf(p.json().id).map((l) => Object.values(l as object).slice(0, 4))).toEqual([['2601', id, 5_350_731, 0], ['7201', null, 738_900, 0], ['1111', null, 0, 6_089_631]]);
    expect(balances(env.db)).toEqual({ '1111': -6_089_631, '7201': 738_900, '2601': -68_539_269, '3900': 73_890_000 });
    expect((await encoder.get('/api/loan/loans')).json()[0]).toMatchObject({
      principalCents: 100_000_000, principalPaidCents: 31_460_731, interestPaidCents: 738_900, balanceCents: 68_539_269, nextDue: { instalmentNo: 2, dueDate: '2026-11-15' },
    });
    const ledger = (await accountant.get(`/api/loan/loans/${id}`)).json().ledger as { date: string; documentNumber: string; amountCents: number; balanceCents: number }[];
    expect(ledger.map((x) => [x.date, x.documentNumber, x.amountCents, x.balanceCents])).toEqual([['2026-09-27', 'OBLN-000001', 73_890_000, 73_890_000], ['2026-09-28', 'LPAY-000001', -5_350_731, 68_539_269]]);
    expect((await pay(id, 3, 6_089_631)).json().details[0].code).toBe('NOT_NEXT');
    noBrokenInvariants();
  });

  it('cancel waits for the payments, then lands on the cut-over date; the cancelled loan takes no payment', async () => {
    await setCutover();
    const id = (await open(bank())).json().id;
    const p = (await pay(id, 1, 6_089_631)).json();
    const blocked = await cancel('loan.opening', id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: LPAY-000001.' });
    expect((await cancel('loan.payment', p.id)).statusCode).toBe(200);
    expect((await cancel('loan.opening', id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      { code: '3900', party: null, dr: 0, cr: 73_890_000, date: CUTOVER },
      { code: '2601', party: id, dr: 73_890_000, cr: 0, date: CUTOVER },
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect((await encoder.get('/api/loan/loans?status=cancelled')).json()[0]).toMatchObject({ number: 'OBLN-000001', balanceCents: 0, nextDue: null });
    expect((await pay(id, 1, 6_089_631)).json().details).toEqual([expect.objectContaining({ code: 'LOAN_CANCELLED', message: 'OBLN-000001 was cancelled. Record payments only on a loan that stands.' })]);
    expect((await setCutover('2026-09-20')).json().cutoverDate).toBe('2026-09-20'); // no opening document left on the old date
    noBrokenInvariants();
  });
});

describe('Opening loan refusals', () => {
  it('without a cut-over date, on another date, or by anyone but the accountant', async () => {
    expect(await issues(bank())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await issues(bank(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await issues(bank(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(bank(), '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect((await open(bank(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(bank(), CUTOVER, owner)).statusCode).toBe(403);
    expect(balances(env.db)).toEqual({});
  });

  it('a schedule that does not add up to what is still owed, and other slips', async () => {
    await setCutover();
    const rows = [{ dueDate: '2026-10-15', principalCents: 40_000_000, interestCents: 738_900 }, { dueDate: '2026-11-15', principalCents: 30_000_000, interestCents: 300_000 }];
    const typed = bank({ schedule: 'typed', nextDueDate: undefined, rows });
    expect(await issues(typed)).toEqual(['SCHEDULE_TOTAL']);
    const res = await open(typed);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('The schedule repays ₱700,000.00 of principal, not the ₱738,900.00 still owed.');
    expect(await issues(bank({ principalCents: 70_000_000, schedule: 'typed', rows: [rows[1]!, rows[0]!] }))).toEqual(['SCHEDULE_DATES']);
    expect(await issues(bank({ schedule: 'typed', rows: undefined }))).toEqual(['SCHEDULE']);
    expect(await issues(bank({ nextDueDate: undefined }))).toEqual(['NEXT_DUE_DATE']);
    expect(await issues(bank({ originalPrincipalCents: 70_000_000 }))).toEqual(['OWED_MORE']);
    expect(await issues(bank({ dateReceived: '2026-09-28' }))).toEqual(['RECEIVED_AFTER']);
    expect(await issues(bank({ nextDueDate: '2026-09-15' }), CUTOVER, 'warning')).toEqual(['DUE_ALREADY']); // overdue then: allowed, checked
    expect(balances(env.db)).toEqual({});
  });

  it('once the opening is closed: no new opening loan, no cancel; its payments go on', async () => {
    await setCutover();
    const id = (await open(bank())).json().id;
    const equity = await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: env.db.prepare(`SELECT id FROM accounts WHERE code = '3201'`).pluck().get(), debitCents: 73_890_000 }] }, expectedTotalCents: 73_890_000, businessDate: CUTOVER }, idem());
    expect(equity.statusCode, equity.body).toBe(200);
    await accountant.post('/api/auth/step-up', { password: PASSWORD });
    const closed = await accountant.post('/api/acc/opening/close', {});
    expect(closed.statusCode, closed.body).toBe(200);

    expect(await issues(bank())).toEqual(['OPENING_CLOSED']);
    const refused = await cancel('loan.opening', id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('OPENING_CLOSED');
    expect(journalOf(id, 'reversal')).toEqual([]);
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(id)).toBe('posted');
    expect((await pay(id, 1, 6_089_631)).statusCode).toBe(200);
    noBrokenInvariants();
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random opening loans post balanced against 3900, store what was computed, take payments and cancel cleanly', async () => {
    await setCutover();
    const actor = { userId: accountant.userId, permissions: new Set(['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate', 'loan.pay.post']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    fc.assert(
      fc.property(openingLoanDoc.arbitrary(env.db), fc.constantFrom('keep', 'pay', 'cancel'), (input, then) => {
        const doc = openingLoanDoc.compute(input, ctx());
        expect(openingLoanDoc.validate(doc, ctx()).filter((i) => i.level === 'error')).toEqual([]);
        expect(doc.rows.reduce((s, r) => s + r.principalCents, 0)).toBe(input.principalCents);
        const lines = resolveDraft(env.db, openingLoanDoc.journal!(doc, ctx())!);
        expect(lines.map((l) => [l.account.role_key, l.debitCents, l.creditCents])).toEqual([
          ['OPENING_EQUITY', doc.totalCents, 0],
          [input.kind === 'loan' ? 'LOANS_PAYABLE' : 'EQUIP_FINANCING', 0, doc.totalCents],
        ]);

        const p = postDocument(e, openingLoanDoc, actor, { input, expectedTotalCents: doc.totalCents, businessDate: CUTOVER });
        expect(openingLoanDoc.load(env.db, p.id)).toEqual(doc);
        expect(openingLoanDoc.toInput(doc)).toEqual(input);
        if (then === 'pay') {
          const first = doc.rows[0]!;
          postDocument(e, paymentDoc, actor, { input: { loanId: p.id, instalmentNo: 1, cashPlaceId: BDO }, expectedTotalCents: first.principalCents + first.interestCents });
          expect(listLoans(env.db).find((l) => l.id === p.id)).toMatchObject({ balanceCents: input.principalCents - first.principalCents, principalPaidCents: input.originalPrincipalCents - input.principalCents + first.principalCents });
        }
        if (then === 'cancel') cancelDocument(e, openingLoanDoc, actor, p.id, 'Property test cancel');
      }),
      { numRuns: 30 },
    );
    for (const l of listLoans(env.db, 'posted')) expect(l.balanceCents).toBe(l.principalCents - l.principalPaidCents);
    noBrokenInvariants();
  });
});
