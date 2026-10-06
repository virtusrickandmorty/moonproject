/**
 * Printed dates (owner's decision of 6 Oct 2026): an invoice record, a collection, a supplier bill and an expense voucher
 * carry the date printed on the booklet or supplier document, given when it is typed (today when none is given). The
 * journal and so the sales and purchases registers follow that date; numbers follow the order typed; the audit trail keeps
 * the day typed. A date after today, a date that does not exist, and a date in a month signed off at month-end are refused.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from './helpers.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { seedCustomers } from '../src/modules/JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number, supplierId: string;

const goTo = async (iso: string) => {
  env.clock.set(iso);
  [encoder, accountant] = await Promise.all([env.as('encoder'), env.as('accountant')]);
};
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const post = (type: string, input: object, total: number, businessDate?: string, who = encoder) =>
  who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total, ...(businessDate === undefined ? {} : { businessDate }) }, idem());
/** The document's date and its journal's date. */
const dates = (id: string) => ({
  document: env.db.prepare('SELECT business_date FROM documents WHERE id = ?').pluck().get(id),
  journals: env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE source_id = ? AND source_type = 'document'`).pluck().all(id),
});
const typedOn = (id: string) => JSON.parse(env.db.prepare(`SELECT data FROM audit_log WHERE action = 'document.post' AND entity_id = ?`).pluck().get(id) as string);
const register = async (kind: 'sales' | 'purchases', from: string, to: string) =>
  ((await accountant.get(`/api/tax/registers/${kind}?from=${from}&to=${to}`)).json().rows as { date: string; documentNumber: string }[]).map((r) => [r.date, r.documentNumber]);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

const bill = (invoiceNo: string, date: string) => ({ supplierId, supplierInvoiceNo: invoiceNo, supplierInvoiceDate: date, lines: [{ categoryId: cat('6120'), amountCents: 112_000 }] });
const voucher = (receiptNo: string, date: string) => ({
  categoryId: cat('6120'), amountCents: 56_000, description: 'Light bulbs', payeeName: 'Sample Hardware', payeeVatRegistered: true, payeeTin: '123-456-789-000',
  supplierInvoiceNo: receiptNo, supplierInvoiceDate: date, tenders: [{ cashPlaceId: CASH, amountCents: 56_000 }],
});
const collection = (crNumber: string, jo: string, cents: number) => ({ customerId: c.school, crNumber, applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }] });

/** A ₱56,000 job order recorded and released on 15 September with its invoice to follow. Returns the JO and the release. */
async function releasedInSeptember(): Promise<{ jo: string; release: string }> {
  await goTo('2026-09-15T02:00:00Z');
  const lines = [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }];
  const jo = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: 5_600_000 }, idem());
  expect(jo.statusCode, jo.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo.json().id}/stage`, { from, to })).statusCode).toBe(200);
  const body = { jobOrderId: jo.json().id, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 };
  const rel = await accountant.post('/api/jo/releases', { release: body, invoice: null, expectedTotalCents: 5_600_000 }, idem());
  expect(rel.statusCode, rel.body).toBe(200);
  return { jo: jo.json().id, release: rel.json().release.id };
}

beforeEach(async () => {
  env = await createTestEnv('2026-09-15T02:00:00Z');
  await goTo('2026-09-15T02:00:00Z');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
  supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '222-333-444-000', isVatRegistered: true })).json().id;
});

describe('a printed date in an earlier open month', () => {
  it('an invoice record and a collection typed in October land in September: journal, sales register and the document', async () => {
    const { jo, release } = await releasedInSeptember();
    await goTo('2026-10-06T02:00:00Z');
    const ir = await post('jo.invoice_record', { releaseId: release, invoiceNumber: '0801' }, 5_600_000, '2026-09-20');
    expect(ir.statusCode, ir.body).toBe(200);
    expect(ir.json()).toMatchObject({ number: 'IR-000001', businessDate: '2026-09-20' });
    expect(dates(ir.json().id)).toEqual({ document: '2026-09-20', journals: ['2026-09-20'] });
    expect(await register('sales', '2026-09-01', '2026-09-30')).toEqual([['2026-09-20', 'IR-000001']]);
    expect(await register('sales', '2026-10-01', '2026-10-31')).toEqual([]);

    const col = await post('col.collection', collection('0201', jo, 5_600_000), 5_600_000, '2026-09-25');
    expect(col.statusCode, col.body).toBe(200);
    expect(dates(col.json().id)).toEqual({ document: '2026-09-25', journals: ['2026-09-25'] });
    expect(typedOn(col.json().id)).toMatchObject({ businessDate: '2026-09-25', typedOn: '2026-10-06' });

    // The detail shows both: the printed date as the document's date, and when it was typed.
    const view = (await accountant.get(`/api/docs/col.collection/${col.json().id}`)).json();
    expect(view.header).toMatchObject({ businessDate: '2026-09-25', postedAt: expect.stringMatching(/^2026-10-06T/) });
    noBrokenInvariants();
  });

  it('a supplier bill and an expense voucher land in September\'s purchases register; numbers follow the order typed', async () => {
    await goTo('2026-10-06T02:00:00Z');
    const one = await post('ap.bill', bill('SI-1', '2026-09-18'), 112_000, '2026-09-18');
    expect(one.statusCode, one.body).toBe(200);
    const two = await post('ap.bill', bill('SI-2', '2026-10-05'), 112_000); // no printed date: today, as before
    const three = await post('ap.bill', bill('SI-3', '2026-09-10'), 112_000, '2026-09-10');
    expect([one, two, three].map((r) => [r.json().number, r.json().businessDate])).toEqual([['BILL-000001', '2026-09-18'], ['BILL-000002', '2026-10-06'], ['BILL-000003', '2026-09-10']]);
    expect(dates(three.json().id)).toEqual({ document: '2026-09-10', journals: ['2026-09-10'] });

    const exp = await post('exp.voucher', voucher('OR-77', '2026-09-19'), 56_000, '2026-09-19');
    expect(exp.statusCode, exp.body).toBe(200);
    expect(dates(exp.json().id)).toEqual({ document: '2026-09-19', journals: ['2026-09-19'] });
    expect(typedOn(exp.json().id)).toMatchObject({ businessDate: '2026-09-19', typedOn: '2026-10-06' });

    expect(await register('purchases', '2026-09-01', '2026-09-30')).toEqual([['2026-09-10', 'BILL-000003'], ['2026-09-18', 'BILL-000001'], ['2026-09-19', 'EXP-000001']]);
    expect(await register('purchases', '2026-10-01', '2026-10-31')).toEqual([['2026-10-06', 'BILL-000002']]);
    noBrokenInvariants();
  });

  it('a receipt or invoice dated after the printed date is refused in plain words', async () => {
    await goTo('2026-10-06T02:00:00Z');
    const res = await post('ap.bill', bill('SI-9', '2026-09-20'), 112_000, '2026-09-18');
    expect(res.json()).toMatchObject({ code: 'VALIDATION', message: 'The invoice date cannot be after the date printed on it (2026-09-18).' });
    const today = await post('ap.bill', bill('SI-9', '2026-10-07'), 112_000);
    expect(today.json()).toMatchObject({ code: 'VALIDATION', message: 'The invoice date cannot be after today.' });
  });
});

