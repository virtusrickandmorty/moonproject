/**
 * Release and invoice record: goldens G-02, G-09 (invoice part) and G-10 (PLAN I2), partial release, the D3 release
 * gate, settings (VAT rate, deposit VAT mode A only), D6 cancel rules for invoice records and collections, API rules
 * and a property test over random releases, invoices, collections and cancels.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { addSettingVersion, type SettingKey } from '../../../engine/settings.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { collectionDoc } from '../../COL/doctypes/collection.ts';
import { jobOrderDoc } from '../doctypes/job-order.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { invoiceRecordDoc } from '../doctypes/invoice-record.ts';
import { invoicedCents, joMoney } from '../public.ts';
import { changeStage } from '../stages.ts';
import { seedCustomers } from './cus-fixture.ts';

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

type Line = { kind?: string; qty: number; unitPriceCents: number; discountCents?: number };
/** A recorded JO, moved to Ready for release unless told otherwise. */
async function jobOrder(lines: Line[], { customerId = c.school, ready = true } = {}): Promise<string> {
  const input = {
    customerId,
    dueInDays: 15,
    priority: 'normal',
    paymentTerms: 'dp50',
    lines: lines.map((l) => ({ kind: 'made_to_order', description: 'Team jersey set', discountCents: 0, roster: [], ...l })),
  };
  const total = lines.reduce((s, l) => s + l.qty * l.unitPriceCents - (l.discountCents ?? 0), 0);
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: total }, idem());
  expect(r.statusCode).toBe(200);
  if (ready) for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to })).statusCode).toBe(200);
  return r.json().id;
}
const g01 = () => jobOrder([{ qty: 20, unitPriceCents: 280_000 }]); // ₱56,000.00

let cr = 100;
const collect = async (jo: string, cents: number, extra: object = {}) => {
  const input = { customerId: c.school, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }], ...extra };
  const r = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const credit = { creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 };
const releaseAll = (jo: string, lines = [{ lineNo: 1, qty: 20 }], more: object = credit) => ({ jobOrderId: jo, lines, claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...more });
const release = (body: object, total: number, who = accountant) => who.post('/api/jo/releases', { ...body, expectedTotalCents: total }, idem());
const status = async (jo: string) => (await encoder.get(`/api/jo/orders/${jo}/status`)).json();
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** Journal lines as [account code, party id, JO ref, debit, credit]: the document's own, or its cancel follow-up. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' | 'follow-up' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind === 'follow-up' ? 'document-cancel' : 'document', kind === 'reversal' ? 'reversal' : 'original') as unknown[][];

