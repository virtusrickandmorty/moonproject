/**
 * Loans: golden G-20, schedules (generated and typed), the split override, cancels and edits, the loan register and
 * ledger, equipment financing of an FA- purchase, and property tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { loanDoc, type LoanInput } from '../doctypes/loan.ts';
import { paymentDoc } from '../doctypes/payment.ts';
import { generateSchedule, listLoans, loanBalance } from '../loans.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number, CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  CASH = cashPlaceId(env.db, '1101');
});

/** G-20: ₱500,000.00 at 12% a year, flat, 25 months: 25 × (₱20,000.00 principal + ₱5,000.00 interest). */
const g20 = (more: Partial<LoanInput> = {}) => ({ lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 50_000_000, feeCents: 500_000, interestRateBp: 1200, termMonths: 25, schedule: 'flat', ...more });
const borrow = (c: Client, input: { principalCents: number; [k: string]: unknown }) => c.post('/api/docs/loan.loan/post', { input, expectedTotalCents: input.principalCents }, idem());
const pay = (c: Client, input: object, cents: number) => c.post('/api/docs/loan.payment/post', { input, expectedTotalCents: cents }, idem());
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake today' }, idem());

/** The original journal of a document: [code, party type, debit, credit] per line. */
const journalOf = (documentId: string) =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** [code, party id, debit, credit] per line of a document's original journal. */
const partiesOf = (documentId: string) =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId);
/** 2602 owed to one party (credit balance, in centavos). */
const owedOn2602 = (partyId: string) =>
  env.db
    .prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2602' AND l.party_id = ?`)
    .pluck()
    .get(partyId) as number;
/** G-21's heat press: ₱112,000.00, ₱30,000.00 from BDO and ₱82,000.00 financed by the lender, who paid the supplier. */
async function heatPress(financedCents = 8_200_000) {
  const supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id;
  const input = {
    classCode: 'machinery', description: 'Heat press', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000,
    residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 11_200_000 - financedCents, ...(financedCents ? { financedCents, lender: 'Sample Equipment Finance' } : {}),
  };
  const res = await accountant.post('/api/docs/fa.buy/post', { input, expectedTotalCents: 11_200_000 }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string };
}
const financing = (assetPurchaseId: string, more: Partial<LoanInput> = {}) =>
  ({ lender: 'Sample Equipment Finance', kind: 'equipment', assetPurchaseId, principalCents: 8_200_000, interestRateBp: 1200, termMonths: 24, schedule: 'declining', ...more }) as LoanInput & { principalCents: number };
const issueCodes = async (input: object) => ((await accountant.post('/api/docs/loan.loan/preview', { input })).json().issues as { code: string }[]).map((i) => i.code);

