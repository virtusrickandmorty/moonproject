/**
 * Cash Advance Write-off (CAW-, PLAN D5 CA-WO, E11): the accountant or owner forgives what an employee still owes (they
 * left, or it cannot be collected), by default all of it, with a reason.
 *   Dr the operating expense account picked (6990 miscellaneous, 6101 salaries, ...) / Cr 1210 Advances to employees (employee)
 * A forgiven advance is taxable compensation of the employee: the preview warns, and the year-end tax on compensation
 * is to count it (not built yet). Cancel mirrors it on the cancel day.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { employee } from '../../EMP/public.ts';
import { owedFrom, owing } from '../public.ts';
import { owedIssues } from './repayment.ts';

const MAX_CENTS = 1_000_000_00;

/** The operating expense accounts (6xxx) a write-off may be charged to: postable, active, not reserved, without a party. */
export const writeoffAccounts = (db: Db) =>
  db
    .prepare(
      `SELECT id, code, name FROM accounts WHERE type = 'expense' AND code LIKE '6%' AND is_header = 0 AND is_postable = 1 AND is_active = 1 AND is_reserved = 0
         AND is_cash_place = 0 AND party_type IS NULL ORDER BY sort_order, code`,
    )
    .all() as { id: number; code: string; name: string }[];

export const writeoffInput = z
  .object({
    employeeId: z.uuid(),
    amountCents: z.number().int().positive().max(MAX_CENTS).optional(), // left out: all that is owed
    accountId: z.number().int().positive(),
    reason: z.string().trim().min(10).max(300),
  })
  .strict();
export type WriteoffInput = z.infer<typeof writeoffInput>;
export interface Writeoff extends WriteoffInput { amountCents: number; employeeName: string; accountName: string; totalCents: number }

export const writeoffDoc: DocTypeDef<WriteoffInput, Writeoff> = {
  key: 'ca.writeoff',
  module: 'CA',
  title: 'Cash Advance Write-off',
  numbering: { series: { key: 'CAW', prefix: 'CAW-' } },
  permissions: { view: 'ca.view', create: 'ca.writeoff', post: 'ca.writeoff', cancel: 'ca.writeoff' },
  dating: 'system',
  inputSchema: writeoffInput,

  compute(input, ctx) {
    const amountCents = input.amountCents ?? Math.max(0, owedFrom(ctx.db, input.employeeId, ctx.businessDate));
    const account = writeoffAccounts(ctx.db).find((a) => a.id === input.accountId);
    return { ...input, amountCents, employeeName: employee(ctx.db, input.employeeId)?.name ?? '?', accountName: account ? `${account.code} ${account.name}` : '?', totalCents: amountCents };
  },

  validate(doc, ctx) {
    const issues = owedIssues(ctx.db, doc, ctx.businessDate, 'write-off');
    if (doc.accountName === '?') issues.push({ field: 'accountId', code: 'ACCOUNT', level: 'error', message: 'Pick the operating expense account to charge.' });
    issues.push({
      field: 'amountCents', code: 'TAXABLE', level: 'warning',
      message: `A forgiven cash advance is taxable compensation: ${formatPeso(doc.amountCents)} counts in ${doc.employeeName}'s taxable pay for ${ctx.businessDate.slice(0, 4)} (the year-end tax on compensation and Form 2316).`,
    });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ca_writeoffs (document_id, employee_id, employee_name, expense_account_id, amount_cents, reason) VALUES (?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.employeeId, doc.employeeName, doc.accountId, doc.amountCents, doc.reason,
    );
  },

  journal(doc) {
    return {
      memo: `Cash advance of ${doc.employeeName} written off: ${doc.reason}`,
      lines: [
        { account: { accountId: doc.accountId }, debitCents: doc.amountCents },
        { account: { role: 'EMP_ADVANCES' }, party: { type: 'employee', id: doc.employeeId }, creditCents: doc.amountCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT w.*, a.code, a.name FROM ca_writeoffs w JOIN accounts a ON a.id = w.expense_account_id WHERE w.document_id = ?').get(documentId) as
      | { employee_id: string; employee_name: string; expense_account_id: number; amount_cents: number; reason: string; code: string; name: string }
      | undefined;
    if (!r) throw new Error(`Cash advance write-off ${documentId} not found`);
    return {
      employeeId: r.employee_id, amountCents: r.amount_cents, accountId: r.expense_account_id, reason: r.reason,
      employeeName: r.employee_name, accountName: `${r.code} ${r.name}`, totalCents: r.amount_cents,
    };
  },

  toInput: ({ employeeId, amountCents, accountId, reason }) => ({ employeeId, amountCents, accountId, reason }),

  summary(doc, ctx) {
    const left = owedFrom(ctx.db, doc.employeeId, ctx.businessDate) - doc.amountCents;
    return `This will write off ${formatPeso(doc.amountCents)} that ${doc.employeeName} owes on cash advances, charged to ${doc.accountName}${left > 0 ? `; ${formatPeso(left)} is still owed` : ''}. Reason: ${doc.reason}`;
  },

  /** Someone who owes is forgiven all of it, or part. */
  arbitrary(db) {
    const people = owing(db);
    if (!people.length) throw new Error('Nobody owes a cash advance');
    const accounts = writeoffAccounts(db).map((a) => a.id);
    return fc.constantFrom(...people).chain((p) =>
      fc
        .record({ accountId: fc.constantFrom(...accounts), amountCents: fc.option(fc.integer({ min: 1, max: Math.min(p.owedCents, MAX_CENTS) }), { nil: undefined }) })
        .map(({ amountCents, ...r }) => ({ employeeId: p.employeeId, ...r, ...(amountCents ? { amountCents } : {}), reason: 'Left the shop; cannot be collected (made up)' })),
    );
  },
};
