/**
 * Inventory count (PLAN D5 INV-COUNT, E9 "count adjustment both directions", golden G-22): goldens for a decrease, an
 * increase, the ready-made account 1302 and a cancel; the count rules; the default cost (ACC-13); the count sheet; and a
 * property test over random counts, cancels and edits.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AppError } from '@moonproject/shared';
import { balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { countDoc, type CountInput } from '../doctypes/count.ts';

let env: TestEnv;
let encoder: Client, accountant: Client, owner: Client;
let twill: string, thread: string, polo: string;

const accountId = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
/** A supply made in PUR, with the last purchase cost the catalogue keeps (the importer fills it in; no screen sets it yet). */
async function newSupply(name: string, unit: string, category: string, lastCostCents: number): Promise<string> {
  const id = (await accountant.post('/api/pur/supplies', { name, unit, category })).json().id as string;
  env.db.prepare('UPDATE pur_supplies SET last_purchase_cost_cents = ? WHERE id = ?').run(lastCostCents, id);
  return id;
}

beforeEach(async () => {
  env = await createTestEnv('2026-09-30T02:00:00Z'); // 10:00 on 30 September in Manila: a month end
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  twill = await newSupply('Cotton twill', 'yard', 'materials', 12_000); // ₱120.00 a yard
  thread = await newSupply('Thread cone', 'pc', 'materials', 5_000); // ₱50.00 a cone
  polo = await newSupply('Polo shirt, ready-made', 'pc', 'ready_made', 35_000); // ₱350.00 a piece
  august = { category: 'materials', lines: [{ supplyId: twill, qty: 200_000 }, { supplyId: thread, qty: 20 }] };
  september = { category: 'materials', lines: [{ supplyId: twill, qty: 325_000 }, { supplyId: thread, qty: 60 }] };
});

const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const count = (c: Client, input: CountInput, cents: number, businessDate?: string) =>
  c.post('/api/docs/inv.count/post', { input, expectedTotalCents: cents, ...(businessDate ? { businessDate } : {}) }, idem());
const preview = (c: Client, input: CountInput, businessDate?: string) => c.post('/api/docs/inv.count/preview', { input, ...(businessDate ? { businessDate } : {}) });
const cancel = (c: Client, id: string) => c.post(`/api/docs/inv.count/${id}/cancel`, { reason: 'Counted the wrong shelf' }, idem());
const codes = (r: { json(): { details?: { code: string }[] } }) => (r.json().details ?? []).map((i) => i.code);
/** A journal of a document: [code, debit, credit] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);
const reversalDate = (documentId: string) => env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(documentId);
/** ₱30,000.00 of materials brought in on the opening day (a JV against opening balance equity). */
const openMaterials = async () => {
  const r = await accountant.post('/api/docs/acc.jv/post', {
    input: { memo: 'Materials on hand at cut-over', lines: [{ accountId: accountId('1301'), debitCents: 3_000_000 }, { accountId: accountId('3900'), creditCents: 3_000_000 }], lateReason: 'Opening inventory for the count test' },
    expectedTotalCents: 3_000_000, businessDate: '2026-08-01',
  }, idem());
  expect(r.statusCode).toBe(200);
};
/** 200 yards of twill at ₱120.00 and 20 cones at ₱50.00 = ₱25,000.00. */
let august: CountInput;
/** 325 yards of twill and 60 cones = ₱42,000.00. */
let september: CountInput;
/** A day later: sessions end after 12 hours, so everyone signs in again. */
const nextDay = async () => {
  env.clock.advance(24 * 3600_000);
  [encoder, accountant, owner] = await Promise.all([env.as('encoder'), env.as('accountant'), env.as('owner')]);
};

