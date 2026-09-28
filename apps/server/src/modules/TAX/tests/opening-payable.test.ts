/**
 * Opening tax payable (OBTP-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the BIR returns of periods before the cut-over
 * date prepared from the old books and not yet paid. Dr 3900 / Cr 2302, 2311 per supplier or 2320, dated the cut-over
 * date. The BIR payment of that form and period pays exactly what the opening left; the registers, the worksheets' EWT
 * and VAT, the QAP and the 2307s to issue never count it. A 1702 stays on 2320 (a 1702Q is paid from it: income-tax.test.ts). Cancelled on the cut-over date while
 * the opening is open and no BIR payment stands on it; the refusals; a property test; runInvariants (L3) and the EWT
 * register tied to the GL (L6).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { birPaymentDoc, type BirPaymentInput } from '../doctypes/bir-payment.ts';
import { openingPayableDoc, type OpeningPayableInput } from '../doctypes/opening-payable.ts';
import { periodsDue } from '../payments.ts';
import { ewtRegister } from '../purchases.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let BDO: number;
let lessor: string, printer: string, auditor: string;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  [accountant, encoder, owner] = [await env.as('accountant'), await env.as('encoder'), await env.as('owner')];
  BDO = cashPlaceId(env.db, '1111');
  const newSupplier = async (s: Record<string, unknown>) => (await accountant.post('/api/pur/suppliers', { isVatRegistered: true, ...s })).json().id as string;
  lessor = await newSupplier({ name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', ewtClass: 'rent_5' });
  printer = await newSupplier({ name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', ewtClass: 'contractor_2' });
  auditor = await newSupplier({ name: 'Sample Audit', registeredName: 'Sample Audit Firm', tin: '555-666-777-000', ewtClass: 'prof_firm_10' });
});

const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
/** Signs in again after the clock moves (sessions are for the day). */
const moveTo = async (iso: string) => {
  env.clock.set(iso);
  [accountant, encoder, owner] = [await env.as('accountant'), await env.as('encoder'), await env.as('owner')];
};

type Row = OpeningPayableInput['rows'][number];
type TaxRow = Extract<Row, { amountCents: number }>;
type EwtRow = Extract<Row, { payees: unknown }>;
/** The 2550Q of Q2 2026, filed from the old books: ₱84,000.00 still to pay. */
const vatQ2 = (): TaxRow => ({ form: '2550Q', period: '2026-Q2', amountCents: 8_400_000 });
/** The 1601-EQ of Q2 2026 for three suppliers: rent ₱5,000.00 (WC100), printing ₱1,200.00 (WC120), audit ₱3,000.00 (WC010). */
const ewtQ2 = (): EwtRow => ({
  form: '1601-EQ', period: '2026-Q2',
  payees: [{ supplierId: lessor, atc: 'WC100', amountCents: 500_000 }, { supplierId: printer, atc: 'WC120', amountCents: 120_000 }, { supplierId: auditor, atc: 'WC010', amountCents: 300_000 }],
});
/** The 1702Q of Q2 2026: ₱15,000.00 income tax. */
const itQ2 = (): TaxRow => ({ form: '1702Q', period: '2026-Q2', amountCents: 1_500_000 });
const obtp = (rows: Row[], note?: string): OpeningPayableInput => ({ rows, ...(note ? { note } : {}) });
const totalOf = (input: OpeningPayableInput) => input.rows.reduce((s, r) => s + ('payees' in r ? r.payees.reduce((t, p) => t + p.amountCents, 0) : r.amountCents), 0);

const open = (input: OpeningPayableInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/tax.payable.opening/post', { input, expectedTotalCents: totalOf(input), ...(businessDate ? { businessDate } : {}) }, idem());
const preview = (input: unknown, businessDate: string | null = CUTOVER) =>
  accountant.post('/api/docs/tax.payable.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
const errors = async (input: OpeningPayableInput, businessDate: string | null = CUTOVER) =>
  (await preview(input, businessDate)).json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());

const birp = (o: Pick<BirPaymentInput, 'form' | 'period' | 'amountCents'> & Partial<BirPaymentInput>): BirPaymentInput => ({ cashPlaceId: BDO, reference: 'eFPS 0928-0001', ...o });
const payPreview = async (input: BirPaymentInput, businessDate?: string) =>
  (await accountant.post('/api/docs/tax.bir_payment/preview', { input, ...(businessDate ? { businessDate } : {}) })).json();
const pay = async (input: BirPaymentInput) => {
  const res = await accountant.post('/api/docs/tax.bir_payment/post', { input, expectedTotalCents: (await payPreview(input)).totalCents }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; number: string; businessDate: string; warnings: { code: string }[] };
};
const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);

