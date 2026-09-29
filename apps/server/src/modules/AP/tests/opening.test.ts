/**
 * Opening supplier bills (OBAP-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): Dr 3900 / Cr 2101 on the cut-over date,
 * paid like any bill afterwards, on the supplier's AP page, never in the EWT register or the 2307s; cancelled on the
 * cut-over date while the opening is open and only after its payments; the refusals and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AppError } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { openingBillDoc, type OpeningBillInput } from '../doctypes/opening.ts';
import { paymentDoc, type PaymentInput } from '../doctypes/payment.ts';
import { owedOnBill } from '../ledger.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let BDO: number;
let equipment: string;

const newSupplier = async (s: { name: string; tin?: string; isVatRegistered?: boolean; ewtClass?: string; paymentTermsDays?: number }) =>
  (await accountant.post('/api/pur/suppliers', { registeredName: `${s.name} Inc.`, isVatRegistered: false, ...s })).json().id as string;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  BDO = cashPlaceId(env.db, '1111');
  equipment = await newSupplier({ name: 'Sample Equipment Supply', tin: '444-555-666-000', isVatRegistered: true, ewtClass: 'contractor_2' });
});

const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
/** The PLAN D8 example: equipment payable ₱384,511.10 still open at the cut-over date. */
const obap = (over: Partial<OpeningBillInput> = {}): OpeningBillInput => ({
  supplierId: equipment, supplierInvoiceNo: 'SI-2211', supplierInvoiceDate: '2026-03-15', dueDate: '2026-10-15', owedCents: 38_451_110, ...over,
});
const open = (input: OpeningBillInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/ap.opening/post', { input, expectedTotalCents: input.owedCents, ...(businessDate ? { businessDate } : {}) }, idem());
const errors = async (input: OpeningBillInput, businessDate: string | null = CUTOVER) => {
  const r = await accountant.post('/api/docs/ap.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
  return r.json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
};
const pay = (c: Client, billId: string, amountCents: number): Promise<{ statusCode: number; json(): any }> =>
  c.post('/api/docs/ap.payment/post', { input: { supplierId: equipment, bills: [{ billId, amountCents }], tenders: [{ cashPlaceId: BDO, amountCents }] }, expectedTotalCents: amountCents }, idem());
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
/** A journal of a document: [code, party id, ref, debit, credit, date] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? AND j.source_type = 'document' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
/** What is still owed on a bill (+ 0: the ledger's negation gives -0 once nothing is owed). */
const owed = (billId: string) => owedOnBill(env.db, billId) + 0;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const openingState = async () => (await accountant.get('/api/acc/opening')).json();

describe('opening supplier bill golden (PLAN D8 step 3)', () => {
  it('one bill: Dr 3900 / Cr 2101 for the supplier with the bill as ref, dated the cut-over date', async () => {
    await setCutover();
    const pre = await accountant.post('/api/docs/ap.opening/preview', { input: obap(), businessDate: CUTOVER });
    expect(pre.json()).toMatchObject({
      totalCents: 38_451_110,
      issues: [],
      summary: 'This will record ₱384,511.10 still owed to Sample Equipment Supply on invoice no. SI-2211 of 2026-03-15, due 2026-10-15, as open on the cut-over date 2026-09-27.',
    });
    const res = await open(obap());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBAP-000001', businessDate: CUTOVER, totalCents: 38_451_110, warnings: [] });
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['3900', null, null, 38_451_110, 0, CUTOVER],
      ['2101', equipment, id, 0, 38_451_110, CUTOVER],
    ]);
    expect(balances(env.db)).toEqual({ '3900': 38_451_110, '2101': -38_451_110 });
    expect(owed(id)).toBe(38_451_110);

    // Listed with OB- on the opening screen; 2101 ties to its suppliers there.
    const s = await openingState();
    expect(s.openingEquityCents).toBe(38_451_110);
    expect(s.documents).toMatchObject([{ docType: 'ap.opening', number: 'OBAP-000001', businessDate: CUTOVER, status: 'posted', totalCents: 38_451_110 }]);
    expect(s.checks.find((c: { code: string }) => c.code === '2101')).toMatchObject({ controlCents: -38_451_110, partiesCents: -38_451_110, ok: true });
    expect((await setCutover('2026-09-20')).json()).toMatchObject({ code: 'OPENING_POSTED', message: 'OBAP-000001 is dated 2026-09-27. Cancel it before moving the cut-over date.' });

    // Stored as a bill with no lines, no VAT and no EWT; the form input comes back as typed.
    expect(env.db.prepare('SELECT gross_cents, input_vat_cents, ewt_class, ewt_cents, payable_cents FROM ap_bills WHERE document_id = ?').raw().get(id)).toEqual([38_451_110, 0, null, 0, 38_451_110]);
    expect(env.db.prepare('SELECT COUNT(*) FROM ap_bill_lines WHERE document_id = ?').pluck().get(id)).toBe(0);
    expect((await accountant.get(`/api/docs/ap.opening/${id}`)).json().input).toEqual(obap());
    noBrokenInvariants();
  });

  it('a part payment and then the rest, after the cut-over date, as on any bill', async () => {
    await setCutover();
    const id = (await open(obap())).json().id as string;
    const first = await pay(encoder, id, 10_000_000);
    expect(first.json()).toMatchObject({ number: 'SPAY-000001', businessDate: '2026-09-28', summary: 'This will record paying Sample Equipment Supply ₱100,000.00 on OBAP-000001: ₱100,000.00 from Cash in bank – BDO.' });
    expect(journalOf(first.json().id)).toEqual([['2101', equipment, id, 10_000_000, 0, '2026-09-28'], ['1111', null, null, 0, 10_000_000, '2026-09-28']]);
    expect(owed(id)).toBe(28_451_110);
    const over = await pay(encoder, id, 28_451_111);
    expect(over.json()).toMatchObject({ code: 'VALIDATION', message: 'Only ₱284,511.10 is still owed on OBAP-000001.' });

    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    const rest = await pay(encoder, id, 28_451_110);
    expect(journalOf(rest.json().id)).toEqual([['2101', equipment, id, 28_451_110, 0, '2026-09-29'], ['1111', null, null, 0, 28_451_110, '2026-09-29']]);
    expect(owed(id)).toBe(0);
    expect((await pay(encoder, id, 1)).json().message).toBe('OBAP-000001 is fully paid.');
    expect(balances(env.db)).toEqual({ '3900': 38_451_110, '1111': -38_451_110 });
    noBrokenInvariants();
  });

  it("the supplier's AP page lists it with the bills; the EWT register, the 2307s and the purchases register leave it out", async () => {
    await setCutover();
    const obId = (await open(obap())).json().id as string;
    await pay(encoder, obId, 10_000_000);
    // A new bill of the same supplier after the cut-over: contractor 2% on the amount before VAT.
    const b = await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: equipment, supplierInvoiceNo: 'SI-2300', supplierInvoiceDate: '2026-09-28', dueDate: '2026-10-28', lines: [{ purchase: 'subcontract', amountCents: 112_000 }] }, expectedTotalCents: 112_000 }, idem());
    const billId = b.json().id as string;
    expect(journalOf(billId).map((l) => l.slice(0, 5))).toEqual([['5301', null, null, 100_000, 0], ['1401', equipment, null, 12_000, 0], ['2311', equipment, null, 0, 2_000], ['2101', equipment, billId, 0, 110_000]]);

    const ap = (await encoder.get(`/api/ap/suppliers/${equipment}`)).json();
    expect(ap).toMatchObject({ supplierName: 'Sample Equipment Supply', balanceCents: 28_561_110 });
    expect(ap.bills).toEqual([
      expect.objectContaining({ docType: 'ap.bill', number: 'BILL-000001', supplierInvoiceNo: 'SI-2300', payableCents: 110_000, paidCents: 0, owedCents: 110_000 }),
      expect.objectContaining({
        docType: 'ap.opening', number: 'OBAP-000001', status: 'posted', date: CUTOVER, supplierInvoiceNo: 'SI-2211', supplierInvoiceDate: '2026-03-15', dueDate: '2026-10-15',
        grossCents: 38_451_110, ewtCents: 0, payableCents: 38_451_110, paidCents: 10_000_000, owedCents: 28_451_110,
      }),
    ]);
    expect(ap.payments).toMatchObject([{ number: 'SPAY-000001', totalCents: 10_000_000, bills: [{ billNumber: 'OBAP-000001', amountCents: 10_000_000 }] }]);
    expect((await encoder.get('/api/ap/suppliers')).json()).toEqual([{ supplierId: equipment, supplierName: 'Sample Equipment Supply', balanceCents: 28_561_110, advancesCents: 0, netCents: 28_561_110 }]);

    const ewt = (await accountant.get('/api/tax/registers/ewt?from=2026-01-01&to=2026-12-31')).json();
    expect(ewt.rows.map((r: { documentNumber: string }) => r.documentNumber)).toEqual(['BILL-000001']);
    expect(ewt.totals).toEqual({ baseCents: 100_000, ewtCents: 2_000 });
    const certs = (await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json();
    expect(certs.lines).toMatchObject([{ supplierId: equipment, ewtClass: 'contractor_2', baseCents: 100_000, ewtCents: 2_000 }]);
    const purchases = (await accountant.get('/api/tax/registers/purchases?from=2026-01-01&to=2026-12-31')).json();
    expect(purchases.rows.map((r: { documentNumber: string }) => r.documentNumber)).toEqual(['BILL-000001']);
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date, only after the payments on it; an edit keeps the invoice number', async () => {
    await setCutover();
    const id = (await open(obap())).json().id as string;
    const payId = (await pay(encoder, id, 10_000_000)).json().id as string;
    env.clock.advance(24 * 3600_000); // cancelled the next day, 2026-09-29
    accountant = await env.as('accountant');
    encoder = await env.as('encoder');
    const blocked = await cancel(accountant, 'ap.opening', id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: SPAY-000001.' });
    expect((await cancel(encoder, 'ap.payment', payId)).statusCode).toBe(403);
    expect((await cancel(accountant, 'ap.payment', payId)).statusCode).toBe(200);
    expect(journalOf(payId, 'reversal')).toEqual([['2101', equipment, id, 0, 10_000_000, '2026-09-29'], ['1111', null, null, 10_000_000, 0, '2026-09-29']]);

    expect((await cancel(accountant, 'ap.opening', id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['3900', null, null, 0, 38_451_110, CUTOVER],
      ['2101', equipment, id, 38_451_110, 0, CUTOVER],
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(owed(id)).toBe(0);
    expect((await accountant.get(`/api/ap/suppliers/${equipment}`)).json()).toMatchObject({ balanceCents: 0, bills: [{ number: 'OBAP-000001', status: 'cancelled', owedCents: 0 }] });
    expect((await pay(accountant, id, 100)).json().details.map((i: { code: string }) => i.code)).toEqual(['BILL_CANCELLED']);
    expect((await openingState()).documents).toMatchObject([{ number: 'OBAP-000001', status: 'cancelled' }]);

    // Edit = cancel + a new number, still on the cut-over date; the replacement carries the same supplier invoice number.
    const second = (await open(obap({ owedCents: 20_000_000 }))).json();
    expect(second).toMatchObject({ number: 'OBAP-000002', businessDate: CUTOVER });
    const input = obap({ owedCents: 20_500_000, note: 'Balance after the September part payment' });
    const r = await accountant.post(`/api/docs/ap.opening/${second.id}/reissue`, { input, expectedTotalCents: 20_500_000, businessDate: CUTOVER, reason: 'The supplier statement shows more' }, idem());
    expect(r.json()).toMatchObject({ number: 'OBAP-000003', businessDate: CUTOVER });
    expect(journalOf(second.id, 'reversal').map((l) => l[5])).toEqual([CUTOVER, CUTOVER]);
    expect(balances(env.db)).toEqual({ '3900': 20_500_000, '2101': -20_500_000 });
    expect((await accountant.get(`/api/docs/ap.opening/${r.json().id}`)).json().input).toEqual(input);
    noBrokenInvariants();
  });

  it('after the opening is closed it stays, and is still paid like any bill', async () => {
    await setCutover();
    const id = (await open(obap())).json().id as string;
    const cash = env.db.prepare(`SELECT id FROM accounts WHERE code = '1111'`).pluck().get() as number;
    await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: cash, debitCents: 38_451_110 }] }, expectedTotalCents: 38_451_110, businessDate: CUTOVER }, idem());
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);

    const refused = await cancel(accountant, 'ap.opening', id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('OPENING_CLOSED');
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(id)).toBe('posted');
    expect(journalOf(id, 'reversal')).toEqual([]);
    expect((await pay(encoder, id, 38_451_110)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, or once the opening is closed', async () => {
    expect(await errors(obap())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(obap(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(obap(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(obap(), '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect((await open(obap(), '2026-09-29')).json().code).toBe('BAD_DATE'); // never a future date (NR-7)
    expect(await errors(obap())).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200); // nothing opened: 3900 is zero
    const closed = await open(obap());
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(balances(env.db)).toEqual({});
  });

  it('a supplier invoice number already on a bill of the supplier, opening or not', async () => {
    await setCutover();
    expect((await open(obap())).statusCode).toBe(200);
    const dup = await open(obap({ owedCents: 100 }));
    expect(dup.statusCode).toBe(422);
    expect(dup.json()).toMatchObject({ code: 'VALIDATION', message: 'Invoice no. SI-2211 of this supplier is already on OBAP-000001.' });
    const bill = await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: equipment, supplierInvoiceNo: 'SI-2211', supplierInvoiceDate: '2026-09-28', lines: [{ purchase: 'freight_in', amountCents: 100 }] }, expectedTotalCents: 100 }, idem());
    expect(bill.json()).toMatchObject({ code: 'VALIDATION', message: 'Invoice no. SI-2211 of this supplier is already on OBAP-000001.' });
    const b = await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: equipment, supplierInvoiceNo: 'SI-2212', supplierInvoiceDate: '2026-09-27', lines: [{ purchase: 'freight_in', amountCents: 100 }] }, expectedTotalCents: 100 }, idem());
    expect(await errors(obap({ supplierInvoiceNo: 'SI-2212' }))).toEqual(['DUPLICATE_INVOICE']);
    const other = await newSupplier({ name: 'Sample Thread Supply', tin: '555-666-777-000' });
    expect(await errors(obap({ supplierId: other }))).toEqual([]);
    await cancel(accountant, 'ap.bill', b.json().id);
    expect(await errors(obap({ supplierInvoiceNo: 'SI-2212' }))).toEqual([]);
  });

  it('dates, the supplier, and who may record it', async () => {
    await setCutover();
    expect(await errors(obap({ supplierInvoiceDate: '2026-09-28', dueDate: '2026-10-28' }))).toEqual(['INVOICE_DATE']);
    expect((await accountant.post('/api/docs/ap.opening/preview', { input: obap({ supplierInvoiceDate: '2026-09-28', dueDate: '2026-10-28' }), businessDate: CUTOVER })).json().issues[0].message)
      .toBe('The invoice date cannot be after the cut-over date, 2026-09-27.');
    expect(await errors(obap({ dueDate: '2026-03-14' }))).toEqual(['DUE_DATE']);
    expect(await errors(obap({ dueDate: '2026-03-15' }))).toEqual([]); // due on receipt; already past due at the cut-over is fine too
    expect(await errors(obap({ supplierId: 'no-such-supplier' }))).toEqual(['SUPPLIER']);
    expect((await accountant.post('/api/docs/ap.opening/preview', { input: { ...obap(), inputVatCents: 1 }, businessDate: CUTOVER })).json().code).toBe('INVALID_INPUT');
    expect((await open(obap(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(obap(), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/ap.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/ap.opening')).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random opening bills and payments post balanced, never overpay, keep 3900 = Σ opening bills, and cancel to zero', async () => {
    await setCutover();
    await newSupplier({ name: 'Sample Lessor', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' });
    await newSupplier({ name: 'Sample Tailoring Shop', tin: '222-333-444-000', ewtClass: 'contractor_2' });
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate', 'ap.pay.create', 'ap.pay.post', 'ap.pay.cancel'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    let n = 0; // number the invoices so they never repeat (duplicates are tested above)
    const openings = openingBillDoc.arbitrary(env.db).map((b) => ({ ...b, supplierInvoiceNo: `SI-P${++n}` }));
    const post = (input: OpeningBillInput) => postDocument(e, openingBillDoc, actor, { input, expectedTotalCents: input.owedCents, businessDate: CUTOVER });
    for (const input of fc.sample(openings, { numRuns: 4, seed: 7 })) post(input);
    const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
    fc.assert(
      fc.property(fc.array(fc.tuple(openings, paymentDoc.arbitrary(env.db), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [oi, pi, cancelOpening, cancelPay] of ops) {
          const doc = openingBillDoc.compute(oi, ctx());
          expect(openingBillDoc.validate(doc, ctx())).toEqual([]);
          const lines = resolveDraft(env.db, openingBillDoc.journal!(doc, ctx())!);
          expect(lines.map((l) => [l.account.role_key, l.debitCents, l.creditCents])).toEqual([['OPENING_EQUITY', oi.owedCents, 0], ['AP', 0, oi.owedCents]]);
          const o = post(oi);
          expect(openingBillDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingBillDoc.toInput(doc)).toEqual(oi);
          if (cancelOpening) cancelDocument(e, openingBillDoc, actor, o.id, 'Recorded twice by mistake');
          try {
            const p = postDocument(e, paymentDoc, actor, { input: pi as PaymentInput, expectedTotalCents: sum(pi.tenders) });
            if (cancelPay) cancelDocument(e, paymentDoc, actor, p.id, 'Paid from the wrong bank');
          } catch (x) {
            expect((x as AppError & { details: { code: string }[] }).details.map((i) => i.code)).toEqual(['MORE_THAN_OWED']);
          }
        }
        const rows = env.db
          .prepare(
            `SELECT b.document_id AS id, b.payable_cents AS payable, b.payable_cents - COALESCE((SELECT SUM(p.amount_cents) FROM ap_payment_bills p JOIN documents pd ON pd.id = p.document_id
               WHERE p.bill_id = b.document_id AND pd.status = 'posted'), 0) AS owed FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE d.status = 'posted'`,
          )
          .all() as { id: string; payable: number; owed: number }[];
        for (const r of rows) {
          expect(r.owed).toBeGreaterThanOrEqual(0);
          expect(owed(r.id)).toBe(r.owed);
        }
        const b = balances(env.db);
        expect(-(b['2101'] ?? 0)).toBe(rows.reduce((s, r) => s + r.owed, 0));
        expect(b['3900'] ?? 0).toBe(rows.reduce((s, r) => s + r.payable, 0));
        const reversals = env.db.prepare(`SELECT DISTINCT j.business_date FROM journals j JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'ap.opening' AND j.posting_kind = 'reversal'`).pluck().all();
        expect(reversals.filter((d) => d !== CUTOVER)).toEqual([]);
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