describe('Inventory count golden (PLAN I2 G-22)', () => {
  it('GL 1301 ₱30,000, counted ₱25,000: Dr 5109 5,000.00 / Cr 1301; next count ₱42,000: Dr 1301 17,000.00 / Cr 5109', async () => {
    await openMaterials();
    // The August count is recorded in September, so the accountant dates it the month end.
    const pre = await preview(accountant, august, '2026-08-31');
    expect(pre.json()).toMatchObject({
      totalCents: 2_500_000, issues: [],
      summary: 'This will record materials and supplies counted at ₱25,000.00 on 2026-08-31 against ₱30,000.00 in the books: ₱5,000.00 less, posted to inventory change.',
      doc: { countedCents: 2_500_000, ledgerCents: 3_000_000, adjustmentCents: -500_000 },
    });
    expect(pre.json().doc.lines).toMatchObject([
      { name: 'Cotton twill', unit: 'yard', qty: 200_000, unitCostCents: 12_000, defaultCostCents: 12_000, costSource: 'catalogue', valueCents: 2_400_000 },
      { name: 'Thread cone', unit: 'pc', qty: 20, unitCostCents: 5_000, costSource: 'catalogue', valueCents: 100_000 },
    ]);
    const aug = await count(accountant, august, 2_500_000, '2026-08-31');
    expect(aug.json()).toMatchObject({ number: 'INVC-000001', businessDate: '2026-08-31', warnings: [] });
    expect(journalOf(aug.json().id)).toEqual([['5109', 500_000, 0], ['1301', 0, 500_000]]);
    expect(accountBalance(env.db, accountId('1301'), { asOf: '2026-08-31' })).toBe(2_500_000);

    // The September count on its own day needs no backdating: an owner records it.
    const sep = await count(owner, september, 4_200_000);
    expect(sep.json()).toMatchObject({ number: 'INVC-000002', businessDate: '2026-09-30', warnings: [],
      summary: 'This will record materials and supplies counted at ₱42,000.00 on 2026-09-30 against ₱25,000.00 in the books: ₱17,000.00 more, posted to inventory change.' });
    expect(journalOf(sep.json().id)).toEqual([['1301', 1_700_000, 0], ['5109', 0, 1_700_000]]);
    expect(balances(env.db)).toEqual({ '1301': 4_200_000, '5109': -1_200_000, '3900': -3_000_000 });

    const view = (await encoder.get(`/api/docs/inv.count/${sep.json().id}`)).json();
    expect(view.doc).toMatchObject({ category: 'materials', countDate: '2026-09-30', countedCents: 4_200_000, ledgerCents: 2_500_000, adjustmentCents: 1_700_000 });
    expect(view.input).toEqual(september);
    noBrokenInvariants();
  });

  it('ready-made merchandise posts to 1302: 12 polo shirts at ₱350.00, Dr 1302 4,200.00 / Cr 5109', async () => {
    const r = await count(owner, { category: 'ready_made', lines: [{ supplyId: polo, qty: 12 }] }, 420_000);
    expect(r.json()).toMatchObject({ number: 'INVC-000001', summary: 'This will record ready-made merchandise counted at ₱4,200.00 on 2026-09-30 against ₱0.00 in the books: ₱4,200.00 more, posted to inventory change.' });
    expect(journalOf(r.json().id)).toEqual([['1302', 420_000, 0], ['5109', 0, 420_000]]);
    expect(balances(env.db)).toEqual({ '1302': 420_000, '5109': -420_000 });
    noBrokenInvariants();
  });

  it('cancel mirrors the adjustment on the count date, latest count first (D6); a past count date needs acc.backdate', async () => {
    await openMaterials();
    const aug = (await count(accountant, august, 2_500_000, '2026-08-31')).json().id as string;
    const sep = (await count(accountant, september, 4_200_000)).json().id as string;
    expect(await cancel(encoder, sep).then((r) => r.statusCode)).toBe(403);
    const blocked = await cancel(accountant, aug);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: INVC-000002.' });

    await nextDay(); // 1 October
    expect((await cancel(accountant, sep)).statusCode).toBe(200);
    expect(journalOf(sep, 'reversal')).toEqual([['1301', 0, 1_700_000], ['5109', 1_700_000, 0]]);
    expect(reversalDate(sep)).toBe('2026-09-30');
    expect((await cancel(owner, aug)).statusCode).toBe(403); // a mirror on 31 August is backdating
    expect((await cancel(accountant, aug)).statusCode).toBe(200);
    expect(reversalDate(aug)).toBe('2026-08-31');
    expect(journalOf(aug, 'reversal')).toEqual([['5109', 0, 500_000], ['1301', 500_000, 0]]);
    expect(balances(env.db)).toEqual({ '1301': 3_000_000, '3900': -3_000_000 });
    noBrokenInvariants();
  });

  it('an edit of the latest count is cancel + reissue on the same count date', async () => {
    await openMaterials();
    const aug = (await count(accountant, august, 2_500_000, '2026-08-31')).json().id as string;
    await nextDay(); // 1 October
    const fixed: CountInput = { category: 'materials', lines: [{ supplyId: twill, qty: 205_000 }, { supplyId: thread, qty: 20 }] }; // ₱25,600.00
    const r = await accountant.post(`/api/docs/inv.count/${aug}/reissue`, { input: fixed, expectedTotalCents: 2_560_000, reason: 'Five yards were on the cutting table', businessDate: '2026-08-31' }, idem());
    expect(r.json()).toMatchObject({ number: 'INVC-000002', businessDate: '2026-08-31' });
    // The first count comes off on 31 August too, so the replacement counts against the books without it (₱30,000.00).
    expect(journalOf(r.json().id)).toEqual([['5109', 440_000, 0], ['1301', 0, 440_000]]);
    expect(accountBalance(env.db, accountId('1301'), { asOf: '2026-08-31' })).toBe(2_560_000);
    expect(accountBalance(env.db, accountId('1301'))).toBe(2_560_000); // and still after the edit day
    noBrokenInvariants();
  });
});

