/**
 * Cash Advance (CA-, PLAN D5 CA-GIVE, E11): money given to an employee ("bale"), repaid through payroll by an instalment
 * per run (OWN-09), or later in cash.
 *   Dr 1210 Advances to employees (employee) / Cr cash place
 * Cancel mirrors it, but only while none of it has been repaid: payroll deductions and repayments reduce the same
 * balance, so they are cancelled first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces, resolveAccount } from '../../../engine/ledger/accounts.ts';
import { activeEmployees, employee } from '../../EMP/public.ts';
import { caBalance } from '../public.ts';

const MAX_CENTS = 1_000_000_00; // ₱1 million: a typo guard

export const advanceInput = z
  .object({
    employeeId: z.uuid(),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    installmentCents: z.number().int().positive().max(MAX_CENTS), // deducted each payroll until repaid
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type AdvanceInput = z.infer<typeof advanceInput>;
export interface Advance extends AdvanceInput { employeeName: string; cashPlaceName: string; totalCents: number }

export const advanceDoc: DocTypeDef<AdvanceInput, Advance> = {
  key: 'ca.advance',
  module: 'CA',
  title: 'Cash Advance',
  numbering: { series: { key: 'CA', prefix: 'CA-' } },
  permissions: { view: 'ca.view', create: 'ca.give', post: 'ca.give', cancel: 'ca.cancel' },
  dating: 'system',
  inputSchema: advanceInput,

  compute(input, ctx) {
    return {
      ...input,
      employeeName: employee(ctx.db, input.employeeId)?.name ?? '?',
      cashPlaceName: getCashPlace(ctx.db, input.cashPlaceId)?.name ?? '?',
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (!employee(ctx.db, doc.employeeId)?.active) issues.push({ field: 'employeeId', code: 'EMPLOYEE', level: 'error', message: 'Pick an active employee.' });
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) issues.push({ field: 'cashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick where the money came from.' });
    if (doc.installmentCents > doc.amountCents) issues.push({ field: 'installmentCents', code: 'INSTALLMENT', level: 'error', message: 'The deduction per payroll cannot be more than the advance.' });
    const owed = caBalance(ctx.db, doc.employeeId);
    if (owed > 0) issues.push({ field: 'employeeId', code: 'OWES', level: 'warning', message: `${doc.employeeName} still owes ${formatPeso(owed)} on earlier advances.` });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ca_advances (document_id, employee_id, employee_name, cash_account_id, amount_cents, installment_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.employeeId, doc.employeeName, doc.cashPlaceId, doc.amountCents, doc.installmentCents, doc.note ?? null,
    );
  },

  journal(doc) {
    return {
      memo: `Cash advance to ${doc.employeeName}`,
      lines: [
        { account: { role: 'EMP_ADVANCES' }, party: { type: 'employee', id: doc.employeeId }, debitCents: doc.amountCents },
        { account: { cashPlace: doc.cashPlaceId }, creditCents: doc.amountCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM ca_advances WHERE document_id = ?').get(documentId) as
      | { employee_id: string; employee_name: string; cash_account_id: number; amount_cents: number; installment_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Cash advance ${documentId} not found`);
    return {
      employeeId: r.employee_id, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, installmentCents: r.installment_cents, ...(r.note ? { note: r.note } : {}),
      employeeName: r.employee_name, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?', totalCents: r.amount_cents,
    };
  },

  toInput(doc) {
    const { employeeId, cashPlaceId, amountCents, installmentCents, note } = doc;
    return { employeeId, cashPlaceId, amountCents, installmentCents, ...(note ? { note } : {}) };
  },

  /** Deductions and repayments recorded after it, while they have taken the balance below this advance. */
  dependents(db, documentId) {
    const r = db.prepare('SELECT c.employee_id, c.amount_cents, d.posted_at FROM ca_advances c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?').get(documentId) as
      | { employee_id: string; amount_cents: number; posted_at: string }
      | undefined;
    if (!r || caBalance(db, r.employee_id) >= r.amount_cents) return [];
    return db
      .prepare(
        `SELECT DISTINCT d.id, d.number FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN documents d ON d.id = j.source_id
         WHERE l.account_id = ? AND l.party_type = 'employee' AND l.party_id = ? AND l.credit_cents > 0 AND j.posting_kind = 'original' AND j.source_type = 'document'
           AND d.status = 'posted' AND d.id <> ? AND d.posted_at >= ? ORDER BY d.posted_at`,
      )
      .all(resolveAccount(db, { role: 'EMP_ADVANCES' }).id, r.employee_id, documentId, r.posted_at) as { id: string; number: string }[];
  },

  summary(doc) {
    return `This will give ${formatPeso(doc.amountCents)} to ${doc.employeeName} as a cash advance from ${doc.cashPlaceName}, deducted ${formatPeso(doc.installmentCents)} each payroll until repaid.`;
  },

  arbitrary(db) {
    const people = activeEmployees(db).map((e) => e.id);
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({ employeeId: fc.constantFrom(...people), cashPlaceId: fc.constantFrom(...places), amountCents: fc.integer({ min: 100_00, max: 10_000_00 }), part: fc.integer({ min: 1, max: 4 }) })
      .map(({ part, ...r }) => ({ ...r, installmentCents: Math.ceil(r.amountCents / part) }));
  },
};
