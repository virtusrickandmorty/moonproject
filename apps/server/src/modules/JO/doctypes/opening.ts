/**
 * Opening Job Order (OBJO-, PLAN D8 "Cut-over" step 2, MIG-02 part 2): a job order the shop took before the cut-over
 * date and has not finished or not been paid for. Its lines are the part not yet released, kept in jo_lines and jo_roster
 * like any job order's, so production, releases, invoice records and collections work on it as on one taken today.
 *   Dr 3900 opening balance equity / Cr 2201 customer deposits   the deposits paid on it and not yet applied
 *   Dr 1201 AR / Cr 3900 opening balance equity                  released and invoiced before the cut-over, not yet paid
 * Nothing for the part not yet released: a job order is a memo until it is invoiced (D3). The deposit and receivable
 * lines name the customer and this job order (journal ref), as a collection's and an invoice record's do, so its balance
 * due (joMoney) reads them, a later collection pays the receivable first and the invoice records of its releases apply
 * the deposits. What was invoiced and not yet paid counts as invoiced (public.ts invoicedCents), so
 *   total = the part not yet released + the receivable, and balance due = total − deposits.
 * Accountant only; dated the cut-over date and cancelled on it while the opening is open (ACC/public.ts), and only
 * while no later document (collection, refund, deposit transfer, release, invoice record, production entry) stands on it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { conflict, formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocHeader, DocTypeDef } from '../../../engine/documents/registry.ts';
import { assertOpeningOpen, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { entriesOf } from '../../PRD/public.ts';
import { customer } from '../cus.ts';
import { carryStageOver, moveTo } from '../stages.ts';
import {
  MAX_CENTS, PAYMENT_TERMS, computeLines, dropNulls, jobOrderDoc, lineInput, lineIssues, linesToInput, linesTotal, loadLines, persistLines, type JoLine,
} from './job-order.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.');

export const openingJobOrderInput = z
  .object({
    customerId: z.uuid(),
    oldNumber: text(40), // the job order number in the old records
    contact: text(200).optional(),
    dueDate: date, // as promised in the old records; it may already be past
    priority: z.enum(['normal', 'rush']),
    paymentTerms: z.enum(PAYMENT_TERMS),
    notes: text(1000).optional(),
    lines: z.array(lineInput).max(50), // the part not yet released; none when all of it went out
    depositsCents: z.number().int().min(0).max(MAX_CENTS), // paid on it and not yet applied to an invoice
    depositsMemo: text(200).optional(), // the old receipt numbers
    receivableCents: z.number().int().min(0).max(MAX_CENTS), // released and invoiced, not yet paid
    oldInvoices: text(200).optional(), // the old invoice numbers of the receivable
  })
  .strict();
export type OpeningJobOrderInput = z.infer<typeof openingJobOrderInput>;

export interface OpeningJobOrder extends Omit<OpeningJobOrderInput, 'lines'> {
  lines: JoLine[];
  customerName: string;
  /** The lines: the part not yet released, a memo until its invoices are recorded. */
  linesCents: number;
  /** What is left of the order: the part not yet released plus the receivable. The job order's total. */
  totalCents: number;
}

const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;
const postedBy = (db: Db, h: DocHeader) => db.prepare('SELECT posted_by AS userId, posted_at AS at FROM documents WHERE id = ?').get(h.documentId) as { userId: string; at: string };

/** The recorded opening job order that already opens this old number, if any. */
function oldNumberUsedBy(db: Db, oldNumber: string): string | undefined {
  return db
    .prepare(`SELECT d.number FROM jo_opening_orders o JOIN documents d ON d.id = o.document_id WHERE o.old_number = ? COLLATE NOCASE AND d.status = 'posted'`)
    .pluck()
    .get(oldNumber) as string | undefined;
}

