/**
 * Opening Supplier Bill (OBAP-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): a supplier bill of the old books still unpaid
 * on the cut-over date, with what was still owed on it then (after the EWT withheld and any part payments before the
 * cut-over). No VAT, EWT or expense lines: those were in the old books.
 *   Dr 3900 opening balance equity / Cr 2101 AP, party = the supplier, ref = this document (like a bill's AP line)
 * It is stored as a bill in ap_bills (no lines, no VAT, no EWT), so a supplier payment pays it like any bill, in full or
 * in part, what is owed on it is read from the ledger (owedOnBill), and AP by supplier lists it. The tax registers and the
 * 2307s to issue read 1401 and 2311, which it never touches. The ACC opening contract (ACC/public.ts): dated the cut-over
 * date, cancelled on it too while the opening is open, and only after the payments made on it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { activeSupplierIds, supplier } from '../../PUR/public.ts';
import { paymentsOnBill } from '../ledger.ts';
import { MAX_CENTS } from './bill.ts';

const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.');

export const openingBillInput = z
  .object({
    supplierId: z.string().trim().min(1).max(80),
    supplierInvoiceNo: z.string().trim().min(1).max(40),
    supplierInvoiceDate: date,
    dueDate: date,
    owedCents: z.number().int().positive().max(MAX_CENTS), // still owed on the cut-over date
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type OpeningBillInput = z.infer<typeof openingBillInput>;

export interface OpeningBill extends OpeningBillInput { supplierName: string; totalCents: number }

const build = (db: Db, input: OpeningBillInput): OpeningBill => ({
  ...input, supplierName: supplier(db, input.supplierId)?.name ?? '?', totalCents: input.owedCents,
});

export const openingBillDoc: DocTypeDef<OpeningBillInput, OpeningBill> = {
  key: 'ap.opening',
  module: 'AP',
  title: 'Opening Supplier Bill',
  numbering: { series: { key: 'OBAP', prefix: 'OBAP-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingBillInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    issues.push(...openingIssues(ctx.db, ctx.businessDate));
    if (!supplier(ctx.db, doc.supplierId)?.isActive) err('supplierId', 'SUPPLIER', 'Pick an active supplier.');
    if (doc.supplierInvoiceDate > ctx.businessDate) err('supplierInvoiceDate', 'INVOICE_DATE', `The invoice date cannot be after the cut-over date, ${ctx.businessDate}.`);
    if (doc.dueDate < doc.supplierInvoiceDate) err('dueDate', 'DUE_DATE', 'The due date cannot be before the invoice date.');
    // The same check as a bill's: one supplier invoice is on one recorded bill, opening or not.
    const dup = ctx.db
      .prepare(`SELECT d.number FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE b.supplier_id = ? AND b.supplier_invoice_no = ? AND d.status = 'posted'`)
      .pluck()
      .get(doc.supplierId, doc.supplierInvoiceNo) as string | undefined;
    if (dup) err('supplierInvoiceNo', 'DUPLICATE_INVOICE', `Invoice no. ${doc.supplierInvoiceNo} of this supplier is already on ${dup}.`);
    return issues;
  },

  /** A bill with no lines, VAT or EWT: what is owed is the whole of it. */
  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO ap_bills (document_id, supplier_id, supplier_invoice_no, supplier_invoice_date, due_date, receiving_report_id, vat_registered, vat_rate_bp,
         gross_cents, input_vat_cents, ewt_class, ewt_rate_bp, ewt_base_cents, ewt_cents, payable_cents, note) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?, 0, NULL, 0, 0, 0, ?, ?)`,
    ).run(h.documentId, doc.supplierId, doc.supplierInvoiceNo, doc.supplierInvoiceDate, doc.dueDate, doc.owedCents, doc.owedCents, doc.note ?? null);
  },

  journal(doc, _ctx, header) {
    return {
      memo: `Opening: ${doc.supplierName} invoice no. ${doc.supplierInvoiceNo}`,
      lines: [
        { account: { role: 'OPENING_EQUITY' }, debitCents: doc.owedCents, memo: 'Opening balance equity' },
        {
          account: { role: 'AP' }, party: { type: 'supplier', id: doc.supplierId }, ...(header ? { ref: { documentId: header.documentId } } : {}),
          creditCents: doc.owedCents, memo: `Due ${doc.dueDate}`,
        },
      ],
    };
  },

  load(db, documentId) {
    const b = db
      .prepare(
        `SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo, supplier_invoice_date AS supplierInvoiceDate, due_date AS dueDate,
           payable_cents AS owedCents, note FROM ap_bills WHERE document_id = ?`,
      )
      .get(documentId) as (Omit<OpeningBillInput, 'note'> & { note: string | null }) | undefined;
    if (!b) throw new Error(`Opening supplier bill ${documentId} not found`);
    const { note, ...input } = b;
    return build(db, { ...input, ...(note ? { note } : {}) });
  },

  toInput(doc) {
    const { supplierId, supplierInvoiceNo, supplierInvoiceDate, dueDate, owedCents, note } = doc;
    return { supplierId, supplierInvoiceNo, supplierInvoiceDate, dueDate, owedCents, ...(note ? { note } : {}) };
  },

  dependents: (db, documentId) => paymentsOnBill(db, documentId),

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its opening bills. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    return `This will record ${formatPeso(doc.owedCents)} still owed to ${doc.supplierName} on invoice no. ${doc.supplierInvoiceNo} of ${doc.supplierInvoiceDate}, due ${doc.dueDate}, as open on the cut-over date ${ctx.businessDate}.`;
  },

  /** Needs active suppliers on file. Invoices dated in 2025 (before any cut-over date the tests use), due in 2026. */
  arbitrary(db) {
    const day = fc.integer({ min: 1, max: 28 }).map((d) => String(d).padStart(2, '0'));
    const month = fc.integer({ min: 1, max: 12 }).map((m) => String(m).padStart(2, '0'));
    return fc
      .record({
        supplierId: fc.constantFrom(...activeSupplierIds(db)),
        no: fc.integer({ min: 1, max: 999_999_999 }),
        invoiced: fc.tuple(month, day),
        due: fc.tuple(month, day),
        owedCents: fc.integer({ min: 1, max: 5_000_000_00 }),
        note: fc.option(fc.constantFrom('Equipment payable', 'Balance after a part payment before the cut-over'), { nil: undefined }),
      })
      .map(({ supplierId, no, invoiced: [im, id], due: [dm, dd], owedCents, note }): OpeningBillInput => ({
        supplierId, supplierInvoiceNo: `SI-${no}`, supplierInvoiceDate: `2025-${im}-${id}`, dueDate: `2026-${dm}-${dd}`, owedCents, ...(note ? { note } : {}),
      }));
  },
};
