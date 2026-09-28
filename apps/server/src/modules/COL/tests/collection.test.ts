/**
 * Collections and refunds: goldens G-01, G-03, G-06, G-07 and G-12 (PLAN I2), a government buyer's VAT withheld (D4.6),
 * cancel mirrors, E5 rules, API rules and property tests. To keep these tests free of releases, the invoiced receivable (G-02) is posted here as the invoice
 * record's journal, tagged with the JO; the invoice record itself and the D6 cancel rules are in JO/tests/release.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { newId, vatFromGross } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postJournal, type DraftLine } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { balanceDue, joLedger } from '../../JO/public.ts';
import { collectionDoc, type CollectionInput } from '../doctypes/collection.ts';
import { refundDoc } from '../doctypes/refund.ts';
import { depositsHeld } from '../ledger.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number, BDO: number, GCASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  [CASH, BDO, GCASH] = ['1101', '1111', '1121'].map((code) => cashPlaceId(env.db, code)) as [number, number, number];
});

const COL = '/api/docs/col.collection';
const RFD = '/api/docs/col.refund';
const collect = (input: object, total: number, who = encoder) => who.post(`${COL}/post`, { input, expectedTotalCents: total }, idem());
const refund = (input: object, total: number, who = accountant) => who.post(`${RFD}/post`, { input, expectedTotalCents: total }, idem());
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** A one-line made-to-order JO for the given total. */
async function jobOrder(totalCents: number, customerId = c.school): Promise<string> {
  const lines = [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: totalCents, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: totalCents }, idem());
  expect(r.statusCode).toBe(200);
  return r.json().id;
}

/** A made-up government buyer: withholds 1% or 2% CWT and 5% VAT on its 2307s (D4.6). */
function governmentBuyer(): string {
  const id = newId();
  env.db
    .prepare(`INSERT INTO cus_customers (id, code, kind, display_name, withholding_profile, created_at, updated_at) VALUES (?, 'CUS-G1', 'organization', 'Moonlight City Hall', 'government', ?, ?)`)
    .run(id, stamp(env.clock), stamp(env.clock));
  return id;
}

/** The invoice record's journal (INV-REC + DEP-APPLY, PLAN D5) without the document, AR and deposit lines tagged with the JO. */
function invoice(jo: string, grossCents: number, depositAppliedCents = 0, customerId = c.school) {
  const party = { type: 'customer', id: customerId };
  const ref = { documentId: jo };
  const { netCents, vatCents } = vatFromGross(grossCents, 1200);
  const lines: DraftLine[] = [
    { account: { role: 'AR_TRADE' }, party, ref, debitCents: grossCents },
    { account: { role: 'SALES_MTO' }, party, creditCents: netCents },
    { account: { role: 'OUTPUT_VAT' }, party, creditCents: vatCents },
    { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, debitCents: depositAppliedCents },
    { account: { role: 'AR_TRADE' }, party, ref, creditCents: depositAppliedCents },
  ];
  tx(env.db, () => postJournal(env.db, { memo: 'Invoice record stand-in', lines }, { sourceType: 'test', sourceId: newId(), businessDate: '2026-09-28', userId: encoder.userId, at: stamp(env.clock) }));
}

/** Journal lines of a document as [account code, party id, JO ref, debit, credit]. */
const linesOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);

