/**
 * Fixed assets: golden G-21, straight line to the residual, the VAT rate from dated settings, each cancel (a run only
 * when it is the latest for its assets), the retirement, and a property test over purchases, runs and disposals.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { cancelDocument, postDocument, previewDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { assetRegister, assetsInService } from '../assets.ts';
import { buyDoc, type BuyInput } from '../doctypes/buy.ts';
import { depreciationDoc } from '../doctypes/depreciation.ts';
import { disposalDoc } from '../doctypes/disposal.ts';

let env: TestEnv;
let acc: Client;
let BDO: number, vatSupplier: string, plainSupplier: string;

beforeEach(async () => {
  env = await createTestEnv();
  acc = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  const sup = async (body: object) => (await acc.post('/api/pur/suppliers', body)).json().id as string;
  vatSupplier = await sup({ name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true });
  plainSupplier = await sup({ name: 'Sample Furniture Shop', registeredName: 'Sample Furniture Shop', tin: '222-333-444-000', isVatRegistered: false });
});

const post = (type: string, input: object, expectedTotalCents: number, c = acc) => c.post(`/api/docs/fa.${type}/post`, { input, expectedTotalCents }, idem());
const buy = (input: { amountCents: number; [k: string]: unknown }) => post('buy', input, input.amountCents);
const run = async (month: string) => post('depreciation', { month }, (await acc.post('/api/docs/fa.depreciation/preview', { input: { month } })).json().totalCents);
const cancel = (type: string, id: string) => acc.post(`/api/docs/fa.${type}/${id}/cancel`, { reason: 'Recorded by mistake, redo' }, idem());
/** The original journal of a document: [code, party type, party id, debit, credit] per line. */
const journalOf = (documentId: string) =>
  env.db.prepare(`SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`).raw().all(documentId);