describe('printed dates that are refused', () => {
  it('a date after today and a date that does not exist, on all four', async () => {
    const { jo, release } = await releasedInSeptember();
    await goTo('2026-10-06T02:00:00Z');
    const tries = [
      ['jo.invoice_record', { releaseId: release, invoiceNumber: '0801' }, 5_600_000],
      ['col.collection', collection('0201', jo, 100_000), 100_000],
      ['ap.bill', bill('SI-1', '2026-09-18'), 112_000],
      ['exp.voucher', voucher('OR-1', '2026-09-18'), 56_000],
    ] as const;
    for (const [type, input, total] of tries) {
      const future = await post(type, input, total, '2026-10-07');
      expect([future.statusCode, future.json().code, future.json().message], type).toEqual([400, 'BAD_DATE', 'The date printed on the document cannot be after today (2026-10-06).']);
      const none = await post(type, input, total, '2026-09-31');
      expect([none.statusCode, none.json().code, none.json().message], type).toEqual([400, 'BAD_DATE', '"2026-09-31" is not a real date. Type the date printed on the document like 2026-09-30.']);
      expect((await post(type, input, total, 'yesterday')).json().code, type).toBe('BAD_DATE');
      expect((await encoder.post(`/api/docs/${type}/preview`, { input, businessDate: '2026-10-07' })).json().code, type).toBe('BAD_DATE');
    }
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type IN ('jo.invoice_record', 'col.collection', 'ap.bill', 'exp.voucher')`).pluck().get()).toBe(0);
  });

  it('a date in a month the accountant signed off, on all four; the next open month is fine', async () => {
    const { jo, release } = await releasedInSeptember();
    await goTo('2026-10-06T02:00:00Z');
    expect((await accountant.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    expect((await accountant.post('/api/acc/month-end/sign-off', { month: '2026-08', note: 'August books reviewed' })).statusCode).toBe(200);
    const signedOff = 'August 2026 is already signed off at month-end, so nothing new is dated 2026-08-20. Check the date printed on the document, or ask the accountant.';
    const tries = [
      ['jo.invoice_record', { releaseId: release, invoiceNumber: '0801' }, 5_600_000],
      ['col.collection', collection('0201', jo, 100_000), 100_000],
      ['ap.bill', bill('SI-1', '2026-08-20'), 112_000],
      ['exp.voucher', voucher('OR-1', '2026-08-20'), 56_000],
    ] as const;
    for (const [type, input, total] of tries) {
      const pre = (await encoder.post(`/api/docs/${type}/preview`, { input, businessDate: '2026-08-20' })).json();
      expect(pre.issues, type).toContainEqual({ field: 'businessDate', code: 'MONTH_SIGNED_OFF', level: 'error', message: signedOff });
      const res = await post(type, input, total, '2026-08-20');
      expect([res.statusCode, res.json().message], type).toEqual([422, signedOff]);
    }
    expect((await post('ap.bill', bill('SI-1', '2026-09-01'), 112_000, '2026-09-01')).statusCode).toBe(200);
  });
});

describe('without a printed date', () => {
  it('is dated the day typed, as before, and other documents still refuse a date', async () => {
    await goTo('2026-10-06T02:00:00Z');
    const res = await post('exp.voucher', voucher('OR-5', '2026-10-01'), 56_000);
    expect(res.json()).toMatchObject({ number: 'EXP-000001', businessDate: '2026-10-06' });
    expect(dates(res.json().id)).toEqual({ document: '2026-10-06', journals: ['2026-10-06'] });
    expect(typedOn(res.json().id)).toMatchObject({ businessDate: '2026-10-06', typedOn: '2026-10-06' });
    const transfer = { fromCashPlaceId: cashPlaceId(env.db, '1111'), toCashPlaceId: CASH, amountSentCents: 1_000, amountReceivedCents: 1_000 };
    const refused = await post('cash.transfer', transfer, 1_000, '2026-09-20');
    expect([refused.statusCode, refused.json().code]).toEqual([400, 'DATE_NOT_ALLOWED']);
  });
});
