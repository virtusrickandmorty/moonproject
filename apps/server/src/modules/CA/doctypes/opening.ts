/**
 * Opening Cash Advance (OBCA-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): what an employee still owed on cash advances
 * on the cut-over date, with the old CA numbers it replaces kept in the note.
 *   Dr 1210 Advances to employees (employee) / Cr 3900 opening balance equity
 * Stored as a row in ca_advances like any advance (cash_account_id is NULL: the credit side is 3900, not a cash place),
 * so advanceSchedule and the payroll deduction (D5 PAY-RUN, F3) read it exactly like a CA- given before the cut-over:
 * the first payroll after the cut-over deducts it by the instalment typed here. The ACC opening contract (ACC/public.ts):
 * dated the cut-over date, cancelled on it too while the opening is open, and only after payroll has deducted none of it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { assertOpeningOpen, duplicateOpeningIssue, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { activeEmployees, employee } from '../../EMP/public.ts';
import { caBalance } from '../public.ts';

const MAX_CENTS = 1_000_000_00; // ₱1 million: a typo guard

export const openingCaInput = z
  .object({
    employeeId: z.uuid(),
    owedCents: z.number().int().positive().max(MAX_CENTS), // still owed on the cut-over date
    installmentCents: z.number().int().positive().max(MAX_CENTS), // deducted each payroll until repaid
    note: z.string().trim().min(3).max(300), // the old CA numbers this replaces
  })
  .strict();
export type OpeningCaInput = z.infer<typeof openingCaInput>;
export interface OpeningCa extends OpeningCaInput { employeeName: string; totalCents: number }

const build = (db: Db, input: OpeningCaInput): OpeningCa => ({ ...input, employeeName: employee(db, input.employeeId)?.name ?? '?', totalCents: input.owedCents });

export const openingCaDoc: DocTypeDef<OpeningCaInput, OpeningCa> = {
  key: 'ca.opening',
  module: 'CA',
  title: 'Opening Cash Advance',
  numbering: { series: { key: 'OBCA', prefix: 'OBCA-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingCaInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    issues.push(...openingIssues(ctx.db, ctx.businessDate));
    if (!employee(ctx.db, doc.employeeId)?.active) err('employeeId', 'EMPLOYEE', 'Pick an active employee.');
    if (doc.installmentCents > doc.owedCents) err('installmentCents', 'INSTALLMENT', 'The deduction per payroll cannot be more than what is owed.');
    const earlier = ctx.db
      .prepare(
        `SELECT d.number FROM ca_advances c JOIN documents d ON d.id = c.document_id
         WHERE d.doc_type = 'ca.opening' AND d.status = 'posted' AND c.employee_id = ? AND c.amount_cents = ? ORDER BY d.number LIMIT 1`,
      )
      .pluck()
      .get(doc.employeeId, doc.owedCents) as string | undefined;
    issues.push(...duplicateOpeningIssue(ctx.db, 'employeeId', earlier, `this cash advance (${doc.employeeName}, ${formatPeso(doc.owedCents)})`));
    return issues;
  },

  /** A row in ca_advances with no cash place: the credit side is 3900, not cash. */
  persist(db, doc, h) {
    db.prepare('INSERT INTO ca_advances (document_id, employee_id, employee_name, cash_account_id, amount_cents, installment_cents, note) VALUES (?, ?, ?, NULL, ?, ?, ?)').run(
      h.documentId, doc.employeeId, doc.employeeName, doc.owedCents, doc.installmentCents, doc.note,
    );
  },

  journal(doc) {
    return {
      memo: `Opening cash advance: ${doc.employeeName}`,
      lines: [
        { account: { role: 'EMP_ADVANCES' }, party: { type: 'employee', id: doc.employeeId }, debitCents: doc.owedCents, memo: doc.note },
        { account: { role: 'OPENING_EQUITY' }, creditCents: doc.owedCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT employee_id AS employeeId, amount_cents AS owedCents, installment_cents AS installmentCents, note FROM ca_advances WHERE document_id = ?')
      .get(documentId) as OpeningCaInput | undefined;
    if (!r) throw new Error(`Opening cash advance ${documentId} not found`);
    return build(db, r);
  },

  toInput(doc) {
    const { employeeId, owedCents, installmentCents, note } = doc;
    return { employeeId, owedCents, installmentCents, note };
  },

  /**
   * While the balance is below this opening, the payroll deductions, repayments and write-offs still recorded, of any
   * date (the same rule as a CA- given before the cut-over, advance.ts).
   */
  dependents(db, documentId) {
    const r = db.prepare('SELECT employee_id, amount_cents FROM ca_advances WHERE document_id = ?').get(documentId) as
      | { employee_id: string; amount_cents: number }
      | undefined;
    if (!r || caBalance(db, r.employee_id) >= r.amount_cents) return [];
    return db
      .prepare(
        `SELECT DISTINCT d.id, d.number FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN documents d ON d.id = j.source_id
         WHERE l.account_id = ? AND l.party_type = 'employee' AND l.party_id = ? AND l.credit_cents > 0 AND j.posting_kind = 'original' AND j.source_type = 'document'
           AND d.status = 'posted' AND d.id <> ? ORDER BY d.posted_at`,
      )
      .all(resolveAccount(db, { role: 'EMP_ADVANCES' }).id, r.employee_id, documentId) as { id: string; number: string }[];
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its opening advances. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    return `This will record ${formatPeso(doc.owedCents)} still owed by ${doc.employeeName} on cash advances (${doc.note}), deducted ${formatPeso(doc.installmentCents)} each payroll until repaid, as open on the cut-over date ${ctx.businessDate}.`;
  },

  /** Needs active employees on file. */
  arbitrary(db) {
    const people = activeEmployees(db).map((e) => e.id);
    return fc
      .record({
        employeeId: fc.constantFrom(...people),
        owedCents: fc.integer({ min: 100_00, max: 10_000_00 }),
        part: fc.integer({ min: 1, max: 4 }),
        n: fc.integer({ min: 1, max: 999_999 }),
      })
      .map(({ part, n, ...r }): OpeningCaInput => ({ ...r, installmentCents: Math.ceil(r.owedCents / part), note: `Old CA-${n} from the prior book` }));
  },
};