describe('count rules', () => {
  it('who does what: encoders prepare, the accountant and owners record, only the accountant backdates', async () => {
    const pre = await preview(encoder, september);
    expect(pre.statusCode).toBe(200);
    expect(pre.json()).toMatchObject({ totalCents: 4_200_000, doc: { adjustmentCents: 4_200_000 } });
    expect(pre.json().journal).toBeUndefined(); // encoders do not see journals
    expect((await count(encoder, september, 4_200_000)).statusCode).toBe(403);
    expect((await preview(encoder, august, '2026-08-31')).statusCode).toBe(403); // acc.backdate
    expect((await count(owner, august, 2_500_000, '2026-08-31')).statusCode).toBe(403);
    expect((await (await env.as('production')).post('/api/docs/inv.count/preview', { input: september })).statusCode).toBe(403);
    expect((await accountant.post('/api/docs/inv.count/preview', { input: { ...september, countedCents: 1 } })).statusCode).toBe(400); // no totals from the client
  });

  it('a count is dated a month end', async () => {
    const r = await preview(accountant, september, '2026-09-15');
    expect(r.json().issues).toEqual([expect.objectContaining({ code: 'NOT_MONTH_END', level: 'error', message: 'Inventory is counted at a month end. Record this count on 2026-09-30, or the accountant dates it 2026-08-31.' })]);
    expect(r.json().journal).toBeNull();
    expect((await count(accountant, september, 4_200_000, '2026-09-15')).json().code).toBe('VALIDATION');
    expect((await preview(accountant, september, '2026-10-31')).json().code).toBe('BAD_DATE'); // never the future
    expect((await preview(accountant, september, '2025-12-31')).json().issues).toEqual([]); // a year end
  });

  it('one posted count per category and date; a count equal to the books is refused', async () => {
    expect((await count(owner, september, 4_200_000)).statusCode).toBe(200);
    const twice = await count(owner, { ...september, lines: [{ supplyId: twill, qty: 1_000 }] }, 12_000);
    expect(twice.statusCode).toBe(422);
    expect(twice.json().message).toBe('The materials and supplies count of 2026-09-30 is already recorded on INVC-000001. To correct it, edit INVC-000001.');
    expect((await count(owner, { category: 'ready_made', lines: [{ supplyId: polo, qty: 1 }] }, 35_000)).statusCode).toBe(200); // the other category

    await openMaterials();
    const same = await count(accountant, { category: 'materials', lines: [{ supplyId: twill, qty: 250_000 }] }, 3_000_000, '2026-08-31'); // 250 yards = ₱30,000.00
    expect(same.statusCode).toBe(422);
    expect(same.json()).toMatchObject({ code: 'VALIDATION', message: 'The count matches the books (₱30,000.00), so there is nothing to adjust.' });
    expect(codes(same)).toEqual(['NO_DIFFERENCE']);
  });

  it('warns when a later count of the category is recorded', async () => {
    await openMaterials();
    expect((await count(accountant, september, 4_200_000)).statusCode).toBe(200);
    expect((await preview(accountant, { category: 'materials', lines: [] }, '2026-08-31')).json().issues).toEqual([
      expect.objectContaining({ code: 'LATER_COUNT' }),
      expect.objectContaining({ code: 'NOTHING_COUNTED', message: 'Nothing is counted, so all ₱30,000.00 of materials and supplies in the books is written off.' }),
    ]);
    const aug = await count(accountant, august, 2_500_000, '2026-08-31');
    expect(aug.statusCode).toBe(200);
    expect(aug.json().warnings).toEqual([expect.objectContaining({
      code: 'LATER_COUNT',
      message: 'A later materials and supplies count is recorded (INVC-000001 of 2026-09-30). This adjustment also moves the books on that date, so they will no longer match: edit INVC-000001 after recording this one.',
    })]);
  });

  it('the counter may change a cost with a reason; milli-units round per line', async () => {
    // 12.345 yards at ₱123.45 = ₱1,523.99025 -> ₱1,523.99; 3 cones at ₱50.00 (the default, typed again: no reason needed).
    const lines = [{ supplyId: twill, qty: 12_345, unitCostCents: 12_345 }, { supplyId: thread, qty: 3, unitCostCents: 5_000 }];
    const noReason = await preview(accountant, { category: 'materials', lines });
    expect(noReason.json().issues).toEqual([expect.objectContaining({
      field: 'lines.0.costReason', code: 'COST_REASON', message: 'Cotton twill: say why the cost is ₱123.45 and not the latest purchase cost of ₱120.00.',
    })]);
    const input: CountInput = { category: 'materials', lines: [{ ...lines[0]!, costReason: 'Supplier price rose in September' }, lines[1]!] };
    const r = await count(accountant, input, 167_399);
    expect(r.statusCode).toBe(200);
    const view = (await accountant.get(`/api/docs/inv.count/${r.json().id}`)).json();
    expect(view.doc.lines).toMatchObject([
      { qty: 12_345, unitCostCents: 12_345, defaultCostCents: 12_000, costReason: 'Supplier price rose in September', valueCents: 152_399 },
      { qty: 3, unitCostCents: 5_000, defaultCostCents: 5_000, valueCents: 15_000 },
    ]);
    expect(view.doc.lines[1].costReason).toBeUndefined();
    expect(view.input.lines).toEqual([{ supplyId: twill, qty: 12_345, unitCostCents: 12_345, costReason: 'Supplier price rose in September' }, { supplyId: thread, qty: 3 }]);
  });

  it('refuses supplies of the other category, the same supply twice and unknown supplies', async () => {
    const r = await preview(accountant, { category: 'materials', lines: [{ supplyId: polo, qty: 1 }, { supplyId: twill, qty: 1_000 }, { supplyId: twill, qty: 2_000 }, { supplyId: 'no-such-supply', qty: 1 }] });
    expect(r.json().issues.map((i: { code: string }) => i.code)).toEqual(['CATEGORY', 'DUPLICATE', 'SUPPLY']);
    expect(r.json().issues[0].message).toBe('Polo shirt, ready-made is not materials and supplies: it goes on the other count sheet.');
    expect((await preview(accountant, { category: 'materials', lines: [{ supplyId: twill, qty: 1.5 }] } as CountInput)).statusCode).toBe(400); // milli-units are whole
  });
});

