/**
 * Damage or loss charge (DMG-; the owner's request, Oct 2026): an employee charged for something damaged or lost, taken
 * back through payroll an instalment at a time (PAY), after tax and contributions, never more than 20% of the pay of a
 * payroll (Labor Code Art. 113-114 and its rules: the employee shown responsible and heard, a fair amount no more than the
 * actual loss). No cash moves:
 *   Dr 1290 Other receivables (the employee, this charge) / Cr 7103 Other income (recovery of the loss)
 * What is still owed is that receivable, by the charge (CA public openCharges). Cancel mirrors it, only while no payroll
 * took any of it back (PAY's dependents name those runs).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { activeEmployees, employee } from '../../EMP/public.ts';
import { jobOrderRef } from '../../JO/public.ts';

const MAX_CENTS = 1_000_000_00; // ₱1 million: a typo guard
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const chargeInput = z
  .object({
    employeeId: z.uuid(),
    what: text(3, 200), // what was damaged or lost
    jobOrderId: z.uuid().optional(), // the job it happened on
    amountCents: z.number().int().positive().max(MAX_CENTS), // no more than the actual loss
    installmentCents: z.number().int().positive().max(MAX_CENTS), // taken back each payroll, at most 20% of its pay
    explanation: text(10, 1000), // the employee's side, heard before charging
    note: text(1, 300).optional(),
  })
  .strict();
export type ChargeInput = z.infer<typeof chargeInput>;
export interface Charge extends ChargeInput { employeeName: string; jobOrderNumber?: string; totalCents: number }

export const chargeDoc: DocTypeDef<ChargeInput, Charge> = {
  key: 'ca.charge',
  module: 'CA',
  title: 'Damage Charge',
  numbering: { series: { key: 'DMG', prefix: 'DMG-' } },
  permissions: { view: 'ca.view', create: 'ca.charge', post: 'ca.charge', cancel: 'ca.charge' },
  dating: 'system',
  inputSchema: chargeInput,

  compute(input, ctx) {
    const jo = input.jobOrderId ? jobOrderRef(ctx.db, input.jobOrderId) : undefined;
    return { ...input, employeeName: employee(ctx.db, input.employeeId)?.name ?? '?', ...(jo ? { jobOrderNumber: jo.number } : {}), totalCents: input.amountCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (!employee(ctx.db, doc.employeeId)?.active) error('employeeId', 'EMPLOYEE', 'Pick an active employee.');
    if (doc.installmentCents > doc.amountCents) error('installmentCents', 'INSTALLMENT', 'The deduction per payroll cannot be more than the charge.');
    if (doc.jobOrderId && !doc.jobOrderNumber) error('jobOrderId', 'JOB_ORDER', 'Pick a job order from the list, or leave it empty.');
    issues.push({ field: 'amountCents', code: 'FAIR_AMOUNT', level: 'warning',
      message: 'Charge no more than the actual loss, and only when the employee is clearly responsible and was heard. Each payroll takes back at most 20% of the pay.' });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ca_charges (document_id, employee_id, employee_name, what, job_order_id, amount_cents, installment_cents, explanation, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.employeeId, doc.employeeName, doc.what, doc.jobOrderId ?? null, doc.amountCents, doc.installmentCents, doc.explanation, doc.note ?? null,
    );
  },

  journal(doc, _ctx, header) {
    const self = header?.documentId;
    return {
      memo: `Damage or loss charged to ${doc.employeeName}: ${doc.what}`,
      lines: [
        { account: { role: 'OTHER_RECEIVABLES' }, party: { type: 'employee', id: doc.employeeId }, ...(self ? { ref: { documentId: self } } : {}), debitCents: doc.amountCents, memo: doc.what },
        { account: { role: 'OTHER_INCOME' }, creditCents: doc.amountCents, memo: `Recovery of loss: ${doc.what}` },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM ca_charges WHERE document_id = ?').get(documentId) as
      | { employee_id: string; employee_name: string; what: string; job_order_id: string | null; amount_cents: number; installment_cents: number; explanation: string; note: string | null }
      | undefined;
    if (!r) throw new Error(`Damage charge ${documentId} not found`);
    const jo = r.job_order_id ? jobOrderRef(db, r.job_order_id) : undefined;
    return {
      employeeId: r.employee_id, what: r.what, ...(r.job_order_id ? { jobOrderId: r.job_order_id } : {}), amountCents: r.amount_cents, installmentCents: r.installment_cents,
      explanation: r.explanation, ...(r.note ? { note: r.note } : {}), employeeName: r.employee_name, ...(jo ? { jobOrderNumber: jo.number } : {}), totalCents: r.amount_cents,
    };
  },

  toInput: ({ employeeId, what, jobOrderId, amountCents, installmentCents, explanation, note }) => ({
    employeeId, what, ...(jobOrderId ? { jobOrderId } : {}), amountCents, installmentCents, explanation, ...(note ? { note } : {}),
  }),

  summary(doc) {
    const on = doc.jobOrderNumber ? ` (${doc.jobOrderNumber})` : '';
    return `This will charge ${doc.employeeName} ${formatPeso(doc.amountCents)} for ${doc.what}${on}, taken back ${formatPeso(doc.installmentCents)} each payroll, never more than 20% of the pay.`;
  },

  arbitrary(db) {
    const people = activeEmployees(db).map((e) => e.id);
    return fc
      .record({ employeeId: fc.constantFrom(...people), what: fc.constantFrom('Damaged cloth', 'Lost scissors', 'Misprinted jersey'), amountCents: fc.integer({ min: 100_00, max: 5_000_00 }), part: fc.integer({ min: 1, max: 4 }) })
      .map(({ part, ...r }) => ({ ...r, installmentCents: Math.ceil(r.amountCents / part), explanation: 'Admitted it during the talk with the owner' }));
  },
};