const errorCodes = (r: { json(): { details?: { code: string; level: string }[] } }) => (r.json().details ?? []).filter((i) => i.level === 'error').map((i) => i.code);
const registerRow = async (id: string) => ((await acc.get('/api/fa/assets')).json() as { id: string }[]).find((a) => a.id === id);
/** The asset's balance on its cost account (15x0: the debit-side accounts that carry the asset as party). */
const costOnBooks = (assetId: string) =>
  env.db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.party_type = 'asset' AND l.party_id = ? AND a.normal_side = 'debit'`).pluck().get(assetId) as number;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
/** Moves the clock to a day in a later month; yesterday's session has timed out. */
const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));

const heatPress = () => ({
  classCode: 'machinery', description: 'Heat press', location: 'Production floor', supplierId: vatSupplier, supplierInvoiceNo: 'SI-2001',
  supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 3_000_000,
  financedCents: 8_200_000, lender: 'Sample Equipment Finance',
});

describe('golden G-21: heat press ₱112,000 VAT included, ₱30,000 from BDO, ₱82,000 financed, residual 10,000, 60 months', () => {
  it('capitalises the net cost, claims the VAT in full, charges 1,500.00 a month to 5302 and blocks a second run', async () => {
    const res = await buy(heatPress());
    expect(res.statusCode).toBe(200);
    const { id, number } = res.json();
    expect(number).toBe('FA-000001');
    expect(journalOf(id)).toEqual([
      ['1510', 'asset', id, 10_000_000, 0],
      ['1401', 'supplier', vatSupplier, 1_200_000, 0],
      ['1111', null, null, 0, 3_000_000],
      ['2602', 'loan', id, 0, 8_200_000],
    ]);

    const r = await run('2026-09');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ number: 'DEPR-000001', totalCents: 150_000, summary: 'This will charge ₱1,500.00 depreciation for September 2026 on 1 asset.' });
    expect(journalOf(r.json().id)).toEqual([['5302', null, null, 150_000, 0], ['1511', 'asset', id, 0, 150_000]]);

    const again = await post('depreciation', { month: '2026-09' }, 0);
    expect(again.statusCode).toBe(422);
    expect(errorCodes(again)).toEqual(['ALREADY_RUN']);
    expect(await registerRow(id)).toMatchObject({ status: 'in service', lifeMonths: 60, monthlyChargeCents: 150_000, accumulatedCents: 150_000, bookValueCents: 9_850_000, location: 'Production floor' });
    noBrokenInvariants();
  });
});

describe('purchases and the straight line', () => {
  it('other classes go to 6210, on account to 2101; charges add up to cost − residual and stop there, a missed month is caught up', async () => {
    const chairs = (await buy({ classCode: 'furniture', description: 'Office chairs', supplierId: plainSupplier, amountCents: 100_000, residualCents: 0, lifeMonths: 3, onAccountCents: 100_000 })).json();
    expect(chairs.warnings.map((w: { code: string }) => w.code)).toEqual(['LIFE_DIFFERENT']);
    expect(journalOf(chairs.id)).toEqual([['1530', 'asset', chairs.id, 100_000, 0], ['2101', 'supplier', plainSupplier, 0, 100_000]]);
    expect(env.db.prepare(`SELECT ref_doc_id FROM journal_lines WHERE party_id = ? AND ref_doc_id IS NOT NULL`).pluck().get(plainSupplier)).toBe(chairs.id);
    expect(journalOf((await run('2026-09')).json().id)).toEqual([['6210', null, null, 33_333, 0], ['1531', 'asset', chairs.id, 0, 33_333]]);
    await goTo('2026-11-20T02:00:00Z'); // October was not run: November catches it up
    expect((await run('2026-11')).json().totalCents).toBe(66_667);
    await goTo('2026-12-20T02:00:00Z');
    const none = await run('2026-12');
    expect(errorCodes(none)).toEqual(['NOTHING_TO_CHARGE']);
    expect(await registerRow(chairs.id)).toMatchObject({ status: 'fully depreciated', accumulatedCents: 100_000, bookValueCents: 0 });
    expect(errorCodes(await run('2026-10'))).toEqual(['OUT_OF_ORDER']);
    expect(errorCodes(await run('2027-01'))).toEqual(['FUTURE_MONTH']);
    noBrokenInvariants();
  });

  it('a run after month end is dated the month\'s last day by the accountant, so the charge falls in that month', async () => {
    await buy(heatPress());
    await goTo('2026-10-02T02:00:00Z');
    const late = await run('2026-09');
    expect(errorCodes(late)).toEqual(['WRONG_MONTH']);
    expect(late.json().message).toBe('The charge for September 2026 belongs in September 2026. The accountant dates this run 2026-09-30.');
    const input = { month: '2026-09' };
    const pre = (await acc.post('/api/docs/fa.depreciation/preview', { input, businessDate: '2026-09-30' })).json();
    const sep = await acc.post('/api/docs/fa.depreciation/post', { input, expectedTotalCents: pre.totalCents, businessDate: '2026-09-30' }, idem());
    expect(sep.statusCode, sep.body).toBe(200);
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ?`).pluck().get(sep.json().id)).toBe('2026-09-30');
    expect((await run('2026-10')).json().totalCents).toBe(150_000);
    noBrokenInvariants();
  });

  it('reads the VAT rate in force on the supplier invoice date', async () => {
    env.db
      .prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run('tax.vat_rate_bp', '2026-09-15', '1000', 'Test: a 10% rate', '2026-09-28T10:00:00.000+08:00', acc.userId);
    const vatOn = async (supplierInvoiceDate: string) =>
      (await acc.post('/api/docs/fa.buy/preview', { input: { ...heatPress(), supplierInvoiceDate } })).json().doc.inputVatCents;
    expect(await vatOn('2026-09-10')).toBe(1_200_000);
    expect(await vatOn('2026-09-20')).toBe(1_018_182);
  });

  it('checks the payment, the life, the residual and who may record', async () => {
    const bad = async (extra: object) => errorCodes(await buy({ ...heatPress(), ...extra }));
    expect(await bad({ paidCents: 2_000_000 })).toEqual(['PAYMENT']);
    expect(await bad({ lender: undefined })).toEqual(['LENDER']);
    expect(await bad({ residualCents: 10_000_000 })).toEqual(['RESIDUAL']);
    expect(await bad({ classCode: 'leasehold' })).toEqual(['LIFE']);
    expect((await buy({ ...heatPress(), classCode: 'leasehold', lifeMonths: 24 })).statusCode).toBe(200);
    expect(await bad({})).toEqual(['DUPLICATE_INVOICE']);
    const encoder = await env.as('encoder');
    expect((await post('buy', { ...heatPress(), supplierInvoiceNo: 'SI-2002' }, 11_200_000, encoder)).statusCode).toBe(403);
  });
});