describe('collection goldens (PLAN I2)', () => {
  it('G-01: a ₱28,000 cash downpayment on an un-invoiced JO is a deposit on that JO (DEP-RCV)', async () => {
    const jo = await jobOrder(5_600_000);
    const input = { customerId: c.school, crNumber: '0101', applications: [{ jobOrderId: jo, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 2_800_000 }] };
    const pre = (await encoder.post(`${COL}/preview`, { input })).json();
    expect(pre.summary).toBe('This will record ₱28,000.00 received from Moonlight Test School in Cash on hand (main cash box), CR 0101: ₱28,000.00 for JO-000001.');
    expect(pre.issues).toEqual([]);
    expect(pre.journal).toBeUndefined(); // encoders never see debits and credits
    expect((await accountant.post(`${COL}/preview`, { input })).json().journal).toHaveLength(2);

    const res = await collect(input, 2_800_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'COL-000001', businessDate: '2026-09-28', totalCents: 2_800_000, journalNumber: 'JE-2026-000001' });
    expect(linesOf(res.json().id)).toEqual([
      ['1101', null, null, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_800_000],
    ]);
    expect((await encoder.get(`/api/jo/orders/${jo}/status`)).json().money).toMatchObject({ depositsHeldCents: 2_800_000, balanceDueCents: 2_800_000, collectedCents: 2_800_000 });
    expect((await encoder.get(`${COL}/${res.json().id}`)).json().input).toEqual(input);
    noBrokenInvariants();
  });

  it('G-03: GCash 10,000 + cash 17,750 + 1% CWT 250 clears the ₱28,000 receivable (COL-RCV)', async () => {
    const jo = await jobOrder(5_600_000);
    await collect({ customerId: c.school, crNumber: '0101', applications: [{ jobOrderId: jo, amountCents: 2_800_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 2_800_000 }] }, 2_800_000);
    invoice(jo, 5_600_000, 2_800_000); // G-02: invoice 0501, deposit applied; open AR 28,000.00
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 2_800_000, depositsHeldCents: 0 });

    const input = {
      customerId: c.school,
      crNumber: '0102',
      applications: [{ jobOrderId: jo, amountCents: 2_800_000 }],
      tenders: [{ cashPlaceId: GCASH, amountCents: 1_000_000, reference: 'GC-REF-1234' }, { cashPlaceId: CASH, amountCents: 1_775_000 }],
      withholding: { cwtCents: 25_000, atc: 'WC158', certificate: 'pending' },
    };
    const pre = (await encoder.post(`${COL}/preview`, { input })).json();
    expect(pre.issues).toEqual([]); // NET(28,000) = 25,000 × 1% = 250: as expected
    expect(pre.summary).toBe(
      'This will record ₱27,750.00 received from Moonlight Test School (₱10,000.00 in E-wallet – GCash, ₱17,750.00 in Cash on hand (main cash box)) plus ₱250.00 tax withheld (2307), CR 0102: ₱28,000.00 for JO-000001.',
    );
    const res = await collect(input, 2_800_000);
    expect(res.statusCode).toBe(200);
    expect(linesOf(res.json().id)).toEqual([
      ['1121', null, null, 1_000_000, 0],
      ['1101', null, null, 1_775_000, 0],
      ['1410', c.school, null, 25_000, 0],
      ['1201', c.school, jo, 0, 2_800_000],
    ]);
    // Balance due 0 (D3, with the invoiced amount the invoice record will report); 2307 register +1 (pending).
    expect(balanceDue({ totalCents: 5_600_000, invoicedCents: 5_600_000, ...joLedger(env.db, jo) }).balanceDueCents).toBe(0);
    expect(env.db.prepare('SELECT cwt_cents, cwt_atc, cert_2307 FROM col_collections WHERE document_id = ?').raw().get(res.json().id)).toEqual([25_000, 'WC158', 'pending']);
    noBrokenInvariants();
  });

  it('G-06: one ₱25,000 collection pays invoiced JO-A and puts a deposit on un-invoiced JO-B; cancel mirrors it', async () => {
    const [a, b] = [await jobOrder(1_000_000), await jobOrder(3_000_000)];
    invoice(a, 1_000_000);
    const input = {
      customerId: c.school,
      crNumber: '0103',
      applications: [{ jobOrderId: a, amountCents: 1_000_000 }, { jobOrderId: b, amountCents: 1_500_000 }],
      tenders: [{ cashPlaceId: CASH, amountCents: 500_000 }, { cashPlaceId: BDO, amountCents: 2_000_000 }],
    };
    const { id } = (await collect(input, 2_500_000)).json();
    expect(linesOf(id)).toEqual([
      ['1101', null, null, 500_000, 0],
      ['1111', null, null, 2_000_000, 0],
      ['1201', c.school, a, 0, 1_000_000],
      ['2201', c.school, b, 0, 1_500_000],
    ]);
    expect([joLedger(env.db, a), joLedger(env.db, b)]).toEqual([{ receivableCents: 0, depositsHeldCents: 0 }, { receivableCents: 0, depositsHeldCents: 1_500_000 }]);

    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    expect((await encoder.post(`${COL}/${id}/cancel`, { reason: 'Customer check bounced' }, idem())).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual([
      ['1101', null, null, 0, 500_000],
      ['1111', null, null, 0, 2_000_000],
      ['1201', c.school, a, 1_000_000, 0],
      ['2201', c.school, b, 1_500_000, 0],
    ]);
    expect([joLedger(env.db, a), joLedger(env.db, b)]).toEqual([{ receivableCents: 1_000_000, depositsHeldCents: 0 }, { receivableCents: 0, depositsHeldCents: 0 }]);
    noBrokenInvariants();
  });

  it('G-07: ₱12,000 paid on ₱10,000 AR keeps ₱2,000 unapplied; the refund pays it back (COL-OVER, DEP-REFUND)', async () => {
    const jo = await jobOrder(1_000_000);
    invoice(jo, 1_000_000);
    const input = { customerId: c.school, crNumber: '0104', applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 1_200_000 }] };
    const pre = (await encoder.post(`${COL}/preview`, { input })).json();
    expect(pre.issues).toEqual([expect.objectContaining({ code: 'UNAPPLIED', level: 'warning' })]);
    expect(pre.summary).toBe('This will record ₱12,000.00 received from Moonlight Test School in Cash on hand (main cash box), CR 0104: ₱10,000.00 for JO-000001, ₱2,000.00 kept as deposit.');
    const col = (await collect(input, 1_200_000)).json().id;
    expect(linesOf(col)).toEqual([
      ['1101', null, null, 1_200_000, 0],
      ['1201', c.school, jo, 0, 1_000_000],
      ['2201', c.school, null, 0, 200_000],
    ]);
    expect((await encoder.get(`/api/col/customers/${c.school}/open-items`)).json()).toMatchObject({ unappliedCents: 200_000 });

    const back = { customerId: c.school, tenders: [{ cashPlaceId: CASH, amountCents: 200_000 }], reason: 'Overpayment returned to the customer' };
    expect((await refund(back, 200_000, encoder)).statusCode).toBe(403); // refunds: accountant and owner by default
    expect((await refund({ ...back, tenders: [{ cashPlaceId: CASH, amountCents: 200_001 }] }, 200_001)).json()).toMatchObject({ code: 'VALIDATION', message: "Only ₱2,000.00 is held as Moonlight Test School's unapplied payments." });
    const pre2 = (await accountant.post(`${RFD}/preview`, { input: back })).json();
    expect(pre2.summary).toBe('This will pay back ₱2,000.00 to Moonlight Test School from Cash on hand (main cash box): unapplied payments.');
    const rfd = await refund(back, 200_000);
    expect(rfd.json()).toMatchObject({ number: 'RFD-000001', totalCents: 200_000 });
    expect(linesOf(rfd.json().id)).toEqual([
      ['2201', c.school, null, 200_000, 0],
      ['1101', null, null, 0, 200_000],
    ]);
    expect(depositsHeld(env.db, c.school, null)).toBe(0);

    // The collection cannot be cancelled while the refund of its deposit stands (D6); after the refund is cancelled it can.
    const blocked = await encoder.post(`${COL}/${col}/cancel`, { reason: 'Recorded against the wrong customer' }, idem());
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: RFD-000001.' });
    expect((await accountant.post(`${RFD}/${rfd.json().id}/cancel`, { reason: 'Customer did not take the money' }, idem())).statusCode).toBe(200);
    expect((await encoder.post(`${COL}/${col}/cancel`, { reason: 'Recorded against the wrong customer' }, idem())).statusCode).toBe(200);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 1_000_000, depositsHeldCents: 0 });
    noBrokenInvariants();
  });

  it('G-12: a collection put in GCash by mistake is edited to cash: mirror today, new number, linked', async () => {
    const jo = await jobOrder(1_000_000);
    invoice(jo, 1_000_000);
    const input = { customerId: c.school, crNumber: '0105', applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: GCASH, amountCents: 1_000_000 }] };
    const first = (await collect(input, 1_000_000)).json();
    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    const edit = (crNumber: string) =>
      encoder.post(`${COL}/${first.id}/reissue`, { input: { ...input, crNumber, tenders: [{ cashPlaceId: CASH, amountCents: 1_000_000 }] }, expectedTotalCents: 1_000_000, reason: 'Paid in cash, not GCash' }, idem());

    // A CR number is used once, ever: the edit is written on a new CR (D6, "CR booklet number marked cancelled").
    const sameCr = await edit('105');
    expect(sameCr.statusCode).toBe(422);
    expect(sameCr.json().message).toBe('CR 105 is already used on COL-000001 (cancelled). Each CR number is used once: write this payment on a new CR and keep all copies of a spoiled one.');
    expect((await encoder.get(`${COL}/${first.id}`)).json().header.status).toBe('posted');

    const second = await edit('0106');
    expect(second.json()).toMatchObject({ number: 'COL-000002', businessDate: '2026-09-29' });
    expect(linesOf(first.id)).toEqual([['1121', null, null, 1_000_000, 0], ['1201', c.school, jo, 0, 1_000_000]]);
    expect(linesOf(first.id, 'reversal')).toEqual([['1121', null, null, 0, 1_000_000], ['1201', c.school, jo, 1_000_000, 0]]);
    expect(linesOf(second.json().id)).toEqual([['1101', null, null, 1_000_000, 0], ['1201', c.school, jo, 0, 1_000_000]]);
    const reversalDate = env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(first.id);
    expect(reversalDate).toBe('2026-09-29');
    const old = (await encoder.get(`${COL}/${first.id}`)).json().header;
    expect(old).toMatchObject({ status: 'cancelled', replacedById: second.json().id, cancelReason: 'Paid in cash, not GCash' });
    expect((await encoder.get(`${COL}/${second.json().id}`)).json().header.replacesId).toBe(first.id);
    const net = (code: string) => env.db.prepare('SELECT SUM(l.debit_cents - l.credit_cents) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').pluck().get(code);
    expect([net('1121'), net('1101')]).toEqual([0, 1_000_000]);
    noBrokenInvariants();
  });

  it('COL-RCV, government buyer: cash 10,600 + 1% CWT 100 + 5% VAT withheld 500 clears an ₱11,200 invoice; cancel mirrors it', async () => {
    const lgu = governmentBuyer();
    const jo = await jobOrder(1_120_000, lgu);
    invoice(jo, 1_120_000, 0, lgu); // VAT 1,200.00, net 10,000.00; open AR 11,200.00
    const input = {
      customerId: lgu,
      crNumber: '0107',
      applications: [{ jobOrderId: jo, amountCents: 1_120_000 }],
      tenders: [{ cashPlaceId: CASH, amountCents: 1_060_000 }],
      withholding: { cwtCents: 10_000, atc: 'WC158', certificate: 'pending', vatWithheldCents: 50_000 },
    };
    const pre = (await encoder.post(`${COL}/preview`, { input })).json();
    expect(pre.issues).toEqual([]); // 1% and 5% of NET(11,200) = 10,000: as expected
    expect(pre.totalCents).toBe(1_120_000); // Σ tenders + CWT + VAT withheld = Σ applied
    expect(pre.summary).toBe(
      'This will record ₱10,600.00 received from Moonlight City Hall in Cash on hand (main cash box) plus ₱100.00 tax withheld and ₱500.00 VAT withheld (2307), CR 0107: ₱11,200.00 for JO-000001.',
    );
    const res = await collect(input, 1_120_000);
    expect(res.statusCode).toBe(200);
    const { id } = res.json();
    expect(linesOf(id)).toEqual([
      ['1101', null, null, 1_060_000, 0],
      ['1410', lgu, null, 10_000, 0],
      ['1404', lgu, null, 50_000, 0],
      ['1201', lgu, jo, 0, 1_120_000],
    ]);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 0, depositsHeldCents: 0 });
    expect(env.db.prepare('SELECT cwt_cents, vat_withheld_cents FROM col_collections WHERE document_id = ?').raw().get(id)).toEqual([10_000, 50_000]);
    expect((await encoder.get(`${COL}/${id}`)).json().input).toEqual(input);

    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    expect((await encoder.post(`${COL}/${id}/cancel`, { reason: 'Recorded against the wrong invoice' }, idem())).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual([
      ['1101', null, null, 0, 1_060_000],
      ['1410', lgu, null, 0, 10_000],
      ['1404', lgu, null, 0, 50_000],
      ['1201', lgu, jo, 1_120_000, 0],
    ]);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 1_120_000, depositsHeldCents: 0 });
    const net = (code: string) => env.db.prepare('SELECT SUM(l.debit_cents - l.credit_cents) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').pluck().get(code);
    expect([net('1404'), net('1410'), net('1101')]).toEqual([0, 0, 0]);
    noBrokenInvariants();
  });
});

