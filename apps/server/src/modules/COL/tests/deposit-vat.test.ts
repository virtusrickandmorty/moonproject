/**
 * Downpayment VAT modes B and C (PLAN D3 "Downpayment VAT modes", D5 DEP-VAT, DEP-VAT-REV, INV-DP; ACC-02): goldens G-04
 * and G-05 (PLAN I2) with their cancels; refunds, deposit transfers and forfeits in mode B; mode C with the collection
 * first; a job order that spans a mode change; the VAT registers, the 2550Q worksheet and the VAT close across a quarter;
 * and property tests in each mode: 2209 ends at zero once every job order is invoiced, 2201 ties to the deposits held
 * report and 1201 to the AR aging, the sales register ties to 2301, and every mode books the same output VAT.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError, vatFromGross } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { addSettingVersion, type SettingKey } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { lineState, releaseDoc } from '../../JO/doctypes/release.ts';
import { awaitingInvoice, invoiceRecordDoc } from '../../JO/doctypes/invoice-record.ts';
import { dpInvoiceDoc } from '../../JO/doctypes/dp-invoice.ts';
import { isAbandoned, jobOrdersOf, joMoney } from '../../JO/public.ts';
import { changeStage } from '../../JO/stages.ts';
import { salesRegister } from '../../TAX/registers.ts';
import { vatReturnWorksheet } from '../../TAX/vat-return.ts';
import { vatPosition } from '../../TAX/vat.ts';
import { arAging } from '../../RPT/receivables.ts';
import { depositsHeld as depositsHeldReport } from '../../RPT/sales-collections.ts';
import { collectionDoc } from '../doctypes/collection.ts';
import { refundDoc } from '../doctypes/refund.ts';
import { depositTransferDoc } from '../doctypes/deposit-transfer.ts';
import { depositVatHeld, dpHeld } from '../doctypes/deposit-vat.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let owner: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

function setting(key: SettingKey, value: unknown, effectiveFrom = today(env.clock)) {
  tx(env.db, () => addSettingVersion(env.db, { key, effectiveFrom, value, reason: 'Accountant decision for the test', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
}
const mode = (m: 'A' | 'B' | 'C') => setting('sales.deposit_vat_mode', m);
async function nextDay(days = 1) {
  env.clock.advance(days * 24 * 3600_000);
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
}

/** A recorded JO of 20 sets × ₱2,800.00 = ₱56,000.00 (G-01), moved to Ready for release. */
async function g01(customerId = c.school): Promise<string> {
  const input = { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 5_600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to });
  return r.json().id;
}
let cr = 100;
/** A cash collection applied to the JO; returns the recorded document (id, warnings, ...). */
async function collect(jo: string, cents: number, who = encoder) {
  const input = { customerId: c.school, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }] };
  const r = await who.post('/api/docs/col.collection/post', { input, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
let invoiceNo = 600;
/** All 20 pieces released on credit with their invoice record. */
async function releaseAll(jo: string) {
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo) }, expectedTotalCents: 5_600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().invoiceRecord;
}
async function dpInvoice(jo: string, cents: number, who = encoder) {
  const r = await who.post('/api/docs/jo.dp_invoice/post', { input: { jobOrderId: jo, invoiceNumber: String(++invoiceNo), amountCents: cents }, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
const cancel = async (type: string, id: string, who = accountant) => {
  const r = await who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake, undoing it' }, idem());
  return r;
};

/** Journal lines as [account code, party id, JO ref, debit, credit]: the document's own, its reversal, or its cancel follow-up. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' | 'follow-up' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind === 'follow-up' ? 'document-cancel' : 'document', kind === 'reversal' ? 'reversal' : 'original') as unknown[][];
/** GL balance, debit positive, of the account with this role. */
const gl = (db: Db, role: string) => accountBalance(db, resolveAccount(db, { role }).id);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('mode B golden (PLAN I2 G-04)', () => {
  it('G-04: the downpayment adds Dr 2209 / Cr 2301 3,000.00; the invoice adds Dr 2301 / Cr 2209 3,000.00; end 2301 = 6,000.00, 2209 = 0', async () => {
    mode('B');
    const jo = await g01();
    const dp = await collect(jo, 2_800_000);
    expect(dp.warnings).toEqual([]);
    expect(linesOf(dp.id)).toEqual([
      ['1101', null, null, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_800_000],
      ['2209', c.school, jo, 300_000, 0],
      ['2301', c.school, null, 0, 300_000],
    ]);
    expect(depositVatHeld(env.db, jo)).toBe(300_000);
    expect(joMoney(env.db, jo)).toMatchObject({ depositsHeldCents: 2_800_000, balanceDueCents: 2_800_000 });

    const ir = await releaseAll(jo);
    expect(ir.summary).toBe(
      `This will record invoice no. ${invoiceNo} to Moonlight Test School for REL-000001 of JO-000001: ₱56,000.00 (VATable sales ₱50,000.00, VAT ₱6,000.00). ₱3,000.00 of it was already booked as output VAT on the deposits (mode B). ₱28,000.00 of deposits is applied; ₱28,000.00 is left to collect.`,
    );
    expect(linesOf(ir.id)).toEqual([
      ['1201', c.school, jo, 5_600_000, 0],
      ['4101', c.school, null, 0, 5_000_000],
      ['2301', c.school, null, 0, 600_000],
      ['2201', c.school, jo, 2_800_000, 0],
      ['1201', c.school, jo, 0, 2_800_000],
      ['2301', c.school, null, 300_000, 0],
      ['2209', c.school, jo, 0, 300_000],
    ]);
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'DEPOSIT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS'), gl(env.db, 'AR_TRADE')]).toEqual([-600_000, 0, 0, 2_800_000]);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 2_800_000, balanceDueCents: 2_800_000 });
    expect(invoiceRecordDoc.load(env.db, ir.id)).toMatchObject({ depositVatMode: 'B', depositAppliedCents: 2_800_000, depositVatCents: 300_000, depositVatBaseCents: 2_500_000 });
    noBrokenInvariants();
  });

  it('G-04 cancels: the invoice first (its mirror puts the VAT back on the deposits), then the downpayment (nothing left)', async () => {
    mode('B');
    const jo = await g01();
    const dp = await collect(jo, 2_800_000);
    const ir = await releaseAll(jo);
    expect((await cancel('jo.invoice_record', ir.id)).statusCode).toBe(200);
    expect(linesOf(ir.id, 'follow-up')).toEqual([]);
    expect([gl(env.db, 'OUTPUT_VAT'), depositVatHeld(env.db, jo), joMoney(env.db, jo).depositsHeldCents]).toEqual([-300_000, 300_000, 2_800_000]);
    expect((await cancel('col.collection', dp.id)).statusCode).toBe(200);
    expect(linesOf(dp.id, 'reversal')).toEqual([
      ['1101', null, null, 0, 2_800_000],
      ['2201', c.school, jo, 2_800_000, 0],
      ['2209', c.school, jo, 0, 300_000],
      ['2301', c.school, null, 300_000, 0],
    ]);
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'DEPOSIT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS'), gl(env.db, 'AR_TRADE')]).toEqual([0, 0, 0, 0]);
    noBrokenInvariants();
  });

  it('G-04 cancel of the downpayment after the invoice applied it: the receivable reopens and 2209 goes back to zero (D6)', async () => {
    mode('B');
    const jo = await g01();
    const dp = await collect(jo, 2_800_000);
    await releaseAll(jo);
    expect((await cancel('col.collection', dp.id)).statusCode).toBe(200);
    expect(linesOf(dp.id, 'follow-up')).toEqual([
      ['1201', c.school, jo, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_800_000],
      ['2209', c.school, jo, 300_000, 0],
      ['2301', c.school, null, 0, 300_000],
    ]);
    // What stays is the invoice: AR 56,000.00 and its VAT 6,000.00; nothing on deposits.
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'DEPOSIT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS'), gl(env.db, 'AR_TRADE')]).toEqual([-600_000, 0, 0, 5_600_000]);
    expect(joMoney(env.db, jo).balanceDueCents).toBe(5_600_000);
    const q3 = salesRegister(env.db, '2026-07-01', '2026-09-30');
    expect([q3.totals.netCents, q3.totals.vatCents, q3.glVatCents]).toEqual([5_000_000, 600_000, 600_000]);
    noBrokenInvariants();
  });

  it('a refund takes back its share of 2209; the invoice then takes the rest (DEP-REFUND in mode B)', async () => {
    mode('B');
    const jo = await g01();
    await collect(jo, 2_800_000);
    const input = { customerId: c.school, jobOrderId: jo, tenders: [{ cashPlaceId: CASH, amountCents: 1_000_000 }], reason: 'Customer took back part of the downpayment' };
    const pre = (await accountant.post('/api/docs/col.refund/preview', { input })).json();
    expect(pre.summary).toBe('This will pay back ₱10,000.00 to Moonlight Test School from Cash on hand (main cash box): deposit for JO-000001. The ₱1,071.43 output VAT booked on it (mode B) is taken back.');
    const r = await accountant.post('/api/docs/col.refund/post', { input, expectedTotalCents: 1_000_000 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    // 3,000.00 × 10,000 / 28,000 = 1,071.43
    expect(linesOf(r.json().id)).toEqual([
      ['2201', c.school, jo, 1_000_000, 0],
      ['1101', null, null, 0, 1_000_000],
      ['2301', c.school, null, 107_143, 0],
      ['2209', c.school, jo, 0, 107_143],
    ]);
    const ir = await releaseAll(jo);
    expect(linesOf(ir.id).slice(-2)).toEqual([['2301', c.school, null, 192_857, 0], ['2209', c.school, jo, 0, 192_857]]);
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'DEPOSIT_VAT')]).toEqual([-600_000, 0]);
    // The refund's cancel mirrors it.
    expect((await cancel('jo.invoice_record', ir.id)).statusCode).toBe(200);
    expect((await cancel('col.refund', r.json().id)).statusCode).toBe(200);
    expect([gl(env.db, 'OUTPUT_VAT'), depositVatHeld(env.db, jo)]).toEqual([-300_000, 300_000]);
    noBrokenInvariants();
  });

  it('a transfer moves 2209 with the deposit to a mode-B JO, and gives back to output VAT what pays a receivable or goes to a mode-A JO', async () => {
    const early = await g01(); // takes its downpayment in mode A
    await collect(early, 1_000_000);
    mode('B');
    const [jo1, jo2, done] = [await g01(), await g01(), await g01()];
    await collect(jo1, 2_800_000);
    await collect(done, 100_000);
    await releaseAll(done); // AR 55,000.00 open on it

    const move = async (to: string, cents: number) => {
      const input = { customerId: c.school, fromJobOrderId: jo1, toJobOrderId: to, amountCents: cents };
      const r = await encoder.post('/api/docs/col.deposit_transfer/post', { input, expectedTotalCents: cents }, idem());
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    const toB = await move(jo2, 1_000_000); // jo2 has no downpayment yet: it takes jo1's mode, B
    expect(toB.warnings).toEqual([expect.objectContaining({ code: 'JO_OPEN' })]);
    expect(linesOf(toB.id)).toEqual([
      ['2201', c.school, jo1, 1_000_000, 0],
      ['2201', c.school, jo2, 0, 1_000_000],
      ['2209', c.school, jo2, 107_143, 0],
      ['2209', c.school, jo1, 0, 107_143],
    ]);
    const toAr = await move(done, 900_000); // pays a receivable: its share of 2209 goes back to output VAT
    // held 18,000.00 with 1,928.57 on it: 1,928.57 × 9,000 / 18,000 = 964.285 → 964.29; the last 9,000.00 takes the 964.28 left
    expect(linesOf(toAr.id)).toEqual([
      ['2201', c.school, jo1, 900_000, 0],
      ['1201', c.school, done, 0, 900_000],
      ['2301', c.school, null, 96_429, 0],
      ['2209', c.school, jo1, 0, 96_429],
    ]);
    const toA = await move(early, 900_000); // early is mode A: the VAT goes back, no 2209 on it
    expect(toA.warnings.map((w: { code: string }) => w.code)).toEqual(['JO_OPEN', 'DEPOSIT_VAT_MODE_KEPT']);
    expect(linesOf(toA.id)).toEqual([
      ['2201', c.school, jo1, 900_000, 0],
      ['2201', c.school, early, 0, 900_000],
      ['2301', c.school, null, 96_428, 0],
      ['2209', c.school, jo1, 0, 96_428],
    ]);
    expect([depositVatHeld(env.db, jo1), depositVatHeld(env.db, jo2), depositVatHeld(env.db, early), joMoney(env.db, jo1).depositsHeldCents]).toEqual([0, 107_143, 0, 0]);
    // 2301: 3,000.00 + 107.14 on jo1's and done's deposits, done's invoice 6,000.00 − 107.14, less 964.29 and 964.28 given back.
    expect(gl(env.db, 'OUTPUT_VAT')).toBe(-(300_000 + 10_714 + 600_000 - 10_714 - 96_429 - 96_428));
    // Cancelling a transfer to a mode-B JO puts the VAT back on jo1.
    expect((await cancel('col.deposit_transfer', toA.id)).statusCode).toBe(200);
    expect((await cancel('col.deposit_transfer', toB.id)).statusCode).toBe(200);
    expect([depositVatHeld(env.db, jo1), depositVatHeld(env.db, jo2)]).toEqual([107_143 + 96_428, 0]);
    noBrokenInvariants();
  });

  it('a forfeit takes the VAT on the deposit back when not VATable (ACC-15 default), and books its own instead when VATable', async () => {
    mode('B');
    const [jo1, jo2] = [await g01(), await g01()];
    await collect(jo1, 2_800_000);
    await collect(jo2, 2_800_000);
    const forfeit = async (jo: string) => {
      const input = { jobOrderId: jo, amountCents: 2_800_000, reason: 'Customer stopped answering; terms keep the deposit' };
      const r = await owner.post('/api/docs/col.forfeit/post', { input, expectedTotalCents: 2_800_000 }, idem());
      expect(r.statusCode, r.body).toBe(200);
      return r.json().id as string;
    };
    const plain = await forfeit(jo1);
    expect(linesOf(plain)).toEqual([
      ['2201', c.school, jo1, 2_800_000, 0],
      ['7103', null, null, 0, 2_800_000],
      ['2301', c.school, null, 300_000, 0],
      ['2209', c.school, jo1, 0, 300_000],
    ]);
    setting('col.forfeit_vatable', true);
    const vatable = await forfeit(jo2);
    expect(linesOf(vatable)).toEqual([
      ['2201', c.school, jo2, 2_800_000, 0],
      ['7103', null, null, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
      ['2301', c.school, null, 300_000, 0],
      ['2209', c.school, jo2, 0, 300_000],
    ]);
    // Output VAT: jo2's deposit VAT stays (it became the forfeit's), jo1's is taken back.
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'DEPOSIT_VAT')]).toEqual([-300_000, 0]);
    // In the sales register the not-VATable forfeit takes its deposit's VATable amount back; the VATable one stays as booked.
    const q3 = salesRegister(env.db, '2026-07-01', '2026-09-30');
    expect([q3.totals.netCents, q3.totals.vatCents, q3.glVatCents]).toEqual([2_500_000, 300_000, 300_000]);
    expect((await cancel('col.forfeit', plain, owner)).statusCode).toBe(200);
    expect(depositVatHeld(env.db, jo1)).toBe(300_000);
    noBrokenInvariants();
  });
});