describe('cancel mirrors each posting', () => {
  it('a purchase waits for its runs; a run can be cancelled only when it is the latest for its assets', async () => {
    const press = (await buy(heatPress())).json();
    const sep = (await run('2026-09')).json();
    await goTo('2026-10-20T02:00:00Z');
    const oct = (await run('2026-10')).json();
    const blocked = await cancel('buy', press.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toBe('Cancel these first: DEPR-000001, DEPR-000002.');
    expect((await cancel('depreciation', sep.id)).json().message).toBe('Cancel these first: DEPR-000002.');
    expect((await cancel('depreciation', oct.id)).statusCode).toBe(200);
    expect(await registerRow(press.id)).toMatchObject({ accumulatedCents: 150_000 });
    expect((await cancel('depreciation', sep.id)).statusCode).toBe(200);
    expect((await cancel('buy', press.id)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    expect(await registerRow(press.id)).toMatchObject({ status: 'cancelled', bookValueCents: 0 });
    noBrokenInvariants();
  });

  it('a run is redone (cancel + new number) to take in an asset bought later that month', async () => {
    await buy(heatPress());
    const sep = (await run('2026-09')).json();
    await buy({ classCode: 'computers', description: 'Laptop', supplierId: plainSupplier, amountCents: 3_600_000, residualCents: 0, cashPlaceId: BDO, paidCents: 3_600_000 });
    const redo = await acc.post(`/api/docs/fa.depreciation/${sep.id}/reissue`, { input: { month: '2026-09' }, expectedTotalCents: 250_000, reason: 'Include the laptop bought today' }, idem());
    expect(redo.statusCode).toBe(200);
    expect(redo.json().number).toBe('DEPR-000002');
    expect(balances(env.db)).toMatchObject({ '5302': 150_000, '6210': 100_000, '1511': -150_000, '1521': -100_000 });
    noBrokenInvariants();
  });

  it('retirement: book value to 7202, a sale needs its invoice, later runs skip the asset, cancel puts it back', async () => {
    const press = (await buy(heatPress())).json();
    const sep = (await run('2026-09')).json();
    const sale = await post('disposal', { assetId: press.id, kind: 'sale', reason: 'Sold to another shop' }, 0); // a sale's total is its price
    expect(errorCodes(sale)).toEqual(['BUYER', 'INVOICE', 'PRICE', 'CASH_PLACE']);
    const fad = await post('disposal', { assetId: press.id, kind: 'retirement', reason: 'Heating plate cracked, scrapped' }, 10_000_000);
    expect(fad.json()).toMatchObject({ number: 'FAD-000001', summary: 'This will retire FA-000001 Heat press: cost ₱100,000.00 less ₱1,500.00 accumulated depreciation, a loss of ₱98,500.00 (its book value).' });
    expect(journalOf(fad.json().id)).toEqual([['1511', 'asset', press.id, 150_000, 0], ['7202', null, null, 9_850_000, 0], ['1510', 'asset', press.id, 0, 10_000_000]]);
    expect(await registerRow(press.id)).toMatchObject({ status: 'disposed', disposal: 'FAD-000001', bookValueCents: 0 });
    expect(errorCodes(await post('disposal', { assetId: press.id, kind: 'retirement', reason: 'Again by mistake' }, 10_000_000))).toEqual(['DISPOSED']);
    expect((await cancel('depreciation', sep.id)).json().message).toBe('Cancel these first: FAD-000001.');
    await goTo('2026-10-20T02:00:00Z');
    expect(errorCodes(await run('2026-10'))).toEqual(['NOTHING_TO_CHARGE']);
    expect((await cancel('disposal', fad.json().id)).statusCode).toBe(200);
    expect(await registerRow(press.id)).toMatchObject({ status: 'in service', accumulatedCents: 150_000 });
    expect((await run('2026-10')).json().totalCents).toBe(150_000);
    noBrokenInvariants();
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random purchases, month-end runs, retirements and cancels keep the books and the register straight', () => {
    const actor = { userId: acc.userId, permissions: new Set(['buy', 'depr', 'disp'].flatMap((d) => ['create', 'post', 'cancel'].map((a) => `fa.${d}.${a}`))) };
    const e = { db: env.db, clock: env.clock };
    let month = 2026 * 12 + 9; // months since year 0; the clock only moves forward
    let invoice = 0;
    const tryIt = (fn: () => unknown, allowed: string) => {
      try {
        fn();
      } catch (err) {
        if (!(err instanceof AppError && err.code === allowed)) throw err;
      }
    };
    const latest = (sql: string) => env.db.prepare(sql).get() as { id: string; month?: string } | undefined;
    const lastRun = `SELECT r.document_id AS id, r.month FROM fa_depreciation_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' ORDER BY r.month DESC LIMIT 1`;
    const lastDisposal = `SELECT x.document_id AS id FROM fa_disposals x JOIN documents d ON d.id = x.document_id WHERE d.status = 'posted' ORDER BY d.number DESC LIMIT 1`;
    const step = fc.record({ buys: fc.array(buyDoc.arbitrary(env.db), { maxLength: 2 }), retire: fc.option(fc.nat(), { nil: undefined }), run: fc.boolean(), redo: fc.boolean(), cancel: fc.constantFrom('none', 'run', 'disposal', 'buy'), pick: fc.nat() });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 5 }), (steps) => {
        for (const s of steps) {
          month += 1;
          const ym = `${Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, '0')}`;
          env.clock.set(`${ym}-25T02:00:00Z`);
          for (const input of s.buys) {
            const withNo: BuyInput = input.supplierInvoiceNo ? { ...input, supplierInvoiceNo: `SI-${++invoice}` } : input;
            postDocument(e, buyDoc, actor, { input: withNo, expectedTotalCents: withNo.amountCents });
          }
          const inService = assetsInService(env.db);
          const a = inService[(s.retire ?? 0) % Math.max(inService.length, 1)];
          if (s.retire !== undefined && a) postDocument(e, disposalDoc, actor, { input: { assetId: a.id, kind: 'retirement', reason: 'Scrapped' }, expectedTotalCents: a.costCents });
          const input = { month: ym };
          if (s.run) tryIt(() => postDocument(e, depreciationDoc, actor, { input, expectedTotalCents: previewDocument(e, depreciationDoc, actor, input).totalCents }), 'VALIDATION');
          const own = latest(lastRun);
          // A redo right away charges the same (its preview would still see the run it replaces).
          const same = own && (env.db.prepare('SELECT total_cents FROM documents WHERE id = ?').pluck().get(own.id) as number);
          if (s.redo && own?.month === ym) reissueDocument(e, depreciationDoc, actor, own.id, { input, expectedTotalCents: same!, reason: 'Redo, same figures' });
          const assets = env.db.prepare('SELECT document_id FROM fa_assets ORDER BY document_id').pluck().all() as string[];
          const cancels: Record<typeof s.cancel, [DocTypeDef, string | undefined]> = { none: [buyDoc, undefined], run: [depreciationDoc, latest(lastRun)?.id], disposal: [disposalDoc, latest(lastDisposal)?.id], buy: [buyDoc, assets[s.pick % Math.max(assets.length, 1)]] };
          const [def, id] = cancels[s.cancel];
          if (id && env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(id) === 'posted') tryIt(() => cancelDocument(e, def, actor, id, 'Recorded in error, undone'), 'HAS_DEPENDENTS');
        }
        // Each asset's cost is on the books only while in service, and its accumulated depreciation stays within cost − residual.
        for (const r of assetRegister(env.db)) {
          const off = r.status === 'disposed' || r.status === 'cancelled';
          expect(costOnBooks(r.id)).toBe(off ? 0 : r.costCents);
          expect(r.accumulatedCents).toBeGreaterThanOrEqual(0);
          expect(r.accumulatedCents).toBeLessThanOrEqual(off ? 0 : r.costCents - r.residualCents);
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 25 },
    );
    const twice = `SELECT l.asset_id FROM fa_depreciation_lines l JOIN documents d ON d.id = l.document_id WHERE d.status = 'posted' GROUP BY l.asset_id, l.month HAVING COUNT(*) > 1`;
    expect(env.db.prepare(twice).all()).toEqual([]);
  });
});
