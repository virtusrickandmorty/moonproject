/**
 * Expense Voucher: goldens G-13, G-14, G-16, the VAT rate from dated settings, EWT rules, cancel/edit and property tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AppError, applyRate } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postDocument, cancelDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { voucherDoc } from '../doctypes/voucher.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number, CASH: number, PETTY: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  CASH = cashPlaceId(env.db, '1101');
  PETTY = cashPlaceId(env.db, '1102');
});

const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const post = (c: Client, input: { amountCents: number; [k: string]: unknown }, headers = idem()) =>
  c.post('/api/docs/exp.voucher/post', { input, expectedTotalCents: input.amountCents }, headers);
/** The original journal of a document: [code, party type, party id, debit, credit] per line. */
const journalOf = (documentId: string) =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId);
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const setting = (key: string, from: string, value: unknown) =>
  env.db
    .prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(key, from, JSON.stringify(value), 'Test setting version', '2026-09-28T10:00:00.000+08:00', accountant.userId);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

const g13 = () => ({
  categoryId: cat('6110'),
  cashPlaceId: BDO,
  amountCents: 4_000_000,
  description: 'September rent',
  payeeName: 'Sample Lessor Corp.',
  payeeVatRegistered: true,
  payeeTin: '123-456-789-000',
  supplierInvoiceNo: 'SI-0101',
  supplierInvoiceDate: '2026-09-28',
});

describe('Expense voucher goldens (PLAN I2)', () => {
  it('G-13: rent 40,000.00 to a VAT-registered lessor from BDO, EWT 5% on NET', async () => {
    const pre = await encoder.post('/api/docs/exp.voucher/preview', { input: g13() });
    expect(pre.json().summary).toBe(
      'This will record ₱40,000.00 for Rent paid to Sample Lessor Corp. from Cash in bank – BDO, with ₱4,285.71 input VAT; ₱1,785.71 is withheld (EWT 5%), so ₱38,214.29 is paid out.',
    );
    const res = await post(encoder, g13());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'EXP-000001', totalCents: 4_000_000, warnings: [] });
    expect(journalOf(res.json().id)).toEqual([
      ['6110', null, null, 3_571_429, 0],
      ['1401', 'supplier', 'tin:123456789000', 428_571, 0],
      ['2311', 'supplier', 'tin:123456789000', 0, 178_571],
      ['1111', null, null, 0, 3_821_429],
    ]);
    noBrokenInvariants();
  });

  it('G-13 with a supplier on file: TIN, VAT registration and the usual EWT come from the supplier', async () => {
    const s = await accountant.post('/api/pur/suppliers', { name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' });
    const supplierId = s.json().id as string;
    const { payeeName: _n, payeeVatRegistered: _v, payeeTin: _t, ...rest } = g13();
    const input = { ...rest, categoryId: cat('6990'), supplierId };
    const res = await post(encoder, input);
    expect(journalOf(res.json().id)).toEqual([
      ['6990', null, null, 3_571_429, 0],
      ['1401', 'supplier', supplierId, 428_571, 0],
      ['2311', 'supplier', supplierId, 0, 178_571],
      ['1111', null, null, 0, 3_821_429],
    ]);
    expect((await post(encoder, input)).json().details.map((i: { code: string }) => i.code)).toEqual(['DUPLICATE_RECEIPT']);
    expect(codes((await post(encoder, { ...input, supplierInvoiceNo: 'SI-0102', payeeTin: '123-456-789-000' })).json().details)).toContain('FROM_SUPPLIER');
    expect(codes((await post(encoder, { ...input, supplierInvoiceNo: 'SI-0102', payeeName: 'Someone' })).json().details)).toContain('PAYEE');
    noBrokenInvariants();
  });

  it('G-14: the same rent to a non-VAT lessor, EWT 5% on the gross', async () => {
    const res = await post(encoder, { ...g13(), payeeName: 'Sample Landlord', payeeVatRegistered: false, payeeTin: '987-654-321-000' });
    expect(journalOf(res.json().id)).toEqual([
      ['6110', null, null, 4_000_000, 0],
      ['2311', 'supplier', 'tin:987654321000', 0, 200_000],
      ['1111', null, null, 0, 3_800_000],
    ]);
    expect(balances(env.db)).toEqual({ '6110': 4_000_000, '2311': -200_000, '1111': -3_800_000 });
    noBrokenInvariants();
  });

  it('G-16: tricycle 200.00 from petty cash, no VAT receipt', async () => {
    const input = { categoryId: cat('6140'), cashPlaceId: PETTY, amountCents: 20_000, description: 'Tricycle to the fabric store', payeeName: 'Tricycle driver' };
    const res = await post(encoder, input);
    expect(res.json().summary).toBe('This will record ₱200.00 for Transportation and travel paid to Tricycle driver from Petty cash fund.');
    expect(journalOf(res.json().id)).toEqual([['6140', null, null, 20_000, 0], ['1102', null, null, 0, 20_000]]);
    noBrokenInvariants();
  });
});