describe('mode C golden (PLAN I2 G-05)', () => {
  it('G-05: DP invoice Dr 1201 28,000 / Cr 2201 25,000, Cr 2301 3,000; collection clears AR; release invoice 28,000 plus 2201 25,000 into sales', async () => {
    mode('C');
    const jo = await g01();
    const preview = (await accountant.post('/api/docs/jo.dp_invoice/preview', { input: { jobOrderId: jo, invoiceNumber: '0701', amountCents: 2_800_000 } })).json();
    expect(preview.issues).toEqual([]);
    expect(preview.summary).toBe('This will record downpayment invoice no. 0701 to Moonlight Test School for JO-000001: ₱28,000.00 (VATable sales ₱25,000.00, VAT ₱3,000.00). The release invoice takes it into sales.');
    const dp = await dpInvoice(jo, 2_800_000);
    expect(dp).toMatchObject({ number: 'IR-000001', totalCents: 2_800_000 });
    expect(linesOf(dp.id)).toEqual([
      ['1201', c.school, jo, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 2_800_000, receivableCents: 2_800_000, depositsHeldCents: 0, balanceDueCents: 5_600_000 });

    const col = await collect(jo, 2_800_000);
    expect(col.warnings).toEqual([]);
    expect(linesOf(col.id)).toEqual([['1101', null, null, 2_800_000, 0], ['1201', c.school, jo, 0, 2_800_000]]);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 2_800_000 });

    // "Write these on the booklet": the balance invoice shows the sale less the downpayment invoiced.
    const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
    const pre = (await accountant.post('/api/jo/releases/preview', { release })).json();
    expect(pre.booklet).toMatchObject({ grossCents: 2_800_000, vatableSalesCents: 2_500_000, vatCents: 300_000, downpaymentsInvoicedCents: 2_800_000 });
    expect(pre.depositAppliedCents).toBe(0);
    const ir = await releaseAll(jo);
    expect(ir.summary).toBe(`This will record invoice no. ${invoiceNo} to Moonlight Test School for REL-000001 of JO-000001: a sale of ₱56,000.00 (VATable sales ₱50,000.00, VAT ₱6,000.00), less ₱28,000.00 of downpayments already invoiced (mode C), so the invoice shows ₱28,000.00 (VATable sales ₱25,000.00, VAT ₱3,000.00). ₱28,000.00 is left to collect.`);
    expect(linesOf(ir.id)).toEqual([
      ['1201', c.school, jo, 2_800_000, 0],
      ['4101', c.school, null, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
      ['2201', c.school, jo, 2_500_000, 0],
      ['4101', c.school, null, 0, 2_500_000],
    ]);
    const sales = accountBalance(env.db, resolveAccount(env.db, { role: 'SALES_MTO' }).id);
    expect([sales, gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS'), gl(env.db, 'AR_TRADE')]).toEqual([-5_000_000, -600_000, 0, 2_800_000]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 5_600_000, receivableCents: 2_800_000, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    expect(invoiceRecordDoc.load(env.db, ir.id)).toMatchObject({ depositVatMode: 'C', grossCents: 5_600_000, dpAppliedCents: 2_800_000, dpVatAppliedCents: 300_000, booklet: { grossCents: 2_800_000 } });
    // The AR aging and the deposits held report stay tied to 1201 and 2201.
    expect(arAging(env.db, '2026-09-28').totalCents).toBe(2_800_000);
    expect(depositsHeldReport(env.db, '2026-09-28').totalCents).toBe(0);
    noBrokenInvariants();
  });

  it('G-05 cancels: the DP invoice waits for the release invoice; then its payment becomes money held, and a new DP invoice applies it', async () => {
    mode('C');
    const jo = await g01();
    const dp = await dpInvoice(jo, 2_800_000);
    await collect(jo, 2_800_000);
    const ir = await releaseAll(jo);
    const blocked = await cancel('jo.dp_invoice', dp.id);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: IR-000002.' });
    expect((await cancel('jo.invoice_record', ir.id)).statusCode).toBe(200);
    expect(linesOf(ir.id, 'follow-up')).toEqual([]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 2_800_000, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    expect((await cancel('jo.dp_invoice', dp.id)).statusCode).toBe(200);
    expect(linesOf(dp.id, 'follow-up')).toEqual([['1201', c.school, jo, 2_800_000, 0], ['2201', c.school, jo, 0, 2_800_000]]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 0, receivableCents: 0, depositsHeldCents: 2_800_000, balanceDueCents: 2_800_000 });
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS')]).toEqual([0, -2_800_000]);

    const again = await dpInvoice(jo, 2_800_000);
    expect(linesOf(again.id)).toEqual([
      ['1201', c.school, jo, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
      ['2201', c.school, jo, 2_800_000, 0],
      ['1201', c.school, jo, 0, 2_800_000],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 2_800_000, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    expect(gl(env.db, 'CUSTOMER_DEPOSITS')).toBe(-2_500_000);
    // A job order with a downpayment invoice is not cancelled or edited before it (D6: invoice records first).
    expect((await cancel('jo.job_order', jo)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: IR-000003, REL-000001.' });
    noBrokenInvariants();
  });

  it('money taken before its DP invoice waits for it (warning); a forfeit keeps an invoiced downpayment as other income, its VAT booked', async () => {
    mode('C');
    const jo = await g01();
    const early = await collect(jo, 1_000_000);
    expect(early.warnings).toEqual([expect.objectContaining({
      code: 'DP_INVOICE_NEEDED',
      message: "₱10,000.00 of this is a downpayment on JO-000001 not yet invoiced. In mode C (invoice on downpayment) write it on a sales invoice and record it as JO-000001's downpayment invoice.",
    })]);
    const dp = await dpInvoice(jo, 2_800_000); // applies the ₱10,000.00 held; ₱18,000.00 left to collect
    expect(linesOf(dp.id)).toEqual([
      ['1201', c.school, jo, 2_800_000, 0],
      ['2201', c.school, jo, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
      ['2201', c.school, jo, 1_000_000, 0],
      ['1201', c.school, jo, 0, 1_000_000],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 1_800_000, depositsHeldCents: 0, balanceDueCents: 4_600_000 });
    const input = { jobOrderId: jo, amountCents: 2_800_000, reason: 'Customer stopped answering; terms keep the deposit' };
    // Only the ₱10,000.00 paid of the downpayment invoice can be forfeited while ₱18,000.00 of it is unpaid.
    const unpaid = await owner.post('/api/docs/col.forfeit/post', { input, expectedTotalCents: 2_800_000 }, idem());
    expect(unpaid.statusCode).not.toBe(200);
    expect(unpaid.body).toContain('Only ₱10,000.00 is held for JO-000001.');
    await collect(jo, 1_800_000);
    const f = await owner.post('/api/docs/col.forfeit/post', { input, expectedTotalCents: 2_800_000 }, idem());
    expect(f.statusCode, f.body).toBe(200);
    expect(linesOf(f.json().id)).toEqual([['2201', c.school, jo, 2_500_000, 0], ['7103', null, null, 0, 2_500_000]]);
    expect([gl(env.db, 'OUTPUT_VAT'), gl(env.db, 'CUSTOMER_DEPOSITS'), dpHeld(env.db, jo).grossCents]).toEqual([-300_000, 0, 0]);
    // The forfeit took the downpayment out of 2201: the DP invoice waits for it to be cancelled first.
    const blocked = await cancel('jo.dp_invoice', dp.id, owner);
    expect(blocked.statusCode).not.toBe(200);
    expect(blocked.body).toContain('DFF-000001');
    expect((await cancel('col.forfeit', f.json().id, owner)).statusCode).toBe(200);
    expect(dpHeld(env.db, jo)).toEqual({ grossCents: 2_800_000, vatCents: 300_000, netCents: 2_500_000 });
    noBrokenInvariants();
  });

  it('refuses a DP invoice outside mode C, over what is not yet invoiced, or on a used invoice number', async () => {
    const jo = await g01();
    const codes = async (input: object) => ((await encoder.post('/api/docs/jo.dp_invoice/preview', { input })).json().issues as { code: string }[]).map((i) => i.code);
    expect(await codes({ jobOrderId: jo, invoiceNumber: '0801', amountCents: 100 })).toEqual(['DEPOSIT_VAT_MODE']);
    mode('C');
    expect(await codes({ jobOrderId: jo, invoiceNumber: '0801', amountCents: 5_600_001 })).toEqual(['OVER_ORDER']);
    await dpInvoice(jo, 100);
    expect(await codes({ jobOrderId: jo, invoiceNumber: String(invoiceNo), amountCents: 100 })).toEqual(['INVOICE_USED']);
    // A release invoice cannot reuse a downpayment invoice's number either (one booklet).
    const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
    const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(invoiceNo) }, expectedTotalCents: 5_600_000 }, idem());
    expect(r.json().details).toEqual([expect.objectContaining({ code: 'INVOICE_USED' })]);
    // Client-sent VAT or totals are refused (N-03).
    for (const extra of [{ vatCents: 1 }, { totalCents: 100 }, { date: '2026-01-01' }]) {
      expect((await encoder.post('/api/docs/jo.dp_invoice/post', { input: { jobOrderId: jo, invoiceNumber: '0802', amountCents: 100, ...extra }, expectedTotalCents: 100 }, idem())).statusCode).toBe(400);
    }
  });
});

describe('a job order that spans a mode change keeps its first downpayment’s mode', () => {
  it('B then C: the later downpayment still posts 2209, with a warning; no DP invoice on it; a new JO follows mode C', async () => {
    mode('B');
    const jo = await g01();
    const first = await collect(jo, 1_000_000);
    setting('sales.deposit_vat_mode', 'C', '2026-09-29');
    await nextDay();
    const second = await collect(jo, 1_800_000);
    expect(second.warnings).toEqual([expect.objectContaining({
      code: 'DEPOSIT_VAT_MODE_KEPT',
      message: `JO-000001 took its first downpayment on ${first.number} in mode B (VAT on deposit), so it stays in mode B although mode C (invoice on downpayment) is in force now. A job order never mixes the two.`,
    })]);
    expect(linesOf(second.id).slice(-2)).toEqual([['2209', c.school, jo, 192_857, 0], ['2301', c.school, null, 0, 192_857]]);
    const refused = await encoder.post('/api/docs/jo.dp_invoice/preview', { input: { jobOrderId: jo, invoiceNumber: '0901', amountCents: 100 } });
    expect(refused.json().issues).toEqual([expect.objectContaining({
      code: 'DEPOSIT_VAT_MODE',
      message: `JO-000001 took its first downpayment on ${first.number} in mode B (VAT on deposit), and a job order never mixes modes: its downpayments are not invoiced. Record the collection only.`,
    })]);
    const ir = await releaseAll(jo);
    expect(ir.warnings.map((w: { code: string }) => w.code)).toEqual(['DEPOSIT_VAT_MODE_KEPT']);
    expect([depositVatHeld(env.db, jo), gl(env.db, 'OUTPUT_VAT')]).toEqual([0, -600_000]);
    // A new job order follows the mode in force: C.
    const fresh = await g01();
    expect((await encoder.post('/api/docs/jo.dp_invoice/preview', { input: { jobOrderId: fresh, invoiceNumber: '0901', amountCents: 100 } })).json().issues).toEqual([]);
    noBrokenInvariants();
  });
});

describe('VAT registers, VAT close and 2550Q across a quarter (D3: "₱510,360 of downpayments crossed a VAT quarter")', () => {
  for (const m of ['B', 'C'] as const) {
    it(`mode ${m}: the downpayment's VAT and VATable amount are in Q3, the rest in Q4; each register ties to 2301`, async () => {
      mode(m);
      const jo = await g01(); // 28 September: Q3
      if (m === 'C') await dpInvoice(jo, 2_800_000);
      await collect(jo, 2_800_000);
      const q3 = salesRegister(env.db, '2026-07-01', '2026-09-30');
      expect([q3.totals.netCents, q3.totals.vatCents, q3.glVatCents]).toEqual([2_500_000, 300_000, 300_000]);
      const sheet = vatReturnWorksheet(env.db, 2026, 3, '2026-09-28');
      expect(sheet.lines.find((l) => l.key === 'vatable_sales')).toMatchObject({ amountCents: 2_500_000, taxCents: 300_000 });
      expect(sheet.checks.map((x) => x.code)).not.toContain('SALES_NOT_TIED');
      expect(vatPosition(env.db, 2026, 3).outputVatCents).toBe(300_000);
      await nextDay(4); // 2 October: Q4
      await releaseAll(jo);
      const q4 = salesRegister(env.db, '2026-10-01', '2026-12-31');
      expect([q4.totals.netCents, q4.totals.vatCents, q4.glVatCents]).toEqual([2_500_000, 300_000, 300_000]);
      // The Q3 close takes Q3's 3,000.00 only; the release in Q4 does not leak back.
      expect(vatPosition(env.db, 2026, 3).outputVatCents).toBe(300_000);
      expect(vatPosition(env.db, 2026, 4).outputVatCents).toBe(600_000); // Q3 not closed yet: its 3,000.00 is still in 2301
      const close = await accountant.post('/api/docs/tax.vat_close/post', { input: { year: 2026, quarter: 3 }, expectedTotalCents: (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 3 } })).json().totalCents }, idem());
      expect(close.statusCode, close.body).toBe(200);
      expect(vatPosition(env.db, 2026, 4).outputVatCents).toBe(300_000);
      expect(gl(env.db, 'DEPOSIT_VAT')).toBe(0);
      noBrokenInvariants();
    });
  }
});

/**
 * Random downpayments, DP invoices (mode C), refunds, transfers, releases and cancels in one mode, then every job order
 * released and invoiced, and what is still held on one paid back. After each step: 2209 is never below zero and is zero on a job order holding no deposit;
 * the deposits held report ties to 2201, the AR aging to 1201, the sales register to 2301. At the end: 2209 and the
 * downpayments invoiced ahead are zero, and output VAT is exactly the VAT of the invoices, whatever the mode.
 */
describe('property tests (PLAN I1.3)', () => {
  for (const m of ['A', 'B', 'C'] as const) {
    it(`mode ${m}: 2209 ends at zero once every job order is invoiced; 2201, 1201 and 2301 tie to their registers`, async () => {
      let number = 10_000;
      await fc.assert(
        fc.asyncProperty(fc.gen(), async (g) => {
          const t = await createTestEnv();
          const db = t.db;
          const userId = createUser(db, `prop-${number}`, ['accountant']);
          const cs = seedCustomers(db, userId);
          const actor = {
            userId,
            permissions: new Set(['jo.post', 'jo.release', 'jo.release_with_balance', 'jo.invoice', 'jo.invoice_cancel', 'col.post', 'col.cancel', 'col.refund', 'col.transfer']),
          };
          const e = { db, clock: t.clock };
          const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
          if (m !== 'A') tx(db, () => addSettingVersion(db, { key: 'sales.deposit_vat_mode', effectiveFrom: today(t.clock), value: m, reason: 'Mode for the property test', userId, at: stamp(t.clock), today: today(t.clock) }));
          const posted = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
          const arbOrNull = <T,>(make: () => fc.Arbitrary<T>) => {
            try {
              return make();
            } catch {
              return null; // nothing to act on yet
            }
          };
          const record = (def: DocTypeDef, input: object) => postDocument(e, def, actor, { input, expectedTotalCents: def.compute(input, ctx()).totalCents });
          const cash = cashPlaceId(db, '1101');
          for (let i = 0; i < 3; i++) {
            const lines = g(() => fc.array(fc.integer({ min: 100_000, max: 3_000_000 }), { minLength: 1, maxLength: 3 }))
              .map((unitPriceCents) => ({ kind: 'made_to_order' as const, description: 'Team jersey set', qty: 1, unitPriceCents, discountCents: 0, roster: [] }));
            const input = { customerId: i < 2 ? cs.school : cs.other, dueInDays: 15, priority: 'normal' as const, paymentTerms: 'dp50' as const, lines };
            const { id: jo } = record(jobOrderDoc, input);
            for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']] as const) changeStage(db, jo, { from, to }, { userId, at: stamp(t.clock) });
          }
          const kinds = ['collect', 'collect', 'transfer', 'refund', 'release', 'release', 'cancel-collection', 'cancel-invoice', 'cancel-transfer', 'cancel-refund', ...(m === 'C' ? ['dp-invoice', 'dp-invoice', 'cancel-dp-invoice'] : [])];
          const steps = g(() => fc.array(fc.constantFrom(...kinds), { minLength: 1, maxLength: 12 }));

          const check = (step: string) => {
            for (const jo of jobOrdersOf(db, undefined, true)) {
              const vat = depositVatHeld(db, jo.id);
              const money = joMoney(db, jo.id);
              expect(vat, `${step}: 2209 of ${jo.number}`).toBeGreaterThanOrEqual(0);
              if (money.depositsHeldCents <= 0) expect(vat, `${step}: 2209 of ${jo.number} with no deposit`).toBe(0);
              expect(Math.min(money.receivableCents, money.depositsHeldCents, dpHeld(db, jo.id).grossCents), step).toBeGreaterThanOrEqual(0);
            }
            const asOf = today(t.clock);
            expect(depositsHeldReport(db, asOf).totalCents, step).toBe(0 - gl(db, 'CUSTOMER_DEPOSITS'));
            expect(arAging(db, asOf).totalCents, step).toBe(gl(db, 'AR_TRADE'));
            const reg = salesRegister(db, '2026-01-01', '2026-12-31');
            expect(reg.totals.vatCents, step).toBe(reg.glVatCents);
          };

          for (const step of steps) {
            try {
              if (step === 'collect' || step === 'transfer' || step === 'refund' || step === 'dp-invoice') {
                const def: DocTypeDef = { collect: collectionDoc, transfer: depositTransferDoc, refund: refundDoc, 'dp-invoice': dpInvoiceDoc }[step];
                const arb = arbOrNull(() => def.arbitrary(db));
                if (!arb) continue;
                const raw = g(() => arb) as Record<string, unknown>;
                const input = step === 'collect' ? { ...raw, crNumber: String(++number) } : step === 'dp-invoice' ? { ...raw, invoiceNumber: String(++number) } : raw;
                const doc = def.compute(input, ctx());
                const p = record(def, input);
                expect(def.load(db, p.id), step).toEqual(doc);
              } else if (step === 'release') {
                const arb = arbOrNull(() => releaseDoc.arbitrary(db));
                if (!arb) continue;
                const r = record(releaseDoc, g(() => arb));
                const input = { releaseId: r.id, invoiceNumber: String(++number) };
                const doc = invoiceRecordDoc.compute(input, ctx());
                if (doc.grossCents > 0) {
                  const p = record(invoiceRecordDoc, input);
                  expect(invoiceRecordDoc.load(db, p.id)).toEqual(doc);
                }
              } else {
                const [type, def] = ({
                  'cancel-collection': ['col.collection', collectionDoc], 'cancel-invoice': ['jo.invoice_record', invoiceRecordDoc], 'cancel-transfer': ['col.deposit_transfer', depositTransferDoc],
                  'cancel-refund': ['col.refund', refundDoc], 'cancel-dp-invoice': ['jo.dp_invoice', dpInvoiceDoc],
                } as const)[step as 'cancel-collection'];
                const ids = posted(type);
                if (ids.length === 0) continue;
                cancelDocument(e, def, actor, g(() => fc.constantFrom(...ids)), 'Recorded by mistake');
              }
            } catch (err) {
              // Refusals are fine (a transfer out standing, a JO no longer ready): they record nothing.
              if (!(err instanceof AppError) || !['HAS_DEPENDENTS', 'VALIDATION'].includes(err.code)) throw err;
            }
            check(step);
          }

          // Every job order released and invoiced: what waits for its invoice first, then everything left.
          for (const r of awaitingInvoice(db)) record(invoiceRecordDoc, { releaseId: r.id, invoiceNumber: String(++number) });
          for (const jo of jobOrdersOf(db)) {
            if (isAbandoned(db, jo.id)) continue;
            const left = lineState(db, jo.id).filter((l) => l.releasedQty < l.qty).map((l) => ({ lineNo: l.lineNo, qty: l.qty - l.releasedQty }));
            if (left.length === 0) continue;
            const due = joMoney(db, jo.id).balanceDueCents > 0;
            const r = record(releaseDoc, { jobOrderId: jo.id, lines: left, claimedBy: 'Coach Placeholder', idSeen: 'none', ...(due ? { creditNote: 'Balance to follow', creditDueInDays: 7 } : {}) });
            record(invoiceRecordDoc, { releaseId: r.id, invoiceNumber: String(++number) });
          }
          // Money still held on an invoiced job order is an overpayment (a refund cancelled after the invoice, say): paid back.
          for (const jo of jobOrdersOf(db, undefined, true)) {
            const held = joMoney(db, jo.id).depositsHeldCents;
            if (held > 0 && jo.status === 'posted') record(refundDoc, { customerId: jo.customerId, jobOrderId: jo.id, tenders: [{ cashPlaceId: cash, amountCents: held }], reason: 'Overpayment paid back at the end' });
          }
          check('all invoiced');
          expect(gl(db, 'DEPOSIT_VAT')).toBe(0);
          for (const jo of jobOrdersOf(db, undefined, true)) expect(dpHeld(db, jo.id).grossCents).toBe(0);
          // The same output VAT and VATable sales in every mode: those of the invoices, each sale's VAT counted once.
          const invoices = db
            .prepare(`SELECT COALESCE(SUM(i.vat_cents), 0) AS vat, COALESCE(SUM(i.gross_cents - i.vat_cents), 0) AS net FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE d.status = 'posted'`)
            .get() as { vat: number; net: number };
          expect(0 - gl(db, 'OUTPUT_VAT')).toBe(invoices.vat);
          expect(salesRegister(db, '2026-01-01', '2026-12-31').totals.netCents).toBe(invoices.net);
          expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
          await t.app.close();
        }),
        { numRuns: 20 },
      );
    }, 120_000);
  }
});

describe('VAT maths of G-04 and G-05 (D4.1)', () => {
  it('₱28,000.00 → VAT 3,000.00, net 25,000.00; ₱56,000.00 → 6,000.00', () => {
    expect(vatFromGross(2_800_000, 1200)).toEqual({ netCents: 2_500_000, vatCents: 300_000 });
    expect(vatFromGross(5_600_000, 1200)).toEqual({ netCents: 5_000_000, vatCents: 600_000 });
  });
});