export const openingJobOrderDoc: DocTypeDef<OpeningJobOrderInput, OpeningJobOrder> = {
  key: 'jo.opening',
  module: 'JO',
  title: 'Opening Job Order',
  numbering: { series: { key: 'OBJO', prefix: 'OBJO-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingJobOrderInput,

  compute(input, ctx) {
    const lines = computeLines(ctx.db, input.lines);
    const linesCents = linesTotal(lines);
    return { ...input, lines, customerName: customer(ctx.db, input.customerId)?.name ?? '?', linesCents, totalCents: linesCents + input.receivableCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [...openingIssues(ctx.db, ctx.businessDate)];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const c = customer(ctx.db, doc.customerId);
    if (!c?.active) error('customerId', 'CUSTOMER', c ? `${c.name} is inactive. Pick an active customer.` : 'Pick a customer.');
    const used = oldNumberUsedBy(ctx.db, doc.oldNumber);
    if (used) error('oldNumber', 'OLD_NUMBER_USED', `Old job order ${doc.oldNumber} is already open as ${used}.`);
    if (doc.totalCents > MAX_CENTS) error('lines', 'TOO_BIG', 'The total is over ₱100 million. Please check the quantities and prices.');
    issues.push(...lineIssues(ctx.db, doc));
    if (doc.lines.length === 0 && doc.receivableCents === 0) {
      error('lines', 'NOTHING_OPEN', 'Add the lines still to make or release, or the amount invoiced and not yet paid.');
    }
    // The invoices of its releases apply the deposits, so they can never be more than what is left to release.
    const rest = Math.max(0, doc.linesCents);
    if (doc.depositsCents > rest) {
      error(
        'depositsCents',
        'DEPOSITS_OVER',
        rest > 0
          ? `The deposits (${formatPeso(doc.depositsCents)}) are more than the part not yet released (${formatPeso(rest)}). Record at most that: take the rest off the unpaid invoices, or ask the accountant.`
          : `Nothing is left to release, so no deposit can wait for an invoice. Take the deposits off the unpaid invoices, or ask the accountant.`,
      );
    }
    if (doc.receivableCents > 0 && !doc.oldInvoices) error('oldInvoices', 'OLD_INVOICES', 'Type the old invoice numbers of the amount not yet paid.');
    return issues;
  },

  persist(db, doc, h) {
    // The downpayment was asked before the cut-over date; what was paid is in depositsCents.
    db.prepare(
      `INSERT INTO jo_orders (document_id, customer_id, customer_name, contact, due_date, priority, payment_terms, required_dp_cents, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.contact ?? null, doc.dueDate, doc.priority, doc.paymentTerms, doc.notes ?? null);
    persistLines(db, h.documentId, doc.lines);
    db.prepare('INSERT INTO jo_opening_orders (document_id, old_number, deposits_cents, deposits_memo, receivable_cents, old_invoices) VALUES (?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.oldNumber, doc.depositsCents, doc.depositsMemo ?? null, doc.receivableCents, doc.oldInvoices ?? null,
    );
    // Nothing left to make or release: the goods are out, only the money is open.
    if (doc.lines.length === 0) moveTo(db, h.documentId, 'released', `${h.number}: nothing left to release at the cut-over`, postedBy(db, h));
  },

  journal(doc, ctx, header) {
    if (doc.depositsCents === 0 && doc.receivableCents === 0) return null; // a live order with no money yet: a memo only
    const party = { type: 'customer', id: doc.customerId };
    // The lines name this job order, as a collection's and an invoice record's do; a preview has no id yet.
    const ref = header ? { ref: { documentId: header.documentId } } : {};
    const jo = header ? `${header.number} (old job order ${doc.oldNumber})` : `old job order ${doc.oldNumber}`;
    return {
      memo: `Opening job order ${doc.oldNumber} of ${doc.customerName} at ${ctx.businessDate}`,
      lines: [
        { account: { role: 'OPENING_EQUITY' }, debitCents: doc.depositsCents, memo: 'Opening balance equity' },
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ...ref, creditCents: doc.depositsCents, memo: `Deposit for ${jo}${doc.depositsMemo ? `, ${doc.depositsMemo}` : ''}` },
        { account: { role: 'AR_TRADE' }, party, ...ref, debitCents: doc.receivableCents, memo: `${jo}, old invoices ${doc.oldInvoices ?? ''}` },
        { account: { role: 'OPENING_EQUITY' }, creditCents: doc.receivableCents, memo: 'Opening balance equity' },
      ],
    };
  },

  load(db, documentId) {
    const o = db
      .prepare(
        `SELECT o.customer_id AS customerId, x.old_number AS oldNumber, o.contact, o.due_date AS dueDate, o.priority, o.payment_terms AS paymentTerms, o.notes,
           x.deposits_cents AS depositsCents, x.deposits_memo AS depositsMemo, x.receivable_cents AS receivableCents, x.old_invoices AS oldInvoices,
           o.customer_name AS customerName, d.total_cents AS totalCents
         FROM jo_opening_orders x JOIN jo_orders o ON o.document_id = x.document_id JOIN documents d ON d.id = x.document_id WHERE x.document_id = ?`,
      )
      .get(documentId) as object | undefined;
    if (!o) throw new Error(`Opening job order ${documentId} not found`);
    const lines = loadLines(db, documentId);
    return { ...(dropNulls(o, ['contact', 'notes', 'depositsMemo', 'oldInvoices']) as Omit<OpeningJobOrder, 'lines' | 'linesCents'>), lines, linesCents: linesTotal(lines) };
  },

  toInput(doc) {
    const { customerId, oldNumber, contact, dueDate, priority, paymentTerms, notes, depositsCents, depositsMemo, receivableCents, oldInvoices } = doc;
    return {
      customerId,
      oldNumber,
      ...(contact ? { contact } : {}),
      dueDate,
      priority,
      paymentTerms,
      ...(notes ? { notes } : {}),
      lines: linesToInput(doc.lines),
      depositsCents,
      ...(depositsMemo ? { depositsMemo } : {}),
      receivableCents,
      ...(oldInvoices ? { oldInvoices } : {}),
    };
  },

  /**
   * Every later document that stands on it: the money documents whose lines name it (collections, refunds, deposit
   * transfers, invoice records), its releases and its production entries. Its cancel lands on the cut-over date, so it
   * waits until none is left.
   */
  dependents(db, documentId) {
    const money = db
      .prepare(
        `SELECT DISTINCT d.id, d.number, d.doc_type FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN documents d ON d.id = j.source_id
         WHERE l.ref_doc_id = ? AND d.id <> l.ref_doc_id AND d.status = 'posted' ORDER BY d.number`,
      )
      .all(documentId) as { id: string; number: string; doc_type: string }[];
    const all = [...money.filter((d) => !d.doc_type.startsWith('jo.')), ...jobOrderDoc.dependents!(db, documentId), ...entriesOf(db, documentId)];
    return all.filter((d, i) => all.findIndex((x) => x.id === d.id) === i).map(({ id, number }) => ({ id, number }));
  },

  relinkOnReissue(db, oldId, newId) {
    // The engine skips dependents on reissue when this hook exists; an opening job order still cannot be edited under them.
    const deps = openingJobOrderDoc.dependents!(db, oldId);
    if (deps.length > 0) throw conflict('HAS_DEPENDENTS', `Cancel these first: ${deps.map((x) => x.number).join(', ')}.`, deps);
    carryStageOver(db, oldId, newId);
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its documents. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const n = doc.lines.reduce((s, l) => s + l.qty, 0);
    const parts = [
      n > 0 ? `${pieces(n)} still to release (${formatPeso(doc.linesCents)})` : 'nothing left to release',
      ...(doc.depositsCents > 0 ? [`${formatPeso(doc.depositsCents)} of deposits held`] : []),
      ...(doc.receivableCents > 0 ? [`${formatPeso(doc.receivableCents)} invoiced and not yet paid (old invoices ${doc.oldInvoices ?? '?'})`] : []),
    ];
    return `This will open old job order ${doc.oldNumber} of ${doc.customerName} as at ${ctx.businessDate}: ${parts.join(', ')}. Balance due ${formatPeso(doc.totalCents - doc.depositsCents)}, due ${doc.dueDate}.`;
  },

  arbitrary(db) {
    // A job order's customer and lines; then how much of it is left, and its money at the cut-over date.
    return jobOrderDoc.arbitrary(db).chain(({ customerId, priority, paymentTerms, lines }) =>
      fc
        .record({
          open: fc.boolean(), // false: everything went out, only the receivable is left
          depositPct: fc.integer({ min: 0, max: 100 }),
          receivableCents: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5_000_000 })),
          oldNo: fc.integer({ min: 1, max: 99_999 }),
          dueDate: fc.constantFrom('2026-09-15', '2026-10-05', '2026-11-30'),
          memos: fc.boolean(),
        })
        .map(({ open, depositPct, receivableCents, oldNo, dueDate, memos }) => {
          const rest = open ? lines : [];
          const restCents = rest.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0);
          const depositsCents = Math.floor((restCents * depositPct) / 100);
          const receivable = open ? receivableCents : Math.max(receivableCents, 100);
          return {
            customerId,
            oldNumber: `JO ${oldNo}`,
            dueDate,
            priority,
            paymentTerms,
            lines: rest,
            depositsCents,
            ...(memos && depositsCents > 0 ? { depositsMemo: 'Old receipts 1201, 1207' } : {}),
            receivableCents: receivable,
            ...(receivable > 0 ? { oldInvoices: '0412, 0413' } : {}),
          };
        }),
    );
  },
};