describe('equipment financing of an asset purchase (FA-BUY financed part)', () => {
  it('takes the financed part over into the loan register: no cash moves, the loan is then paid like any other', async () => {
    const fa = await heatPress();
    expect((await accountant.get('/api/loan/financed-assets')).json()).toEqual([
      { id: fa.id, number: 'FA-000001', status: 'posted', date: '2026-09-28', description: 'Heat press', supplierName: 'Sample Machines', lender: 'Sample Equipment Finance', financedCents: 8_200_000 },
    ]);
    expect((await encoder.get('/api/loan/financed-assets')).statusCode).toBe(403);

    const l = await borrow(accountant, financing(fa.id, { reference: 'EF-7788' }));
    expect(l.statusCode, l.body).toBe(200);
    expect(l.json().summary).toBe(
      'This will record an equipment financing of ₱82,000.00 from Sample Equipment Finance, which paid Sample Machines ₱82,000.00 for FA-000001 (Heat press), repaid in 24 instalments from 2026-10-28 (the first is ₱3,860.02).',
    );
    const loanId = l.json().id;
    expect(partiesOf(loanId)).toEqual([['2602', fa.id, 8_200_000, 0], ['2602', loanId, 0, 8_200_000]]);
    expect([owedOn2602(fa.id), owedOn2602(loanId)]).toEqual([0, 8_200_000]);
    expect(balances(env.db)).toMatchObject({ '1111': -3_000_000, '2602': -8_200_000 }); // the asset purchase alone moved cash
    expect((await accountant.get('/api/loan/financed-assets')).json()).toEqual([]);
    expect((await encoder.get('/api/loan/loans')).json()).toEqual([expect.objectContaining({ number: 'LOAN-000001', assetPurchaseNumber: 'FA-000001', balanceCents: 8_200_000 })]);
    expect((await accountant.get(`/api/docs/loan.loan/${loanId}`)).json().input).toEqual(financing(fa.id, { reference: 'EF-7788', firstDueDate: '2026-10-28' }));

    const p = await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 386_002);
    expect(p.statusCode, p.body).toBe(200);
    expect(owedOn2602(loanId)).toBe(8_200_000 - (386_002 - 82_000)); // interest 1% of 82,000.00 a month

    // The purchase cancels only after its financing, and the financing only after its payments.
    expect((await cancel(accountant, 'fa.buy', fa.id)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: LOAN-000001.' });
    expect((await cancel(accountant, 'loan.loan', loanId)).json()).toMatchObject({ code: 'HAS_DEPENDENTS' });
    expect((await cancel(accountant, 'loan.payment', p.json().id)).statusCode).toBe(200);
    expect((await cancel(accountant, 'loan.loan', loanId)).statusCode).toBe(200);
    expect([owedOn2602(fa.id), owedOn2602(loanId)]).toEqual([8_200_000, 0]);
    expect((await accountant.get('/api/loan/financed-assets')).json()).toHaveLength(1);
    expect((await cancel(accountant, 'fa.buy', fa.id)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('checks the purchase, the amount net of fees, the kind, the lender and a second loan on the same purchase', async () => {
    const fa = await heatPress();
    const cashOnly = await heatPress(0);
    expect(await issueCodes(financing(fa.id))).toEqual([]);
    expect(await issueCodes(financing(fa.id, { cashPlaceId: BDO }))).toEqual(['PROCEEDS']);
    expect(await issueCodes({ ...financing(fa.id), assetPurchaseId: undefined })).toEqual(['PROCEEDS']);
    expect(await issueCodes(financing(cashOnly.id))).toEqual(['ASSET_PURCHASE']);
    expect(await issueCodes(financing(fa.id, { principalCents: 8_300_000 }))).toEqual(['FINANCED_AMOUNT']);
    expect(await issueCodes(financing(fa.id, { kind: 'loan' }))).toEqual(['KIND']);
    expect(await issueCodes(financing(fa.id, { lender: 'Another Lender' }))).toEqual(['LENDER_DIFFERENT']);

    // A fee the lender adds to the loan: principal 83,000.00 less 1,000.00 fees = the 82,000.00 financed.
    const withFee = await borrow(accountant, financing(fa.id, { principalCents: 8_300_000, feeCents: 100_000 }));
    expect(withFee.statusCode, withFee.body).toBe(200);
    expect(partiesOf(withFee.json().id)).toEqual([['2602', fa.id, 8_200_000, 0], ['7201', null, 100_000, 0], ['2602', withFee.json().id, 0, 8_300_000]]);
    expect(await issueCodes(financing(fa.id))).toEqual(['ALREADY_LINKED']);
    noBrokenInvariants();
  });
});

describe('Loan golden (PLAN I2 G-20)', () => {
  it('loan ₱500,000 with a ₱5,000 fee deducted; instalment ₱25,000 = 20,000 principal + 5,000 interest', async () => {
    const l = await borrow(accountant, g20({ reference: 'PN 2026-001' }));
    expect(l.statusCode, l.body).toBe(200);
    expect(l.json()).toMatchObject({ number: 'LOAN-000001', totalCents: 50_000_000 });
    expect(l.json().summary).toBe('This will record a loan of ₱500,000.00 from Sample Bank, ₱495,000.00 received in Cash in bank – BDO after ₱5,000.00 in fees, repaid in 25 instalments from 2026-10-28 (the first is ₱25,000.00).');
    expect(journalOf(l.json().id)).toEqual([['1111', null, 49_500_000, 0], ['7201', null, 500_000, 0], ['2601', 'loan', 0, 50_000_000]]);
    const loanId = l.json().id;

    const p = await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000);
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toMatchObject({ number: 'LPAY-000001', summary: 'This will record instalment 1 of 25 on LOAN-000001 (Sample Bank): ₱25,000.00 from Cash in bank – BDO, ₱20,000.00 principal and ₱5,000.00 interest.' });
    expect(journalOf(p.json().id)).toEqual([['2601', 'loan', 2_000_000, 0], ['7201', null, 500_000, 0], ['1111', null, 0, 2_500_000]]);
    expect(balances(env.db)).toEqual({ '1111': 47_000_000, '7201': 1_000_000, '2601': -48_000_000 });

    const reg = (await encoder.get('/api/loan/loans')).json();
    expect(reg).toEqual([expect.objectContaining({ number: 'LOAN-000001', dateReceived: '2026-09-28', principalCents: 50_000_000, principalPaidCents: 2_000_000, interestPaidCents: 500_000, balanceCents: 48_000_000, instalments: 25 })]);
    expect(reg[0].nextDue).toEqual({ instalmentNo: 2, dueDate: '2026-11-28', principalCents: 2_000_000, interestCents: 500_000 });
    const ledger = (await accountant.get(`/api/loan/loans/${loanId}`)).json();
    expect(ledger.ledger.map((x: { documentNumber: string; amountCents: number; balanceCents: number }) => [x.documentNumber, x.amountCents, x.balanceCents])).toEqual([['LOAN-000001', 50_000_000, 50_000_000], ['LPAY-000001', -2_000_000, 48_000_000]]);
    expect(ledger.schedule[0]).toMatchObject({ instalmentNo: 1, paidBy: 'LPAY-000001' });
    expect(ledger.schedule.at(-1)).toEqual({ instalmentNo: 25, dueDate: '2028-10-28', principalCents: 2_000_000, interestCents: 500_000, paidBy: null });
    expect((await encoder.get(`/api/loan/loans/${loanId}`)).statusCode).toBe(403);
    noBrokenInvariants();
  });
});

describe('schedules', () => {
  it('declining: the same payment each month on the declining balance; the last row pays off the rest', () => {
    const rows = generateSchedule(10_000_000, 1200, 12, 'declining', '2027-01-31');
    expect(rows[0]).toEqual({ instalmentNo: 1, dueDate: '2027-01-31', principalCents: 788_488, interestCents: 100_000 }); // ₱8,884.88 a month
    expect(rows.slice(0, 11).every((r) => r.principalCents + r.interestCents === 888_488)).toBe(true);
    expect(rows[11]).toEqual({ instalmentNo: 12, dueDate: '2027-12-31', principalCents: 879_688, interestCents: 8_797 });
    expect(rows.map((r) => r.dueDate).slice(0, 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(10_000_000);
  });

  it('typed rows must repay the principal, in date order; equipment financing credits 2602', async () => {
    const rows = [{ dueDate: '2026-12-28', principalCents: 5_000_000, interestCents: 300_000 }, { dueDate: '2027-03-28', principalCents: 3_200_000, interestCents: 150_000 }];
    const base = { lender: 'Made-up Equipment Finance', kind: 'equipment', cashPlaceId: CASH, principalCents: 8_200_000, interestRateBp: 1500, termMonths: 6, schedule: 'typed' };
    expect((await borrow(accountant, { ...base, rows: rows.slice(0, 1) })).json().details[0].code).toBe('SCHEDULE_TOTAL');
    expect((await borrow(accountant, { ...base, rows: [rows[1], rows[0]] })).json().details[0].code).toBe('SCHEDULE_DATES');
    expect((await borrow(accountant, base)).json().details[0].code).toBe('SCHEDULE');
    expect((await borrow(accountant, { ...base, rows: [...rows, { dueDate: '2027-06-28', principalCents: 0, interestCents: 0 }] })).json().details[0].code).toBe('SCHEDULE_ZERO');
    const r = await borrow(accountant, { ...base, rows });
    expect(r.statusCode, r.body).toBe(200);
    expect(journalOf(r.json().id)).toEqual([['1101', null, 8_200_000, 0], ['2602', 'loan', 0, 8_200_000]]);
    const p = await pay(encoder, { loanId: r.json().id, instalmentNo: 1, cashPlaceId: CASH }, 5_300_000);
    expect(journalOf(p.json().id)).toEqual([['2602', 'loan', 5_000_000, 0], ['7201', null, 300_000, 0], ['1101', null, 0, 5_300_000]]);
    expect(env.db.prepare('SELECT due_date FROM loan_schedule WHERE loan_id = ? ORDER BY instalment_no').pluck().all(r.json().id)).toEqual(['2026-12-28', '2027-03-28']);
  });

  it('schedule rows are insert-only', async () => {
    const { id } = (await borrow(accountant, g20())).json();
    expect(() => env.db.prepare('UPDATE loan_schedule SET principal_cents = 1 WHERE loan_id = ?').run(id)).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('DELETE FROM loan_schedule WHERE loan_id = ?').run(id)).toThrow(/NO_DELETE/);
    expect(() => env.db.prepare('UPDATE loan_loans SET principal_cents = 1').run()).toThrow(/IMMUTABLE/);
  });

  it('only the accountant sends the fees to another account, and only to an expense or prepaid account', async () => {
    const acct = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const owner = await env.as('owner');
    expect((await borrow(owner, g20({ feeAccountId: acct('6195') }))).json().details[0].code).toBe('NOT_ALLOWED');
    expect((await borrow(accountant, g20({ feeAccountId: acct('2601') }))).json().details[0].code).toBe('FEE_ACCOUNT');
    expect((await borrow(accountant, g20({ feeAccountId: BDO }))).json().details[0].code).toBe('FEE_ACCOUNT');
    expect((await borrow(accountant, g20({ feeCents: 50_000_000 }))).json().details[0].code).toBe('FEE_TOO_BIG');
    expect((await borrow(accountant, g20({ feeAccountId: acct('1201') }))).json().details[0].code).toBe('FEE_ACCOUNT'); // needs a customer
    const r = await borrow(accountant, g20({ feeAccountId: acct('6195') }));
    expect(journalOf(r.json().id)).toEqual([['1111', null, 49_500_000, 0], ['6195', null, 500_000, 0], ['2601', 'loan', 0, 50_000_000]]);
    const prepaid = await borrow(accountant, g20({ feeAccountId: acct('1420') })); // spread over the loan by JV later
    expect(journalOf(prepaid.json().id)).toEqual([['1111', null, 49_500_000, 0], ['1420', null, 500_000, 0], ['2601', 'loan', 0, 50_000_000]]);
    expect((await borrow(encoder, g20())).statusCode).toBe(403);
  });
});

describe('Loan payment rules', () => {
  it('pays instalments in order; a changed split needs a note; principal never goes above what is owed', async () => {
    const { id: loanId } = (await borrow(accountant, g20())).json();
    expect((await pay(encoder, { loanId, instalmentNo: 2, cashPlaceId: BDO }, 2_500_000)).json().details[0].code).toBe('NOT_NEXT');
    expect((await pay(encoder, { loanId, instalmentNo: 26, cashPlaceId: BDO }, 0)).json().details[0].code).toBe('INSTALMENT');
    const late = { loanId, instalmentNo: 1, cashPlaceId: BDO, interestCents: 550_000 };
    expect((await pay(encoder, late, 2_550_000)).json().details[0].code).toBe('NOTE_REQUIRED');
    const ok = await pay(encoder, { ...late, note: 'Bank added late interest' }, 2_550_000);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().summary).toContain('₱20,000.00 principal and ₱5,500.00 interest instead of the scheduled ₱20,000.00 and ₱5,000.00.');
    expect(journalOf(ok.json().id)).toEqual([['2601', 'loan', 2_000_000, 0], ['7201', null, 550_000, 0], ['1111', null, 0, 2_550_000]]);
    expect((await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000)).json().details[0].code).toBe('PAID');
    const tooMuch = await pay(encoder, { loanId, instalmentNo: 2, cashPlaceId: BDO, principalCents: 48_000_001, note: 'Paying it all off' }, 48_500_001);
    expect(tooMuch.json().details.map((i: { code: string }) => i.code)).toEqual(['MORE_THAN_OWED']);
    const payOff = await pay(encoder, { loanId, instalmentNo: 2, cashPlaceId: BDO, principalCents: 48_000_000, note: 'Paying it all off' }, 48_500_000);
    expect(payOff.statusCode, payOff.body).toBe(200);
    expect((await encoder.get('/api/loan/loans')).json()[0]).toMatchObject({ balanceCents: 0, nextDue: null });
    noBrokenInvariants();
  });
});

describe('cancel and edit (NR-4)', () => {
  it('cancelling a payment mirrors it and opens the instalment again', async () => {
    const { id: loanId } = (await borrow(accountant, g20())).json();
    const p = (await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000)).json();
    expect((await cancel(encoder, 'loan.payment', p.id)).statusCode).toBe(403);
    expect((await cancel(accountant, 'loan.payment', p.id)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({ '1111': 49_500_000, '7201': 500_000, '2601': -50_000_000 });
    expect((await encoder.get('/api/loan/loans')).json()[0].nextDue.instalmentNo).toBe(1);
    expect((await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: CASH }, 2_500_000)).json().number).toBe('LPAY-000002');
    noBrokenInvariants();
  });

  it('a loan with payments cannot be cancelled; once cancelled it takes no payment', async () => {
    const { id: loanId } = (await borrow(accountant, g20())).json();
    const p = (await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000)).json();
    const blocked = await cancel(accountant, 'loan.loan', loanId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: LPAY-000001.' });
    const edit = await accountant.post(`/api/docs/loan.loan/${loanId}/reissue`, { input: g20({ cashPlaceId: CASH }), expectedTotalCents: 50_000_000, reason: 'Proceeds went to the cash box' }, idem());
    expect(edit.json().code).toBe('HAS_DEPENDENTS'); // an edit would leave the payment on a cancelled loan
    await cancel(accountant, 'loan.payment', p.id);
    expect((await cancel(accountant, 'loan.loan', loanId)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    const refused = await pay(encoder, { loanId, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().details).toEqual([expect.objectContaining({ code: 'LOAN_CANCELLED', message: 'LOAN-000001 was cancelled. Record payments only on a loan that stands.' })]);
    expect((await encoder.get('/api/loan/loans?status=cancelled')).json()[0]).toMatchObject({ status: 'cancelled', balanceCents: 0, nextDue: null });
    noBrokenInvariants();
  });

  it('edit = cancel + new number; the old loan points to its replacement', async () => {
    const first = (await borrow(accountant, g20())).json();
    const r = await accountant.post(`/api/docs/loan.loan/${first.id}/reissue`, { input: g20({ cashPlaceId: CASH }), expectedTotalCents: 50_000_000, reason: 'Proceeds went to the cash box' }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().number).toBe('LOAN-000002');
    expect(balances(env.db)).toEqual({ '1101': 49_500_000, '7201': 500_000, '2601': -50_000_000 });
    const refused = await pay(encoder, { loanId: first.id, instalmentNo: 1, cashPlaceId: BDO }, 2_500_000);
    expect(refused.json().message).toBe('LOAN-000001 was cancelled and replaced by LOAN-000002. Record payments only on a loan that stands.');
    expect((await pay(encoder, { loanId: r.json().id, instalmentNo: 1, cashPlaceId: CASH }, 2_500_000)).statusCode).toBe(200);
    noBrokenInvariants();
  });
});

describe('property tests (PLAN I1.3)', () => {
  const actor = () => ({ userId: accountant.userId, permissions: new Set(['loan.in.create', 'loan.in.post', 'loan.in.cancel', 'loan.pay.create', 'loan.pay.post', 'loan.pay.cancel']) });
  const ctx = () => ({ db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: actor().userId, can: (p: string) => actor().permissions.has(p) });

  it('random loans post balanced with a schedule that repays the principal, and cancel or edit cleanly', () => {
    const e = { db: env.db, clock: env.clock };
    fc.assert(
      fc.property(fc.array(fc.tuple(loanDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [input, then] of ops) {
          const computed = loanDoc.compute(input, ctx());
          expect(computed.rows.reduce((s, r) => s + r.principalCents, 0)).toBe(input.principalCents);
          const p = postDocument(e, loanDoc, actor(), { input, expectedTotalCents: input.principalCents });
          expect(loanDoc.load(env.db, p.id)).toEqual(computed);
          if (then === 'cancel') cancelDocument(e, loanDoc, actor(), p.id, 'Recorded twice by mistake');
          if (then === 'reissue') reissueDocument(e, loanDoc, actor(), p.id, { input: loanDoc.toInput(computed), expectedTotalCents: input.principalCents, reason: 'Corrected the details' });
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it('random payments either post or are refused whole; balances match the payments and principal is never expensed', () => {
    const e = { db: env.db, clock: env.clock };
    for (const input of [g20(), g20({ kind: 'equipment', schedule: 'declining', principalCents: 1_000_000, feeCents: 0, termMonths: 3 })]) {
      postDocument(e, loanDoc, actor(), { input, expectedTotalCents: input.principalCents });
    }
    const docCount = () => env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get() as number;
    fc.assert(
      fc.property(fc.array(fc.tuple(paymentDoc.arbitrary(env.db), fc.boolean()), { minLength: 1, maxLength: 10 }), (ops) => {
        for (const [input, cancelIt] of ops) {
          const before = docCount();
          try {
            const p = postDocument(e, paymentDoc, actor(), { input, expectedTotalCents: paymentDoc.compute(input, ctx()).totalCents });
            if (cancelIt) cancelDocument(e, paymentDoc, actor(), p.id, 'Recorded twice by mistake');
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe('VALIDATION');
            expect(docCount()).toBe(before);
          }
        }
        let fees = 0, interest = 0;
        for (const l of listLoans(env.db, 'posted')) {
          expect(l.balanceCents).toBe(l.principalCents - l.principalPaidCents);
          expect(l.balanceCents).toBeGreaterThanOrEqual(0);
          expect(loanBalance(env.db, l.id, l.kind)).toBe(l.balanceCents);
          fees += l.feeCents;
          interest += l.interestPaidCents;
        }
        expect(balances(env.db)['7201'] ?? 0).toBe(fees + interest); // the only expense lines are fees and interest
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });
});
