/**
 * Customer credits without cash (PLAN D5 CWT-ONLY, DEP-FORFEIT, CM-ALLOW, BAD-DEBT): goldens with their cancels, the
 * credit memo's VAT in its own quarter (sales register, VAT summary, 2550Q worksheet, VAT close), the refusals, the AR
 * aging and customer statement, and a property test: what an invoice owes never goes below zero, and 1201 per customer
 * equals the aging's total.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { addSettingVersion } from '../../../engine/settings.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { releaseDoc } from '../../JO/doctypes/release.ts';
import { invoiceRecordDoc } from '../../JO/doctypes/invoice-record.ts';
import { changeStage } from '../../JO/stages.ts';
import { invoicedCents, jobOrdersOf, joMoney } from '../../JO/public.ts';
import { arAging } from '../../RPT/receivables.ts';
import { collectionDoc } from '../doctypes/collection.ts';
import { cwtOnlyDoc } from '../doctypes/cwt-only.ts';
import { forfeitDoc } from '../doctypes/forfeit.ts';
import { creditMemoDoc } from '../doctypes/credit-memo.ts';
import { writeOffDoc } from '../doctypes/write-off.ts';
import { invoicesOf, owedCents } from '../credits.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let owner: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
  [cr, invoiceNo] = [100, 500];
});

const post = (type: string, input: object, total: number, who: Client) => who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total }, idem());
const posted = async (type: string, input: object, total: number, who: Client): Promise<string> => {
  const r = await post(type, input, total, who);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
};
const preview = async (type: string, input: object, who = accountant) => (await who.post(`/api/docs/${type}/preview`, { input })).json() as { summary: string; totalCents: number; issues: { code: string; level: string; message: string }[] };
const errors = async (type: string, input: object, who = accountant) => (await preview(type, input, who)).issues.filter((i) => i.level === 'error').map((i) => i.code);
const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake, undoing it' }, idem());
const money = async (jo: string) => (await encoder.get(`/api/jo/orders/${jo}/status`)).json();
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const owed = (invoiceId: string) => owedCents(env.db, invoicesOf(env.db).find((i) => i.id === invoiceId)!);
const nextDay = async (days = 1) => {
  env.clock.advance(days * 24 * 3600_000);
  [encoder, accountant, owner] = [await env.as('encoder'), await env.as('accountant'), await env.as('owner')];
};

const jobInput = (lines: number[], customerId = c.school) => ({
  customerId,
  dueInDays: 15,
  priority: 'normal',
  paymentTerms: 'dp50',
  lines: lines.map((cents) => ({ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] })),
});
/** A recorded JO of one-piece lines, moved to Ready for release. */
async function jobOrder(lines: number[], customerId = c.school): Promise<string> {
  const id = await posted('jo.job_order', jobInput(lines, customerId), lines.reduce((s, x) => s + x, 0), encoder);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${id}/stage`, { from, to });
  return id;
}
let cr = 100;
async function collect(jo: string, cents: number, customerId = c.school): Promise<string> {
  return posted('col.collection', { customerId, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }] }, cents, encoder);
}
let invoiceNo = 500;
/** Releases one line in full with its invoice record (a credit release, so the accountant records it). */
async function invoice(jo: string, lineNo: number, grossCents: number): Promise<string> {
  const due = (await money(jo)).money.balanceDueCents > 0;
  const release = { jobOrderId: jo, lines: [{ lineNo, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...(due ? { creditNote: 'Balance by bank transfer', creditDueInDays: 7 } : {}) };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo).padStart(4, '0') }, expectedTotalCents: grossCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().invoiceRecord.id;
}

/** Journal lines as [account code, party id, ref, debit, credit]: the document's own, or its reversal. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = 'document' AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const mirrored = (id: string) => linesOf(id).map(([code, party, ref, dr, cr]) => [code, party, ref, cr, dr]);
const balanceOf = (code: string, party?: string) =>
  env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND (? IS NULL OR l.party_id = ?)`)
    .pluck()
    .get(code, party ?? null, party ?? null) as number;

