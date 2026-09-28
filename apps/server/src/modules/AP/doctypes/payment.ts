/**
 * Supplier Payment (SPAY-, PLAN D5 "BILL-PAY", E9; golden G-15). Pays one or more bills of one supplier, split over
 * cash places (a check is a tender from a bank with its number as the reference), with the bank's fee if any.
 *   Dr 2101 AP per bill (party = the supplier, ref = the bill) ; Dr 6230 bank fee / Cr cash place per tender
 * No EWT here: it was credited when the bill was recorded (D4.8). A payment never exceeds what is still owed on a bill,
 * read from the ledger at posting time. Σ tenders = Σ bills paid + fee.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { supplier } from '../../PUR/public.ts';
import { bill, owedOnBill } from '../ledger.ts';
import { MAX_CENTS } from './bill.ts';

const billPaid = z.object({ billId: z.string().trim().min(1).max(80), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();
const tender = z
  .object({
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: z.string().trim().min(1).max(80).optional(), // check number, bank or GCash reference
  })
  .strict();

export const paymentInput = z
  .object({
    supplierId: z.string().trim().min(1).max(80),
    bills: z.array(billPaid).min(1).max(50),
    tenders: z.array(tender).min(1).max(10),
    feeCents: z.number().int().positive().max(1_000_000_00).optional(), // what the bank charged for the transfer
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type PaymentInput = z.infer<typeof paymentInput>;

export interface Payment extends Omit<PaymentInput, 'bills' | 'tenders'> {
  bills: (z.infer<typeof billPaid> & { lineNo: number; billNumber: string; supplierInvoiceNo: string })[];
  tenders: (z.infer<typeof tender> & { lineNo: number; cashPlaceName: string })[];
  supplierName: string;
  paidCents: number;
  totalCents: number;
}

const sum = (xs: readonly { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

function build(db: Db, input: PaymentInput): Payment {
  return {
    ...input,
    bills: input.bills.map((b, i) => {
      const r = bill(db, b.billId);
      return { ...b, lineNo: i + 1, billNumber: r?.number ?? '?', supplierInvoiceNo: r?.supplierInvoiceNo ?? '?' };
    }),
    tenders: input.tenders.map((t, i) => ({ ...t, lineNo: i + 1, cashPlaceName: getCashPlace(db, t.cashPlaceId)?.name ?? '?' })),
    supplierName: supplier(db, input.supplierId)?.name ?? '?',
    paidCents: sum(input.bills),
    totalCents: sum(input.tenders),
  };
}

export const paymentDoc: DocTypeDef<PaymentInput, Payment> = {
  key: 'ap.payment',
  module: 'AP',
  title: 'Supplier Payment',
  numbering: { series: { key: 'SPAY', prefix: 'SPAY-' } },
  permissions: { view: 'ap.pay.view', create: 'ap.pay.create', post: 'ap.pay.post', cancel: 'ap.pay.cancel' },
  dating: 'system',
  inputSchema: paymentInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (!supplier(ctx.db, doc.supplierId)) err('supplierId', 'SUPPLIER', 'Pick the supplier.');
    const seen = new Set<string>();
    doc.bills.forEach((b, i) => {
      const r = bill(ctx.db, b.billId);
      const f = `bills.${i}.billId`;
      if (!r || r.supplierId !== doc.supplierId) return err(f, 'BILL', `Line ${b.lineNo}: pick a bill of ${doc.supplierName}.`);
      if (r.status !== 'posted') return err(f, 'BILL_CANCELLED', `${r.number} was cancelled.`);
      if (seen.has(r.id)) return err(f, 'BILL_TWICE', `${r.number} is on this payment twice.`);
      seen.add(r.id);
      const owed = owedOnBill(ctx.db, r.id);
      if (b.amountCents > owed) err(`bills.${i}.amountCents`, 'MORE_THAN_OWED', owed > 0 ? `Only ${formatPeso(owed)} is still owed on ${r.number}.` : `${r.number} is fully paid.`);
    });
    doc.tenders.forEach((t, i) => {
      if (!getCashPlace(ctx.db, t.cashPlaceId)?.isActive) err(`tenders.${i}.cashPlaceId`, 'CASH_PLACE', 'Pick an active cash place the money came from.');
    });
    const fee = doc.feeCents ?? 0;
    if (doc.totalCents !== doc.paidCents + fee) {
      err('tenders', 'TENDERS', `The money paid out (${formatPeso(doc.totalCents)}) must equal the bills paid (${formatPeso(doc.paidCents)}) plus the bank fee (${formatPeso(fee)}).`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ap_payments (document_id, supplier_id, fee_cents, note) VALUES (?, ?, ?, ?)').run(h.documentId, doc.supplierId, doc.feeCents ?? 0, doc.note ?? null);
    const b = db.prepare('INSERT INTO ap_payment_bills (document_id, line_no, bill_id, amount_cents) VALUES (?, ?, ?, ?)');
    for (const x of doc.bills) b.run(h.documentId, x.lineNo, x.billId, x.amountCents);
    const t = db.prepare('INSERT INTO ap_payment_tenders (document_id, line_no, account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)');
    for (const x of doc.tenders) t.run(h.documentId, x.lineNo, x.cashPlaceId, x.amountCents, x.reference ?? null);
  },

  journal(doc) {
    const party = { type: 'supplier', id: doc.supplierId };
    return {
      memo: `Payment to ${doc.supplierName}`,
      lines: [
        ...doc.bills.map((b) => ({ account: { role: 'AP' }, party, ref: { documentId: b.billId }, debitCents: b.amountCents, memo: `${b.billNumber} (invoice no. ${b.supplierInvoiceNo})` })),
        { account: { role: 'BANK_CHARGES' }, debitCents: doc.feeCents ?? 0, memo: 'Bank fee' },
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, creditCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
      ],
    };
  },

  load(db, documentId) {
    const p = db.prepare('SELECT supplier_id, fee_cents, note FROM ap_payments WHERE document_id = ?').get(documentId) as { supplier_id: string; fee_cents: number; note: string | null } | undefined;
    if (!p) throw new Error(`Supplier payment ${documentId} not found`);
    const bills = db.prepare('SELECT bill_id AS billId, amount_cents AS amountCents FROM ap_payment_bills WHERE document_id = ? ORDER BY line_no').all(documentId) as PaymentInput['bills'];
    const tenders = (
      db.prepare('SELECT account_id AS cashPlaceId, amount_cents AS amountCents, reference FROM ap_payment_tenders WHERE document_id = ? ORDER BY line_no').all(documentId) as
        { cashPlaceId: number; amountCents: number; reference: string | null }[]
    ).map(({ reference, ...t }) => ({ ...t, ...(reference ? { reference } : {}) }));
    return build(db, { supplierId: p.supplier_id, bills, tenders, ...(p.fee_cents ? { feeCents: p.fee_cents } : {}), ...(p.note ? { note: p.note } : {}) });
  },

  toInput(doc) {
    const { supplierId, feeCents, note } = doc;
    const tenders = doc.tenders.map(({ cashPlaceId, amountCents, reference }) => ({ cashPlaceId, amountCents, ...(reference ? { reference } : {}) }));
    return { supplierId, bills: doc.bills.map(({ billId, amountCents }) => ({ billId, amountCents })), tenders, ...(feeCents ? { feeCents } : {}), ...(note ? { note } : {}) };
  },

  summary(doc) {
    const bills = doc.bills.map((b) => `${formatPeso(b.amountCents)} on ${b.billNumber}`).join(', ');
    const from = doc.tenders.map((t) => `${formatPeso(t.amountCents)} from ${t.cashPlaceName}`).join(' and ');
    const fee = doc.feeCents ? `, with a bank fee of ${formatPeso(doc.feeCents)}` : '';
    return `This will record paying ${doc.supplierName} ${bills}: ${from}${fee}.`;
  },

  /**
   * Part of what is owed on one bill open when the generator is made, from one or two cash places, sometimes with a
   * fee. Once earlier payments have used up a bill, validate refuses the payment (MORE_THAN_OWED).
   */
  arbitrary(db) {
    const open = (db.prepare(`SELECT b.document_id AS id, b.supplier_id AS supplierId FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE d.status = 'posted'`).all() as { id: string; supplierId: string }[])
      .map((b) => ({ ...b, owed: owedOnBill(db, b.id) }))
      .filter((b) => b.owed > 0);
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({
        bill: fc.constantFrom(...(open.length > 0 ? open : [{ id: 'no-bill-yet', supplierId: 'none', owed: 1 }])),
        share: fc.integer({ min: 1, max: 20 }),
        places: fc.tuple(fc.constantFrom(...places), fc.constantFrom(...places)),
        split: fc.boolean(),
        feeCents: fc.option(fc.integer({ min: 1, max: 50_00 }), { nil: undefined }),
      })
      .map(({ bill: b, share, places: [a, c], split, feeCents }): PaymentInput => {
        const amountCents = Math.max(1, Math.floor((b.owed * share) / 100));
        const out = amountCents + (feeCents ?? 0);
        const first = split && out > 1 ? Math.floor(out / 2) : out;
        const tenders = [{ cashPlaceId: a, amountCents: first }, ...(first < out ? [{ cashPlaceId: c, amountCents: out - first, reference: 'CHK-0001' }] : [])];
        return { supplierId: b.supplierId, bills: [{ billId: b.id, amountCents }], tenders, ...(feeCents ? { feeCents } : {}) };
      });
  },
};