describe('default cost: the latest purchase cost on the count date (ACC-13)', () => {
  const costOf = async (asOf?: string) => {
    const r = await preview(accountant, { category: 'materials', lines: [{ supplyId: twill, qty: 1_000 }] }, asOf);
    return r.json().doc.lines[0] as { unitCostCents: number; costSource: string; costSourceNumber: string | null };
  };

  it('the newest bill that tells a unit cost, else the newest purchase order, else the catalogue', async () => {
    expect(await costOf()).toMatchObject({ unitCostCents: 12_000, costSource: 'catalogue', costSourceNumber: null });
    const supplier = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true })).json().id as string;
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId: supplier, lines: [{ supplyId: twill, qty: 100, unitCostCents: 11_500 }] }, expectedTotalCents: 1_150_000 }, idem());
    expect(po.statusCode).toBe(200);
    expect(await costOf()).toMatchObject({ unitCostCents: 11_500, costSource: 'po', costSourceNumber: 'PO-000001' });
    expect(await costOf('2026-08-31')).toMatchObject({ costSource: 'catalogue' }); // the order came after the count date

    // A bill without a receiving report cannot tell a unit cost (its lines have no quantity), so the order still counts.
    const bill = (invoiceNo: string, gross: number, receivingReportId?: string) =>
      encoder.post('/api/docs/ap.bill/post', { input: { supplierId: supplier, supplierInvoiceNo: invoiceNo, supplierInvoiceDate: '2026-09-29', lines: [{ supplyId: twill, amountCents: gross }], ...(receivingReportId ? { receivingReportId } : {}) }, expectedTotalCents: gross }, idem());
    expect((await bill('SI-100', 1_344_000)).statusCode).toBe(200);
    expect(await costOf()).toMatchObject({ costSource: 'po' });
    // 80 yards received, billed ₱10,752.00 with VAT: ₱9,600.00 before VAT = ₱120.00 a yard.
    const rr = await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: po.json().id, lines: [{ poLineNo: 1, qty: 80 }] }, expectedTotalCents: 0 }, idem());
    expect(rr.statusCode).toBe(200);
    expect((await bill('SI-101', 1_075_200, rr.json().id)).statusCode).toBe(200);
    expect(await costOf()).toMatchObject({ unitCostCents: 12_000, costSource: 'bill', costSourceNumber: 'BILL-000002' });
    // A cancelled bill no longer counts.
    await accountant.post(`/api/docs/ap.bill/${(await accountant.get('/api/docs/ap.bill?limit=1')).json()[0].id}/cancel`, { reason: 'Wrong supplier invoice' }, idem());
    expect(await costOf()).toMatchObject({ costSource: 'po' });
  });

  it('the count sheet lists every active supply of the category with its unit and cost, and an empty quantity column', async () => {
    await newSupply('Buttons, 4-hole', 'pc', 'materials', 150);
    const retired = await newSupply('Old lining', 'meter', 'materials', 9_000);
    const v = (await accountant.get('/api/pur/supplies')).json().find((s: { id: string }) => s.id === retired).version as number;
    expect((await accountant.post(`/api/pur/supplies/${retired}/deactivate`, {}, { 'if-match': String(v) })).statusCode).toBe(200);

    const csv = await encoder.get('/api/inv/count-sheet?category=materials');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="count-sheet-materials-2026-09-30.csv"');
    expect(csv.body).toBe('﻿' + [
      '"Supply","Unit","Cost per unit","Cost from","Quantity counted"',
      '"Buttons, 4-hole","pc","1.50","Catalogue",""',
      '"Cotton twill","yard","120.00","Catalogue",""',
      '"Thread cone","pc","50.00","Catalogue",""',
    ].join('\r\n') + '\r\n');

    const json = (await encoder.get('/api/inv/count-sheet?category=ready_made&format=json&date=2026-08-31')).json();
    expect(json).toEqual({ category: 'ready_made', date: '2026-08-31', supplies: [{ supplyId: polo, name: 'Polo shirt, ready-made', unit: 'pc', milliUnits: false, defaultCostCents: 35_000, costSource: 'catalogue', costSourceNumber: null }] });
    expect((await encoder.get('/api/inv/count-sheet?category=fabric')).json().code).toBe('BAD_CATEGORY');
    expect((await encoder.get('/api/inv/count-sheet?category=materials&date=2026-10-01')).json().code).toBe('BAD_DATE');
    expect((await (await env.as('tv')).get('/api/inv/count-sheet?category=materials')).statusCode).toBe(403);
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random counts post the difference, leave the books equal to the count on its date, and cancel or edit cleanly', async () => {
    await newSupply('Interfacing', 'meter', 'materials', 4_000);
    await newSupply('Canvas', 'kg', 'materials', 25_000);
    await newSupply('Cap, ready-made', 'pc', 'ready_made', 18_000);
    const actor = { userId: accountant.userId, permissions: new Set(['inv.count.create', 'inv.count.post', 'inv.count.cancel', 'acc.backdate']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = (businessDate: string) => ({ db: env.db, businessDate, at: '2026-09-30T10:00:00.000+08:00', userId: actor.userId, can: (p: string) => actor.permissions.has(p) });
    const inventory = { materials: accountId('1301'), ready_made: accountId('1302') };
    /** Month ends counting back from August 2026, a fresh block of six for every run so each run starts on dates never counted. */
    let run = 0;
    const monthEnd = (back: number) => {
      const d = new Date(Date.UTC(2026, 8 - back, 0));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const doubled = (i: CountInput): CountInput => ({ ...i, lines: i.lines.map((l) => ({ ...l, qty: l.qty * 2 })) });

    fc.assert(
      fc.property(fc.array(fc.tuple(countDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 6 }), (ops) => {
        const block = 6 * run++;
        const posted: string[] = [];
        ops.forEach(([input, then], i) => {
          const date = monthEnd(block + 5 - i); // oldest first within the run
          const computed = countDoc.compute(input, ctx(date));
          if (computed.adjustmentCents === 0) {
            expect(() => postDocument(e, countDoc, actor, { input, expectedTotalCents: computed.totalCents, businessDate: date })).toThrow('nothing to adjust');
            return;
          }
          const p = postDocument(e, countDoc, actor, { input, expectedTotalCents: computed.totalCents, businessDate: date });
          expect(countDoc.load(env.db, p.id)).toEqual(computed);
          expect(accountBalance(env.db, inventory[input.category], { asOf: date })).toBe(computed.countedCents);
          if (then === 'cancel') cancelDocument(e, countDoc, actor, p.id, 'Recorded twice by mistake');
          else if (then === 'reissue') {
            const again = countDoc.compute(doubled(input), ctx(date)); // checked against the books again
            const r = reissueDocument(e, countDoc, actor, p.id, { input: doubled(input), expectedTotalCents: again.totalCents, reason: 'Counted the second shelf too', businessDate: date });
            expect(accountBalance(env.db, inventory[input.category], { asOf: date })).toBe(again.countedCents);
            posted.push(r.id);
          } else posted.push(p.id);
        });
        // Leave nothing posted for the next run: latest first, as D6 requires.
        for (const id of posted.reverse()) cancelDocument(e, countDoc, actor, id, 'Clearing the run for the next one');
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  it('a failed post changes nothing', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['inv.count.create', 'inv.count.post']) };
    const before = balances(env.db);
    try {
      postDocument({ db: env.db, clock: env.clock }, countDoc, actor, { input: { category: 'materials', lines: [{ supplyId: polo, qty: 1 }] }, expectedTotalCents: 35_000 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION');
    }
    expect(balances(env.db)).toEqual(before);
    expect(env.db.prepare('SELECT COUNT(*) FROM inv_counts').pluck().get()).toBe(0);
  });
});