function setting(key: SettingKey, value: unknown, effectiveFrom = today(env.clock)) {
  tx(env.db, () => addSettingVersion(env.db, { key, effectiveFrom, value, reason: 'Accountant decision for the test', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
}

describe('invoice record goldens (PLAN I2)', () => {
  it('G-02: release all with invoice no. 0501: INV-REC + DEP-APPLY; open AR 28,000.00 = balance due; then G-03 clears it', async () => {
    const jo = await g01();
    await collect(jo, 2_800_000); // G-01: downpayment ₱28,000 cash
    const body = { release: releaseAll(jo), invoice: { invoiceNumber: '0501' } };

    const pre = (await accountant.post('/api/jo/releases/preview', { release: body.release })).json();
    expect(pre.release.issues).toEqual([]);
    expect(pre.release.summary).toBe('This will release 20 pieces of JO-000001 (₱56,000.00) to Coach Placeholder, school ID seen. ₱28,000.00 is still due, to be paid by 2026-10-05.');
    expect(pre.booklet).toMatchObject({ vatRateBp: 1200, grossCents: 5_600_000, vatableSalesCents: 5_000_000, vatCents: 600_000, discountCents: 0 });
    expect(pre.depositAppliedCents).toBe(2_800_000);

    // Balance still due: a credit release, which encoders may not do (E4 rule 3, OWN-22).
    expect((await release(body, 5_600_000, encoder)).json()).toMatchObject({ code: 'VALIDATION', message: '₱28,000.00 is still due on JO-000001. Only the owner or the accountant can release it before it is paid.' });
    const res = await release(body, 5_600_000);
    expect(res.statusCode, res.body).toBe(200);
    const { release: rel, invoiceRecord: ir } = res.json();
    expect(rel).toMatchObject({ number: 'REL-000001', totalCents: 5_600_000, journalNumber: null });
    expect(ir).toMatchObject({ number: 'IR-000001', totalCents: 5_600_000, journalNumber: 'JE-2026-000002' });
    expect(ir.summary).toBe(
      'This will record invoice no. 0501 to Moonlight Test School for REL-000001 of JO-000001: ₱56,000.00 (VATable sales ₱50,000.00, VAT ₱6,000.00). ₱28,000.00 of deposits is applied; ₱28,000.00 is left to collect.',
    );
    expect(linesOf(ir.id)).toEqual([
      ['1201', c.school, jo, 5_600_000, 0],
      ['4101', c.school, null, 0, 5_000_000],
      ['2301', c.school, null, 0, 600_000],
      ['2201', c.school, jo, 2_800_000, 0],
      ['1201', c.school, jo, 0, 2_800_000],
    ]);
    const s = await status(jo);
    expect(s).toMatchObject({ stage: 'released', awaitingInvoice: [], lines: [{ lineNo: 1, qty: 20, releasedQty: 20, leftQty: 0 }] });
    expect(s.money).toMatchObject({ totalCents: 5_600_000, invoicedCents: 5_600_000, receivableCents: 2_800_000, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    expect((await encoder.get(`/api/docs/jo.invoice_record/${ir.id}`)).json().input).toEqual({ releaseId: rel.id, invoiceNumber: '0501' });
    expect((await encoder.get(`/api/docs/jo.release/${rel.id}`)).json().input).toEqual(body.release);

    // G-03: GCash 10,000 + cash 17,750 + CWT 250 clears the receivable; balance due 0.
    await collect(jo, 2_800_000, {
      tenders: [{ cashPlaceId: GCASH, amountCents: 1_000_000 }, { cashPlaceId: CASH, amountCents: 1_775_000 }],
      withholding: { cwtCents: 25_000, atc: 'WC158', certificate: 'pending' },
    });
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0, collectedCents: 5_600_000 });
    noBrokenInvariants();
  });

  it('G-09 (invoice part): a ₱112,000 invoice posts Dr 1201 112,000.00 / Cr 4101 100,000.00, Cr 2301 12,000.00', async () => {
    const jo = await jobOrder([{ qty: 1, unitPriceCents: 11_200_000 }]);
    const { invoiceRecord } = (await release({ release: releaseAll(jo, [{ lineNo: 1, qty: 1 }]), invoice: { invoiceNumber: '0601' } }, 11_200_000)).json();
    expect(linesOf(invoiceRecord.id)).toEqual([
      ['1201', c.school, jo, 11_200_000, 0],
      ['4101', c.school, null, 0, 10_000_000],
      ['2301', c.school, null, 0, 1_200_000],
    ]);
    noBrokenInvariants();
  });

  it('G-10: a discount shown on the invoice posts gross + 4190: Dr 1201 50,400.00; Dr 4190 5,000.00 / Cr 4101 50,000.00; Cr 2301 5,400.00', async () => {
    const jo = await jobOrder([{ qty: 20, unitPriceCents: 280_000, discountCents: 560_000 }]);
    const res = await release({ release: releaseAll(jo), invoice: { invoiceNumber: '0602' } }, 5_040_000);
    expect(res.json().invoiceRecord.summary).toContain('₱50,400.00 (VATable sales ₱45,000.00, VAT ₱5,400.00, discount ₱5,600.00 shown).');
    expect(linesOf(res.json().invoiceRecord.id)).toEqual([
      ['1201', c.school, jo, 5_040_000, 0],
      ['4190', c.school, null, 500_000, 0],
      ['4101', c.school, null, 0, 5_000_000],
      ['2301', c.school, null, 0, 540_000],
    ]);
    noBrokenInvariants();
  });
});

describe('partial release (D3, E4)', () => {
  it('invoices only the released part, shares the discount out by pieces, splits sales by class and applies deposits oldest first', async () => {
    // Line 1: 10 jerseys × ₱1,120 less ₱1,120; line 2: one alteration ₱1,120 (service income).
    const jo = await jobOrder([{ qty: 10, unitPriceCents: 112_000, discountCents: 112_000 }, { kind: 'service', qty: 1, unitPriceCents: 112_000 }]);
    await collect(jo, 300_000);
    await collect(jo, 200_000);

    const first = (await release({ release: releaseAll(jo, [{ lineNo: 1, qty: 4 }]), invoice: { invoiceNumber: '0701' } }, 403_200)).json();
    expect(linesOf(first.invoiceRecord.id)).toEqual([
      ['1201', c.school, jo, 403_200, 0],
      ['4190', c.school, null, 40_000, 0],
      ['4101', c.school, null, 0, 400_000],
      ['2301', c.school, null, 0, 43_200],
      ['2201', c.school, jo, 403_200, 0],
      ['1201', c.school, jo, 0, 403_200],
    ]);
    expect(await status(jo)).toMatchObject({ stage: 'partially_released', lines: [{ lineNo: 1, leftQty: 6 }, { lineNo: 2, leftQty: 1 }] });

    const second = (await release({ release: releaseAll(jo, [{ lineNo: 1, qty: 6 }, { lineNo: 2, qty: 1 }]), invoice: { invoiceNumber: '0702' } }, 716_800)).json();
    expect(linesOf(second.invoiceRecord.id)).toEqual([
      ['1201', c.school, jo, 716_800, 0],
      ['4190', c.school, null, 60_000, 0],
      ['4101', c.school, null, 0, 600_000],
      ['4103', c.school, null, 0, 100_000],
      ['2301', c.school, null, 0, 76_800],
      ['2201', c.school, jo, 96_800, 0],
      ['1201', c.school, jo, 0, 96_800],
    ]);
    expect((await status(jo)).stage).toBe('released');
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 1_120_000, receivableCents: 620_000, depositsHeldCents: 0, balanceDueCents: 620_000 });
    noBrokenInvariants();
  });
});

describe('release gate and rules (D3, E4, N-10)', () => {
  it('needs the invoice number unless the invoice is to follow; a release waiting for its invoice is on the exceptions list', async () => {
    const jo = await g01();
    await collect(jo, 5_600_000); // paid in full: no credit release needed, so the encoder may release
    const r = releaseAll(jo, [{ lineNo: 1, qty: 20 }], {});
    expect((await release({ release: r }, 5_600_000, encoder)).statusCode).toBe(400);
    const res = await release({ release: r, invoice: null }, 5_600_000, encoder);
    expect(res.json()).toMatchObject({ release: { number: 'REL-000001' }, invoiceRecord: null });
    const waiting = (await status(jo)).awaitingInvoice;
    expect(waiting).toEqual([{ id: res.json().release.id, number: 'REL-000001', businessDate: '2026-09-28', jobOrderId: jo, totalCents: 5_600_000 }]);

    const input = { releaseId: res.json().release.id, invoiceNumber: '0801' };
    const ir = await encoder.post('/api/docs/jo.invoice_record/post', { input, expectedTotalCents: 5_600_000 }, idem());
    expect(ir.json()).toMatchObject({ number: 'IR-000001' });
    expect(linesOf(ir.json().id).slice(-2)).toEqual([['2201', c.school, jo, 5_600_000, 0], ['1201', c.school, jo, 0, 5_600_000]]);
    expect((await status(jo)).awaitingInvoice).toEqual([]);
    const again = await encoder.post('/api/docs/jo.invoice_record/preview', { input: { ...input, invoiceNumber: '0802' } });
    expect(again.json().issues).toEqual([expect.objectContaining({ code: 'ALREADY_INVOICED', message: 'REL-000001 already has invoice no. 0801 (IR-000001). Cancel that one first to record another.' })]);
    noBrokenInvariants();
  });

  it('an invoice number is used once, ever, and a refused invoice records nothing, not even the release', async () => {
    const [a, b] = [await g01(), await g01()];
    await release({ release: releaseAll(a), invoice: { invoiceNumber: '0901' } }, 5_600_000);
    const res = await release({ release: releaseAll(b), invoice: { invoiceNumber: '901' } }, 5_600_000);
    expect(res.json()).toMatchObject({ code: 'VALIDATION', message: 'Invoice no. 901 is already used on IR-000001. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.' });
    expect(await status(b)).toMatchObject({ stage: 'ready', awaitingInvoice: [] });
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'jo.release'`).pluck().get()).toBe(1);
    for (const invoiceNumber of ['', '0', 'SI-12']) expect((await release({ release: releaseAll(b), invoice: { invoiceNumber } }, 5_600_000)).statusCode).toBe(400);
  });

  it('checks stage, lines and quantities; only the owner may release a job that is not ready', async () => {
    const jo = await jobOrder([{ qty: 5, unitPriceCents: 100_000 }], { ready: false });
    const codes = async (r: object, who = accountant) => ((await who.post('/api/jo/releases/preview', { release: r })).json().release.issues as { code: string }[]).map((i) => i.code);
    const one = (lines: object[], more: object = credit) => releaseAll(jo, lines as never, more);
    expect(await codes(one([{ lineNo: 1, qty: 5 }]))).toEqual(['NOT_READY']);
    expect(await codes(one([{ lineNo: 1, qty: 5 }], { ...credit, overrideReason: 'Customer needs it for the parade today' }))).toEqual(['OVERRIDE_NOT_ALLOWED']);
    const owner = await env.as('owner');
    expect(await codes(one([{ lineNo: 1, qty: 5 }], { ...credit, overrideReason: 'Customer needs it for the parade today' }), owner)).toEqual([]);
    changeStage(env.db, jo, { from: 'open', to: 'in_production' }, { userId: encoder.userId, at: stamp(env.clock) });
    changeStage(env.db, jo, { from: 'in_production', to: 'ready' }, { userId: encoder.userId, at: stamp(env.clock) });
    expect(await codes(one([{ lineNo: 1, qty: 6 }]))).toEqual(['OVER_RELEASE']);
    expect(await codes(one([{ lineNo: 2, qty: 1 }]))).toEqual(['LINE']);
    expect(await codes(one([{ lineNo: 1, qty: 1 }, { lineNo: 1, qty: 1 }]))).toEqual(['LINE_TWICE']);
    expect(await codes(one([{ lineNo: 1, qty: 1 }], {}))).toEqual(['CREDIT_NOTE']);
    await collect(jo, 500_000);
    expect(await codes(one([{ lineNo: 1, qty: 1 }]))).toEqual(['NO_CREDIT']);
  });

  it('refuses client-sent totals, dates, VAT and numbers (N-03) and checks permissions (N-04)', async () => {
    const jo = await g01();
    for (const extra of [{ totalCents: 1 }, { businessDate: '2026-01-01' }, { creditDueDate: '2026-10-01' }]) {
      expect((await release({ release: { ...releaseAll(jo), ...extra }, invoice: { invoiceNumber: '1001' } }, 5_600_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    for (const extra of [{ vatCents: 600_000 }, { releaseId: jo }, { grossCents: 1 }]) {
      expect((await release({ release: releaseAll(jo), invoice: { invoiceNumber: '1001', ...extra } }, 5_600_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await (await env.as('production')).post('/api/jo/releases', {}, idem())).statusCode).toBe(403);
    const { invoiceRecord } = (await release({ release: releaseAll(jo), invoice: { invoiceNumber: '1001' } }, 5_600_000)).json();
    expect((await encoder.post(`/api/docs/jo.invoice_record/${invoiceRecord.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem())).statusCode).toBe(403);
    // Same Idempotency-Key, same answer, one release (N-02).
    const key = idem();
    const jo2 = await g01();
    const twice = [0, 1].map(() => accountant.post('/api/jo/releases', { release: releaseAll(jo2), invoice: { invoiceNumber: '1002' }, expectedTotalCents: 5_600_000 }, key));
    const [x, y] = await Promise.all(twice);
    expect(x!.json()).toEqual(y!.json());
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'jo.invoice_record'`).pluck().get()).toBe(2);
  });
});

describe('settings: VAT rate and deposit VAT mode (D3, D4.2)', () => {
  it('uses the VAT rate in force on the invoice date', async () => {
    setting('tax.vat_rate_bp', 1000, '2026-09-29');
    const [a, b] = [await g01(), await g01()];
    const today12 = (await release({ release: releaseAll(a), invoice: { invoiceNumber: '1101' } }, 5_600_000)).json().invoiceRecord.id;
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    const tomorrow10 = (await release({ release: releaseAll(b), invoice: { invoiceNumber: '1102' } }, 5_600_000)).json().invoiceRecord.id;
    expect(linesOf(today12).find((l) => l[0] === '2301')).toEqual(['2301', c.school, null, 0, 600_000]);
    expect(linesOf(tomorrow10).find((l) => l[0] === '2301')).toEqual(['2301', c.school, null, 0, 509_091]);
    expect(invoiceRecordDoc.load(env.db, tomorrow10).vatRateBp).toBe(1000);
  });

  it('refuses invoice records and downpayments in modes B and C until they are built', async () => {
    const jo = await g01();
    for (const mode of ['B', 'C']) {
      setting('sales.deposit_vat_mode', mode);
      const res = await release({ release: releaseAll(jo), invoice: { invoiceNumber: '1201' } }, 5_600_000);
      expect(res.json()).toMatchObject({ code: 'VALIDATION' });
      expect(res.json().details).toEqual([expect.objectContaining({ code: 'DEPOSIT_VAT_MODE' })]);
      expect(res.json().message).toMatch(new RegExp(`^Downpayment VAT mode ${mode} \\(.+\\) is in force, and this version can record invoices only in mode A`));
      const dp = { customerId: c.school, crNumber: '1201', applications: [{ jobOrderId: jo, amountCents: 100 }], tenders: [{ cashPlaceId: CASH, amountCents: 100 }] };
      const col = await encoder.post('/api/docs/col.collection/post', { input: dp, expectedTotalCents: 100 }, idem());
      expect(col.json().message).toBe(`Downpayment VAT mode ${mode} is in force, and this version can record downpayments only in mode A (deposit only). Mode ${mode} is not built yet: ask the accountant.`);
    }
    setting('sales.deposit_vat_mode', 'A');
    expect((await release({ release: releaseAll(jo), invoice: { invoiceNumber: '1201' } }, 5_600_000)).statusCode).toBe(200);
  });
});

describe('cancel rules (PLAN D6)', () => {
  const later = async () => {
    env.clock.advance(24 * 3600_000);
    [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
  };
  async function g02(): Promise<{ jo: string; dp: string; rel: string; ir: string }> {
    const jo = await g01();
    const dp = await collect(jo, 2_800_000);
    const { release: r, invoiceRecord: i } = (await release({ release: releaseAll(jo), invoice: { invoiceNumber: '0501' } }, 5_600_000)).json();
    return { jo, dp, rel: r.id, ir: i.id };
  }

  it('plain cancel of a paid invoice record: the mirror, and the payment becomes a deposit of the JO again', async () => {
    const { jo, rel, ir } = await g02();
    await collect(jo, 2_800_000); // G-03 in cash
    await later();
    const res = await accountant.post(`/api/docs/jo.invoice_record/${ir}/cancel`, { reason: 'Invoice written for the wrong buyer' }, idem());
    expect(res.statusCode, res.body).toBe(200);
    expect(linesOf(ir, 'reversal')).toEqual([
      ['1201', c.school, jo, 0, 5_600_000],
      ['4101', c.school, null, 5_000_000, 0],
      ['2301', c.school, null, 600_000, 0],
      ['2201', c.school, jo, 0, 2_800_000],
      ['1201', c.school, jo, 2_800_000, 0],
    ]);
    expect(linesOf(ir, 'follow-up')).toEqual([['1201', c.school, jo, 2_800_000, 0], ['2201', c.school, jo, 0, 2_800_000]]);
    const journals = (await accountant.get(`/api/docs/jo.invoice_record/${ir}`)).json().journals as { memo: string; businessDate: string }[];
    expect(journals.map((j) => [j.memo, j.businessDate])).toEqual([
      ['IR-000001: Sale to Moonlight Test School, invoice no. 0501 (JO-000001, REL-000001)', '2026-09-28'],
      ['Cancel IR-000001: Invoice written for the wrong buyer', '2026-09-29'],
      ['Cancel IR-000001: JO-000001 receivable and deposits put back in line', '2026-09-29'],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 0, receivableCents: 0, depositsHeldCents: 5_600_000, balanceDueCents: 0 });
    expect((await status(jo)).awaitingInvoice.map((r: { id: string }) => r.id)).toEqual([rel]);

    // The release stays; a new invoice (new number) applies the deposits.
    const again = await accountant.post('/api/docs/jo.invoice_record/post', { input: { releaseId: rel, invoiceNumber: '0503' }, expectedTotalCents: 5_600_000 }, idem());
    expect(linesOf(again.json().id).slice(-2)).toEqual([['2201', c.school, jo, 5_600_000, 0], ['1201', c.school, jo, 0, 5_600_000]]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 5_600_000, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0 });
    noBrokenInvariants();
  });

  it('an unpaid invoice record cancels with the mirror only; edit = cancel + new number, deposits applied again', async () => {
    const { jo, rel, ir } = await g02();
    await later();
    const edit = await accountant.post(`/api/docs/jo.invoice_record/${ir}/reissue`, { input: { releaseId: rel, invoiceNumber: '0504' }, expectedTotalCents: 5_600_000, reason: 'Booklet copy was spoiled' }, idem());
    expect(edit.json()).toMatchObject({ number: 'IR-000002', businessDate: '2026-09-29' });
    expect(linesOf(ir, 'follow-up')).toEqual([]);
    expect(linesOf(edit.json().id).slice(-2)).toEqual([['2201', c.school, jo, 2_800_000, 0], ['1201', c.school, jo, 0, 2_800_000]]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 5_600_000, receivableCents: 2_800_000, depositsHeldCents: 0, balanceDueCents: 2_800_000 });
    noBrokenInvariants();
  });

  it('cancelling a collection whose deposit an invoice record applied reopens the receivable (Dr 1201 / Cr 2201)', async () => {
    const { jo, dp } = await g02();
    await later();
    expect((await encoder.post(`/api/docs/col.collection/${dp}/cancel`, { reason: 'Customer check bounced' }, idem())).statusCode).toBe(200);
    expect(linesOf(dp, 'reversal')).toEqual([['1101', null, null, 0, 2_800_000], ['2201', c.school, jo, 2_800_000, 0]]);
    expect(linesOf(dp, 'follow-up')).toEqual([['1201', c.school, jo, 2_800_000, 0], ['2201', c.school, jo, 0, 2_800_000]]);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 5_600_000, receivableCents: 5_600_000, depositsHeldCents: 0, balanceDueCents: 5_600_000 });

    // Then the invoice record too: nothing is owed on AR and nothing is held; the JO is un-invoiced again.
    const ir = env.db.prepare(`SELECT id FROM documents WHERE doc_type = 'jo.invoice_record'`).pluck().get() as string;
    expect((await accountant.post(`/api/docs/jo.invoice_record/${ir}/cancel`, { reason: 'Customer returned everything' }, idem())).statusCode).toBe(200);
    expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 0, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 5_600_000 });
    noBrokenInvariants();
  });

  it('a deposit refunded (not invoiced) still blocks cancelling its collection until the refund is cancelled', async () => {
    const jo = await g01();
    const dp = await collect(jo, 1_000_000);
    const back = { customerId: c.school, jobOrderId: jo, tenders: [{ cashPlaceId: CASH, amountCents: 1_000_000 }], reason: 'Order put on hold, money returned' };
    const rfd = (await accountant.post('/api/docs/col.refund/post', { input: back, expectedTotalCents: 1_000_000 }, idem())).json();
    expect((await encoder.post(`/api/docs/col.collection/${dp}/cancel`, { reason: 'Customer check bounced' }, idem())).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: `Cancel these first: ${rfd.number}.` });
    noBrokenInvariants();
  });

  it('a release cannot be cancelled while its invoice record stands, nor a JO while its releases stand; cancel moves the stage back', async () => {
    const { jo, rel, ir } = await g02();
    const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded on the wrong order' }, idem());
    expect((await cancel('jo.job_order', jo)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: IR-000001, REL-000001.' });
    const edit = await accountant.post(`/api/docs/jo.job_order/${jo}/reissue`, { input: (await encoder.get(`/api/docs/jo.job_order/${jo}`)).json().input, expectedTotalCents: 5_600_000, reason: 'Change the due date and price' }, idem());
    expect(edit.json()).toMatchObject({ code: 'HAS_DEPENDENTS' });
    expect((await cancel('jo.release', rel)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: IR-000001.' });
    expect((await cancel('jo.invoice_record', ir)).statusCode).toBe(200);
    expect((await cancel('jo.release', rel)).statusCode).toBe(200);
    expect(await status(jo)).toMatchObject({ stage: 'ready', lines: [{ leftQty: 20 }], awaitingInvoice: [] });
    expect((await cancel('jo.job_order', jo)).statusCode).toBe(200);
    noBrokenInvariants();
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random releases, invoice records, collections and cancels: stored = computed, nothing negative, money conserved', async () => {
    let number = 10_000;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        // A fresh database per run, so each run's JOs are the only ones the arbitraries can pick.
        const t = await createTestEnv();
        const db = t.db;
        const userId = createUser(db, `prop-${number}`, ['accountant']);
        seedCustomers(db, userId);
        const actor = { userId, permissions: new Set(['jo.post', 'jo.release', 'jo.release_with_balance', 'jo.invoice', 'jo.invoice_cancel', 'jo.cancel', 'col.post', 'col.cancel']) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
        const posted = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const tryArb = <T>(make: () => fc.Arbitrary<T>) => {
          try {
            return make();
          } catch {
            return null; // nothing to act on yet
          }
        };
        for (let i = 0; i < 2; i++) {
          const input = g(() => jobOrderDoc.arbitrary(db));
          const { id: jo, totalCents } = postDocument(e, jobOrderDoc, actor, { input, expectedTotalCents: jobOrderDoc.compute(input, ctx()).totalCents });
          for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']] as const) changeStage(db, jo, { from, to }, { userId, at: stamp(t.clock) });
          const dp = g(() => fc.integer({ min: 0, max: totalCents }));
          const cash = cashPlaceId(db, '1101');
          const collection = { customerId: input.customerId, crNumber: String(++number), applications: [{ jobOrderId: jo, amountCents: dp }], tenders: [{ cashPlaceId: cash, amountCents: dp }] };
          if (dp > 0) postDocument(e, collectionDoc, actor, { input: collection, expectedTotalCents: dp });
        }
        const step = fc.constantFrom('collect', 'collect', 'release', 'release+invoice', 'release+invoice', 'invoice', 'cancel-invoice', 'reissue-invoice', 'cancel-collection', 'cancel-collection', 'cancel-release');
        const steps = g(() => fc.array(step, { minLength: 1, maxLength: 12 }));
        for (const step of steps) {
          try {
            if (step === 'collect') {
              const arb = tryArb(() => collectionDoc.arbitrary(db));
              if (!arb) continue;
              const input = { ...g(() => arb), crNumber: String(++number) };
              const doc = collectionDoc.compute(input, ctx());
              postDocument(e, collectionDoc, actor, { input, expectedTotalCents: doc.totalCents });
            } else if (step.startsWith('release')) {
              const arb = tryArb(() => releaseDoc.arbitrary(db));
              if (!arb) continue;
              const input = g(() => arb);
              const doc = releaseDoc.compute(input, ctx());
              const r = postDocument(e, releaseDoc, actor, { input, expectedTotalCents: doc.totalCents });
              expect(releaseDoc.load(db, r.id)).toEqual(doc);
              expect(releaseDoc.toInput(doc)).toEqual(input);
              if (step === 'release+invoice' && doc.totalCents > 0) {
                const ir = { releaseId: r.id, invoiceNumber: String(++number) };
                postDocument(e, invoiceRecordDoc, actor, { input: ir, expectedTotalCents: doc.totalCents });
              }
            } else if (step === 'invoice') {
              const arb = tryArb(() => invoiceRecordDoc.arbitrary(db));
              if (!arb) continue;
              const input = { ...g(() => arb), invoiceNumber: String(++number) };
              const doc = invoiceRecordDoc.compute(input, ctx());
              expect(doc.salesCents.made_to_order + doc.salesCents.ready_made + doc.salesCents.service + doc.vatCents).toBe(doc.grossCents + doc.discountNetCents);
              const p = postDocument(e, invoiceRecordDoc, actor, { input, expectedTotalCents: doc.totalCents });
              expect(invoiceRecordDoc.load(db, p.id)).toEqual(doc);
              expect(invoiceRecordDoc.toInput(doc)).toEqual(input);
            } else {
              const [type, def] = step.endsWith('invoice') ? ['jo.invoice_record', invoiceRecordDoc] : step.endsWith('collection') ? ['col.collection', collectionDoc] : ['jo.release', releaseDoc];
              const ids = posted(type);
              if (ids.length === 0) continue;
              const id = g(() => fc.constantFrom(...ids));
              if (step === 'reissue-invoice') {
                const old = invoiceRecordDoc.load(db, id);
                reissueDocument(e, invoiceRecordDoc, actor, id, { input: { releaseId: old.releaseId, invoiceNumber: String(++number) }, expectedTotalCents: old.totalCents, reason: 'Booklet copy was spoiled' });
              } else {
                cancelDocument(e, def, actor, id, 'Recorded by mistake');
              }
            }
          } catch (err) {
            // Refusals are fine (a release with an invoice record, a JO no longer ready): they record nothing.
            if (!(err instanceof AppError) || !['HAS_DEPENDENTS', 'VALIDATION'].includes(err.code)) throw err;
          }
          for (const jo of posted('jo.job_order')) {
            const m = joMoney(db, jo);
            expect(Math.min(m.receivableCents, m.depositsHeldCents), `${step}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0);
            expect(m.receivableCents).toBeLessThanOrEqual(invoicedCents(db, jo));
            const paid = db
              .prepare(`SELECT COALESCE(SUM(a.amount_cents), 0) FROM col_applications a JOIN documents d ON d.id = a.document_id WHERE a.job_order_id = ? AND d.status = 'posted'`)
              .pluck()
              .get(jo);
            expect(m.collectedCents, step).toBe(paid);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 30 },
    );
  });
});