describe('collection rules (PLAN E5, D4)', () => {
  const pay = (jo: string, cents: number, crNumber = '0201', extra: Partial<CollectionInput> = {}) =>
    ({ customerId: c.school, crNumber, applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }], ...extra });
  const issues = async (input: object) => ((await encoder.post(`${COL}/preview`, { input })).json().issues as { code: string }[]).map((i) => i.code);

  it('a CR number cannot repeat, even written without its leading zeros', async () => {
    const jo = await jobOrder(1_000_000);
    expect((await collect(pay(jo, 100_000, '0301'), 100_000)).statusCode).toBe(200);
    expect(await issues(pay(jo, 100_000, '301'))).toEqual(['CR_USED']);
    expect((await collect(pay(jo, 100_000, '301'), 100_000)).statusCode).toBe(422);
    for (const crNumber of ['', '0', 'A-12', '12.5']) expect((await collect(pay(jo, 100_000, crNumber), 100_000)).statusCode, crNumber).toBe(400);
  });

  it('applies only to recorded JOs of this customer, once each, up to their balance due', async () => {
    const [jo, theirs] = [await jobOrder(1_000_000), await jobOrder(1_000_000, c.other)];
    expect(await issues(pay(jo, 1_000_001))).toEqual(['OVER_BALANCE']);
    expect(await issues(pay(theirs, 100_000))).toEqual(['JOB_ORDER']);
    expect(await issues({ ...pay(jo, 200_000), applications: [{ jobOrderId: jo, amountCents: 100_000 }, { jobOrderId: jo, amountCents: 100_000 }] })).toEqual(['JO_TWICE']);
    expect(await issues({ ...pay(jo, 100_000), tenders: [{ cashPlaceId: CASH, amountCents: 99_999 }] })).toEqual(['APPLIED_MORE']);
    expect(await issues({ ...pay(jo, 100_000), customerId: c.closed, applications: [] })).toEqual(['CUSTOMER', 'UNAPPLIED']);
    await encoder.post(`/api/docs/jo.job_order/${jo}/cancel`, { reason: 'Customer called the order off' }, idem());
    expect(await issues(pay(jo, 100_000))).toEqual(['JO_CANCELLED']);
  });

  it('settles a difference of up to ₱1.00 to cash short and over (D4.9), never more', async () => {
    const jo = await jobOrder(1_000_000);
    const short = await collect({ ...pay(jo, 100_000), tenders: [{ cashPlaceId: CASH, amountCents: 99_950 }], settleSmallDifference: true }, 99_950);
    expect(linesOf(short.json().id)).toEqual([['1101', null, null, 99_950, 0], ['6280', null, null, 50, 0], ['2201', c.school, jo, 0, 100_000]]);
    const over = await collect({ ...pay(jo, 100_000, '0202'), tenders: [{ cashPlaceId: CASH, amountCents: 100_040 }], settleSmallDifference: true }, 100_040);
    expect(linesOf(over.json().id)).toEqual([['1101', null, null, 100_040, 0], ['2201', c.school, jo, 0, 100_000], ['6280', null, null, 0, 40]]);
    expect(await issues({ ...pay(jo, 100_000, '0203'), tenders: [{ cashPlaceId: CASH, amountCents: 99_899 }], settleSmallDifference: true })).toEqual(['DIFFERENCE_TOO_BIG']);
    noBrokenInvariants();
  });

  it('warns when the tax withheld is off the expected rate by more than ₱1.00 (D4.6)', async () => {
    const jo = await jobOrder(5_600_000);
    const w = (cwtCents: number, atc = 'WC158') => ({ ...pay(jo, 2_800_000), tenders: [{ cashPlaceId: CASH, amountCents: 2_800_000 - cwtCents }], withholding: { cwtCents, atc, certificate: 'received' } });
    expect(await issues(w(25_100))).toEqual([]);
    expect(await issues(w(50_000))).toEqual(['CWT_EXPECTED']);
    expect(await issues(w(50_000, 'WC160'))).toEqual([]);
    expect(await issues(w(12_345, 'other'))).toEqual([]);
  });

  it('warns when the VAT withheld is off 5% of the net by more than ₱1.00, and takes it only with CWT on the same 2307 (D4.6)', async () => {
    const jo = await jobOrder(1_120_000);
    const w = (vatWithheldCents: number) => ({
      ...pay(jo, 1_120_000),
      tenders: [{ cashPlaceId: CASH, amountCents: 1_120_000 - 10_000 - vatWithheldCents }],
      withholding: { cwtCents: 10_000, atc: 'WC158' as const, certificate: 'received' as const, vatWithheldCents },
    });
    expect(await issues(w(50_000))).toEqual([]);
    expect(await issues(w(50_100))).toEqual([]); // ₱1.00 off: fine
    expect(await issues(w(49_899))).toEqual(['VAT_WITHHELD_EXPECTED']);
    expect(await issues(w(100_000))).toEqual(['VAT_WITHHELD_EXPECTED']);
    // The rule counts it: received (tenders + CWT + VAT withheld) a centavo below what is applied is refused.
    expect(await issues({ ...w(50_000), tenders: [{ cashPlaceId: CASH, amountCents: 1_059_999 }] })).toEqual(['APPLIED_MORE']);
    for (const withholding of [{ vatWithheldCents: 50_000 }, { ...w(50_000).withholding, vatWithheldCents: 0 }, { ...w(50_000).withholding, cwtCents: 0 }]) {
      expect((await collect({ ...w(50_000), withholding }, 1_120_000)).statusCode, JSON.stringify(withholding)).toBe(400);
    }
    // The table refuses VAT withheld without CWT too.
    expect(() => env.db.prepare(`INSERT INTO col_collections (document_id, customer_id, customer_name, cr_number, cwt_cents, vat_withheld_cents, unapplied_cents, short_over_cents, settle_small_difference)
      VALUES (?, ?, 'x', '9999', 0, 500, 0, 0, 0)`).run(newId(), c.school)).toThrow(/CHECK constraint failed: vat_withheld_cents/);
  });

  it('refunds a cancelled JO’s deposit, with a warning when the money came with a 2307 (ACC-14)', async () => {
    const jo = await jobOrder(5_600_000);
    await collect({ ...pay(jo, 1_000_000), tenders: [{ cashPlaceId: CASH, amountCents: 990_000 }], withholding: { cwtCents: 10_000, atc: 'other', certificate: 'pending' } }, 1_000_000);
    const back = { customerId: c.school, jobOrderId: jo, tenders: [{ cashPlaceId: CASH, amountCents: 990_000 }], reason: 'Order called off, money returned' };
    const codes = async () => ((await accountant.post(`${RFD}/preview`, { input: back })).json().issues as { code: string }[]).map((i) => i.code);
    expect(await codes()).toEqual(['JO_OPEN', 'CWT_HELD']);
    await encoder.post(`/api/docs/jo.job_order/${jo}/cancel`, { reason: 'Customer called the order off' }, idem());
    expect(await codes()).toEqual(['CWT_HELD']);
    const r = await refund(back, 990_000);
    expect(linesOf(r.json().id)).toEqual([['2201', c.school, jo, 990_000, 0], ['1101', null, null, 0, 990_000]]);
    expect(joLedger(env.db, jo).depositsHeldCents).toBe(10_000); // the withheld part stays for the accountant
    noBrokenInvariants();
  });
});

