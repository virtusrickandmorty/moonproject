/**
 * Quick sale: golden G-08 (PLAN I2), E6 "posts AR and clears it in the same transaction; cancel cancels both", edit,
 * the shared invoice booklet with JO, payments by later collections, API rules and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { collectionDoc } from '../../COL/doctypes/collection.ts';
import { saleDoc } from '../doctypes/sale.ts';
import { saleOpenCents } from '../public.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number, GCASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  [CASH, GCASH] = ['1101', '1121'].map((code) => cashPlaceId(env.db, code)) as [number, number];
});

const alteration = { kind: 'service', description: 'Alteration: shorten sleeves', qty: 1, unitPriceCents: 35_000, discountCents: 0 };
const sale = (more: object = {}) => ({ customerId: c.school, invoiceNumber: '0502', lines: [alteration], ...more });
const cash = (cents: number, crNumber = '0701') => ({ crNumber, tenders: [{ cashPlaceId: CASH, amountCents: cents }] });
const record = (s: object, payment: object, total: number, who = encoder, key = idem()) => who.post('/api/qs/sales', { sale: s, payment, expectedTotalCents: total }, key);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const count = (type: string, status = 'posted') => env.db.prepare('SELECT COUNT(*) FROM documents WHERE doc_type = ? AND status = ?').pluck().get(type, status) as number;

/** Journal lines as [account code, party id, ref, debit, credit]. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);

describe('quick sale golden (PLAN I2)', () => {
  it('G-08: alteration ₱350 cash, invoice no. 0502: Dr 1201 350.00 / Cr 4103 312.50, Cr 2301 37.50; Dr 1101 350.00 / Cr 1201 350.00', async () => {
    const pre = (await encoder.post('/api/qs/sales/preview', { sale: sale(), payment: cash(35_000) })).json();
    expect(pre).toMatchObject({ totalCents: 35_000, booklet: { vatableSalesCents: 31_250, vatCents: 3_750, discountCents: 0, totalCents: 35_000 } });
    expect(pre.sale).toEqual({ summary: 'This will record invoice no. 0502 to Moonlight Test School for Alteration: shorten sleeves: ₱350.00 (VATable sales ₱312.50, VAT ₱37.50).', issues: [] });
    expect(pre.payment).toEqual({ summary: 'This will record ₱350.00 received from Moonlight Test School in Cash on hand (main cash box), CR 0701: ₱350.00 for invoice no. 0502.', issues: [] });
    expect(count('qs.sale') + count('col.collection')).toBe(0); // the preview wrote nothing
    expect((await accountant.post('/api/qs/sales/preview', { sale: sale(), payment: cash(35_000) })).json().payment.journal).toHaveLength(2);

    const res = await record(sale(), cash(35_000), 35_000);
    expect(res.statusCode, res.body).toBe(200);
    const { sale: s, payment: p } = res.json();
    expect(s).toMatchObject({ number: 'IR-000001', totalCents: 35_000, journalNumber: 'JE-2026-000001' });
    expect(p).toMatchObject({ number: 'COL-000001', totalCents: 35_000, journalNumber: 'JE-2026-000002' });
    // Posts AR and clears it in the same transaction (E6); the receivable names the sale.
    expect(linesOf(s.id)).toEqual([
      ['1201', c.school, s.id, 35_000, 0],
      ['4103', c.school, null, 0, 31_250],
      ['2301', c.school, null, 0, 3_750],
    ]);
    expect(linesOf(p.id)).toEqual([
      ['1101', null, null, 35_000, 0],
      ['1201', c.school, s.id, 0, 35_000],
    ]);
    expect(saleOpenCents(env.db, s.id)).toBe(0);
    expect((await encoder.get(`/api/docs/qs.sale/${s.id}`)).json().input).toEqual(sale());
    expect((await encoder.get(`/api/docs/col.collection/${p.id}`)).json().input).toEqual({ customerId: c.school, crNumber: '0701', applications: [], sales: [{ saleId: s.id, amountCents: 35_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] });
    expect((await encoder.get(`/api/qs/sales/${s.id}/payments`)).json()).toEqual([{ id: p.id, number: 'COL-000001', status: 'posted', crNumber: '0701', totalCents: 35_000 }]);
    noBrokenInvariants();
  });

  it('splits sales by class, shows a discount as gross + 4190, and takes split tenders', async () => {
    const lines = [
      { kind: 'ready_made', description: 'Plain white shirt', qty: 2, unitPriceCents: 28_000, discountCents: 5_600 },
      { kind: 'service', description: 'Name patch', qty: 1, unitPriceCents: 11_200, discountCents: 0 },
    ];
    const payment = { crNumber: '0702', tenders: [{ cashPlaceId: GCASH, amountCents: 30_000, reference: 'GC 5566' }, { cashPlaceId: CASH, amountCents: 31_600 }] };
    const res = await record(sale({ lines }), payment, 61_600);
    expect(res.statusCode, res.body).toBe(200);
    const { sale: s, payment: p } = res.json();
    // ₱616.00: VAT ₱66.00 on the whole document; sales at list ₱600.00 split 560 : 112 by class; discount NET ₱50.00.
    expect(linesOf(s.id)).toEqual([
      ['1201', c.school, s.id, 61_600, 0],
      ['4190', c.school, null, 5_000, 0],
      ['4102', c.school, null, 0, 50_000],
      ['4103', c.school, null, 0, 10_000],
      ['2301', c.school, null, 0, 6_600],
    ]);
    expect(linesOf(p.id)).toEqual([
      ['1121', null, null, 30_000, 0],
      ['1101', null, null, 31_600, 0],
      ['1201', c.school, s.id, 0, 61_600],
    ]);
    noBrokenInvariants();
  });

  it('counts VAT withheld by a government buyer with the CWT as received (D4.6)', async () => {
    const lines = [{ kind: 'ready_made', description: 'Plain white shirt', qty: 40, unitPriceCents: 28_000, discountCents: 0 }];
    const withholding = { cwtCents: 10_000, atc: 'WC158', certificate: 'pending' };
    const payment = { ...cash(1_060_000, '0704'), withholding: { ...withholding, vatWithheldCents: 50_000 } };
    const codes = async (pay: object) => ((await encoder.post('/api/qs/sales/preview', { sale: sale({ lines }), payment: pay })).json().payment.issues as { code: string }[]).map((i) => i.code);
    expect(await codes(payment)).toEqual([]);
    expect(await codes({ ...payment, withholding })).toContain('RECEIVED'); // ₱500.00 short without the VAT withheld
    const res = await record(sale({ lines }), payment, 1_120_000);
    expect(res.statusCode, res.body).toBe(200);
    const { sale: s, payment: p } = res.json();
    expect(linesOf(p.id)).toEqual([
      ['1101', null, null, 1_060_000, 0],
      ['1410', c.school, null, 10_000, 0],
      ['1404', c.school, null, 50_000, 0],
      ['1201', c.school, s.id, 0, 1_120_000],
    ]);
    noBrokenInvariants();
  });
});

describe('cancel and edit (E6, D6)', () => {
  it('cancel cancels both, mirrored with today’s date; the invoice number stays used', async () => {
    const { sale: s, payment: p } = (await record(sale(), cash(35_000), 35_000)).json();
    env.clock.advance(24 * 3600_000);
    [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
    // Alone, the sale cannot be cancelled while its payment stands.
    expect((await accountant.post(`/api/docs/qs.sale/${s.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem())).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: COL-000001.' });
    expect((await encoder.post(`/api/qs/sales/${s.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem())).statusCode).toBe(403);
    const res = await accountant.post(`/api/qs/sales/${s.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem());
    expect(res.statusCode, res.body).toBe(200);
    expect(linesOf(p.id, 'reversal')).toEqual([['1101', null, null, 0, 35_000], ['1201', c.school, s.id, 35_000, 0]]);
    expect(linesOf(s.id, 'reversal')).toEqual([['1201', c.school, s.id, 0, 35_000], ['4103', c.school, null, 31_250, 0], ['2301', c.school, null, 3_750, 0]]);
    const dates = env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE posting_kind = 'reversal'`).pluck().all();
    expect(dates).toEqual(['2026-09-29']);
    expect([count('qs.sale', 'cancelled'), count('col.collection', 'cancelled')]).toEqual([1, 1]);
    const again = await record(sale(), cash(35_000, '0703'), 35_000);
    expect(again.json().message).toBe('Invoice no. 0502 is already used on IR-000001 (cancelled). Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.');
    noBrokenInvariants();
  });

  it('edit = cancel both, then a new invoice record (new number, linked) and its payment', async () => {
    const { sale: s } = (await record(sale(), cash(35_000), 35_000)).json();
    const body = { sale: sale({ invoiceNumber: '0503', lines: [{ ...alteration, unitPriceCents: 45_000 }] }), payment: cash(45_000, '0704'), expectedTotalCents: 45_000, reason: 'Price was for two sleeves' };
    const res = await accountant.post(`/api/qs/sales/${s.id}/reissue`, body, idem());
    expect(res.statusCode, res.body).toBe(200);
    const { sale: s2, payment: p2 } = res.json();
    expect([s2.number, p2.number]).toEqual(['IR-000002', 'COL-000002']);
    const old = (await encoder.get(`/api/docs/qs.sale/${s.id}`)).json().header;
    expect(old).toMatchObject({ status: 'cancelled', cancelReason: 'Price was for two sleeves', replacedById: s2.id });
    expect(linesOf(p2.id)).toEqual([['1101', null, null, 45_000, 0], ['1201', c.school, s2.id, 0, 45_000]]);
    expect([saleOpenCents(env.db, s.id), saleOpenCents(env.db, s2.id)]).toEqual([0, 0]);
    // A refused replacement changes nothing.
    const bad = await accountant.post(`/api/qs/sales/${s2.id}/reissue`, { ...body, sale: sale({ invoiceNumber: '0502' }), expectedTotalCents: 35_000, payment: cash(35_000, '0705') }, idem());
    expect(bad.json()).toMatchObject({ code: 'VALIDATION' });
    expect([count('qs.sale'), count('col.collection')]).toEqual([1, 1]);
    noBrokenInvariants();
  });

  it('a payment cancelled on its own reopens what is owed; a later collection pays it; a payment that pays more blocks the quick-sale cancel', async () => {
    const jo = (await encoder.post('/api/docs/jo.job_order/post', {
      input: { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }] },
      expectedTotalCents: 100_000,
    }, idem())).json().id;
    const { sale: s, payment: p } = (await record(sale(), cash(35_000), 35_000)).json();
    expect((await encoder.post(`/api/docs/col.collection/${p.id}/cancel`, { reason: 'GCash transfer was reversed' }, idem())).statusCode).toBe(200);
    expect(saleOpenCents(env.db, s.id)).toBe(35_000);
    const open = (await encoder.get(`/api/col/customers/${c.school}/open-items`)).json();
    expect(open.quickSales).toEqual([{ id: s.id, number: 'IR-000001', invoiceNumber: '0502', businessDate: '2026-09-28', totalCents: 35_000, openCents: 35_000 }]);

    const pay = (sales: object[], cents: number, crNumber: string) =>
      encoder.post('/api/docs/col.collection/post', { input: { customerId: c.school, crNumber, applications: [{ jobOrderId: jo, amountCents: 10_000 }], sales, tenders: [{ cashPlaceId: CASH, amountCents: cents }] }, expectedTotalCents: cents }, idem());
    const codes = async (sales: object[]) => ((await encoder.post('/api/docs/col.collection/preview', { input: { customerId: c.other, crNumber: '0799', applications: [], sales, tenders: [{ cashPlaceId: CASH, amountCents: 100 }] } })).json().issues as { code: string }[]).map((i) => i.code);
    expect(await codes([{ saleId: s.id, amountCents: 100 }])).toEqual(['SALE']);
    expect((await pay([{ saleId: s.id, amountCents: 35_001 }], 45_001, '0710')).json().details).toEqual([expect.objectContaining({ code: 'OVER_BALANCE', message: 'Invoice no. 0502 has ₱350.00 left to pay. Apply at most that.' })]);
    const later = await pay([{ saleId: s.id, amountCents: 35_000 }], 45_000, '0711');
    expect(later.json().summary).toBe('This will record ₱450.00 received from Moonlight Test School in Cash on hand (main cash box), CR 0711: ₱100.00 for JO-000001, ₱350.00 for invoice no. 0502.');
    expect(linesOf(later.json().id).slice(-1)).toEqual([['1201', c.school, s.id, 0, 35_000]]);
    expect(saleOpenCents(env.db, s.id)).toBe(0);
    expect((await accountant.post(`/api/qs/sales/${s.id}/cancel`, { reason: 'Customer returned the shirt' }, idem())).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'COL-000002 also pays other things. Cancel it on its own first.' });
    expect(count('qs.sale')).toBe(1);
    noBrokenInvariants();
  });
});

describe('rules (E6, N-02, N-03, N-10)', () => {
  it('shares the invoice booklet with job order releases: a number is used once across both', async () => {
    const jo = (await encoder.post('/api/docs/jo.job_order/post', {
      input: { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'full', lines: [{ kind: 'ready_made', description: 'Shirt', qty: 1, unitPriceCents: 35_000, discountCents: 0, roster: [] }] },
      expectedTotalCents: 35_000,
    }, idem())).json().id;
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
    await record(sale(), cash(35_000), 35_000);
    const rel = await accountant.post('/api/jo/releases', { release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Walk-in Placeholder', idSeen: 'none', creditNote: 'Pays on Friday', creditDueInDays: 3 }, invoice: { invoiceNumber: '502' }, expectedTotalCents: 35_000 }, idem());
    expect(rel.json().message).toBe('Invoice no. 502 is already used on IR-000001. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.');
    const ok = await accountant.post('/api/jo/releases', { release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Walk-in Placeholder', idSeen: 'none', creditNote: 'Pays on Friday', creditDueInDays: 3 }, invoice: { invoiceNumber: '0601' }, expectedTotalCents: 35_000 }, idem());
    expect(ok.json().invoiceRecord.number).toBe('IR-000002'); // one IR- series for both
    expect((await record(sale({ invoiceNumber: '601' }), cash(35_000, '0720'), 35_000)).json().message).toMatch(/^Invoice no. 601 is already used on IR-000002\./);
  });

  it('needs the money received to equal the total; a refused payment records nothing, not even the sale', async () => {
    const pre = (await encoder.post('/api/qs/sales/preview', { sale: sale(), payment: cash(50_000) })).json();
    expect(pre.payment.issues).toEqual([expect.objectContaining({ code: 'RECEIVED', message: 'The money received (₱500.00) must equal the sale total (₱350.00). Give change for the rest.' }), expect.objectContaining({ code: 'UNAPPLIED' })]);
    expect((await record(sale(), cash(50_000), 35_000)).json()).toMatchObject({ code: 'VALIDATION', message: 'The money received (₱500.00) must equal the sale total (₱350.00). Give change for the rest.' });
    await record(sale({ invoiceNumber: '0900' }), cash(35_000, '0730'), 35_000);
    const crUsed = await record(sale(), cash(35_000, '730'), 35_000);
    expect(crUsed.json().message).toMatch(/^CR 730 is already used on COL-000001\./);
    expect([count('qs.sale'), count('col.collection')]).toEqual([1, 1]);
    expect(env.db.prepare(`SELECT next_value FROM number_series WHERE series_key = 'IR'`).pluck().get()).toBe(2); // no gap
  });

  it('checks the customer, the lines and the totals', async () => {
    const codes = async (s: object) => ((await encoder.post('/api/qs/sales/preview', { sale: s, payment: cash(100) })).json().sale.issues as { code: string }[]).map((i) => i.code);
    expect(await codes(sale({ customerId: c.closed }))).toEqual(['CUSTOMER']);
    expect(await codes(sale({ lines: [{ ...alteration, discountCents: 35_001 }] }))).toEqual(['DISCOUNT', 'NOTHING_TO_INVOICE']);
    expect(await codes(sale({ lines: [{ ...alteration, unitPriceCents: 0 }] }))).toEqual(['NOTHING_TO_INVOICE']);
    expect(await codes(sale({ lines: Array(11).fill({ ...alteration, qty: 10_000, unitPriceCents: 100_000_000 }) }))).toEqual(['TOO_BIG']);
  });

  it('refuses client-sent totals, dates, VAT and numbers (N-03), checks permissions, and records once per key (N-02)', async () => {
    for (const extra of [{ totalCents: 1 }, { businessDate: '2026-01-01' }, { vatCents: 3_750 }, { number: 'IR-000009' }]) {
      expect((await record(sale(extra), cash(35_000), 35_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    for (const extra of [{ customerId: c.other }, { sales: [] }, { applications: [] }, { settleSmallDifference: true }]) {
      expect((await record(sale(), { ...cash(35_000), ...extra }, 35_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await record(sale(), cash(35_000), 30_000)).json()).toMatchObject({ code: 'TOTALS_CHANGED' });
    expect((await (await env.as('production')).post('/api/qs/sales', { sale: sale(), payment: cash(35_000), expectedTotalCents: 35_000 }, idem())).statusCode).toBe(403);
    const key = idem();
    const [x, y] = await Promise.all([record(sale(), cash(35_000), 35_000, encoder, key), record(sale(), cash(35_000), 35_000, encoder, key)]);
    expect(x!.json()).toEqual(y!.json());
    expect([count('qs.sale'), count('col.collection')]).toEqual([1, 1]);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random quick sales, payments and cancels: stored = computed, AR per sale never negative nor above the sale, invariants hold', async () => {
    let number = 10_000;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv();
        const db = t.db;
        const userId = createUser(db, `qs-prop-${number}`, ['accountant']);
        const cs = seedCustomers(db, userId);
        const actor = { userId, permissions: new Set(['qs.post', 'qs.cancel', 'col.post', 'col.cancel']) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const places = [cashPlaceId(db, '1101'), cashPlaceId(db, '1121')];
        // A first sale for each customer, so the arbitrary has customers to pick from.
        for (const customerId of [cs.school, cs.other]) postDocument(e, saleDoc, actor, { input: { customerId, invoiceNumber: String(++number), lines: [alteration] }, expectedTotalCents: 35_000 });
        const steps = g(() => fc.array(fc.constantFrom('sale', 'sale', 'pay', 'pay', 'cancel-payment', 'cancel-sale'), { minLength: 1, maxLength: 10 }));
        const posted = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        for (const step of steps) {
          try {
            if (step === 'sale') {
              const input = { ...g(() => saleDoc.arbitrary(db)), invoiceNumber: String(++number) };
              const doc = saleDoc.compute(input, ctx());
              const p = postDocument(e, saleDoc, actor, { input, expectedTotalCents: doc.totalCents });
              expect(saleDoc.load(db, p.id)).toEqual(doc);
              expect(saleDoc.toInput(doc)).toEqual(input);
              expect(doc.salesCents.made_to_order + doc.salesCents.ready_made + doc.salesCents.service + doc.vatCents).toBe(doc.grossCents + doc.discountNetCents);
            } else if (step === 'pay') {
              const open = posted('qs.sale').map((id) => ({ id, open: saleOpenCents(db, id), customerId: saleDoc.load(db, id).customerId })).filter((s) => s.open > 0);
              if (open.length === 0) continue;
              const s = g(() => fc.constantFrom(...open));
              const [amount, place] = g(() => fc.tuple(fc.integer({ min: 1, max: s.open }), fc.constantFrom(...places)));
              const input = { customerId: s.customerId, crNumber: String(++number), applications: [], sales: [{ saleId: s.id, amountCents: amount }], tenders: [{ cashPlaceId: place, amountCents: amount }] };
              const p = postDocument(e, collectionDoc, actor, { input, expectedTotalCents: amount });
              expect(collectionDoc.toInput(collectionDoc.load(db, p.id))).toEqual(input);
            } else {
              const [type, def] = step === 'cancel-sale' ? ['qs.sale', saleDoc] : ['col.collection', collectionDoc];
              const ids = posted(type);
              if (ids.length === 0) continue;
              cancelDocument(e, def, actor, g(() => fc.constantFrom(...ids)), 'Recorded by mistake');
            }
          } catch (err) {
            if (!(err instanceof AppError) || err.code !== 'HAS_DEPENDENTS') throw err; // a sale with a payment standing
          }
          for (const id of db.prepare(`SELECT id FROM documents WHERE doc_type = 'qs.sale'`).pluck().all() as string[]) {
            const { status, total_cents } = db.prepare('SELECT status, total_cents FROM documents WHERE id = ?').get(id) as { status: string; total_cents: number };
            const open = saleOpenCents(db, id);
            expect(open, step).toBeGreaterThanOrEqual(0);
            expect(open).toBeLessThanOrEqual(status === 'posted' ? total_cents : 0);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 25 },
    );
  });
});
