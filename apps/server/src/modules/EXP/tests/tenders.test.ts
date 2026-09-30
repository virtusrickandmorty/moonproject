/**
 * Expense voucher split tenders (PLAN E9, D5 EXP-PAY "Cash X (per tender)"): goldens for a voucher paid from petty cash and
 * GCash, with and without EWT and input VAT; property tests (every journal balances, the tenders equal the cash credits);
 * and the migration test (a voucher recorded before tenders reads back with one tender and its journal is unchanged).
 */
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import type { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { prepareDatabase } from '../../../app.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { fixedClock } from '../../../platform/clock.ts';
import { openDb, type Db } from '../../../platform/db/driver.ts';
import { loadModules } from '../../load.ts';
import { voucherDoc, voucherInput, type Voucher, type VoucherInput } from '../doctypes/voucher.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let PETTY: number, GCASH: number, BDO: number, CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  PETTY = cashPlaceId(env.db, '1102');
  GCASH = cashPlaceId(env.db, '1121');
  BDO = cashPlaceId(env.db, '1111');
  CASH = cashPlaceId(env.db, '1101');
});

const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const post = (c: Client, input: object, total: number) => c.post('/api/docs/exp.voucher/post', { input, expectedTotalCents: total }, idem());
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
/** The original journal of a document: [code, party type, party id, debit, credit, memo] per line. */
const journalOf = (db: Db, documentId: string) =>
  db
    .prepare(
      `SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents, l.memo FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId);

// ---- Goldens: a voucher paid from petty cash (1102) and GCash (1121) -------------------------------------------------

describe('Expense voucher split tenders: goldens', () => {
  const memo = 'Sample ₱ voucher';
  const rent = () => ({
    categoryId: cat('6110'), description: 'September rent', supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: '2026-09-28', payeeTin: '123-456-789-000',
    payeeName: 'Sample Lessor Corp.', amountCents: 4_000_000,
  });

  it('no EWT, no input VAT: ₱1,000.00 supplies from a payee with no TIN, ₱200.00 petty cash and ₱800.00 GCash', async () => {
    const input = {
      categoryId: cat('6160'), amountCents: 100_000, description: 'Sample supplies', payeeName: 'Sample Store', payeeVatRegistered: false,
      tenders: [{ cashPlaceId: PETTY, amountCents: 20_000 }, { cashPlaceId: GCASH, amountCents: 80_000, reference: 'GC-1001' }],
    };
    const pre = await encoder.post('/api/docs/exp.voucher/preview', { input });
    expect(pre.json().summary).toBe('This will record ₱1,000.00 for Office supplies paid to Sample Store from Petty cash fund (₱200.00) and E-wallet – GCash (₱800.00).');
    const res = await post(encoder, input, 100_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ number: 'EXP-000001', totalCents: 100_000, warnings: [] });
    expect(journalOf(env.db, res.json().id)).toEqual([
      ['6160', null, null, 100_000, 0, 'Sample supplies'],
      ['1102', null, null, 0, 20_000, null],
      ['1121', null, null, 0, 80_000, 'GC-1001'],
    ]);
    expect(balances(env.db)).toEqual({ '6160': 100_000, '1102': -20_000, '1121': -80_000 });
    noBrokenInvariants();
  });

  it('input VAT, no EWT: ₱1,120.00 from a VAT-registered payee, ₱300.00 petty cash and ₱820.00 GCash', async () => {
    const input = {
      categoryId: cat('6160'), amountCents: 112_000, description: 'Bond paper', payeeName: 'Sample Office Depot Inc.', payeeVatRegistered: true, payeeTin: '444-555-666-000',
      supplierInvoiceNo: 'OR-0101', supplierInvoiceDate: '2026-09-28',
      tenders: [{ cashPlaceId: PETTY, amountCents: 30_000 }, { cashPlaceId: GCASH, amountCents: 82_000, reference: 'GC-1002' }],
    };
    const res = await post(encoder, input, 112_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(journalOf(env.db, res.json().id)).toEqual([
      ['6160', null, null, 100_000, 0, 'Bond paper'],
      ['1401', 'supplier', 'tin:444555666000', 12_000, 0, 'Receipt no. OR-0101'],
      ['1102', null, null, 0, 30_000, null],
      ['1121', null, null, 0, 82_000, 'GC-1002'],
    ]);
    noBrokenInvariants();
  });

  it('EWT, no input VAT (G-14 rent to a non-VAT lessor): ₱38,000.00 paid out, ₱8,000.00 petty cash and ₱30,000.00 GCash', async () => {
    const input = {
      ...rent(), payeeName: 'Sample Landlord', payeeVatRegistered: false, payeeTin: '987-654-321-000',
      tenders: [{ cashPlaceId: PETTY, amountCents: 800_000 }, { cashPlaceId: GCASH, amountCents: 3_000_000, reference: 'GC-1003' }],
    };
    const res = await post(encoder, input, 4_000_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().summary).toBe(
      'This will record ₱40,000.00 for Rent paid to Sample Landlord from Petty cash fund (₱8,000.00) and E-wallet – GCash (₱30,000.00); ₱2,000.00 is withheld (EWT 5%), so ₱38,000.00 is paid out.',
    );
    expect(journalOf(env.db, res.json().id)).toEqual([
      ['6110', null, null, 4_000_000, 0, 'September rent'],
      ['2311', 'supplier', 'tin:987654321000', 0, 200_000, 'EWT rent_5'],
      ['1102', null, null, 0, 800_000, null],
      ['1121', null, null, 0, 3_000_000, 'GC-1003'],
    ]);
    noBrokenInvariants();
  });

  it('EWT and input VAT (G-13 rent to a VAT-registered lessor): ₱38,214.29 paid out, ₱10,000.00 petty cash and ₱28,214.29 GCash', async () => {
    const input = {
      ...rent(), payeeVatRegistered: true,
      tenders: [{ cashPlaceId: PETTY, amountCents: 1_000_000 }, { cashPlaceId: GCASH, amountCents: 2_821_429, reference: 'GC-1004' }],
    };
    const res = await post(encoder, input, 4_000_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(journalOf(env.db, res.json().id)).toEqual([
      ['6110', null, null, 3_571_429, 0, 'September rent'],
      ['1401', 'supplier', 'tin:123456789000', 428_571, 0, 'Receipt no. SI-0101'],
      ['2311', 'supplier', 'tin:123456789000', 0, 178_571, 'EWT rent_5'],
      ['1102', null, null, 0, 1_000_000, null],
      ['1121', null, null, 0, 2_821_429, 'GC-1004'],
    ]);
    expect(balances(env.db)).toEqual({ '6110': 3_571_429, '1401': 428_571, '2311': -178_571, '1102': -1_000_000, '1121': -2_821_429 });
    // What was posted reads back as typed, and cancelling mirrors every line: nothing is left in any account.
    const back = (await accountant.get(`/api/docs/exp.voucher/${res.json().id}`)).json();
    expect(back.input.tenders).toEqual(input.tenders);
    expect(back.doc).toMatchObject({ cashCents: 3_821_429, ewtCents: 178_571, inputVatCents: 428_571, tenders: [{ lineNo: 1, cashPlaceName: 'Petty cash fund' }, { lineNo: 2, cashPlaceName: 'E-wallet – GCash' }] });
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    expect((await accountant.post(`/api/docs/exp.voucher/${res.json().id}/cancel`, { reason: 'Recorded twice by mistake' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('a reissue can change the split: one place becomes two, and the old journal is mirrored', async () => {
    const one = { ...rent(), payeeVatRegistered: true, tenders: [{ cashPlaceId: BDO, amountCents: 3_821_429 }] };
    const first = (await post(encoder, one, 4_000_000)).json();
    const split = { ...one, tenders: [{ cashPlaceId: BDO, amountCents: 2_000_000 }, { cashPlaceId: CASH, amountCents: 1_821_429 }] };
    const r = await accountant.post(`/api/docs/exp.voucher/${first.id}/reissue`, { input: split, expectedTotalCents: 4_000_000, reason: 'Part paid in cash' }, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(balances(env.db)).toEqual({ '6110': 3_571_429, '1401': 428_571, '2311': -178_571, '1111': -2_000_000, '1101': -1_821_429 });
    noBrokenInvariants();
  });

  it('refuses tenders that do not add up to what is paid out, and the wrong number of tenders', async () => {
    const base = { ...rent(), payeeVatRegistered: true };
    const two = (a: number, b: number) => [{ cashPlaceId: PETTY, amountCents: a }, { cashPlaceId: GCASH, amountCents: b }];
    // The receipt is ₱40,000.00, but ₱1,785.71 of it is withheld, so ₱38,214.29 is paid out.
    const gross = await post(encoder, { ...base, tenders: two(1_000_000, 3_000_000) }, 4_000_000);
    expect(codes(gross.json().details)).toEqual(['TENDERS']);
    expect(gross.json().details[0].message).toBe('The money paid out (₱40,000.00) must be ₱38,214.29 (the receipt ₱40,000.00 less ₱1,785.71 withheld).');
    expect(codes((await post(encoder, { ...base, tenders: two(1_000_000, 2_821_428) }, 4_000_000)).json().details)).toEqual(['TENDERS']); // a centavo short
    expect((await post(encoder, { ...base, tenders: [] }, 4_000_000)).statusCode).toBe(400);
    expect((await post(encoder, { ...base, tenders: [{ cashPlaceId: PETTY, amountCents: 0 }] }, 4_000_000)).statusCode).toBe(400);
    const five = [1, 2, 3, 4, 5].map(() => ({ cashPlaceId: PETTY, amountCents: 100 }));
    expect((await post(encoder, { ...base, tenders: five }, 4_000_000)).statusCode).toBe(400); // at most four cash places
    const { tenders: _t, ...noTenders } = { ...base, tenders: [] };
    expect((await post(encoder, noTenders, 4_000_000)).statusCode).toBe(400);
    expect((await post(encoder, { ...base, cashPlaceId: PETTY, tenders: two(1_000_000, 2_821_429) }, 4_000_000)).statusCode).toBe(400); // the old field is gone
    expect(env.db.prepare('SELECT COUNT(*) FROM documents').pluck().get()).toBe(0);
    // Four is allowed.
    const four = [{ cashPlaceId: PETTY, amountCents: 1_000_000 }, { cashPlaceId: GCASH, amountCents: 1_000_000 }, { cashPlaceId: BDO, amountCents: 1_000_000 }, { cashPlaceId: CASH, amountCents: 821_429 }];
    expect((await post(encoder, { ...base, tenders: four }, 4_000_000)).statusCode).toBe(200);
    noBrokenInvariants();
  });

  it('checks every tender’s cash place (an inactive one is refused, the others still count) and keeps the reference', async () => {
    env.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(GCASH);
    const input = { categoryId: cat('6140'), amountCents: 50_000, description: 'Sample fare', payeeName: 'Sample Driver', tenders: [{ cashPlaceId: PETTY, amountCents: 20_000 }, { cashPlaceId: GCASH, amountCents: 30_000 }] };
    const res = await post(encoder, input, 50_000);
    expect(res.json().details).toEqual([expect.objectContaining({ code: 'CASH_PLACE', field: 'tenders.1.cashPlaceId', level: 'error' })]);
    expect(res.json().details[0].message).toBe('Pick where the money came from.');
    env.db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').run(GCASH);
    expect((await post(encoder, { ...input, tenders: [{ cashPlaceId: PETTY, amountCents: 20_000 }, { cashPlaceId: GCASH, amountCents: 30_000, reference: memo }] }, 50_000)).statusCode).toBe(200);
  });
});

// ---- Property tests --------------------------------------------------------------------------------------------------

describe('Expense voucher split tenders: property tests (PLAN I1.3)', () => {
  it('every voucher’s journal balances and its tenders equal the cash credits, EWT and input VAT lines unchanged', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['exp.voucher.create', 'exp.voucher.post', 'exp.voucher.cancel']) };
    const e = { db: env.db, clock: env.clock };
    const cashIds = new Set((env.db.prepare('SELECT id FROM accounts WHERE is_cash_place = 1').all() as { id: number }[]).map((r) => r.id));
    let split = 0;
    fc.assert(
      fc.property(fc.array(fc.tuple(voucherDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [input, then] of ops) {
          let p;
          try {
            p = postDocument(e, voucherDoc, actor, { input, expectedTotalCents: input.amountCents });
          } catch (err) {
            // Only a receipt number this payee already used may refuse a generated voucher (the shrinker loves receipt no. 1).
            const issues = ((err as AppError).details ?? []) as { level: string; code: string }[];
            expect(codes(issues.filter((i) => i.level === 'error'))).toEqual(['DUPLICATE_RECEIPT']);
            continue;
          }
          const v = voucherDoc.load(env.db, p.id);
          checkVoucher(v, input, p.id, cashIds);
          if (input.tenders.length > 1) split += 1;
          if (then === 'cancel') cancelDocument(e, voucherDoc, actor, p.id, 'Recorded twice by mistake');
          if (then === 'reissue') {
            // Same voucher, paid from one place instead: the new journal balances and credits that place its whole payout.
            const one = [{ cashPlaceId: input.tenders[0]!.cashPlaceId, amountCents: v.cashCents }];
            const next = reissueDocument(e, voucherDoc, actor, p.id, { input: { ...voucherDoc.toInput(v), tenders: one }, expectedTotalCents: input.amountCents, reason: 'Paid from one place instead' });
            checkVoucher(voucherDoc.load(env.db, next.id), { ...input, tenders: one }, next.id, cashIds);
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
    expect(split).toBeGreaterThan(0); // the generator does split payments
    const tb = env.db.prepare('SELECT SUM(debit_cents) AS d, SUM(credit_cents) AS c FROM journal_lines').get() as { d: number; c: number };
    expect(tb.d).toBe(tb.c);
    // Every journal, on its own, balances: debits equal credits per journal (not just in total).
    expect(env.db.prepare('SELECT COUNT(*) FROM (SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING SUM(debit_cents) <> SUM(credit_cents))').pluck().get()).toBe(0);
  });

  function checkVoucher(v: Voucher, input: VoucherInput, id: string, cashIds: Set<number>) {
    const lines = env.db
      .prepare(
        `SELECT l.account_id AS accountId, a.code, l.debit_cents AS debit, l.credit_cents AS credit FROM journal_lines l JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`,
      )
      .all(id) as { accountId: number; code: string; debit: number; credit: number }[];
    // The journal balances.
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
    // The tenders add up to what is paid out (the receipt less the EWT), and are stored as typed.
    expect(v.tenders.reduce((s, t) => s + t.amountCents, 0)).toBe(v.cashCents);
    expect(v.cashCents).toBe(input.amountCents - v.ewtCents);
    expect(voucherDoc.toInput(v).tenders).toEqual(input.tenders);
    // Each cash place is credited its own tender, in order; nothing else touches a cash place.
    const cash = lines.filter((l) => cashIds.has(l.accountId));
    expect(cash.map((l) => [l.accountId, l.credit, l.debit])).toEqual(input.tenders.map((t) => [t.cashPlaceId, t.amountCents, 0]));
    // Nothing else in the posting changes: the expense, input VAT and EWT lines carry the voucher's figures.
    const rest = lines.filter((l) => !cashIds.has(l.accountId));
    expect(rest.filter((l) => l.code === '1401').reduce((s, l) => s + l.debit, 0)).toBe(v.inputVatCents);
    expect(rest.filter((l) => l.code === '2311').reduce((s, l) => s + l.credit, 0)).toBe(v.ewtCents);
    expect(rest.find((l) => l.accountId === v.expenseAccountId)!.debit).toBe(v.expenseCents);
    expect(rest).toHaveLength(1 + (v.inputVatCents > 0 ? 1 : 0) + (v.ewtCents > 0 ? 1 : 0));
  }
});

// ---- Migration: a voucher recorded before tenders ---------------------------------------------------------------------

describe('EXP migration 0003: vouchers recorded before tenders', () => {
  /**
   * The expense voucher as it posted before this change, kept here word for word where it matters: one cash place in
   * exp_vouchers.cash_account_id, and one credit line for it (Cr cash place, G − EWT).
   */
  const legacyVoucher: DocTypeDef<VoucherInput & { cashPlaceId: number }, Voucher & { cashPlaceId: number }> = {
    ...(voucherDoc as unknown as DocTypeDef<VoucherInput & { cashPlaceId: number }, Voucher & { cashPlaceId: number }>),
    inputSchema: voucherInput.omit({ tenders: true }).extend({ cashPlaceId: z.number().int().positive() }).strict() as never,
    compute(input, ctx) {
      const { cashPlaceId, ...rest } = input;
      const v = voucherDoc.compute({ ...rest, tenders: [{ cashPlaceId, amountCents: 1 }] }, ctx);
      return { ...v, cashPlaceId };
    },
    validate: () => [],
    persist(db, doc, h) {
      db.prepare(
        `INSERT INTO exp_vouchers (document_id, category_id, expense_account_id, cash_account_id, supplier_id, payee_name, payee_tin, payee_vat_registered,
           tax_party_id, description, supplier_invoice_no, supplier_invoice_date, gross_cents, vat_rate_bp, expense_cents, input_vat_cents,
           ewt_class, ewt_rate_bp, ewt_base_cents, ewt_cents, cash_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        h.documentId, doc.categoryId, doc.expenseAccountId, doc.cashPlaceId, doc.supplierId ?? null, doc.payee.name, doc.payee.tin, +doc.payee.vatRegistered,
        doc.payee.taxPartyId, doc.description, doc.supplierInvoiceNo ?? null, doc.supplierInvoiceDate ?? null, doc.amountCents, doc.vatRateBp, doc.expenseCents,
        doc.inputVatCents, doc.appliedEwtClass, doc.ewtRateBp, doc.ewtBaseCents, doc.ewtCents, doc.cashCents,
      );
    },
    journal(doc) {
      const party = doc.payee.taxPartyId ? { type: 'supplier', id: doc.payee.taxPartyId } : undefined;
      const lines: DraftLine[] = [{ account: { accountId: doc.expenseAccountId }, debitCents: doc.expenseCents, memo: doc.description }];
      if (party && doc.inputVatCents > 0) lines.push({ account: { role: 'INPUT_VAT' }, party, debitCents: doc.inputVatCents, memo: `Receipt no. ${doc.supplierInvoiceNo}` });
      if (party && doc.ewtCents > 0) lines.push({ account: { role: 'EWT_PAYABLE' }, party, creditCents: doc.ewtCents, memo: `EWT ${doc.appliedEwtClass}` });
      lines.push({ account: { cashPlace: doc.cashPlaceId }, creditCents: doc.cashCents });
      return { memo: `${doc.categoryName}: ${doc.payee.name}`, lines };
    },
  };

  const snapshot = (db: Db) => ({
    documents: db.prepare('SELECT * FROM documents ORDER BY number').all(),
    journals: db.prepare('SELECT * FROM journals ORDER BY number').all(),
    lines: db.prepare('SELECT * FROM journal_lines ORDER BY journal_id, line_no').all(),
  });

  it('an old voucher reads back with one tender for its cash credit, and its journal is exactly as it was posted', async () => {
    // A database migrated only up to EXP 0002, as it was before this change.
    const modules = await loadModules();
    const exp = modules.find((m) => m.code === 'EXP')!;
    const before = mkdtempSync(join(tmpdir(), 'exp-migrations-'));
    for (const f of ['0001_exp.sql', '0002_exp_purchase_class.sql']) copyFileSync(join(exp.migrationsDir!, f), join(before, f));
    const db = openDb(':memory:');
    const clock = fixedClock('2026-09-28T02:00:00Z');
    prepareDatabase(db, clock, modules.map((m) => (m.code === 'EXP' ? { ...m, migrationsDir: before } : m)));
    expect(db.prepare("SELECT COUNT(*) FROM schema_migrations WHERE id LIKE 'EXP/%'").pluck().get()).toBe(2);
    expect(db.prepare('SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?').pluck().get('exp_vouchers', 'cash_account_id')).toBe(1);

    const actor = { userId: createUser(db, 'old-accountant', ['accountant']), permissions: new Set(['exp.voucher.create', 'exp.voucher.post', 'exp.voucher.cancel']) };
    const e = { db, clock };
    const petty = cashPlaceId(db, '1102');
    const bdo = cashPlaceId(db, '1111');
    const category = (code: string) => db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
    const g13 = { categoryId: category('6110'), cashPlaceId: bdo, amountCents: 4_000_000, description: 'September rent', payeeName: 'Sample Lessor Corp.', payeeVatRegistered: true,
      payeeTin: '123-456-789-000', supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: '2026-09-28' };
    const g16 = { categoryId: category('6140'), cashPlaceId: petty, amountCents: 20_000, description: 'Tricycle to the fabric store', payeeName: 'Tricycle driver' };
    const old13 = postDocument(e, legacyVoucher, actor, { input: g13 as never, expectedTotalCents: 4_000_000 });
    const old16 = postDocument(e, legacyVoucher, actor, { input: g16 as never, expectedTotalCents: 20_000 });
    const cancelled = postDocument(e, legacyVoucher, actor, { input: { ...g16, description: 'Tricycle, entered twice' } as never, expectedTotalCents: 20_000 });
    cancelDocument(e, legacyVoucher, actor, cancelled.id, 'Recorded twice by mistake');
    expect(journalOf(db, old13.id)).toEqual([
      ['6110', null, null, 3_571_429, 0, 'September rent'],
      ['1401', 'supplier', 'tin:123456789000', 428_571, 0, 'Receipt no. SI-0101'],
      ['2311', 'supplier', 'tin:123456789000', 0, 178_571, 'EWT rent_5'],
      ['1111', null, null, 0, 3_821_429, null],
    ]);
    const posted = snapshot(db);

    // Migrate: the same database, the real EXP migrations.
    prepareDatabase(db, clock, modules);
    expect(db.prepare("SELECT id FROM schema_migrations WHERE id LIKE 'EXP/%' ORDER BY id").pluck().all()).toEqual(['EXP/0001_exp.sql', 'EXP/0002_exp_purchase_class.sql', 'EXP/0003_exp_voucher_tenders.sql']);

    // No journal (and no document) changed by a single value.
    expect(snapshot(db)).toEqual(posted);
    // Each old voucher reads back with exactly one tender: its cash place, for what it credited.
    const read13 = voucherDoc.load(db, old13.id);
    expect(read13.tenders).toEqual([{ lineNo: 1, cashPlaceId: bdo, cashPlaceName: 'Cash in bank – BDO', amountCents: 3_821_429 }]);
    expect(read13).toMatchObject({ amountCents: 4_000_000, cashCents: 3_821_429, ewtCents: 178_571, inputVatCents: 428_571, expenseCents: 3_571_429 });
    expect(voucherDoc.toInput(read13)).toEqual({ ...Object.fromEntries(Object.entries(g13).filter(([k]) => k !== 'cashPlaceId')), tenders: [{ cashPlaceId: bdo, amountCents: 3_821_429 }], ewtClass: 'rent_5' });
    expect(voucherDoc.load(db, old16.id).tenders).toEqual([{ lineNo: 1, cashPlaceId: petty, cashPlaceName: 'Petty cash fund', amountCents: 20_000 }]);
    expect(voucherDoc.load(db, cancelled.id).tenders).toHaveLength(1); // a cancelled voucher too
    expect(db.prepare('SELECT COUNT(*) FROM exp_voucher_tenders').pluck().get()).toBe(3);
    // The tenders' total is the journal's cash credit, for every old voucher.
    for (const id of [old13.id, old16.id, cancelled.id]) {
      const tendered = db.prepare('SELECT SUM(amount_cents) FROM exp_voucher_tenders WHERE document_id = ?').pluck().get(id);
      const credited = db
        .prepare(`SELECT SUM(l.credit_cents) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
                  WHERE j.source_id = ? AND j.posting_kind = 'original' AND a.is_cash_place = 1`)
        .pluck()
        .get(id);
      expect(tendered).toBe(credited);
    }
    // The column is gone (the cash place lives only in the tender rows), and the tender rows are as immutable as the voucher.
    expect(db.prepare('SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?').pluck().get('exp_vouchers', 'cash_account_id')).toBe(0);
    expect(() => db.prepare('UPDATE exp_voucher_tenders SET amount_cents = 1').run()).toThrow(/IMMUTABLE/);
    expect(() => db.prepare('DELETE FROM exp_voucher_tenders').run()).toThrow(/NO_DELETE/);
    expect(() => db.prepare('DELETE FROM exp_vouchers').run()).toThrow(/NO_DELETE/);
    expect(() => db.prepare('UPDATE exp_vouchers SET description = ?').run('x')).toThrow(/IMMUTABLE/);

    // The new code cancels an old voucher (a mirror of the journal it posted) and posts the same voucher the new way, line for line.
    clock.set('2026-09-29T02:00:00Z');
    cancelDocument(e, voucherDoc, actor, old13.id, 'Paid from the wrong bank');
    const net = db
      .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE j.source_id = ?`)
      .pluck()
      .get(old13.id);
    expect(net).toBe(0);
    const { cashPlaceId: _c, ...bare } = g13;
    const again = postDocument(e, voucherDoc, actor, { input: { ...bare, tenders: [{ cashPlaceId: bdo, amountCents: 3_821_429 }] }, expectedTotalCents: 4_000_000 });
    expect(journalOf(db, again.id)).toEqual(journalOf(db, old13.id)); // the same lines the old posting made
    expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
  });
});