describe('API rules', () => {
  it('rejects client-sent totals, dates, numbers and statuses (N-03)', async () => {
    const jo = await jobOrder(1_000_000);
    const good = { customerId: c.school, crNumber: '0401', applications: [{ jobOrderId: jo, amountCents: 1_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 1_000 }] };
    for (const extra of [{ date: '2026-01-01' }, { number: 'COL-9' }, { totalCents: 1_000 }, { unappliedCents: 0 }, { status: 'posted' }, { shortOverCents: 0 }]) {
      expect((await collect({ ...good, ...extra }, 1_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await collect({ ...good, applications: [{ jobOrderId: jo, amountCents: 1_000, toDepositCents: 1_000 }] }, 1_000)).statusCode).toBe(400);
    expect((await refund({ customerId: c.school, tenders: [{ cashPlaceId: CASH, amountCents: 1 }], reason: 'Short reason here', totalCents: 1 }, 1)).statusCode).toBe(400);
  });

  it('needs the right permission (N-04)', async () => {
    const tv = await env.as('tv');
    expect((await tv.get(COL)).statusCode).toBe(403);
    expect((await tv.get(`/api/col/customers/${c.school}/open-items`)).statusCode).toBe(403);
    expect((await (await env.as('production')).post(`${COL}/preview`, { input: {} })).statusCode).toBe(403);
    expect((await encoder.get(RFD)).statusCode).toBe(200);
  });

  it('lists what a customer can pay on, oldest due first', async () => {
    const [a, b] = [await jobOrder(1_000_000), await jobOrder(2_000_000)];
    await collect({ customerId: c.school, crNumber: '0402', applications: [{ jobOrderId: a, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 1_000_000 }] }, 1_000_000);
    expect((await encoder.get(`/api/col/customers/${c.school}/open-items`)).json()).toEqual({
      customerId: c.school,
      customerName: 'Moonlight Test School',
      jobOrders: [{ id: b, number: 'JO-000002', dueDate: '2026-10-13', totalCents: 2_000_000, balanceDueCents: 2_000_000, depositsHeldCents: 0 }],
      quickSales: [],
      unappliedCents: 0,
    });
    expect((await encoder.get(`/api/col/customers/${newId()}/open-items`)).statusCode).toBe(404);
  });

  it('lists what can be paid back: deposits per JO, cancelled JOs included (D6), and unapplied money; refunds only', async () => {
    const a = await jobOrder(1_000_000);
    await jobOrder(2_000_000); // nothing held: not listed
    await collect({ customerId: c.school, crNumber: '0403', applications: [{ jobOrderId: a, amountCents: 400_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 450_000 }] }, 450_000);
    expect((await accountant.post(`/api/docs/jo.job_order/${a}/cancel`, { reason: 'Customer called the order off' }, idem())).statusCode).toBe(200);
    expect((await accountant.get(`/api/col/customers/${c.school}/refundable`)).json()).toEqual({
      customerId: c.school,
      customerName: 'Moonlight Test School',
      jobOrders: [{ id: a, number: 'JO-000001', status: 'cancelled', depositsHeldCents: 400_000 }],
      unappliedCents: 50_000,
    });
    expect((await encoder.get(`/api/col/customers/${c.school}/refundable`)).statusCode).toBe(403);
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random collections: stored = computed, the balance rule holds, refunds and cancels net to zero, nothing goes negative', async () => {
    let withVat = 0;
    const jos = [await jobOrder(9_000_000_000), await jobOrder(9_000_000_000), await jobOrder(9_000_000_000, c.other)];
    invoice(jos[0]!, 4_000_000_000);
    const actor = { userId: accountant.userId, permissions: new Set(['col.create', 'col.post', 'col.cancel', 'col.refund']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: '2026-09-28', at: stamp(env.clock), userId: actor.userId, can: () => true });
    let cr = 500_000;
    const nextCr = () => String(++cr);
    fc.assert(
      fc.property(fc.array(fc.tuple(collectionDoc.arbitrary(env.db), fc.constantFrom('keep', 'refund', 'cancel', 'refund+cancel', 'reissue')), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [raw, what] of ops) {
          const input = { ...raw, crNumber: nextCr() };
          const expected = collectionDoc.compute(input, ctx());
          // COL-RCV: Σ tenders + CWT + VAT withheld = Σ applied + unapplied (+ short/over).
          expect(expected.totalCents).toBe(input.tenders.reduce((s, t) => s + t.amountCents, 0) + expected.cwtCents + expected.vatWithheldCents);
          expect(expected.totalCents).toBe(expected.appliedCents + expected.unappliedCents + expected.shortOverCents);
          if (expected.vatWithheldCents > 0) withVat++;
          const p = postDocument(e, collectionDoc, actor, { input, expectedTotalCents: expected.totalCents });
          expect(collectionDoc.load(env.db, p.id)).toEqual(expected);
          expect(collectionDoc.toInput(expected)).toEqual(input);
          let refundId: string | null = null;
          if (what.startsWith('refund') && expected.unappliedCents > 0) {
            const back = { customerId: input.customerId, tenders: [{ cashPlaceId: CASH, amountCents: expected.unappliedCents }], reason: 'Overpayment returned' };
            refundId = postDocument(e, refundDoc, actor, { input: back, expectedTotalCents: expected.unappliedCents }).id;
          }
          if (what.endsWith('cancel')) {
            if (refundId) cancelDocument(e, refundDoc, actor, refundId, 'Refund recorded by mistake');
            cancelDocument(e, collectionDoc, actor, p.id, 'Recorded twice by mistake');
          } else if (what === 'reissue') {
            const tenders = [{ cashPlaceId: BDO, amountCents: expected.totalCents - expected.cwtCents - expected.vatWithheldCents }];
            reissueDocument(e, collectionDoc, actor, p.id, { input: { ...input, crNumber: nextCr(), tenders }, expectedTotalCents: expected.totalCents, reason: 'Money went to BDO instead' });
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
        for (const jo of jos) expect(Math.min(joLedger(env.db, jo).receivableCents, joLedger(env.db, jo).depositsHeldCents)).toBeGreaterThanOrEqual(0);
        for (const customer of [c.school, c.other]) expect(depositsHeld(env.db, customer, null)).toBeGreaterThanOrEqual(0);
        // 1410 and 1404 hold exactly what the recorded collections withheld: cancels and reissues take theirs back.
        const held = (role: string) =>
          env.db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = ?').pluck().get(role);
        const stored = (col: string) =>
          env.db.prepare(`SELECT COALESCE(SUM(c.${col}), 0) FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted'`).pluck().get();
        expect([held('CWT'), held('VAT_WITHHELD')]).toEqual([stored('cwt_cents'), stored('vat_withheld_cents')]);
      }),
      { numRuns: 25 },
    );
    expect(withVat).toBeGreaterThan(0);
  });

  it('random refunds of money held post balanced and cancel to zero', async () => {
    const jo = await jobOrder(9_000_000_000);
    const actor = { userId: accountant.userId, permissions: new Set(['col.post', 'col.refund']) };
    const e = { db: env.db, clock: env.clock };
    postDocument(e, collectionDoc, actor, {
      input: { customerId: c.school, crNumber: '0901', applications: [{ jobOrderId: jo, amountCents: 5_000_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 8_000_000 }] },
      expectedTotalCents: 8_000_000,
    });
    fc.assert(
      fc.property(refundDoc.arbitrary(env.db), fc.boolean(), (input, cancel) => {
        // The inputs are drawn from what was held before the loop; refunds that are not cancelled drain it. A draw larger
        // than what is left is skipped, not rejected with fc.pre: once a pool is empty every later draw would be rejected,
        // and fast-check fails the run for too many pre-condition failures (seed 2000764807).
        if (input.tenders[0]!.amountCents > depositsHeld(env.db, input.customerId, input.jobOrderId ?? null)) return;
        const p = postDocument(e, refundDoc, actor, { input, expectedTotalCents: input.tenders[0]!.amountCents });
        expect(refundDoc.toInput(refundDoc.load(env.db, p.id))).toEqual(input);
        if (cancel) cancelDocument(e, refundDoc, actor, p.id, 'Refund recorded by mistake');
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
        expect(Math.min(depositsHeld(env.db, c.school, null), depositsHeld(env.db, c.school, jo))).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 40 },
    );
  });
});