describe('VAT and EWT rules (PLAN D4)', () => {
  const supplies = (over: object = {}) => ({ ...g13(), categoryId: cat('6160'), cashPlaceId: CASH, amountCents: 1_100_000, description: 'Printer ink', ...over });

  it('reads the VAT rate from dated settings on the receipt date, never a constant', async () => {
    setting('tax.vat_rate_bp', '2026-09-28', 1000);
    const today = await post(encoder, supplies());
    expect(journalOf(today.json().id)).toEqual([['6160', null, null, 1_000_000, 0], ['1401', 'supplier', 'tin:123456789000', 100_000, 0], ['1101', null, null, 0, 1_100_000]]);
    const yesterday = await post(encoder, supplies({ supplierInvoiceNo: 'SI-0102', supplierInvoiceDate: '2026-09-27' }));
    expect(journalOf(yesterday.json().id)).toEqual([['6160', null, null, 982_143, 0], ['1401', 'supplier', 'tin:123456789000', 117_857, 0], ['1101', null, null, 0, 1_100_000]]);
    noBrokenInvariants();
  });

  it('reads the EWT rate from dated settings on the payment date; posted vouchers keep the rate they used', async () => {
    const rates = (await encoder.get('/api/settings')).json().find((s: { key: string }) => s.key === 'tax.ewt_rates_bp').current;
    setting('tax.ewt_rates_bp', '2026-09-29', { ...rates, rent_5: 1000 });
    const before = await post(encoder, g13());
    expect(journalOf(before.json().id)).toContainEqual(['2311', 'supplier', 'tin:123456789000', 0, 178_571]); // 5% of NET ₱35,714.29
    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    const after = await post(encoder, { ...g13(), supplierInvoiceNo: 'SI-0103' });
    expect(after.json().warnings).toEqual([]);
    expect(journalOf(after.json().id)).toContainEqual(['2311', 'supplier', 'tin:123456789000', 0, 357_143]); // 10% from 29 September
    expect((await encoder.get(`/api/docs/exp.voucher/${before.json().id}`)).json()).toMatchObject({ doc: { ewtRateBp: 500, ewtCents: 178_571 } });
    const warned = await encoder.post('/api/docs/exp.voucher/preview', { input: { ...g13(), ewtClass: 'none' } });
    expect(warned.json().issues.find((w: { code: string }) => w.code === 'EWT_DIFFERENT').message).toBe('The usual EWT here is 10% (rent_5). Please check.');
    noBrokenInvariants();
  });

  it('no input VAT without the full receipt; the EWT base is still NET for a VAT-registered payee', async () => {
    const { supplierInvoiceNo: _, ...noNumber } = g13();
    const res = await post(encoder, noNumber);
    expect(codes(res.json().warnings)).toEqual(['NO_INPUT_VAT']);
    expect(journalOf(res.json().id)).toEqual([['6110', null, null, 4_000_000, 0], ['2311', 'supplier', 'tin:123456789000', 0, 178_571], ['1111', null, null, 0, 3_821_429]]);
  });

  it('checks EWT: TIN needed, goods and services only for a Top Withholding Agent, "none" overrides with a warning', async () => {
    const { payeeTin: _, supplierInvoiceNo: _n, ...noTin } = g13();
    expect(codes((await post(encoder, noTin)).json().details)).toContain('TIN_REQUIRED');
    expect(codes((await post(encoder, supplies({ ewtClass: 'goods_1' }))).json().details)).toEqual(['NOT_TWA']);
    const none = await post(encoder, { ...g13(), ewtClass: 'none' });
    expect(codes(none.json().warnings)).toEqual(['EWT_DIFFERENT']);
    expect(journalOf(none.json().id)).toHaveLength(3);
    setting('tax.top_withholding_agent', '2026-09-28', true);
    const goods = await post(encoder, supplies({ ewtClass: 'goods_1', supplierInvoiceNo: 'SI-0200' }));
    expect(journalOf(goods.json().id)).toContainEqual(['2311', 'supplier', 'tin:123456789000', 0, 9_821]); // 1% of NET ₱9,821.43
    noBrokenInvariants();
  });

  it('refuses client figures, future receipts, unknown categories and a missing payee', async () => {
    for (const extra of [{ vatCents: 0 }, { inputVatCents: 1 }, { ewtCents: 0 }, { totalCents: 5 }, { date: '2026-09-28' }]) {
      expect((await post(encoder, { ...g13(), ...extra })).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(codes((await post(encoder, { ...g13(), supplierInvoiceDate: '2026-09-29' })).json().details)).toEqual(['RECEIPT_DATE']);
    expect(codes((await post(encoder, { ...g13(), categoryId: 9999 })).json().details)).toContain('CATEGORY');
    const { payeeName: _, ...noPayee } = g13();
    expect(codes((await post(encoder, noPayee)).json().details)).toContain('PAYEE');
    expect(env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(0);
  });

  it('lists the fixed categories, with Rent carrying EWT 5%', async () => {
    const list = (await encoder.get('/api/exp/categories')).json() as { code: string; defaultEwtClass: string | null }[];
    expect(list).toHaveLength(20);
    expect(list.find((c) => c.code === '6110')!.defaultEwtClass).toBe('rent_5');
    expect(list.some((c) => ['6101', '6210', '6270', '6280'].includes(c.code))).toBe(false);
    expect((await (await env.as('tv')).get('/api/exp/categories')).statusCode).toBe(403);
  });
});

describe('cancel and edit (NR-4)', () => {
  it('cancel posts a mirror dated today and nets to zero; encoders cannot cancel', async () => {
    const { id } = (await post(encoder, g13())).json();
    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    accountant = await env.as('accountant');
    expect((await encoder.post(`/api/docs/exp.voucher/${id}/cancel`, { reason: 'Paid from the wrong bank' }, idem())).statusCode).toBe(403);
    expect((await accountant.post(`/api/docs/exp.voucher/${id}/cancel`, { reason: 'Paid from the wrong bank' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE posting_kind = 'reversal'`).pluck().get()).toBe('2026-09-29');
    expect((await post(accountant, g13())).statusCode).toBe(200); // the receipt is free again
    noBrokenInvariants();
  });

  it('edit = cancel + new number: paid from the cash box, not petty cash', async () => {
    const input = { categoryId: cat('6140'), cashPlaceId: PETTY, amountCents: 20_000, description: 'Tricycle to the fabric store', payeeName: 'Tricycle driver' };
    const first = (await post(encoder, input)).json();
    const r = await accountant.post(`/api/docs/exp.voucher/${first.id}/reissue`, { input: { ...input, cashPlaceId: CASH }, expectedTotalCents: 20_000, reason: 'Paid from the cash box' }, idem());
    expect(r.json().number).toBe('EXP-000002');
    expect(balances(env.db)).toEqual({ '6140': 20_000, '1101': -20_000 });
    const view = (await accountant.get(`/api/docs/exp.voucher/${first.id}`)).json();
    expect(view.header).toMatchObject({ status: 'cancelled', replacedById: r.json().id });
    expect(view.input).toEqual({ ...input, payeeVatRegistered: false, ewtClass: 'none' });
    noBrokenInvariants();
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random vouchers post balanced with exact VAT and EWT, cancel to zero and reissue cleanly', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['exp.voucher.create', 'exp.voucher.post', 'exp.voucher.cancel']) };
    const e = { db: env.db, clock: env.clock };
    fc.assert(
      fc.property(fc.array(fc.tuple(voucherDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, then] of ops) {
          const before = env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get();
          let p;
          try {
            p = postDocument(e, voucherDoc, actor, { input, expectedTotalCents: input.amountCents });
          } catch (err) {
            // A receipt number this payee already used is refused whole (the shrinker loves receipt no. 1).
            expect(codes(((err as AppError).details ?? []) as { code: string }[])).toEqual(['DUPLICATE_RECEIPT']);
            expect(env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(before);
            continue;
          }
          const v = voucherDoc.load(env.db, p.id);
          expect(v.expenseCents + v.inputVatCents).toBe(input.amountCents);
          expect(v.ewtCents).toBe(applyRate(v.ewtBaseCents, v.ewtRateBp));
          expect(v.cashCents).toBe(input.amountCents - v.ewtCents);
          if (then === 'cancel') cancelDocument(e, voucherDoc, actor, p.id, 'Recorded twice by mistake');
          if (then === 'reissue') {
            reissueDocument(e, voucherDoc, actor, p.id, { input: { ...voucherDoc.toInput(v), cashPlaceId: PETTY }, expectedTotalCents: input.amountCents, reason: 'Paid from petty cash instead' });
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
    const tb = env.db.prepare('SELECT SUM(debit_cents) AS d, SUM(credit_cents) AS c FROM journal_lines').get() as { d: number; c: number };
    expect(tb.d).toBe(tb.c);
  });
});