/** A journal of a document: [code, party id, debit, credit, memo, date] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.debit_cents, l.credit_cents, l.memo, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? AND j.source_type = 'document' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
/** Debit-positive balance of an account for one party (+ 0: the ledger's negation gives -0 on zero). */
const partyBalance = (code: string, partyId: string) =>
  (env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND l.party_id = ?`)
    .pluck()
    .get(code, partyId) as number) + 0;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const get = async (url: string) => {
  const res = await accountant.get(url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
/** Everything the tax reports say about Q2 and Q3 2026: registers, worksheets, QAP and 2307s to issue. */
const reports = async () => ({
  ewt: await get('/api/tax/registers/ewt?from=2026-04-01&to=2026-12-31'),
  purchases: await get('/api/tax/registers/purchases?from=2026-04-01&to=2026-12-31'),
  sales: await get('/api/tax/registers/sales?from=2026-04-01&to=2026-12-31'),
  vatQ2: await get('/api/tax/2550q?year=2026&quarter=2'),
  vatQ3: await get('/api/tax/2550q?year=2026&quarter=3'),
  vatSummaryQ3: await get('/api/tax/vat-summary?year=2026&quarter=3'),
  eqQ3: await get('/api/tax/1601eq?year=2026&quarter=3'),
  aug: await get('/api/tax/0619e?month=2026-08'),
  toIssueQ2: await get('/api/tax/2307-to-issue?year=2026&quarter=2'),
  toIssueQ3: await get('/api/tax/2307-to-issue?year=2026&quarter=3'),
});

describe('opening tax payable goldens (PLAN D8 step 3)', () => {
  it('a 2550Q of the quarter before the cut-over: Dr 3900 / Cr 2302, then its BIR payment pays exactly that', async () => {
    await setCutover();
    const before = await reports();
    const pre = (await preview(obtp([vatQ2()]))).json();
    expect(pre).toMatchObject({
      totalCents: 8_400_000, issues: [],
      summary: 'This will record a BIR return of the old books not yet paid as open on the cut-over date 2026-09-27: ₱84,000.00 VAT (2550Q).',
    });
    const res = await open(obtp([vatQ2()]));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBTP-000001', businessDate: CUTOVER, totalCents: 8_400_000, warnings: [] });
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['3900', null, 8_400_000, 0, 'Opening balance equity', CUTOVER],
      ['2302', null, 0, 8_400_000, '2550Q Q2 2026', CUTOVER],
    ]);
    expect(balances(env.db)).toEqual({ '2302': -8_400_000, '3900': 8_400_000 });
    expect((await get(`/api/docs/tax.payable.opening/${id}`)).input).toEqual(obtp([vatQ2()]));
    const s = await get('/api/acc/opening');
    expect(s.documents).toMatchObject([{ docType: 'tax.payable.opening', number: 'OBTP-000001', businessDate: CUTOVER, status: 'posted', totalCents: 8_400_000 }]);

    // The BIR payment of the 2550Q for Q2 2026 defaults to what the opening left: no VAT close needed.
    expect(periodsDue(env.db)).toEqual([{ form: '2550Q', period: '2026-Q2', payableCents: 8_400_000 }]);
    expect(await get('/api/tax/payments/due')).toEqual([{ form: '2550Q', period: '2026-Q2', payableCents: 8_400_000 }]);
    const input = birp({ form: '2550Q', period: '2026-Q2', amountCents: 8_400_000 });
    const p = await payPreview(input);
    expect(p.doc).toMatchObject({ payableCents: 8_400_000, vatClose: null, opening: { documentId: id, number: 'OBTP-000001', date: CUTOVER }, lines: [] });
    expect([codes(p.issues), codes(p.issues, 'warning')]).toEqual([[], ['LATE']]); // due 2026-07-25
    const over = await payPreview({ ...input, amountCents: 8_400_001 });
    expect(over.issues).toContainEqual(expect.objectContaining({
      code: 'OVER', message: '₱84,000.00 is left to pay with the 2550Q for Q2 2026, ₱0.01 less than this. Check the amount against the opening (OBTP-000001); if the return says more, the accountant corrects the books first.',
    }));
    // Paid before the cut-over date: that belongs in the old books.
    const early = await payPreview(input, '2026-09-26');
    expect(early.issues).toContainEqual(expect.objectContaining({
      code: 'BEFORE_OPENING', level: 'error',
      message: 'The 2550Q for Q2 2026 came in with the opening (OBTP-000001) on the cut-over date, 2026-09-27. Date the payment on that day or later: one paid before it belongs in the old books.',
    }));
    const paid = await pay({ ...input, penaltyCents: 210_000 });
    expect(journalOf(paid.id).map((l) => [l[0], l[2], l[3]])).toEqual([['2302', 8_400_000, 0], ['6290', 210_000, 0], ['1111', 0, 8_610_000]]);
    expect(env.db.prepare('SELECT vat_close_id FROM tax_bir_payments WHERE document_id = ?').pluck().get(paid.id)).toBe(id);
    expect((await get(`/api/docs/tax.bir_payment/${paid.id}`)).doc).toMatchObject({ vatClose: null, opening: { number: 'OBTP-000001' }, payableCents: 8_400_000 });
    expect(balances(env.db)['2302']).toBeUndefined();
    expect(periodsDue(env.db)).toEqual([]);
    expect(codes((await payPreview(birp({ form: '2550Q', period: '2026-Q2', amountCents: 1 }))).issues)).toEqual(['NOTHING_DUE']);

    // No register, worksheet or VAT figure moved: the 2550Q was prepared from the old books.
    expect(await reports()).toEqual(before);

    // The payment stands on the opening: it is cancelled first.
    expect((await cancel('tax.payable.opening', id)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: BIRP-000001.' });
    expect((await cancel('tax.bir_payment', paid.id)).statusCode).toBe(200);
    expect((await cancel('tax.payable.opening', id)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('a 1601-EQ for three suppliers: Cr 2311 per supplier, then its payment per payee; the EWT register and the worksheets do not move', async () => {
    await setCutover();
    // A bill after the cut-over withholds EWT in Q3: the opening must not mix with it.
    const bill = await encoder.post('/api/docs/ap.bill/post', {
      input: { supplierId: printer, supplierInvoiceNo: 'SI-0042', supplierInvoiceDate: '2026-09-28', lines: [{ purchase: 'subcontract', amountCents: 560_000 }] }, expectedTotalCents: 560_000,
    }, idem());
    expect(bill.statusCode, bill.body).toBe(200);
    const printerQ3 = partyBalance('2311', printer);
    expect(printerQ3).toBeLessThan(0);
    const before = await reports();
    const eqQ2Before = await get('/api/tax/1601eq?year=2026&quarter=2');
    expect(eqQ2Before).toMatchObject({ atcs: [], qap: [], totals: { baseCents: 0, ewtCents: 0 }, openingCents: 0, dueCents: 0, leftCents: 0 });

    const pre = (await preview(obtp([ewtQ2()]))).json();
    expect(pre.summary).toBe('This will record a BIR return of the old books not yet paid as open on the cut-over date 2026-09-27: ₱9,200.00 EWT (1601-EQ) of 3 suppliers.');
    const res = await open(obtp([ewtQ2()], 'QAP of Q2 filed, not yet paid'));
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['3900', null, 920_000, 0, 'Opening balance equity', CUTOVER],
      ['2311', lessor, 0, 500_000, '1601-EQ Q2 2026 WC100', CUTOVER],
      ['2311', printer, 0, 120_000, '1601-EQ Q2 2026 WC120', CUTOVER],
      ['2311', auditor, 0, 300_000, '1601-EQ Q2 2026 WC010', CUTOVER],
    ]);
    expect([partyBalance('2311', lessor), partyBalance('2311', printer), partyBalance('2311', auditor)]).toEqual([-500_000, printerQ3 - 120_000, -300_000]);
    expect(env.db.prepare('SELECT line_no, row_no, form, period, supplier_id, supplier_name, atc, amount_cents FROM tax_opening_payable_lines WHERE document_id = ? ORDER BY line_no').raw().all(id)).toEqual([
      [1, 1, '1601-EQ', '2026-Q2', lessor, 'Sample Lessor Corp.', 'WC100', 500_000],
      [2, 1, '1601-EQ', '2026-Q2', printer, 'Sample Print Shop Co.', 'WC120', 120_000],
      [3, 1, '1601-EQ', '2026-Q2', auditor, 'Sample Audit Firm', 'WC010', 300_000],
    ]);
    // 2311 ties to its suppliers on the opening screen (L3).
    expect((await get('/api/acc/opening')).checks.find((c: { code: string }) => c.code === '2311')).toMatchObject({ ok: true });

    // The 1601-EQ worksheet of Q2 shows what the old books left, as no EWT withheld here; Q3's does not move.
    const eqQ2 = await get('/api/tax/1601eq?year=2026&quarter=2');
    expect(eqQ2).toMatchObject({ atcs: [], qap: [], totals: { baseCents: 0, ewtCents: 0 }, openingCents: 920_000, dueCents: 920_000, leftCents: 920_000 });
    expect(eqQ2.openings).toEqual([{ documentId: id, number: 'OBTP-000001', form: '1601-EQ', period: '2026-Q2' }]);
    expect(await reports()).toEqual(before);

    // The payment defaults to what the opening left, per payee.
    const input = birp({ form: '1601-EQ', period: '2026-Q2', amountCents: 920_000 });
    const p = await payPreview(input);
    expect(codes(p.issues)).toEqual([]);
    expect(p.doc).toMatchObject({ payableCents: 920_000, vatClose: null, opening: null });
    expect(p.doc.lines.map((l: { name: string; payableCents: number; amountCents: number }) => [l.name, l.payableCents, l.amountCents])).toEqual([
      ['Sample Audit Firm', 300_000, 300_000], ['Sample Lessor Corp.', 500_000, 500_000], ['Sample Print Shop Co.', 120_000, 120_000],
    ]);
    expect(p.summary).toBe('This will record ₱9,200.00 EWT paid to the BIR with the 1601-EQ for Q2 2026 (eFPS 0928-0001) from Cash in bank – BDO, for 3 payees.');
    const paid = await pay(input);
    expect(journalOf(paid.id).map((l) => [l[0], l[1], l[2], l[3]])).toEqual([
      ['2311', auditor, 300_000, 0], ['2311', lessor, 500_000, 0], ['2311', printer, 120_000, 0], ['1111', null, 0, 920_000],
    ]);
    expect([partyBalance('2311', lessor), partyBalance('2311', printer), partyBalance('2311', auditor)]).toEqual([0, printerQ3, 0]);
    expect(await get('/api/tax/1601eq?year=2026&quarter=2')).toMatchObject({ atcs: [], qap: [], openingCents: 920_000, dueCents: 920_000, paidCents: 920_000, leftCents: 0 });
    const csv = (await accountant.get('/api/tax/1601eq?year=2026&quarter=2&format=csv')).body.replace(/^﻿/, '').replaceAll('"', '').split('\r\n');
    expect(csv).toContain('Left to pay by the old books (OBTP-000001),,,,9200.00');

    // The EWT register, the Q3 worksheets, the QAP and the 2307s to issue: as before the opening and the payment.
    expect(await reports()).toEqual(before);
    const register = ewtRegister(env.db, '2000-01-01', '2999-12-31');
    expect(register.rows.map((r) => r.docType)).toEqual(['ap.bill']);
    expect(register.totals.ewtCents).toBe(register.glEwtCents); // L6
    expect(-balances(env.db)['2311']!).toBe(register.totals.ewtCents + 920_000 - 920_000); // GL = register + opened − paid
    expect((await cancel('tax.payable.opening', id)).json().message).toBe('Cancel these first: BIRP-000001.');
    noBrokenInvariants();
  });

  it('a 0619-E of the cut-over quarter left unpaid goes on its 1601-EQ with the EWT withheld after the cut-over', async () => {
    await setCutover();
    const july = await open(obtp([{ form: '0619-E', period: '2026-07', payees: [{ supplierId: lessor, atc: 'WC100', amountCents: 500_000 }] }]));
    expect(july.statusCode, july.body).toBe(200);
    expect((await get('/api/tax/0619e?month=2026-07'))).toMatchObject({ atcs: [], openingCents: 500_000, dueCents: 500_000, leftCents: 500_000 });
    const bill = await encoder.post('/api/docs/ap.bill/post', {
      input: { supplierId: printer, supplierInvoiceNo: 'SI-0043', supplierInvoiceDate: '2026-09-28', lines: [{ purchase: 'subcontract', amountCents: 560_000 }] }, expectedTotalCents: 560_000,
    }, idem());
    expect(bill.statusCode, bill.body).toBe(200);
    const withheld = -partyBalance('2311', printer);
    await moveTo('2026-10-08T02:00:00Z');
    const eq = await get('/api/tax/1601eq?year=2026&quarter=3');
    expect(eq).toMatchObject({ totals: { ewtCents: withheld }, openingCents: 500_000, remittedCents: 0, dueCents: withheld + 500_000 });
    const p = await payPreview(birp({ form: '1601-EQ', period: '2026-Q3', amountCents: withheld + 500_000 }));
    expect(p.doc.lines.map((l: { partyId: string; amountCents: number }) => [l.partyId, l.amountCents])).toEqual([[lessor, 500_000], [printer, withheld]]);
    const paid = await pay(birp({ form: '1601-EQ', period: '2026-Q3', amountCents: withheld + 500_000 }));
    expect([partyBalance('2311', lessor), partyBalance('2311', printer)]).toEqual([0, 0]);
    // The 1601-EQ took July's opening too, so it stands on it.
    expect((await cancel('tax.payable.opening', july.json().id)).json().message).toBe(`Cancel these first: ${paid.number}.`);
    noBrokenInvariants();
  });

  it('a 1702 stays on 2320; the 1702Q is due with a BIR payment of that quarter', async () => {
    await setCutover();
    const res = await open(obtp([vatQ2(), itQ2(), { form: '1702', period: '2025', amountCents: 4_200_000 }]));
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['3900', null, 14_100_000, 0, 'Opening balance equity', CUTOVER],
      ['2302', null, 0, 8_400_000, '2550Q Q2 2026', CUTOVER],
      ['2320', null, 0, 1_500_000, '1702Q Q2 2026', CUTOVER],
      ['2320', null, 0, 4_200_000, '1702 2025', CUTOVER],
    ]);
    expect((await preview(obtp([vatQ2(), ewtQ2(), itQ2()]))).json().summary).toBe(
      'This will record 3 BIR returns of the old books not yet paid as open on the cut-over date 2026-09-27: ₱84,000.00 VAT (2550Q), ₱9,200.00 EWT (1601-EQ) of 3 suppliers and ₱15,000.00 income tax (1702Q).',
    );
    expect(periodsDue(env.db)).toEqual([{ form: '2550Q', period: '2026-Q2', payableCents: 8_400_000 }, { form: '1702Q', period: '2026-Q2', payableCents: 1_500_000 }]);
    expect((await payPreview(birp({ form: '1702Q', period: '2026-Q2', amountCents: 1_500_000 }))).doc).toMatchObject({ payableCents: 1_500_000, opening: { documentId: id } });
    expect(balances(env.db)['2320']).toBe(-5_700_000);
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date; an edit is a new number on it; a closed opening keeps its payables', async () => {
    await setCutover();
    const id = (await open(obtp([vatQ2(), ewtQ2(), itQ2()]))).json().id as string;
    await moveTo('2026-09-29T02:00:00Z'); // cancelled the next day
    expect((await cancel('tax.payable.opening', id, owner)).statusCode).toBe(403);
    const res = await cancel('tax.payable.opening', id);
    expect(res.statusCode, res.body).toBe(200);
    expect(journalOf(id, 'reversal').map((l) => [l[0], l[1], l[2], l[3], l[5]])).toEqual([
      ['3900', null, 0, 10_820_000, CUTOVER],
      ['2302', null, 8_400_000, 0, CUTOVER],
      ['2311', lessor, 500_000, 0, CUTOVER],
      ['2311', printer, 120_000, 0, CUTOVER],
      ['2311', auditor, 300_000, 0, CUTOVER],
      ['2320', null, 1_500_000, 0, CUTOVER],
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(periodsDue(env.db)).toEqual([]);
    expect(await get('/api/tax/1601eq?year=2026&quarter=2')).toMatchObject({ openingCents: 0, dueCents: 0 });

    // Edit = cancel + a new number, still on the cut-over date; the same returns may be opened again once cancelled.
    const second = (await open(obtp([vatQ2()]))).json();
    expect(second).toMatchObject({ number: 'OBTP-000002', businessDate: CUTOVER });
    const input = obtp([{ ...vatQ2(), amountCents: 8_450_000 }, ewtQ2()], 'Corrected from the filed 2550Q');
    const re = await accountant.post(`/api/docs/tax.payable.opening/${second.id}/reissue`, { input, expectedTotalCents: totalOf(input), businessDate: CUTOVER, reason: 'The filed return shows ₱84,500.00' }, idem());
    expect(re.statusCode, re.body).toBe(200);
    expect(re.json()).toMatchObject({ number: 'OBTP-000003', businessDate: CUTOVER });
    expect(journalOf(second.id, 'reversal').map((l) => l[5])).toEqual([CUTOVER, CUTOVER]);
    expect(balances(env.db)).toEqual({ '2302': -8_450_000, '2311': -920_000, '3900': 9_370_000 });
    expect((await get(`/api/docs/tax.payable.opening/${re.json().id}`)).input).toEqual(input);

    // Closed: 3900 to zero with retained earnings, then the opening stays, and its returns are still paid.
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const ob = await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: account('3201'), debitCents: 9_370_000 }] }, expectedTotalCents: 9_370_000, businessDate: CUTOVER }, idem());
    expect(ob.statusCode, ob.body).toBe(200);
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);
    expect((await cancel('tax.payable.opening', re.json().id)).json()).toMatchObject({ code: 'OPENING_CLOSED' });
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(re.json().id)).toBe('posted');
    expect(journalOf(re.json().id, 'reversal')).toEqual([]);
    await pay(birp({ form: '2550Q', period: '2026-Q2', amountCents: 8_450_000 }));
    expect(balances(env.db)['2302']).toBeUndefined();
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, or once the opening is closed', async () => {
    expect(await errors(obtp([vatQ2()]))).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(obtp([vatQ2()]), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(obtp([vatQ2()]), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(obtp([vatQ2()]), '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect((await open(obtp([vatQ2()]), '2026-09-29')).json().code).toBe('BAD_DATE'); // never a future date (NR-7)
    expect(await errors(obtp([vatQ2()]))).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200); // nothing opened: 3900 is zero
    const closed = await open(obtp([vatQ2()]));
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(balances(env.db)).toEqual({});
  });

  it('a period after the cut-over, the wrong kind of period, and the same form and period twice', async () => {
    await setCutover();
    const q3 = (await preview(obtp([vatQ2(), { form: '2550Q', period: '2026-Q3', amountCents: 100 }]))).json();
    expect(q3.issues).toEqual([expect.objectContaining({
      field: 'rows.1.period', code: 'PERIOD_AFTER_CUTOVER', level: 'error',
      message: 'Row 2: Q3 2026 ends on or after the cut-over date, 2026-09-27. Its VAT is closed and paid in these books.',
    })]);
    const oct = (await preview(obtp([{ form: '0619-E', period: '2026-10', payees: [{ supplierId: lessor, atc: 'WC100', amountCents: 100 }] }]))).json();
    expect(oct.issues).toEqual([expect.objectContaining({
      code: 'PERIOD_AFTER_CUTOVER', message: 'Row 1: October 2026 begins on or after the cut-over date, 2026-09-27. EWT withheld after it comes in with the bills and vouchers.',
    })]);
    expect(await errors(obtp([{ ...itQ2(), period: '2026-Q3' }]))).toEqual(['PERIOD_AFTER_CUTOVER']);
    expect(await errors(obtp([{ form: '1702', period: '2026', amountCents: 100 }]))).toEqual(['PERIOD_AFTER_CUTOVER']);
    expect(await errors(obtp([{ ...ewtQ2(), period: '2026-Q4' }]))).toEqual(['PERIOD_AFTER_CUTOVER']);
    expect(await errors(obtp([{ ...ewtQ2(), period: '2026-Q3' }]))).toEqual([]); // began before the cut-over: the old books' part of it
    expect(await errors(obtp([{ form: '0619-E', period: '2026-09', payees: [{ supplierId: lessor, atc: 'WC100', amountCents: 100 }] }]))).toEqual(['THIRD_MONTH']);
    expect(await errors(obtp([{ ...itQ2(), period: '2025-Q4' }]))).toEqual(['NO_Q4']);
    expect(await errors(obtp([{ ...vatQ2(), period: '2026-06' }]))).toEqual(['PERIOD']);
    expect(await errors(obtp([{ form: '1702', period: '2025-Q4', amountCents: 100 }]))).toEqual(['PERIOD']);
    expect(await errors(obtp([{ ...ewtQ2(), period: '2026-04' }]))).toEqual(['PERIOD']);

    const twice = (await preview(obtp([vatQ2(), vatQ2()]))).json();
    expect(twice.issues).toEqual([expect.objectContaining({ code: 'SAME_RETURN', level: 'error', message: 'Row 2: the 2550Q for Q2 2026 is on this opening already. Put all of a return on one row.' })]);
    expect((await open(obtp([vatQ2(), ewtQ2()]))).statusCode).toBe(200);
    expect((await preview(obtp([{ ...ewtQ2(), payees: [{ supplierId: auditor, atc: 'WC010', amountCents: 1 }] }]))).json().issues).toEqual([
      expect.objectContaining({ code: 'SAME_RETURN', message: 'Row 1: the 1601-EQ for Q2 2026 is on OBTP-000001 already. Put all of a return on one row.' }),
    ]);
    expect(await errors(obtp([{ ...vatQ2(), period: '2026-Q1' }, itQ2()]))).toEqual([]); // other returns are fine
    const refused = await open(obtp([itQ2(), vatQ2()]));
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toBe('Row 2: the 2550Q for Q2 2026 is on OBTP-000001 already. Put all of a return on one row.');
  });

  it('a quarter whose 2550Q was opened here cannot also be closed here', async () => {
    await setCutover();
    expect((await open(obtp([vatQ2()]))).statusCode).toBe(200);
    // Output VAT of Q2 left in these books by a journal voucher: closing Q2 would make its VAT payable twice.
    const customer = seedCustomers(env.db, encoder.userId).school;
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const jv = await accountant.post('/api/docs/acc.jv/post', {
      input: { memo: 'Output VAT of a June sale', lateReason: 'Found in the June folder', lines: [{ accountId: account('1101'), debitCents: 12_000 }, { accountId: account('2301'), party: { type: 'customer', id: customer }, creditCents: 12_000 }] },
      expectedTotalCents: 12_000, businessDate: '2026-06-30',
    }, idem());
    expect(jv.statusCode, jv.body).toBe(200);
    expect((await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 2 } })).json().issues).toEqual([
      expect.objectContaining({ code: 'OPENED_AT_CUTOVER', level: 'error', message: "Q2 2026's 2550Q was brought in from the old books by OBTP-000001. Its VAT payable is there already, so there is nothing to close here." }),
    ]);
  });

  it('a quarter with a VAT close here, a supplier twice or not active; the input, and who may record and view', async () => {
    await setCutover();
    // Output VAT of Q1 recorded here by a journal voucher, and Q1 closed in these books.
    const customer = seedCustomers(env.db, encoder.userId).school;
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const jv = await accountant.post('/api/docs/acc.jv/post', {
      input: { memo: 'Output VAT of a March sale', lateReason: 'Found in the March folder', lines: [{ accountId: account('1101'), debitCents: 12_000 }, { accountId: account('2301'), party: { type: 'customer', id: customer }, creditCents: 12_000 }] },
      expectedTotalCents: 12_000, businessDate: '2026-03-31',
    }, idem());
    expect(jv.statusCode, jv.body).toBe(200);
    const total = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 1 } })).json().totalCents;
    const close = await accountant.post('/api/docs/tax.vat_close/post', { input: { year: 2026, quarter: 1 }, expectedTotalCents: total }, idem());
    expect(close.statusCode, close.body).toBe(200);
    expect((await preview(obtp([{ ...vatQ2(), period: '2026-Q1' }]))).json().issues).toEqual([
      expect.objectContaining({ code: 'VAT_CLOSED', message: 'Row 1: Q1 2026 has a VAT close in these books (VATC-000001): its 2550Q pays what the close made payable.' }),
    ]);
    const dup = ewtQ2();
    dup.payees.push({ supplierId: lessor, atc: 'WC100', amountCents: 1 });
    expect((await preview(obtp([dup]))).json().issues).toEqual([
      expect.objectContaining({ field: 'rows.0.payees.3.supplierId', code: 'SAME_PAYEE', message: 'Row 1: Sample Lessor Corp. is on the 1601-EQ for Q2 2026 twice under WC100. Add the amounts up.' }),
    ]);
    dup.payees[3] = { supplierId: lessor, atc: 'WI100', amountCents: 1 };
    expect(await errors(obtp([dup]))).toEqual([]); // another ATC of the same supplier
    dup.payees[3] = { supplierId: 'no-such-supplier', atc: 'WI100', amountCents: 1 };
    expect(await errors(obtp([dup]))).toEqual(['SUPPLIER']);

    const bad = (input: unknown) => preview(input).then((r) => r.json().code);
    expect(await bad({ rows: [] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...vatQ2(), payees: ewtQ2().payees }] })).toBe('INVALID_INPUT'); // a 2550Q has no payees
    expect(await bad({ rows: [{ ...ewtQ2(), amountCents: 920_000 }] })).toBe('INVALID_INPUT'); // an EWT return's amount is its payees'
    expect(await bad({ rows: [{ ...ewtQ2(), payees: [] }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ form: '1601-C', period: '2026-Q2', amountCents: 1 }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...vatQ2(), amountCents: 0 }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...ewtQ2(), payees: [{ supplierId: lessor, atc: 'WC999', amountCents: 1 }] }] })).toBe('INVALID_INPUT');
    expect(await bad({ ...obtp([vatQ2()]), businessDate: CUTOVER })).toBe('INVALID_INPUT');

    expect((await open(obtp([vatQ2()]), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(obtp([vatQ2()]), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/tax.payable.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/tax.payable.opening')).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random openings post balanced, BIR payments pay exactly what they left, registers never see them, cancels land on the cut-over date', async () => {
    await setCutover();
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate', 'tax.payment.create', 'tax.payment.post', 'tax.payment.cancel'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const post = (input: OpeningPayableInput) => postDocument(e, openingPayableDoc, actor, { input, expectedTotalCents: totalOf(input), businessDate: CUTOVER });
    const posted = (sql: string) => env.db.prepare(sql).pluck().get() as number;
    const stats = { opened: 0, paid: 0, cancelled: 0 };
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 4 }), (ops) => {
        for (const [seed, payIt, cancelIt] of ops) {
          let input: OpeningPayableInput;
          try {
            input = fc.sample(openingPayableDoc.arbitrary(env.db), { numRuns: 1, seed })[0]!;
          } catch (err) {
            if (String(err).includes('Nothing left to open')) continue;
            throw err;
          }
          const doc = openingPayableDoc.compute(input, ctx());
          expect(openingPayableDoc.validate(doc, ctx()).filter((i) => i.level === 'error')).toEqual([]);
          const lines = resolveDraft(env.db, openingPayableDoc.journal!(doc, ctx())!);
          expect(lines.map((l) => [l.account.role_key, l.party?.id ?? null, l.debitCents, l.creditCents])).toEqual([
            ['OPENING_EQUITY', null, doc.totalCents, 0],
            ...input.rows.flatMap((r) => 'payees' in r
              ? r.payees.map((p) => ['EWT_PAYABLE', p.supplierId, 0, p.amountCents])
              : [[r.form === '2550Q' ? 'VAT_PAYABLE' : 'INCOME_TAX_PAYABLE', null, 0, r.amountCents]]),
          ]);
          const o = post(input);
          stats.opened++;
          expect(openingPayableDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingPayableDoc.toInput(doc)).toEqual(input);
          const payments: string[] = [];
          if (payIt) {
            // Pay each 2550Q and EWT return it opened, in full, with what the payment says is left.
            for (const r of input.rows) {
              if (r.form === '1702Q' || r.form === '1702') continue;
              const due = periodsDue(env.db).find((d) => d.form === r.form && d.period === r.period);
              if (!due) continue; // a 0619-E whose 1601-EQ was paid already
              const pay = { form: r.form, period: r.period, cashPlaceId: BDO, amountCents: due.payableCents, reference: 'eFPS 0928-0002' };
              try {
                const computed = birPaymentDoc.compute(pay, { ...ctx(), businessDate: '2026-09-28' });
                const p = postDocument(e, birPaymentDoc, actor, { input: pay, expectedTotalCents: previewDocument(e, birPaymentDoc, actor, pay).totalCents });
                expect(birPaymentDoc.load(env.db, p.id)).toEqual(computed);
                payments.push(p.id);
                stats.paid++;
              } catch (err) {
                if (!(err instanceof AppError && err.code === 'VALIDATION')) throw err;
              }
            }
          }
          if (cancelIt) {
            for (const p of payments.reverse()) cancelDocument(e, birPaymentDoc, actor, p, 'Paid against the wrong return');
            try {
              cancelDocument(e, openingPayableDoc, actor, o.id, 'Recorded twice by mistake');
              stats.cancelled++;
            } catch (err) {
              // An earlier 1601-EQ payment took this opening's 0619-E of its quarter: it stands on it.
              if (!(err instanceof AppError && err.code === 'HAS_DEPENDENTS')) throw err;
            }
          }
        }
        const opened = (form: string) =>
          posted(`SELECT COALESCE(SUM(l.amount_cents), 0) FROM tax_opening_payable_lines l JOIN documents d ON d.id = l.document_id WHERE d.status = 'posted' AND l.form IN (${form})`);
        const paidWith = (form: string) =>
          posted(`SELECT COALESCE(SUM(p.amount_cents), 0) FROM tax_bir_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted' AND p.form IN (${form})`);
        const b = balances(env.db);
        expect(b['2302'] ?? 0).toBe(paidWith(`'2550Q'`) - opened(`'2550Q'`));
        expect(b['2311'] ?? 0).toBe(paidWith(`'0619-E', '1601-EQ'`) - opened(`'0619-E', '1601-EQ'`));
        expect(b['2320'] ?? 0).toBe(0 - opened(`'1702Q', '1702'`));
        expect(b['3900'] ?? 0).toBe(opened(`'2550Q', '0619-E', '1601-EQ', '1702Q', '1702'`));
        // A payment never pays more than an opening left: no supplier ends in debit on 2311.
        for (const s of [lessor, printer, auditor]) expect(partyBalance('2311', s)).toBeLessThanOrEqual(0);
        // The EWT register never lists an opening or a payment, and ties to the GL (L6).
        const register = ewtRegister(env.db, '2000-01-01', '2999-12-31');
        expect(register.rows).toEqual([]);
        expect(register.glEwtCents).toBe(0);
        const reversals = env.db
          .prepare(`SELECT DISTINCT j.business_date FROM journals j JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'tax.payable.opening' AND j.posting_kind = 'reversal'`)
          .pluck()
          .all();
        expect(reversals.filter((d) => d !== CUTOVER)).toEqual([]);
        noBrokenInvariants();
      }),
      { numRuns: 25 },
    );
    expect(stats.opened).toBeGreaterThan(0);
    expect(stats.paid).toBeGreaterThan(0);
    expect(stats.cancelled).toBeGreaterThan(0);
  });
});