describe('2307 received with no cash (D5 CWT-ONLY)', () => {
  it('golden: an invoice paid net of 1% CWT, then its 2307: Dr 1410 / Cr 1201 with the invoice as ref; register row; cancel mirrors', async () => {
    const jo = await jobOrder([5_600_000]);
    const inv = await invoice(jo, 1, 5_600_000);
    await collect(jo, 5_550_000); // paid net of 1% of 50,000.00
    expect(owed(inv)).toBe(50_000);

    const input = { invoiceId: inv, cwtCents: 50_000, atc: 'WC158', periodYear: 2026, periodQuarter: 3 };
    const pre = await preview('col.cwt_only', input, encoder);
    expect(pre.summary).toBe(
      "This will record Moonlight Test School's 2307 for ₱500.00 tax withheld (WC158, Q3 2026) on invoice no. 0501 (IR-000001, JO-000001). No cash comes in: the tax is taken off what the invoice owes and kept as a credit against income tax.",
    );
    expect(pre.issues).toEqual([]);
    const id = await posted('col.cwt_only', input, 50_000, encoder);
    expect(linesOf(id)).toEqual([
      ['1410', c.school, inv, 50_000, 0],
      ['1201', c.school, jo, 0, 50_000],
    ]);
    expect(owed(inv)).toBe(0);
    expect((await money(jo)).money.balanceDueCents).toBe(0);
    const reg = (await accountant.get('/api/tax/registers/withholding-received?from=2026-07-01&to=2026-09-30')).json();
    expect(reg.rows.find((r: { documentId: string }) => r.documentId === id)).toMatchObject({ atc: 'WC158', certificate: 'received', cwtCents: 50_000, period: '2026-Q3', documentNumber: 'CWT-000001' });
    expect(reg.totals.cwtCents).toBe(reg.glCwtCents);

    await nextDay();
    expect((await cancel('col.cwt_only', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual(mirrored(id));
    expect(owed(inv)).toBe(50_000);
    noBrokenInvariants();
  });

  it('refuses more than the invoice owes, and a quarter not yet started', async () => {
    const jo = await jobOrder([1_120_000]);
    const inv = await invoice(jo, 1, 1_120_000);
    await collect(jo, 1_110_000);
    expect(await errors('col.cwt_only', { invoiceId: inv, cwtCents: 10_001, atc: 'WC158', periodYear: 2026, periodQuarter: 3 })).toEqual(['OVER_OWED']);
    expect(await errors('col.cwt_only', { invoiceId: inv, cwtCents: 10_000, atc: 'WC158', periodYear: 2026, periodQuarter: 4 })).toEqual(['FUTURE_PERIOD']);
  });
});

describe('deposit forfeit (D5 DEP-FORFEIT, ACC-15)', () => {
  it('golden: an abandoned JO’s ₱28,000 deposit is kept as other income, no VAT, flagged; the JO is marked abandoned; cancel mirrors and reopens it', async () => {
    const jo = await jobOrder([5_600_000]);
    await collect(jo, 2_800_000);
    const input = { jobOrderId: jo, amountCents: 2_800_000, reason: 'Customer stopped answering; terms keep the deposit' };
    const pre = await preview('col.forfeit', input, owner);
    expect(pre.summary).toBe("This will keep ₱28,000.00 of Moonlight Test School's deposit for JO-000001 as other income, no VAT, and mark JO-000001 abandoned: nothing more is released or invoiced on it.");
    expect(pre.issues.map((i) => [i.code, i.level])).toEqual([['ACC_15', 'warning']]);
    expect((await post('col.forfeit', input, 2_800_000, encoder)).statusCode).toBe(403); // owner and accountant only

    const id = await posted('col.forfeit', input, 2_800_000, owner);
    expect(linesOf(id)).toEqual([
      ['2201', c.school, jo, 2_800_000, 0],
      ['7103', null, null, 0, 2_800_000],
    ]);
    const s = await money(jo);
    expect(s).toMatchObject({ stage: 'closed', stageLabel: 'Abandoned (deposit forfeited)', moves: [] });
    expect(s.history.at(-1)).toMatchObject({ fromStage: 'ready', toStage: 'closed', reason: 'Abandoned: deposit forfeited on DFF-000001', abandoned: true });
    expect(s.money.depositsHeldCents).toBe(0);

    // Nothing more is released or invoiced on it, not even by the owner's override; no new deposit is taken.
    const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', overrideReason: 'Customer came for it after all' };
    expect((await owner.post('/api/jo/releases/preview', { release })).json().release.issues.map((i: { code: string }) => i.code)).toEqual(['JO_ABANDONED']);
    const col = { customerId: c.school, crNumber: '9001', applications: [{ jobOrderId: jo, amountCents: 100_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 100_000 }] };
    expect(await errors('col.collection', col, encoder)).toEqual(['JO_ABANDONED']);
    expect(await errors('col.forfeit', input, owner)).toEqual(['FORFEITED', 'OVER_HELD']);

    await nextDay();
    expect((await cancel('col.forfeit', id, owner)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual(mirrored(id));
    const back = await money(jo);
    expect(back).toMatchObject({ stage: 'ready', stageLabel: 'Ready for release' });
    expect(back.history.at(-1)).toMatchObject({ fromStage: 'closed', toStage: 'ready', reason: 'DFF-000001 cancelled' });
    expect(back.money.depositsHeldCents).toBe(2_800_000);
    noBrokenInvariants();
  });

  it('VATable from a date set by the accountant: Cr 7103 NET and Cr 2301 12/112; a cancelled JO’s deposit can be forfeited too (D6)', async () => {
    const jo = await jobOrder([5_600_000]);
    await collect(jo, 2_800_000);
    tx(env.db, () => addSettingVersion(env.db, { key: 'col.forfeit_vatable', effectiveFrom: '2026-09-29', value: true, reason: 'Accountant ruled forfeits VATable', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
    expect((await accountant.post(`/api/docs/jo.job_order/${jo}/cancel`, { reason: 'Customer called off the order' }, idem())).statusCode).toBe(200);
    await nextDay();
    const input = { jobOrderId: jo, amountCents: 2_800_000, reason: 'Order called off; terms keep the deposit' };
    const pre = await preview('col.forfeit', input);
    expect(pre.summary).toBe("This will keep ₱28,000.00 of Moonlight Test School's deposit for JO-000001 (other income ₱25,000.00, output VAT ₱3,000.00), and mark JO-000001 abandoned: nothing more is released or invoiced on it.");
    const id = await posted('col.forfeit', input, 2_800_000, accountant);
    expect(linesOf(id)).toEqual([
      ['2201', c.school, jo, 2_800_000, 0],
      ['7103', null, null, 0, 2_500_000],
      ['2301', c.school, null, 0, 300_000],
    ]);
    expect((await money(jo)).stage).toBe('cancelled'); // no stage for a cancelled JO
    const reg = (await accountant.get('/api/tax/registers/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(reg.rows.find((r: { documentId: string }) => r.documentId === id)).toMatchObject({ netCents: 2_500_000, vatCents: 300_000 });
    await nextDay();
    expect((await cancel('col.forfeit', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual(mirrored(id));
    noBrokenInvariants();
  });

  it('refuses a released JO, more than is held, and a release still waiting for its invoice', async () => {
    const jo = await jobOrder([1_000_000, 500_000]);
    await collect(jo, 1_500_000);
    expect(await errors('col.forfeit', { jobOrderId: jo, amountCents: 1_500_001, reason: 'Customer never came back for it' })).toEqual(['OVER_HELD']);
    const waiting = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id' };
    expect((await accountant.post('/api/jo/releases', { release: waiting, invoice: null, expectedTotalCents: 1_000_000 }, idem())).statusCode).toBe(200);
    expect(await errors('col.forfeit', { jobOrderId: jo, amountCents: 500_000, reason: 'Customer never came back for it' })).toEqual(['INVOICE_TO_FOLLOW']);
    const jo2 = await jobOrder([100_000]);
    await collect(jo2, 100_000);
    await invoice(jo2, 1, 100_000);
    expect((await money(jo2)).stage).toBe('released');
    expect(await errors('col.forfeit', { jobOrderId: jo2, amountCents: 50_000, reason: 'Customer never came back for it' })).toEqual(['JO_RELEASED', 'OVER_HELD']);
  });
});

describe('credit memo (D5 CM-ALLOW, G-11)', () => {
  it('golden, unpaid invoice: allowance ₱5,600 → Dr 4191 5,000.00, Dr 2301 600.00 / Cr 1201 5,600.00; its VAT goes down in its own quarter', async () => {
    const jo = await jobOrder([5_600_000]);
    const inv = await invoice(jo, 1, 5_600_000); // Q3: VAT 6,000.00
    await nextDay(7); // 2026-10-05, Q4
    expect((await post('tax.vat_close', { year: 2026, quarter: 3 }, 6_000_00, accountant)).statusCode).toBe(200);

    const input = { invoiceId: inv, kind: 'allowance', amountCents: 560_000, formNumber: '0012', reason: 'Two sets delivered with the wrong print' };
    expect((await post('col.credit_memo', input, 560_000, encoder)).statusCode).toBe(403); // accountant only
    expect((await post('col.credit_memo', input, 560_000, owner)).statusCode).toBe(403);
    const pre = await preview('col.credit_memo', input);
    expect(pre.summary).toBe('This will record an allowance of ₱5,600.00 to Moonlight Test School on invoice no. 0501 (IR-000001, JO-000001), form no. 0012: sales ₱5,000.00 and output VAT ₱600.00 go down this quarter; ₱5,600.00 off what it still owes.');
    expect(pre.issues).toEqual([]);
    const id = await posted('col.credit_memo', input, 560_000, accountant);
    expect(linesOf(id)).toEqual([
      ['4191', c.school, null, 500_000, 0],
      ['2301', c.school, null, 60_000, 0],
      ['1201', c.school, jo, 0, 560_000],
    ]);
    expect(owed(inv)).toBe(5_040_000);
    expect((await money(jo)).money).toMatchObject({ receivableCents: 5_040_000, balanceDueCents: 5_040_000 });

    // The sales register, the VAT summary and the 2550Q worksheet show it in Q4, the credit memo's quarter.
    const q4 = (await accountant.get('/api/tax/registers/sales?from=2026-10-01&to=2026-12-31')).json();
    expect(q4.rows).toEqual([expect.objectContaining({ documentNumber: 'CM-000001', formNumber: '0012', netCents: -500_000, vatCents: -60_000, totalCents: -560_000 })]);
    expect(q4.glVatCents).toBe(-60_000);
    expect((await accountant.get('/api/tax/registers/sales?from=2026-07-01&to=2026-09-30')).json().totals.vatCents).toBe(600_000);
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=4')).json()).toMatchObject({ outputVatCents: -60_000, carryForwardCents: 60_000 });
    const ws = (await accountant.get('/api/tax/2550q?year=2026&quarter=4')).json();
    expect(ws.lines.find((l: { key: string }) => l.key === 'output_tax')).toMatchObject({ amountCents: -500_000, taxCents: -60_000 });
    expect(ws.checks.map((x: { code: string }) => x.code)).not.toContain('SALES_NOT_TIED');

    // The Q4 VAT close takes it in: 2301 back to zero for the customer, the excess carried over.
    env.clock.advance(90 * 24 * 3600_000); // 2027-01-03
    accountant = await env.as('accountant');
    const close = await posted('tax.vat_close', { year: 2026, quarter: 4 }, 60_000, accountant);
    expect(linesOf(close)).toEqual([
      ['2301', c.school, null, 0, 60_000],
      ['1402', null, null, 60_000, 0],
    ]);
    expect(balanceOf('2301')).toBe(0);
    noBrokenInvariants();
  });

  it('golden, paid invoice: return ₱5,600 → Cr 2201 customer credit on the JO, refundable; one more memo for the rest takes the rest of the VAT', async () => {
    const jo = await jobOrder([1_120_000]);
    const inv = await invoice(jo, 1, 1_120_000);
    await collect(jo, 1_120_000);
    const id = await posted('col.credit_memo', { invoiceId: inv, kind: 'return', amountCents: 560_000, reason: 'Half the shirts came back unused' }, 560_000, accountant);
    expect(linesOf(id)).toEqual([
      ['4191', c.school, null, 500_000, 0],
      ['2301', c.school, null, 60_000, 0],
      ['2201', c.school, jo, 0, 560_000],
    ]);
    expect((await money(jo)).money).toMatchObject({ receivableCents: 0, depositsHeldCents: 560_000, balanceDueCents: -560_000 });
    expect((await accountant.get(`/api/col/customers/${c.school}/refundable`)).json().jobOrders).toEqual([{ id: jo, number: 'JO-000001', status: 'posted', depositsHeldCents: 560_000 }]);

    // More than is left is refused; all that is left reverses exactly the rest of the invoice's VAT (1,200.00 − 600.00).
    const rest = { invoiceId: inv, kind: 'return', amountCents: 560_001, reason: 'The other half came back too' };
    expect(await errors('col.credit_memo', rest)).toEqual(['OVER_INVOICE']);
    const id2 = await posted('col.credit_memo', { ...rest, amountCents: 560_000 }, 560_000, accountant);
    expect(linesOf(id2).slice(0, 2)).toEqual([['4191', c.school, null, 500_000, 0], ['2301', c.school, null, 60_000, 0]]);
    expect(await errors('col.credit_memo', { ...rest, amountCents: 1 })).toEqual(['OVER_INVOICE']);
    expect(balanceOf('2301', c.school)).toBe(0);

    // The invoice cannot be cancelled under its credit memos (D6: cancel them first); each cancel mirrors.
    expect((await cancel('jo.invoice_record', inv)).json().code).toBe('HAS_DEPENDENTS');
    await nextDay();
    for (const x of [id2, id]) {
      expect((await cancel('col.credit_memo', x)).statusCode).toBe(200);
      expect(linesOf(x, 'reversal')).toEqual(mirrored(x));
    }
    expect((await cancel('jo.invoice_record', inv)).statusCode).toBe(200);
    noBrokenInvariants();
  });

  it('part paid: the unpaid part comes off the receivable, the paid part becomes credit; a quick sale’s credit is unapplied', async () => {
    const jo = await jobOrder([1_120_000]);
    const inv = await invoice(jo, 1, 1_120_000);
    await collect(jo, 1_000_000);
    const id = await posted('col.credit_memo', { invoiceId: inv, kind: 'allowance', amountCents: 224_000, reason: 'Late delivery, agreed discount' }, 224_000, accountant);
    expect(linesOf(id)).toEqual([
      ['4191', c.school, null, 200_000, 0],
      ['2301', c.school, null, 24_000, 0],
      ['1201', c.school, jo, 0, 120_000],
      ['2201', c.school, jo, 0, 104_000],
    ]);
    expect(owed(inv)).toBe(0);

    const sale = { customerId: c.school, invoiceNumber: '0777', lines: [{ kind: 'service', description: 'Hemming of pants', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] };
    const qs = await encoder.post('/api/qs/sales', { sale, payment: { crNumber: '0777', tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] }, expectedTotalCents: 35_000 }, idem());
    expect(qs.statusCode, qs.body).toBe(200);
    const saleId = qs.json().sale.id as string;
    const cm = await posted('col.credit_memo', { invoiceId: saleId, kind: 'return', amountCents: 35_000, reason: 'Hem redone elsewhere, refunded' }, 35_000, accountant);
    expect(linesOf(cm)).toEqual([
      ['4191', c.school, null, 31_250, 0],
      ['2301', c.school, null, 3_750, 0],
      ['2201', c.school, null, 0, 35_000],
    ]);
    expect((await accountant.post(`/api/qs/sales/${saleId}/cancel`, { reason: 'Recorded by mistake, undoing it' }, idem())).json().code).toBe('HAS_DEPENDENTS');
    noBrokenInvariants();
  });

  it('refuses a cancelled invoice, a written-off one, and a form number used before', async () => {
    const jo = await jobOrder([1_120_000, 560_000]);
    const inv = await invoice(jo, 1, 1_120_000);
    const inv2 = await invoice(jo, 2, 560_000);
    await posted('col.credit_memo', { invoiceId: inv2, kind: 'return', amountCents: 100_000, formNumber: '12', reason: 'One piece came back torn' }, 100_000, accountant);
    expect(await errors('col.credit_memo', { invoiceId: inv, kind: 'return', amountCents: 100_000, formNumber: '0012', reason: 'One piece came back torn' })).toEqual(['FORM_USED']);
    expect((await cancel('jo.invoice_record', inv)).statusCode).toBe(200);
    expect(await errors('col.credit_memo', { invoiceId: inv, kind: 'return', amountCents: 100_000, reason: 'One piece came back torn' })).toEqual(['INVOICE_CANCELLED']);
    await posted('col.write_off', { invoiceId: inv2, reason: 'Customer closed shop and cannot be reached' }, 460_000, accountant);
    expect(await errors('col.credit_memo', { invoiceId: inv2, kind: 'return', amountCents: 100_000, reason: 'One piece came back torn' })).toEqual(['WRITTEN_OFF']);
  });
});

describe('bad debt write-off (D5 BAD-DEBT)', () => {
  it('golden: writes off all the invoice owes, Dr 6270 / Cr 1201, output VAT stays; a collection is refused until the write-off is cancelled', async () => {
    const jo = await jobOrder([5_600_000]);
    await collect(jo, 2_800_000);
    const inv = await invoice(jo, 1, 5_600_000); // applies the 28,000.00 deposit
    expect(owed(inv)).toBe(2_800_000);
    const input = { invoiceId: inv, reason: 'Customer closed shop and cannot be reached' };
    expect((await post('col.write_off', input, 2_800_000, encoder)).statusCode).toBe(403);
    const pre = await preview('col.write_off', input);
    expect(pre.summary).toBe('This will write off ₱28,000.00 that Moonlight Test School still owes on invoice no. 0501 (IR-000001, JO-000001) as a bad debt. Its output VAT stays as it is, and no payment on it is taken until the write-off is cancelled.');
    const id = await posted('col.write_off', input, 2_800_000, accountant);
    expect(linesOf(id)).toEqual([
      ['6270', c.school, null, 2_800_000, 0],
      ['1201', c.school, jo, 0, 2_800_000],
    ]);
    expect(owed(inv)).toBe(0);
    expect(balanceOf('2301', c.school)).toBe(-600_000);
    expect(await errors('col.write_off', input)).toEqual(['WRITTEN_OFF']);

    const col = { customerId: c.school, crNumber: '9002', applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 1_000_000 }] };
    const refused = await preview('col.collection', col, encoder);
    expect(refused.issues.filter((i) => i.level === 'error')).toEqual([expect.objectContaining({ code: 'WRITTEN_OFF', message: 'An invoice of JO-000001 was written off as a bad debt (BDW-000001). To take payment on it, the accountant cancels the write-off first.' })]);

    await nextDay();
    expect((await cancel('col.write_off', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual(mirrored(id));
    expect(await errors('col.collection', col, encoder)).toEqual([]);
    noBrokenInvariants();
  });

  it('refuses an invoice that owes nothing, and a collection on a written-off quick sale', async () => {
    const jo = await jobOrder([100_000]);
    const inv = await invoice(jo, 1, 100_000);
    await collect(jo, 100_000);
    expect(await errors('col.write_off', { invoiceId: inv, reason: 'Customer closed shop and cannot be reached' })).toEqual(['NOTHING_OWED']);

    const sale = { customerId: c.school, invoiceNumber: '0778', lines: [{ kind: 'service', description: 'Hemming of pants', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] };
    const qs = (await encoder.post('/api/qs/sales', { sale, payment: { crNumber: '0778', tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] }, expectedTotalCents: 35_000 }, idem())).json();
    // Its payment cancelled on its own leaves the sale owing; write that off, then try to collect it again.
    const payId = qs.payment.id as string;
    expect((await cancel('col.collection', payId)).statusCode).toBe(200);
    await posted('col.write_off', { invoiceId: qs.sale.id, reason: 'Walk-in never came back to pay' }, 35_000, accountant);
    const col = { customerId: c.school, crNumber: '9003', applications: [], sales: [{ saleId: qs.sale.id, amountCents: 35_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] };
    expect(await errors('col.collection', col, encoder)).toEqual(['WRITTEN_OFF']);
  });
});

describe('AR aging and customer statement', () => {
  it('show each credit on the invoice it is on; the aging total equals 1201', async () => {
    const jo = await jobOrder([1_000_000, 500_000, 300_000]);
    const [i1, i2, i3] = [await invoice(jo, 1, 1_000_000), await invoice(jo, 2, 500_000), await invoice(jo, 3, 300_000)];
    await posted('col.write_off', { invoiceId: i2, reason: 'Customer disputes it; not collectible' }, 500_000, accountant);
    await posted('col.credit_memo', { invoiceId: i3, kind: 'allowance', amountCents: 100_000, reason: 'Late delivery, agreed discount' }, 100_000, accountant);
    await posted('col.cwt_only', { invoiceId: i1, cwtCents: 8_929, atc: 'WC158', periodYear: 2026, periodQuarter: 3 }, 8_929, encoder);
    const aging = (await accountant.get('/api/rpt/ar-aging?asOf=2026-09-28')).json();
    const byDoc = Object.fromEntries(aging.rows.map((r: { documentId: string; totalCents: number }) => [r.documentId, r.totalCents]));
    expect(byDoc).toEqual({ [i1]: 991_071, [i2]: 0, [i3]: 200_000 }); // the written-off invoice owes nothing
    expect(aging.totalCents).toBe(balanceOf('1201'));
    const st = (await accountant.get(`/api/rpt/customer-statement?customerId=${c.school}&from=2026-09-01&to=2026-09-30`)).json();
    expect(st.lines.map((l: { documentNumber: string }) => l.documentNumber)).toEqual(['IR-000001', 'IR-000002', 'IR-000003', 'BDW-000001', 'CM-000001', 'CWT-000001']);
    expect(st.closingBalanceCents).toBe(1_191_071);
  });
});

describe('lookups for the forms', () => {
  it('a customer’s invoices with what each owes, is left to credit and its write-off; job orders whose deposit can be forfeited', async () => {
    const jo = await jobOrder([1_000_000, 500_000]);
    await collect(jo, 1_200_000);
    const i1 = await invoice(jo, 1, 1_000_000); // applies the 12,000.00 deposit up to 10,000.00
    await posted('col.credit_memo', { invoiceId: i1, kind: 'allowance', amountCents: 100_000, reason: 'Late delivery, agreed discount' }, 100_000, accountant);
    const list = (await encoder.get(`/api/col/customers/${c.school}/invoices`)).json();
    expect(list.invoices).toEqual([
      { id: i1, kind: 'jo.invoice_record', number: 'IR-000001', invoiceNumber: '0501', businessDate: '2026-09-28', jobOrderNumber: 'JO-000001', grossCents: 1_000_000, vatCents: 107_143, owedCents: 0, creditableCents: 900_000, writtenOff: null },
    ]);
    const jo2 = await jobOrder([300_000]);
    await collect(jo2, 100_000);
    expect((await encoder.get(`/api/col/customers/${c.school}/forfeitable`)).statusCode).toBe(403);
    expect((await owner.get(`/api/col/customers/${c.school}/forfeitable`)).json().jobOrders).toEqual([
      { id: jo, number: 'JO-000001', status: 'posted', depositsHeldCents: 300_000, stageLabel: 'Partly released', blocked: null },
      { id: jo2, number: 'JO-000002', status: 'posted', depositsHeldCents: 100_000, stageLabel: 'Ready for release', blocked: null },
    ]);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random invoices, collections, credit memos, write-offs, 2307s and forfeits, and their cancels: no invoice owes below zero; 1201 per customer = aging', async () => {
    let number = 20_000;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv(); encoderOwnDefaults(t);
        const db = t.db;
        const userId = createUser(db, `prop-${number}`, ['accountant']);
        const cs = seedCustomers(db, userId);
        const actor = {
          userId,
          permissions: new Set(['jo.post', 'jo.release', 'jo.release_with_balance', 'jo.invoice', 'jo.invoice_cancel', 'col.post', 'col.cancel', 'col.cwt_only', 'col.forfeit', 'col.credit_memo', 'col.write_off']),
        };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
        const postedIds = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const arbOrNull = <T,>(make: () => fc.Arbitrary<T>) => {
          try {
            return make();
          } catch {
            return null;
          }
        };
        const cash = cashPlaceId(db, '1101');
        for (let i = 0; i < 3; i++) {
          const customerId = i < 2 ? cs.school : cs.other;
          const lines = [g(() => fc.integer({ min: 100_000, max: 3_000_000 })), g(() => fc.integer({ min: 100_000, max: 3_000_000 }))];
          const { id: jo } = postDocument(e, jobOrderDoc, actor, { input: jobInput(lines, customerId), expectedTotalCents: lines[0]! + lines[1]! });
          for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']] as const) changeStage(db, jo, { from, to }, { userId, at: stamp(t.clock) });
          const dp = g(() => fc.integer({ min: 1, max: lines[0]! }));
          postDocument(e, collectionDoc, actor, { input: { customerId, crNumber: String(++number), applications: [{ jobOrderId: jo, amountCents: dp }], tenders: [{ cashPlaceId: cash, amountCents: dp }] }, expectedTotalCents: dp });
        }
        const defs: Record<string, DocTypeDef> = { collect: collectionDoc, cwt: cwtOnlyDoc, forfeit: forfeitDoc, memo: creditMemoDoc, writeoff: writeOffDoc };
        const cancels: Record<string, DocTypeDef> = { 'col.collection': collectionDoc, 'col.cwt_only': cwtOnlyDoc, 'col.forfeit': forfeitDoc, 'col.credit_memo': creditMemoDoc, 'col.write_off': writeOffDoc, 'jo.invoice_record': invoiceRecordDoc };
        const step = fc.constantFrom('release+invoice', 'release+invoice', 'collect', 'collect', 'cwt', 'forfeit', 'memo', 'memo', 'writeoff', 'cancel', 'cancel-credit', 'cancel-credit');
        for (const s of g(() => fc.array(step, { minLength: 5, maxLength: 20 }))) {
          try {
            if (s === 'release+invoice') {
              const arb = arbOrNull(() => releaseDoc.arbitrary(db));
              if (!arb) continue;
              const input = g(() => arb);
              const doc = releaseDoc.compute(input, ctx());
              const r = postDocument(e, releaseDoc, actor, { input, expectedTotalCents: doc.totalCents });
              if (doc.totalCents > 0) postDocument(e, invoiceRecordDoc, actor, { input: { releaseId: r.id, invoiceNumber: String(++number) }, expectedTotalCents: doc.totalCents });
            } else if (s === 'cancel' || s === 'cancel-credit') {
              const type = g(() => fc.constantFrom(...(s === 'cancel' ? Object.keys(cancels) : ['col.cwt_only', 'col.forfeit', 'col.credit_memo', 'col.write_off'])));
              const ids = postedIds(type);
              if (ids.length === 0) continue;
              cancelDocument(e, cancels[type]!, actor, g(() => fc.constantFrom(...ids)), 'Recorded by mistake');
            } else {
              const def = defs[s]!;
              const arb = arbOrNull(() => def.arbitrary(db));
              if (!arb) continue;
              const raw = g(() => arb);
              const input = s === 'collect' ? { ...raw, crNumber: String(++number) } : raw;
              const doc = def.compute(input, ctx());
              const p = postDocument(e, def, actor, { input, expectedTotalCents: doc.totalCents });
              if (s !== 'collect') expect(def.toInput(def.load(db, p.id))).toEqual(input);
            }
          } catch (err) {
            if (!(err instanceof AppError) || !['HAS_DEPENDENTS', 'VALIDATION'].includes(err.code)) throw err;
          }
          for (const inv of invoicesOf(db)) {
            const o = owedCents(db, inv);
            expect(o, `${s}: ${inv.number}`).toBeGreaterThanOrEqual(0);
            expect(o).toBeLessThanOrEqual(inv.grossCents);
          }
          const aging = arAging(db, today(t.clock));
          for (const customerId of [cs.school, cs.other]) {
            const ar = db
              .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = 'AR_TRADE' AND l.party_id = ?`)
              .pluck()
              .get(customerId) as number;
            const rows = aging.rows.filter((r) => r.customerId === customerId);
            expect(rows.reduce((n, r) => n + r.totalCents, 0), s).toBe(ar);
            expect(rows.filter((r) => r.documentType === 'jo.invoice_record').every((r) => r.totalCents >= 0), s).toBe(true);
            for (const jo of jobOrdersOf(db, customerId, true)) {
              const m = joMoney(db, jo.id);
              expect(Math.min(m.receivableCents, m.depositsHeldCents), `${s}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0);
              expect(m.receivableCents, s).toBeLessThanOrEqual(invoicedCents(db, jo.id));
            }
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 25 },
    );
  });
});
