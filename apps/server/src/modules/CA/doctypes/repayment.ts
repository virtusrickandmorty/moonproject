/**
 * Cash Advance Repayment (CAR-, PLAN D5 CA-REPAY, E11): an employee pays back part or all of what they owe, in cash or
 * by bank, outside payroll.
 *   Dr cash place / Cr 1210 Advances to employees (employee)
 * Never more than can be taken on its date without leaving a later payroll deduction uncovered (owedFrom, as the
 * payroll uses it). Cancel mirrors it on the cancel day; what is owed goes back up, so nothing depends on it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { employee } from '../../EMP/public.ts';
import { owedFrom, owing } from '../public.ts';

const MAX_CENTS = 1_000_000_00; // ₱1 million: a typo guard

export const repaymentInput = z
  .object({
    employeeId: z.uuid(),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: z.string().trim().min(1).max(60).optional(), // the bank or GCash transfer reference
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type RepaymentInput = z.infer<typeof repaymentInput>;
export interface Repayment extends RepaymentInput { employeeName: string; cashPlaceName: string; totalCents: number }

/** The issues of an amount taken off what an employee owes on a date (a repayment or a write-off). */
export function owedIssues(db: Parameters<typeof owedFrom>[0], doc: { employeeId: string; employeeName: string; amountCents: number }, businessDate: string, what: string): Issue[] {
  if (!employee(db, doc.employeeId)) return [{ field: 'employeeId', code: 'EMPLOYEE', level: 'error', message: 'Pick the employee.' }];
  const owed = owedFrom(db, doc.employeeId, businessDate);
  if (owed <= 0) return [{ field: 'employeeId', code: 'NOTHING_OWED', level: 'error', message: `${doc.employeeName} owes nothing on cash advances.` }];
  if (doc.amountCents > owed) return [{ field: 'amountCents', code: 'MORE_THAN_OWED', level: 'error', message: `${doc.employeeName} owes ${formatPeso(owed)} on cash advances; the ${what} cannot be more.` }];
  return [];
}

export const repaymentDoc: DocTypeDef<RepaymentInput, Repayment> = {
  key: 'ca.repayment',
  module: 'CA',
  title: 'Cash Advance Repayment',
  numbering: { series: { key: 'CAR', prefix: 'CAR-' } },
  permissions: { view: 'ca.view', create: 'ca.give', post: 'ca.give', cancel: 'ca.cancel' },
  dating: 'system',
  inputSchema: repaymentInput,

  compute(input, ctx) {
    return {
      ...input,
      employeeName: employee(ctx.db, input.employeeId)?.name ?? '?',
      cashPlaceName: getCashPlace(ctx.db, input.cashPlaceId)?.name ?? '?',
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const issues = owedIssues(ctx.db, doc, ctx.businessDate, 'repayment');
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) issues.push({ field: 'cashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick where the money went.' });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ca_repayments (document_id, employee_id, employee_name, cash_account_id, amount_cents, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.employeeId, doc.employeeName, doc.cashPlaceId, doc.amountCents, doc.reference ?? null, doc.note ?? null,
    );
  },

  journal(doc) {
    return {
      memo: `Cash advance repaid by ${doc.employeeName}`,
      lines: [
        { account: { cashPlace: doc.cashPlaceId }, debitCents: doc.amountCents, ...(doc.reference ? { memo: doc.reference } : {}) },
        { account: { role: 'EMP_ADVANCES' }, party: { type: 'employee', id: doc.employeeId }, creditCents: doc.amountCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM ca_repayments WHERE document_id = ?').get(documentId) as
      | { employee_id: string; employee_name: string; cash_account_id: number; amount_cents: number; reference: string | null; note: string | null }
      | undefined;
    if (!r) throw new Error(`Cash advance repayment ${documentId} not found`);
    return {
      employeeId: r.employee_id, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.reference ? { reference: r.reference } : {}), ...(r.note ? { note: r.note } : {}),
      employeeName: r.employee_name, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?', totalCents: r.amount_cents,
    };
  },

  toInput: ({ employeeId, cashPlaceId, amountCents, reference, note }) => ({ employeeId, cashPlaceId, amountCents, ...(reference ? { reference } : {}), ...(note ? { note } : {}) }),

  summary(doc, ctx) {
    const left = owedFrom(ctx.db, doc.employeeId, ctx.businessDate) - doc.amountCents;
    return `This will record ${formatPeso(doc.amountCents)} paid back by ${doc.employeeName} into ${doc.cashPlaceName}${left >= 0 ? `, leaving ${formatPeso(left)} owed on cash advances` : ''}.`;
  },

  /** Someone who owes pays back part or all of it. */
  arbitrary(db) {
    const people = owing(db);
    if (!people.length) throw new Error('Nobody owes a cash advance');
    const places = listCashPlaces(db).map((c) => c.id);
    return fc.constantFrom(...people).chain((p) => {
      const most = Math.min(p.owedCents, MAX_CENTS);
      return fc
        .record({ cashPlaceId: fc.constantFrom(...places), amountCents: fc.oneof(fc.constant(most), fc.integer({ min: 1, max: most })), reference: fc.constantFrom(undefined, 'GCash 0917 made up') })
        .map(({ reference, ...r }) => ({ employeeId: p.employeeId, ...r, ...(reference ? { reference } : {}) }));
    });
  },
};
